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
