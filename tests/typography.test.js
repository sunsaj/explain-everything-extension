import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const stylesheets = [
  { name: "panel", url: new URL("../content/panel.css", import.meta.url) },
  { name: "popup", url: new URL("../popup/popup.css", import.meta.url) },
  { name: "options", url: new URL("../options/options.css", import.meta.url) }
];

const productStrongElements = [
  {
    name: "popup",
    url: new URL("../popup/popup.html", import.meta.url),
    bindings: [{ selector: ".usage strong", containerTag: "p", containerClass: "usage" }]
  },
  {
    name: "options",
    url: new URL("../options/options.html", import.meta.url),
    bindings: [{ selector: ".checkbox-setting strong", containerTag: "label", containerClass: "checkbox-setting" }]
  }
];

const exactInterFace = [
  "@font-face {",
  "  font-family: \"Selection Inter\";",
  "  src: url(\"../assets/fonts/InterVariable.woff2\") format(\"woff2\");",
  "  font-style: normal;",
  "  font-weight: 100 900;",
  "  font-display: swap;",
  "}"
].join("\n");

const exactInterFaceNoFinalSemicolon = [
  "@font-face {",
  "  font-family: \"Selection Inter\";",
  "  src: url(\"../assets/fonts/InterVariable.woff2\") format(\"woff2\");",
  "  font-style: normal;",
  "  font-weight: 100 900;",
  "  font-display: swap",
  "}"
].join("\n");

const reviewedTypographyManifest = {
  panel: [
    [":host", "font-weight", "400"],
    [".button", "font-weight", "600"],
    [".button", "font-weight", "600"],
    [".field__label", "font-weight", "500"],
    [".field__label", "font-weight", "500"],
    [".icon-button", "font-weight", "600"],
    [".launcher", "font-weight", "600"],
    [".level-select", "font-weight", "600"],
    [".level-select", "font-weight", "600"],
    [".markdown-content a", "font-weight", "600"],
    [".markdown-content h1", "font-weight", "700"],
    [".markdown-content h1", "font-weight", "700"],
    [".markdown-content h2", "font-weight", "700"],
    [".markdown-content h2", "font-weight", "700"],
    [".markdown-content h3", "font-weight", "700"],
    [".markdown-content h3", "font-weight", "700"],
    [".markdown-content h4", "font-weight", "700"],
    [".markdown-content h4", "font-weight", "700"],
    [".markdown-content h5", "font-weight", "700"],
    [".markdown-content h5", "font-weight", "700"],
    [".markdown-content h6", "font-weight", "700"],
    [".markdown-content h6", "font-weight", "700"],
    [".markdown-content strong", "font-weight", "600"],
    [".markdown-content th", "font-weight", "600"],
    [".markdown-content", "font", "inherit"],
    [".markdown-content", "font-weight", "400"],
    [".md-code-block code", "font", "inherit"],
    [".md-code-language", "font-weight", "500"],
    [".md-code-language", "font-weight", "500"],
    [".panel__title", "font-weight", "700"],
    [".panel__title", "font-weight", "700"],
    [".panel__title", "font-weight", "700"],
    [".panel[data-view=\"result\"]>.panel__footer::before", "font-weight", "500"],
    [".response", "font", "inherit"],
    [".response", "font-weight", "400"],
    [".section-label", "font-weight", "500"],
    [".section-label", "font-weight", "500"],
    [".status", "font-weight", "500"],
    [".status[data-state=\"error\"]", "font-weight", "500"],
    [".web-search-text strong", "font-weight", "600"],
    [".web-search-text strong", "font-weight", "600"],
    ["button", "font", "inherit"],
    ["select", "font", "inherit"]
  ],
  popup: [
    [".badge", "font-weight", "500"],
    [".brand-mark", "font-weight", "700"],
    [".brand-mark", "font-weight", "700"],
    [".configuration-label", "font-weight", "500"],
    [".control-copy label", "font-weight", "600"],
    [".eyebrow", "font-weight", "500"],
    [".settings-button", "font-weight", "600"],
    [".status", "font-weight", "500"],
    [".usage strong", "font-weight", "600"],
    ["body", "font-weight", "400"],
    ["button", "font", "inherit"],
    ["h1", "font-weight", "700"],
    ["h2", "font-weight", "700"],
    ["input", "font", "inherit"]
  ],
  options: [
    [".brand-mark", "font-weight", "700"],
    [".checkbox-setting strong", "font-weight", "600"],
    [".default-badge", "font-weight", "500"],
    [".eyebrow", "font-weight", "500"],
    [".field-error", "font-weight", "500"],
    [".hint", "font-weight", "500"],
    [".profile-card-heading h3", "font-weight", "700"],
    [".status", "font-weight", "500"],
    [".validation-summary", "font-weight", "500"],
    ["body", "font-weight", "400"],
    ["button", "font", "inherit"],
    ["button", "font-weight", "600"],
    ["h1", "font-weight", "700"],
    ["h2", "font-weight", "700"],
    ["input", "font", "inherit"],
    ["label", "font-weight", "600"],
    ["select", "font", "inherit"],
    ["textarea", "font", "inherit"]
  ]
};

