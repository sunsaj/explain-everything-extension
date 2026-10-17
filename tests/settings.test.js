import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ACTIVE_PROMPT_PROFILE_ID,
  DEFAULT_PROMPT_PROFILES,
  DEFAULT_SYSTEM_PROMPT,
  SETTINGS_VERSION,
  getDefaultSettings
} from "../shared/defaults.js";
import * as settingsModule from "../shared/settings.js";
import {
  isConfigurationReady,
  isLoopbackHostname,
  normalizeSettings,
  validateSettings
} from "../shared/settings.js";

function configuredSettings(overrides = {}) {
  return {
    ...getDefaultSettings(),
    endpoint: "https://proxy.example.com/v1",
    apiKey: "secret-key",
    model: "model",
    ...overrides
  };
}

test("defaults use schema v3 prompt profiles without sharing nested data", () => {
  const first = getDefaultSettings();
  const second = getDefaultSettings();

  assert.equal(SETTINGS_VERSION, 3);
  assert.equal(first.settingsVersion, 3);
  assert.equal(first.enabled, true);
  assert.equal(first.model, "gpt-4o-mini");
  assert.equal(first.webSearchEnabled, false);
  assert.deepEqual(first.promptProfiles, DEFAULT_PROMPT_PROFILES);
  assert.equal(first.activePromptProfileId, DEFAULT_ACTIVE_PROMPT_PROFILE_ID);
  assert.equal("level" in first, false);
  assert.equal("systemPrompt" in first, false);
  assert.match(DEFAULT_SYSTEM_PROMPT, /untrusted/i);

  first.promptProfiles[0].title = "Changed";
  assert.equal(second.promptProfiles[0].title, "10-year-old");
});

test("schema v2 migration preserves global settings and edited prompt", () => {
  const migrated = normalizeSettings({
    settingsVersion: 2,
    enabled: false,
    level: "engineer",
    systemPrompt: "My existing instructions.",
    endpoint: " https://proxy.example.com/v1 ",
    apiKey: " key ",
    model: " custom-model ",
    webSearchEnabled: true
  });

  assert.equal(migrated.settingsVersion, 3);
  assert.equal(migrated.enabled, false);
  assert.equal(migrated.endpoint, "https://proxy.example.com/v1");
  assert.equal(migrated.apiKey, "key");
  assert.equal(migrated.model, "custom-model");
  assert.equal(migrated.webSearchEnabled, true);
  assert.deepEqual(migrated.promptProfiles.map((item) => item.title), ["10-year-old", "Engineer"]);
  assert.deepEqual(migrated.promptProfiles.map((item) => item.id), ["profile-child", "profile-engineer"]);
  assert.match(migrated.promptProfiles[0].prompt, /My existing instructions\./);
  assert.match(migrated.promptProfiles[1].prompt, /My existing instructions\./);
  assert.equal(migrated.activePromptProfileId, "profile-engineer");
  assert.equal("level" in migrated, false);
  assert.equal("systemPrompt" in migrated, false);
});

test("schema v1 and unversioned migrations are deterministic", () => {
  const legacy = {
    settingsVersion: 1,
    level: "child",
    systemPrompt: "Legacy prompt."
  };
  const first = normalizeSettings(legacy);
  const second = normalizeSettings(legacy);
  const unversioned = normalizeSettings({ level: "child", systemPrompt: "Legacy prompt." });

  assert.deepEqual(first, second);
  assert.deepEqual(first.promptProfiles, unversioned.promptProfiles);
  assert.equal(first.activePromptProfileId, "profile-child");
});

test("schema v3 normalization is idempotent and preserves profile IDs and order", () => {
  const raw = {
    settingsVersion: 3,
    enabled: false,
    endpoint: "https://proxy.example.com/v1",
    apiKey: "key",
    model: "model",
    webSearchEnabled: true,
    activePromptProfileId: "custom-first",
    promptProfiles: [
      { id: "custom-second", title: " Second ", prompt: " Second prompt. ", unknown: "discard" },
      { id: "custom-first", title: "First", prompt: "First prompt.", extra: true }
    ],
    level: "engineer",
    systemPrompt: "discard",
    unknownSetting: true
  };
  const once = normalizeSettings(raw);
  const twice = normalizeSettings(once);

  assert.deepEqual(once, twice);
  assert.deepEqual(once.promptProfiles, [
    { id: "custom-second", title: "Second", prompt: " Second prompt. " },
    { id: "custom-first", title: "First", prompt: "First prompt." }
  ]);
  assert.equal(once.activePromptProfileId, "custom-first");
  assert.equal("level" in once, false);
  assert.equal("systemPrompt" in once, false);
  assert.equal("unknownSetting" in once, false);
});

