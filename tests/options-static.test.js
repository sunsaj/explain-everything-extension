import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const optionsDirectory = new URL('../options/', import.meta.url);
const fileUrl = (name) => new URL(name, optionsDirectory);

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function openingTagForId(source, id) {
  const match = source.match(new RegExp(
    '<[a-z][^>]*\\bid\\s*=\\s*[\\x22\\x27]' + id + '[\\x22\\x27][^>]*>',
    'i'
  ));
  assert.ok(match, 'missing opening tag for #' + id);
  return match[0];
}

test('options page exposes the accessible settings contract without remote or inline resources', async () => {
  const [html, css, script, saveFlowScript] = await Promise.all([
    readFile(fileUrl('options.html'), 'utf8'),
    readFile(fileUrl('options.css'), 'utf8'),
    readFile(fileUrl('options.js'), 'utf8'),
    readFile(fileUrl('save-flow.js'), 'utf8')
  ]);

  const requiredIds = [
    'endpoint',
    'apiKey',
    'model',
    'level',
    'webSearchEnabled',
    'systemPrompt',
    'toggleKey',
    'restorePrompt',
    'saveSettings',
    'testConnection',
    'status',
    'validationSummary'
  ];
  for (const id of requiredIds) {
    assert.match(
      html,
      new RegExp('id\\s*=\\s*[\\x22\\x27]' + id + '[\\x22\\x27]'),
      'missing #' + id
    );
  }

  assert.equal(countMatches(html, /<main\b/gi), 1);
  assert.match(html, /<h1\b/i);
  assert.match(html, /<form\b[^>]*aria-busy\s*=\s*[\x22\x27]true[\x22\x27]/i);
  for (const id of [
    'endpoint',
    'apiKey',
    'model',
    'level',
    'webSearchEnabled',
    'systemPrompt',
    'toggleKey',
    'restorePrompt',
    'saveSettings',
    'testConnection'
  ]) {
    assert.match(openingTagForId(html, id), /\bdisabled\b/i, '#' + id + ' must start disabled');
  }
  assert.match(html, /<input\b[^>]*id\s*=\s*[\x22\x27]apiKey[\x22\x27][^>]*type\s*=\s*[\x22\x27]password[\x22\x27]/i);
  assert.match(html, /Internet search/i);
  assert.match(html, /more time, tokens, and cost/i);
  assert.match(html, /<input\b[^>]*id\s*=\s*[\x22\x27]webSearchEnabled[\x22\x27][^>]*type\s*=\s*[\x22\x27]checkbox[\x22\x27]/i);
  assert.match(html, /<select\b[^>]*id\s*=\s*[\x22\x27]level[\x22\x27]/i);
  assert.match(html, /<option\b[^>]*value\s*=\s*[\x22\x27]child[\x22\x27]/i);
  assert.match(html, /<option\b[^>]*value\s*=\s*[\x22\x27]engineer[\x22\x27]/i);
  assert.match(html, /<textarea\b[^>]*id\s*=\s*[\x22\x27]systemPrompt[\x22\x27][^>]*rows\s*=\s*[\x22\x27]?(?:1[0-9]|[2-9][0-9])/i);
  assert.match(html, /aria-live\s*=\s*[\x22\x27](?:polite|assertive)[\x22\x27]/i);
  for (const label of [
    'Show',
    'Restore default prompt',
    'Save and grant access',
    'Test connection'
  ]) {
    assert.ok(html.includes(label), 'missing button label: ' + label);
  }
  for (const field of ['endpoint', 'apiKey', 'model', 'level', 'systemPrompt']) {
    assert.match(
      html,
      new RegExp('data-error-for\\s*=\\s*[\\x22\\x27]' + field + '[\\x22\\x27]'),
      'missing error target for ' + field
    );
  }

  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1);
  assert.match(scripts[0][1], /type\s*=\s*[\x22\x27]module[\x22\x27]/i);
  assert.match(scripts[0][1], /src\s*=\s*[\x22\x27]options\.js[\x22\x27]/i);
  assert.equal(scripts[0][2].trim(), '', 'script must not contain inline code');
  assert.match(html, /<link\b[^>]*href\s*=\s*[\x22\x27]options\.css[\x22\x27]/i);

  assert.doesNotMatch(html, /<(?:script|link|img)\b[^>]*(?:src|href)\s*=\s*[\x22\x27](?:https?:)?\/\//i);
  assert.doesNotMatch(css, /@import\s+(?:url\()?\s*[\x22\x27]?(?:https?:)?\/\//i);
  assert.doesNotMatch(css, /(?:url|src)\s*\([^)]*(?:https?:)?\/\//i);
  assert.doesNotMatch(script, /\bimport\s*(?:\(|[^;]*?from\s*)[\x22\x27](?:https?:)?\/\//i);
  assert.doesNotMatch(saveFlowScript, /\bimport\s*(?:\(|[^;]*?from\s*)[\x22\x27](?:https?:)?\/\//i);
  assert.doesNotMatch(saveFlowScript, /\bchrome\./, 'save flow must stay dependency-injected');

  assert.match(css, /max-width\s*:\s*760px/i);
  assert.match(css, /:focus-visible/i);
  assert.match(css, /@media\b/i);

  assert.match(script, /permissionPatternForEndpoint/);
  assert.match(script, /chrome\.permissions\.request\s*\(/);
  assert.match(script, /grantAndSaveSettings/);
  assert.match(script, /setFormLoading/);
  assert.ok(countMatches(script, /refreshValidationSummary\s*\(/g) >= 2);
  assert.match(script, /status\.dataset\.kind\s*===\s*[\x22\x27]error[\x22\x27]/);
  assert.match(script, /currentSettings\s*=\s*result\.settings/);
  assert.doesNotMatch(script, /saveSettings\s*\(/);
  assert.doesNotMatch(script, /chrome\.storage/);
  assert.match(script, /type\s*:\s*[\x22\x27]GET_CONFIGURATION[\x22\x27]/);
  assert.doesNotMatch(script, /currentSettings\?\.enabled\s*\?\?\s*true/);
  assert.match(script, /type\s*:\s*[\x22\x27]TEST_CONNECTION[\x22\x27]/);
  assert.doesNotMatch(script, /type\s*:\s*[\x22\x27]EXPLAIN_SELECTION[\x22\x27]/);
  assert.match(script, /type\s*:\s*[\x22\x27]SAVE_CONFIGURATION[\x22\x27]/);
  assert.match(script, /result\.error\.message/);

});
