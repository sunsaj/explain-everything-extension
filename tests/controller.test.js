import test from "node:test";
import assert from "node:assert/strict";
import { requestExplanation } from "../shared/api.js";
import { createMessageHandler } from "../shared/controller.js";

const configuredSettings = {
  enabled: true,
  endpoint: "https://proxy.example.com",
  apiKey: "secret-key",
  model: "engineering-model",
  level: "child",
  systemPrompt: "Explain clearly.",
  webSearchEnabled: false,
  settingsVersion: 2
};

const genericFailure = {
  ok: false,
  error: {
    code: "UNKNOWN",
    message: "The extension could not complete the request. Retry or open settings."
  }
};

function createDependencies(overrides = {}) {
  return {
    loadSettings: async () => configuredSettings,
    saveEnabled: async () => {},
    saveConfiguration: async (configuration) => ({ ...configuredSettings, ...configuration }),
    explain: async () => "Explained",
    openOptions: async () => {},
    isTrustedOptionsSender: (sender) => sender?.url === "chrome-extension://test/options/options.html",
    ...overrides
  };
}

test("GET_STATUS reports readiness without returning the API key", async () => {
  const handler = createMessageHandler(createDependencies());

  const response = await handler({ type: "GET_STATUS" }, {});

  assert.deepEqual(response, { ok: true, enabled: true, configured: true, level: 'child', webSearchEnabled: false });
  assert.equal(JSON.stringify(response).includes("secret-key"), false);
});

test("GET_STATUS sanitizes arbitrary dependency errors", async () => {
  const handler = createMessageHandler(createDependencies({
    loadSettings: async () => {
      throw Object.assign(
        new Error("secret-key provider payload"),
        { code: "AUTH" }
      );
    }
  }));

  const response = await handler({ type: "GET_STATUS" }, {});

  assert.deepEqual(response, genericFailure);
  assert.equal(JSON.stringify(response).includes("secret-key"), false);
});

test("unknown and malformed message types return BAD_MESSAGE failures", async () => {
  const handler = createMessageHandler(createDependencies());

  assert.deepEqual(await handler({ type: "UNKNOWN" }, {}), {
    ok: false,
    error: { code: "BAD_MESSAGE", message: "Unknown extension message." }
  });
  assert.deepEqual(await handler(null, {}), {
    ok: false,
    error: { code: "BAD_MESSAGE", message: "Invalid extension message." }
  });
});

test("SET_ENABLED persists and returns a boolean enabled value", async () => {
  const savedValues = [];
  const handler = createMessageHandler(createDependencies({
    saveEnabled: async (enabled) => {
      savedValues.push(enabled);
    }
  }));

  const response = await handler({ type: "SET_ENABLED", enabled: false }, {});

  assert.deepEqual(response, { ok: true, enabled: false });
  assert.deepEqual(savedValues, [false]);
});

test("SET_ENABLED rejects non-boolean values without saving", async () => {
  let saveCalls = 0;
  const handler = createMessageHandler(createDependencies({
    saveEnabled: async () => {
      saveCalls += 1;
    }
  }));

  const response = await handler({ type: "SET_ENABLED", enabled: "false" }, {});

  assert.deepEqual(response, {
    ok: false,
    error: { code: "BAD_MESSAGE", message: "Enabled must be boolean." }
  });
  assert.equal(saveCalls, 0);
});

test("EXPLAIN_SELECTION validates, normalizes, and forwards a string request ID", async () => {
  let captured;
  const handler = createMessageHandler(createDependencies({
    explain: async (settings, text, level, webSearchEnabled) => {
      captured = { settings, text, level, webSearchEnabled };
      return "Detailed explanation";
    }
  }));

  const response = await handler({
    type: "EXPLAIN_SELECTION",
    text: "  useful   text  ",
    level: "engineer",
    webSearchEnabled: true,
    requestId: "request-42"
  }, {});

  assert.deepEqual(response, {
    ok: true,
    explanation: "Detailed explanation",
    requestId: "request-42"
  });
  assert.equal(captured.settings.apiKey, "secret-key");
  assert.equal(captured.text, "useful text");
  assert.equal(captured.level, "engineer");
  assert.equal(captured.webSearchEnabled, true);
  assert.equal(JSON.stringify(response).includes("secret-key"), false);
});

test("EXPLAIN_SELECTION rejects malformed request IDs without coercion or dependencies", async () => {
  let coercions = 0;
  let loadCalls = 0;
  let explainCalls = 0;
  const coercibleId = {
    toString() {
      coercions += 1;
      return "coerced-request";
    }
  };
  const handler = createMessageHandler(createDependencies({
    loadSettings: async () => {
      loadCalls += 1;
      return configuredSettings;
    },
    explain: async () => {
      explainCalls += 1;
      return "unreachable";
    }
  }));

  for (const requestId of [42, "", "   ", coercibleId]) {
    const response = await handler({
      type: "EXPLAIN_SELECTION",
      text: "Selected text",
      level: "child",
      requestId
    }, {});
    assert.deepEqual(response, {
      ok: false,
      error: {
        code: "BAD_MESSAGE",
        message: "Request ID must be a non-empty string."
      }
    });
    assert.equal("requestId" in response, false);
  }
  assert.equal(coercions, 0);
  assert.equal(loadCalls, 0);
  assert.equal(explainCalls, 0);
});

