import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const popupDirectory = new URL("../popup/", import.meta.url);
const fileUrl = (name) => new URL(name, popupDirectory);

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function openingTagForId(source, id) {
  const match = source.match(new RegExp(
    "<[a-z][^>]*\\bid\\s*=\\s*[\\x22\\x27]" + id + "[\\x22\\x27][^>]*>",
    "i"
  ));
  assert.ok(match, "missing opening tag for #" + id);
  return match[0];
}

test("popup exposes the accessible local-only action contract", async () => {
  const [html, css, script, controllerScript] = await Promise.all([
    readFile(fileUrl("popup.html"), "utf8"),
    readFile(fileUrl("popup.css"), "utf8"),
    readFile(fileUrl("popup.js"), "utf8"),
    readFile(fileUrl("popup-controller.js"), "utf8")
  ]);

  for (const id of [
    "enabledToggle",
    "configurationStatus",
    "openSettings",
    "popupStatus"
  ]) {
    assert.match(
      html,
      new RegExp("id\\s*=\\s*[\\x22\\x27]" + id + "[\\x22\\x27]"),
      "missing #" + id
    );
  }

  assert.equal(countMatches(html, /<main\b/gi), 1);
  assert.match(html, /<h1\b[^>]*>[^<]*Selection Explainer[^<]*<\/h1>/i);
  assert.match(
    openingTagForId(html, "enabledToggle"),
    /<input\b[^>]*type\s*=\s*[\x22\x27]checkbox[\x22\x27][^>]*\bdisabled\b/i
  );
  assert.match(html, /<label\b[^>]*for\s*=\s*[\x22\x27]enabledToggle[\x22\x27]/i);
  assert.match(openingTagForId(html, "openSettings"), /<button\b[^>]*type\s*=\s*[\x22\x27]button[\x22\x27]/i);
  assert.ok(html.includes("Open settings"));
  assert.match(openingTagForId(html, "configurationStatus"), /role\s*=\s*[\x22\x27]status[\x22\x27]/i);
  assert.match(openingTagForId(html, "configurationStatus"), /aria-live\s*=\s*[\x22\x27]polite[\x22\x27]/i);
  assert.match(openingTagForId(html, "configurationStatus"), /aria-atomic\s*=\s*[\x22\x27]true[\x22\x27]/i);
  assert.match(openingTagForId(html, "popupStatus"), /role\s*=\s*[\x22\x27]status[\x22\x27]/i);
  assert.match(openingTagForId(html, "popupStatus"), /aria-live\s*=\s*[\x22\x27]polite[\x22\x27]/i);
  assert.match(openingTagForId(html, "popupStatus"), /aria-atomic\s*=\s*[\x22\x27]true[\x22\x27]/i);
  assert.match(html, /Select[\s\S]*?text[\s\S]*?Explain/i);

  assert.doesNotMatch(html, /type\s*=\s*[\x22\x27]password[\x22\x27]/i);
  assert.doesNotMatch(html, /\b(?:api[-_ ]?key|apikey)\b/i);

  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1);
  assert.match(scripts[0][1], /type\s*=\s*[\x22\x27]module[\x22\x27]/i);
  assert.match(scripts[0][1], /src\s*=\s*[\x22\x27]popup\.js[\x22\x27]/i);
  assert.equal(scripts[0][2].trim(), "", "script must not contain inline code");
  assert.match(html, /<link\b[^>]*href\s*=\s*[\x22\x27]popup\.css[\x22\x27]/i);

  assert.doesNotMatch(html, /<(?:script|link|img)\b[^>]*(?:src|href)\s*=\s*[\x22\x27](?:https?:)?\/\//i);
  assert.doesNotMatch(css, /@import\s+(?:url\()?\s*[\x22\x27]?(?:https?:)?\/\//i);
  assert.doesNotMatch(css, /(?:url|src)\s*\([^)]*(?:https?:)?\/\//i);
  for (const source of [script, controllerScript]) {
    assert.doesNotMatch(source, /\bimport\s*(?:\(|[^;]*?from\s*)[\x22\x27](?:https?:)?\/\//i);
  }

  assert.match(css, /width\s*:\s*320px/i);
  assert.match(css, /:focus-visible/i);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/i);
  assert.match(script, /from\s*[\x22\x27]\.\/popup-controller\.js[\x22\x27]/);

  const messageTypes = [...(script + "\n" + controllerScript)
    .matchAll(/type\s*:\s*[\x22\x27]([A-Z_]+)[\x22\x27]/g)]
    .map((match) => match[1]);
  assert.deepEqual([...new Set(messageTypes)].sort(), [
    "GET_STATUS",
    "OPEN_OPTIONS",
    "SET_ENABLED"
  ]);
});