test("invalid stored v3 profiles fall back together while global settings survive", () => {
  const raw = configuredSettings({
    activePromptProfileId: "duplicate-two",
    promptProfiles: [
      { id: "duplicate-one", title: "Same", prompt: "First private prompt." },
      { id: "duplicate-two", title: " same ", prompt: "Second private prompt." }
    ]
  });
  const normalized = normalizeSettings(raw);

  assert.deepEqual(normalized.promptProfiles, DEFAULT_PROMPT_PROFILES);
  assert.equal(normalized.activePromptProfileId, DEFAULT_ACTIVE_PROMPT_PROFILE_ID);
  assert.equal(normalized.endpoint, "https://proxy.example.com/v1");
  assert.equal(normalized.apiKey, "secret-key");
  assert.equal(JSON.stringify(normalized).includes("private prompt"), false);
});

test("validation requires endpoint key and model", () => {
  const result = validateSettings(normalizeSettings());
  assert.equal(result.valid, false);
  assert.deepEqual(Object.keys(result.errors).sort(), ["apiKey", "endpoint"]);
  assert.equal(isConfigurationReady(normalizeSettings()), false);
});

test("settings validation reports malformed profiles and dangling active IDs", () => {
  const result = validateSettings(configuredSettings({
    activePromptProfileId: "missing",
    promptProfiles: [
      { id: "bad id", title: "", prompt: "" }
    ]
  }));

  assert.equal(result.valid, false);
  assert.match(result.errors["promptProfiles.0.id"], /letters|numbers/i);
  assert.match(result.errors["promptProfiles.0.title"], /title/i);
  assert.match(result.errors["promptProfiles.0.prompt"], /prompt/i);
  assert.match(result.errors.activePromptProfileId, /existing/i);
});

test("loopback detection accepts only explicit loopback names", () => {
  assert.equal(isLoopbackHostname("localhost"), true);
  assert.equal(isLoopbackHostname("127.0.0.1"), true);
  assert.equal(isLoopbackHostname("[::1]"), true);
  assert.equal(isLoopbackHostname("192.168.1.3"), false);
});

test("public status exposes profile summaries without credentials or prompts", () => {
  assert.equal(typeof settingsModule.getPublicStatus, "function");
  const status = settingsModule.getPublicStatus(configuredSettings({
    webSearchEnabled: true,
    activePromptProfileId: "deep",
    promptProfiles: [
      { id: "simple", title: "Simple", prompt: "Private simple instructions." },
      { id: "deep", title: "Deep", prompt: "Private deep instructions." }
    ]
  }));

  assert.deepEqual(status, {
    enabled: true,
    configured: true,
    webSearchEnabled: true,
    activePromptProfileId: "deep",
    promptProfiles: [
      { id: "simple", title: "Simple" },
      { id: "deep", title: "Deep" }
    ]
  });
  assert.doesNotMatch(JSON.stringify(status), /secret-key|Private .* instructions/);
});

test("serialized settings mutations merge profile configuration against the latest value", async () => {
  assert.equal(typeof settingsModule.createSerializedSettingsWriter, "function");
  let stored = configuredSettings({
    endpoint: "https://old.example.com/v1",
    apiKey: "old-key",
    model: "old-model"
  });
  let releaseFirstSave;
  let firstSaveStartedResolve;
  const firstSaveStarted = new Promise((resolve) => { firstSaveStartedResolve = resolve; });
  const release = new Promise((resolve) => { releaseFirstSave = resolve; });
  let saveCalls = 0;
  const writer = settingsModule.createSerializedSettingsWriter({
    loadSettings: async () => ({ ...stored, promptProfiles: stored.promptProfiles.map((item) => ({ ...item })) }),
    saveSettings: async (settings) => {
      saveCalls += 1;
      if (saveCalls === 1) {
        firstSaveStartedResolve();
        await release;
      }
      stored = { ...settings, promptProfiles: settings.promptProfiles.map((item) => ({ ...item })) };
      return { ...stored, promptProfiles: stored.promptProfiles.map((item) => ({ ...item })) };
    }
  });

  const configurationSave = writer.saveConfiguration({
    endpoint: "https://new.example.com/v1",
    apiKey: "new-key",
    model: "new-model",
    webSearchEnabled: true,
    activePromptProfileId: "custom",
    promptProfiles: [
      { id: "custom", title: "Custom", prompt: "New private prompt." }
    ]
  });
  await firstSaveStarted;
  const enabledSave = writer.setEnabled(false);
  releaseFirstSave();
  await Promise.all([configurationSave, enabledSave]);

  assert.equal(stored.enabled, false);
  assert.equal(stored.endpoint, "https://new.example.com/v1");
  assert.equal(stored.apiKey, "new-key");
  assert.equal(stored.model, "new-model");
  assert.equal(stored.webSearchEnabled, true);
  assert.equal(stored.activePromptProfileId, "custom");
  assert.deepEqual(stored.promptProfiles, [
    { id: "custom", title: "Custom", prompt: "New private prompt." }
  ]);
  assert.equal("level" in stored, false);
  assert.equal("systemPrompt" in stored, false);
  assert.equal(saveCalls, 2);
});

