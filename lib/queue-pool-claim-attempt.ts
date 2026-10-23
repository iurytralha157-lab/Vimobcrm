import type { QueuePoolLead } from '@/lib/queue-pool';

export function queuePoolClaimAttemptKey(organizationId: string, actorId: string, sessionId: string, lead: QueuePoolLead): string {
  const pool = lead.queue_pool;
  if (!pool) throw new Error('Atualize os dados do bolsão antes de assumir o lead.');
  return JSON.stringify([organizationId, actorId, sessionId, lead.id, pool.round_robin_id, pool.episode_id, pool.revision]);
}

/** Reuse the exact intention after an uncertain response; never reuse another CAS. */
export function reserveQueuePoolClaimAttempt(attempts: Map<string, string>, key: string, createId: () => string): string {
  const existing = attempts.get(key);
  if (existing) return existing;
  const created = createId();
  attempts.set(key, created);
  return created;
}
