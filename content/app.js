import { createExplainerPanel } from './panel.js';
import { validateSelectedText } from '../shared/selection.js';
import {
  createContentController,
  readSelectedText,
  sendRuntimeMessage
} from './app-controller.js';


function initializeContentApp() {
  if (window.top !== window) return;

  const controller = createContentController({
    createPanel: createExplainerPanel,
    validateSelectedText,
    readSelection: () => readSelectedText({
      documentObject: document,
      windowObject: window
    }),
    sendMessage: (message) => sendRuntimeMessage(chrome.runtime, message),
    writeClipboard: (text) => navigator.clipboard.writeText(text)
  });

  const captureSelection = () => {
    try {
      controller.captureSelection();
    } catch {
      // Page lifecycle changes can detach the extension context at any time.
    }
  };

  document.addEventListener('selectionchange', captureSelection);
  document.addEventListener('mouseup', captureSelection);
  document.addEventListener('keyup', captureSelection);

  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type !== 'PUBLIC_STATUS_CHANGED') return;
      controller.applyPublicStatusChange(message);
    });
  } catch {
    // A detached extension context cannot receive future status changes.
  }

  controller.start().catch(() => {});
}

initializeContentApp();
