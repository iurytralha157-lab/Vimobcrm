/**
 * Count the text validated by Go after the existing JavaScript trim.
 * Unicode White_Space includes NEL and excludes FEFF, unlike JavaScript trim.
 * Keep this validation-only: fields, drafts and payloads retain their text.
 */
export function countDistributionQueueInputCharacters(value: string): number {
  return Array.from(value.trim().replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')).length;
}
