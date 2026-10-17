import test from "node:test";
import assert from "node:assert/strict";
import { createPopupController } from "../popup/popup-controller.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function queueResponder(entries) {
  let index = 0;
  return async () => {
    const entry = entries[index++];
    if (entry instanceof Error) throw entry;
    return typeof entry === "function" ? entry() : entry;
  };
}

function createHarness(responder) {
  const messages = [];
  const views = [];
  let closeCalls = 0;
  const controller = createPopupController({
    sendMessage: async (message) => {
      messages.push({ ...message });
      return responder(message, messages.length - 1);
    },
    render: (view) => views.push({ ...view }),
    close: () => {
      closeCalls += 1;
    }
  });

  return {
    controller,
    messages,
    lastView: () => views.at(-1),
    closeCalls: () => closeCalls
  };
}

test("successful initial load enables the toggle with authoritative status", async () => {
  const harness = createHarness(queueResponder([
    { ok: true, enabled: true, configured: true }
  ]));

  await harness.controller.load();

  assert.deepEqual(harness.messages, [{ type: "GET_STATUS" }]);
  assert.deepEqual(harness.lastView(), {
    enabled: true,
    toggleDisabled: false,
    configurationText: "Ready",
    configurationKind: "ready",
    statusMessage: "",
    statusKind: "info",
    settingsDisabled: false
  });
});

test("initial status failures leave the toggle disabled and visibly unverified", async (t) => {
  const cases = [
    {
      name: "failure response",
      response: {
        ok: false,
        error: { code: "UNKNOWN", message: "Stored status unavailable." }
      },
      expectedMessage: "Stored status unavailable."
    },
    {
      name: "rejected request",
      response: new Error("runtime unavailable"),
      expectedMessage: "Could not read extension status."
    }
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const harness = createHarness(queueResponder([item.response]));

      await harness.controller.load();

      assert.equal(harness.lastView().toggleDisabled, true);
      assert.equal(harness.lastView().configurationText, "Status unverified");
      assert.equal(harness.lastView().configurationKind, "unverified");
      assert.equal(harness.lastView().statusMessage, item.expectedMessage);
      assert.equal(harness.lastView().statusKind, "error");
    });
  }
});

test("successful enabled update uses the persisted response and unlocks the toggle", async () => {
  const harness = createHarness(queueResponder([
    { ok: true, enabled: true, configured: true },
    { ok: true, enabled: false }
  ]));
  await harness.controller.load();

  await harness.controller.setEnabled(false);

  assert.deepEqual(harness.messages, [
    { type: "GET_STATUS" },
    { type: "SET_ENABLED", enabled: false }
  ]);
  assert.equal(harness.lastView().enabled, false);
  assert.equal(harness.lastView().toggleDisabled, false);
  assert.equal(harness.lastView().statusMessage, "Disabled");
  assert.equal(harness.lastView().statusKind, "success");
});

test("failed, malformed, and rejected updates reconcile from GET_STATUS", async (t) => {
  const cases = [
    {
      name: "failure response",
      response: { ok: false, error: { code: "UNKNOWN", message: "Save failed safely." } },
      expectedMessage: "Save failed safely."
    },
    {
      name: "malformed success",
      response: { ok: true },
      expectedMessage: "Could not update extension status."
    },
    {
      name: "rejected request",
      response: new Error("runtime unavailable"),
      expectedMessage: "Could not update extension status."
    }
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const harness = createHarness(queueResponder([
        { ok: true, enabled: true, configured: true },
        item.response,
        { ok: true, enabled: true, configured: true }
      ]));
      await harness.controller.load();

      await harness.controller.setEnabled(false);

      assert.deepEqual(harness.messages, [
        { type: "GET_STATUS" },
        { type: "SET_ENABLED", enabled: false },
        { type: "GET_STATUS" }
      ]);
      assert.equal(harness.lastView().enabled, true);
      assert.equal(harness.lastView().toggleDisabled, false);
      assert.equal(harness.lastView().configurationText, "Ready");
      assert.equal(harness.lastView().statusMessage, item.expectedMessage);
      assert.equal(harness.lastView().statusKind, "error");
    });
  }
});

test("failed reconciliation keeps the last verified value disabled and unverified", async () => {
  const harness = createHarness(queueResponder([
    { ok: true, enabled: true, configured: true },
    { ok: false, error: { code: "UNKNOWN", message: "Save failed safely." } },
    new Error("status unavailable")
  ]));
  await harness.controller.load();

  await harness.controller.setEnabled(false);

  assert.equal(harness.lastView().enabled, true);
  assert.equal(harness.lastView().toggleDisabled, true);
  assert.equal(harness.lastView().configurationText, "Status unverified");
  assert.equal(harness.lastView().configurationKind, "unverified");
  assert.equal(harness.lastView().statusMessage, "Save failed safely.");
  assert.equal(harness.lastView().statusKind, "error");
});

