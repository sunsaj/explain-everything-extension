import {
  profileTitlesEqual,
  sanitizeProfileTitle
} from "../shared/profile-titles.js";

const MAX_PROFILE_COUNT = 20;
const MAX_PROFILE_TITLE_LENGTH = 60;
const NEW_PROFILE_TITLE = "New profile";
const NEW_PROFILE_PROMPT =
  "Explain the selected material clearly, define necessary terms, and include a concrete example when helpful.";

function cloneProfile({ id, title, prompt }) {
  return { id, title, prompt };
}

function cloneProfiles(profiles) {
  return profiles.map(cloneProfile);
}

function codePointSlice(value, maximum) {
  return Array.from(String(value)).slice(0, Math.max(0, maximum)).join("");
}

function titleWithSuffix(title, suffix) {
  const suffixLength = Array.from(suffix).length;
  const base = sanitizeProfileTitle(String(title)) || "Profile";
  const fittedBase = codePointSlice(
    base,
    MAX_PROFILE_TITLE_LENGTH - suffixLength
  ).trimEnd();
  return fittedBase + suffix;
}

function hasTitle(profiles, title) {
  return profiles.some((profile) => profileTitlesEqual(profile.title, title));
}

function uniqueNumberedTitle(title, profiles) {
  if (!hasTitle(profiles, title)) return title;

  let suffixNumber = 2;
  while (true) {
    const candidate = titleWithSuffix(title, " " + suffixNumber);
    if (!hasTitle(profiles, candidate)) return candidate;
    suffixNumber += 1;
  }
}

function duplicateTitle(title, profiles) {
  let copyNumber = 1;

  while (true) {
    const suffix = copyNumber === 1 ? " Copy" : " Copy " + copyNumber;
    const candidate = titleWithSuffix(title, suffix);
    if (!hasTitle(profiles, candidate)) return candidate;
    copyNumber += 1;
  }
}


export function createProfileEditorState(settings, idFactory) {
  if (!settings || !Array.isArray(settings.promptProfiles) || !settings.promptProfiles.length) {
    throw new TypeError("Profile editor state requires at least one profile.");
  }
  if (typeof idFactory !== "function") {
    throw new TypeError("Profile editor state requires an ID factory.");
  }

  let profiles = cloneProfiles(settings.promptProfiles);
  let activePromptProfileId = settings.activePromptProfileId;
  if (!profiles.some((profile) => profile.id === activePromptProfileId)) {
    throw new TypeError("The active profile must exist in the editor state.");
  }

  function snapshot() {
    return {
      promptProfiles: cloneProfiles(profiles),
      activePromptProfileId
    };
  }

  function createUniqueId() {
    const existingIds = new Set(profiles.map((profile) => profile.id));
    const base = String(idFactory(cloneProfiles(profiles))).trim();
    if (!base) throw new TypeError("The ID factory must return a non-empty ID.");

    let candidate = base;
    let suffix = 2;
    while (existingIds.has(candidate)) {
      candidate = base + "-" + suffix;
      suffix += 1;
    }
    return candidate;
  }

  function addProfile() {
    if (profiles.length >= MAX_PROFILE_COUNT) return snapshot();

    profiles = [
      ...profiles,
      {
        id: createUniqueId(),
        title: uniqueNumberedTitle(NEW_PROFILE_TITLE, profiles),
        prompt: NEW_PROFILE_PROMPT
      }
    ];
    return snapshot();
  }

  function duplicateProfile(id) {
    if (profiles.length >= MAX_PROFILE_COUNT) return snapshot();
    const index = profiles.findIndex((profile) => profile.id === id);
    if (index < 0) return snapshot();

    const source = profiles[index];
    const duplicate = {
      id: createUniqueId(),
      title: duplicateTitle(source.title, profiles),
      prompt: source.prompt
    };
    profiles = [
      ...profiles.slice(0, index + 1),
      duplicate,
      ...profiles.slice(index + 1)
    ];
    return snapshot();
  }

  function updateProfile(id, changes) {
    const index = profiles.findIndex((profile) => profile.id === id);
    if (index < 0 || !changes || typeof changes !== "object") return snapshot();

    const current = profiles[index];
    const updated = {
      ...current,
      title: typeof changes.title === "string" ? changes.title : current.title,
      prompt: typeof changes.prompt === "string" ? changes.prompt : current.prompt
    };
    profiles = profiles.map((profile, profileIndex) =>
      profileIndex === index ? updated : profile
    );
    return snapshot();
  }

  function deleteProfile(id) {
    if (profiles.length <= 1) return snapshot();
    const index = profiles.findIndex((profile) => profile.id === id);
    if (index < 0) return snapshot();

    if (id === activePromptProfileId) {
      activePromptProfileId = index < profiles.length - 1
        ? profiles[index + 1].id
        : profiles[index - 1].id;
    }
    profiles = profiles.filter((profile) => profile.id !== id);
    return snapshot();
  }

  function setActiveProfile(id) {
    if (profiles.some((profile) => profile.id === id)) {
      activePromptProfileId = id;
    }
    return snapshot();
  }

  return {
    addProfile,
    duplicateProfile,
    updateProfile,
    deleteProfile,
    setActiveProfile,
    snapshot
  };
}
