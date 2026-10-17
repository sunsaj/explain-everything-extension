import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createContentController,
  readSelectedText,
  sendRuntimeMessage
} from '../content/app-controller.js';
import { validateSelectedText } from '../shared/selection.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createPanelHarness() {
  const calls = {
    visible: [],
    selections: [],
    levels: [],
    webSearch: [],
    loading: [],
    explanations: [],
    errors: [],
    announcements: []
  };
  let callbacks;
  let level = 'child';
  let webSearchEnabled = false;
  const panel = {
    setVisible(value) { calls.visible.push(value); },
    setSelection(value) { calls.selections.push(value); },
    setLevel(value) { level = value; calls.levels.push(value); },
    getLevel() { return level; },
    setWebSearchEnabled(value) { webSearchEnabled = Boolean(value); calls.webSearch.push(webSearchEnabled); },
    getWebSearchEnabled() { return webSearchEnabled; },
    setLoading(options) { calls.loading.push(options ?? {}); },
    setExplanation(value) { calls.explanations.push(value); },
    setError(message, options) { calls.errors.push({ message, options }); },
    announce(message) { calls.announcements.push(message); }
  };
  return {
    calls,
    panel,
    createPanel(options) {
      assert.equal(callbacks, undefined, 'panel must be created once');
      callbacks = options;
      level = options.initialLevel;
      webSearchEnabled = Boolean(options.initialWebSearchEnabled);
      return panel;
    },
    get callbacks() { return callbacks; }
  };
}

function validSelection(text) {
  const normalized = String(text ?? '').trim().replace(/\s+/g, ' ');
  return normalized
    ? { valid: true, text: normalized }
    : { valid: false, text: '', code: 'NO_SELECTION', error: 'Highlight some text first.' };
}

test('readSelectedText prefers active input and textarea ranges, then falls back to the window selection', () => {
  const windowObject = { getSelection: () => ({ toString: () => 'page selection' }) };

  assert.equal(readSelectedText({
    documentObject: {
      activeElement: { tagName: 'INPUT', value: 'zero one two', selectionStart: 5, selectionEnd: 8 }
    },
    windowObject
  }), 'one');
  assert.equal(readSelectedText({
    documentObject: {
      activeElement: { tagName: 'textarea', value: 'alpha beta', selectionStart: 0, selectionEnd: 5 }
    },
    windowObject
  }), 'alpha');
  assert.equal(readSelectedText({
    documentObject: { activeElement: { tagName: 'DIV' } },
    windowObject
  }), 'page selection');
  assert.equal(readSelectedText({
    documentObject: {
      activeElement: { tagName: 'INPUT', value: 'unchanged', selectionStart: 3, selectionEnd: 3 }
    },
    windowObject
  }), '');
});

test('capture keeps the last valid selection and never sends a message by itself', async () => {
  const panel = createPanelHarness();
  const messages = [];
  let selectedText = '';
  const controller = createContentController({
    createPanel: panel.createPanel,
    validateSelectedText,
    readSelection: () => selectedText,
    sendMessage: async (message) => {
      messages.push({ ...message });
      if (message.type === 'GET_STATUS') {
        return { ok: true, enabled: true, configured: true, level: 'child' };
      }
      return { ok: true, explanation: 'kept', requestId: message.requestId };
    },
    writeClipboard: async () => {}
  });
  await controller.start();

  selectedText = '  Alpha   beta  ';
  assert.equal(controller.captureSelection(), true);
  selectedText = '   ';
  assert.equal(controller.captureSelection(), false);
  assert.deepEqual(messages, [{ type: 'GET_STATUS' }]);
  assert.deepEqual(panel.calls.selections, ['Alpha beta']);

  await panel.callbacks.onExplain();
  assert.deepEqual(messages.at(-1), {
    type: 'EXPLAIN_SELECTION',
    text: 'Alpha beta',
    level: 'child',
    webSearchEnabled: false,
    requestId: '1'
  });
});

