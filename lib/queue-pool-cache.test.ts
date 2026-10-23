import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { hasCachedQueuePoolClaim, isLeadResourceQuery, queuePoolAccessVersion, resetQueuePoolAccessCaches } from './queue-pool-cache';
import type { QueuePoolLead } from './queue-pool';

const uuid = '11111111-1111-4111-8111-111111111111';
const lead: QueuePoolLead = { id: 'lead-a', organization_id: 'org-a', assigned_user_id: null, queue_pool: { round_robin_id: uuid, episode_id: uuid, revision: 3, state: 'pool_waiting', reason: 'queue_closed', can_claim: true } };
const createClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

test('canonical denial, changed revision or owner overrides a stale board claim capability', () => {
  const client = createClient();
  try {
    client.setQueryData(['stages-with-leads', 'org-a', 'pipeline-a'], [{ leads: [lead] }]);
    assert.equal(hasCachedQueuePoolClaim(client, 'org-a', lead), true);
    client.setQueryData(['lead', 'org-a', 'lead-a'], null);
    assert.equal(hasCachedQueuePoolClaim(client, 'org-a', lead), false);
    client.setQueryData(['lead', 'org-a', 'lead-a'], { ...lead, queue_pool: { ...lead.queue_pool, revision: 4 } });
    assert.equal(hasCachedQueuePoolClaim(client, 'org-a', lead), false);
    client.setQueryData(['lead', 'org-a', 'lead-a'], { ...lead, assigned_user_id: 'other-actor' });
    assert.equal(hasCachedQueuePoolClaim(client, 'org-a', lead), false);
  } finally { client.clear(); }
});

test('access reset erases lead capabilities for this tenant and advances only its generation', () => {
  const client = createClient();
  try {
    for (const key of [['lead', 'org-a', 'lead-a'], ['stages-with-leads', 'org-a', 'pipeline-a'], ['lead-sensitive-profile', 'org-a', 'lead-a'], ['lead-history-v2', 'lead-a']]) client.setQueryData(key, lead);
    client.setQueryData(['lead', 'org-b', 'lead-b'], { id: 'lead-b' });
    client.setQueryData(['round-robins', 'org-a'], [{ id: uuid }]);
    resetQueuePoolAccessCaches(client, 'org-a');
    assert.equal(client.getQueryData(['lead', 'org-a', 'lead-a']), undefined);
    assert.equal(client.getQueryData(['lead-sensitive-profile', 'org-a', 'lead-a']), undefined);
    assert.equal(client.getQueryData(['lead-history-v2', 'lead-a']), undefined);
    assert.deepEqual(client.getQueryData(['lead', 'org-b', 'lead-b']), { id: 'lead-b' });
    assert.deepEqual(client.getQueryData(['round-robins', 'org-a']), [{ id: uuid }]);
    assert.equal(queuePoolAccessVersion(client, 'org-a'), 1);
    assert.equal(queuePoolAccessVersion(client, 'org-b'), 0);
    assert.equal(hasCachedQueuePoolClaim(client, 'org-a', lead), false);
    assert.equal(isLeadResourceQuery(['lead', 'org-b', 'lead-b'], 'org-a'), false);
    assert.equal(isLeadResourceQuery(['organization-users', 'org-a'], 'org-a'), false);
  } finally { client.clear(); }
});
