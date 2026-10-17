import {
  DEFAULT_ACTIVE_PROMPT_PROFILE_ID,
  DEFAULT_PROMPT_PROFILES,
  DEFAULT_SYSTEM_PROMPT,
  SETTINGS_STORAGE_KEY,
  SETTINGS_VERSION,
  getDefaultSettings
} from "./defaults.js";
import {
  normalizePromptProfiles,
  promptProfileSummaries,
  validatePromptProfiles
} from "./profiles.js";

function settingsObject(raw) {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function usesPromptProfileSchema(raw) {
  if (raw.settingsVersion === 1 || raw.settingsVersion === 2) return false;
  return raw.settingsVersion >= SETTINGS_VERSION
    || Object.hasOwn(raw, "promptProfiles")
    || Object.hasOwn(raw, "activePromptProfileId");
}

function combineMigratedPrompt(basePrompt, audienceInstructions) {
  return basePrompt + "\n\n" + audienceInstructions;
}

function migratedPromptProfiles(raw) {
  const basePrompt = typeof raw.systemPrompt === "string" && raw.systemPrompt.trim()
    ? raw.systemPrompt
    : DEFAULT_SYSTEM_PROMPT;

  return DEFAULT_PROMPT_PROFILES.map(({ id, title, prompt }) => {
    const audienceInstructions = prompt.startsWith(DEFAULT_SYSTEM_PROMPT)
      ? prompt.slice(DEFAULT_SYSTEM_PROMPT.length).trim()
      : prompt;
    return {
      id,
      title,
      prompt: combineMigratedPrompt(basePrompt, audienceInstructions)
    };
  });
}

function normalizedProfileSettings(raw) {
  if (!usesPromptProfileSchema(raw)) {
    return {
      promptProfiles: migratedPromptProfiles(raw),
      activePromptProfileId: raw.level === "engineer"
        ? "profile-engineer"
        : DEFAULT_ACTIVE_PROMPT_PROFILE_ID
    };
  }

  const validation = validatePromptProfiles(
    raw.promptProfiles,
    raw.activePromptProfileId
  );
  if (!validation.valid) {
    const defaults = getDefaultSettings();
    return {
      promptProfiles: defaults.promptProfiles,
      activePromptProfileId: defaults.activePromptProfileId
    };
  }

  return {
    promptProfiles: normalizePromptProfiles(raw.promptProfiles),
    activePromptProfileId: raw.activePromptProfileId
  };
}

export function isLoopbackHostname(hostname) {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(
    String(hostname).toLowerCase()
  );
}

export function normalizeSettings(raw = {}) {
  const source = settingsObject(raw);
  const defaults = getDefaultSettings();
  const profiles = normalizedProfileSettings(source);
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : defaults.enabled,
    endpoint: typeof source.endpoint === "string" ? source.endpoint.trim() : "",
    apiKey: typeof source.apiKey === "string" ? source.apiKey.trim() : "",
    model: typeof source.model === "string" && source.model.trim()
      ? source.model.trim()
      : defaults.model,
    webSearchEnabled: typeof source.webSearchEnabled === "boolean"
      ? source.webSearchEnabled
      : defaults.webSearchEnabled,
    promptProfiles: profiles.promptProfiles,
    activePromptProfileId: profiles.activePromptProfileId,
    settingsVersion: SETTINGS_VERSION
  };
}

export function validateSettings(settings) {
  const source = settingsObject(settings);
  const value = normalizeSettings(source);
  const errors = {};
  if (!value.endpoint) errors.endpoint = "Enter the LiteLLM URL.";
  if (!value.apiKey) errors.apiKey = "Enter an API key.";
  if (!value.model) errors.model = "Enter a model name or LiteLLM alias.";
  if (value.endpoint) {
    try {
      const url = new URL(value.endpoint);
      if (!["https:", "http:"].includes(url.protocol)) {
        errors.endpoint = "Use an HTTP or HTTPS URL.";
      } else if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
        errors.endpoint = "Remote endpoints must use HTTPS.";
      }
    } catch {
      errors.endpoint = "Enter a valid URL.";
    }
  }

  if (usesPromptProfileSchema(source)) {
    Object.assign(
      errors,
      validatePromptProfiles(
        source.promptProfiles,
        source.activePromptProfileId
      ).errors
    );
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export function isConfigurationReady(settings) {
  return validateSettings(settings).valid;
}

export async function loadSettings(storageArea) {
  const stored = await storageArea.get(SETTINGS_STORAGE_KEY);
  return normalizeSettings(stored[SETTINGS_STORAGE_KEY]);
}

export async function saveSettings(storageArea, settings) {
  const normalized = normalizeSettings(settings);
  await storageArea.set({ [SETTINGS_STORAGE_KEY]: normalized });
  return normalized;
}

export function getPublicStatus(settings) {
  const normalized = normalizeSettings(settings);
  return {
    enabled: normalized.enabled,
    configured: isConfigurationReady(normalized),
    webSearchEnabled: normalized.webSearchEnabled,
    activePromptProfileId: normalized.activePromptProfileId,
    promptProfiles: promptProfileSummaries(normalized.promptProfiles)
  };
}

export function createSerializedSettingsWriter({
  loadSettings: loadLatestSettings,
  saveSettings: persistSettings,
  afterConfigurationSaved = async () => {}
}) {
  let mutationQueue = Promise.resolve();

  function enqueue(mutation) {
    const operation = mutationQueue.then(mutation);
    mutationQueue = operation.catch(() => {});
    return operation;
  }

  return {
    normalizeStoredSettings() {
      return enqueue(async () => {
        const current = normalizeSettings(await loadLatestSettings());
        return persistSettings(current);
      });
    },

    setEnabled(enabled) {
      return enqueue(async () => {
        const current = normalizeSettings(await loadLatestSettings());
        return persistSettings({ ...current, enabled });
      });
    },

    saveConfiguration(configuration, { beforeSave = async () => {} } = {}) {
      return enqueue(async () => {
        const previous = normalizeSettings(await loadLatestSettings());
        await beforeSave({ previous, configuration });
        const saved = await persistSettings({
          ...previous,
          ...configuration,
          enabled: previous.enabled
        });
        await afterConfigurationSaved({
          previous,
          saved: normalizeSettings(saved)
        });
        return normalizeSettings(saved);
      });
    }
  };
}
