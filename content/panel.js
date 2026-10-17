import { renderMarkdown } from "./markdown.js";

const HOST_TAG = "selection-explainer-panel-host";
const VALID_LEVELS = new Set(["child", "engineer"]);
const EMPTY_SELECTION_MESSAGE = "Select text on the page, then choose Explain.";
const HOST_STYLE_PROPERTIES = Object.freeze({
  all: "initial",
  position: "fixed",
  inset: "auto 16px 16px auto",
  display: "block",
  "z-index": "2147483647",
  "pointer-events": "none",
  "box-sizing": "border-box",
  width: "auto",
  height: "auto",
  "min-width": "0",
  "min-height": "0",
  "max-width": "none",
  "max-height": "none",
  margin: "0",
  padding: "0",
  border: "0",
  background: "transparent",
  overflow: "visible",
  visibility: "visible",
  opacity: "1",
  transform: "none",
  filter: "none",
  "font-family": "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  "font-size": "16px",
  "font-style": "normal",
  "font-weight": "400",
  "line-height": "1.5",
  "letter-spacing": "normal",
  "text-align": "left",
  "text-transform": "none",
  color: "CanvasText",
  "color-scheme": "light dark",
  direction: "ltr",
  "unicode-bidi": "isolate",
  isolation: "isolate"
});

let activePanelController = null;

function applyProtectedHostStyles(host) {
  for (const [property, value] of Object.entries(HOST_STYLE_PROPERTIES)) {
    host.style.setProperty(property, value, "important");
  }
}

function createButton(label, className, accessibleLabel = label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.setAttribute("aria-label", accessibleLabel);
  return button;
}

