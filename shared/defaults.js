import {
  DEFAULT_ACTIVE_PROMPT_PROFILE_ID,
  DEFAULT_PROMPT_PROFILES
} from "./profiles.js";

export {
  DEFAULT_ACTIVE_PROMPT_PROFILE_ID,
  DEFAULT_PROMPT_PROFILES,
  DEFAULT_SYSTEM_PROMPT
} from "./profiles.js";

export const SETTINGS_STORAGE_KEY = "selectionExplainerSettings";
export const SETTINGS_VERSION = 3;

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  endpoint: "",
  apiKey: "",
  model: "gpt-4o-mini",
  webSearchEnabled: false,
  promptProfiles: DEFAULT_PROMPT_PROFILES,
  activePromptProfileId: DEFAULT_ACTIVE_PROMPT_PROFILE_ID,
  settingsVersion: SETTINGS_VERSION
});

export function getDefaultSettings() {
  return {
    ...DEFAULT_SETTINGS,
    promptProfiles: DEFAULT_PROMPT_PROFILES.map(({ id, title, prompt }) => ({
      id,
      title,
      prompt
    }))
  };
}
