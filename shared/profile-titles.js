const TITLE_WHITESPACE_PATTERN = /\p{White_Space}+/gu;
const TITLE_INVISIBLE_PATTERN = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;
const TITLE_VISIBLE_CONTENT_PATTERN = /[\p{L}\p{N}\p{P}\p{S}]/u;
const TITLE_COLLATOR = new Intl.Collator("und", {
  usage: "search",
  sensitivity: "accent"
});

export function unicodeCodePointLength(value) {
  return Array.from(String(value)).length;
}

export function sanitizeProfileTitle(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(TITLE_INVISIBLE_PATTERN, " ")
    .replace(TITLE_WHITESPACE_PATTERN, " ")
    .trim();
}

export function hasVisibleProfileTitleContent(value) {
  return TITLE_VISIBLE_CONTENT_PATTERN.test(String(value));
}

function patchedCaseFold(value) {
  return sanitizeProfileTitle(value)
    .replace(/[\u00DF\u1E9E]/gu, "ss")
    .replace(/\u03C2/gu, "\u03C3");
}

export function profileTitlesEqual(left, right) {
  return TITLE_COLLATOR.compare(
    patchedCaseFold(left),
    patchedCaseFold(right)
  ) === 0;
}
