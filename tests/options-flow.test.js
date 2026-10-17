import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEndpoint, permissionPatternForEndpoint } from "../shared/api.js";
import { normalizeSettings, validateSettings } from "../shared/settings.js";
import { grantAndSaveSettings } from "../options/save-flow.js";

const candidate = normalizeSettings({
  enabled: true,
  endpoint: "https://proxy.example.com/v1",
  apiKey: "candidate-key",
  model: "candidate-model",
  level: "engineer",
  webSearchEnabled: true,
  systemPrompt: "Explain this candidate."
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
  const invalidCandidate = normalizeSettings({ endpoint: "", apiKey: "" });
  const result = await grantAndSaveSettings(invalidCandidate, dependencies({
    requestPermission() { throw new Error("permission must not run"); },
    saveConfiguration() { throw new Error("save must not run"); }
  }));

  assert.equal(result.ok, false);
  assert.equal(result.validation.valid, false);
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

test("successful save sends only configuration fields and uses worker-owned enabled state", async () => {
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
    level: candidate.level,
    webSearchEnabled: candidate.webSearchEnabled,
    systemPrompt: candidate.systemPrompt
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
