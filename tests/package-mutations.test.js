import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  verifyPackageHygiene,
  verifyRequestArchitecture,
  verifyResourceGraph,
  verifyRuntimeSecurity
} from "./helpers/package-verifier.js";

const extensionRoot = fileURLToPath(new URL("../", import.meta.url));
const TOP_LEVEL_VERIFIERS = [
  verifyPackageHygiene,
  verifyResourceGraph,
  verifyRuntimeSecurity,
  verifyRequestArchitecture
];
const FORBIDDEN_RUNTIME_PATH = /forbidden runtime reference.*tests\//i;

async function withPackageCopy(run) {
  const tempRoot = await mkdtemp(join(tmpdir(), "selection-explainer-mutation-"));
  const packageRoot = join(tempRoot, "chrome-extension");
  try {
    await cp(extensionRoot, packageRoot, { recursive: true });
    await rm(join(packageRoot, "I'"), { force: true });
    await run(packageRoot, tempRoot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function mutateText(packageRoot, packagePath, addition) {
  await appendFile(join(packageRoot, ...packagePath.split("/")), addition, "utf8");
}

async function mutateManifest(packageRoot, mutate) {
  const manifestPath = join(packageRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  mutate(manifest);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

async function approveProductFiles(packageRoot, productPaths) {
  const inventoryPath = join(
    packageRoot,
    "tests",
    "helpers",
    "approved-product-hashes.json"
  );
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  for (const productPath of productPaths) {
    const sha256 = createHash("sha256")
      .update(await readFile(join(packageRoot, ...productPath.split("/"))))
      .digest("hex");
    const entry = inventory.files.find((candidate) => candidate.path === productPath);
    if (entry) entry.sha256 = sha256;
    else inventory.files.push({ path: productPath, sha256 });
  }
  inventory.files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  await writeFile(inventoryPath, JSON.stringify(inventory, null, 2) + "\n", "utf8");
  return inventory;
}

async function approveProductFileHash(packageRoot, productPath) {
  return approveProductFiles(packageRoot, [productPath]);
}

function runHashUpdater(packageRoot, mode) {
  return spawnSync(
    process.execPath,
    [join(packageRoot, "tests", "helpers", "update-product-hashes.js"), mode],
    { cwd: packageRoot, encoding: "utf8", windowsHide: true }
  );
}

function assertUpdaterRejectsForbiddenRuntimePath(result, mode) {
  const output = result.stderr + result.stdout;
  assert.notEqual(result.status, 0, mode + " must reject a forbidden runtime path");
  assert.match(output, FORBIDDEN_RUNTIME_PATH);
}

let copiedImportSequence = 0;

async function loadCopiedVerifierModule(packageRoot, phase) {
  copiedImportSequence += 1;
  const verifierUrl = pathToFileURL(
    join(packageRoot, "tests", "helpers", "package-verifier.js")
  );
  verifierUrl.searchParams.set("phase", phase + "-" + copiedImportSequence);
  return import(verifierUrl.href);
}

function assertUpdaterSucceeds(result, mode) {
  assert.equal(result.status, 0, result.stderr || result.stdout || mode + " failed");
}

async function assertEveryTopLevelVerifierRejects(packageRoot) {
  const copied = await loadCopiedVerifierModule(packageRoot, "forbidden-runtime");
  for (const verifier of TOP_LEVEL_VERIFIERS) {
    await assert.rejects(() => copied[verifier.name](packageRoot), FORBIDDEN_RUNTIME_PATH);
  }
}

const PRODUCT_ATTESTATION = /product attestation/i;

function rejectionMatches(error, semanticPattern) {
  const message = String(error?.message ?? error);
  assert.doesNotMatch(message, PRODUCT_ATTESTATION);
  assert.match(message, semanticPattern);
  return true;
}

async function expectRejected(verifier, mutate, semanticPattern) {
  await withPackageCopy(async (packageRoot, tempRoot) => {
    assertUpdaterSucceeds(runHashUpdater(packageRoot, "--write"), "clean --write");
    assertUpdaterSucceeds(runHashUpdater(packageRoot, "--check"), "clean --check");
    const cleanCopied = await loadCopiedVerifierModule(packageRoot, "clean-semantic");
    await assert.doesNotReject(
      () => cleanCopied[verifier.name](packageRoot),
      "clean copied package must pass before mutation"
    );

    await mutate(packageRoot, tempRoot);
    assertUpdaterSucceeds(runHashUpdater(packageRoot, "--write"), "mutated --write");
    assertUpdaterSucceeds(runHashUpdater(packageRoot, "--check"), "mutated --check");

    const mutatedCopied = await loadCopiedVerifierModule(packageRoot, "mutated-semantic");
    await assert.rejects(
      () => mutatedCopied[verifier.name](packageRoot),
      (error) => rejectionMatches(error, semanticPattern)
    );
  });
}

async function expectAttestationRejected(verifier, mutate, attestationPattern) {
  await withPackageCopy(async (packageRoot, tempRoot) => {
    assertUpdaterSucceeds(runHashUpdater(packageRoot, "--write"), "clean --write");
    assertUpdaterSucceeds(runHashUpdater(packageRoot, "--check"), "clean --check");
    const copied = await loadCopiedVerifierModule(packageRoot, "attestation");
    await assert.doesNotReject(
      () => copied[verifier.name](packageRoot),
      "clean copied package must pass before mutation"
    );
    await mutate(packageRoot, tempRoot);
    await assert.rejects(
      () => copied[verifier.name](packageRoot),
      attestationPattern
    );
  });
}

test("clean copied package passes its own attested top-level verifiers", async () => {
  await withPackageCopy(async (packageRoot) => {
    assertUpdaterSucceeds(runHashUpdater(packageRoot, "--write"), "clean --write");
    assertUpdaterSucceeds(runHashUpdater(packageRoot, "--check"), "clean --check");
    const copied = await loadCopiedVerifierModule(packageRoot, "clean-top-level");
    for (const verifier of TOP_LEVEL_VERIFIERS) {
      await assert.doesNotReject(() => copied[verifier.name](packageRoot));
    }
  });
});

for (const [name, verifier, mutate, diagnostic] of [
  [
    "package verifier rejects an unexpected product file",
    verifyPackageHygiene,
    (packageRoot) => writeFile(join(packageRoot, "shared", "unexpected.js"), "export {};\n", "utf8"),
    /product attestation.*unexpected product file/i
  ],
  [
    "resource graph rejects a missing product file",
    verifyResourceGraph,
    (packageRoot) => rm(join(packageRoot, "scripts", "generate_icons.py")),
    /product attestation.*missing product file/i
  ],
  [
    "runtime security rejects changed product bytes",
    verifyRuntimeSecurity,
    (packageRoot) => mutateText(packageRoot, "README.md", "\nAttestation mutation.\n"),
    /product attestation.*hash mismatch/i
  ],
  [
    "request architecture rejects semantically inert product changes",
    verifyRequestArchitecture,
    (packageRoot) => mutateText(packageRoot, "popup/popup.js", "\n// attestation-only mutation\n"),
    /product attestation.*hash mismatch/i
  ]
]) {
  test(name, async () => {
    await expectAttestationRejected(verifier, mutate, diagnostic);
  });
}

for (const [name, addition, pattern] of [
  ["apiKey identifier", "\nconst leaked = privateSettings.apiKey;\n", /apiKey|private setting/i],
  ["Authorization header", "\nconst headers = { Authorization: token };\n", /Authorization/i],
  ["direct storage.local access", "\nchrome.storage.local.get(\"selectionExplainerSettings\");\n", /storage\.local|private setting/i],
  ["content WebSocket", "\nconst socket = new WebSocket(\"wss://example.invalid\");\n", /WebSocket|network primitive/i]
]) {
  test(`content executable graph rejects ${name}`, async () => {
    await expectRejected(
      verifyRequestArchitecture,
      (packageRoot) => mutateText(packageRoot, "shared/selection.js", addition),
      pattern
    );
  });
}

test("manifest policy rejects an unhandled top-level field", async () => {
  await expectRejected(
    verifyResourceGraph,
    (packageRoot) => mutateManifest(packageRoot, (manifest) => {
      manifest.unhandled_package_file = "extra.js";
    }),
    /unhandled|top-level manifest/i
  );
});

test("manifest references cannot escape the package root even when the target exists", async () => {
  await expectRejected(
    verifyResourceGraph,
    async (packageRoot, tempRoot) => {
      await writeFile(join(tempRoot, "outside.js"), "export {};\n", "utf8");
      await mutateManifest(packageRoot, (manifest) => {
        manifest.background.service_worker = "../outside.js";
      });
    },
    /escapes the extension package/i
  );
});

test("supported declarativeNetRequest rule files are part of the manifest graph", async () => {
  await expectRejected(
    verifyResourceGraph,
    (packageRoot) => mutateManifest(packageRoot, (manifest) => {
      manifest.declarative_net_request = {
        rule_resources: [{ id: "rules", enabled: true, path: "rules/missing.json" }]
      };
    }),
    /missing referenced file.*rules[\\/]missing\.json/i
  );
});

test("application/ecmascript inline script bodies are rejected", async () => {
  await expectRejected(
    verifyRuntimeSecurity,
    (packageRoot) => mutateText(
      packageRoot,
      "options/options.html",
      "\n<script type=\"application/ecmascript\">globalThis.inlineMutation = true;</script>\n"
    ),
    /inline script/i
  );
});

for (const [name, packagePath, addition, pattern] of [
  [
    "requestExplanation.call bypass in popup",
    "popup/popup.js",
    "\nrequestExplanation.call(null, {}, \"text\", \"child\");\n",
    /requestExplanation/i
  ],
  [
    "aliased requestExplanation import in options",
    "options/options.js",
    "\nimport { requestExplanation as runRequest } from \"../shared/api.js\";\nrunRequest({}, \"text\", \"child\");\n",
    /requestExplanation/i
  ],
  ["fetch alias in popup", "popup/popup.js", "\nconst requestAlias = fetch;\n", /fetch|network primitive/i],
  ["XMLHttpRequest in options", "options/options.js", "\nconst xhr = new XMLHttpRequest();\n", /XMLHttpRequest|network primitive/i],
  ["WebSocket in shared code", "shared/controller.js", "\nconst socket = new WebSocket(\"wss://example.invalid\");\n", /WebSocket|network primitive/i],
  ["EventSource in popup", "popup/popup.js", "\nconst events = new EventSource(\"https://example.invalid/events\");\n", /EventSource|network primitive/i],
  ["sendBeacon in options", "options/options.js", "\nnavigator.sendBeacon(\"https://example.invalid/collect\", \"x\");\n", /sendBeacon|network primitive/i]
]) {
  test(`request architecture rejects ${name}`, async () => {
    await expectRejected(
      verifyRequestArchitecture,
      (packageRoot) => mutateText(packageRoot, packagePath, addition),
      pattern
    );
  });
}

test("package hygiene rejects an unexpected extensionless artifact and scans it for secrets", async () => {
  await expectRejected(
    verifyPackageHygiene,
    (packageRoot) => writeFile(
      join(packageRoot, "unexpected-artifact"),
      "sk-" + "0123456789abcdefghijklmnop" + "\n",
      "utf8"
    ),
    /hard-coded sk-like credential/i
  );
});

test("package hygiene rejects unsupported binary artifact types", async () => {
  await expectRejected(
    verifyPackageHygiene,
    async (packageRoot) => {
      await mkdir(join(packageRoot, "content"), { recursive: true });
      await writeFile(join(packageRoot, "content", "payload.bin"), Buffer.from([0, 1, 2, 3]));
    },
    /unsupported|unexpected artifact/i
  );
});

test("package hygiene rejects invalid UTF-8 in non-binary files", async () => {
  await expectRejected(
    verifyPackageHygiene,
    async (packageRoot) => {
      const readmePath = join(packageRoot, "README.md");
      const readme = await readFile(readmePath);
      await writeFile(readmePath, Buffer.concat([readme, Buffer.from([0xc3, 0x28])]));
    },
    /UTF-8/i
  );
});

test("content executable graph rejects imports of the private settings module", async () => {
  await expectRejected(
    verifyRequestArchitecture,
    (packageRoot) => mutateText(
      packageRoot,
      "content/app.js",
      "\nimport { loadSettings } from \"../shared/settings.js\";\nvoid loadSettings;\n"
    ),
    /private settings module/i
  );
});

test("requestExplanation cannot be redefined in another shared module", async () => {
  await expectRejected(
    verifyRequestArchitecture,
    (packageRoot) => mutateText(
      packageRoot,
      "shared/controller.js",
      "\nfunction requestExplanation() { return null; }\n"
    ),
    /requestExplanation/i
  );
});

for (const [name, packagePath, addition] of [
  [
    "remote HTML script",
    "popup/popup.html",
    "\n<script src=\"https://example.invalid/remote.js\"></script>\n"
  ],
  [
    "remote CSS import",
    "popup/popup.css",
    "\n@import url(\"https://example.invalid/remote.css\");\n"
  ],
  [
    "remote JavaScript import",
    "popup/popup.js",
    "\nimport \"https://example.invalid/remote.js\";\n"
  ]
]) {
  test(`resource graph rejects ${name}`, async () => {
    await expectRejected(
      verifyResourceGraph,
      (packageRoot) => mutateText(packageRoot, packagePath, addition),
      /external runtime resource|external module specifier/i
    );
  });
}

for (const [name, addition, pattern] of [
  [
    "concatenated apiKey property",
    "\nconst leaked = settings[\"api\" + \"Key\"];\n",
    /computed settings access/i
  ],
  [
    "concatenated endpoint property",
    "\nconst leaked = settings[\"end\" + \"point\"];\n",
    /computed settings access/i
  ],
  [
    "computed chrome storage.local access",
    "\nchrome[\"storage\"][\"local\"].get(\"selectionExplainerSettings\");\n",
    /computed chrome access/i
  ]
]) {
  test(`content executable graph rejects ${name}`, async () => {
    await expectRejected(
      verifyRequestArchitecture,
      (packageRoot) => mutateText(packageRoot, "shared/selection.js", addition),
      pattern
    );
  });
}

test("HTML graph rejects an unquoted missing local script source", async () => {
  await expectRejected(
    verifyResourceGraph,
    (packageRoot) => mutateText(
      packageRoot,
      "popup/popup.html",
      "\n<script src=missing-local.js></script>\n"
    ),
    /missing referenced file missing-local\.js/i
  );
});

test("HTML graph rejects an unquoted remote script source", async () => {
  await expectRejected(
    verifyResourceGraph,
    (packageRoot) => mutateText(
      packageRoot,
      "popup/popup.html",
      "\n<script src=https://example.invalid/unquoted.js></script>\n"
    ),
    /external runtime resource.*https:\/\/example\.invalid\/unquoted\.js/i
  );
});

test("inline script detection accepts closing-tag whitespace syntax and rejects its body", async () => {
  await expectRejected(
    verifyRuntimeSecurity,
    (packageRoot) => mutateText(
      packageRoot,
      "options/options.html",
      "\n<script type=\"application/ecmascript\">globalThis.closingVariant = true;</script >\n"
    ),
    /inline script body/i
  );
});

test("request architecture rejects namespace and computed requestExplanation access", async () => {
  await expectRejected(
    verifyRequestArchitecture,
    (packageRoot) => mutateText(
      packageRoot,
      "popup/popup.js",
      "\nimport * as requestApi from \"../shared/api.js\";\nrequestApi[\"request\" + \"Explanation\"]({}, \"text\", \"child\");\n"
    ),
    /shared\/api\.js namespace exposure.*namespace import/i
  );
});

test("request architecture rejects fetch inside an executable template expression", async () => {
  await expectRejected(
    verifyRequestArchitecture,
    (packageRoot) => mutateText(
      packageRoot,
      "popup/popup.js",
      "\nconst templateNetwork = `result: ${fetch(\"/private\")}`;\nvoid templateNetwork;\n"
    ),
    /network primitive.*fetch|fetch/i
  );
});

for (const [name, addition, pattern] of [
  [
    "remote script src assignment",
    "\nconst remoteScript = document.createElement(\"script\");\nremoteScript.src = \"https://example.invalid/runtime.js\";\ndocument.head.append(remoteScript);\n",
    /external runtime resource.*runtime\.js/i
  ],
  [
    "remote setAttribute src",
    "\nconst remoteFrame = document.createElement(\"iframe\");\nremoteFrame.setAttribute(\"src\", \"https://example.invalid/frame.html\");\ndocument.body.append(remoteFrame);\n",
    /external runtime resource.*frame\.html/i
  ],
  [
    "remote setAttribute href",
    "\nconst remoteStyle = document.createElement(\"link\");\nremoteStyle.setAttribute(\"href\", \"https://example.invalid/runtime.css\");\ndocument.head.append(remoteStyle);\n",
    /external runtime resource.*runtime\.css/i
  ],
  [
    "missing local script src assignment",
    "\nconst localScript = document.createElement(\"script\");\nlocalScript.src = \"missing-runtime.js\";\ndocument.head.append(localScript);\n",
    /external runtime resource|resource sink.*chrome\.runtime\.getURL|must use exact.*chrome\.runtime\.getURL/i
  ]
]) {
  test(`resource graph rejects ${name}`, async () => {
    await expectRejected(
      verifyResourceGraph,
      (packageRoot) => mutateText(packageRoot, "popup/popup.js", addition),
      pattern
    );
  });
}

for (const [name, addition, pattern] of [
  [
    "settings computed access through a neutral variable",
    "\nconst privateField = \"harmless\";\nconst leaked = settings[privateField];\n",
    /computed settings|settings\[/i
  ],
  [
    "chrome computed access through neutral variables",
    "\nconst chromeArea = \"anything\";\nconst leaked = chrome[chromeArea];\n",
    /computed chrome|chrome\[/i
  ]
]) {
  test(`content executable graph rejects ${name}`, async () => {
    await expectRejected(
      verifyRequestArchitecture,
      (packageRoot) => mutateText(packageRoot, "shared/selection.js", addition),
      pattern
    );
  });
}

test("request architecture rejects every namespace import from shared/api.js", async () => {
  await expectRejected(
    verifyRequestArchitecture,
    (packageRoot) => mutateText(
      packageRoot,
      "popup/popup.js",
      "\nimport * as requestApi from \"../shared/api.js\";\nconst safeKey = \"normalizeEndpoint\";\nvoid requestApi[safeKey];\n"
    ),
    /shared\/api\.js namespace exposure.*namespace import/i
  );
});

test("request architecture rejects named shared/api.js imports outside the safe allowlist", async () => {
  await expectRejected(
    verifyRequestArchitecture,
    (packageRoot) => mutateText(
      packageRoot,
      "popup/popup.js",
      "\nimport { createCompletionBody } from \"../shared/api.js\";\nvoid createCompletionBody;\n"
    ),
    /unsafe named import.*createCompletionBody|safe import/i
  );
});

for (const globalName of ["globalThis", "window", "self"]) {
  test(`request architecture rejects computed access rooted at ${globalName}`, async () => {
    await expectRejected(
      verifyRequestArchitecture,
      (packageRoot) => mutateText(
        packageRoot,
        "popup/popup.js",
        `\nconst globalKey = \"anything\";\nvoid ${globalName}[globalKey];\n`
      ),
      new RegExp(`computed global access.*${globalName}`, "i")
    );
  });
}

for (const [name, addition] of [
  [
    "backtick src assignment",
    "\nconst templateScript = document.createElement(\"script\");\ntemplateScript.src = `https://example.invalid/template.js`;\ndocument.head.append(templateScript);\n"
  ],
  [
    "variable src assignment",
    "\nconst variableScript = document.createElement(\"script\");\nconst resourceValue = \"https://example.invalid/variable.js\";\nvariableScript.src = resourceValue;\ndocument.head.append(variableScript);\n"
  ],
  [
    "variable setAttribute href",
    "\nconst variableLink = document.createElement(\"link\");\nconst hrefValue = \"https://example.invalid/variable.css\";\nvariableLink.setAttribute(\"href\", hrefValue);\ndocument.head.append(variableLink);\n"
  ]
]) {
  test(`resource graph rejects ${name} without exact chrome.runtime.getURL`, async () => {
    await expectRejected(
      verifyResourceGraph,
      (packageRoot) => mutateText(packageRoot, "popup/popup.js", addition),
      /external runtime resource|resource sink.*chrome\.runtime\.getURL|must use exact.*chrome\.runtime\.getURL/i
    );
  });
}


for (const [name, packagePath, addition, diagnostic] of [
  [
    "optional settings computed root",
    "shared/selection.js",
    "\nconst optionalKey = \"anything\";\nvoid settings?.[optionalKey];\n",
    /computed settings/i
  ],
  [
    "parenthesized chrome computed root",
    "shared/selection.js",
    "\nconst parenthesizedKey = \"anything\";\nvoid (chrome)[parenthesizedKey];\n",
    /computed chrome/i
  ],
  [
    "dynamic shared API namespace import",
    "popup/popup.js",
    "\nconst dynamicApi = await import(\"../shared/api.js\");\nvoid dynamicApi;\n",
    /dynamic import|shared\/api/i
  ],
  [
    "shared API namespace re-export",
    "shared/controller.js",
    "\nexport * as api from \"./api.js\";\n",
    /namespace re-export|shared\/api/i
  ],
  [
    "background shared API namespace import",
    "background.js",
    "\nimport * as backgroundApi from \"./shared/api.js\";\nvoid backgroundApi;\n",
    /namespace import|shared\/api/i
  ],
  [
    "regex literal inside executable template expression",
    "popup/popup.js",
    "\nconst regexTemplate = `${/}/.test(\"}\") ? fetch(\"/private\") : \"\"}`;\nvoid regexTemplate;\n",
    /network primitive.*fetch|fetch/i
  ],
  [
    "optional computed global root",
    "popup/popup.js",
    "\nconst optionalGlobalKey = \"anything\";\nvoid globalThis?.[optionalGlobalKey];\n",
    /computed global.*globalThis/i
  ],
  [
    "parenthesized computed global root",
    "popup/popup.js",
    "\nconst parenthesizedGlobalKey = \"anything\";\nvoid (globalThis)[parenthesizedGlobalKey];\n",
    /computed global.*globalThis/i
  ],
  [
    "logical src assignment",
    "popup/popup.js",
    "\nconst logicalScript = document.createElement(\"script\");\nlogicalScript.src ||= \"https://example.invalid/logical.js\";\n",
    /resource sink|external runtime resource/i
  ],
  [
    "computed template-key src assignment",
    "popup/popup.js",
    "\nconst computedScript = document.createElement(\"script\");\ncomputedScript[`src`] = \"https://example.invalid/computed.js\";\n",
    /resource sink|external runtime resource/i
  ]
]) {
  test(`semantic top-level verifier rejects ${name}`, async () => {
    const verifier = packagePath === "popup/popup.js" && /src assignment/.test(name)
      ? verifyResourceGraph
      : verifyRequestArchitecture;
    await expectRejected(
      verifier,
      (packageRoot) => mutateText(packageRoot, packagePath, addition),
      diagnostic
    );
  });
}


test("hash updater and every copied top-level verifier reject a service worker under tests after deliberate reapproval", async () => {
  await withPackageCopy(async (packageRoot) => {
    assertUpdaterSucceeds(runHashUpdater(packageRoot, "--write"), "clean --write");
    assertUpdaterSucceeds(runHashUpdater(packageRoot, "--check"), "clean --check");
    const cleanCopied = await loadCopiedVerifierModule(packageRoot, "clean-forbidden-worker");
    for (const verifier of TOP_LEVEL_VERIFIERS) {
      await assert.doesNotReject(() => cleanCopied[verifier.name](packageRoot));
    }
    const runtimePath = join(packageRoot, "tests", "runtime.test.js");
    await writeFile(runtimePath, "export {};\n", "utf8");
    await mutateManifest(packageRoot, (manifest) => {
      manifest.background.service_worker = "tests/runtime.test.js";
    });

    for (const mode of ["--check", "--write"]) {
      assertUpdaterRejectsForbiddenRuntimePath(runHashUpdater(packageRoot, mode), mode);
    }

    const inventory = await approveProductFileHash(packageRoot, "manifest.json");
    assert.equal(inventory.files.length, 28);
    assert.ok(!inventory.files.some((entry) => entry.path.startsWith("tests/")));
    await assertEveryTopLevelVerifierRejects(packageRoot);

    await appendFile(runtimePath, "void 1;\n", "utf8");
    await assertEveryTopLevelVerifierRejects(packageRoot);
  });
});

test("hash updater and every copied verifier reject a transitive nested product import into tests after deliberate reapproval", async () => {
  await withPackageCopy(async (packageRoot) => {
    assertUpdaterSucceeds(runHashUpdater(packageRoot, "--write"), "clean --write");
    assertUpdaterSucceeds(runHashUpdater(packageRoot, "--check"), "clean --check");
    const cleanCopied = await loadCopiedVerifierModule(packageRoot, "clean-forbidden-import");
    for (const verifier of TOP_LEVEL_VERIFIERS) {
      await assert.doesNotReject(() => cleanCopied[verifier.name](packageRoot));
    }

    await writeFile(
      join(packageRoot, "tests", "runtime.test.js"),
      "export const verifierOnly = true;\n",
      "utf8"
    );
    await writeFile(
      join(packageRoot, "shared", "runtime-nested-a.js"),
      "import \"./runtime-nested-b.js\";\nexport const nestedA = true;\n",
      "utf8"
    );
    await writeFile(
      join(packageRoot, "shared", "runtime-nested-b.js"),
      "import \"../tests/runtime.test.js\";\nexport const nestedB = true;\n",
      "utf8"
    );
    await mutateText(
      packageRoot,
      "background.js",
      "\nimport \"./shared/runtime-nested-a.js\";\n"
    );

    for (const mode of ["--check", "--write"]) {
      assertUpdaterRejectsForbiddenRuntimePath(runHashUpdater(packageRoot, mode), mode);
    }

    const inventory = await approveProductFiles(packageRoot, [
      "background.js",
      "shared/runtime-nested-a.js",
      "shared/runtime-nested-b.js"
    ]);
    assert.equal(inventory.files.length, 30);
    assert.ok(!inventory.files.some((entry) => entry.path.startsWith("tests/")));
    await assertEveryTopLevelVerifierRejects(packageRoot);

    await appendFile(
      join(packageRoot, "tests", "runtime.test.js"),
      "void 1;\n",
      "utf8"
    );
    await assertEveryTopLevelVerifierRejects(packageRoot);
  });
});
