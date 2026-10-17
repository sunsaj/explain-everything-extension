import test from "node:test";
import assert from "node:assert/strict";
import { FakeEvent, getFakeShadowRoot, installFakeDom } from "./helpers/fake-dom.js";

const panelUrl = new URL("../content/panel.js", import.meta.url);
const HOST_TAG = "selection-explainer-panel-host";
let importSequence = 0;

async function importPanelModule() {
  importSequence += 1;
  return import(`${panelUrl.href}?behavior=${importSequence}`);
}

function ownedHost(document) {
  return document.querySelectorAll(HOST_TAG)
    .find((element) => element.hasAttribute("data-selection-explainer-owned")) ?? null;
}

function trustedClick(element) {
  element.dispatchEvent(new FakeEvent("click", { isTrusted: true }));
}

function byLabel(shadow, label) {
  const element = shadow.querySelector(`[aria-label="${label}"]`);
  assert.ok(element, `missing control labelled ${label}`);
  return element;
}

test("owned host lifecycle never deletes colliding page content and protects critical styles", async () => {
  const environment = installFakeDom();
  const { document } = environment;
  const publicIdCollision = document.createElement("div");
  publicIdCollision.id = "selection-explainer-host";
  const customTagCollision = document.createElement(HOST_TAG);
  document.documentElement.append(publicIdCollision, customTagCollision);

  try {
    const { createExplainerPanel } = await importPanelModule();
    const firstController = createExplainerPanel({});
    const firstHost = ownedHost(document);

    assert.ok(firstHost);
    assert.equal(publicIdCollision.isConnected, true);
    assert.equal(customTagCollision.isConnected, true);
    assert.equal(document.querySelectorAll(HOST_TAG).length, 2);

    const protectedStyles = {
      all: "initial",
      position: "fixed",
      inset: "auto 16px 16px auto",
      display: "block",
      "z-index": "2147483647",
      "pointer-events": "none",
      "font-family": "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      "font-size": "16px",
      "line-height": "1.5",
      color: "CanvasText",
      "color-scheme": "light dark"
    };
    for (const [property, value] of Object.entries(protectedStyles)) {
      assert.equal(firstHost.style.getPropertyValue(property), value, property);
      assert.equal(firstHost.style.getPropertyPriority(property), "important", property);
    }

    const secondController = createExplainerPanel({});
    const secondHost = ownedHost(document);
    assert.notEqual(secondHost, firstHost);
    assert.equal(firstHost.isConnected, false);
    assert.equal(publicIdCollision.isConnected, true);
    assert.equal(customTagCollision.isConnected, true);
    assert.equal(document.querySelectorAll(HOST_TAG).length, 2);

    secondController.destroy();
    assert.equal(secondHost.isConnected, false);
    assert.equal(publicIdCollision.isConnected, true);
    assert.equal(customTagCollision.isConnected, true);
    assert.equal(document.querySelectorAll(HOST_TAG).length, 1);

    firstController.destroy();
  } finally {
    environment.restore();
  }
});

test("host page cannot inspect the closed panel or trigger privileged actions with synthetic events", async () => {
  const environment = installFakeDom();
  let explainCalls = 0;
  let retryCalls = 0;

  try {
    const { createExplainerPanel } = await importPanelModule();
    const controller = createExplainerPanel({
      onExplain: () => { explainCalls += 1; },
      onRetry: () => { retryCalls += 1; }
    });
    const host = ownedHost(environment.document);
    const internalShadow = getFakeShadowRoot(host);

    assert.ok(host);
    assert.equal(host.shadowRoot, null);
    assert.equal(host.querySelector('[aria-label="Explain"]'), null);
    assert.equal(host.textContent, "");

    controller.setExplanation("Private explanation text");
    assert.equal(host.textContent.includes("Private explanation text"), false);

    byLabel(internalShadow, "Explain").click();
    byLabel(internalShadow, "Retry").click();
    assert.equal(explainCalls, 0);
    assert.equal(retryCalls, 0);

    trustedClick(byLabel(internalShadow, "Explain"));
    trustedClick(byLabel(internalShadow, "Retry"));
    assert.equal(explainCalls, 1);
    assert.equal(retryCalls, 1);
    controller.destroy();
  } finally {
    environment.restore();
  }
});

