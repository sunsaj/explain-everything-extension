import {
  DEFAULT_SYSTEM_PROMPT,
  SETTINGS_STORAGE_KEY,
  SETTINGS_VERSION,
  getDefaultSettings
} from "./defaults.js";

export function isLoopbackHostname(hostname) {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(
    String(hostname).toLowerCase()
  );
}

export function normalizeSettings(raw = {}) {
  const defaults = getDefaultSettings();
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : defaults.enabled,
    endpoint: typeof raw.endpoint === "string" ? raw.endpoint.trim() : "",
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey.trim() : "",
    model: typeof raw.model === "string" && raw.model.trim()
      ? raw.model.trim()
      : defaults.model,
    level: raw.level === "engineer" ? "engineer" : "child",
    webSearchEnabled: typeof raw.webSearchEnabled === "boolean"
      ? raw.webSearchEnabled
      : defaults.webSearchEnabled,
    systemPrompt: typeof raw.systemPrompt === "string" && raw.systemPrompt.trim()
      ? raw.systemPrompt.trim()
      : DEFAULT_SYSTEM_PROMPT,
    settingsVersion: SETTINGS_VERSION
  };
}

export function validateSettings(settings) {
  const value = normalizeSettings(settings);
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
    level: normalized.level,
    webSearchEnabled: normalized.webSearchEnabled
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
