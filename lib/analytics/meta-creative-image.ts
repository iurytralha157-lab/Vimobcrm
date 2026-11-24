export function getSafeMetaCreativeUrl(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  // Reject fragments as a whole; do not rewrite a signed provider URL or expose
  // hash-carried credentials in JSON, href or src attributes.
  if (!candidate || candidate.length > 4096 || candidate.includes("#") || !/^https:\/\//i.test(candidate)) return null;

  try {
    const url = new URL(candidate);
    const authority = candidate.slice(candidate.indexOf("://") + 3).split(/[/?#]/, 1)[0];
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || /:\d+$/.test(authority)) return null;
    if (/%(?![0-9a-f]{2})/i.test(url.search) || url.search.includes(";")) return null;
    for (const key of url.searchParams.keys()) {
      if (/token|secret|proof/i.test(key)) return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

// Keep the hostname and path restrictions aligned with next.config.ts.
export function canOptimizeMetaCreativeImage(value: string | null | undefined) {
  const safe = getSafeMetaCreativeUrl(value);
  if (!safe) return false;
  const url = new URL(safe);
  return url.port === "" &&
    ["fbcdn.net", "cdninstagram.com"].some((domain) => url.hostname.endsWith(`.${domain}`)) &&
    !/\.(?:svg|gif)$/i.test(url.pathname);
}
