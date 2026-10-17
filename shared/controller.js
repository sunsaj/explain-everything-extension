import { getSafeRequestErrorDetails } from "./api.js";
import { getPublicStatus, isConfigurationReady, normalizeSettings, validateSettings } from "./settings.js";
import { validateSelectedText } from "./selection.js";

const CONNECTION_TEST_SAMPLE = "A triangle has three sides.";
const VALID_LEVELS = new Set(["child", "engineer"]);

const CONTROLLER_ERROR_DEFINITIONS = Object.freeze({
  INVALID_MESSAGE: Object.freeze({ code: "BAD_MESSAGE", message: "Invalid extension message." }),
  UNKNOWN_MESSAGE: Object.freeze({ code: "BAD_MESSAGE", message: "Unknown extension message." }),
  BAD_ENABLED: Object.freeze({ code: "BAD_MESSAGE", message: "Enabled must be boolean." }),
  BAD_REQUEST_ID: Object.freeze({ code: "BAD_MESSAGE", message: "Request ID must be a non-empty string." }),
  BAD_CONFIGURATION: Object.freeze({ code: "BAD_MESSAGE", message: "Invalid configuration." }),
  FORBIDDEN: Object.freeze({ code: "FORBIDDEN", message: "This message is not allowed from this context." }),
  NO_SELECTION: Object.freeze({ code: "NO_SELECTION", message: "Highlight some text first." }),
  SELECTION_TOO_LONG: Object.freeze({ code: "SELECTION_TOO_LONG", message: "Select no more than 20,000 characters." }),
  BAD_LEVEL: Object.freeze({ code: "BAD_LEVEL", message: "Invalid explanation level." }),
  BAD_WEB_SEARCH: Object.freeze({ code: "BAD_MESSAGE", message: "Web search flag must be boolean." }),
  DISABLED: Object.freeze({ code: "DISABLED", message: "The extension is disabled." }),
  NOT_CONFIGURED: Object.freeze({ code: "NOT_CONFIGURED", message: "Configure the LiteLLM endpoint, key, and model first." }),
  UNKNOWN: Object.freeze({ code: "UNKNOWN", message: "The extension could not complete the request. Retry or open settings." })
});

const safeControllerErrors = new WeakMap();

function createControllerError(kind) {
  const definition = CONTROLLER_ERROR_DEFINITIONS[kind];
  if (!definition) throw new TypeError("Unknown internal controller error.");
  const error = Object.assign(new Error(definition.message), { code: definition.code });
  safeControllerErrors.set(error, definition);
  return error;
}

function getPublicErrorDetails(error) {
  return safeControllerErrors.get(error)
    ?? getSafeRequestErrorDetails(error)
    ?? CONTROLLER_ERROR_DEFINITIONS.UNKNOWN;
}

function failure(error, requestId) {
  const details = getPublicErrorDetails(error);
  const response = { ok: false, error: { code: details.code, message: details.message } };
  if (requestId !== undefined) response.requestId = requestId;
  return response;
}

function selectionErrorKind(code) {
  if (code === "NO_SELECTION") return "NO_SELECTION";
  if (code === "SELECTION_TOO_LONG") return "SELECTION_TOO_LONG";
  return "UNKNOWN";
}

function configurationFromMessage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createControllerError("BAD_CONFIGURATION");
  }
  const configuration = {
    endpoint: value.endpoint,
    apiKey: value.apiKey,
    model: value.model,
    level: value.level,
    systemPrompt: value.systemPrompt,
    webSearchEnabled: value.webSearchEnabled
  };
  if (
    typeof configuration.endpoint !== "string"
    || typeof configuration.apiKey !== "string"
    || typeof configuration.model !== "string"
    || typeof configuration.systemPrompt !== "string"
    || typeof configuration.webSearchEnabled !== "boolean"
    || !VALID_LEVELS.has(configuration.level)
    || !configuration.endpoint.trim()
    || !configuration.apiKey.trim()
    || !configuration.model.trim()
  ) {
    throw createControllerError("BAD_CONFIGURATION");
  }
  const normalized = normalizeSettings({ enabled: true, ...configuration });
  if (!validateSettings(normalized).valid) {
    throw createControllerError("BAD_CONFIGURATION");
  }
  return {
    endpoint: normalized.endpoint,
    apiKey: normalized.apiKey,
    model: normalized.model,
    level: normalized.level,
    systemPrompt: normalized.systemPrompt,
    webSearchEnabled: normalized.webSearchEnabled
  };
}

export function createMessageHandler({
  loadSettings,
  saveEnabled,
  saveConfiguration = async () => { throw new Error("Configuration saving unavailable."); },
  explain,
  openOptions,
  isTrustedOptionsSender = () => false
}) {
  return async function handleMessage(message, sender) {
    let requestId;
    try {
      if (!message || typeof message.type !== "string") {
        throw createControllerError("INVALID_MESSAGE");
      }
      if (message.type === "GET_STATUS") {
        return { ok: true, ...getPublicStatus(await loadSettings()) };
      }
      if (message.type === "GET_CONFIGURATION") {
        if (!isTrustedOptionsSender(sender)) throw createControllerError("FORBIDDEN");
        return { ok: true, settings: normalizeSettings(await loadSettings()) };
      }
      if (message.type === "SET_ENABLED") {
        if (typeof message.enabled !== "boolean") throw createControllerError("BAD_ENABLED");
        const saved = await saveEnabled(message.enabled);
        return {
          ok: true,
          enabled: typeof saved?.enabled === "boolean" ? saved.enabled : message.enabled
        };
      }
      if (message.type === "OPEN_OPTIONS") {
        await openOptions();
        return { ok: true };
      }
      if (message.type === "SAVE_CONFIGURATION") {
        if (!isTrustedOptionsSender(sender)) throw createControllerError("FORBIDDEN");
        const saved = normalizeSettings(await saveConfiguration(
          configurationFromMessage(message.configuration)
        ));
        return { ok: true, enabled: saved.enabled };
      }
      if (message.type === "TEST_CONNECTION") {
        if (!isTrustedOptionsSender(sender)) throw createControllerError("FORBIDDEN");
        const settings = normalizeSettings(await loadSettings());
        if (!isConfigurationReady(settings)) throw createControllerError("NOT_CONFIGURED");
        const explanation = await explain(
          settings,
          CONNECTION_TEST_SAMPLE,
          settings.level,
          false
        );
        return { ok: true, explanation };
      }
      if (message.type === "EXPLAIN_SELECTION") {
        if (typeof message.requestId !== "string" || !message.requestId.trim()) {
          throw createControllerError("BAD_REQUEST_ID");
        }
        requestId = message.requestId;
        const selection = validateSelectedText(message.text);
        if (!selection.valid) throw createControllerError(selectionErrorKind(selection.code));
        if (!VALID_LEVELS.has(message.level)) throw createControllerError("BAD_LEVEL");
        if (message.webSearchEnabled !== undefined && typeof message.webSearchEnabled !== "boolean") {
          throw createControllerError("BAD_WEB_SEARCH");
        }
        const settings = normalizeSettings(await loadSettings());
        if (!settings.enabled) throw createControllerError("DISABLED");
        if (!isConfigurationReady(settings)) throw createControllerError("NOT_CONFIGURED");
        const explanation = await explain(
          settings,
          selection.text,
          message.level,
          message.webSearchEnabled ?? settings.webSearchEnabled
        );
        return { ok: true, explanation, requestId };
      }
      throw createControllerError("UNKNOWN_MESSAGE");
    } catch (error) {
      return failure(error, requestId);
    }
  };
}