async function readStylesheets() {
  return Object.fromEntries(await Promise.all(stylesheets.map(async ({ name, url }) => [
    name,
    await readFile(url, "utf8")
  ])));
}

function maskComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => (
    comment.replace(/[^\r\n]/g, " ")
  ));
}

function findClosingBrace(source, openingIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = openingIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }

    if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}" && --depth === 0) {
      return index;
    }
  }

  throw new Error("Unclosed CSS block at index " + openingIndex);
}

function hasTopLevelBlock(source) {
  let quote = null;
  let escaped = false;
  let parentheses = 0;
  let brackets = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }

    if (character === "\"" || character === "'") quote = character;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "{" && parentheses === 0 && brackets === 0) return true;
  }

  return false;
}

function parseStylesheet(source) {
  const styleRules = [];
  const fontFaces = [];
  const unsupportedNesting = [];
  const withoutComments = maskComments(source);

  function parseRuleList(ruleList) {
    let index = 0;
    while (index < ruleList.length) {
      while (index < ruleList.length && /[\s;]/.test(ruleList[index])) index += 1;
      if (index >= ruleList.length) break;

      const preludeStart = index;
      let quote = null;
      let escaped = false;
      let parentheses = 0;
      let brackets = 0;
      let delimiter = null;

      while (index < ruleList.length) {
        const character = ruleList[index];
        if (quote) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === quote) quote = null;
        } else if (character === "\"" || character === "'") {
          quote = character;
        } else if (character === "(") {
          parentheses += 1;
        } else if (character === ")") {
          parentheses -= 1;
        } else if (character === "[") {
          brackets += 1;
        } else if (character === "]") {
          brackets -= 1;
        } else if (parentheses === 0 && brackets === 0 && (character === "{" || character === ";")) {
          delimiter = character;
          break;
        }
        index += 1;
      }

      if (delimiter !== "{") {
        index += 1;
        continue;
      }

      const prelude = ruleList.slice(preludeStart, index).trim();
      const closingIndex = findClosingBrace(ruleList, index);
      const body = ruleList.slice(index + 1, closingIndex);

      if (/^@font-face\b/i.test(prelude)) {
        fontFaces.push({ prelude, body });
      } else if (prelude.startsWith("@")) {
        parseRuleList(body);
      } else if (prelude) {
        if (hasTopLevelBlock(body)) {
          unsupportedNesting.push({ kind: "unsupported-nesting", selector: prelude });
        }
        styleRules.push({ prelude, body });
      }

      index = closingIndex + 1;
    }
  }

  parseRuleList(withoutComments);
  return { styleRules, fontFaces, unsupportedNesting };
}

