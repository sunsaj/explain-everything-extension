import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SELECTION_CHARACTERS,
  normalizeSelectedText,
  validateSelectedText
} from "../shared/selection.js";

test("normalizes spaces while preserving paragraph boundaries", () => {
  assert.equal(normalizeSelectedText("  alpha   beta\n\n gamma  "), "alpha beta\n\ngamma");
});

test("normalizes Windows line endings before preserving paragraphs", () => {
  assert.equal(normalizeSelectedText("alpha\r\n\r\n beta"), "alpha\n\nbeta");
});

test("rejects empty and oversized text", () => {
  assert.equal(validateSelectedText("   ").code, "NO_SELECTION");
  assert.equal(validateSelectedText("x".repeat(MAX_SELECTION_CHARACTERS + 1)).code, "SELECTION_TOO_LONG");
  assert.deepEqual(validateSelectedText("useful   text"), {
    valid: true,
    text: "useful text"
  });
});
