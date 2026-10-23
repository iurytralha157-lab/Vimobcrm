import { z } from "zod";
import type { CreateTeamInput } from "@/lib/api/teams";
import { createTeamInputSchema } from "@/lib/validation/crm-support";

export const TEAM_CREATE_INTENT_PREFIX = "vimob:team-create-intent:";
const TTL_MS = 2 * 60 * 60 * 1000;
const MAX_BYTES = 1_000_000;
type IntentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type TeamCreateIntent = {
  organizationId: string;
  userId: string;
  idempotencyKey: string;
  input: CreateTeamInput;
};
export type StoredTeamCreateIntent = { status: "ready"; intent: TeamCreateIntent } | { status: "review_required" };

export function teamCreationErrorConfirmsNoResult(error: { status: number; code?: string }, isReplay: boolean) {
  // Authorization/validation may change after an earlier successful commit.
  // A refused replay therefore cannot prove the original entity never existed.
  return error.code === "create_result_unavailable" || (!isReplay && error.status >= 400 && error.status < 500 && ![408, 409].includes(error.status));
}

const intentSchema = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  savedAt: z.number().int().positive(),
  input: createTeamInputSchema.and(z.object({ name: z.string().trim().min(1).max(120) })),
}).strict();

export function teamCreateIntentKey(organizationId?: string | null, userId?: string | null) {
  return organizationId && userId ? `${TEAM_CREATE_INTENT_PREFIX}${organizationId}:${userId}:new` : null;
}

function requireReview(storage: IntentStorage, key: string): StoredTeamCreateIntent {
  // An expired or unreadable unconfirmed request must not silently become a
  // new POST. Remove its payload but retain a scope-only review marker.
  try { storage.setItem(key, JSON.stringify({ reviewRequired: true })); } catch { /* Keep the previous record if storage is blocked. */ }
  return { status: "review_required" };
}

export function readTeamCreateIntent(storage: IntentStorage, organizationId: string, userId: string, now = Date.now()): StoredTeamCreateIntent | null {
  const key = teamCreateIntentKey(organizationId, userId)!;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    if (raw.length > MAX_BYTES) return requireReview(storage, key);
    const decoded: unknown = JSON.parse(raw);
    if (typeof decoded === "object" && decoded !== null && "reviewRequired" in decoded) return { status: "review_required" };
    const parsed = intentSchema.safeParse(decoded);
    if (!parsed.success || parsed.data.organizationId !== organizationId || parsed.data.userId !== userId || parsed.data.savedAt > now || now - parsed.data.savedAt > TTL_MS) return requireReview(storage, key);
    const intent: TeamCreateIntent = { organizationId: parsed.data.organizationId, userId: parsed.data.userId, idempotencyKey: parsed.data.idempotencyKey, input: parsed.data.input };
    return { status: "ready", intent };
  } catch { return requireReview(storage, key); }
}

export function saveTeamCreateIntent(storage: IntentStorage, intent: TeamCreateIntent, now = Date.now()): boolean {
  try {
    const record = intentSchema.parse({ ...intent, savedAt: now });
    const raw = JSON.stringify(record);
    if (raw.length > MAX_BYTES) return false;
    const key = teamCreateIntentKey(intent.organizationId, intent.userId)!;
    storage.setItem(key, raw);
    return storage.getItem(key) === raw;
  } catch { return false; }
}

export function clearTeamCreateIntent(storage: Pick<Storage, "removeItem">, organizationId: string, userId: string) {
  try { storage.removeItem(teamCreateIntentKey(organizationId, userId)!); } catch { /* Logout/confirmed responses must not fail because storage is blocked. */ }
}

export function clearTeamCreateIntentsForUser(storage: Pick<Storage, "length" | "key" | "removeItem">, userId: string) {
  if (!userId) return;
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (!key?.startsWith(TEAM_CREATE_INTENT_PREFIX)) continue;
      const scope = key.slice(TEAM_CREATE_INTENT_PREFIX.length).split(":");
      if (scope.length === 3 && scope[0] && scope[1] === userId && scope[2] === "new") storage.removeItem(key);
    }
  } catch { /* A blocked storage surface must not interrupt logout. */ }
}