test("panel controls call only their exact callbacks and launcher includes a decorative spark", async () => {
  const environment = installFakeDom();
  const calls = {
    explain: 0,
    retry: 0,
    copy: 0,
    settings: 0,
    close: 0
  };

  try {
    const { createExplainerPanel } = await importPanelModule();
    const controller = createExplainerPanel({
      onExplain: () => { calls.explain += 1; },
      onRetry: () => { calls.retry += 1; },
      onCopy: () => { calls.copy += 1; },
      onSettings: () => { calls.settings += 1; },
      onClose: () => { calls.close += 1; }
    });
    const host = ownedHost(environment.document);
    const shadow = getFakeShadowRoot(host);
    const launcher = byLabel(shadow, "Explain selected text");
    const spark = shadow.querySelector(".launcher__icon");

    assert.ok(spark);
    assert.equal(spark.textContent, "✦");
    assert.equal(spark.getAttribute("aria-hidden"), "true");

    launcher.click();
    trustedClick(byLabel(shadow, "Explain"));
    controller.setExplanation("Ready");
    byLabel(shadow, "Copy").click();
    trustedClick(byLabel(shadow, "Retry"));
    byLabel(shadow, "Settings").click();
    byLabel(shadow, "Close").click();

    assert.deepEqual(calls, {
      explain: 1,
      retry: 1,
      copy: 1,
      settings: 1,
      close: 1
    });
    controller.destroy();
  } finally {
    environment.restore();
  }
});

test("controller round-trips visibility and level while rendering selection and output as text", async () => {
  const environment = installFakeDom();

  try {
    const { createExplainerPanel } = await importPanelModule();
    const controller = createExplainerPanel({ initialLevel: "engineer" });
    const host = ownedHost(environment.document);
    const shadow = getFakeShadowRoot(host);
    const selectionPreview = shadow.querySelector(".selection-preview");
    const response = shadow.querySelector(".response");
    const webSearch = byLabel(shadow, "Use internet search");

    assert.equal(controller.getLevel(), "engineer");
    controller.setLevel("child");
    assert.equal(controller.getLevel(), "child");
    controller.setLevel("unsupported");
    assert.equal(controller.getLevel(), "child");
    assert.equal(controller.getWebSearchEnabled(), false);
    controller.setWebSearchEnabled(true);
    assert.equal(controller.getWebSearchEnabled(), true);
    assert.equal(webSearch.checked, true);

    controller.setVisible(false);
    assert.equal(host.hidden, true);
    assert.equal(host.style.getPropertyValue("display"), "none");
    assert.equal(host.style.getPropertyPriority("display"), "important");
    controller.setVisible(true);
    assert.equal(host.hidden, false);
    assert.equal(host.style.getPropertyValue("display"), "block");

    const unsafeSelection = '<img src=x onerror="page()">';
    const unsafeExplanation = '<script>model()</script> & text';
    controller.setSelection(unsafeSelection);
    controller.setExplanation(unsafeExplanation);
    assert.equal(selectionPreview.textContent, unsafeSelection);
    assert.equal(selectionPreview.children.length, 0);
    assert.equal(response.textContent, unsafeExplanation);
    assert.equal(response.querySelector("script"), null);
    assert.equal(response.querySelectorAll("p").length, 1);

    controller.announce("Copied safely.");
    assert.equal(shadow.querySelector("[role=" + '"status"' + "]").textContent, "Copied safely.");
    controller.destroy();
  } finally {
    environment.restore();
  }
});

test("loading success and error methods update busy state actions and focus without losing selection", async () => {
  const environment = installFakeDom();

  try {
    const { createExplainerPanel } = await importPanelModule();
    const controller = createExplainerPanel({});
    const shadow = getFakeShadowRoot(ownedHost(environment.document));
    const dialog = shadow.querySelector("[role=" + '"dialog"' + "]");
    const status = shadow.querySelector("[role=" + '"status"' + "]");
    const response = shadow.querySelector(".response");
    const actions = shadow.querySelector(".result-actions");
    const preview = shadow.querySelector(".selection-preview");
    const explain = byLabel(shadow, "Explain");
    const retry = byLabel(shadow, "Retry");
    const copy = byLabel(shadow, "Copy");
    const settings = byLabel(shadow, "Settings");
    const webSearch = byLabel(shadow, "Use internet search");

    controller.setSelection("Keep this selection");
    controller.setWebSearchEnabled(true);
    controller.setLoading({ webSearchEnabled: true });
    assert.equal(dialog.hidden, false);
    assert.equal(dialog.getAttribute("aria-busy"), "true");
    assert.equal(explain.disabled, true);
    assert.equal(retry.disabled, true);
    assert.equal(status.textContent, "Searching the web and explaining…");
    assert.equal(webSearch.disabled, true);
    assert.equal(response.hidden, true);
    assert.equal(actions.hidden, true);
    assert.equal(shadow.activeElement, status);

    controller.setExplanation("## Result\n\nUse **bold** text.\n\n- One\n- Two");
    assert.equal(dialog.getAttribute("aria-busy"), "false");
    assert.equal(explain.disabled, false);
    assert.equal(retry.disabled, false);
    assert.equal(webSearch.disabled, false);
    assert.equal(response.hidden, false);
    assert.equal(response.querySelector("h2").textContent, "Result");
    assert.equal(response.querySelector("strong").textContent, "bold");
    assert.equal(response.querySelectorAll("li").length, 2);
    assert.equal(actions.hidden, false);
    assert.equal(copy.hidden, false);
    assert.equal(settings.hidden, false);
    assert.equal(shadow.activeElement, response);

    controller.setError("Try again.", { showSettings: false });
    assert.equal(dialog.getAttribute("aria-busy"), "false");
    assert.equal(status.textContent, "Try again.");
    assert.equal(response.hidden, true);
    assert.equal(actions.hidden, false);
    assert.equal(copy.hidden, true);
    assert.equal(retry.hidden, false);
    assert.equal(settings.hidden, true);
    assert.equal(preview.textContent, "Keep this selection");
    assert.equal(shadow.activeElement, status);

    controller.setError("Configure access.", { showSettings: true });
    assert.equal(settings.hidden, false);
    assert.equal(preview.textContent, "Keep this selection");
    controller.destroy();
  } finally {
    environment.restore();
  }
});

