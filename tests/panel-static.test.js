import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const contentDirectory = new URL("../content/", import.meta.url);
const fileUrl = (name) => new URL(name, contentDirectory);

function ruleBlock(source, selector, requiredPattern = null) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...source.matchAll(new RegExp(escaped + "\\s*\\{([^}]*)\\}", "gi"))];
  assert.ok(matches.length, `missing ${selector} rule`);
  const blocks = matches.map((match) => match[1]);
  if (!requiredPattern) return blocks[0];
  const block = blocks.find((candidate) => requiredPattern.test(candidate));
  assert.ok(block, `missing ${selector} rule matching ${requiredPattern}`);
  return block;
}

function mediaBlocks(source) {
  const blocks = [];
  const mediaStart = /@media\s+([^\{]+)\{/gi;
  let match;

  while ((match = mediaStart.exec(source))) {
    let depth = 1;
    let cursor = mediaStart.lastIndex;

    while (cursor < source.length && depth > 0) {
      if (source[cursor] === "{") depth += 1;
      if (source[cursor] === "}") depth -= 1;
      cursor += 1;
    }

    assert.equal(depth, 0, `unterminated media query: ${match[1].trim()}`);
    blocks.push({
      condition: match[1].trim(),
      body: source.slice(mediaStart.lastIndex, cursor - 1)
    });
    mediaStart.lastIndex = cursor;
  }

  return blocks;
}

function mediaMatchesViewport(condition, { width, height }) {
  const constraints = [...condition.matchAll(/\(\s*max-(width|height)\s*:\s*(\d+)px\s*\)/gi)];
  if (!constraints.length) return false;

  return constraints.every(([, dimension, limit]) => (
    dimension.toLowerCase() === "width" ? width : height
  ) <= Number(limit));
}

function hasContainedPanelFallback(css, viewport) {
  return mediaBlocks(css)
    .filter(({ condition }) => mediaMatchesViewport(condition, viewport))
    .some(({ body }) => {
      const panel = body.match(/\.panel\s*\{([^}]*)\}/i)?.[1] ?? "";
      const stickyControls = body.match(
        /\.panel__header\s*,\s*\.panel__footer\s*\{([^}]*)\}/i
      )?.[1] ?? "";
      const panelBody = body.match(/\.panel__body\s*\{([^}]*)\}/i)?.[1] ?? "";

      return /overflow-y\s*:\s*auto/i.test(panel)
        && /overscroll-behavior\s*:\s*contain/i.test(panel)
        && /position\s*:\s*sticky/i.test(stickyControls)
        && /overflow\s*:\s*visible/i.test(panelBody);
    });
}

function parseDeclarations(block) {
  const declarations = new Map();

  for (const match of block.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
    declarations.set(match[1].toLowerCase(), match[2].trim());
  }

  return declarations;
}

function responseDeclarationsAtViewport(css, viewport) {
  const declarations = parseDeclarations(
    ruleBlock(css, ".response", /overflow-y\s*:\s*auto/i)
  );

  for (const { condition, body } of mediaBlocks(css)) {
    if (!mediaMatchesViewport(condition, viewport)) continue;

    for (const match of body.matchAll(/\.response\s*\{([^}]*)\}/gi)) {
      for (const [property, value] of parseDeclarations(match[1])) {
        declarations.set(property, value);
      }
    }
  }

  return Object.fromEntries(declarations);
}

test("normal response keeps a positive flex basis and minimum at the 681px boundary", async () => {
  const css = await readFile(fileUrl("panel.css"), "utf8");
  const normal = responseDeclarationsAtViewport(css, { width: 240, height: 681 });

  assert.equal(normal.flex, "1 1 160px");
  assert.equal(normal["min-height"], "72px");
});

test("contained-scroll response is a nonshrinking 96px flex item", async () => {
  const css = await readFile(fileUrl("panel.css"), "utf8");

  for (const viewport of [
    { width: 1024, height: 420 },
    { width: 240, height: 421 },
    { width: 240, height: 680 }
  ]) {
    const fallback = responseDeclarationsAtViewport(css, viewport);
    assert.equal(fallback.flex, "0 0 96px", JSON.stringify(viewport));
    assert.equal(fallback["min-height"], "96px", JSON.stringify(viewport));
    assert.equal(fallback["block-size"], "96px", JSON.stringify(viewport));
    assert.equal(fallback["max-height"], "96px", JSON.stringify(viewport));
  }
});

