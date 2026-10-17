import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  readFile,
  readdir,
  realpath,
  stat
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { verifyRuntimeReferencePolicy } from "./runtime-reference-policy.js";

export const APPROVED_PRODUCT_HASHES_URL = new URL(
  "./approved-product-hashes.json",
  import.meta.url
);

function compareNames(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function slashPath(root, candidate) {
  return relative(root, candidate).split(sep).join("/");
}

function isContained(root, candidate) {
  const fromRoot = relative(root, candidate);
  return Boolean(fromRoot)
    && fromRoot !== ".."
    && !fromRoot.startsWith(".." + sep)
    && !isAbsolute(fromRoot);
}

function assertInventoryPath(extensionRoot, productPath) {
  assert.equal(
    typeof productPath,
    "string",
    "product attestation inventory paths must be strings"
  );
  assert.ok(productPath, "product attestation inventory paths must not be empty");
  assert.doesNotMatch(
    productPath,
    /\\/,
    `product attestation inventory path must use forward slashes: ${productPath}`
  );
  assert.ok(
    !productPath.startsWith("/") && !isAbsolute(productPath),
    `product attestation inventory path must be relative: ${productPath}`
  );
  const candidate = resolve(extensionRoot, ...productPath.split("/"));
  assert.ok(
    isContained(extensionRoot, candidate),
    `product attestation inventory path escapes the extension root: ${productPath}`
  );
  assert.equal(
    slashPath(extensionRoot, candidate),
    productPath,
    `product attestation inventory path is not normalized: ${productPath}`
  );
  return candidate;
}

async function collectProductFiles(directory, extensionRoot, realRoot, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareNames(left.name, right.name));

  for (const entry of entries) {
    if (directory === extensionRoot && entry.name === "tests") continue;
    const entryPath = resolve(directory, entry.name);
    const productPath = slashPath(extensionRoot, entryPath);

    assert.ok(
      entry.isDirectory() || entry.isFile(),
      `product attestation rejects unsupported filesystem entry: ${productPath}`
    );
    const realEntry = await realpath(entryPath);
    assert.ok(
      isContained(realRoot, realEntry),
      `product attestation path escapes the extension root: ${productPath}`
    );

    if (entry.isDirectory()) {
      await collectProductFiles(entryPath, extensionRoot, realRoot, files);
    } else {
      files.push(entryPath);
    }
  }
}

function validateInventory(inventory, extensionRoot) {
  assert.equal(
    inventory?.version,
    1,
    "product attestation inventory version must be 1"
  );
  assert.equal(
    inventory?.algorithm,
    "sha256",
    "product attestation inventory algorithm must be sha256"
  );
  assert.ok(
    Array.isArray(inventory?.files),
    "product attestation inventory files must be an array"
  );

  const paths = [];
  const seen = new Set();
  for (const entry of inventory.files) {
    assert.ok(
      entry && typeof entry === "object" && !Array.isArray(entry),
      "product attestation inventory entries must be objects"
    );
    assertInventoryPath(extensionRoot, entry.path);
    assert.match(
      entry.sha256,
      /^[a-f0-9]{64}$/,
      `product attestation inventory has invalid SHA-256 for ${entry.path}`
    );
    assert.ok(
      !entry.path.startsWith("tests/"),
      `product attestation inventory must exclude tests: ${entry.path}`
    );
    assert.ok(
      !seen.has(entry.path),
      `product attestation inventory has duplicate path: ${entry.path}`
    );
    seen.add(entry.path);
    paths.push(entry.path);
  }

  const sorted = [...paths].sort(compareNames);
  assert.deepEqual(
    paths,
    sorted,
    "product attestation inventory paths must be sorted deterministically"
  );
}

export async function createProductHashInventory(extensionRoot) {
  const resolvedRoot = resolve(extensionRoot);
  const rootStat = await stat(resolvedRoot).catch(() => null);
  assert.ok(rootStat?.isDirectory(), "product attestation root is not a directory: " + resolvedRoot);
  await verifyRuntimeReferencePolicy(resolvedRoot);
  const realRoot = await realpath(resolvedRoot);
  const files = [];
  await collectProductFiles(resolvedRoot, resolvedRoot, realRoot, files);

  const inventoryEntries = [];
  for (const filePath of files.sort((left, right) => compareNames(
    slashPath(resolvedRoot, left),
    slashPath(resolvedRoot, right)
  ))) {
    const bytes = await readFile(filePath);
    inventoryEntries.push({
      path: slashPath(resolvedRoot, filePath),
      sha256: createHash("sha256").update(bytes).digest("hex")
    });
  }

  return {
    version: 1,
    algorithm: "sha256",
    files: inventoryEntries
  };
}

export function serializeProductHashInventory(inventory) {
  return JSON.stringify(inventory, null, 2) + "\n";
}

export async function readApprovedProductHashInventory() {
  const source = await readFile(APPROVED_PRODUCT_HASHES_URL, "utf8");
  return JSON.parse(source);
}

export async function verifyProductAttestationAgainstInventory(extensionRoot, inventory) {
  const resolvedRoot = resolve(extensionRoot);
  validateInventory(inventory, resolvedRoot);
  const actual = await createProductHashInventory(resolvedRoot);
  const approvedByPath = new Map(inventory.files.map((entry) => [entry.path, entry.sha256]));
  const actualByPath = new Map(actual.files.map((entry) => [entry.path, entry.sha256]));
  const unexpected = actual.files
    .map((entry) => entry.path)
    .filter((productPath) => !approvedByPath.has(productPath));
  const missing = inventory.files
    .map((entry) => entry.path)
    .filter((productPath) => !actualByPath.has(productPath));

  assert.deepEqual(
    unexpected,
    [],
    `product attestation failed: unexpected product file(s): ${unexpected.join(", ")}`
  );
  assert.deepEqual(
    missing,
    [],
    `product attestation failed: missing product file(s): ${missing.join(", ")}`
  );

  const changed = inventory.files
    .filter((entry) => actualByPath.get(entry.path) !== entry.sha256)
    .map((entry) => entry.path);
  assert.deepEqual(
    changed,
    [],
    `product attestation failed: SHA-256 hash mismatch for: ${changed.join(", ")}`
  );
}

export async function verifyProductAttestation(extensionRoot) {
  const inventory = await readApprovedProductHashInventory();
  await verifyProductAttestationAgainstInventory(extensionRoot, inventory);
}