test("Escape is scoped to the shadow UI and Close restores launcher focus", async () => {
  const environment = installFakeDom();
  let closeCalls = 0;

  try {
    const { createExplainerPanel } = await importPanelModule();
    const controller = createExplainerPanel({
      onClose: () => { closeCalls += 1; }
    });
    const host = ownedHost(environment.document);
    const shadow = getFakeShadowRoot(host);
    const launcher = byLabel(shadow, "Explain selected text");
    const explain = byLabel(shadow, "Explain");
    const close = byLabel(shadow, "Close");
    const dialog = shadow.querySelector("[role=" + '"dialog"' + "]");

    assert.equal(environment.document.listenerCount("keydown"), 0);
    launcher.click();
    assert.equal(dialog.hidden, false);
    assert.equal(shadow.activeElement, explain);

    const pageEscape = new FakeEvent("keydown", { key: "Escape" });
    environment.document.dispatchEvent(pageEscape);
    assert.equal(dialog.hidden, false);
    assert.equal(pageEscape.defaultPrevented, false);
    assert.equal(closeCalls, 0);

    const panelEscape = new FakeEvent("keydown", { key: "Escape" });
    explain.dispatchEvent(panelEscape);
    assert.equal(dialog.hidden, true);
    assert.equal(panelEscape.defaultPrevented, true);
    assert.equal(panelEscape.propagationStopped, true);
    assert.equal(shadow.activeElement, launcher);
    assert.equal(closeCalls, 1);

    launcher.click();
    close.click();
    assert.equal(dialog.hidden, true);
    assert.equal(shadow.activeElement, launcher);
    assert.equal(closeCalls, 2);

    controller.destroy();
    assert.equal(host.isConnected, false);
    assert.equal(shadow.listenerCount("keydown"), 0);
  } finally {
    environment.restore();
  }
});


test("setSelection clears stale result and error UI back to an idle state", async () => {
  const environment = installFakeDom();

  try {
    const { createExplainerPanel } = await importPanelModule();
    const controller = createExplainerPanel({});
    const shadow = getFakeShadowRoot(ownedHost(environment.document));
    const dialog = shadow.querySelector('[role="dialog"]');
    const status = shadow.querySelector('[role="status"]');
    const response = shadow.querySelector('.response');
    const actions = shadow.querySelector('.result-actions');
    const preview = shadow.querySelector('.selection-preview');
    const explain = byLabel(shadow, 'Explain');
    const retry = byLabel(shadow, 'Retry');
    const settings = byLabel(shadow, 'Settings');
    const level = byLabel(shadow, 'Explanation level');

    controller.setSelection('old selection');
    controller.setError('Configure access.', { showSettings: true });
    controller.setSelection('new selection');

    assert.equal(preview.textContent, 'new selection');
    assert.equal(dialog.getAttribute('aria-busy'), 'false');
    assert.equal(status.dataset.state, 'idle');
    assert.equal(status.textContent, 'Ready to explain selected text.');
    assert.equal(response.textContent, '');
    assert.equal(response.hidden, true);
    assert.equal(actions.hidden, true);
    assert.equal(settings.hidden, true);
    assert.equal(explain.disabled, false);
    assert.equal(retry.disabled, false);
    assert.equal(level.disabled, false);

    controller.setExplanation('stale result');
    controller.setSelection('');

    assert.equal(preview.textContent, 'Select text on the page, then choose Explain.');
    assert.equal(status.dataset.state, 'idle');
    assert.equal(status.textContent, 'Select text on the page, then choose Explain.');
    assert.equal(response.textContent, '');
    assert.equal(response.hidden, true);
    assert.equal(actions.hidden, true);
    controller.destroy();
  } finally {
    environment.restore();
  }
});
