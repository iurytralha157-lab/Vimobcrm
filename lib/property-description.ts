const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  bull: '\u2022',
  gt: '>',
  ldquo: '"',
  lsquo: "'",
  lt: '<',
  mdash: '\u2014',
  ndash: '\u2013',
  nbsp: ' ',
  quot: '"',
  rdquo: '"',
  rsquo: "'",
};

function decodeHtmlEntities(value: string) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const normalized = String(entity).toLowerCase();

    if (normalized.startsWith('#x')) {
      const code = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }

    if (normalized.startsWith('#')) {
      const code = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }

    return NAMED_ENTITIES[normalized] ?? match;
  });
}

export function cleanPropertyDescription(value?: string | null) {
  if (!value) return '';

  let text = value;

  for (let i = 0; i < 2; i += 1) {
    text = decodeHtmlEntities(text);
  }

  return text
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*li\s*>/gi, '\n\u2022 ')
    .replace(/<\/\s*(p|div|h[1-6]|li|ul|ol|section|article|blockquote|hr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