test('startup status controls visibility, configuration guidance, and initial level', async () => {
  const panel = createPanelHarness();
  const controller = createContentController({
    createPanel: panel.createPanel,
    validateSelectedText: validSelection,
    readSelection: () => '',
    sendMessage: async () => ({
      ok: true,
      enabled: false,
      configured: false,
      level: 'engineer'
    }),
    writeClipboard: async () => {}
  });

  await controller.start();

  assert.equal(panel.calls.visible.at(-1), false);
  assert.equal(panel.calls.levels.at(-1), 'engineer');
  assert.deepEqual(panel.calls.errors.at(-1), {
    message: 'Configure the LiteLLM endpoint, key, and model first.',
    options: { showSettings: true }
  });
});

test('newer explanation requests win and stale success or error responses are ignored', async () => {
  const panel = createPanelHarness();
  const first = deferred();
  const second = deferred();
  const messages = [];
  const controller = createContentController({
    createPanel: panel.createPanel,
    validateSelectedText: validSelection,
    readSelection: () => 'selected text',
    sendMessage: async (message) => {
      messages.push({ ...message });
      if (message.type === 'GET_STATUS') {
        return { ok: true, enabled: true, configured: true, level: 'engineer' };
      }
      return message.requestId === '1' ? first.promise : second.promise;
    },
    writeClipboard: async () => {}
  });
  await controller.start();
  controller.captureSelection();

  const firstRequest = panel.callbacks.onExplain();
  const secondRequest = panel.callbacks.onRetry();
  assert.deepEqual(messages.slice(1), [
    { type: 'EXPLAIN_SELECTION', text: 'selected text', level: 'engineer', webSearchEnabled: false, requestId: '1' },
    { type: 'EXPLAIN_SELECTION', text: 'selected text', level: 'engineer', webSearchEnabled: false, requestId: '2' }
  ]);
  assert.equal(panel.calls.loading.length, 2);

  second.resolve({ ok: true, explanation: 'new result', requestId: '2' });
  await secondRequest;
  first.resolve({
    ok: false,
    error: { code: 'PERMISSION', message: 'stale failure' },
    requestId: '1'
  });
  await firstRequest;

  assert.deepEqual(panel.calls.explanations, ['new result']);
  assert.equal(panel.calls.errors.some((entry) => entry.message === 'stale failure'), false);
});

test('responses without the latest request ID cannot replace the loading state', async () => {
  const panel = createPanelHarness();
  let response = { ok: true, explanation: 'missing id' };
  const controller = createContentController({
    createPanel: panel.createPanel,
    validateSelectedText: validSelection,
    readSelection: () => 'selected text',
    sendMessage: async (message) => message.type === 'GET_STATUS'
      ? { ok: true, enabled: true, configured: true, level: 'child' }
      : response,
    writeClipboard: async () => {}
  });
  await controller.start();
  controller.captureSelection();

  await panel.callbacks.onExplain();
  response = { ok: false, error: { code: 'UNKNOWN', message: 'wrong id' }, requestId: '999' };
  await panel.callbacks.onRetry();

  assert.deepEqual(panel.calls.explanations, []);
  assert.deepEqual(panel.calls.errors, []);
});

test('only configuration and permission errors expose Settings', async () => {
  const panel = createPanelHarness();
  const codes = ['NOT_CONFIGURED', 'PERMISSION', 'AUTH'];
  let errorIndex = 0;
  const controller = createContentController({
    createPanel: panel.createPanel,
    validateSelectedText: validSelection,
    readSelection: () => 'selected text',
    sendMessage: async (message) => {
      if (message.type === 'GET_STATUS') {
        return { ok: true, enabled: true, configured: true, level: 'child' };
      }
      const code = codes[errorIndex++];
      return { ok: false, error: { code, message: code + ' message' }, requestId: message.requestId };
    },
    writeClipboard: async () => {}
  });
  await controller.start();
  controller.captureSelection();

  await panel.callbacks.onExplain();
  await panel.callbacks.onRetry();
  await panel.callbacks.onRetry();

  assert.deepEqual(panel.calls.errors.map((entry) => entry.options), [
    { showSettings: true },
    { showSettings: true },
    { showSettings: false }
  ]);
});

