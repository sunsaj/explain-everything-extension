import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getDefaultSettings } from "../shared/defaults.js";

const manifestUrl = new URL("../manifest.json", import.meta.url);
const backgroundUrl = new URL("../background.js", import.meta.url);

test("manifest wires Manifest V3, future UI paths, and packaged icons", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));

  assert.equal(manifest.manifest_version, 3);
  assert.ok(Number(manifest.minimum_chrome_version) >= 102);
  assert.deepEqual(manifest.permissions, ["storage", "unlimitedStorage"]);
  assert.deepEqual(manifest.optional_host_permissions, ["https://*/*", "http://*/*"]);
  assert.deepEqual(manifest.background, {
    service_worker: "background.js",
    type: "module"
  });
  assert.deepEqual(manifest.content_scripts[0], {
    matches: ["https://*/*", "http://*/*"],
    js: ["content/content.js"],
    run_at: "document_idle"
  });
  assert.equal(manifest.options_page, "options/options.html");
  assert.equal(manifest.action.default_popup, "popup/popup.html");
  assert.deepEqual(manifest.action.default_icon, {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png"
  });
  assert.deepEqual(manifest.icons, {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  });
  assert.deepEqual(manifest.web_accessible_resources, [{
    resources: [
      "content/app.js",
      "content/app-controller.js",
      "assets/fonts/InterVariable.woff2",
      "content/markdown.js",
      "content/panel.js",
      "content/panel.css",
      "shared/profile-titles.js",
      "shared/selection.js"
    ],
    matches: ["https://*/*", "http://*/*"]
  }]);
});