test("EXPLAIN_SELECTION echoes request ID on selection validation failures", async () => {
  let loadCalls = 0;
  let explainCalls = 0;
  const handler = createMessageHandler(createDependencies({
    loadSettings: async () => {
      loadCalls += 1;
      return configuredSettings;
    },
    explain: async () => {
      explainCalls += 1;
      return "unreachable";
    }
  }));

  const response = await handler({
    type: "EXPLAIN_SELECTION",
    text: "   ",
    level: "child",
    requestId: "request-selection"
  }, {});

  assert.deepEqual(response, {
    ok: false,
    error: { code: "NO_SELECTION", message: "Highlight some text first." },
    requestId: "request-selection"
  });
  assert.equal(loadCalls, 0);
  assert.equal(explainCalls, 0);
});

test("EXPLAIN_SELECTION echoes request ID on level validation failures", async () => {
  let loadCalls = 0;
  const handler = createMessageHandler(createDependencies({
    loadSettings: async () => {
      loadCalls += 1;
      return configuredSettings;
    }
  }));

  const response = await handler({
    type: "EXPLAIN_SELECTION",
    text: "Selected text",
    level: "expert",
    requestId: "request-level"
  }, {});

  assert.deepEqual(response, {
    ok: false,
    error: { code: "BAD_LEVEL", message: "Invalid explanation level." },
    requestId: "request-level"
  });
  assert.equal(loadCalls, 0);
});

test("EXPLAIN_SELECTION echoes request ID on incomplete configuration", async () => {
  let explainCalls = 0;
  const handler = createMessageHandler(createDependencies({
    loadSettings: async () => ({ enabled: true, endpoint: "", apiKey: "", model: "" }),
    explain: async () => {
      explainCalls += 1;
      return "unreachable";
    }
  }));

  const response = await handler({
    type: "EXPLAIN_SELECTION",
    text: "Selected text",
    level: "child",
    requestId: "request-config"
  }, {});

  assert.deepEqual(response, {
    ok: false,
    error: {
      code: "NOT_CONFIGURED",
      message: "Configure the LiteLLM endpoint, key, and model first."
    },
    requestId: "request-config"
  });
  assert.equal(explainCalls, 0);
});

test("EXPLAIN_SELECTION preserves safe request errors and echoes request ID", async () => {
  const handler = createMessageHandler(createDependencies({
    explain: async (settings, text, level) => requestExplanation(
      settings,
      text,
      level,
      {
        fetchImpl: async () => ({ ok: false, status: 401 })
      }
    )
  }));

  const response = await handler({
    type: "EXPLAIN_SELECTION",
    text: "Selected text",
    level: "child",
    requestId: "request-auth"
  }, {});

  assert.deepEqual(response, {
    ok: false,
    error: {
      code: "AUTH",
      message: "Check the API key and LiteLLM permissions."
    },
    requestId: "request-auth"
  });
});

test("EXPLAIN_SELECTION sanitizes arbitrary coded dependency errors and echoes request ID", async () => {
  const handler = createMessageHandler(createDependencies({
    explain: async () => {
      throw Object.assign(
        new Error("secret-key provider payload"),
        { code: "AUTH", status: 418 }
      );
    }
  }));

  const response = await handler({
    type: "EXPLAIN_SELECTION",
    text: "Selected text",
    level: "child",
    requestId: "request-dependency"
  }, {});

  assert.deepEqual(response, {
    ...genericFailure,
    requestId: "request-dependency"
  });
  assert.equal(JSON.stringify(response).includes("secret-key"), false);
  assert.equal(JSON.stringify(response).includes("418"), false);
});

test("OPEN_OPTIONS invokes the dependency and returns success", async () => {
  let openCalls = 0;
  const handler = createMessageHandler(createDependencies({
    openOptions: async () => {
      openCalls += 1;
    }
  }));

  const response = await handler({ type: "OPEN_OPTIONS" }, {});

  assert.deepEqual(response, { ok: true });
  assert.equal(openCalls, 1);
});


test("EXPLAIN_SELECTION rejects requests while the extension is disabled", async () => {
  let explainCalls = 0;
  const handler = createMessageHandler(createDependencies({
    loadSettings: async () => ({ ...configuredSettings, enabled: false }),
    explain: async () => { explainCalls += 1; return "unreachable"; }
  }));

  const response = await handler({
    type: "EXPLAIN_SELECTION",
    text: "Selected text",
    level: "child",
    requestId: "disabled-request"
  }, {});

  assert.deepEqual(response, {
    ok: false,
    error: { code: "DISABLED", message: "The extension is disabled." },
    requestId: "disabled-request"
  });
  assert.equal(explainCalls, 0);
});

