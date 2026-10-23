/** Compatibility normalization is presentation-only. Never use this to save a name. */
export function normalizeDisplayName(value?: string | null, fallback = '') {
  return (value || '').normalize('NFKC').trim() || fallback;
}

const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }) : null;

export function getDisplayGraphemes(value: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(value), part => part.segment);
  // Older engines still keep surrogate pairs, marks and joined emoji together.
  const points = Array.from(value), groups: string[] = [];
  let joinNext = false;
  for (const point of points) {
    const modifier = /[\p{Mark}\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}]/u.test(point);
    const previous = groups.at(-1);
    const regionalPair = previous && /^\p{Regional_Indicator}$/u.test(previous) && /^\p{Regional_Indicator}$/u.test(point);
    if (previous && (joinNext || modifier || point === '\u200D' || regionalPair)) groups[groups.length - 1] += point;
    else groups.push(point);
    joinNext = point === '\u200D';
  }
  return groups;
}

export function getDisplayInitial(value?: string | null) {
  return getDisplayGraphemes(normalizeDisplayName(value))[0]?.toLocaleUpperCase('pt-BR') || '';
}
