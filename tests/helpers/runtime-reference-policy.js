import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

const SOURCE_EXTENSIONS = new Set([".css", ".html", ".js"]);
const VERIFIER_ONLY_DIRECTORIES = new Set(["tests"]);

function packagePath(extensionRoot, candidate) {
  return relative(extensionRoot, candidate).split(sep).join("/");
}

function isInsideRoot(extensionRoot, candidate) {
  const fromRoot = relative(extensionRoot, candidate);
  return Boolean(fromRoot)
    && fromRoot !== ".."
    && !fromRoot.startsWith(".." + sep)
    && !isAbsolute(fromRoot);
}

function isExternalReference(reference) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(reference);
}

export function isVerifierOnlyPackagePath(relativePath) {
  const [topLevelDirectory] = relativePath.split("/");
  return VERIFIER_ONLY_DIRECTORIES.has(topLevelDirectory.toLowerCase());
}

export function assertRuntimeReferenceAllowed(
  extensionRoot,
  candidate,
  reference,
  context
) {
  if (!isInsideRoot(extensionRoot, candidate)) return;
  const relativePath = packagePath(extensionRoot, candidate);
  assert.ok(
    !isVerifierOnlyPackagePath(relativePath),
    `forbidden runtime reference to verifier-only path ${relativePath} at ${context}: ${reference}`
  );
}

function manifestRuntimeReferences(manifest) {
  const references = [];
  const add = (value, location) => {
    if (value !== undefined) references.push({ value, location });
  };
  const addIcons = (value, location) => {
    if (typeof value === "string") add(value, location);
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [size, reference] of Object.entries(value)) {
        add(reference, location + "." + size);
      }
    }
  };

  add(manifest.background?.service_worker, "background.service_worker");
  add(manifest.action?.default_popup, "action.default_popup");
  addIcons(manifest.action?.default_icon, "action.default_icon");
  addIcons(manifest.icons, "icons");
  add(manifest.options_page, "options_page");
  add(manifest.options_ui?.page, "options_ui.page");
  add(manifest.devtools_page, "devtools_page");
  add(manifest.side_panel?.default_path, "side_panel.default_path");

  for (const [index, entry] of (manifest.content_scripts ?? []).entries()) {
    for (const [scriptIndex, value] of (entry.js ?? []).entries()) {
      add(value, "content_scripts." + index + ".js." + scriptIndex);
    }
    for (const [styleIndex, value] of (entry.css ?? []).entries()) {
      add(value, "content_scripts." + index + ".css." + styleIndex);
    }
  }
  for (const [index, entry] of (manifest.web_accessible_resources ?? []).entries()) {
    for (const [resourceIndex, value] of (entry.resources ?? []).entries()) {
      add(value, "web_accessible_resources." + index + ".resources." + resourceIndex);
    }
  }
  for (const [name, value] of Object.entries(manifest.chrome_url_overrides ?? {})) {
    add(value, "chrome_url_overrides." + name);
  }
  for (const [index, value] of (manifest.sandbox?.pages ?? []).entries()) {
    add(value, "sandbox.pages." + index);
  }
  for (const [index, entry] of (manifest.declarative_net_request?.rule_resources ?? []).entries()) {
    add(entry?.path, "declarative_net_request.rule_resources." + index + ".path");
  }
  return references;
}

function stripJavaScriptComments(source) {
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
    } else if (["'", "\"", "\x60"].includes(current)) {
      quote = current;
      state = "string";
      output += current;
    } else {
      output += current;
    }
  }
  return output;
}

function extractJavaScriptReferences(source) {
  const references = [];
  const withoutComments = stripJavaScriptComments(source);
  for (const match of withoutComments.matchAll(
    /\b(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g
  )) references.push({ value: match[1], rootRelative: false });
  for (const match of withoutComments.matchAll(
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  )) references.push({ value: match[1], rootRelative: false });
  for (const match of withoutComments.matchAll(
    /chrome\.runtime\.getURL\(\s*["']([^"']+)["']\s*\)/g
  )) references.push({ value: match[1], rootRelative: true });
  for (const match of withoutComments.matchAll(
    /new\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g
  )) references.push({ value: match[1], rootRelative: false });
  for (const match of withoutComments.matchAll(
    /\bimportScripts\s*\(\s*["']([^"']+)["']\s*\)/g
  )) references.push({ value: match[1], rootRelative: false });
  return references;
}

function htmlAttributeValue(attributes, attribute) {
  const match = attributes.match(new RegExp(
    "\\b" + attribute + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'=<>`]+))",
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
    const attributes = attributesByTag[match[1].toLowerCase()];
    if (!attributes) continue;
    for (const attribute of attributes) {
      const value = htmlAttributeValue(match[2], attribute);
      if (value !== null) references.push({ value, rootRelative: false });
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
  for (const value of values) references.push({ value, rootRelative: false });
  return references;
}

function sourceReferences(filePath, source) {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".js") return extractJavaScriptReferences(source);
  if (extension === ".html") return extractHtmlReferences(source);
  if (extension === ".css") return extractCssReferences(source);
  return [];
}

function resolveRuntimeReference(extensionRoot, sourcePath, reference, options = {}) {
  if (typeof reference !== "string") return null;
  const trimmed = reference.trim();
  if (!trimmed || trimmed.startsWith("#") || isExternalReference(trimmed)) return null;
  const cleanReference = trimmed.split(/[?#]/, 1)[0];
  const candidate = options.rootRelative || cleanReference.startsWith("/")
    ? resolve(extensionRoot, cleanReference.replace(/^\/+/, ""))
    : resolve(dirname(sourcePath), cleanReference);
  assertRuntimeReferenceAllowed(
    extensionRoot,
    candidate,
    trimmed,
    options.context ?? packagePath(extensionRoot, sourcePath)
  );
  return candidate;
}

async function collectProductSourceFiles(directory, extensionRoot, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (directory === extensionRoot && entry.name.toLowerCase() === "tests") continue;
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await collectProductSourceFiles(entryPath, extensionRoot, files);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(entryPath);
    }
  }
}

export async function verifyRuntimeReferencePolicy(extensionRoot) {
  const resolvedRoot = resolve(extensionRoot);
  const manifestPath = resolve(resolvedRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  for (const reference of manifestRuntimeReferences(manifest)) {
    resolveRuntimeReference(resolvedRoot, manifestPath, reference.value, {
      context: reference.location,
      rootRelative: true
    });
  }

  const sourceFiles = [];
  await collectProductSourceFiles(resolvedRoot, resolvedRoot, sourceFiles);
  for (const filePath of sourceFiles) {
    const source = await readFile(filePath, "utf8");
    for (const reference of sourceReferences(filePath, source)) {
      resolveRuntimeReference(resolvedRoot, filePath, reference.value, reference);
    }
  }
}