function splitTopLevel(source, delimiter) {
  const parts = [];
  let start = 0;
  let quote = null;
  let escaped = false;
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }

    if (character === "\"" || character === "'") quote = character;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "{") braces += 1;
    else if (character === "}") braces -= 1;
    else if (
      character === delimiter
      && parentheses === 0
      && brackets === 0
      && braces === 0
    ) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(source.slice(start));
  return parts;
}

function declarationsForBody(body) {
  return splitTopLevel(body, ";").map((segment) => {
    let quote = null;
    let escaped = false;
    let parentheses = 0;
    let brackets = 0;
    let braces = 0;

    for (let index = 0; index < segment.length; index += 1) {
      const character = segment[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = null;
        continue;
      }

      if (character === "\"" || character === "'") quote = character;
      else if (character === "(") parentheses += 1;
      else if (character === ")") parentheses -= 1;
      else if (character === "[") brackets += 1;
      else if (character === "]") brackets -= 1;
      else if (character === "{") braces += 1;
      else if (character === "}") braces -= 1;
      else if (
        character === ":"
        && parentheses === 0
        && brackets === 0
        && braces === 0
      ) {
        return {
          property: segment.slice(0, index).trim().toLowerCase(),
          value: segment.slice(index + 1).trim()
        };
      }
    }

    return null;
  }).filter(Boolean);
}

function decodeCssIdentifier(value) {
  return value.replace(
    /\\([0-9a-f]{1,6})(?:[\t\n\f\r ]|\r\n)?|\\([^\n\r\f0-9a-f])/gi,
    (match, hexadecimal, escapedCharacter) => {
      if (hexadecimal === undefined) return escapedCharacter;
      const codePoint = Number.parseInt(hexadecimal, 16);
      return codePoint === 0 || codePoint > 0x10FFFF
        ? "\uFFFD"
        : String.fromCodePoint(codePoint);
    }
  );
}

function escapedFontPropertyViolations(parsedStylesheet) {
  const violations = [];
  const rules = [...parsedStylesheet.styleRules, ...parsedStylesheet.fontFaces];

  for (const { prelude, body } of rules) {
    for (const { property } of declarationsForBody(body)) {
      const decodedProperty = decodeCssIdentifier(property).toLowerCase();
      if (property.includes("\\") && ["font", "font-weight"].includes(decodedProperty)) {
        violations.push({
          kind: "escaped-font-property",
          prelude,
          property
        });
      }
    }
  }

  return violations;
}

function collapseWhitespaceOutsideStrings(source) {
  let result = "";
  let quote = null;
  let escaped = false;
  let pendingSpace = false;

  for (const character of source.trim()) {
    if (quote) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }

    if (character === "\"" || character === "'") {
      if (pendingSpace && result) result += " ";
      pendingSpace = false;
      quote = character;
      result += character;
    } else if (/\s/.test(character)) {
      pendingSpace = true;
    } else {
      if (pendingSpace && result) result += " ";
      pendingSpace = false;
      result += character;
    }
  }

  return result;
}

function normalizeSelector(selector) {
  return collapseWhitespaceOutsideStrings(selector)
    .replace(/\s*([>+~])\s*/g, "$1")
    .replace(/\s*([()[\]=])\s*/g, "$1");
}

function normalizeValue(value) {
  return collapseWhitespaceOutsideStrings(value);
}

