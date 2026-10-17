import test from "node:test";
import assert from "node:assert/strict";
import { createProfileEditorState } from "../options/profile-editor.js";

function profile(id, title, prompt = title + " prompt.") {
  return { id, title, prompt };
}

function settings(overrides = {}) {
  return {
    promptProfiles: [
      profile("profile-one", "Simple"),
      profile("profile-two", "Engineer"),
      profile("profile-three", "Concise")
    ],
    activePromptProfileId: "profile-two",
    ...overrides
  };
}

function sequenceFactory(...ids) {
  let index = 0;
  return () => ids[index++];
}

test("snapshots clone the ordered editor state without sharing mutable objects", () => {
  const source = settings();
  const editor = createProfileEditorState(source, sequenceFactory("profile-new"));
  const first = editor.snapshot();

  assert.deepEqual(first, {
    promptProfiles: source.promptProfiles,
    activePromptProfileId: "profile-two"
  });
  assert.notEqual(first.promptProfiles, source.promptProfiles);
  assert.notEqual(first.promptProfiles[0], source.promptProfiles[0]);

  source.promptProfiles[0].title = "Changed outside";
  first.promptProfiles[1].prompt = "Changed snapshot";
  first.promptProfiles.reverse();

  assert.deepEqual(editor.snapshot(), {
    promptProfiles: [
      profile("profile-one", "Simple"),
      profile("profile-two", "Engineer"),
      profile("profile-three", "Concise")
    ],
    activePromptProfileId: "profile-two"
  });
  assert.notEqual(editor.snapshot().promptProfiles, editor.snapshot().promptProfiles);
});

test("addProfile appends useful profiles and de-collides factory IDs", () => {
  const editor = createProfileEditorState(
    settings({
      promptProfiles: [
        profile("profile-one", "Simple"),
        profile("profile-two", "New profile")
      ],
      activePromptProfileId: "profile-one"
    }),
    sequenceFactory("profile-one", "profile-one")
  );

  editor.addProfile();
  editor.addProfile();
  const snapshot = editor.snapshot();

  assert.deepEqual(snapshot.promptProfiles.map(({ id, title }) => ({ id, title })), [
    { id: "profile-one", title: "Simple" },
    { id: "profile-two", title: "New profile" },
    { id: "profile-one-2", title: "New profile 2" },
    { id: "profile-one-3", title: "New profile 3" }
  ]);
  assert.match(snapshot.promptProfiles[2].prompt, /explain|material|example/i);
  assert.equal(snapshot.promptProfiles[2].prompt, snapshot.promptProfiles[3].prompt);
  assert.equal(snapshot.activePromptProfileId, "profile-one");
});

test("updateProfile changes only title and prompt while preserving order and IDs", () => {
  const editor = createProfileEditorState(settings(), sequenceFactory("unused"));

  editor.updateProfile("profile-two", {
    id: "replacement-id",
    title: "Deep technical",
    prompt: "Explain mechanisms and tradeoffs.",
    extra: "discard"
  });
  editor.updateProfile("missing", { title: "Ignored" });

  assert.deepEqual(editor.snapshot(), {
    promptProfiles: [
      profile("profile-one", "Simple"),
      profile("profile-two", "Deep technical", "Explain mechanisms and tradeoffs."),
      profile("profile-three", "Concise")
    ],
    activePromptProfileId: "profile-two"
  });
});

test("duplicateProfile inserts a prompt copy after its source with a unique title and ID", () => {
  const editor = createProfileEditorState(
    settings({
      promptProfiles: [
        profile("profile-one", "Simple"),
        profile("profile-two", "Engineer", "Technical details."),
        profile("profile-copy", "engineer copy"),
        profile("profile-three", "Concise")
      ]
    }),
    sequenceFactory("profile-copy")
  );

  editor.duplicateProfile("profile-two");
  editor.duplicateProfile("missing");
  const snapshot = editor.snapshot();

  assert.deepEqual(snapshot.promptProfiles, [
    profile("profile-one", "Simple"),
    profile("profile-two", "Engineer", "Technical details."),
    profile("profile-copy-2", "Engineer Copy 2", "Technical details."),
    profile("profile-copy", "engineer copy"),
    profile("profile-three", "Concise")
  ]);
  assert.equal(snapshot.activePromptProfileId, "profile-two");
});

