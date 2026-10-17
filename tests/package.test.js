import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  verifyIconDeterminism,
  verifyIcons,
  verifyPackageHygiene,
  verifyReadme,
  verifyRequestArchitecture,
  verifyResourceGraph,
  verifyRuntimeSecurity
} from "./helpers/package-verifier.js";
import {
  APPROVED_PRODUCT_HASHES_URL,
  createProductHashInventory,
  serializeProductHashInventory,
  verifyProductAttestation,
  verifyProductAttestationAgainstInventory
} from "./helpers/product-attestation.js";

const extensionRoot = fileURLToPath(new URL("../", import.meta.url));
const hashHelperPath = fileURLToPath(
  new URL("./helpers/update-product-hashes.js", import.meta.url)
);
const gitAttributesUrl = new URL("../.gitattributes", import.meta.url);

test("manifest and local source references resolve to packaged files", async () => {
  await verifyResourceGraph(extensionRoot);
});

test("HTML files contain no inline script bodies", async () => {
  await verifyRuntimeSecurity(extensionRoot);
});

test("package paths, file types, UTF-8 text, and secrets satisfy the hygiene policy", async () => {
  await verifyPackageHygiene(extensionRoot);
});

test("only the background product path calls requestExplanation and content has no direct network credentials", async () => {
  await verifyRequestArchitecture(extensionRoot);
});

test("packaged icons have PNG signatures and IHDR dimensions matching their filenames", async () => {
  await verifyIcons(extensionRoot);
});

test("icon regeneration is deterministic and byte-identical to the packaged icons", async () => {
  await verifyIconDeterminism(extensionRoot);
});

test("README exposes every required user documentation section", async () => {
  await verifyReadme(extensionRoot);
});

test("approved product inventory exactly attests 33 product files and excludes verifier and VCS-only metadata", async () => {
  await verifyProductAttestation(extensionRoot);
  const first = await createProductHashInventory(extensionRoot);
  const second = await createProductHashInventory(extensionRoot);
  assert.deepEqual(first, second);
  assert.equal(first.files.length, 33);
  assert.ok(first.files.every((entry) => !entry.path.startsWith("tests/")));
  assert.ok(first.files.every((entry) => !entry.path.startsWith(".git/")));
  assert.ok(first.files.every((entry) => entry.path !== ".gitattributes"));
  assert.equal(
    serializeProductHashInventory(first),
    await readFile(APPROVED_PRODUCT_HASHES_URL, "utf8")
  );
});

test("product inventory rejects paths outside the extension root", async () => {
  await assert.rejects(
    () => verifyProductAttestationAgainstInventory(extensionRoot, {
      version: 1,
      algorithm: "sha256",
      files: [{ path: "../outside.js", sha256: "0".repeat(64) }]
    }),
    /product attestation inventory path escapes the extension root/i
  );
});

test("product hash maintenance helper passes deterministic check mode", () => {
  const result = spawnSync(process.execPath, [hashHelperPath, "--check"], {
    cwd: extensionRoot,
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /inventory is current for \d+ files/i);
});

test(".gitattributes enforces LF for attested text and binary handling for packaged assets", async () => {
  const source = await readFile(gitAttributesUrl, "utf8").catch(() => "");

  assert.doesNotMatch(source, /\r/);
  for (const extension of ["css", "html", "js", "json", "md", "py", "txt"]) {
    assert.match(source, new RegExp("^\\*\\." + extension + " text eol=lf$", "m"));
  }
  assert.match(source, /^\.gitattributes text eol=lf$/m);
  assert.match(source, /^\*\.png binary$/m);
  assert.match(source, /^\*\.woff2 binary$/m);
});


test("attested text product files already use LF bytes", async () => {
  const inventory = JSON.parse(await readFile(APPROVED_PRODUCT_HASHES_URL, "utf8"));
  const textExtensions = new Set(["css", "html", "js", "json", "md", "py", "txt"]);
  for (const entry of inventory.files) {
    const extension = entry.path.includes(".") ? entry.path.split(".").at(-1).toLowerCase() : "";
    if (!textExtensions.has(extension)) continue;
    const bytes = await readFile(new URL("../" + entry.path, import.meta.url));
    assert.equal(bytes.includes(13), false, entry.path + " must contain LF-only text bytes");
  }
});
