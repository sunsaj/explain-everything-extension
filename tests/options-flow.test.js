import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEndpoint, permissionPatternForEndpoint } from "../shared/api.js";
import { normalizeSettings, validateSettings } from "../shared/settings.js";
import { grantAndSaveSettings } from "../options/save-flow.js";
import * as saveFlow from "../options/save-flow.js";

const candidate = normalizeSettings({
  enabled: true,
  endpoint: "https://proxy.example.com/v1",
  apiKey: "candidate-key",
  model: "candidate-model",
  webSearchEnabled: true,
  promptProfiles: [
    {
      id: "profile-simple",
      title: "Simple",
      prompt: "Explain this candidate simply."
    },
    {
      id: "profile-engineer",
      title: "Engineer",
      prompt: "Explain this candidate precisely."
    }
  ],
  activePromptProfileId: "profile-engineer"
});

function dependencies(overrides = {}) {
  return {
    validateSettings,
    normalizeEndpoint,
    permissionPatternForEndpoint,
    requestPermission: () => Promise.resolve(true),
    saveConfiguration: () => Promise.resolve({ ok: true, enabled: false }),
    ...overrides
  };
}

test("invalid settings stop before permission or worker save", async () => {
  const invalidCandidate = {
    ...candidate,
    promptProfiles: [{ ...candidate.promptProfiles[0], title: "" }]
  };
  const result = await grantAndSaveSettings(invalidCandidate, dependencies({
    requestPermission() { throw new Error("permission must not run"); },
    saveConfiguration() { throw new Error("save must not run"); }
  }));

  assert.equal(result.ok, false);
  assert.equal(result.validation.valid, false);
  assert.equal(
    result.validation.errors["promptProfiles.0.title"],
    "Enter a profile title."
  );
});

test("permission denial performs no worker save", async () => {
  const calls = [];
  const result = await grantAndSaveSettings(candidate, dependencies({
    requestPermission(details) { calls.push(["permission", details]); return Promise.resolve(false); },
    saveConfiguration() { calls.push(["save"]); throw new Error("save must not run"); }
  }));

  assert.deepEqual(result, { ok: false, permissionDenied: true });
  assert.deepEqual(calls, [["permission", { origins: ["https://proxy.example.com/*"] }]]);
});

test("permission request starts synchronously before the worker save", async () => {
  const events = [];
  let resolvePermission;
  const permissionResult = new Promise((resolve) => { resolvePermission = resolve; });
  const operation = grantAndSaveSettings(candidate, dependencies({
    requestPermission() { events.push("permission"); return permissionResult; },
    async saveConfiguration() { events.push("save"); return { ok: true, enabled: false }; }
  }));

  assert.deepEqual(events, ["permission"]);
  resolvePermission(true);
  await operation;
  assert.deepEqual(events, ["permission", "save"]);
});

test("successful save sends the complete atomic profile configuration and uses worker-owned enabled state", async () => {
  let savedConfiguration;
  const result = await grantAndSaveSettings({ ...candidate, extra: "ignored" }, dependencies({
    saveConfiguration: async (configuration) => {
      savedConfiguration = configuration;
      return { ok: true, enabled: false };
    }
  }));

  assert.deepEqual(savedConfiguration, {
    endpoint: candidate.endpoint,
    apiKey: candidate.apiKey,
    model: candidate.model,
    webSearchEnabled: candidate.webSearchEnabled,
    promptProfiles: candidate.promptProfiles,
    activePromptProfileId: candidate.activePromptProfileId
  });
  assert.deepEqual(result, { ok: true, settings: { ...candidate, enabled: false } });
});

test("worker save failures reject without claiming settings were saved", async () => {
  await assert.rejects(
    grantAndSaveSettings(candidate, dependencies({
      saveConfiguration: async () => ({
        ok: false,
        error: { code: "UNKNOWN", message: "Could not save settings." }
      })
    })),
    /Could not save settings/
  );
});

test("configuration controls stay locked until a trusted configuration load succeeds", () => {
  assert.equal(typeof saveFlow.configurationControlsLocked, "function");
  const controlsLocked = saveFlow.configurationControlsLocked;

  assert.equal(controlsLocked({ loading: true, busy: false, configurationLoaded: false }), true);
  assert.equal(controlsLocked({ loading: false, busy: true, configurationLoaded: true }), true);
  assert.equal(controlsLocked({ loading: false, busy: false, configurationLoaded: false }), true);
  assert.equal(controlsLocked({ loading: false, busy: false, configurationLoaded: true }), false);
});
