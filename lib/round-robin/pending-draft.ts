import { z } from "zod";
import type { DistributionQueueFormData } from "@/lib/round-robin/distribution-queue-form";

export const DISTRIBUTION_DRAFT_PREFIX = "vimob:distribution-draft:";
const TTL_MS = 2 * 60 * 60 * 1000;
// A valid 500-person roster includes display names in the recovery snapshot.
// Keep enough room for that UI data without accepting unbounded storage records.
const MAX_BYTES = 1_000_000;
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type DistributionDraftRecovery = { status: "ready"; form: DistributionQueueFormData } | { status: "review_required"; creationAttemptId?: string };

const draftSchema = z.object({
  savedAt: z.number().int().positive(),
  form: z.object({
    creationAttemptId: z.string().uuid().optional(),
    expectedRevision: z.number().int().positive().optional(),
    // Recover incomplete/legacy names verbatim for correction. The full record
    // remains byte-bounded below; API validation owns the 2–120 character limit.
    name: z.string(), strategy: z.enum(["simple", "weighted"]),
    target_pipeline_id: z.string().max(36), target_stage_id: z.string().max(36),
    is_active: z.boolean(), settings: z.record(z.unknown()),
    conditions: z.array(z.object({
      id: z.string().max(200), type: z.enum(["source", "webhook", "whatsapp_session", "meta_form", "website_category", "campaign_contains", "whatsapp_message_contains", "tag", "city", "interest_property"]),
      values: z.array(z.string()), sessionId: z.string().max(36).optional(),
      originalRule: z.object({ id: z.string().max(36), match_type: z.string().nullish(), match_value: z.string().nullish(), match: z.unknown().optional(), priority: z.number().nullish(), is_active: z.boolean().nullish() }).optional(),
      originalFingerprint: z.string().optional(), legacyType: z.string().max(80).optional(),
    })),
    members: z.array(z.object({ id: z.string().max(36).optional(), type: z.enum(["user", "team"]), entityId: z.string().max(36), teamId: z.string().max(36).optional(), weight: z.number().int().min(1).max(1000), name: z.string().max(300).optional(), isActive: z.boolean().optional(), reenroll: z.boolean().optional() })),
  }),
});

export function distributionDraftKey(organizationId?: string | null, userId?: string | null, queueId?: string) {
  return organizationId && userId ? `${DISTRIBUTION_DRAFT_PREFIX}${organizationId}:${userId}:${queueId || "new"}` : null;
}

export function clearDistributionDraftsForUser(storage: Pick<Storage, "length" | "key" | "removeItem">, userId: string) {
  if (!userId) return;
  try {
    // Iterate backwards because removing a key changes the storage indexes.
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (!key?.startsWith(DISTRIBUTION_DRAFT_PREFIX)) continue;
      const scope = key.slice(DISTRIBUTION_DRAFT_PREFIX.length).split(":");
      if (scope.length === 3 && scope[0] && scope[1] === userId && scope[2]) storage.removeItem(key);
    }
  } catch { /* A blocked storage surface must not interrupt logout. */ }
}

function requireCreateReview(storage: DraftStorage, key: string, creationAttemptId?: string): DistributionDraftRecovery {
  try { storage.setItem(key, JSON.stringify({ reviewRequired: true, creationAttemptId })); } catch { /* Keep the previous record when storage is blocked. */ }
  return { status: "review_required", creationAttemptId };
}

export function readDistributionDraftRecovery(storage: DraftStorage, key: string, now = Date.now()): DistributionDraftRecovery | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const isCreation = key.endsWith(":new");
    if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) {
      if (isCreation) return requireCreateReview(storage, key);
      storage.removeItem(key); return null;
    }
    const decoded = JSON.parse(raw);
    if (isCreation && decoded?.reviewRequired === true) {
      const attempt = z.string().uuid().safeParse(decoded.creationAttemptId);
      return { status: "review_required", creationAttemptId: attempt.success ? attempt.data : undefined };
    }
    const parsed = draftSchema.safeParse(decoded);
    if (!parsed.success || parsed.data.savedAt > now || now - parsed.data.savedAt > TTL_MS) {
      if (isCreation && (!parsed.success || parsed.data.form.creationAttemptId)) return requireCreateReview(storage, key, parsed.success ? parsed.data.form.creationAttemptId : undefined);
      storage.removeItem(key); return null;
    }
    // A stale draft is available for an explicit review, with its original
    // precondition intact. It must never inherit the current queue revision.
    return { status: "ready", form: parsed.data.form };
  } catch {
    if (key.endsWith(":new")) return requireCreateReview(storage, key);
    try { storage.removeItem(key); } catch { /* Storage may be unavailable. */ } return null;
  }
}

export function readDistributionDraft(storage: DraftStorage, key: string, revision?: number, now = Date.now()): DistributionQueueFormData | null {
  void revision;
  const recovered = readDistributionDraftRecovery(storage, key, now);
  return recovered?.status === "ready" ? recovered.form : null;
}

export function saveDistributionDraft(storage: DraftStorage, key: string, form: DistributionQueueFormData, now = Date.now()) {
  try {
    const raw = JSON.stringify(draftSchema.parse({ savedAt: now, form }));
    if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) return false;
    storage.setItem(key, raw);
    return storage.getItem(key) === raw;
  } catch { return false; }
}

/** All exits share the same frozen-create policy as the ordinary autosave. */
export function saveDistributionNavigationDraft(
  storage: DraftStorage,
  key: string,
  form: DistributionQueueFormData,
  recovery: { hasUnreviewedCreation: boolean; pendingCreationSnapshot: DistributionQueueFormData | null },
) {
  try {
    if (key.endsWith(':new') && recovery.hasUnreviewedCreation) return storage.getItem(key) !== null;
    return saveDistributionDraft(storage, key, key.endsWith(':new') && recovery.pendingCreationSnapshot
      ? recovery.pendingCreationSnapshot : form);
  } catch { return false; }
}