function focusWithoutScroll(element) {
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

export function createExplainerPanel({
  initialLevel = "child",
  initialWebSearchEnabled = false,
  onExplain = () => {},
  onRetry = () => {},
  onCopy = () => {},
  onSettings = () => {},
  onClose = () => {}
} = {}) {
  if (activePanelController) {
    activePanelController.destroy();
  }

  const host = document.createElement("selection-explainer-panel-host");
  host.setAttribute("data-selection-explainer-owned", "");
  applyProtectedHostStyles(host);

  const shadow = host.attachShadow({ mode: "closed" });
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = chrome.runtime.getURL("content/panel.css");

  const root = document.createElement("div");
  root.className = "explainer-root";
  root.dataset.hasSelection = "false";

  const launcher = createButton("", "launcher", "Explain selected text");
  const launcherIcon = document.createElement("span");
  launcherIcon.className = "launcher__icon";
  launcherIcon.setAttribute("aria-hidden", "true");
  launcherIcon.textContent = "✦";
  const launcherLabel = document.createElement("span");
  launcherLabel.className = "launcher__label";
  launcherLabel.textContent = "Explain";
  launcher.append(launcherIcon, launcherLabel);
  launcher.setAttribute("aria-expanded", "false");
  launcher.setAttribute("aria-controls", "selection-explainer-dialog");

  const dialog = document.createElement("section");
  dialog.id = "selection-explainer-dialog";
  dialog.className = "panel";
  dialog.hidden = true;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-labelledby", "selection-explainer-title");
  dialog.setAttribute("aria-describedby", "selection-explainer-status");
  dialog.setAttribute("aria-busy", "false");

  const header = document.createElement("header");
  header.className = "panel__header";

  const title = document.createElement("h2");
  title.id = "selection-explainer-title";
  title.className = "panel__title";
  title.textContent = "Selection Explainer";

  const closeButton = createButton("×", "icon-button", "Close");
  header.append(title, closeButton);

  const body = document.createElement("div");
  body.className = "panel__body";

  const levelField = document.createElement("div");
  levelField.className = "field";

  const levelLabel = document.createElement("label");
  levelLabel.className = "field__label";
  levelLabel.htmlFor = "selection-explainer-level";
  levelLabel.textContent = "Explanation level";

  const levelSelect = document.createElement("select");
  levelSelect.id = "selection-explainer-level";
  levelSelect.className = "level-select";
  levelSelect.setAttribute("aria-label", "Explanation level");

  const childOption = document.createElement("option");
  childOption.value = "child";
  childOption.textContent = "10-year-old";

  const engineerOption = document.createElement("option");
  engineerOption.value = "engineer";
  engineerOption.textContent = "Engineer";

  levelSelect.append(childOption, engineerOption);
  levelField.append(levelLabel, levelSelect);

  const webSearchControl = document.createElement("label");
  webSearchControl.className = "web-search-control";
  const webSearchCheckbox = document.createElement("input");
  webSearchCheckbox.type = "checkbox";
  webSearchCheckbox.className = "web-search-checkbox";
  webSearchCheckbox.setAttribute("aria-label", "Use internet search");
  const webSearchText = document.createElement("span");
  webSearchText.className = "web-search-text";
  const webSearchTitle = document.createElement("strong");
  webSearchTitle.textContent = "Internet search";
  const webSearchHint = document.createElement("span");
  webSearchHint.textContent = "Uses more time, tokens, and cost. Sources are included when available.";
  webSearchText.append(webSearchTitle, webSearchHint);
  webSearchControl.append(webSearchCheckbox, webSearchText);

  const selectionGroup = document.createElement("section");
  selectionGroup.className = "selection";
  selectionGroup.setAttribute("aria-labelledby", "selection-explainer-selection-label");

  const selectionLabel = document.createElement("h3");
  selectionLabel.id = "selection-explainer-selection-label";
  selectionLabel.className = "section-label";
  selectionLabel.textContent = "Selected text";

  const selectionPreview = document.createElement("p");
  selectionPreview.className = "selection-preview";
  selectionPreview.textContent = EMPTY_SELECTION_MESSAGE;
  selectionGroup.append(selectionLabel, selectionPreview);

  const status = document.createElement("p");
  status.id = "selection-explainer-status";
  status.className = "status";
  status.tabIndex = -1;
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  status.textContent = EMPTY_SELECTION_MESSAGE;

  const response = document.createElement("div");
  response.className = "response";
  response.tabIndex = -1;
  response.hidden = true;
  response.setAttribute("aria-label", "Explanation");

  body.append(levelField, webSearchControl, selectionGroup, status, response);

  const footer = document.createElement("footer");
  footer.className = "panel__footer";

  const explainButton = createButton("Explain", "button button--primary");

  const resultActions = document.createElement("div");
  resultActions.className = "result-actions";
  resultActions.hidden = true;

  const copyButton = createButton("Copy", "button");
  const retryButton = createButton("Retry", "button");
  const settingsButton = createButton("Settings", "button");
  settingsButton.hidden = true;

  resultActions.append(copyButton, retryButton, settingsButton);
  footer.append(explainButton, resultActions);
  dialog.append(header, body, footer);
  root.append(dialog, launcher);
  shadow.append(stylesheet, root);
  document.documentElement.append(host);

  function setLevel(level) {
    if (VALID_LEVELS.has(level)) {
      levelSelect.value = level;
    }
  }

  function getLevel() {
    return levelSelect.value;
  }

  function setWebSearchEnabled(enabled) {
    webSearchCheckbox.checked = Boolean(enabled);
  }

  function getWebSearchEnabled() {
    return Boolean(webSearchCheckbox.checked);
  }

  function setBusy(isBusy) {
    explainButton.disabled = isBusy;
    retryButton.disabled = isBusy;
    levelSelect.disabled = isBusy;
    webSearchCheckbox.disabled = isBusy;
  }

  function openDialog({ focus = true } = {}) {
    dialog.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    if (focus) {
      focusWithoutScroll(explainButton);
    }
  }

  function closeDialog({ notify = true, restoreFocus = true } = {}) {
    if (dialog.hidden) return;
    dialog.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    if (restoreFocus && !host.hidden) {
      launcher.focus({ preventScroll: true });
    }
    if (notify) {
      onClose();
    }
  }

  function setVisible(isVisible) {
    const visible = Boolean(isVisible);
    if (!visible) {
      closeDialog({ notify: false, restoreFocus: false });
    }
    host.hidden = !visible;
    host.style.setProperty("display", visible ? "block" : "none", "important");
  }

  function setSelection(text) {
    const selectionText = typeof text === "string" ? text : "";
    const hasSelection = selectionText.trim().length > 0;
    selectionPreview.textContent = hasSelection
      ? selectionText
      : EMPTY_SELECTION_MESSAGE;
    root.dataset.hasSelection = String(hasSelection);
    dialog.setAttribute("aria-busy", "false");
    setBusy(false);
    status.dataset.state = "idle";
    status.textContent = hasSelection
      ? "Ready to explain selected text."
      : EMPTY_SELECTION_MESSAGE;
    response.textContent = "";
    response.hidden = true;
    resultActions.hidden = true;
    copyButton.hidden = false;
    retryButton.hidden = false;
    settingsButton.hidden = true;
  }

  function setLoading({ webSearchEnabled = getWebSearchEnabled() } = {}) {
    openDialog({ focus: false });
    dialog.setAttribute("aria-busy", "true");
    setBusy(true);
    status.dataset.state = "loading";
    status.textContent = webSearchEnabled
      ? "Searching the web and explaining…"
      : "Explaining…";
    response.textContent = "";
    response.hidden = true;
    resultActions.hidden = true;
    copyButton.hidden = false;
    settingsButton.hidden = true;
    focusWithoutScroll(status);
  }

  function setExplanation(text) {
    const explanationText = typeof text === "string" ? text : "";
    dialog.setAttribute("aria-busy", "false");
    setBusy(false);
    status.dataset.state = "success";
    status.textContent = "Explanation ready.";
    response.textContent = "";
    response.append(renderMarkdown(explanationText, document));
    response.hidden = false;
    resultActions.hidden = false;
    copyButton.hidden = false;
    settingsButton.hidden = false;
    focusWithoutScroll(response);
  }

  function setError(message, { showSettings = false } = {}) {
    const errorMessage = typeof message === "string" && message.trim()
      ? message
      : "The explanation could not be completed. Try again.";
    dialog.setAttribute("aria-busy", "false");
    setBusy(false);
    status.dataset.state = "error";
    status.textContent = errorMessage;
    response.textContent = "";
    response.hidden = true;
    resultActions.hidden = false;
    copyButton.hidden = true;
    retryButton.hidden = false;
    settingsButton.hidden = !showSettings;
    focusWithoutScroll(status);
  }

  function announce(message) {
    status.dataset.state = "info";
    status.textContent = typeof message === "string" ? message : "";
  }

  function handleKeydown(event) {
    if (event.key === "Escape" && !dialog.hidden) {
      event.preventDefault();
      event.stopPropagation();
      closeDialog();
    }
  }

  launcher.addEventListener("click", () => openDialog());
  closeButton.addEventListener("click", () => closeDialog());
  explainButton.addEventListener("click", (event) => {
    if (event.isTrusted) onExplain();
  });
  copyButton.addEventListener("click", onCopy);
  retryButton.addEventListener("click", (event) => {
    if (event.isTrusted) onRetry();
  });
  settingsButton.addEventListener("click", onSettings);
  shadow.addEventListener("keydown", handleKeydown);

  setLevel(VALID_LEVELS.has(initialLevel) ? initialLevel : "child");
  setWebSearchEnabled(initialWebSearchEnabled);

  let controller;
  let destroyed = false;
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    shadow.removeEventListener("keydown", handleKeydown);
    host.remove();
    if (activePanelController === controller) {
      activePanelController = null;
    }
  }

  controller = {
    setVisible,
    setSelection,
    setLevel,
    getLevel,
    setWebSearchEnabled,
    getWebSearchEnabled,
    setLoading,
    setExplanation,
    setError,
    announce,
    destroy
  };
  activePanelController = controller;
  return controller;
}