test("stale reconciliation cannot overwrite a newer successful update", async () => {
  const staleStatus = deferred();
  const reconciliationStarted = deferred();
  let getCalls = 0;
  const harness = createHarness(async (message) => {
    if (message.type === "GET_STATUS") {
      getCalls += 1;
      if (getCalls === 1) {
        return { ok: true, enabled: true, configured: true };
      }
      reconciliationStarted.resolve();
      return staleStatus.promise;
    }
    if (message.enabled === false) {
      return { ok: false, error: { code: "UNKNOWN", message: "First update failed." } };
    }
    return { ok: true, enabled: true };
  });
  await harness.controller.load();

  const olderUpdate = harness.controller.setEnabled(false);
  await reconciliationStarted.promise;
  await harness.controller.setEnabled(true);
  staleStatus.resolve({ ok: true, enabled: false, configured: false });
  await olderUpdate;

  assert.equal(harness.lastView().enabled, true);
  assert.equal(harness.lastView().toggleDisabled, false);
  assert.equal(harness.lastView().configurationText, "Ready");
  assert.equal(harness.lastView().statusMessage, "Enabled");
  assert.equal(harness.lastView().statusKind, "success");
});

test("OPEN_OPTIONS success closes the popup", async () => {
  const harness = createHarness(queueResponder([{ ok: true }]));

  await harness.controller.openOptions();

  assert.deepEqual(harness.messages, [{ type: "OPEN_OPTIONS" }]);
  assert.equal(harness.closeCalls(), 1);
  assert.equal(harness.lastView().settingsDisabled, false);
});

test("OPEN_OPTIONS failures do not close the popup", async (t) => {
  for (const response of [
    { ok: false, error: { code: "UNKNOWN", message: "Settings unavailable." } },
    new Error("runtime unavailable")
  ]) {
    await t.test(response instanceof Error ? "rejected request" : "failure response", async () => {
      const harness = createHarness(queueResponder([response]));

      await harness.controller.openOptions();

      assert.equal(harness.closeCalls(), 0);
      assert.equal(harness.lastView().settingsDisabled, false);
      assert.equal(harness.lastView().statusKind, "error");
    });
  }
});

test("newer settings failure feedback survives an older toggle success", async () => {
  const toggleResponse = deferred();
  const harness = createHarness(async (message) => {
    if (message.type === "GET_STATUS") {
      return { ok: true, enabled: true, configured: true };
    }
    if (message.type === "SET_ENABLED") return toggleResponse.promise;
    return { ok: false, error: { code: "UNKNOWN", message: "Settings unavailable." } };
  });
  await harness.controller.load();

  const olderToggle = harness.controller.setEnabled(false);
  await harness.controller.openOptions();
  toggleResponse.resolve({ ok: true, enabled: false });
  await olderToggle;

  assert.equal(harness.lastView().enabled, false);
  assert.equal(harness.lastView().toggleDisabled, false);
  assert.equal(harness.lastView().settingsDisabled, false);
  assert.equal(harness.lastView().statusMessage, "Settings unavailable.");
  assert.equal(harness.lastView().statusKind, "error");
});

test("newer toggle success feedback survives an older settings failure", async () => {
  const settingsResponse = deferred();
  const harness = createHarness(async (message) => {
    if (message.type === "GET_STATUS") {
      return { ok: true, enabled: true, configured: true };
    }
    if (message.type === "OPEN_OPTIONS") return settingsResponse.promise;
    return { ok: true, enabled: false };
  });
  await harness.controller.load();

  const olderSettings = harness.controller.openOptions();
  await harness.controller.setEnabled(false);
  settingsResponse.resolve({
    ok: false,
    error: { code: "UNKNOWN", message: "Settings unavailable." }
  });
  await olderSettings;

  assert.equal(harness.lastView().enabled, false);
  assert.equal(harness.lastView().toggleDisabled, false);
  assert.equal(harness.lastView().settingsDisabled, false);
  assert.equal(harness.lastView().statusMessage, "Disabled");
  assert.equal(harness.lastView().statusKind, "success");
  assert.equal(harness.closeCalls(), 0);
});

test("older load completion updates authoritative state without replacing newer settings feedback", async () => {
  const statusResponse = deferred();
  const harness = createHarness(async (message) => {
    if (message.type === "GET_STATUS") return statusResponse.promise;
    return { ok: false, error: { code: "UNKNOWN", message: "Settings unavailable." } };
  });

  const olderLoad = harness.controller.load();
  await harness.controller.openOptions();
  statusResponse.resolve({ ok: true, enabled: true, configured: true });
  await olderLoad;

  assert.equal(harness.lastView().enabled, true);
  assert.equal(harness.lastView().toggleDisabled, false);
  assert.equal(harness.lastView().configurationText, "Ready");
  assert.equal(harness.lastView().statusMessage, "Settings unavailable.");
  assert.equal(harness.lastView().statusKind, "error");
});
