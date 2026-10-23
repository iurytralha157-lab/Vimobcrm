/** Avatar candidates are URLs from authorized DTOs, never a phone/name lookup. */
export function getWhatsAppAvatarCandidates(...values: Array<string | null | undefined>): string[] {
  const candidates = new Set<string>();
  for (const value of values) {
    const candidate = value?.trim();
    if (!candidate || candidate.length > 8192 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(candidate)) continue;
    try {
      const url = new URL(candidate);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) continue;
      candidates.add(candidate);
    } catch { /* Missing/invalid images keep the existing initials. */ }
  }
  return [...candidates];
}

export type WhatsAppSenderAvatar = { userId: string; url: string };

export function buildWhatsAppSenderAvatars(
  requestedIds: readonly string[], users: readonly { id: string; avatar_url: string | null }[],
): Map<string, WhatsAppSenderAvatar> {
  const ids = new Set(requestedIds.map(id => id.trim().toLowerCase()));
  const avatars = new Map<string, WhatsAppSenderAvatar>();
  for (const user of users) {
    const id = user.id.trim().toLowerCase();
    const url = getWhatsAppAvatarCandidates(user.avatar_url)[0];
    if (ids.has(id) && url) avatars.set(id, { userId: user.id, url });
  }
  return avatars;
}
