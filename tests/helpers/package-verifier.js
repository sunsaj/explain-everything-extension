import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { verifyProductAttestation } from "./product-attestation.js";
import { assertRuntimeReferenceAllowed } from "./runtime-reference-policy.js";

const ALLOWED_MANIFEST_TOP_LEVEL_FIELDS = new Set([
  "action",
  "background",
  "chrome_url_overrides",
  "content_scripts",
  "declarative_net_request",
  "description",
  "devtools_page",
  "icons",
  "manifest_version",
  "minimum_chrome_version",
  "name",
  "optional_host_permissions",
  "options_page",
  "options_ui",
  "permissions",
  "sandbox",
  "side_panel",
  "version",
  "web_accessible_resources"
]);

const ALLOWED_DIRECTORIES = new Set([
  "assets",
  "assets/fonts",
  "content",
  "icons",
  "options",
  "popup",
  "rules",
  "scripts",
  "shared",
  "tests",
  "tests/helpers"
]);

const ALLOWED_TOP_LEVEL_FILES = new Set([
  "README.md",
  "background.js",
  "manifest.json",
  "package.json"
]);

const KNOWN_BINARY_EXTENSIONS = new Set([".png", ".woff2"]);
const NETWORK_PRIMITIVES = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "sendBeacon"
];
const PRIVATE_SETTING_IDENTIFIERS = [
  "apiKey",
  "endpoint",
  "model",
  "systemPrompt",
  "settingsVersion"
];
const SAFE_SHARED_API_IMPORTS = new Set([
  "getSafeRequestErrorDetails",
  "normalizeEndpoint",
  "permissionPatternForEndpoint"
]);
const SOURCE_EXTENSIONS = new Set([".css", ".html", ".js"]);
const PACKAGE_EXCLUDED_ROOT_ENTRIES = new Set([".git", ".gitattributes"]);

function packagePath(extensionRoot, filePath) {
  return relative(extensionRoot, filePath).split(sep).join("/");
}

function isInsideRoot(extensionRoot, candidate) {
  const fromRoot = relative(extensionRoot, candidate);
  return Boolean(fromRoot)
    && fromRoot !== ".."
    && !fromRoot.startsWith(".." + sep)
    && !isAbsolute(fromRoot);
}

async function walkEntries(directory, extensionRoot = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  const directories = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (directory === extensionRoot && PACKAGE_EXCLUDED_ROOT_ENTRIES.has(entry.name.toLowerCase())) continue;
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      directories.push(entryPath);
      const nested = await walkEntries(entryPath, extensionRoot);
      files.push(...nested.files);
      directories.push(...nested.directories);
    } else if (entry.isFile()) {
      files.push(entryPath);
    } else {
      assert.fail(`unsupported filesystem entry: ${packagePath(extensionRoot, entryPath)}`);
    }
  }
  return { files, directories };
}

export async function walkFiles(directory) {
  return (await walkEntries(directory)).files;
}

function isAllowedDirectory(relativePath) {
  return ALLOWED_DIRECTORIES.has(relativePath)
    || relativePath.startsWith("rules/");
}

function isAllowedPackageFile(relativePath) {
  if (ALLOWED_TOP_LEVEL_FILES.has(relativePath)) return true;
  return [
    /^assets\/fonts\/(?:InterVariable\.woff2|OFL\.txt)$/,
    /^content\/[a-z0-9-]+\.(?:css|js)$/,
    /^icons\/icon-(?:16|32|48|128)\.png$/,
    /^options\/[a-z0-9-]+\.(?:css|html|js)$/,
    /^popup\/[a-z0-9-]+\.(?:css|html|js)$/,
    /^rules\/[A-Za-z0-9._/-]+\.json$/,
    /^scripts\/generate_icons\.py$/,
    /^shared\/[a-z0-9-]+\.js$/,
    /^tests\/[a-z0-9-]+\.test\.js$/,
    /^tests\/helpers\/[a-z0-9-]+\.js$/,
    /^tests\/helpers\/approved-product-hashes\.json$/
  ].some((pattern) => pattern.test(relativePath));
}

function decodeUtf8(buffer, relativePath) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`non-binary file is not valid UTF-8: ${relativePath}`);
  }
}