test("SAVE_CONFIGURATION accepts only validated configuration fields from the options page", async () => {
  let captured;
  const handler = createMessageHandler(createDependencies({
    saveConfiguration: async (configuration) => {
      captured = configuration;
      return { ...configuredSettings, ...configuration, enabled: false };
    }
  }));
  const configuration = {
    endpoint: "https://new.example.com/v1",
    apiKey: "new-key",
    model: "new-model",
    level: "engineer",
    systemPrompt: "Explain safely.",
    webSearchEnabled: true,
    enabled: true,
    settingsVersion: 999,
    extra: "ignored"
  };

  const response = await handler(
    { type: "SAVE_CONFIGURATION", configuration },
    { url: "chrome-extension://test/options/options.html" }
  );

  assert.deepEqual(captured, {
    endpoint: "https://new.example.com/v1",
    apiKey: "new-key",
    model: "new-model",
    level: "engineer",
    systemPrompt: "Explain safely.",
    webSearchEnabled: true
  });
  assert.deepEqual(response, { ok: true, enabled: false });
  assert.equal(JSON.stringify(response).includes("new-key"), false);
});

test("SAVE_CONFIGURATION rejects invalid or untrusted configuration messages", async () => {
  let saveCalls = 0;
  const handler = createMessageHandler(createDependencies({
    saveConfiguration: async () => { saveCalls += 1; }
  }));

  const invalid = await handler({
    type: "SAVE_CONFIGURATION",
    configuration: {
      endpoint: "https://new.example.com",
      apiKey: "key",
      model: "model",
      level: "expert",
      systemPrompt: "Prompt"
    }
  }, { url: "chrome-extension://test/options/options.html" });
  const untrusted = await handler({
    type: "SAVE_CONFIGURATION",
    configuration: {
      endpoint: "https://new.example.com",
      apiKey: "key",
      model: "model",
      level: "child",
      systemPrompt: "Prompt"
    }
  }, { url: "https://hostile.example/page" });

  assert.deepEqual(invalid, {
    ok: false,
    error: { code: "BAD_MESSAGE", message: "Invalid configuration." }
  });
  assert.deepEqual(untrusted, {
    ok: false,
    error: { code: "FORBIDDEN", message: "This message is not allowed from this context." }
  });
  assert.equal(saveCalls, 0);
});

test("TEST_CONNECTION is options-only, uses a fixed sample, and remains allowed while disabled", async () => {
  let captured;
  const handler = createMessageHandler(createDependencies({
    loadSettings: async () => ({ ...configuredSettings, enabled: false, level: "engineer" }),
    explain: async (settings, text, level, webSearchEnabled) => {
      captured = { settings, text, level, webSearchEnabled };
      return "Connection works";
    }
  }));

  const forbidden = await handler(
    { type: "TEST_CONNECTION" },
    { url: "https://hostile.example/page" }
  );
  const response = await handler(
    { type: "TEST_CONNECTION" },
    { url: "chrome-extension://test/options/options.html" }
  );

  assert.deepEqual(forbidden, {
    ok: false,
    error: { code: "FORBIDDEN", message: "This message is not allowed from this context." }
  });
  assert.deepEqual(response, { ok: true, explanation: "Connection works" });
  assert.equal(captured.settings.enabled, false);
  assert.equal(captured.text, "A triangle has three sides.");
  assert.equal(captured.level, "engineer");
  assert.equal(captured.webSearchEnabled, false);
});


test("GET_CONFIGURATION returns private settings only to the trusted options page", async () => {
  const handler = createMessageHandler(createDependencies());
  const forbidden = await handler(
    { type: "GET_CONFIGURATION" },
    { url: "https://hostile.example/page" }
  );
  const response = await handler(
    { type: "GET_CONFIGURATION" },
    { url: "chrome-extension://test/options/options.html" }
  );

  assert.deepEqual(forbidden, {
    ok: false,
    error: { code: "FORBIDDEN", message: "This message is not allowed from this context." }
  });
  assert.deepEqual(response, { ok: true, settings: configuredSettings });
});


test("EXPLAIN_SELECTION rejects a non-boolean web-search flag", async () => {
  let explainCalls = 0;
  const handler = createMessageHandler(createDependencies({
    explain: async () => { explainCalls += 1; return "unreachable"; }
  }));
  const response = await handler({
    type: "EXPLAIN_SELECTION",
    text: "Selected text",
    level: "child",
    webSearchEnabled: "yes",
    requestId: "bad-web-search"
  }, {});
  assert.deepEqual(response, {
    ok: false,
    error: { code: "BAD_MESSAGE", message: "Web search flag must be boolean." },
    requestId: "bad-web-search"
  });
  assert.equal(explainCalls, 0);
});