test("background statically wires shared adapters, listeners, and exact permission checks", async () => {
  const source = await readFile(backgroundUrl, "utf8");

  assert.match(source, /permissionPatternForEndpoint/);
  assert.match(source, /requestExplanation/);
  assert.match(source, /explain:\s*async\s*\(\s*settings,\s*text,\s*prompt,\s*webSearchEnabled/);
  assert.match(source, /requestExplanation\(settings,\s*text,\s*prompt/);
  assert.match(source, /createMessageHandler/);
  assert.match(source, /loadSettings/);
  assert.match(source, /saveSettings/);
  assert.match(source, /setAccessLevel/);
  assert.match(source, /TRUSTED_CONTEXTS/);
  assert.match(source, /chrome\.storage\.onChanged\.addListener/);
  assert.match(source, /chrome\.tabs\.query/);
  assert.match(source, /chrome\.tabs\.sendMessage/);
  assert.match(source, /PUBLIC_STATUS_CHANGED/);
  assert.match(source, /saveConfiguration/);
  assert.match(source, /isTrustedOptionsSender/);
  assert.match(source, /chrome\.runtime\.onMessage\.addListener/);
  assert.match(source, /chrome\.runtime\.onInstalled\.addListener/);
  assert.match(source, /requireEndpointPermission\s*\(\s*settings\.endpoint/);
  assert.match(source, /permissionPatternForEndpoint\s*\(\s*endpoint\s*\)/);
  assert.match(source, /chrome\.permissions\.contains\s*\(\s*\{\s*origins\s*\}\s*\)/);
  assert.match(source, /code:\s*["']PERMISSION["']/);

  const permissionCheck = source.indexOf("chrome.permissions.contains");
  const explanationRequest = source.indexOf("requestExplanation(settings");
  assert.ok(permissionCheck >= 0 && explanationRequest > permissionCheck);
});

test("background initializes trusted storage, sanitizes broadcasts, and cleans old permissions after successful saves", async () => {
  const previousChrome = globalThis.chrome;
  const previousFetch = globalThis.fetch;
  const writes = [];
  const permissionChecks = [];
  const removedPermissions = [];
  const sentMessages = [];
  const storageEvents = [];
  let messageListener;
  let installedListener;
  let storageChangedListener;
  let openOptionsCalls = 0;
  let fetchCalls = 0;
  let accessReady = false;
  let resolveAccess;
  let failNextSet = false;
  const accessGate = new Promise((resolve) => { resolveAccess = resolve; });
  let stored = {
    selectionExplainerSettings: {
      ...getDefaultSettings(),
      endpoint: "https://old.example.com/v1",
      apiKey: "secret-key",
      model: "test-model"
    }
  };

  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("requestExplanation must not run without permission");
  };
  globalThis.chrome = {
    storage: {
      local: {
        async setAccessLevel(details) {
          storageEvents.push(["access", details]);
          await accessGate;
          accessReady = true;
        },
        async get() {
          assert.equal(accessReady, true, "storage get must await TRUSTED_CONTEXTS initialization");
          storageEvents.push(["get"]);
          return stored;
        },
        async set(value) {
          assert.equal(accessReady, true, "storage set must await TRUSTED_CONTEXTS initialization");
          storageEvents.push(["set"]);
          if (failNextSet) {
            failNextSet = false;
            throw new Error("save failed");
          }
          writes.push(value);
          stored = value;
        }
      },
      onChanged: {
        addListener(listener) { storageChangedListener = listener; }
      }
    },
    tabs: {
      query: async (query) => {
        assert.deepEqual(query, {});
        return [{ id: 4 }, { id: 9 }, { id: undefined }];
      },
      sendMessage: async (tabId, message) => { sentMessages.push({ tabId, message }); }
    },
    permissions: {
      contains: async (details) => {
        permissionChecks.push(details);
        return details.origins[0] !== "https://old.example.com/*";
      },
      remove: async (details) => { removedPermissions.push(details); return true; }
    },
    runtime: {
      id: "test-extension-id",
      getURL: (path) => "chrome-extension://test/" + path,
      onMessage: { addListener(listener) { messageListener = listener; } },
      onInstalled: { addListener(listener) { installedListener = listener; } },
      openOptionsPage: async () => { openOptionsCalls += 1; }
    }
  };

  const send = (message, sender = {}) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("background did not respond")), 1000);
    const keepChannelOpen = messageListener(message, sender, (value) => {
      clearTimeout(timeout);
      resolve(value);
    });
    assert.equal(keepChannelOpen, true);
  });

  try {
    await import(backgroundUrl.href + "?test=" + Date.now());
    assert.equal(typeof messageListener, "function");
    assert.equal(typeof installedListener, "function");
    assert.equal(typeof storageChangedListener, "function");
    assert.deepEqual(storageEvents, [["access", { accessLevel: "TRUSTED_CONTEXTS" }]]);

    const pendingPermissionResponse = send({
      type: "EXPLAIN_SELECTION", text: "Selected text", promptProfileId: "profile-child", requestId: "permission-request"
    });
    await Promise.resolve();
    assert.deepEqual(storageEvents, [["access", { accessLevel: "TRUSTED_CONTEXTS" }]]);
    resolveAccess();
    const response = await pendingPermissionResponse;

    assert.deepEqual(permissionChecks, [{ origins: ["https://old.example.com/*"] }]);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(response, {
      ok: false,
      error: { code: "PERMISSION", message: "Grant access to the configured LiteLLM endpoint in Settings." },
      requestId: "permission-request"
    });

    const changedSettings = {
      ...getDefaultSettings(),
      enabled: false,
      endpoint: "https://proxy.example.com/v1",
      apiKey: "broadcast-secret",
      model: "private-model",
      webSearchEnabled: true,
      promptProfiles: [
        { id: "profile-private", title: "Private", prompt: "private prompt" },
        { id: "profile-second", title: "Second", prompt: "second private prompt" }
      ],
      activePromptProfileId: "profile-second"
    };
    await storageChangedListener({
      selectionExplainerSettings: { newValue: changedSettings }
    }, "local");
    assert.deepEqual(sentMessages, [4, 9].map((tabId) => ({
      tabId,
      message: {
        type: "PUBLIC_STATUS_CHANGED",
        enabled: false,
        configured: true,
        webSearchEnabled: true,
        activePromptProfileId: "profile-second",
        promptProfiles: [
          { id: "profile-private", title: "Private" },
          { id: "profile-second", title: "Second" }
        ]
      }
    })));
    assert.equal(JSON.stringify(sentMessages).includes("broadcast-secret"), false);
    assert.equal(JSON.stringify(sentMessages).includes("private-model"), false);
    assert.equal(JSON.stringify(sentMessages).includes("private prompt"), false);

    stored = { selectionExplainerSettings: { ...changedSettings, enabled: false } };
    const saveResponse = await send({
      type: "SAVE_CONFIGURATION",
      configuration: {
        endpoint: "https://new.example.com/v1",
        apiKey: "new-key",
        model: "new-model",
        webSearchEnabled: true,
        promptProfiles: [{ id: "profile-new", title: "New", prompt: "New private prompt" }],
        activePromptProfileId: "profile-new"
      }
    }, { id: "test-extension-id", url: "chrome-extension://test/options/options.html" });
    assert.deepEqual(saveResponse, { ok: true, enabled: false });
    assert.equal(JSON.stringify(saveResponse).includes("New private prompt"), false);
    assert.equal(stored.selectionExplainerSettings.enabled, false);
    assert.equal(stored.selectionExplainerSettings.endpoint, "https://new.example.com/v1");
    assert.equal(stored.selectionExplainerSettings.activePromptProfileId, "profile-new");
    assert.deepEqual(removedPermissions, [{ origins: ["https://proxy.example.com/*"] }]);

    failNextSet = true;
    const failedSave = await send({
      type: "SAVE_CONFIGURATION",
      configuration: {
        endpoint: "https://failed.example.com/v1",
        apiKey: "failed-key",
        model: "failed-model",
        webSearchEnabled: false,
        promptProfiles: [{ id: "profile-failed", title: "Failed", prompt: "Failed private prompt" }],
        activePromptProfileId: "profile-failed"
      }
    }, { id: "test-extension-id", url: "chrome-extension://test/options/options.html" });
    assert.equal(failedSave.ok, false);
    assert.equal(removedPermissions.length, 1, "old permission must remain when saving fails");

    stored = { selectionExplainerSettings: { enabled: "invalid" } };
    await installedListener({ reason: "install" });
    assert.deepEqual(writes.at(-1), { selectionExplainerSettings: getDefaultSettings() });
    assert.equal(openOptionsCalls, 1);
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});
