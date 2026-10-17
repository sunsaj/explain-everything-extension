const VALID_LEVELS = new Set(['child', 'engineer']);
const CONFIGURATION_MESSAGE = 'Configure the LiteLLM endpoint, key, and model first.';
const STATUS_FAILURE_MESSAGE = 'Could not read extension status. Reload the page and try again.';
const REQUEST_FAILURE_MESSAGE = 'Could not complete the explanation. Reload the page and try again.';

export function readSelectedText({ documentObject, windowObject }) {
  const activeElement = documentObject?.activeElement;
  const tagName = String(activeElement?.tagName ?? '').toUpperCase();

  if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
    try {
      const start = activeElement.selectionStart;
      const end = activeElement.selectionEnd;
      if (Number.isFinite(start) && Number.isFinite(end)) {
        return String(activeElement.value ?? '').slice(start, end);
      }
    } catch {
      // Some input types do not expose selection ranges.
    }
  }

  try {
    return String(windowObject?.getSelection?.()?.toString() ?? '');
  } catch {
    return '';
  }
}

export function isSettingsStorageChange(changes, areaName, settingsKey) {
  return areaName === 'local'
    && changes !== null
    && typeof changes === 'object'
    && Object.prototype.hasOwnProperty.call(changes, settingsKey);
}

export function sendRuntimeMessage(runtime, message) {
  return new Promise((resolve, reject) => {
    let settled = false;

    function succeed(value) {
      if (settled) return;
      settled = true;
      resolve(value);
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error('Extension message failed.'));
    }

    try {
      if (!runtime || typeof runtime.sendMessage !== 'function') {
        fail(new Error('Extension message could not be delivered.'));
        return;
      }

      const maybePromise = runtime.sendMessage(message, (response) => {
        let lastError;
        try {
          lastError = runtime.lastError;
        } catch {
          lastError = true;
        }
        if (lastError) {
          fail(new Error('Extension message could not be delivered.'));
          return;
        }
        succeed(response);
      });

      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(succeed, fail);
      }
    } catch (error) {
      fail(error);
    }
  });
}

function statusFields(value) {
  if (
    typeof value?.enabled !== 'boolean'
    || typeof value?.configured !== 'boolean'
    || !VALID_LEVELS.has(value.level)
  ) {
    return null;
  }
  return {
    enabled: value.enabled,
    configured: value.configured,
    level: value.level,
    webSearchEnabled: typeof value.webSearchEnabled === 'boolean'
      ? value.webSearchEnabled
      : false
  };
}

function publicStatus(result) {
  return result?.ok === true ? statusFields(result) : null;
}

function publicStatusChange(message) {
  return message?.type === 'PUBLIC_STATUS_CHANGED'
    ? statusFields(message)
    : null;
}

function responseMessage(result, fallback) {
  return typeof result?.error?.message === 'string' && result.error.message.trim()
    ? result.error.message
    : fallback;
}

function shouldShowSettings(code) {
  return code === 'NOT_CONFIGURED'
    || (typeof code === 'string' && code.includes('PERMISSION'));
}

