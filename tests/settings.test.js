import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SYSTEM_PROMPT,
  getDefaultSettings
} from "../shared/defaults.js";
import * as settingsModule from "../shared/settings.js";
import {
  isConfigurationReady,
  isLoopbackHostname,
  normalizeSettings,
  validateSettings
} from "../shared/settings.js";

test("defaults select the child level and contain prompt-injection guidance", () => {
  const settings = getDefaultSettings();
  assert.equal(settings.enabled, true);
  assert.equal(settings.level, "child");
  assert.equal(settings.model, "gpt-4o-mini");
  assert.equal(settings.webSearchEnabled, false);
  assert.match(DEFAULT_SYSTEM_PROMPT, /untrusted/i);
});

test("normalization discards unknown values without sharing the default object", () => {
  const first = normalizeSettings({ enabled: false, level: "engineer", webSearchEnabled: true, extra: 1 });
  const second = getDefaultSettings();
  assert.equal(first.enabled, false);
  assert.equal(first.level, "engineer");
  assert.equal(first.webSearchEnabled, true);
  assert.equal("extra" in first, false);
  first.model = "changed";
  assert.equal(second.model, "gpt-4o-mini");
});

test("validation requires endpoint key and model", () => {
  const result = validateSettings(normalizeSettings());
  assert.equal(result.valid, false);
  assert.deepEqual(Object.keys(result.errors).sort(), ["apiKey", "endpoint"]);
  assert.equal(isConfigurationReady(normalizeSettings()), false);
});

test("loopback detection accepts only explicit loopback names", () => {
  assert.equal(isLoopbackHostname("localhost"), true);
  assert.equal(isLoopbackHostname("127.0.0.1"), true);
  assert.equal(isLoopbackHostname("[::1]"), true);
  assert.equal(isLoopbackHostname("192.168.1.3"), false);
});


test("public status exposes only safe UI preferences", () => {
  assert.equal(typeof settingsModule.getPublicStatus, "function");
  const status = settingsModule.getPublicStatus({
    ...getDefaultSettings(),
    endpoint: "https://proxy.example.com",
    apiKey: "secret-key",
    model: "model",
    level: "engineer",
    webSearchEnabled: true
  });
  assert.deepEqual(status, { enabled: true, configured: true, level: "engineer", webSearchEnabled: true });
  assert.equal(JSON.stringify(status).includes("secret-key"), false);
});

test("serialized settings mutations merge against the latest stored value", async () => {
  assert.equal(typeof settingsModule.createSerializedSettingsWriter, "function");
  let stored = {
    ...getDefaultSettings(),
    endpoint: "https://old.example.com/v1",
    apiKey: "old-key",
    model: "old-model"
  };
  let releaseFirstSave;
  let firstSaveStartedResolve;
  const firstSaveStarted = new Promise((resolve) => { firstSaveStartedResolve = resolve; });
  const release = new Promise((resolve) => { releaseFirstSave = resolve; });
  let saveCalls = 0;
  const writer = settingsModule.createSerializedSettingsWriter({
    loadSettings: async () => ({ ...stored }),
    saveSettings: async (settings) => {
      saveCalls += 1;
      if (saveCalls === 1) {
        firstSaveStartedResolve();
        await release;
      }
      stored = { ...settings };
      return { ...stored };
    }
  });

  const configurationSave = writer.saveConfiguration({
    endpoint: "https://new.example.com/v1",
    apiKey: "new-key",
    model: "new-model",
    level: "engineer",
    systemPrompt: "New prompt",
    webSearchEnabled: true
  });
  await firstSaveStarted;
  const enabledSave = writer.setEnabled(false);
  releaseFirstSave();
  await Promise.all([configurationSave, enabledSave]);

  assert.equal(stored.enabled, false);
  assert.equal(stored.endpoint, "https://new.example.com/v1");
  assert.equal(stored.apiKey, "new-key");
  assert.equal(stored.model, "new-model");
  assert.equal(stored.level, "engineer");
  assert.equal(stored.systemPrompt, "New prompt");
  assert.equal(stored.webSearchEnabled, true);
  assert.equal(saveCalls, 2);
});


test("configuration preconditions run inside the serialized mutation queue", async () => {
  let stored = {
    ...getDefaultSettings(),
    endpoint: "https://old.example.com/v1",
    apiKey: "old-key"
  };
  let releaseFirstSave;
  let firstSaveStartedResolve;
  const firstSaveStarted = new Promise((resolve) => { firstSaveStartedResolve = resolve; });
  const release = new Promise((resolve) => { releaseFirstSave = resolve; });
  let saveCalls = 0;
  const events = [];
  const writer = settingsModule.createSerializedSettingsWriter({
    loadSettings: async () => ({ ...stored }),
    saveSettings: async (settings) => {
      saveCalls += 1;
      if (saveCalls === 1) {
        firstSaveStartedResolve();
        await release;
      }
      stored = { ...settings };
      return { ...stored };
    }
  });

  const toggle = writer.setEnabled(false);
  await firstSaveStarted;
  const configuration = writer.saveConfiguration({
    endpoint: "https://new.example.com/v1",
    apiKey: "new-key",
    model: "new-model",
    level: "child",
    systemPrompt: "Prompt"
  }, {
    beforeSave: async () => { events.push("permission-check"); }
  });
  await Promise.resolve();
  assert.deepEqual(events, []);
  releaseFirstSave();
  await Promise.all([toggle, configuration]);
  assert.deepEqual(events, ["permission-check"]);
});
