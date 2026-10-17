import { DEFAULT_SYSTEM_PROMPT } from "../shared/defaults.js";
import { normalizeEndpoint, permissionPatternForEndpoint } from "../shared/api.js";
import { normalizeSettings, validateSettings } from "../shared/settings.js";
import { grantAndSaveSettings } from "./save-flow.js";

const form = document.querySelector("form");
const status = document.querySelector("#status");
const validationSummary = document.querySelector("#validationSummary");
const saveButton = document.querySelector("#saveSettings");
const testButton = document.querySelector("#testConnection");
const keyInput = document.querySelector("#apiKey");
const toggleKeyButton = document.querySelector("#toggleKey");
const editableControls = [...form.querySelectorAll("input, select, textarea, button")];
let currentSettings;
let busy = false;
let loading = true;

const SAFE_ENDPOINT_ERRORS = new Set([
  "Remove the query string from the endpoint.",
  "Remove the fragment from the endpoint.",
  "Use HTTP or HTTPS.",
  "Remote endpoints must use HTTPS.",
  "Do not put credentials in the URL."
]);

const saveFlowDependencies = {
  validateSettings,
  normalizeEndpoint,
  permissionPatternForEndpoint,
  requestPermission: (details) => chrome.permissions.request(details),
  saveConfiguration: (configuration) => chrome.runtime.sendMessage({
    type: "SAVE_CONFIGURATION",
    configuration
  })
};

function values() {
  return normalizeSettings({
    enabled: true,
    endpoint: document.querySelector("#endpoint").value,
    apiKey: document.querySelector("#apiKey").value,
    model: document.querySelector("#model").value,
    level: document.querySelector("#level").value,
    webSearchEnabled: document.querySelector("#webSearchEnabled").checked,
    systemPrompt: document.querySelector("#systemPrompt").value
  });
}

function showStatus(message = "", kind = "info") {
  status.textContent = message;
  status.dataset.kind = kind;
}

function errorElements() {
  return [...document.querySelectorAll("[data-error-for]")];
}

function refreshValidationSummary(focus = false) {
  const remainingErrors = errorElements().filter(
    (errorElement) => errorElement.textContent.trim()
  );
  if (!remainingErrors.length) {
    validationSummary.hidden = true;
    validationSummary.textContent = "";
    return;
  }

  validationSummary.textContent = remainingErrors.length === 1
    ? "Fix the highlighted field before saving."
    : "Fix the " + remainingErrors.length + " highlighted fields before saving.";
  validationSummary.hidden = false;
  if (focus) validationSummary.focus();
}

function clearErrors() {
  for (const errorElement of errorElements()) {
    errorElement.textContent = "";
    const field = document.querySelector("#" + errorElement.dataset.errorFor);
    field?.removeAttribute("aria-invalid");
  }
  refreshValidationSummary();
}

function renderErrors(errors) {
  clearErrors();
  for (const [fieldName, message] of Object.entries(errors)) {
    const errorElement = document.querySelector(
      '[data-error-for="' + fieldName + '"]'
    );
    const field = document.querySelector("#" + fieldName);
    if (errorElement) errorElement.textContent = message;
    field?.setAttribute("aria-invalid", "true");
  }
  refreshValidationSummary(true);
}

function populateForm(settings) {
  document.querySelector("#endpoint").value = settings.endpoint;
  document.querySelector("#apiKey").value = settings.apiKey;
  document.querySelector("#model").value = settings.model;
  document.querySelector("#level").value = settings.level;
  document.querySelector("#webSearchEnabled").checked = settings.webSearchEnabled;
  document.querySelector("#systemPrompt").value = settings.systemPrompt;
}

function hasSavedConfiguration() {
  return Boolean(currentSettings && validateSettings(currentSettings).valid);
}

function updateButtons() {
  saveButton.disabled = loading || busy;
  testButton.disabled = loading || busy || !hasSavedConfiguration();
}

function setFormLoading(isLoading) {
  loading = isLoading;
  form.setAttribute("aria-busy", String(isLoading));
  for (const control of editableControls) {
    control.disabled = isLoading;
  }
  if (!isLoading) updateButtons();
}

