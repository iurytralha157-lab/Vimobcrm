export function getSafeAbsoluteHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const normalized = value.trim();
  if (!/^https?:\/\//i.test(normalized)) return null;

  try {
    const url = new URL(normalized);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function getSafeHttpUrl(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  if (candidate.startsWith('/') && !candidate.startsWith('//')) return candidate;

  return getSafeAbsoluteHttpUrl(candidate);
}