test("configuration preconditions run inside the serialized mutation queue", async () => {
  let stored = configuredSettings({
    endpoint: "https://old.example.com/v1",
    apiKey: "old-key"
  });
  let releaseFirstSave;
  let firstSaveStartedResolve;
  const firstSaveStarted = new Promise((resolve) => { firstSaveStartedResolve = resolve; });
  const release = new Promise((resolve) => { releaseFirstSave = resolve; });
  let saveCalls = 0;
  const events = [];
  const writer = settingsModule.createSerializedSettingsWriter({
    loadSettings: async () => ({ ...stored, promptProfiles: stored.promptProfiles.map((item) => ({ ...item })) }),
    saveSettings: async (settings) => {
      saveCalls += 1;
      if (saveCalls === 1) {
        firstSaveStartedResolve();
        await release;
      }
      stored = { ...settings, promptProfiles: settings.promptProfiles.map((item) => ({ ...item })) };
      return { ...stored, promptProfiles: stored.promptProfiles.map((item) => ({ ...item })) };
    }
  });

  const toggle = writer.setEnabled(false);
  await firstSaveStarted;
  const configuration = writer.saveConfiguration({
    endpoint: "https://new.example.com/v1",
    apiKey: "new-key",
    model: "new-model",
    webSearchEnabled: false,
    activePromptProfileId: "custom",
    promptProfiles: [
      { id: "custom", title: "Custom", prompt: "Prompt" }
    ]
  }, {
    beforeSave: async () => { events.push("permission-check"); }
  });
  await Promise.resolve();
  assert.deepEqual(events, []);
  releaseFirstSave();
  await Promise.all([toggle, configuration]);
  assert.deepEqual(events, ["permission-check"]);
});

test("explicit schema v1 and v2 values always use legacy migration", () => {
  const migrated = normalizeSettings({
    settingsVersion: 2,
    level: "engineer",
    systemPrompt: "Preserve this legacy prompt.",
    promptProfiles: [{ id: "stray", title: "Stray", prompt: "Ignore this." }],
    activePromptProfileId: "stray"
  });

  assert.equal(migrated.activePromptProfileId, "profile-engineer");
  assert.match(migrated.promptProfiles[0].prompt, /Preserve this legacy prompt\./);
  assert.deepEqual(migrated.promptProfiles.map((item) => item.id), ["profile-child", "profile-engineer"]);
});

test("very long legacy prompts and complete audience suffixes survive repeated normalization", () => {
  const legacyPrompt = "  BEGIN\n" + "Legacy detail. ".repeat(5_000) + "\nEND  ";
  const childSuffix = "Audience: a 10-year-old school student. Use simple words, short sentences, concrete analogies, definitions for necessary jargon, and a small example.";
  const engineerSuffix = "Audience: engineer. Use precise terminology, mechanisms, assumptions, tradeoffs, edge cases, and a technical example when useful.";
  const migrated = normalizeSettings({
    settingsVersion: 2,
    level: "engineer",
    systemPrompt: legacyPrompt,
    endpoint: "https://proxy.example.com/v1",
    apiKey: "key"
  });

  assert.deepEqual(migrated.promptProfiles.map((item) => item.prompt), [
    legacyPrompt + "\n\n" + childSuffix,
    legacyPrompt + "\n\n" + engineerSuffix
  ]);
  assert.equal(migrated.activePromptProfileId, "profile-engineer");
  assert.equal(validateSettings(migrated).valid, true);
  assert.deepEqual(normalizeSettings(migrated), migrated);
  assert.deepEqual(normalizeSettings(normalizeSettings(migrated)), migrated);
});

test("multi-megabyte legacy migration retains both complete prompt copies", () => {
  const legacyPrompt = "L".repeat(3_000_000);
  const legacy = {
    settingsVersion: 2,
    level: "engineer",
    systemPrompt: legacyPrompt,
    endpoint: "https://proxy.example.com/v1",
    apiKey: "key"
  };
  const migrated = normalizeSettings(legacy);

  assert.equal(migrated.promptProfiles.length, 2);
  for (const profile of migrated.promptProfiles) {
    assert.equal(profile.prompt.slice(0, legacyPrompt.length), legacyPrompt);
    assert.ok(profile.prompt.length > legacyPrompt.length);
  }
  assert.ok(JSON.stringify(migrated).length > JSON.stringify(legacy).length * 1.9);
  assert.deepEqual(normalizeSettings(migrated), migrated);
});