function beginBusy(button, label) {
  busy = true;
  const originalLabel = button.textContent;
  button.textContent = label;
  updateButtons();
  return originalLabel;
}

function endBusy(button, originalLabel) {
  button.textContent = originalLabel;
  busy = false;
  updateButtons();
}

function safeEndpointError(error) {
  return SAFE_ENDPOINT_ERRORS.has(error?.message)
    ? error.message
    : "Enter a valid LiteLLM URL.";
}

async function load() {
  try {
    const result = await chrome.runtime.sendMessage({ type: "GET_CONFIGURATION" });
    if (result?.ok !== true || !result.settings || typeof result.settings !== "object") {
      throw new Error("Configuration unavailable.");
    }
    currentSettings = normalizeSettings(result.settings);
    populateForm(currentSettings);
    showStatus("");
  } catch {
    currentSettings = normalizeSettings();
    populateForm(currentSettings);
    showStatus("Could not load settings. Reopen this page and try again.", "error");
  } finally {
    setFormLoading(false);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearErrors();
  showStatus("");
  const settings = values();
  const originalLabel = beginBusy(saveButton, "Saving…");

  try {
    const result = await grantAndSaveSettings(settings, saveFlowDependencies);
    if (result.validation) {
      renderErrors(result.validation.errors);
      showStatus("Settings were not saved.", "error");
      return;
    }
    if (result.permissionDenied) {
      showStatus(
        "Access was not granted. Your previously saved settings were not changed.",
        "error"
      );
      return;
    }

    currentSettings = result.settings;
    populateForm(currentSettings);
    showStatus("Settings saved and endpoint access granted.", "success");
  } catch (error) {
    if (error instanceof TypeError || SAFE_ENDPOINT_ERRORS.has(error?.message)) {
      renderErrors({ endpoint: safeEndpointError(error) });
      showStatus("Settings were not saved.", "error");
    } else {
      showStatus("Could not save settings. Your previous settings are still available.", "error");
    }
  } finally {
    endBusy(saveButton, originalLabel);
  }
});

toggleKeyButton.addEventListener("click", () => {
  const showing = keyInput.type === "text";
  keyInput.type = showing ? "password" : "text";
  toggleKeyButton.textContent = showing ? "Show" : "Hide";
  toggleKeyButton.setAttribute("aria-pressed", String(!showing));
  keyInput.focus();
});

document.querySelector("#restorePrompt").addEventListener("click", () => {
  document.querySelector("#systemPrompt").value = DEFAULT_SYSTEM_PROMPT;
  const promptError = document.querySelector('[data-error-for="systemPrompt"]');
  promptError.textContent = "";
  document.querySelector("#systemPrompt").removeAttribute("aria-invalid");
  refreshValidationSummary();
  showStatus("Default prompt restored. Save to keep this change.");
});

testButton.addEventListener("click", async () => {
  if (!hasSavedConfiguration()) {
    showStatus("Save valid settings before testing the connection.", "error");
    return;
  }

  clearErrors();
  const originalLabel = beginBusy(testButton, "Testing…");
  showStatus("Testing the saved connection…");

  try {
    const result = await chrome.runtime.sendMessage({
      type: "TEST_CONNECTION"
    });

    if (
      result?.ok &&
      typeof result.explanation === "string" &&
      result.explanation.trim()
    ) {
      showStatus("Connection successful.", "success");
      return;
    }

    if (typeof result?.error?.message === "string" && result.error.message) {
      showStatus(result.error.message, "error");
    } else {
      showStatus("Connection test failed.", "error");
    }
  } catch {
    showStatus("Could not run the connection test.", "error");
  } finally {
    endBusy(testButton, originalLabel);
  }
});

form.addEventListener("input", (event) => {
  const field = event.target;
  if (!field.id) return;
  const errorElement = document.querySelector(
    '[data-error-for="' + field.id + '"]'
  );
  if (errorElement) errorElement.textContent = "";
  field.removeAttribute("aria-invalid");
  refreshValidationSummary();
  if (status.dataset.kind === "error") showStatus("");
});

document.addEventListener("DOMContentLoaded", load);
