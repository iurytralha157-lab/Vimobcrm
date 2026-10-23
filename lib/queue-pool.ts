import { apiQueuePoolSchema, queuePoolSchema, type APIQueuePool, type QueuePool } from '@/lib/validation/queue-runtime';

export type QueuePoolLead = { id: string; organization_id?: string | null; assigned_user_id?: string | null; queue_pool?: QueuePool | null };

export function toQueuePool(value: APIQueuePool | null | undefined): QueuePool | null {
  if (value == null) return null;
  const parsed = apiQueuePoolSchema.parse(value);
  return {
    round_robin_id: parsed.roundRobinId, episode_id: parsed.episodeId,
    revision: parsed.revision, state: parsed.state, reason: parsed.reason,
    ...(parsed.enteredAt ? { entered_at: parsed.enteredAt } : {}),
    ...(parsed.nextActionAt ? { next_action_at: parsed.nextActionAt } : {}),
    can_claim: parsed.canClaim,
  };
}

/** This is presentation only. The server rechecks permission and CAS on claim. */
export function canClaimQueuePool(lead: QueuePoolLead): boolean {
  return lead.assigned_user_id === null && queuePoolSchema.safeParse(lead.queue_pool).success && lead.queue_pool?.can_claim === true && ['pool_waiting', 'pool_ready', 'limit_exhausted'].includes(lead.queue_pool.state);
}