export function createContentController({
  createPanel,
  validateSelectedText,
  readSelection,
  sendMessage,
  writeClipboard
}) {
  let panel;
  let lastSelection = null;
  let selectionError = null;
  let currentExplanation = '';
  let requestCounter = 0;
  let latestRequestId = '';
  let statusGeneration = 0;
  let stateGeneration = 0;
  let configured = null;

  function ensurePanel() {
    if (panel) return panel;
    panel = createPanel({
      initialLevel: 'child',
      initialWebSearchEnabled: false,
      onExplain: requestCurrentExplanation,
      onRetry: requestCurrentExplanation,
      onCopy: copyExplanation,
      onSettings: openSettings
    });
    panel.setVisible(false);
    return panel;
  }

  function invalidateResultState() {
    stateGeneration += 1;
    currentExplanation = '';
  }

  function renderSelectionState() {
    ensurePanel().setSelection(lastSelection?.text ?? '');
    if (selectionError) {
      panel.setError(selectionError.error, { showSettings: false });
    } else if (configured === false) {
      panel.setError(CONFIGURATION_MESSAGE, { showSettings: true });
    }
  }

  function rememberSelectionError(result) {
    lastSelection = null;
    selectionError = {
      code: result.code,
      error: result.error
    };
    invalidateResultState();
    ensurePanel().setSelection('');
    panel.setError(selectionError.error, { showSettings: false });
  }

  function captureSelection() {
    const result = validateSelectedText(readSelection());
    if (!result.valid) {
      if (result.code !== 'NO_SELECTION') {
        rememberSelectionError(result);
      }
      return false;
    }

    const changed = selectionError !== null || lastSelection?.text !== result.text;
    if (!changed) return true;

    lastSelection = { text: result.text };
    selectionError = null;
    invalidateResultState();
    ensurePanel().setSelection(result.text);
    if (configured === false) {
      panel.setError(CONFIGURATION_MESSAGE, { showSettings: true });
    }
    return true;
  }

  function applyStatus(status, { resetPanel }) {
    configured = status.configured;
    ensurePanel().setLevel(status.level);
    panel.setWebSearchEnabled(status.webSearchEnabled);
    panel.setVisible(status.enabled);
    if (resetPanel) {
      renderSelectionState();
    } else if (selectionError) {
      panel.setError(selectionError.error, { showSettings: false });
    } else if (!configured) {
      panel.setError(CONFIGURATION_MESSAGE, { showSettings: true });
    }
  }

  async function updateStatus({ initial }) {
    ensurePanel();
    invalidateResultState();
    if (!initial) renderSelectionState();
    const generation = ++statusGeneration;
    try {
      const result = await sendMessage({ type: 'GET_STATUS' });
      if (generation !== statusGeneration) return;
      invalidateResultState();
      const status = publicStatus(result);
      if (!status) {
        panel.setVisible(false);
        if (!initial) renderSelectionState();
        panel.announce(responseMessage(result, STATUS_FAILURE_MESSAGE));
        return;
      }
      applyStatus(status, { resetPanel: !initial });
    } catch {
      if (generation !== statusGeneration) return;
      invalidateResultState();
      panel.setVisible(false);
      if (!initial) renderSelectionState();
      panel.announce(STATUS_FAILURE_MESSAGE);
    }
  }

  function refreshStatus() {
    return updateStatus({ initial: false });
  }

  function applyPublicStatusChange(message) {
    const status = publicStatusChange(message);
    if (!status) return false;
    statusGeneration += 1;
    invalidateResultState();
    applyStatus(status, { resetPanel: true });
    return true;
  }

  async function requestCurrentExplanation() {
    ensurePanel();
    if (selectionError) {
      currentExplanation = '';
      panel.setError(selectionError.error, { showSettings: false });
      return;
    }

    const selection = validateSelectedText(lastSelection?.text ?? '');
    if (!selection.valid) {
      currentExplanation = '';
      if (selection.code !== 'NO_SELECTION') {
        rememberSelectionError(selection);
      } else {
        panel.setError(selection.error, { showSettings: false });
      }
      return;
    }

    const requestId = String(++requestCounter);
    const requestGeneration = stateGeneration;
    latestRequestId = requestId;
    currentExplanation = '';
    const webSearchEnabled = panel.getWebSearchEnabled();
    panel.setLoading({ webSearchEnabled });

    let result;
    try {
      result = await sendMessage({
        type: 'EXPLAIN_SELECTION',
        text: selection.text,
        level: panel.getLevel(),
        webSearchEnabled,
        requestId
      });
    } catch {
      if (
        requestId !== latestRequestId
        || requestGeneration !== stateGeneration
      ) return;
      panel.setError(REQUEST_FAILURE_MESSAGE, { showSettings: false });
      return;
    }

    if (
      requestId !== latestRequestId
      || requestGeneration !== stateGeneration
      || result?.requestId !== latestRequestId
    ) {
      return;
    }

    if (
      result.ok === true
      && typeof result.explanation === 'string'
      && result.explanation.trim()
    ) {
      currentExplanation = result.explanation;
      panel.setExplanation(result.explanation);
      return;
    }

    currentExplanation = '';
    const code = result?.error?.code;
    panel.setError(
      responseMessage(result, REQUEST_FAILURE_MESSAGE),
      { showSettings: shouldShowSettings(code) }
    );
  }

  async function copyExplanation() {
    ensurePanel();
    if (!currentExplanation) {
      panel.announce('No explanation to copy.');
      return;
    }
    try {
      await writeClipboard(currentExplanation);
      panel.announce('Explanation copied.');
    } catch {
      panel.announce('Could not copy the explanation.');
    }
  }

  async function openSettings() {
    ensurePanel();
    try {
      const result = await sendMessage({ type: 'OPEN_OPTIONS' });
      if (result?.ok !== true) {
        panel.announce(responseMessage(result, 'Could not open settings.'));
      }
    } catch {
      panel.announce('Could not open settings.');
    }
  }

  async function start() {
    ensurePanel();
    captureSelection();
    await updateStatus({ initial: true });
  }

  return {
    start,
    captureSelection,
    refreshStatus,
    applyPublicStatusChange
  };
}
