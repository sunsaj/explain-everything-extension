import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const optionsDirectory = new URL("../options/", import.meta.url);
const fileUrl = (name) => new URL(name, optionsDirectory);

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

test("options page exposes the accessible prompt-profile settings contract without remote or inline resources", async () => {
  const [html, css, script, saveFlowScript] = await Promise.all([
    readFile(fileUrl("options.html"), "utf8"),
    readFile(fileUrl("options.css"), "utf8"),
    readFile(fileUrl("options.js"), "utf8"),
    readFile(fileUrl("save-flow.js"), "utf8")
  ]);

  const requiredIds = [
    "endpoint",
    "apiKey",
    "model",
    "webSearchEnabled",
    "promptProfilesList",
    "addPromptProfile",
    "promptProfilesError",
    "activePromptProfileIdError",
    "toggleKey",
    "saveSettings",
    "testConnection",
    "status",
    "validationSummary"
  ];
  for (const id of requiredIds) {
    assert.match(
      html,
      new RegExp("id\\s*=\\s*[\\x22\\x27]" + id + "[\\x22\\x27]"),
      "missing #" + id
    );
  }

  for (const removedId of ["level", "systemPrompt", "restorePrompt"]) {
    assert.doesNotMatch(
      html,
      new RegExp("id\\s*=\\s*[\\x22\\x27]" + removedId + "[\\x22\\x27]"),
      "legacy #" + removedId + " must be removed"
    );
  }

  assert.equal(countMatches(html, /<main\b/gi), 1);
  assert.match(html, /<h1\b/i);
  assert.match(html, /<form\b[^>]*aria-busy\s*=\s*[\x22\x27]true[\x22\x27]/i);
  for (const id of [
    "endpoint",
    "apiKey",
    "model",
    "webSearchEnabled",
    "addPromptProfile",
    "toggleKey",
    "saveSettings",
    "testConnection"
  ]) {
    assert.match(openingTagForId(html, id), /\bdisabled\b/i, "#" + id + " must start disabled");
  }
  assert.match(html, /<input\b[^>]*id\s*=\s*[\x22\x27]apiKey[\x22\x27][^>]*type\s*=\s*[\x22\x27]password[\x22\x27]/i);
  assert.match(html, /Internet search/i);
  assert.match(html, /more time, tokens, and cost/i);
  assert.match(html, /<input\b[^>]*id\s*=\s*[\x22\x27]webSearchEnabled[\x22\x27][^>]*type\s*=\s*[\x22\x27]checkbox[\x22\x27]/i);
  assert.match(html, /Prompt profiles/i);
  assert.match(html, /Add prompt profile/i);
  assert.match(html, /aria-live\s*=\s*[\x22\x27](?:polite|assertive)[\x22\x27]/i);
  for (const label of ["Show", "Save and grant access", "Test connection"]) {
    assert.ok(html.includes(label), "missing button label: " + label);
  }
  for (const field of [
    "endpoint",
    "apiKey",
    "model",
    "promptProfiles",
    "activePromptProfileId"
  ]) {
    assert.match(
      html,
      new RegExp("data-error-for\\s*=\\s*[\\x22\\x27]" + field + "[\\x22\\x27]"),
      "missing error target for " + field
    );
  }

  assert.doesNotMatch(html, /<select\b[^>]*id\s*=\s*[\x22\x27]level[\x22\x27]/i);
  assert.doesNotMatch(html, /<textarea\b[^>]*id\s*=\s*[\x22\x27]systemPrompt[\x22\x27]/i);

  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1);
  assert.match(scripts[0][1], /type\s*=\s*[\x22\x27]module[\x22\x27]/i);
  assert.match(scripts[0][1], /src\s*=\s*[\x22\x27]options\.js[\x22\x27]/i);
  assert.equal(scripts[0][2].trim(), "", "script must not contain inline code");
  assert.match(html, /<link\b[^>]*href\s*=\s*[\x22\x27]options\.css[\x22\x27]/i);

  assert.doesNotMatch(html, /<(?:script|link|img)\b[^>]*(?:src|href)\s*=\s*[\x22\x27](?:https?:)?\/\//i);
  assert.doesNotMatch(css, /@import\s+(?:url\()?\s*[\x22\x27]?(?:https?:)?\/\//i);
  assert.doesNotMatch(css, /(?:url|src)\s*\([^)]*(?:https?:)?\/\//i);
  assert.doesNotMatch(script, /\bimport\s*(?:\(|[^;]*?from\s*)[\x22\x27](?:https?:)?\/\//i);
  assert.doesNotMatch(saveFlowScript, /\bimport\s*(?:\(|[^;]*?from\s*)[\x22\x27](?:https?:)?\/\//i);
  assert.doesNotMatch(saveFlowScript, /\bchrome\./, "save flow must stay dependency-injected");

  assert.match(css, /@font-face[\s\S]*?Selection Inter[\s\S]*?InterVariable\.woff2/i);
  assert.match(css, /font-family\s*:\s*["']Selection Inter["']/i);
  assert.match(css, /Segoe UI Variable Text/);
  assert.match(css, /max-width\s*:\s*760px/i);
  assert.match(css, /:focus-visible/i);
  assert.match(css, /\.profile-card\b/i);
  assert.match(css, /\.profile-actions\b/i);
  assert.match(css, /@media\b/i);

  assert.match(script, /createProfileEditorState/);
  assert.match(script, /createPromptProfileId/);
  assert.match(script, /document\.createElement\s*\(/);
  assert.match(script, /\.replaceChildren\s*\(/);
  assert.match(script, /\.textContent\s*=/);
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
  for (const label of ["Set as default", "Duplicate", "Delete"]) {
    assert.ok(script.includes(label), "missing profile action: " + label);
  }
  assert.match(script, /data-error-path|dataset\.errorPath/);
  const liveLabelHelper = script.match(
    /function refreshProfileActionLabels\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/
  );
  assert.ok(liveLabelHelper, "missing live profile action-label refresh helper");
  assert.match(liveLabelHelper[1], /setAttribute\s*\(\s*[\x22\x27]aria-label[\x22\x27]/);
  assert.doesNotMatch(liveLabelHelper[1], /renderProfiles/);
  const inputHandler = script.match(
    /form\.addEventListener\s*\(\s*[\x22\x27]input[\x22\x27]\s*,[\s\S]*?=>\s*\{([\s\S]*?)\n\}\);/
  );
  assert.ok(inputHandler, "missing form input handler");
  assert.match(
    inputHandler[1],
    /profileField === [\x22\x27]title[\x22\x27][\s\S]*?refreshProfileActionLabels\s*\([^)]*field\.value/
  );
  assert.match(script, /promptProfiles\.length\s*>=\s*20/);
  assert.match(script, /promptProfiles\.length\s*<=\s*1/);
  assert.match(script, /no extension prompt-length cap/i);
  assert.match(script, /provider context/i);
  assert.doesNotMatch(script, /MAX_PROFILE_PROMPT_LENGTH|6,000|6000|maxLength/);
  const setDefaultBranch = script.match(
    /if\s*\(action === [\x22\x27]set-default[\x22\x27]\)\s*\{([\s\S]*?)return;\s*\}/
  );
  assert.ok(setDefaultBranch, "missing set-default branch");
  assert.match(setDefaultBranch[1], /clearErrors\s*\(\)/);
  assert.doesNotMatch(setDefaultBranch[1], /focusAction/);
  assert.match(
    setDefaultBranch[1],
    /renderProfiles\s*\(\s*\{\s*focusProfileId:\s*profileId\s*\}\s*\)/
  );

  assert.match(script, /permissionPatternForEndpoint/);
  assert.match(script, /chrome\.permissions\.request\s*\(/);
  assert.match(script, /grantAndSaveSettings/);
  assert.match(script, /configurationControlsLocked/);
  assert.match(script, /let configurationLoaded = false/);
  assert.equal(countMatches(script, /configurationLoaded\s*=\s*true/g), 1);
  assert.match(
    script,
    /configurationControlsLocked\s*\(\s*\{\s*loading,\s*busy,\s*configurationLoaded\s*\}\s*\)/
  );
  assert.match(script, /setFormLoading/);
  assert.ok(countMatches(script, /refreshValidationSummary\s*\(/g) >= 2);
  assert.match(script, /status\.dataset\.kind\s*===\s*[\x22\x27]error[\x22\x27]/);
  assert.match(script, /currentSettings\s*=\s*normalizeSettings\(result\.settings\)/);
  assert.doesNotMatch(script, /saveSettings\s*\(/);
  assert.doesNotMatch(script, /chrome\.storage/);
  assert.match(script, /type\s*:\s*[\x22\x27]GET_CONFIGURATION[\x22\x27]/);
  assert.doesNotMatch(script, /currentSettings\?\.enabled\s*\?\?\s*true/);
  assert.match(script, /type\s*:\s*[\x22\x27]TEST_CONNECTION[\x22\x27]/);
  assert.doesNotMatch(script, /type\s*:\s*[\x22\x27]EXPLAIN_SELECTION[\x22\x27]/);
  assert.match(script, /type\s*:\s*[\x22\x27]SAVE_CONFIGURATION[\x22\x27]/);
  assert.match(script, /result\.error\.message/);

  assert.match(saveFlowScript, /promptProfiles/);
  assert.match(saveFlowScript, /activePromptProfileId/);
  assert.doesNotMatch(saveFlowScript, /\blevel\b/);
  assert.doesNotMatch(saveFlowScript, /\bsystemPrompt\b/);
});