test("duplicate titles stay within 60 Unicode code points for Copy suffixes", () => {
  const longTitle = "??".repeat(60);
  const editor = createProfileEditorState({
    promptProfiles: [profile("long", longTitle, "Long prompt.")],
    activePromptProfileId: "long"
  }, sequenceFactory("copy-one", "copy-two"));

  editor.duplicateProfile("long");
  editor.duplicateProfile("long");
  const titles = editor.snapshot().promptProfiles.map((item) => item.title);

  assert.equal(titles[1].endsWith(" Copy 2"), true);
  assert.equal(titles[2].endsWith(" Copy"), true);
  assert.equal(Array.from(titles[1]).length, 60);
  assert.equal(Array.from(titles[2]).length, 60);
});

test("setActiveProfile selects only an existing profile", () => {
  const editor = createProfileEditorState(settings(), sequenceFactory("unused"));

  editor.setActiveProfile("profile-three");
  assert.equal(editor.snapshot().activePromptProfileId, "profile-three");

  editor.setActiveProfile("missing");
  assert.equal(editor.snapshot().activePromptProfileId, "profile-three");
});

test("deleting the active profile chooses the next ordered profile", () => {
  const editor = createProfileEditorState(settings(), sequenceFactory("unused"));

  editor.deleteProfile("profile-two");

  assert.deepEqual(editor.snapshot(), {
    promptProfiles: [
      profile("profile-one", "Simple"),
      profile("profile-three", "Concise")
    ],
    activePromptProfileId: "profile-three"
  });
});

test("deleting the final active profile chooses the previous profile", () => {
  const editor = createProfileEditorState(
    settings({ activePromptProfileId: "profile-three" }),
    sequenceFactory("unused")
  );

  editor.deleteProfile("profile-three");

  assert.deepEqual(editor.snapshot(), {
    promptProfiles: [
      profile("profile-one", "Simple"),
      profile("profile-two", "Engineer")
    ],
    activePromptProfileId: "profile-two"
  });
});

test("deleting a non-active profile keeps the active profile and remaining order", () => {
  const editor = createProfileEditorState(settings(), sequenceFactory("unused"));

  editor.deleteProfile("profile-one");
  editor.deleteProfile("missing");

  assert.deepEqual(editor.snapshot(), {
    promptProfiles: [
      profile("profile-two", "Engineer"),
      profile("profile-three", "Concise")
    ],
    activePromptProfileId: "profile-two"
  });
});

test("the last remaining profile cannot be deleted", () => {
  const editor = createProfileEditorState({
    promptProfiles: [profile("only", "Only")],
    activePromptProfileId: "only"
  }, sequenceFactory("unused"));
  const before = editor.snapshot();

  editor.deleteProfile("only");

  assert.deepEqual(editor.snapshot(), before);
});

test("the twenty-profile cap blocks add and duplicate without calling the ID factory", () => {
  const profiles = Array.from({ length: 20 }, (_, index) =>
    profile("profile-" + index, "Profile " + index)
  );
  let factoryCalls = 0;
  const editor = createProfileEditorState({
    promptProfiles: profiles,
    activePromptProfileId: "profile-0"
  }, () => {
    factoryCalls += 1;
    return "profile-new";
  });
  const before = editor.snapshot();

  editor.addProfile();
  editor.duplicateProfile("profile-0");

  assert.deepEqual(editor.snapshot(), before);
  assert.equal(factoryCalls, 0);
});

test("duplicate title collisions follow profile-title validation semantics", () => {
  const editor = createProfileEditorState({
    promptProfiles: [
      profile("profile-engineer", "Engineer"),
      profile("profile-copy", "Engineer\u200bCopy")
    ],
    activePromptProfileId: "profile-engineer"
  }, sequenceFactory("new-copy"));

  editor.duplicateProfile("profile-engineer");

  assert.equal(editor.snapshot().promptProfiles[1].title, "Engineer Copy 2");
});

test("duplicate title collisions use Unicode caseless comparison", () => {
  const editor = createProfileEditorState({
    promptProfiles: [
      profile("profile-ve", "\u0432"),
      profile("profile-copy", "\u1C80 Copy")
    ],
    activePromptProfileId: "profile-ve"
  }, sequenceFactory("new-copy"));

  editor.duplicateProfile("profile-ve");

  assert.equal(editor.snapshot().promptProfiles[1].title, "\u0432 Copy 2");
});
