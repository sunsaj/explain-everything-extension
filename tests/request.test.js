import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_REQUEST_TIMEOUT_MS, requestExplanation } from "../shared/api.js";

const settings = {
  endpoint: "https://proxy.example.com/litellm/",
  apiKey: "secret-key",
  model: "engineering-model",
  systemPrompt: "Explain clearly."
};

function successfulResponse(content = "Explained") {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { role: "assistant", content } }]
    })
  };
}

test("default timeout stays below Chrome\'s 30-second fetch-response limit", () => {
  assert.equal(DEFAULT_REQUEST_TIMEOUT_MS, 25_000);
  assert.ok(DEFAULT_REQUEST_TIMEOUT_MS < 30_000);
});

test("returns trimmed assistant content from a successful completion request", async () => {
  const result = await requestExplanation(settings, "Selected text", "child", {
    fetchImpl: async () => successfulResponse("  Explained clearly.  ")
  });

  assert.equal(result, "Explained clearly.");
});

test("sends a hardened normalized POST request with the API key only in the Bearer header", async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return successfulResponse();
  };

  await requestExplanation(settings, "Selected text", "engineer", { fetchImpl });

  assert.equal(captured.url, "https://proxy.example.com/litellm/v1/chat/completions");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.redirect, "error");
  assert.equal(captured.init.credentials, "omit");
  assert.deepEqual(captured.init.headers, {
    Authorization: "Bearer secret-key",
    "Content-Type": "application/json"
  });
  assert.equal(typeof captured.init.signal?.aborted, "boolean");
  const body = JSON.parse(captured.init.body);
  assert.equal(body.model, "engineering-model");
  assert.equal(body.messages[1].content, "BEGIN SELECTED MATERIAL\nSelected text\nEND SELECTED MATERIAL");
  assert.equal(captured.init.body.includes("secret-key"), false);
});

test("aborts a slow request and returns the sanitized timeout error", async () => {
  let capturedSignal;
  const fetchImpl = async (_url, init) => {
    capturedSignal = init.signal;
    return await new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("secret-key upstream timeout"), { name: "AbortError" }));
      }, { once: true });
    });
  };

  await assert.rejects(
    requestExplanation(settings, "Selected text", "child", { fetchImpl, timeoutMs: 5 }),
    (error) => {
      assert.equal(error.code, "TIMEOUT");
      assert.equal(error.message, "The request took longer than 25 seconds.");
      assert.equal(error.message.includes("secret-key"), false);
      return true;
    }
  );
  assert.equal(capturedSignal.aborted, true);
});

test("clears the abort timer after an early successful response", async () => {
  let capturedSignal;
  const result = await requestExplanation(settings, "Selected text", "child", {
    timeoutMs: 5,
    fetchImpl: async (_url, init) => {
      capturedSignal = init.signal;
      return successfulResponse();
    }
  });

  assert.equal(result, "Explained");
  assert.equal(capturedSignal.aborted, false);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(capturedSignal.aborted, false);
});

test("maps a 401 response without exposing the API key or provider body", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: "secret-key was rejected" })
  });

  await assert.rejects(
    requestExplanation(settings, "Selected text", "child", { fetchImpl }),
    (error) => {
      assert.equal(error.code, "AUTH");
      assert.equal(error.status, 401);
      assert.equal(error.message, "Check the API key and LiteLLM permissions.");
      assert.equal(error.message.includes("secret-key"), false);
      return true;
    }
  );
});

test("maps invalid JSON to a sanitized malformed-response error", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error("secret-key appeared in invalid JSON");
    }
  });

  await assert.rejects(
    requestExplanation(settings, "Selected text", "child", { fetchImpl }),
    (error) => {
      assert.equal(error.code, "MALFORMED_RESPONSE");
      assert.equal(error.message, "The endpoint returned invalid JSON.");
      assert.equal(error.message.includes("secret-key"), false);
      return true;
    }
  );
});

test("rejects a structurally incompatible completion response", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { role: "assistant", content: "   " } }]
    })
  });

  await assert.rejects(
    requestExplanation(settings, "Selected text", "child", { fetchImpl }),
    (error) => error.code === "MALFORMED_RESPONSE"
      && error.message === "The endpoint did not return a compatible chat response."
  );
});

test("rejects completion messages with a missing or non-assistant role", async () => {
  for (const message of [
    { content: "Explained" },
    { role: "user", content: "Explained" }
  ]) {
    await assert.rejects(
      requestExplanation(settings, "Selected text", "child", {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message }] })
        })
      }),
      (error) => error.code === "MALFORMED_RESPONSE"
        && error.message === "The endpoint did not return a compatible chat response."
    );
  }
});

test("does not trust coded errors thrown by the fetch dependency", async () => {
  const fetchImpl = async () => {
    throw Object.assign(
      new Error("secret-key provider payload"),
      { code: "AUTH", status: 418 }
    );
  };

  await assert.rejects(
    requestExplanation(settings, "Selected text", "child", { fetchImpl }),
    (error) => {
      assert.equal(error.code, "NETWORK");
      assert.equal(error.message, "Could not reach the configured LiteLLM endpoint.");
      assert.equal("status" in error, false);
      assert.equal(JSON.stringify({ code: error.code, message: error.message }).includes("secret-key"), false);
      return true;
    }
  );
});

test("maps raw fetch failures to a sanitized network error", async () => {
  const fetchImpl = async () => {
    throw new Error("connection failed with secret-key");
  };

  await assert.rejects(
    requestExplanation(settings, "Selected text", "child", { fetchImpl }),
    (error) => {
      assert.equal(error.code, "NETWORK");
      assert.equal(error.message, "Could not reach the configured LiteLLM endpoint.");
      assert.equal(error.message.includes("secret-key"), false);
      return true;
    }
  );
});


test("uses the Responses API and native web search when enabled", async () => {
  let captured;
  const explanation = await requestExplanation(settings, "Current selected fact", "engineer", {
    webSearchEnabled: true,
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output: [{
            type: "message",
            role: "assistant",
            content: [{
              type: "output_text",
              text: "Fresh answer.",
              annotations: [{ type: "url_citation", title: "Source", url: "https://example.com/current" }]
            }]
          }]
        })
      };
    }
  });

  assert.equal(captured.url, "https://proxy.example.com/litellm/v1/responses");
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body.tools, [{ type: "web_search" }]);
  assert.equal(body.tool_choice, "auto");
  assert.match(explanation, /Fresh answer/);
  assert.ok(explanation.includes("https://example.com/current"));
});


test("returns an actionable error when native web search is rejected", async () => {
  await assert.rejects(
    requestExplanation(settings, "Current fact", "child", {
      webSearchEnabled: true,
      fetchImpl: async () => ({ ok: false, status: 400 })
    }),
    (error) => error.code === "WEB_SEARCH"
      && error.message === "Internet search was rejected by the configured model or gateway."
  );
});
