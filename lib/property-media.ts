export function getSafePropertyImageSource(
  ...candidates: Array<string | null | undefined>
) {
  for (const candidate of candidates) {
    const value = normalizePropertyImageCandidate(candidate);
    if (!value) continue;
    return value;
  }

  return null;
}

function normalizePropertyImageCandidate(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized || normalized.startsWith("//")) return null;

  if (normalized.startsWith("/") && !normalized.startsWith("//")) return normalized;

  const storagePath = normalizeStorageImagePath(normalized);
  if (storagePath) return storagePath;

  try {
    const url = new URL(normalized);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {
    // Ignore malformed legacy values and try the next candidate.
  }

  return null;
}

function normalizeStorageImagePath(value: string) {
  const storageObjectMatch = /^\/?(storage\/v1\/object\/public\/.+)$/i.exec(value);
  if (storageObjectMatch?.[1]) return `/${storageObjectMatch[1]}`;

  const publicObjectMatch = /^\/?(object\/public\/.+)$/i.exec(value);
  if (publicObjectMatch?.[1]) return `/storage/v1/${publicObjectMatch[1]}`;

  return null;
}
