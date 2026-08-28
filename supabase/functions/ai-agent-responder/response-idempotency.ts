const RESPONSE_CLAIM_NAMESPACE = "vimob:ai-agent-responder:response:v1";

export type AIResponseIdentity = {
  organizationId: string;
  sessionId: string;
  conversationId: string;
  providerMessageId: string;
};

function canonicalIdentity(identity: AIResponseIdentity) {
  // An array avoids delimiter ambiguity while preserving an explicit field
  // order. Every tenant and transport boundary participates in the digest.
  return JSON.stringify([
    RESPONSE_CLAIM_NAMESPACE,
    identity.organizationId,
    identity.sessionId,
    identity.conversationId,
    identity.providerMessageId,
  ]);
}

function bytesToUuidV8(bytes: Uint8Array) {
  const uuidBytes = bytes.slice(0, 16);
  // RFC 9562 UUIDv8: application-defined digest bits with the canonical UUID
  // version and variant bits fixed. SHA-256 provides the collision resistance.
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x80;
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;
  const hex = Array.from(uuidBytes, (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export async function buildAIResponseClaimId(identity: AIResponseIdentity) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalIdentity(identity)),
  );
  return bytesToUuidV8(new Uint8Array(digest));
}

export function buildAIOutboxClientMessageId(
  claimId: string,
  chunkIndex: number,
) {
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) {
    throw new Error("Invalid AI response chunk index");
  }
  return `jhenny-${claimId}-${String(chunkIndex + 1).padStart(2, "0")}`;
}
