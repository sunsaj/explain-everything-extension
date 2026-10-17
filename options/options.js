import { normalizeEndpoint, permissionPatternForEndpoint } from "../shared/api.js";
import { createPromptProfileId } from "../shared/profiles.js";
import { normalizeSettings, validateSettings } from "../shared/settings.js";
import { createProfileEditorState } from "./profile-editor.js";
import { configurationControlsLocked, grantAndSaveSettings } from "./save-flow.js";

const MAX_PROFILE_COUNT = 20;
const form = document.querySelector("form");
const status = document.querySelector("#status");
const validationSummary = document.querySelector("#validationSummary");
const saveButton = document.querySelector("#saveSettings");
const testButton = document.querySelector("#testConnection");
const keyInput = document.querySelector("#apiKey");
const toggleKeyButton = document.querySelector("#toggleKey");
const profilesList = document.querySelector("#promptProfilesList");
const addProfileButton = document.querySelector("#addPromptProfile");
let currentSettings;
let profileEditor;
let busy = false;
let loading = true;
let configurationLoaded = false;

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

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function profileControlId(kind, index) {
  return "promptProfile" + kind + "-" + index;
}

function profileActionLabel(action, index, title) {
  return action + " profile " + (index + 1) + ": " + (title.trim() || "Untitled");
}

function createProfileField({
  profile,
  index,
  fieldName,
  labelText,
  multiline = false
}) {
  const field = createElement("div", "field");
  const suffix = fieldName === "title" ? "Title" : "Prompt";
  const inputId = profileControlId(suffix, index);
  const hintId = inputId + "Hint";
  const errorId = inputId + "Error";
  const validationPath = "promptProfiles." + index + "." + fieldName;
  const label = createElement("label", "", labelText);
  label.htmlFor = inputId;

  const input = createElement(multiline ? "textarea" : "input");
  input.id = inputId;
  input.name = validationPath;
  input.value = profile[fieldName];
  input.required = true;
  input.disabled = true;
  input.dataset.profileId = profile.id;
  input.dataset.profileField = fieldName;
  input.dataset.validationPath = validationPath;
  if (multiline) {
    input.rows = 8;
    input.className = "profile-prompt";
  } else {
    input.type = "text";
    input.autocomplete = "off";
  }

  const hint = multiline
    ? createElement(
      "p",
      "hint",
      "There is no extension prompt-length cap. Unusually large prompts can increase token cost or exceed the provider context window."
    )
    : null;
  if (hint) hint.id = hintId;

  const error = createElement("p", "field-error");
  error.id = errorId;
  error.dataset.errorPath = validationPath;
  input.setAttribute(
    "aria-describedby",
    [hint?.id, errorId].filter(Boolean).join(" ")
  );

  field.append(label, input);
  if (hint) field.append(hint);
  field.append(error);
  return field;
}

function createProfileAction(action, label, profile, index, extraClass = "") {
  const button = createElement(
    "button",
    "secondary-button profile-action" + (extraClass ? " " + extraClass : ""),
    label
  );
  button.type = "button";
  button.disabled = true;
  button.dataset.profileAction = action;
  button.dataset.profileId = profile.id;
  button.setAttribute("aria-label", profileActionLabel(label, index, profile.title));
  return button;
}

function createProfileCard(profile, index, snapshot) {
  const isDefault = profile.id === snapshot.activePromptProfileId;
  const card = createElement("article", "profile-card");
  card.setAttribute("role", "listitem");
  card.dataset.profileId = profile.id;
  card.dataset.default = String(isDefault);

  const heading = createElement("div", "profile-card-heading");
  const title = createElement("h3", "", "Profile " + (index + 1));
  title.id = profileControlId("Heading", index);
  heading.append(title);
  if (isDefault) {
    heading.append(createElement("span", "default-badge", "Default"));
  }
  card.setAttribute("aria-labelledby", title.id);

  const fields = createElement("div", "profile-fields");
  fields.append(
    createProfileField({
      profile,
      index,
      fieldName: "title",
      labelText: "Profile title"
    }),
    createProfileField({
      profile,
      index,
      fieldName: "prompt",
      labelText: "Prompt instructions",
      multiline: true
    })
  );

  const actions = createElement("div", "profile-actions");
  const defaultButton = createProfileAction(
    "set-default",
    "Set as default",
    profile,
    index
  );
  defaultButton.setAttribute("aria-pressed", String(isDefault));
  actions.append(
    defaultButton,
    createProfileAction("duplicate", "Duplicate", profile, index),
    createProfileAction("delete", "Delete", profile, index, "danger-button")
  );

  card.append(heading, fields, actions);
  return card;
}

