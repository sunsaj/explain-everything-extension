import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computedRootAccesses,
  exactRuntimeGetUrlReference,
  extractJavaScriptReferences,
  extractJavaScriptResourceSinks,
  networkPrimitivesIn,
  sharedApiExposures,
  verifyJavaScriptResourceSinks
} from "./helpers/package-verifier.js";

test("network lexer ignores inert fetch text and comments", () => {
  const source = [
    "const single = 'fetch';",
    "const double = \"fetch\";",
    "const template = `fetch is documentation`;",
    "// fetch('/comment')",
    "/* fetch('/block-comment') */"
  ].join("\n");

  assert.deepEqual(networkPrimitivesIn(source), []);
});


test("JavaScript reference extractors ignore URLs that appear only in comments", () => {
  const source = "// Help text may mention https://example.com without loading it.\n";
  assert.deepEqual(extractJavaScriptReferences(source), []);
  assert.deepEqual(extractJavaScriptResourceSinks(source), []);
});

test("network lexer preserves executable template expressions including regex literals", () => {
  assert.deepEqual(
    networkPrimitivesIn("const value = `${fetch('/private')}`;"),
    ["fetch"]
  );
  assert.deepEqual(
    networkPrimitivesIn("const value = `${/}/.test('}') ? fetch('/private') : ''}`;"),
    ["fetch"]
  );
});

test("computed-root scanner detects optional and parenthesized roots", () => {
  const source = [
    "void settings?.[key];",
    "void (chrome)[key];",
    "void globalThis?.[key];",
    "void (window)[key];"
  ].join("\n");

  assert.deepEqual(
    computedRootAccesses(source, ["settings", "chrome", "globalThis", "window", "self"]),
    ["settings", "chrome", "globalThis", "window"]
  );
});

test("shared API exposure scanner detects static, dynamic, and re-exported namespaces", () => {
  assert.deepEqual(
    sharedApiExposures(
      "import * as api from '../shared/api.js';",
      "popup/popup.js"
    ),
    ["namespace import"]
  );
  assert.deepEqual(
    sharedApiExposures(
      "const api = await import('../shared/api.js');",
      "popup/popup.js"
    ),
    ["dynamic import"]
  );
  assert.deepEqual(
    sharedApiExposures(
      "export * as api from './api.js';",
      "shared/controller.js"
    ),
    ["namespace re-export"]
  );
});

test("resource-sink extractor detects logical and computed assignments", () => {
  const sinks = extractJavaScriptResourceSinks([
    "script.src ||= remoteUrl;",
    "style[`href`] = remoteUrl;",
    "frame.setAttribute('src', remoteUrl);"
  ].join("\n"));

  assert.deepEqual(
    sinks.map(({ kind, attribute, operator }) => ({ kind, attribute, operator })),
    [
      { kind: "property", attribute: "src", operator: "||=" },
      { kind: "property", attribute: "href", operator: "=" },
      { kind: "setAttribute", attribute: "src", operator: null }
    ]
  );
});

test("exact runtime getURL accepts only a complete local sink value", () => {
  assert.equal(
    exactRuntimeGetUrlReference(
      " chrome.runtime.getURL(\"content/panel.css\");",
      "property"
    ),
    "content/panel.css"
  );
  assert.equal(
    exactRuntimeGetUrlReference(
      " chrome.runtime.getURL('content/panel.css'));",
      "setAttribute"
    ),
    "content/panel.css"
  );
  assert.equal(
    exactRuntimeGetUrlReference(
      " chrome.runtime.getURL(\"content/panel.css\") || remoteUrl;",
      "property"
    ),
    null
  );
  assert.equal(
    exactRuntimeGetUrlReference(" remoteUrl;", "property"),
    null
  );
});

test("low-level resource sink verifier accepts only root-contained exact getURL files", async () => {
  const root = await mkdtemp(join(tmpdir(), "selection-explainer-sink-unit-"));
  const sourcePath = join(root, "popup.js");
  try {
    await mkdir(join(root, "content"), { recursive: true });
    await writeFile(join(root, "content", "panel.css"), "body {}\n", "utf8");
    await writeFile(sourcePath, "", "utf8");

    await assert.doesNotReject(() => verifyJavaScriptResourceSinks(
      root,
      sourcePath,
      "panel.href = chrome.runtime.getURL('content/panel.css');"
    ));
    await assert.rejects(
      () => verifyJavaScriptResourceSinks(
        root,
        sourcePath,
        "panel.href = chrome.runtime.getURL('content/missing.css');"
      ),
      /missing referenced file/i
    );
    await assert.rejects(
      () => verifyJavaScriptResourceSinks(
        root,
        sourcePath,
        "panel.href = chrome.runtime.getURL('../outside.css');"
      ),
      /escapes the extension package/i
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