test('copy uses only the current explanation and settings sends OPEN_OPTIONS', async () => {
  const panel = createPanelHarness();
  const messages = [];
  const copied = [];
  let copyFails = false;
  const controller = createContentController({
    createPanel: panel.createPanel,
    validateSelectedText: validSelection,
    readSelection: () => 'selected text',
    sendMessage: async (message) => {
      messages.push({ ...message });
      if (message.type === 'GET_STATUS') {
        return { ok: true, enabled: true, configured: true, level: 'child' };
      }
      if (message.type === 'OPEN_OPTIONS') return { ok: true };
      return { ok: true, explanation: 'current explanation', requestId: message.requestId };
    },
    writeClipboard: async (text) => {
      if (copyFails) throw new Error('clipboard unavailable');
      copied.push(text);
    }
  });
  await controller.start();
  controller.captureSelection();
  await panel.callbacks.onExplain();

  await panel.callbacks.onCopy();
  copyFails = true;
  await panel.callbacks.onCopy();
  await panel.callbacks.onSettings();

  assert.deepEqual(copied, ['current explanation']);
  assert.deepEqual(panel.calls.announcements.slice(-2), [
    'Explanation copied.',
    'Could not copy the explanation.'
  ]);
  assert.deepEqual(messages.at(-1), { type: 'OPEN_OPTIONS' });
});

test('PUBLIC_STATUS_CHANGED applies only sanitized public fields without another status request', async () => {
  const panel = createPanelHarness();
  const messages = [];
  const controller = createContentController({
    createPanel: panel.createPanel,
    validateSelectedText: validSelection,
    readSelection: () => '',
    sendMessage: async (message) => {
      messages.push(message);
      return { ok: true, enabled: true, configured: true, level: 'child' };
    },
    writeClipboard: async () => {}
  });
  await controller.start();

  const pushedStatus = {
    type: 'PUBLIC_STATUS_CHANGED',
    enabled: false,
    configured: false,
    level: 'engineer'
  };
  Object.defineProperty(pushedStatus, 'apiKey', {
    get() { throw new Error('private fields must not be read'); }
  });

  assert.equal(controller.applyPublicStatusChange(pushedStatus), true);
  assert.equal(controller.applyPublicStatusChange({
    type: 'PUBLIC_STATUS_CHANGED',
    enabled: 'false',
    configured: false,
    level: 'engineer'
  }), false);
  assert.deepEqual(messages, [{ type: 'GET_STATUS' }]);
  assert.equal(panel.calls.visible.at(-1), false);
  assert.equal(panel.calls.levels.at(-1), 'engineer');
  assert.equal(panel.calls.errors.at(-1).options.showSettings, true);
});

test('sendRuntimeMessage consumes lastError and handles rejected promise messaging', async () => {
  const callbackRuntime = {
    lastError: undefined,
    sendMessage(message, callback) {
      assert.deepEqual(message, { type: 'GET_STATUS' });
      this.lastError = { message: 'Extension context invalidated.' };
      callback(undefined);
      this.lastError = undefined;
    }
  };
  await assert.rejects(
    sendRuntimeMessage(callbackRuntime, { type: 'GET_STATUS' }),
    /extension message/i
  );

  const promiseRuntime = {
    sendMessage() {
      return Promise.reject(new Error('Extension context invalidated.'));
    }
  };
  await assert.rejects(
    sendRuntimeMessage(promiseRuntime, { type: 'GET_STATUS' }),
    /Extension context invalidated/
  );
});