function profileSnapshot() {
  return profileEditor.snapshot();
}

function refreshProfileActionLabels(profileId, title) {
  const profileIndex = profileSnapshot().promptProfiles.findIndex(
    (profile) => profile.id === profileId
  );
  if (profileIndex < 0) return;

  for (const button of profilesList.querySelectorAll("[data-profile-action]")) {
    if (button.dataset.profileId !== profileId) continue;
    button.setAttribute(
      "aria-label",
      profileActionLabel(button.textContent, profileIndex, title)
    );
  }
}

function findProfileControl(profileId, predicate) {
  return [...profilesList.querySelectorAll("[data-profile-id]")].find(
    (element) => element.dataset.profileId === profileId && predicate(element)
  );
}

function focusProfileTitle(profileId) {
  findProfileControl(
    profileId,
    (element) => element.dataset.profileField === "title"
  )?.focus();
}

function focusProfileAction(profileId, action) {
  findProfileControl(
    profileId,
    (element) => element.dataset.profileAction === action
  )?.focus();
}

function renderProfiles({ focusProfileId, focusAction } = {}) {
  const snapshot = profileSnapshot();
  const cards = snapshot.promptProfiles.map((profile, index) =>
    createProfileCard(profile, index, snapshot)
  );
  profilesList.replaceChildren(...cards);
  syncControlStates();

  if (focusProfileId && focusAction) {
    focusProfileAction(focusProfileId, focusAction);
  } else if (focusProfileId) {
    focusProfileTitle(focusProfileId);
  }
}

function values() {
  return {
    enabled: currentSettings.enabled,
    endpoint: document.querySelector("#endpoint").value,
    apiKey: document.querySelector("#apiKey").value,
    model: document.querySelector("#model").value,
    webSearchEnabled: document.querySelector("#webSearchEnabled").checked,
    ...profileSnapshot(),
    settingsVersion: currentSettings.settingsVersion
  };
}

function showStatus(message = "", kind = "info") {
  status.textContent = message;
  status.dataset.kind = kind;
}

function errorElements() {
  return [...document.querySelectorAll("[data-error-for], [data-error-path]")];
}

function fieldForError(errorElement) {
  if (errorElement.dataset.errorPath) {
    return [...document.querySelectorAll("[data-validation-path]")].find(
      (field) => field.dataset.validationPath === errorElement.dataset.errorPath
    );
  }
  return document.querySelector("#" + errorElement.dataset.errorFor);
}