export async function verifyPackageHygiene(extensionRoot) {
  await verifyProductAttestation(extensionRoot);
  const { files, directories } = await walkEntries(extensionRoot);
  const problems = [];

  for (const directoryPath of directories) {
    const relativePath = packagePath(extensionRoot, directoryPath);
    if (!isAllowedDirectory(relativePath)) {
      problems.push(`unexpected artifact directory: ${relativePath}`);
    }
  }

  for (const filePath of files) {
    const relativePath = packagePath(extensionRoot, filePath);
    const extension = extname(filePath).toLowerCase();
    const allowedPath = isAllowedPackageFile(relativePath);
    if (KNOWN_BINARY_EXTENSIONS.has(extension)) {
      if (!allowedPath) {
        problems.push(`unexpected artifact path or unsupported type: ${relativePath}`);
      }
      continue;
    }

    let source;
    try {
      source = decodeUtf8(await readFile(filePath), relativePath);
    } catch (error) {
      problems.push(error.message);
      if (!allowedPath) {
        problems.push(`unexpected artifact path or unsupported type: ${relativePath}`);
      }
      continue;
    }
    if (/\bsk-[A-Za-z0-9_-]{16,}\b/.test(source)) {
      problems.push(`hard-coded sk-like credential in ${relativePath}`);
    }
    if (/-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/.test(source)) {
      problems.push(`hard-coded private key in ${relativePath}`);
    }
    if (!allowedPath) {
      problems.push(`unexpected artifact path or unsupported type: ${relativePath}`);
    }
  }

  assert.equal(problems.length, 0, problems.join("\n"));
}

function assertManifestPolicy(manifest) {
  const unhandled = Object.keys(manifest).filter(
    (field) => !ALLOWED_MANIFEST_TOP_LEVEL_FIELDS.has(field)
  );
  assert.deepEqual(
    unhandled,
    [],
    `unhandled top-level manifest fields: ${unhandled.join(", ")}`
  );
}

function iconReferences(value, location) {
  if (typeof value === "string") return [{ value, location }];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).map(([size, reference]) => ({
    value: reference,
    location: `${location}.${size}`
  }));
}

function manifestFileReferences(manifest) {
  const references = [];
  const add = (value, location) => {
    if (value !== undefined) references.push({ value, location });
  };

  add(manifest.background?.service_worker, "background.service_worker");
  add(manifest.action?.default_popup, "action.default_popup");
  references.push(...iconReferences(manifest.action?.default_icon, "action.default_icon"));
  references.push(...iconReferences(manifest.icons, "icons"));
  add(manifest.options_page, "options_page");
  add(manifest.options_ui?.page, "options_ui.page");
  add(manifest.devtools_page, "devtools_page");
  add(manifest.side_panel?.default_path, "side_panel.default_path");

  for (const [index, entry] of (manifest.content_scripts ?? []).entries()) {
    for (const [scriptIndex, value] of (entry.js ?? []).entries()) {
      add(value, `content_scripts.${index}.js.${scriptIndex}`);
    }
    for (const [styleIndex, value] of (entry.css ?? []).entries()) {
      add(value, `content_scripts.${index}.css.${styleIndex}`);
    }
  }
  for (const [index, entry] of (manifest.web_accessible_resources ?? []).entries()) {
    for (const [resourceIndex, value] of (entry.resources ?? []).entries()) {
      add(value, `web_accessible_resources.${index}.resources.${resourceIndex}`);
    }
  }
  for (const [name, value] of Object.entries(manifest.chrome_url_overrides ?? {})) {
    add(value, `chrome_url_overrides.${name}`);
  }
  for (const [index, value] of (manifest.sandbox?.pages ?? []).entries()) {
    add(value, `sandbox.pages.${index}`);
  }
  for (const [index, entry] of (manifest.declarative_net_request?.rule_resources ?? []).entries()) {
    add(entry?.path, `declarative_net_request.rule_resources.${index}.path`);
  }
  return references;
}

function isExternalReference(reference) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(reference);
}