test("contained panel scrolling covers only the combined narrow and short boundary", async () => {
  const css = await readFile(fileUrl("panel.css"), "utf8");

  assert.equal(hasContainedPanelFallback(css, { width: 1024, height: 420 }), true);
  assert.equal(hasContainedPanelFallback(css, { width: 1024, height: 421 }), false);
  assert.equal(hasContainedPanelFallback(css, { width: 240, height: 680 }), true);
  assert.equal(hasContainedPanelFallback(css, { width: 240, height: 681 }), false);
  assert.equal(hasContainedPanelFallback(css, { width: 280, height: 680 }), true);
  assert.equal(hasContainedPanelFallback(css, { width: 281, height: 680 }), false);
});

test("panel exposes the accessible hardened Shadow DOM controller contract", async () => {
  const [script, css] = await Promise.all([
    readFile(fileUrl("panel.js"), "utf8"),
    readFile(fileUrl("panel.css"), "utf8")
  ]);

  assert.match(script, /export\s+function\s+createExplainerPanel\s*\(\s*\{/);
  for (const callback of [
    "onExplain",
    "onRetry",
    "onCopy",
    "onSettings",
    "onClose"
  ]) {
    assert.match(script, new RegExp("\\b" + callback + "\\b"));
  }
  for (const method of [
    "setVisible",
    "setSelection",
    "setLevel",
    "getLevel",
    "setLoading",
    "setExplanation",
    "setError",
    "announce",
    "destroy"
  ]) {
    assert.match(script, new RegExp("\\b" + method + "\\b"));
  }

  assert.match(script, /createElement\s*\(\s*["']selection-explainer-panel-host["']\s*\)/);
  assert.match(script, /attachShadow\s*\(\s*\{\s*mode\s*:\s*["']closed["']\s*\}\s*\)/);
  assert.match(script, /document\.documentElement\.append\s*\(\s*host\s*\)/);
  assert.doesNotMatch(script, /document\.(?:getElementById|querySelector|querySelectorAll)\s*\(/);
  assert.match(script, /host\.style\.setProperty\s*\(/);
  assert.match(script, /["']important["']/);
  assert.match(script, /chrome\.runtime\.getURL\s*\(\s*["']content\/panel\.css["']\s*\)/);
  assert.match(script, /setAttribute\s*\(\s*["']role["']\s*,\s*["']dialog["']\s*\)/);
  assert.match(script, /setAttribute\s*\(\s*["']aria-live["']\s*,\s*["']polite["']\s*\)/);
  assert.match(script, /Use internet search/);
  assert.match(script, /getWebSearchEnabled/);
  assert.match(script, /setWebSearchEnabled/);
  assert.match(script, /setAttribute\s*\(\s*["']aria-busy["']\s*,\s*["']true["']\s*\)/);
  assert.match(script, /shadow\.addEventListener\s*\(\s*["']keydown["']/);
  assert.match(script, /event\.isTrusted/);
  assert.match(script, /explainButton\.addEventListener\s*\(\s*["']click["']/);
  assert.match(script, /retryButton\.addEventListener\s*\(\s*["']click["']/);
  assert.match(script, /shadow\.removeEventListener\s*\(\s*["']keydown["']/);
  assert.doesNotMatch(script, /document\.(?:addEventListener|removeEventListener)\s*\(\s*["']keydown["']/);
  assert.match(script, /key\s*===\s*["']Escape["']/);
  assert.match(script, /launcher\.focus\s*\(/);
  assert.match(script, /launcher__icon/);
  assert.match(script, /textContent\s*=\s*["']✦["']/);
  assert.match(script, /setAttribute\s*\(\s*["']aria-hidden["']\s*,\s*["']true["']\s*\)/);

  for (const label of [
    "Explain selected text",
    "Explain",
    "Copy",
    "Retry",
    "Settings",
    "Close"
  ]) {
    assert.ok(script.includes(label), `missing ${label} label`);
  }

  assert.match(script, /selectionPreview\.textContent\s*=/);
  assert.match(script, /response\.textContent\s*=/);
  assert.match(
    script,
    /function\s+setExplanation[\s\S]*?resultActions\.hidden\s*=\s*false[\s\S]*?settingsButton\.hidden\s*=\s*false/
  );
  assert.doesNotMatch(script, /\.innerHTML\b/);
  assert.doesNotMatch(script, /\bfetch\s*\(/);
  assert.doesNotMatch(script, /https?:\/\//i);

  assert.match(css, /:host\s*\{/);
  assert.match(css, /position\s*:\s*fixed/i);
  assert.match(css, /z-index\s*:\s*2147483647/i);
  assert.match(css, /\.explainer-root\s*\{[^}]*pointer-events\s*:\s*auto/is);
  assert.match(css, /width\s*:\s*min\(420px,\s*calc\(100vw\s*-\s*32px\)\)/i);
  assert.doesNotMatch(css, /70dvh/i);
  assert.match(
    css,
    /max-height\s*:\s*min\(680px,\s*calc\(100dvh\s*-\s*96px\)\)/i
  );
  assert.doesNotMatch(css, /max-height\s*:\s*calc\(100dvh\s*-\s*16px\)/i);
  assert.doesNotMatch(css, /@media\s*\(max-height:\s*360px\)/i);

  const bodyRule = ruleBlock(css, ".panel__body", /min-height\s*:\s*0/i);
  assert.match(bodyRule, /min-height\s*:\s*0/i);
  assert.match(bodyRule, /overflow\s*:\s*hidden/i);

  const responseRule = ruleBlock(css, ".response", /overflow-y\s*:\s*auto/i);
  assert.match(responseRule, /min-height\s*:\s*72px/i);
  assert.match(responseRule, /flex\s*:\s*1\s+1\s+160px/i);
  assert.match(responseRule, /overflow-y\s*:\s*auto/i);
  assert.match(responseRule, /white-space\s*:\s*normal/i);
  assert.match(css, /\.md-code-block pre\s*\{[^}]*white-space\s*:\s*pre/i);

  assert.match(ruleBlock(css, ".panel__header", /flex\s*:\s*0\s+0\s+auto/i), /flex\s*:\s*0\s+0\s+auto/i);
  assert.match(ruleBlock(css, ".panel__footer", /flex\s*:\s*0\s+0\s+auto/i), /flex\s*:\s*0\s+0\s+auto/i);
  assert.doesNotMatch(
    css,
    /@media\s*\(max-height:\s*560px\)[\s\S]*?\.panel\s*\{[^}]*max-height\s*:/i
  );
  assert.match(
    css,
    /@media\s*\(max-height:\s*560px\)[\s\S]*?\.panel__body\s*\{[^}]*gap\s*:\s*[0-6]px[^}]*padding\s*:/i
  );
  assert.match(
    css,
    /@media\s*\(max-height:\s*560px\)[\s\S]*?\.field\s*\{[^}]*grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+minmax\(/i
  );
  assert.match(
    css,
    /@media\s*\(max-height:\s*560px\)[\s\S]*?\.selection-preview\s*\{[^}]*max-height\s*:\s*1\.5em/i
  );
  assert.match(
    css,
    /@media\s*\(max-height:\s*560px\)[\s\S]*?\.panel__footer\s*\{[^}]*gap\s*:\s*[0-6]px[^}]*padding\s*:/i
  );
  assert.match(
    css,
    /@media\s*\(max-height:\s*420px\)[\s\S]*?\.panel\s*\{[^}]*overflow-y\s*:\s*auto[^}]*overscroll-behavior\s*:\s*contain/i
  );
  assert.match(
    css,
    /@media\s*\(max-height:\s*420px\)[\s\S]*?\.panel__header\s*,\s*\.panel__footer\s*\{[^}]*position\s*:\s*sticky/i
  );
  assert.match(
    css,
    /@media\s*\(max-height:\s*420px\)[\s\S]*?\.panel__body\s*\{[^}]*overflow\s*:\s*visible/i
  );

  assert.match(css, /min-height\s*:\s*44px/i);
  assert.match(css, /:focus-visible/i);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/i);
  assert.match(css, /@media\s*\(prefers-color-scheme:\s*dark\)/i);
  assert.match(css, /@media\s*\(max-width:\s*\d+px\)/i);
  assert.match(css, /\.panel\s*\{[^}]*color\s*:\s*var\(--se-text\)/i);
  assert.match(css, /button\s*,\s*select\s*\{[^}]*color\s*:\s*var\(--se-text\)/i);
  assert.match(css, /option\s*\{[^}]*background\s*:\s*var\(--se-surface\)[^}]*color\s*:\s*var\(--se-text\)/i);
  assert.match(css, /button:disabled\s*,\s*select:disabled\s*\{[^}]*opacity\s*:\s*0\.[6-9]/i);
  assert.doesNotMatch(css, /@import/i);
  assert.doesNotMatch(css, /https?:\/\//i);
});
