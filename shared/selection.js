export const MAX_SELECTION_CHARACTERS = 20_000;

export function normalizeSelectedText(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((part) => part.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

export function validateSelectedText(text) {
  const normalized = normalizeSelectedText(text);
  if (!normalized) {
    return {
      valid: false,
      text: "",
      code: "NO_SELECTION",
      error: "Highlight some text first."
    };
  }
  if (normalized.length > MAX_SELECTION_CHARACTERS) {
    return {
      valid: false,
      text: normalized,
      code: "SELECTION_TOO_LONG",
      error: "Select no more than 20,000 characters."
    };
  }
  return { valid: true, text: normalized };
}