function resolveLocalReference(extensionRoot, sourcePath, reference, options = {}) {
  assert.equal(
    typeof reference,
    "string",
    `file reference must be a string at ${options.context ?? packagePath(extensionRoot, sourcePath)}`
  );
  const trimmed = reference.trim();
  assert.ok(trimmed, `empty file reference at ${options.context ?? sourcePath}`);
  assert.doesNotMatch(trimmed, /[*]/, `wildcard file reference is not verifiable: ${trimmed}`);
  assert.ok(
    !isExternalReference(trimmed),
    `external runtime resource at ${options.context ?? packagePath(extensionRoot, sourcePath)}: ${trimmed}`
  );
  if (options.moduleSpecifier) {
    assert.ok(
      trimmed.startsWith(".") || trimmed.startsWith("/"),
      `external module specifier at ${packagePath(extensionRoot, sourcePath)}: ${trimmed}`
    );
  }

  const cleanReference = trimmed.split(/[?#]/, 1)[0];
  const candidate = options.rootRelative || cleanReference.startsWith("/")
    ? resolve(extensionRoot, cleanReference.replace(/^\/+/, ""))
    : resolve(dirname(sourcePath), cleanReference);
  assert.ok(
    isInsideRoot(extensionRoot, candidate),
    `reference escapes the extension package: ${trimmed} from ${packagePath(extensionRoot, sourcePath)}`
  );
  assertRuntimeReferenceAllowed(
    extensionRoot,
    candidate,
    trimmed,
    options.context ?? packagePath(extensionRoot, sourcePath)
  );
  return candidate;
}

async function assertReferencedFile(extensionRoot, candidate, reference) {
  const fileStat = await stat(candidate).catch(() => null);
  assert.ok(fileStat?.isFile(), `missing referenced file ${reference}: ${candidate}`);
  const [realRoot, realCandidate] = await Promise.all([
    realpath(extensionRoot),
    realpath(candidate)
  ]);
  assert.ok(
    isInsideRoot(realRoot, realCandidate),
    `resolved reference escapes the extension package: ${reference}`
  );
}

function stripJsComments(source) {
  let output = "";
  let state = "code";
  let quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (state === "line-comment") {
      if (current === "\n") {
        state = "code";
        output += "\n";
      } else output += " ";
      continue;
    }
    if (state === "block-comment") {
      if (current === "*" && next === "/") {
        output += "  ";
        index += 1;
        state = "code";
      } else output += current === "\n" ? "\n" : " ";
      continue;
    }
    if (state === "string") {
      output += current;
      if (current === "\\") {
        output += next ?? "";
        index += 1;
      } else if (current === quote) {
        state = "code";
      }
      continue;
    }
    if (current === "/" && next === "/") {
      output += "  ";
      index += 1;
      state = "line-comment";
    } else if (current === "/" && next === "*") {
      output += "  ";
      index += 1;
      state = "block-comment";
    } else if (["'", "\"", "`"].includes(current)) {
      quote = current;
      state = "string";
      output += current;
    } else {
      output += current;
    }
  }
  return output;
}

const REGEX_PREFIX_KEYWORDS = new Set([
  "await",
  "case",
  "delete",
  "else",
  "in",
  "instanceof",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield"
]);

export function maskExecutableJavaScript(source) {
  const output = Array(source.length).fill(" ");
  const stack = [{
    type: "code",
    templateExpression: false,
    braceDepth: 0,
    canStartRegex: true
  }];
  let index = 0;

  const completeValue = () => {
    const parent = stack[stack.length - 1];
    if (parent?.type === "code") parent.canStartRegex = false;
  };

  while (index < source.length) {
    const context = stack[stack.length - 1];
    const current = source[index];
    const next = source[index + 1];

    if (context.type === "line-comment") {
      if (current === "\n") {
        output[index] = "\n";
        stack.pop();
      }
      index += 1;
      continue;
    }
    if (context.type === "block-comment") {
      if (current === "*" && next === "/") {
        index += 2;
        stack.pop();
      } else {
        if (current === "\n") output[index] = "\n";
        index += 1;
      }
      continue;
    }
    if (context.type === "string") {
      if (current === "\\") {
        index += 2;
      } else if (current === context.quote) {
        index += 1;
        stack.pop();
        completeValue();
      } else {
        if (current === "\n") output[index] = "\n";
        index += 1;
      }
      continue;
    }
    if (context.type === "regex") {
      if (current === "\\") {
        index += 2;
      } else if (current === "[" && !context.inCharacterClass) {
        context.inCharacterClass = true;
        index += 1;
      } else if (current === "]" && context.inCharacterClass) {
        context.inCharacterClass = false;
        index += 1;
      } else if (current === "/" && !context.inCharacterClass) {
        index += 1;
        while (/[A-Za-z]/.test(source[index] ?? "")) index += 1;
        stack.pop();
        completeValue();
      } else {
        if (current === "\n") output[index] = "\n";
        index += 1;
      }
      continue;
    }
    if (context.type === "template") {
      if (current === "\\") {
        index += 2;
      } else if (current.charCodeAt(0) === 96) {
        index += 1;
        stack.pop();
        completeValue();
      } else if (current === "$" && next === "{") {
        index += 2;
        stack.push({
          type: "code",
          templateExpression: true,
          braceDepth: 1,
          canStartRegex: true
        });
      } else {
        if (current === "\n") output[index] = "\n";
        index += 1;
      }
      continue;
    }

    if (/\s/.test(current)) {
      output[index] = current;
      index += 1;
      continue;
    }
    if (current === "/" && next === "/") {
      index += 2;
      stack.push({ type: "line-comment" });
      continue;
    }
    if (current === "/" && next === "*") {
      index += 2;
      stack.push({ type: "block-comment" });
      continue;
    }
    if (current === "'" || current === "\"") {
      index += 1;
      stack.push({ type: "string", quote: current });
      continue;
    }
    if (current.charCodeAt(0) === 96) {
      index += 1;
      stack.push({ type: "template" });
      continue;
    }
    if (current === "/" && context.canStartRegex) {
      index += 1;
      stack.push({ type: "regex", inCharacterClass: false });
      continue;
    }
    if (/[A-Za-z_$]/.test(current)) {
      let end = index + 1;
      while (/[\w$]/.test(source[end] ?? "")) end += 1;
      const token = source.slice(index, end);
      for (let cursor = index; cursor < end; cursor += 1) output[cursor] = source[cursor];
      context.canStartRegex = REGEX_PREFIX_KEYWORDS.has(token);
      index = end;
      continue;
    }
    if (/[0-9]/.test(current)) {
      let end = index + 1;
      while (/[0-9A-Fa-f_xXn.]/.test(source[end] ?? "")) end += 1;
      for (let cursor = index; cursor < end; cursor += 1) output[cursor] = source[cursor];
      context.canStartRegex = false;
      index = end;
      continue;
    }
    if (context.templateExpression && current === "{") {
      context.braceDepth += 1;
      output[index] = current;
      context.canStartRegex = true;
      index += 1;
      continue;
    }
    if (context.templateExpression && current === "}") {
      context.braceDepth -= 1;
      index += 1;
      if (context.braceDepth === 0) stack.pop();
      else context.canStartRegex = false;
      continue;
    }

    output[index] = current;
    if (/[\[({,;:=!?&|+*%^~<>-]/.test(current)) {
      context.canStartRegex = true;
    } else if (/[.\])}]/.test(current)) {
      context.canStartRegex = false;
    } else if (current === "/") {
      context.canStartRegex = true;
    }
    index += 1;
  }

  return output.join("");
}

export function computedRootAccesses(source, roots) {
  const executable = maskExecutableJavaScript(source);
  return roots.filter((root) => {
    const escapedRoot = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const direct = new RegExp(`\\b${escapedRoot}\\s*(?:\\?\\.\\s*)?\\[`);
    const parenthesized = new RegExp(
      `\\(\\s*${escapedRoot}\\s*\\)\\s*(?:\\?\\.\\s*)?\\[`
    );
    return direct.test(executable) || parenthesized.test(executable);
  });
}

export function extractJavaScriptReferences(source) {
  const references = [];
  const withoutComments = stripJsComments(source);
  for (const match of withoutComments.matchAll(
    /\b(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g
  )) {
    references.push({ value: match[1], rootRelative: false, moduleSpecifier: true });
  }
  for (const match of withoutComments.matchAll(
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  )) {
    references.push({ value: match[1], rootRelative: false, moduleSpecifier: true });
  }
  for (const match of withoutComments.matchAll(
    /chrome\.runtime\.getURL\(\s*["']([^"']+)["']\s*\)/g
  )) {
    references.push({ value: match[1], rootRelative: true, moduleSpecifier: false });
  }
  for (const match of withoutComments.matchAll(
    /new\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g
  )) {
    references.push({ value: match[1], rootRelative: false, moduleSpecifier: false });
  }
  for (const match of withoutComments.matchAll(
    /\bimportScripts\s*\(\s*["']([^"']+)["']\s*\)/g
  )) {
    references.push({ value: match[1], rootRelative: false, moduleSpecifier: false });
  }
  return references;
}

function htmlAttributeValue(attributes, attribute) {
  const match = attributes.match(new RegExp(
    "\\b" + attribute + "\\s*=\\s*(?:\\\"([^\\\"]*)\\\"|'([^']*)'|([^\\s\\\"'=<>`]+))",
    "i"
  ));
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

function extractHtmlReferences(source) {
  const references = [];
  const withoutComments = source.replace(/<!--[\s\S]*?-->/g, "");
  const attributesByTag = {
    audio: ["src"],
    embed: ["src"],
    iframe: ["src"],
    img: ["src"],
    input: ["src"],
    link: ["href"],
    object: ["data"],
    script: ["src"],
    source: ["src"],
    video: ["poster", "src"]
  };
  for (const match of withoutComments.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const tag = match[1].toLowerCase();
    const allowedAttributes = attributesByTag[tag];
    if (!allowedAttributes) continue;
    for (const attribute of allowedAttributes) {
      const value = htmlAttributeValue(match[2], attribute);
      if (value !== null) {
        references.push({ value, rootRelative: false, moduleSpecifier: false });
      }
    }
  }
  return references;
}

function extractCssReferences(source) {
  const references = [];
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const values = new Set();
  for (const match of withoutComments.matchAll(
    /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?/gi
  )) values.add(match[1]);
  for (const match of withoutComments.matchAll(
    /url\(\s*["']?([^"')\s]+)["']?\s*\)/gi
  )) values.add(match[1]);
  for (const value of values) {
    references.push({ value, rootRelative: false, moduleSpecifier: false });
  }
  return references;
}

function resourceSinkError(extensionRoot, filePath, valueSource) {
  const relativePath = packagePath(extensionRoot, filePath);
  const literal = valueSource.match(/^\s*["'`]([^"'`]+)["'`]/);
  if (literal && isExternalReference(literal[1])) {
    assert.fail(`external runtime resource in JavaScript resource sink ${relativePath}: ${literal[1]}`);
  }
  assert.fail(
    `JavaScript resource sink in ${relativePath} must use exact chrome.runtime.getURL("local/path"): ${valueSource.trim()}`
  );
}

async function validateRuntimeGetUrl(extensionRoot, filePath, reference) {
  const candidate = resolveLocalReference(extensionRoot, filePath, reference, {
    context: `JavaScript resource sink in ${packagePath(extensionRoot, filePath)}`,
    rootRelative: true
  });
  await assertReferencedFile(extensionRoot, candidate, reference);
}

export function extractJavaScriptResourceSinks(source) {
  const withoutComments = stripJsComments(source);
  const sinks = [];
  const propertySink = /(?:\.\s*(src|href)|\[\s*(["'\x60])(src|href)\2\s*\])\s*(\|\|=|&&=|\?\?=|=(?!=|>))/gi;
  for (const match of withoutComments.matchAll(propertySink)) {
    sinks.push({
      index: match.index,
      kind: "property",
      attribute: (match[1] ?? match[3]).toLowerCase(),
      operator: match[4],
      valueSource: withoutComments.slice(match.index + match[0].length)
    });
  }

  const setAttributeSink = /\.setAttribute\s*\(\s*(["'\x60])(src|href)\1\s*,/gi;
  for (const match of withoutComments.matchAll(setAttributeSink)) {
    sinks.push({
      index: match.index,
      kind: "setAttribute",
      attribute: match[2].toLowerCase(),
      operator: null,
      valueSource: withoutComments.slice(match.index + match[0].length)
    });
  }

  return sinks.sort((left, right) => left.index - right.index);
}

export function exactRuntimeGetUrlReference(valueSource, kind) {
  const pattern = kind === "setAttribute"
    ? /^\s*chrome\.runtime\.getURL\(\s*(["'])([^"']+)\1\s*\)\s*\)\s*;?/
    : /^\s*chrome\.runtime\.getURL\(\s*(["'])([^"']+)\1\s*\)\s*(?:;|\r?\n|$)/;
  return valueSource.match(pattern)?.[2] ?? null;
}

export async function verifyJavaScriptResourceSinks(extensionRoot, filePath, source) {
  for (const sink of extractJavaScriptResourceSinks(source)) {
    const relativePath = packagePath(extensionRoot, filePath);
    const safeMarkdownLink = relativePath === "content/markdown.js"
      && sink.kind === "setAttribute"
      && sink.attribute === "href"
      && /^\s*safeHref\s*\)\s*;?/.test(sink.valueSource);
    if (safeMarkdownLink) continue;

    const allowedReference = exactRuntimeGetUrlReference(sink.valueSource, sink.kind);
    if (!allowedReference) {
      resourceSinkError(
        extensionRoot,
        filePath,
        sink.valueSource.split(/[;\r\n]/, 1)[0]
      );
    }
    await validateRuntimeGetUrl(extensionRoot, filePath, allowedReference);
  }
}

function sourceReferences(filePath, source) {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".js") return extractJavaScriptReferences(source);
  if (extension === ".html") return extractHtmlReferences(source);
  if (extension === ".css") return extractCssReferences(source);
  return [];
}

export async function verifyResourceGraph(extensionRoot) {
  await verifyProductAttestation(extensionRoot);
  const manifestPath = join(extensionRoot, "manifest.json");
  const manifest = JSON.parse(decodeUtf8(await readFile(manifestPath), "manifest.json"));
  assertManifestPolicy(manifest);

  const pending = [];
  for (const reference of manifestFileReferences(manifest)) {
    const candidate = resolveLocalReference(extensionRoot, manifestPath, reference.value, {
      context: reference.location,
      rootRelative: true
    });
    await assertReferencedFile(extensionRoot, candidate, reference.value);
    pending.push(candidate);
  }

  const { files } = await walkEntries(extensionRoot);
  for (const filePath of files) {
    if (
      SOURCE_EXTENSIONS.has(extname(filePath).toLowerCase())
      && !packagePath(extensionRoot, filePath).startsWith("tests/")
    ) pending.push(filePath);
  }

  const visited = new Set();
  while (pending.length) {
    const filePath = pending.pop();
    const key = resolve(filePath).toLowerCase();
    if (visited.has(key) || !SOURCE_EXTENSIONS.has(extname(filePath).toLowerCase())) continue;
    visited.add(key);
    const source = decodeUtf8(await readFile(filePath), packagePath(extensionRoot, filePath));
    if (extname(filePath).toLowerCase() === ".js") {
      await verifyJavaScriptResourceSinks(extensionRoot, filePath, source);
    }
    for (const reference of sourceReferences(filePath, source)) {
      if (reference.value.startsWith("#")) continue;
      const candidate = resolveLocalReference(extensionRoot, filePath, reference.value, reference);
      await assertReferencedFile(extensionRoot, candidate, reference.value);
      pending.push(candidate);
    }
  }
}

export async function verifyRuntimeSecurity(extensionRoot) {
  await verifyProductAttestation(extensionRoot);
  const { files } = await walkEntries(extensionRoot);
  for (const filePath of files) {
    if (
      extname(filePath).toLowerCase() !== ".html"
      || packagePath(extensionRoot, filePath).startsWith("tests/")
    ) continue;
    const source = decodeUtf8(await readFile(filePath), packagePath(extensionRoot, filePath));
    const withoutComments = source.replace(/<!--[\s\S]*?-->/g, "");
    for (const match of withoutComments.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
      assert.equal(
        match[1].trim(),
        "",
        `inline script body in ${packagePath(extensionRoot, filePath)}`
      );
    }
  }
}

async function contentExecutableGraph(extensionRoot, manifest) {
  const manifestPath = join(extensionRoot, "manifest.json");
  const pending = [];
  for (const [index, entry] of (manifest.content_scripts ?? []).entries()) {
    for (const [scriptIndex, reference] of (entry.js ?? []).entries()) {
      const candidate = resolveLocalReference(extensionRoot, manifestPath, reference, {
        context: `content_scripts.${index}.js.${scriptIndex}`,
        rootRelative: true
      });
      await assertReferencedFile(extensionRoot, candidate, reference);
      pending.push(candidate);
    }
  }

  const graph = new Set();
  while (pending.length) {
    const filePath = pending.pop();
    const relativePath = packagePath(extensionRoot, filePath);
    if (graph.has(relativePath)) continue;
    assert.equal(extname(filePath).toLowerCase(), ".js", `content executable is not JavaScript: ${relativePath}`);
    graph.add(relativePath);
    const source = decodeUtf8(await readFile(filePath), relativePath);
    for (const reference of extractJavaScriptReferences(source)) {
      const candidate = resolveLocalReference(extensionRoot, filePath, reference.value, reference);
      await assertReferencedFile(extensionRoot, candidate, reference.value);
      if (extname(candidate).toLowerCase() === ".js") pending.push(candidate);
    }
  }
  return graph;
}

function matchingIdentifiers(source, identifiers) {
  return identifiers.filter((identifier) =>
    new RegExp(`\\b${identifier}\\b`).test(source)
  );
}

function resolvePackageModuleSpecifier(relativePath, specifier) {
  if (!specifier.startsWith(".")) return specifier.replace(/^\/+/, "");
  const parts = relativePath.split("/");
  parts.pop();
  for (const part of specifier.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function isSharedApiSpecifier(relativePath, specifier) {
  return resolvePackageModuleSpecifier(relativePath, specifier) === "shared/api.js";
}

export function sharedApiExposures(source, relativePath) {
  const withoutComments = stripJsComments(source);
  const exposures = [];
  const patterns = [
    {
      kind: "namespace import",
      pattern: /import\s+\*\s+as\s+[A-Za-z_$][\w$]*\s+from\s*["']([^"']+)["']/g
    },
    {
      kind: "dynamic import",
      pattern: /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
    },
    {
      kind: "namespace re-export",
      pattern: /export\s+\*\s+as\s+[A-Za-z_$][\w$]*\s+from\s*["']([^"']+)["']/g
    },
    {
      kind: "star re-export",
      pattern: /export\s+\*\s+from\s*["']([^"']+)["']/g
    }
  ];

  for (const { kind, pattern } of patterns) {
    for (const match of withoutComments.matchAll(pattern)) {
      if (isSharedApiSpecifier(relativePath, match[1])) {
        exposures.push({ index: match.index, kind });
      }
    }
  }

  return exposures
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.kind);
}

function sharedApiImports(source, relativePath) {
  const withoutComments = stripJsComments(source);
  const named = [];
  for (const match of withoutComments.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g
  )) {
    if (!isSharedApiSpecifier(relativePath, match[2])) continue;
    for (const item of match[1].split(",")) {
      const imported = item.trim().split(/\s+as\s+/i)[0]?.trim();
      if (imported) named.push(imported);
    }
  }
  return {
    exposures: sharedApiExposures(source, relativePath),
    named
  };
}

export function networkPrimitivesIn(source) {
  const executable = maskExecutableJavaScript(source);
  return NETWORK_PRIMITIVES.filter((primitive) =>
    new RegExp(`\\b${primitive}\\b`).test(executable)
  );
}

export async function verifyRequestArchitecture(extensionRoot) {
  await verifyProductAttestation(extensionRoot);
  const manifest = JSON.parse(decodeUtf8(
    await readFile(join(extensionRoot, "manifest.json")),
    "manifest.json"
  ));
  assertManifestPolicy(manifest);
  const contentGraph = await contentExecutableGraph(extensionRoot, manifest);
  const { files } = await walkEntries(extensionRoot);
  const productScripts = files.filter((filePath) =>
    extname(filePath).toLowerCase() === ".js"
    && !packagePath(extensionRoot, filePath).startsWith("tests/")
  );

  for (const filePath of productScripts) {
    const relativePath = packagePath(extensionRoot, filePath);
    const source = decodeUtf8(await readFile(filePath), relativePath);
    const executable = maskExecutableJavaScript(source);
    const requestIdentifiers = [...executable.matchAll(/\brequestExplanation\b/g)].length;
    const apiImports = sharedApiImports(source, relativePath);

    if (relativePath !== "shared/api.js") {
      assert.deepEqual(
        apiImports.exposures,
        [],
        `shared/api.js namespace exposure outside its defining module in ${relativePath}: ${apiImports.exposures.join(", ")}`
      );
    }

    if (!["shared/api.js", "background.js"].includes(relativePath)) {
      const unsafeNamedImports = apiImports.named.filter(
        (name) => !SAFE_SHARED_API_IMPORTS.has(name)
      );
      assert.deepEqual(
        unsafeNamedImports,
        [],
        `unsafe named import from shared/api.js outside background.js in ${relativePath}: ${unsafeNamedImports.join(", ")}`
      );
    }

    if (relativePath === "shared/api.js") {
      assert.match(
        executable,
        /\b(?:async\s+)?function\s+requestExplanation\s*\(/,
        "requestExplanation must be defined in shared/api.js"
      );
      assert.equal(requestIdentifiers, 1, "shared/api.js must contain only the requestExplanation definition");
    } else if (relativePath === "background.js") {
      const backgroundApiImports = [...stripJsComments(source).matchAll(
        /import\s*\{([^}]*)\}\s*from\s*["']\.\/shared\/api\.js["']/g
      )];
      assert.ok(
        backgroundApiImports.some((match) => match[1].split(",").some(
          (item) => item.trim() === "requestExplanation"
        )),
        "background.js must directly import requestExplanation from shared/api.js"
      );
      assert.equal(
        [...executable.matchAll(/\brequestExplanation\s*\(/g)].length,
        1,
        "background.js must directly call requestExplanation exactly once"
      );
      assert.equal(
        requestIdentifiers,
        2,
        "background.js may reference requestExplanation only in its direct import and call"
      );
    } else {
      assert.equal(
        requestIdentifiers,
        0,
        `requestExplanation identifier outside shared/api.js/background.js: ${relativePath}`
      );
    }

    if (relativePath !== "shared/api.js") {
      const computedGlobals = computedRootAccesses(
        source,
        ["globalThis", "window", "self"]
      );
      assert.deepEqual(
        computedGlobals,
        [],
        `computed global access outside shared/api.js in ${relativePath}: ${computedGlobals.join(", ")}`
      );
      const networkPrimitives = networkPrimitivesIn(source);
      assert.deepEqual(
        networkPrimitives,
        [],
        `network primitive outside shared/api.js in ${relativePath}: ${networkPrimitives.join(", ")}`
      );
    }
  }

  for (const relativePath of contentGraph) {
    const filePath = join(extensionRoot, ...relativePath.split("/"));
    const source = decodeUtf8(await readFile(filePath), relativePath);
    const executable = maskExecutableJavaScript(source);
    const privateIdentifiers = matchingIdentifiers(executable, PRIVATE_SETTING_IDENTIFIERS);
    assert.deepEqual(
      privateIdentifiers,
      [],
      `private setting identifiers in content executable ${relativePath}: ${privateIdentifiers.join(", ")}`
    );
    const computedSettings = computedRootAccesses(source, ["settings"]);
    assert.deepEqual(
      computedSettings,
      [],
      `computed settings access in content executable ${relativePath}`
    );
    const computedChrome = computedRootAccesses(source, ["chrome"]);
    assert.deepEqual(
      computedChrome,
      [],
      `computed chrome access in content executable ${relativePath}`
    );
    assert.doesNotMatch(
      executable,
      /\bchrome\s*\.\s*storage\s*\.\s*local\b/,
      `chrome.storage.local access in content executable ${relativePath}`
    );
    assert.doesNotMatch(
      executable,
      /\bAuthorization\b/i,
      `Authorization handling in content executable ${relativePath}`
    );
    const networkPrimitives = networkPrimitivesIn(source);
    assert.deepEqual(
      networkPrimitives,
      [],
      `network primitive in content executable ${relativePath}: ${networkPrimitives.join(", ")}`
    );
    for (const reference of extractJavaScriptReferences(source)) {
      const candidate = resolveLocalReference(extensionRoot, filePath, reference.value, reference);
      const importedPath = packagePath(extensionRoot, candidate);
      assert.ok(
        !["shared/defaults.js", "shared/settings.js"].includes(importedPath),
        `private settings module imported by content executable ${relativePath}: ${importedPath}`
      );
    }
  }
}

export async function verifyIcons(extensionRoot) {
  await verifyProductAttestation(extensionRoot);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  for (const size of [16, 32, 48, 128]) {
    const iconPath = join(extensionRoot, "icons", `icon-${size}.png`);
    const icon = await readFile(iconPath);
    assert.deepEqual(icon.subarray(0, 8), signature, `invalid PNG signature: ${iconPath}`);
    assert.equal(icon.readUInt32BE(8), 13, `invalid IHDR length: ${iconPath}`);
    assert.equal(icon.subarray(12, 16).toString("ascii"), "IHDR", `missing IHDR: ${iconPath}`);
    assert.equal(icon.readUInt32BE(16), size, `wrong PNG width: ${iconPath}`);
    assert.equal(icon.readUInt32BE(20), size, `wrong PNG height: ${iconPath}`);
  }
}

export async function verifyIconDeterminism(extensionRoot) {
  await verifyProductAttestation(extensionRoot);
  const generatorPath = join(extensionRoot, "scripts", "generate_icons.py");
  const tempRoot = await mkdtemp(join(tmpdir(), "selection-explainer-icons-"));
  try {
    const generatedRoots = [];
    for (const runName of ["first", "second"]) {
      const runRoot = join(tempRoot, runName);
      const runScriptDirectory = join(runRoot, "scripts");
      await mkdir(runScriptDirectory, { recursive: true });
      const runGeneratorPath = join(runScriptDirectory, "generate_icons.py");
      await copyFile(generatorPath, runGeneratorPath);
      const result = spawnSync("python", [runGeneratorPath], {
        encoding: "utf8",
        windowsHide: true
      });
      assert.equal(result.status, 0, `icon generator failed: ${result.stderr || result.stdout}`);
      generatedRoots.push(runRoot);
    }
    for (const size of [16, 32, 48, 128]) {
      const packaged = await readFile(join(extensionRoot, "icons", `icon-${size}.png`));
      const first = await readFile(join(generatedRoots[0], "icons", `icon-${size}.png`));
      const second = await readFile(join(generatedRoots[1], "icons", `icon-${size}.png`));
      assert.deepEqual(first, second, `icon-${size}.png regeneration is not deterministic`);
      assert.deepEqual(packaged, first, `icon-${size}.png differs from deterministic regeneration`);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export async function verifyReadme(extensionRoot) {
  await verifyProductAttestation(extensionRoot);
  const readme = decodeUtf8(await readFile(join(extensionRoot, "README.md")), "README.md");
  for (const heading of [
    "Install",
    "Configure LiteLLM",
    "Use",
    "Privacy and security",
    "Troubleshooting",
    "Protected pages",
    "Test"
  ]) {
    assert.match(readme, new RegExp(`^## ${heading}$`, "m"), `missing README heading: ${heading}`);
  }
}