test('oversized selection clears the old path and remains the local error after an empty collapse', async () => {
  const panel = createPanelHarness();
  const messages = [];
  const copied = [];
  let selectedText = 'safe selection';
  const controller = createContentController({
    createPanel: panel.createPanel,
    validateSelectedText,
    readSelection: () => selectedText,
    sendMessage: async (message) => {
      messages.push({ ...message });
      if (message.type === 'GET_STATUS') {
        return { ok: true, enabled: true, configured: true, level: 'child' };
      }
      return { ok: true, explanation: 'old explanation', requestId: message.requestId };
    },
    writeClipboard: async (text) => { copied.push(text); }
  });
  await controller.start();
  await panel.callbacks.onExplain();

  selectedText = 'x'.repeat(20_001);
  assert.equal(controller.captureSelection(), false);
  selectedText = '';
  assert.equal(controller.captureSelection(), false);
  const explanationMessages = messages.filter((message) => message.type === 'EXPLAIN_SELECTION');

  await panel.callbacks.onExplain();
  await panel.callbacks.onCopy();

  assert.equal(
    messages.filter((message) => message.type === 'EXPLAIN_SELECTION').length,
    explanationMessages.length
  );
  assert.equal(panel.calls.selections.at(-1), '');
  assert.deepEqual(panel.calls.errors.at(-1), {
    message: 'Select no more than 20,000 characters.',
    options: { showSettings: false }
  });
  assert.deepEqual(copied, []);
  assert.equal(panel.calls.announcements.at(-1), 'No explanation to copy.');
});

test('a changed valid selection invalidates an explanation already in flight', async () => {
  const panel = createPanelHarness();
  const pending = deferred();
  let selectedText = 'first selection';
  const controller = createContentController({
    createPanel: panel.createPanel,
    validateSelectedText,
    readSelection: () => selectedText,
    sendMessage: async (message) => message.type === 'GET_STATUS'
      ? { ok: true, enabled: true, configured: true, level: 'child' }
      : pending.promise,
    writeClipboard: async () => {}
  });
  await controller.start();

  const explanation = panel.callbacks.onExplain();
  selectedText = 'second selection';
  controller.captureSelection();
  pending.resolve({ ok: true, explanation: 'stale explanation', requestId: '1' });
  await explanation;

  assert.deepEqual(panel.calls.explanations, []);
  assert.equal(panel.calls.selections.at(-1), 'second selection');
});

test('a public status refresh invalidates an explanation already in flight', async () => {
  const panel = createPanelHarness();
  const pendingExplanation = deferred();
  const pendingStatus = deferred();
  let statusCalls = 0;
  const controller = createContentController({
    createPanel: panel.createPanel,
    validateSelectedText,
    readSelection: () => 'selected text',
    sendMessage: async (message) => {
      if (message.type === 'GET_STATUS') {
        statusCalls += 1;
        return statusCalls === 1
          ? { ok: true, enabled: true, configured: true, level: 'child' }
          : pendingStatus.promise;
      }
      return pendingExplanation.promise;
    },
    writeClipboard: async () => {}
  });
  await controller.start();

  const explanation = panel.callbacks.onExplain();
  const refresh = controller.refreshStatus();
  pendingStatus.resolve({ ok: true, enabled: false, configured: true, level: 'engineer' });
  await refresh;
  pendingExplanation.resolve({ ok: true, explanation: 'stale explanation', requestId: '1' });
  await explanation;

  assert.deepEqual(panel.calls.explanations, []);
  assert.equal(panel.calls.visible.at(-1), false);
  assert.equal(panel.calls.levels.at(-1), 'engineer');
});

test('a newly captured selection makes a rendered explanation non-copyable', async () => {
  const panel = createPanelHarness();
  const copied = [];
  let selectedText = 'first selection';
  const controller = createContentController({
    createPanel: panel.createPanel,
    validateSelectedText,
    readSelection: () => selectedText,
    sendMessage: async (message) => message.type === 'GET_STATUS'
      ? { ok: true, enabled: true, configured: true, level: 'child' }
      : { ok: true, explanation: 'first explanation', requestId: message.requestId },
    writeClipboard: async (text) => { copied.push(text); }
  });
  await controller.start();
  await panel.callbacks.onExplain();

  selectedText = 'second selection';
  controller.captureSelection();
  await panel.callbacks.onCopy();

  assert.deepEqual(copied, []);
  assert.equal(panel.calls.announcements.at(-1), 'No explanation to copy.');
});

