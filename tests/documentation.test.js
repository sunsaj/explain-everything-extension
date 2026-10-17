import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readmeUrl = new URL("../README.md", import.meta.url);
const designUrl = new URL("../../docs/superpowers/specs/2026-10-16-selection-explainer-chrome-extension-design.md", import.meta.url);
const promptProfilesDesignUrl = new URL("../../docs/superpowers/specs/2026-10-17-prompt-profiles-design.md", import.meta.url);
const manifestUrl = new URL("../manifest.json", import.meta.url);

test("README records the dated automated and live verification status", async () => {
  const readme = await readFile(readmeUrl, "utf8");
  assert.match(readme, /25[- ]second/i);
  assert.match(readme, /Chrome 102/i);
  assert.match(readme, /2026-10-17/);
  assert.match(readme, /Automated pass/i);
  assert.match(readme, /Not executed/i);
  assert.match(readme, /no unpacked Chrome smoke test/i);
  assert.match(readme, /no live LiteLLM success/i);
});

test("design spec documents the 25-second timeout below Chrome's 30-second limit", async () => {
  const design = await readFile(designUrl, "utf8");
  assert.match(design, /25[- ]second/i);
  assert.match(design, /30[- ]second/i);
  assert.match(design, /Chrome 102/i);
  assert.doesNotMatch(design, /60[- ]second request timeout/i);
});

test("README documents optional native internet search and its cost", async () => {
  const readme = await readFile(readmeUrl, "utf8");
  assert.match(readme, /Internet search/i);
  assert.match(readme, /off by default/i);
  assert.match(readme, /Responses API/i);
  assert.match(readme, /more time, tokens, and cost/i);
  assert.match(readme, /source citations/i);
});

test("README documents profile management and migration without stale single-prompt instructions", async () => {
  const readme = await readFile(readmeUrl, "utf8");
  assert.match(readme, /Prompt profiles/i);
  assert.match(readme, /Add prompt profile/i);
  assert.match(readme, /rename/i);
  assert.match(readme, /Duplicate/i);
  assert.match(readme, /Delete/i);
  assert.match(readme, /Set as default/i);
  assert.match(readme, /at least one profile/i);
  assert.match(readme, /automatically migrat/i);
  assert.match(readme, /10-year-old/i);
  assert.match(readme, /Engineer/i);
  assert.doesNotMatch(readme, /default explanation level/i);
  assert.doesNotMatch(readme, /Review or edit the system prompt/i);
  assert.doesNotMatch(readme, /switch between [*][*]10-year-old[*][*] and [*][*]Engineer[*][*]/i);
});

test("README documents the profile privacy boundary and selector behavior", async () => {
  const readme = await readFile(readmeUrl, "utf8");
  assert.match(readme, /full profile prompts[^.]*background service worker/is);
  assert.match(readme, /only[^.]*profile ID[^.]*title/is);
  assert.match(readme, /settings order/i);
  assert.match(readme, /retain[^.]*current selection/is);
  assert.match(readme, /fall[^.]*default profile/is);
  assert.match(readme, /captured[^.]*Explain[^.]*Retry/is);
  assert.match(readme, /next request/i);
});

test("README records the corrected local Inter weight scale and fallback behavior", async () => {
  const readme = await readFile(readmeUrl, "utf8");
  assert.match(readme, /Inter variable font/i);
  assert.match(readme, /primary font/i);
  assert.match(readme, /local system fallbacks/i);
  assert.match(readme, /font loading fails/i);
  assert.doesNotMatch(readme, /without[^.]*system-font substitution/i);
  assert.match(readme, /body and explanations[^.]*400/is);
  assert.match(readme, /secondary labels[^.]*500/is);
  assert.match(readme, /controls[^.]*550[^.]*600/is);
  assert.match(readme, /strong text[^.]*600/is);
  assert.match(readme, /headings[^.]*650[^.]*700/is);
});

test("README and prompt-profile design document lossless uncapped prompts", async () => {
  const readme = await readFile(readmeUrl, "utf8");
  const promptProfilesDesign = await readFile(promptProfilesDesignUrl, "utf8");

  for (const document of [readme, promptProfilesDesign]) {
    assert.match(document, /no extension prompt-length cap/i);
    assert.match(document, /not silently lost/i);
    assert.match(document, /provider context/i);
    assert.match(document, /cost/i);
    assert.doesNotMatch(document, /1[–-]6,000 characters/i);
  }
});

