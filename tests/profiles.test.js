import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ACTIVE_PROMPT_PROFILE_ID,
  DEFAULT_PROMPT_PROFILES,
  createPromptProfileId,
  normalizePromptProfiles,
  promptProfileSummaries,
  resolvePromptProfile,
  validatePromptProfiles
} from "../shared/profiles.js";

function profile(id, title, prompt = "Explain with a concrete example.") {
  return { id, title, prompt };
}

test("initial prompt profiles are ordered editable seed data", () => {
  assert.deepEqual(
    DEFAULT_PROMPT_PROFILES.map(({ id, title }) => ({ id, title })),
    [
      { id: "profile-child", title: "10-year-old" },
      { id: "profile-engineer", title: "Engineer" }
    ]
  );
  assert.equal(DEFAULT_ACTIVE_PROMPT_PROFILE_ID, "profile-child");
  assert.match(DEFAULT_PROMPT_PROFILES[0].prompt, /simple vocabulary|simple words/i);
  assert.match(DEFAULT_PROMPT_PROFILES[1].prompt, /tradeoffs/i);
});

test("profile normalization trims titles, preserves prompt text, removes unknown fields, and preserves order", () => {
  const normalized = normalizePromptProfiles([
    { id: "first", title: " First ", prompt: " First prompt. ", privateNote: "discard" },
    { id: "second", title: "Second", prompt: "Second prompt.", extra: true }
  ]);

  assert.deepEqual(normalized, [
    { id: "first", title: "First", prompt: " First prompt. " },
    { id: "second", title: "Second", prompt: "Second prompt." }
  ]);
});

test("invalid profile collections fall back to fresh initial profiles", () => {
  const first = normalizePromptProfiles([]);
  const second = normalizePromptProfiles(null);

  assert.deepEqual(first, DEFAULT_PROMPT_PROFILES);
  assert.deepEqual(second, DEFAULT_PROMPT_PROFILES);
  assert.notEqual(first, DEFAULT_PROMPT_PROFILES);
  assert.notEqual(first[0], DEFAULT_PROMPT_PROFILES[0]);
  first[0].title = "Changed";
  assert.equal(second[0].title, "10-year-old");
});

test("profile validation accepts one through twenty well-formed profiles", () => {
  const profiles = Array.from({ length: 20 }, (_, index) =>
    profile("profile-" + index, "Profile " + index)
  );
  const result = validatePromptProfiles(profiles, "profile-19");

  assert.deepEqual(result, { valid: true, errors: {} });
});

test("profile validation rejects invalid collection sizes", () => {
  const tooMany = Array.from({ length: 21 }, (_, index) =>
    profile("profile-" + index, "Profile " + index)
  );

  assert.equal(validatePromptProfiles([], "").valid, false);
  assert.equal(validatePromptProfiles(tooMany, "profile-0").valid, false);
  assert.equal(validatePromptProfiles("not-an-array", "profile-0").valid, false);
});

test("profile validation rejects duplicate and malformed IDs", () => {
  const duplicate = validatePromptProfiles([
    profile("same-id", "First"),
    profile("same-id", "Second")
  ], "same-id");
  const malformed = validatePromptProfiles([
    profile("bad id", "First")
  ], "bad id");

  assert.equal(duplicate.valid, false);
  assert.match(duplicate.errors["promptProfiles.1.id"], /unique/i);
  assert.equal(malformed.valid, false);
  assert.match(malformed.errors["promptProfiles.0.id"], /letters|numbers/i);
});

test("profile validation rejects empty, long, and case-insensitively duplicate titles", () => {
  const result = validatePromptProfiles([
    profile("first", "  "),
    profile("second", "A".repeat(61)),
    profile("third", "Engineer"),
    profile("fourth", " engineer ")
  ], "third");

  assert.equal(result.valid, false);
  assert.match(result.errors["promptProfiles.0.title"], /title/i);
  assert.match(result.errors["promptProfiles.1.title"], /60/);
  assert.match(result.errors["promptProfiles.3.title"], /unique/i);
});

test("profile validation rejects empty prompts", () => {
  const result = validatePromptProfiles([
    profile("empty", "Empty", "   ")
  ], "empty");

  assert.equal(result.valid, false);
  assert.match(result.errors["promptProfiles.0.prompt"], /prompt/i);
});

test("profile validation and normalization preserve very long prompts", () => {
  const longPrompt = "x".repeat(50_000);
  const profiles = [profile("long", "Long", longPrompt)];

  assert.deepEqual(validatePromptProfiles(profiles, "long"), {
    valid: true,
    errors: {}
  });
  assert.equal(normalizePromptProfiles(profiles)[0].prompt, longPrompt);
});

