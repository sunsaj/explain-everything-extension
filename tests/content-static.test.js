import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const contentUrl = new URL('../content/content.js', import.meta.url);
const appUrl = new URL('../content/app.js', import.meta.url);
const controllerUrl = new URL('../content/app-controller.js', import.meta.url);
const manifestUrl = new URL('../manifest.json', import.meta.url);

test('content bootstrap is top-frame-only, idempotent, and dynamically imports the local app', async () => {
  const source = await readFile(contentUrl, 'utf8');

  assert.match(source, /window\.top\s*!==\s*window/);
  assert.match(source, /globalThis\.__selectionExplainerBootstrapped/);
  assert.match(
    source,
    /import\(\s*chrome\.runtime\.getURL\(\s*['"]content\/app\.js['"]\s*\)\s*\)/
  );
  assert.match(source, /catch[\s\S]*__selectionExplainerBootstrapped\s*=\s*false/);
});

test('content app wires panel, selection capture events, sanitized runtime status, and the pure controller', async () => {
  const source = await readFile(appUrl, 'utf8');

  assert.match(source, /from\s+['"]\.\/panel\.js['"]/);
  assert.match(source, /from\s+['"]\.\.\/shared\/selection\.js['"]/);
  assert.match(source, /from\s+['"]\.\/app-controller\.js['"]/);
  for (const eventName of ['selectionchange', 'mouseup', 'keyup']) {
    assert.match(source, new RegExp('addEventListener\\(\\s*[\'\"]' + eventName));
  }
  assert.match(source, /chrome\.runtime\.onMessage\.addListener/);
  assert.match(source, /PUBLIC_STATUS_CHANGED/);
  assert.doesNotMatch(source, /chrome\.storage/);
  assert.doesNotMatch(source, /selectionExplainerSettings/);
  const controllerSource = await readFile(controllerUrl, 'utf8');
  assert.match(source + controllerSource, /GET_STATUS/);
  assert.match(source + controllerSource, /OPEN_OPTIONS/);
  assert.match(source + controllerSource, /applyPublicStatusChange/);
});

test('manifest-declared content executables contain no network or credential handling', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const resources = manifest.web_accessible_resources.flatMap((entry) => entry.resources);
  const executablePaths = new Set([
    ...manifest.content_scripts.flatMap((entry) => entry.js ?? []),
    ...resources.filter((resource) => resource.startsWith('content/') && resource.endsWith('.js'))
  ]);
  const sources = await Promise.all([...executablePaths].map((resource) =>
    readFile(new URL('../' + resource, import.meta.url), 'utf8')
  ));
  const combined = sources.join('\n');

  assert.ok(executablePaths.has('content/app-controller.js'));
  assert.ok(executablePaths.has('content/panel.js'));
  assert.ok(executablePaths.has('content/markdown.js'));
  assert.match(combined, /selectionStart/);
  assert.match(combined, /selectionEnd/);
  assert.match(combined, /EXPLAIN_SELECTION/);
  assert.doesNotMatch(combined, /\bfetch\s*\(/);
  assert.doesNotMatch(combined, /Authorization/i);
  assert.doesNotMatch(combined, /apiKey/i);
});
