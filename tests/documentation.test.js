import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readmeUrl = new URL("../README.md", import.meta.url);
const designUrl = new URL("../../docs/superpowers/specs/2026-10-16-selection-explainer-chrome-extension-design.md", import.meta.url);

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
