export const FIRST_RESPONSE_CHANNELS = [
  "whatsapp",
  "phone",
  "email",
  "manual",
  "message",
  "stage_move",
] as const;

export type FirstResponseChannel = typeof FIRST_RESPONSE_CHANNELS[number];

export type FirstResponseRequest = {
  lead_id: string;
  channel: FirstResponseChannel;
  actor_user_id: string | null;
  is_automation: boolean;
  organization_id: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const firstResponseChannels = new Set<string>(FIRST_RESPONSE_CHANNELS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    value === value.trim() &&
    uuidPattern.test(value);
}

export function parseFirstResponseRequest(
  value: unknown,
): FirstResponseRequest | null {
  if (!isRecord(value)) return null;

  const actorUserId = value.actor_user_id ?? null;
  if (
    !isUuid(value.lead_id) ||
    !isUuid(value.organization_id) ||
    typeof value.channel !== "string" ||
    !firstResponseChannels.has(value.channel) ||
    typeof value.is_automation !== "boolean" ||
    (actorUserId !== null && !isUuid(actorUserId))
  ) {
    return null;
  }

  return {
    lead_id: value.lead_id,
    organization_id: value.organization_id,
    channel: value.channel as FirstResponseChannel,
    actor_user_id: actorUserId,
    is_automation: value.is_automation,
  };
}