test("profile validation rejects a dangling active profile ID", () => {
  const result = validatePromptProfiles([
    profile("available", "Available")
  ], "missing");

  assert.equal(result.valid, false);
  assert.match(result.errors.activePromptProfileId, /existing/i);
});

test("public summaries contain only IDs and titles", () => {
  const summaries = promptProfileSummaries([
    profile("simple", "Simple", "Private instructions."),
    profile("deep", "Deep", "More private instructions.")
  ]);

  assert.deepEqual(summaries, [
    { id: "simple", title: "Simple" },
    { id: "deep", title: "Deep" }
  ]);
  assert.equal(JSON.stringify(summaries).includes("Private"), false);
});

test("profile resolution returns the selected profile and null for unknown IDs", () => {
  const profiles = [
    profile("simple", "Simple", "Simple prompt."),
    profile("deep", "Deep", "Deep prompt.")
  ];

  assert.equal(resolvePromptProfile(profiles, "deep"), profiles[1]);
  assert.equal(resolvePromptProfile(profiles, "missing"), null);
  assert.equal(resolvePromptProfile(null, "deep"), null);
});

test("profile ID generation stays valid and avoids collisions", () => {
  const existing = [
    profile("profile-fixed", "First"),
    profile("profile-fixed-2", "Second")
  ];
  const generated = createPromptProfileId(existing, () => "fixed");

  assert.equal(generated, "profile-fixed-3");
  assert.match(generated, /^[A-Za-z0-9_-]+$/);
});

test("title normalization applies NFKC, removes invisible controls, and collapses whitespace", () => {
  const normalized = normalizePromptProfiles([
    profile("normalized", "  \uFF26\uFF49\uFF52\uFF53\uFF54\u200B \t\n  Profile  ")
  ]);

  assert.deepEqual(normalized, [
    profile("normalized", "First Profile")
  ]);
});

test("profile validation rejects an invisible-only title", () => {
  const result = validatePromptProfiles([
    profile("invisible", "\u200B\u2060")
  ], "invisible");

  assert.equal(result.valid, false);
  assert.match(result.errors["promptProfiles.0.title"], /title/i);
});

test("profile validation counts emoji titles by Unicode code points", () => {
  const title = "\u{1F600}".repeat(31);
  const profiles = [profile("emoji", title)];

  assert.deepEqual(validatePromptProfiles(profiles, "emoji"), { valid: true, errors: {} });
  assert.equal(normalizePromptProfiles(profiles)[0].title, title);
});

test("profile title uniqueness treats composed and decomposed forms as duplicates", () => {
  const result = validatePromptProfiles([
    profile("composed", "Caf\u00E9"),
    profile("decomposed", "Cafe\u0301")
  ], "composed");

  assert.equal(result.valid, false);
  assert.match(result.errors["promptProfiles.1.title"], /unique/i);
});

test("profile title uniqueness applies practical full case folding", () => {
  const sharpS = validatePromptProfiles([
    profile("street-one", "Stra\u00DFe"),
    profile("street-two", "STRASSE")
  ], "street-one");
  const sigma = validatePromptProfiles([
    profile("sigma-one", "\u03BF\u03C3"),
    profile("sigma-two", "\u03BF\u03C2")
  ], "sigma-one");
  const cyrillicVe = validatePromptProfiles([
    profile("ve-one", "\u0432"),
    profile("ve-two", "\u1C80")
  ], "ve-one");

  assert.equal(sharpS.valid, false);
  assert.match(sharpS.errors["promptProfiles.1.title"], /unique/i);
  assert.equal(sigma.valid, false);
  assert.match(sigma.errors["promptProfiles.1.title"], /unique/i);
  assert.equal(cyrillicVe.valid, false);
  assert.match(cyrillicVe.errors["promptProfiles.1.title"], /unique/i);
});

test("title sanitation removes invisibles before collapsing whitespace", () => {
  const once = normalizePromptProfiles([
    profile("spaced", "A \u200B B")
  ]);

  assert.equal(once[0].title, "A B");
  assert.deepEqual(normalizePromptProfiles(once), once);
});

test("title sanitation treats format code points as separators", () => {
  const once = normalizePromptProfiles([
    profile("format", "A\u200BB")
  ]);

  assert.equal(once[0].title, "A B");
  assert.deepEqual(normalizePromptProfiles(once), once);
});

test("title sanitation treats control code points as separators", () => {
  const once = normalizePromptProfiles([
    profile("control", "A\tB")
  ]);

  assert.equal(once[0].title, "A B");
  assert.deepEqual(normalizePromptProfiles(once), once);
});

test("title duplicate keys use separator semantics", () => {
  const result = validatePromptProfiles([
    profile("space", "A B"),
    profile("control", "A\tB")
  ], "space");

  assert.equal(result.valid, false);
  assert.match(result.errors["promptProfiles.1.title"], /unique/i);
});