function errorElementFor(fieldName) {
  return errorElements().find(
    (element) => element.dataset.errorFor === fieldName
      || element.dataset.errorPath === fieldName
  );
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

function clearErrorElement(errorElement) {
  if (!errorElement) return;
  errorElement.textContent = "";
  fieldForError(errorElement)?.removeAttribute("aria-invalid");
}

function clearErrors() {
  for (const errorElement of errorElements()) {
    clearErrorElement(errorElement);
  }
  refreshValidationSummary();
}

function profileErrorMessage(fieldName, message) {
  const match = /^promptProfiles\.(\d+)\.(title|prompt)$/.exec(fieldName);
  if (!match) return message;
  const fieldLabel = match[2] === "title" ? "title" : "prompt";
  return "Profile " + (Number(match[1]) + 1) + " " + fieldLabel + ": " + message;
}

function renderErrors(errors) {
  clearErrors();
  for (const [fieldName, message] of Object.entries(errors)) {
    const errorElement = errorElementFor(fieldName);
    if (!errorElement) continue;
    errorElement.textContent = profileErrorMessage(fieldName, message);
    fieldForError(errorElement)?.setAttribute("aria-invalid", "true");
  }
  refreshValidationSummary(true);
}

function clearFieldError(field) {
  const fieldName = field.dataset.validationPath || field.id;
  clearErrorElement(errorElementFor(fieldName));
  refreshValidationSummary();
}

function populateForm(settings) {
  document.querySelector("#endpoint").value = settings.endpoint;
  document.querySelector("#apiKey").value = settings.apiKey;
  document.querySelector("#model").value = settings.model;
  document.querySelector("#webSearchEnabled").checked = settings.webSearchEnabled;
  keyInput.type = "password";
  toggleKeyButton.textContent = "Show";
  toggleKeyButton.setAttribute("aria-pressed", "false");
  profileEditor = createProfileEditorState(
    settings,
    (profiles) => createPromptProfileId(profiles)
  );
  renderProfiles();
}

function hasSavedConfiguration() {
  return Boolean(currentSettings && validateSettings(currentSettings).valid);
}

function syncControlStates() {
  const locked = configurationControlsLocked({ loading, busy, configurationLoaded });
  for (const control of form.querySelectorAll("input, select, textarea, button")) {
    control.disabled = locked;
  }
  if (locked || !profileEditor) return;

  const snapshot = profileSnapshot();
  addProfileButton.disabled = snapshot.promptProfiles.length >= 20;
  for (const button of profilesList.querySelectorAll("[data-profile-action]")) {
    if (button.dataset.profileAction === "duplicate") {
      button.disabled = snapshot.promptProfiles.length >= MAX_PROFILE_COUNT;
    } else if (button.dataset.profileAction === "delete") {
      button.disabled = snapshot.promptProfiles.length <= 1;
    } else if (button.dataset.profileAction === "set-default") {
      button.disabled = button.dataset.profileId === snapshot.activePromptProfileId;
    }
  }
  saveButton.disabled = false;
  testButton.disabled = !hasSavedConfiguration();
}

function updateButtons() {
  syncControlStates();
}

function setFormLoading(isLoading) {
  loading = isLoading;
  form.setAttribute("aria-busy", String(isLoading || busy));
  syncControlStates();
}

function beginBusy(button, label) {
  busy = true;
  form.setAttribute("aria-busy", "true");
  const originalLabel = button.textContent;
  button.textContent = label;
  updateButtons();
  return originalLabel;
}

function endBusy(button, originalLabel) {
  button.textContent = originalLabel;
  busy = false;
  form.setAttribute("aria-busy", String(loading));
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
    configurationLoaded = true;
    showStatus("");
  } catch {
    configurationLoaded = false;
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

    currentSettings = normalizeSettings(result.settings);
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

addProfileButton.addEventListener("click", () => {
  const beforeIds = new Set(profileSnapshot().promptProfiles.map(({ id }) => id));
  const snapshot = profileEditor.addProfile();
  const added = snapshot.promptProfiles.find(({ id }) => !beforeIds.has(id));
  if (!added) return;
  clearErrors();
  renderProfiles({ focusProfileId: added.id });
  showStatus("Prompt profile added. Save to keep this change.");
});

profilesList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-profile-action]");
  if (!button || !profilesList.contains(button)) return;

  const profileId = button.dataset.profileId;
  const action = button.dataset.profileAction;
  const before = profileSnapshot();
  const profileIndex = before.promptProfiles.findIndex(({ id }) => id === profileId);
  if (profileIndex < 0) return;

  if (action === "set-default") {
    profileEditor.setActiveProfile(profileId);
    clearErrors();
    renderProfiles({ focusProfileId: profileId });
    showStatus("Default prompt profile changed. Save to keep this change.");
    return;
  }

  if (action === "duplicate") {
    const beforeIds = new Set(before.promptProfiles.map(({ id }) => id));
    const snapshot = profileEditor.duplicateProfile(profileId);
    const duplicate = snapshot.promptProfiles.find(({ id }) => !beforeIds.has(id));
    if (!duplicate) return;
    clearErrors();
    renderProfiles({ focusProfileId: duplicate.id });
    showStatus("Prompt profile duplicated. Save to keep this change.");
    return;
  }

  if (action === "delete") {
    const snapshot = profileEditor.deleteProfile(profileId);
    if (snapshot.promptProfiles.length === before.promptProfiles.length) return;
    const nextProfile = snapshot.promptProfiles[
      Math.min(profileIndex, snapshot.promptProfiles.length - 1)
    ];
    clearErrors();
    renderProfiles({ focusProfileId: nextProfile?.id });
    showStatus("Prompt profile deleted. Save to keep this change.");
  }
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
      result?.ok
      && typeof result.explanation === "string"
      && result.explanation.trim()
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
  if (field.dataset.profileField) {
    profileEditor.updateProfile(field.dataset.profileId, {
      [field.dataset.profileField]: field.value
    });
    if (field.dataset.profileField === "title") {
      refreshProfileActionLabels(field.dataset.profileId, field.value);
    }
  }
  if (!field.id) return;
  clearFieldError(field);
  if (status.dataset.kind === "error") showStatus("");
});

document.addEventListener("DOMContentLoaded", load);