function compareManifestEntries(left, right) {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function typographyDeclarationManifest(parsedStylesheet) {
  const manifest = [];

  for (const { prelude, body } of parsedStylesheet.styleRules) {
    const selectors = splitTopLevel(prelude, ",")
      .map(normalizeSelector)
      .filter(Boolean);
    const declarations = declarationsForBody(body)
      .filter(({ property }) => property === "font" || property === "font-weight")
      .map(({ property, value }) => [property, normalizeValue(value)]);

    for (const selector of selectors) {
      for (const [property, value] of declarations) {
        manifest.push([selector, property, value]);
      }
    }
  }

  return manifest.sort(compareManifestEntries);
}

function countManifestEntries(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const key = JSON.stringify(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function manifestViolations(actual, expected) {
  const violations = [];
  const actualCounts = countManifestEntries(actual);
  const expectedCounts = countManifestEntries(expected);
  const keys = new Set([...actualCounts.keys(), ...expectedCounts.keys()]);

  for (const key of [...keys].sort()) {
    const actualCount = actualCounts.get(key) ?? 0;
    const expectedCount = expectedCounts.get(key) ?? 0;
    if (actualCount > expectedCount) {
      violations.push({
        kind: "extra-declaration",
        declaration: JSON.parse(key),
        count: actualCount - expectedCount
      });
    }
    if (expectedCount > actualCount) {
      violations.push({
        kind: "missing-declaration",
        declaration: JSON.parse(key),
        count: expectedCount - actualCount
      });
    }
  }

  return violations;
}

function singleDeclarationValue(declarations, property) {
  const values = declarations
    .filter((declaration) => declaration.property === property)
    .map((declaration) => normalizeValue(declaration.value));
  return values.length === 1 ? values[0] : null;
}

function unquote(value) {
  const match = value?.match(/^(\"|')([\s\S]*)\1$/);
  return match ? match[2] : value;
}

function fontSourceSummary(value) {
  const pairPattern = /url\(\s*(\"|')?([^\"')]+)\1\s*\)\s+format\(\s*(\"|')?([^\"')]+)\3\s*\)/gi;
  const pairs = [...value.matchAll(pairPattern)].map((match) => ({
    url: match[2].trim(),
    format: match[4].trim()
  }));
  const urlCount = [...value.matchAll(/url\s*\(/gi)].length;
  const formatCount = [...value.matchAll(/format\s*\(/gi)].length;
  const remainder = value.replace(pairPattern, "").replace(/\s+/g, "");

  return { pairs, urlCount, formatCount, remainder };
}

function exactInterFaceViolations(fontFaces) {
  if (fontFaces.length !== 1) {
    return [{ kind: "inter-face-count", count: fontFaces.length }];
  }

  const prelude = fontFaces[0].prelude.trim();
  if (!/@font-face$/i.test(prelude)) {
    return [{ kind: "inter-face-prelude", prelude }];
  }

  const declarations = declarationsForBody(fontFaces[0].body);
  const family = singleDeclarationValue(declarations, "font-family");
  const src = singleDeclarationValue(declarations, "src");
  const style = singleDeclarationValue(declarations, "font-style");
  const weight = singleDeclarationValue(declarations, "font-weight");
  const display = singleDeclarationValue(declarations, "font-display");
  const sourceSummary = fontSourceSummary(src ?? "");
  const exactProperties = new Set([
    "font-family",
    "src",
    "font-style",
    "font-weight",
    "font-display"
  ]);
  const exactDeclarationSet = declarations.length === exactProperties.size
    && declarations.every(({ property }) => exactProperties.has(property));
  const exactSource = sourceSummary.pairs.length === 1
    && sourceSummary.urlCount === 1
    && sourceSummary.formatCount === 1
    && sourceSummary.remainder === ""
    && sourceSummary.pairs[0].url === "../assets/fonts/InterVariable.woff2"
    && sourceSummary.pairs[0].format === "woff2";

  if (
    exactDeclarationSet
    && unquote(family) === "Selection Inter"
    && exactSource
    && style === "normal"
    && weight === "100 900"
    && display === "swap"
  ) {
    return [];
  }

  return [{
    kind: "inter-face-declarations",
    declarations: declarations.map(({ property, value }) => [property, normalizeValue(value)])
  }];
}

function closedTypographyPolicyViolations(source, expectedManifest) {
  const parsed = parseStylesheet(source);
  const normalizedExpected = expectedManifest.map(([selector, property, value]) => [
    normalizeSelector(selector),
    property.toLowerCase(),
    normalizeValue(value)
  ]).sort(compareManifestEntries);

  const structuralViolations = [
    ...parsed.unsupportedNesting,
    ...escapedFontPropertyViolations(parsed),
    ...exactInterFaceViolations(parsed.fontFaces)
  ];
  if (structuralViolations.length > 0) return structuralViolations;

  return manifestViolations(
    typographyDeclarationManifest(parsed),
    normalizedExpected
  );
}

test("closed typography manifest rejects every unreviewed declaration and invalid Inter source", () => {
  const expected = [
    [".button", "font", "inherit"],
    [".button", "font-weight", "600"],
    [".markdown-content h2", "font-weight", "700"],
    ["body", "font-weight", "400"],
    ["button", "font", "inherit"],
    ["button", "font-weight", "600"]
  ];
  const baseline = exactInterFace + "\n"
    + "body { font-weight: 400; }\n"
    + "button, .button { font: inherit; font-weight: 600 }\n"
    + ".markdown-content h2 { font-weight: 700; }\n";

  assert.deepEqual(closedTypographyPolicyViolations(baseline, expected), []);

  const mutations = [
    ["functional body selector", "extra-declaration", baseline + "html :is(body) { font-weight: 500; }"],
    ["functional control selector", "extra-declaration", baseline + "html :is(button) { font-weight: 500; }"],
    ["functional selector comma", "extra-declaration", baseline + "html :is(button, input) { font-weight: 500; }"],
    ["escaped font-weight property", "escaped-font-property", baseline + "body { font\\2d weight: 800; }"],
    ["escaped font shorthand property", "escaped-font-property", baseline + "body { f\\6f nt: 800 1rem Inter; }"],
    ["nested 800 override", "unsupported-nesting", baseline + ".panel { & .button { font-weight: 800; } }"],
    ["control shorthand", "extra-declaration", baseline + ".panel .button { font: 400 1rem Inter; }"],
    ["heading shorthand", "extra-declaration", baseline + ".markdown-content h2 { font: 500 1rem Inter; }"],
    ["terminal calc shorthand", "extra-declaration", baseline + ".sample { font: calc(600) 1rem Inter }"],
    ["terminal var shorthand", "extra-declaration", baseline + ".sample { font: var(--weight) 1rem Inter }"],
    ["terminal env shorthand", "extra-declaration", baseline + ".sample { font: env(--weight) 1rem Inter }"],
    ["changed weight", "missing-declaration", baseline.replace("body { font-weight: 400; }", "body { font-weight: 500; }")],
    ["missing heading declaration", "missing-declaration", baseline.replace(".markdown-content h2 { font-weight: 700; }\n", "")],
    ["duplicate later override", "extra-declaration", baseline + "body { font-weight: 400; }"],
    ["changed audited shorthand", "missing-declaration", baseline.replace("font: inherit;", "font: 400 1rem Inter;")],
    ["missing audited shorthand", "missing-declaration", baseline.replace("font: inherit; ", "")],
    ["duplicate audited shorthand", "extra-declaration", baseline + ".button { font: inherit }"],
    ["bogus Inter face prelude", "inter-face-prelude", baseline.replace("@font-face {", "@font-face bogus {")],
    ["wrong Inter path", "inter-face-declarations", baseline.replace("../assets/fonts/InterVariable.woff2", "../wrong/InterVariable.woff2")],
    ["extra Inter URL", "inter-face-declarations", baseline.replace('format("woff2")', 'format("woff2"), url("../wrong/InterVariable.woff2") format("woff2")')],
    ["local Inter fallback", "inter-face-declarations", baseline.replace('url("../assets/fonts/InterVariable.woff2")', 'local("Inter"), url("../assets/fonts/InterVariable.woff2")')],
    ["wrong Inter format", "inter-face-declarations", baseline.replace('format("woff2")', 'format("truetype")')],
    ["additional Inter format", "inter-face-declarations", baseline.replace('format("woff2")', 'format("woff2") format("truetype")')],
    ["duplicate Inter face", "inter-face-count", exactInterFace + "\n" + baseline]
  ];

  const failures = [];
  for (const [name, expectedKind, mutation] of mutations) {
    const violations = closedTypographyPolicyViolations(mutation, expected);
    if (!violations.some(({ kind }) => kind === expectedKind)) {
      failures.push(name + " must report " + expectedKind + "; got " + JSON.stringify(violations));
    }
  }
  assert.deepEqual(failures, [], failures.join("\n"));
});

test("closed typography manifest parses terminal declarations and normalizes selector whitespace", () => {
  const source = exactInterFaceNoFinalSemicolon + "\n"
    + "body { font-weight: 400 }\n"
    + "button ,  .button { font: inherit; font-weight: 600 }\n"
    + ".markdown-content   >   h2 { font-weight: 700 }\n";
  const expected = [
    [".button", "font", "inherit"],
    [".button", "font-weight", "600"],
    [".markdown-content>h2", "font-weight", "700"],
    ["body", "font-weight", "400"],
    ["button", "font", "inherit"],
    ["button", "font-weight", "600"]
  ];

  assert.deepEqual(closedTypographyPolicyViolations(source, expected), []);
});

test("top-level media and supports containers remain supported", () => {
  const source = exactInterFace + "\n"
    + "@media (min-width: 1px) { .button { font-weight: 600; } }\n"
    + "@supports (display: grid) { button { font: inherit; } }\n";
  const expected = [
    [".button", "font-weight", "600"],
    ["button", "font", "inherit"]
  ];

  assert.deepEqual(closedTypographyPolicyViolations(source, expected), []);
});


function elementBodyForClass(html, tagName, className) {
  const elementPattern = new RegExp(
    "<" + tagName + "\\b([^>]*)>([\\s\\S]*?)<\\/" + tagName + ">",
    "gi"
  );
  for (const match of html.matchAll(elementPattern)) {
    const classMatch = match[1].match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const classValue = classMatch?.[1] ?? classMatch?.[2] ?? "";
    if (classValue.split(/\s+/).includes(className)) return match[2];
  }
  return null;
}

test("popup and options strong text is fully inventoried at explicit weight 600", async () => {
  const css = await readStylesheets();

  for (const { name, url, bindings } of productStrongElements) {
    const html = await readFile(url, "utf8");
    const strongCount = (html.match(new RegExp("<strong\\b", "gi")) ?? []).length;
    assert.equal(strongCount, bindings.length, name + " strong element inventory changed");

    const counts = countManifestEntries(typographyDeclarationManifest(parseStylesheet(css[name])));
    for (const { selector, containerTag, containerClass } of bindings) {
      assert.equal(selector, "." + containerClass + " strong");
      const containerBody = elementBodyForClass(html, containerTag, containerClass);
      assert.notEqual(containerBody, null, name + " selector container is missing from markup");
      assert.equal(
        (containerBody.match(/<strong\b/gi) ?? []).length,
        1,
        name + " selector must bind one strong element in its markup container"
      );
      const declaration = [selector, "font-weight", "600"];
      assert.equal(
        counts.get(JSON.stringify(declaration)) ?? 0,
        1,
        name + " must declare " + selector + " at font-weight 600"
      );
    }
  }
});

test("product CSS exactly matches the reviewed typography declaration manifests", async () => {
  const css = await readStylesheets();

  for (const { name } of stylesheets) {
    assert.deepEqual(
      closedTypographyPolicyViolations(css[name], reviewedTypographyManifest[name]),
      [],
      name + " CSS changed its reviewed typography declarations"
    );
  }
});
