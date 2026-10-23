import assert from 'node:assert/strict';
import test from 'node:test';
import { canClaimQueuePool, toQueuePool } from './queue-pool';
import { queuePoolClaimInputSchema } from '@/lib/validation/queue-runtime';
import { queuePoolClaimAttemptKey, reserveQueuePoolClaimAttempt } from './queue-pool-claim-attempt';
import { mergeLeadServerResponse } from './merge-lead-server-response';

const id = '11111111-1111-4111-8111-111111111111';
const pool = toQueuePool({ roundRobinId: id, episodeId: id, revision: 1, state: 'pool_ready', reason: 'queue_closed', canClaim: true })!;
test('claim requires genuine metadata and capability, never generic unassigned', () => {
  assert.equal(canClaimQueuePool({ id }), false);
  assert.equal(canClaimQueuePool({ id, queue_pool: pool }), false);
  assert.equal(canClaimQueuePool({ id, assigned_user_id: null, queue_pool: pool }), true);
  for (const state of ['pool_waiting', 'pool_ready', 'limit_exhausted']) assert.equal(canClaimQueuePool({ id, assigned_user_id: null, queue_pool: { ...pool, state } }), true);
  assert.equal(canClaimQueuePool({ id, assigned_user_id: null, queue_pool: { ...pool, can_claim: false } }), false);
  assert.equal(canClaimQueuePool({ id, assigned_user_id: null, queue_pool: { ...pool, state: 'manual_protected' } }), false);
  assert.equal(canClaimQueuePool({ id, queue_pool: pool, assigned_user_id: id }), false);
  assert.equal(toQueuePool(undefined), null);
  assert.equal(queuePoolClaimInputSchema.safeParse({ roundRobinId: id, episodeId: id, expectedRevision: 0 }).success, false);
});

test('uncertain retry reuses intention while changed episode, actor, SID or revision uses another', () => {
  const lead = { id, queue_pool: pool };
  const key = queuePoolClaimAttemptKey('org', 'actor', 'sid', lead);
  const attempts = new Map<string, string>(); let sequence = 0;
  assert.equal(reserveQueuePoolClaimAttempt(attempts, key, () => String(++sequence)), '1');
  assert.equal(reserveQueuePoolClaimAttempt(attempts, key, () => String(++sequence)), '1');
  for (const next of [queuePoolClaimAttemptKey('org', 'actor', 'new-sid', lead), queuePoolClaimAttemptKey('org', 'other', 'sid', lead), queuePoolClaimAttemptKey('org', 'actor', 'sid', { ...lead, queue_pool: { ...pool, revision: 2 } })]) assert.notEqual(next, key);
  assert.equal(sequence, 1);
});

test('canonical claimed read clears old pool metadata instead of keeping its action capability', () => {
  const before = { id, assigned_user_id: null as string | null, queue_pool: pool as typeof pool | null };
  const after = mergeLeadServerResponse(before, { id, assigned_user_id: id, queue_pool: null });
  assert.equal(after.queue_pool, null);
  assert.equal(canClaimQueuePool(after), false);
});