test('configured false-to-true refresh resets the panel to the current ready selection', async () => {
  const panel = createPanelHarness();
  let statusCalls = 0;
  const controller = createContentController({
    createPanel: panel.createPanel,
    validateSelectedText,
    readSelection: () => 'selected text',
    sendMessage: async () => {
      statusCalls += 1;
      return statusCalls === 1
        ? { ok: true, enabled: true, configured: false, level: 'child' }
        : { ok: true, enabled: true, configured: true, level: 'engineer' };
    },
    writeClipboard: async () => {}
  });
  await controller.start();
  const selectionResetCount = panel.calls.selections.length;

  await controller.refreshStatus();

  assert.ok(panel.calls.selections.length > selectionResetCount);
  assert.equal(panel.calls.selections.at(-1), 'selected text');
  assert.equal(panel.calls.visible.at(-1), true);
  assert.equal(panel.calls.levels.at(-1), 'engineer');
});


test('an oversized selection invalidates an explanation already in flight', async () => {
  const panel = createPanelHarness();
  const pending = deferred();
  let selectedText = 'safe selection';
  const controller = createContentController({
    createPanel: panel.createPanel,
    validateSelectedText,
    readSelection: () => selectedText,
    sendMessage: async (message) => message.type === 'GET_STATUS'
      ? { ok: true, enabled: true, configured: true, level: 'child' }
      : pending.promise,
    writeClipboard: async () => {}
  });
  await controller.start();

  const explanation = panel.callbacks.onExplain();
  selectedText = 'x'.repeat(20_001);
  controller.captureSelection();
  pending.resolve({ ok: true, explanation: 'stale explanation', requestId: '1' });
  await explanation;

  assert.deepEqual(panel.calls.explanations, []);
  assert.deepEqual(panel.calls.errors.at(-1), {
    message: 'Select no more than 20,000 characters.',
    options: { showSettings: false }
  });
});

test('a public status refresh makes a rendered explanation non-copyable', async () => {
  const panel = createPanelHarness();
  const copied = [];
  const controller = createContentController({
    createPanel: panel.createPanel,
    validateSelectedText,
    readSelection: () => 'selected text',
    sendMessage: async (message) => message.type === 'GET_STATUS'
      ? { ok: true, enabled: true, configured: true, level: 'child' }
      : { ok: true, explanation: 'rendered explanation', requestId: message.requestId },
    writeClipboard: async (text) => { copied.push(text); }
  });
  await controller.start();
  await panel.callbacks.onExplain();

  await controller.refreshStatus();
  await panel.callbacks.onCopy();

  assert.deepEqual(copied, []);
  assert.equal(panel.calls.announcements.at(-1), 'No explanation to copy.');
});


test('web-search preference initializes the panel and is sent per request', async () => {
  const panel = createPanelHarness();
  const messages = [];
  const controller = createContentController({
    createPanel: panel.createPanel,
    validateSelectedText,
    readSelection: () => 'current information',
    sendMessage: async (message) => {
      messages.push(message);
      return message.type === 'GET_STATUS'
        ? { ok: true, enabled: true, configured: true, level: 'engineer', webSearchEnabled: true }
        : { ok: true, explanation: 'Fresh sourced answer', requestId: message.requestId };
    },
    writeClipboard: async () => {}
  });

  await controller.start();
  assert.equal(panel.calls.webSearch.at(-1), true);
  await panel.callbacks.onExplain();
  assert.deepEqual(messages.at(-1), {
    type: 'EXPLAIN_SELECTION',
    text: 'current information',
    level: 'engineer',
    webSearchEnabled: true,
    requestId: '1'
  });
  assert.deepEqual(panel.calls.loading.at(-1), { webSearchEnabled: true });
});