test("baseline extension design uses the current prompt-profile contracts", async () => {
  const design = await readFile(designUrl, "utf8");
  const staleContracts = [
    /default explanation level/i,
    /10-year-old[^.\n]*Engineer[^.\n]*explanation levels/i,
    /[']level[']:\s*[']child[']/i,
    /[']systemPrompt[']:\s*editable/i,
    /enabled, configured, and level status fields/i,
    /requested level/i,
    /accepts selection, level/i,
    /containing only enabled, configured, and level/i,
    /default level, and multiline prompt fields/i,
    /restore default prompt/i,
    /both level prompts/i,
    /Both requested audience levels/i,
    /system prompt is editable and restorable/i,
    /saved prompt profiles[^.\n]*not part/i
  ];

  for (const staleContract of staleContracts) {
    assert.doesNotMatch(design, staleContract);
  }
  assert.match(design, /promptProfiles/i);
  assert.match(design, /activePromptProfileId/i);
  assert.match(design, /promptProfileId/i);
  assert.match(design, /summaries containing only[^.]*id[^.]*title/is);
  assert.match(design, /Add prompt profile/i);
  assert.match(design, /Set as default/i);
});

test("both design specs keep legacy fields inside migration history and expose only active profile contracts", async () => {
  const originalDesign = await readFile(designUrl, "utf8");
  const promptProfilesDesign = await readFile(promptProfilesDesignUrl, "utf8");
  const migrationMatch = promptProfilesDesign.match(
    /^## Migration\s*$([\s\S]*?)(?=^##\s)/m
  );
  assert.ok(migrationMatch, "prompt-profile design must contain a Migration section");
  assert.match(migrationMatch[1], /Legacy migration inputs[^.]*schema versions 1 and 2 only/i);
  assert.match(migrationMatch[1], /[']level[']/);
  assert.match(migrationMatch[1], /[']systemPrompt[']/);

  const activePromptProfilesDesign = promptProfilesDesign.replace(migrationMatch[0], "");
  assert.doesNotMatch(activePromptProfilesDesign, /\blevel\b/i);
  assert.doesNotMatch(activePromptProfilesDesign, /systemPrompt/i);

  const staleActiveContracts = [
    /default explanation level/i,
    /explanation levels/i,
    /editable system prompt/i,
    /single system[- ]prompt/i,
    /level selector/i,
    /accepts selection, level/i,
    /default level/i,
    /restore default prompt/i,
    /both level prompts/i,
    /audience levels/i,
    /system prompt is editable/i,
    /saved prompt profiles[^.\n]*not part/i
  ];
  for (const design of [originalDesign, activePromptProfilesDesign]) {
    for (const staleContract of staleActiveContracts) {
      assert.doesNotMatch(design, staleContract);
    }
    assert.match(design, /promptProfiles/i);
    assert.match(design, /activePromptProfileId/i);
    assert.match(design, /promptProfileId/i);
  }
});

test("release metadata and design documents identify the implemented prompt-profile release", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const promptProfilesDesign = await readFile(promptProfilesDesignUrl, "utf8");
  const originalDesign = await readFile(designUrl, "utf8");

  assert.equal(manifest.version, "1.3.0");
  assert.match(promptProfilesDesign, /[*][*]Status:[*][*] Implemented/i);
  assert.match(originalDesign, /prompt profiles/i);
});


test("manifest and migration docs justify unlimitedStorage without widening prompt access", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const readme = await readFile(readmeUrl, "utf8");
  const promptProfilesDesign = await readFile(promptProfilesDesignUrl, "utf8");

  assert.deepEqual(manifest.permissions, ["storage", "unlimitedStorage"]);
  for (const document of [readme, promptProfilesDesign]) {
    assert.match(document, /unlimitedStorage/);
    assert.match(document, /(?:schema versions 1 and 2|v1\/v2)[^.]*migration/is);
    assert.match(document, /legacy prompt[^.]*two[^.]*profiles/is);
    assert.match(document, /lossless/i);
  }
  assert.match(readme, /trusted extension contexts/i);
  assert.match(readme, /serialized/i);
});
