import { createPopupController } from "./popup-controller.js";

const toggle = document.querySelector("#enabledToggle");
const configurationStatus = document.querySelector("#configurationStatus");
const openSettings = document.querySelector("#openSettings");
const popupStatus = document.querySelector("#popupStatus");

function render(view) {
  toggle.checked = view.enabled;
  toggle.disabled = view.toggleDisabled;
  configurationStatus.textContent = view.configurationText;
  configurationStatus.dataset.state = view.configurationKind;
  popupStatus.textContent = view.statusMessage;
  popupStatus.dataset.kind = view.statusKind;
  openSettings.disabled = view.settingsDisabled;
}

const controller = createPopupController({
  sendMessage: (message) => chrome.runtime.sendMessage(message),
  render,
  close: () => window.close()
});

toggle.addEventListener("change", () => {
  void controller.setEnabled(toggle.checked);
});

openSettings.addEventListener("click", () => {
  void controller.openOptions();
});

document.addEventListener("DOMContentLoaded", () => {
  void controller.load();
});
