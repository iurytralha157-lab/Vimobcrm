export type WhatsAppSoundMessage = {
  id: string;
  organizationId: string;
  attendantUserId: string;
  createdAt: string;
};

// Invalidation hints also describe outbound/status/media updates. Audio needs
// an explicit, newly captured inbound addressed to the signed-in attendant.
export function parseWhatsAppSoundMessage(value: unknown): WhatsAppSoundMessage | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (data.operation !== "INSERT" || data.fromMe !== false || data.direction !== "inbound" || data.captureState !== "captured") return null;
  const id = typeof data.messageId === "string" ? data.messageId : "";
  const organizationId = typeof data.organizationId === "string" ? data.organizationId : "";
  const attendantUserId = typeof data.attendantUserId === "string" ? data.attendantUserId : "";
  const createdAt = typeof data.createdAt === "string" ? data.createdAt : "";
  if (!id || !organizationId || !attendantUserId || !createdAt || !Number.isFinite(Date.parse(createdAt))) return null;
  return { id, organizationId, attendantUserId, createdAt };
}

export function isFreshWhatsAppSoundMessage(message: WhatsAppSoundMessage, organizationId: string, userId: string, subscribedAt: number, now: number): boolean {
  const createdAt = Date.parse(message.createdAt);
  return message.organizationId === organizationId && message.attendantUserId === userId
    && createdAt >= subscribedAt - 5_000 && createdAt >= now - 30_000 && createdAt <= now + 5_000;
}

export function createWhatsAppSoundGate(organizationId: string, userId: string, subscribedAt: number) {
  const seen = new Set<string>();
  let lastPlayed = 0;
  return (value: unknown, now: number): boolean => {
    const message = parseWhatsAppSoundMessage(value);
    if (!message || !isFreshWhatsAppSoundMessage(message, organizationId, userId, subscribedAt, now)) return false;
    const key = `${message.organizationId}:${message.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > 500) seen.delete(seen.values().next().value!);
    if (now - lastPlayed < 1500) return false;
    lastPlayed = now;
    return true;
  };
}
