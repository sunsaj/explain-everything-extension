(() => {
  if (window.top !== window) return;
  if (globalThis.__selectionExplainerBootstrapped) return;

  globalThis.__selectionExplainerBootstrapped = true;
  try {
    import(chrome.runtime.getURL('content/app.js')).catch(() => {
      globalThis.__selectionExplainerBootstrapped = false;
    });
  } catch {
    globalThis.__selectionExplainerBootstrapped = false;
  }
})();
