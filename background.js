import {
  permissionPatternForEndpoint,
  requestExplanation
} from "./shared/api.js";
import { createMessageHandler } from "./shared/controller.js";
import {
  createSerializedSettingsWriter,
  getPublicStatus,
  loadSettings,
  saveSettings
} from "./shared/settings.js";
import { SETTINGS_STORAGE_KEY } from "./shared/defaults.js";

const PERMISSION_ERROR = Object.freeze({
  code: "PERMISSION",
  message: "Grant access to the configured LiteLLM endpoint in Settings."
});

const storageAccessReady = Promise.resolve(
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
);

async function loadWorkerSettings() {
  await storageAccessReady;
  return loadSettings(chrome.storage.local);
}

async function saveWorkerSettings(settings) {
  await storageAccessReady;
  return saveSettings(chrome.storage.local, settings);
}

async function removeSupersededPermission({ previous, saved }) {
  if (!previous.endpoint || !saved.endpoint) return;
  let previousOrigin;
  let savedOrigin;
  try {
    previousOrigin = permissionPatternForEndpoint(previous.endpoint);
    savedOrigin = permissionPatternForEndpoint(saved.endpoint);
  } catch {
    return;
  }
  if (previousOrigin === savedOrigin) return;
  try {
    await chrome.permissions.remove({ origins: [previousOrigin] });
  } catch {
    // The saved configuration remains valid even if Chrome cannot drop stale access.
  }
}

const settingsWriter = createSerializedSettingsWriter({
  loadSettings: loadWorkerSettings,
  saveSettings: saveWorkerSettings,
  afterConfigurationSaved: removeSupersededPermission
});

function isTrustedOptionsSender(sender) {
  return sender?.id === chrome.runtime.id
    && sender?.url === chrome.runtime.getURL("options/options.html");
}

async function requireEndpointPermission(endpoint, onPermissionDenied) {
  const origins = [permissionPatternForEndpoint(endpoint)];
  const allowed = await chrome.permissions.contains({ origins });
  if (!allowed) {
    onPermissionDenied();
    throw new Error(PERMISSION_ERROR.message);
  }
}

function createDependencies(onPermissionDenied) {
  return {
    loadSettings: loadWorkerSettings,
    saveEnabled: (enabled) => settingsWriter.setEnabled(enabled),
    saveConfiguration: (configuration) => settingsWriter.saveConfiguration(
      configuration,
      {
        beforeSave: () => requireEndpointPermission(
          configuration.endpoint,
          onPermissionDenied
        )
      }
    ),
    explain: async (settings, text, level, webSearchEnabled = false) => {
      await requireEndpointPermission(settings.endpoint, onPermissionDenied);
      return requestExplanation(settings, text, level, { webSearchEnabled });
    },
    openOptions: () => chrome.runtime.openOptionsPage(),
    isTrustedOptionsSender
  };
}

async function handleRuntimeMessage(message, sender) {
  let permissionDenied = false;
  const handleMessage = createMessageHandler(createDependencies(() => {
    permissionDenied = true;
  }));
  const response = await handleMessage(message, sender);
  if (!permissionDenied) return response;

  const permissionResponse = { ok: false, error: { ...PERMISSION_ERROR } };
  if (response.requestId !== undefined) permissionResponse.requestId = response.requestId;
  return permissionResponse;
}

async function broadcastPublicStatus(rawSettings) {
  const status = getPublicStatus(rawSettings);
  const message = { type: "PUBLIC_STATUS_CHANGED", ...status };
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs
    .filter((tab) => Number.isInteger(tab.id))
    .map((tab) => chrome.tabs.sendMessage(tab.id, message)));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleRuntimeMessage(message, sender).then(sendResponse);
  return true;
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (
    areaName !== "local"
    || !changes
    || !Object.prototype.hasOwnProperty.call(changes, SETTINGS_STORAGE_KEY)
  ) return;
  const rawSettings = changes[SETTINGS_STORAGE_KEY]?.newValue ?? {};
  await broadcastPublicStatus(rawSettings);
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const settings = await settingsWriter.normalizeStoredSettings();
  if (reason === "install" && (!settings.endpoint || !settings.apiKey)) {
    await chrome.runtime.openOptionsPage();
  }
});
