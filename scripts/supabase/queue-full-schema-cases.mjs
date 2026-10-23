import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { expireSyntheticLead, requireStatus, setSchedule, snapshot } from './queue-full-schema-support.mjs';

function claimBody(queue, state) {
  return { roundRobinId: queue.id, episodeId: state.runtime.episode_id, expectedRevision: Number(state.runtime.revision) };
}

export async function runFullSchemaCases(context, test) {
  const [org, foreign] = context.fixture.organizations;
  await test('real Go HTTP ingress selects exclusive source rule and honors complete weighted cycles', async () => {
    const queue = await context.createQueue(org, 'weighted-ingress', { weighted: true });
    const cold = (await context.db.query(`select
      to_regclass(format('private.%I',private.round_robin_ticket_sequence_name($1::uuid))) is not null sequence_exists,
      (select count(*)::int from private.lead_distribution_events where organization_id=$2 and round_robin_id=$1) distribution_events`, [queue.id, org.id])).rows[0];
    assert.equal(cold.distribution_events, 0, 'The concurrent queue must have no previous ingress.');
    context.observations.push({ test: 'weighted-ingress-before', queueId: queue.id, ...cold,
      sequenceInitialization: 'Full-schema queue creation eagerly initializes its sequence; this case exercises normal concurrent ingress, not missing-sequence recovery.' });
    const received = new Map(Array.from({ length: 5 }, (_, index) => [org.users[`broker${index + 1}`].id, 0]));
    // Deliberately omit roundRobinId. The new queue has no prior distribution;
    // its sequence may already exist due to the real full-schema create trigger.
    const ingress = await Promise.allSettled(Array.from({ length: 16 }, (_, index) => context.createLead(org, queue, `weighted-${index}`)));
    const failed = ingress.filter(result => result.status === 'rejected');
    context.observations.push({ test: 'weighted-ingress-http-outcomes', queueId: queue.id,
      outcomes: ingress.map(result => result.status === 'fulfilled' ? { status: 201, leadId: result.value.id } : { error: result.reason.message }),
      persistedOwners: (await context.db.query('select assigned_user_id::text user_id,count(*)::int leads from public.leads where organization_id=$1 and origin_round_robin_id=$2 group by assigned_user_id order by assigned_user_id', [org.id, queue.id])).rows });
    assert.equal(failed.length, 0, `Concurrent HTTP ingress failed: ${failed.map(result => result.reason.message).join('; ')}`);
    const leadIds = [];
    for (const { value: lead } of ingress) {
      const state = await snapshot(context, org, lead);
      assert.equal(lead.response.distributionOutcome, 'assigned');
      assert.equal(state.runtime.round_robin_id, queue.id);
      assert.ok(received.has(state.owner), 'Only the five active queue brokers may receive ingress.');
      received.set(state.owner, received.get(state.owner) + 1);
      leadIds.push(lead.id);
    }
    assert.deepEqual(Array.from(received.values()), [8, 2, 2, 2, 2]);
    context.observations.push({ test: 'weighted-ingress', queueId: queue.id, leads: leadIds, counts: Array.from(received.values()), explicitQueueOmitted: true, concurrentRequests: 16, requestRetries: 0 });
  });

  await test('five concurrent HTTP claimants produce one owner and replay preserves ownership ledgers and notifications', async () => {
    const queue = await context.createQueue(org, 'claim-race', { open: false });
    const lead = await context.createLead(org, queue, 'concurrent-claim');
    const before = await snapshot(context, org, lead);
    assert.equal(before.owner, null);
    const body = claimBody(queue, before);
    const roles = ['broker1', 'broker2', 'broker3', 'broker4', 'broker5'];
    const keys = roles.map(() => crypto.randomUUID());
    const responses = await Promise.all(roles.map((role, index) => context.request(org, role, 'POST', `/v1/leads/${lead.id}/claim-queue-pool`, body, { 'Idempotency-Key': keys[index] })));
    assert.equal(responses.filter(response => response.status === 200).length, 1, 'Exactly one concurrent claimant must win.');
    for (const response of responses) assert.ok([200, 404, 409].includes(response.status), `Unexpected claim HTTP ${response.status}`);
    const winner = responses.findIndex(response => response.status === 200);
    const after = await snapshot(context, org, lead);
    assert.equal(after.owner, org.users[roles[winner]].id);
    assert.equal(after.runtime.state, 'manual_protected');
    assert.equal(after.claims, 1);
    assert.equal(after.events, before.events + 1);
    const realtimeCount = async () => (await context.db.query("select count(*)::int n from private.realtime_events where organization_id=$1 and event_type='lead.assigned' and data->>'leadId'=$2", [org.id, lead.id])).rows[0].n;
    // The publisher can time out while PostgreSQL still commits its INSERT.
    // Verify bounded eventual durability, without retrying the claim command.
    const publicationStarted = Date.now();
    const publicationDeadline = publicationStarted + 10_000;
    const publicationSamples = [];
    let realtimeBefore;
    do {
      realtimeBefore = await realtimeCount();
      publicationSamples.push({ elapsedMilliseconds: Date.now() - publicationStarted, count: realtimeBefore });
      assert.ok(realtimeBefore <= 1, 'The winning claim published duplicate assignment invalidations.');
      if (realtimeBefore === 1 || Date.now() >= publicationDeadline) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(100, publicationDeadline - Date.now())));
    } while (Date.now() <= publicationDeadline);
    context.observations.push({ test: 'claim-assignment-invalidation-durability', leadId: lead.id,
      maximumWaitMilliseconds: 10_000, samples: publicationSamples, immediatePublicationSLAAsserted: false });
    assert.equal(realtimeBefore, 1, 'The winning claim must publish exactly one assignment invalidation.');
    requireStatus(await context.request(org, roles[winner], 'POST', `/v1/leads/${lead.id}/claim-queue-pool`, body, { 'Idempotency-Key': keys[winner] }), 200, 'same claim replay');
    const realtimeAfter = await realtimeCount();
    assert.equal(realtimeAfter, realtimeBefore, 'An idempotent replay must not publish another assignment invalidation.');
    assert.deepEqual(await snapshot(context, org, lead), after);
    const forged = await context.request(org, roles[winner], 'POST', `/v1/leads/${lead.id}/claim-queue-pool`, { ...body, expectedRevision: body.expectedRevision + 1 }, { 'Idempotency-Key': keys[winner] });
    assert.equal(forged.status, 409);
    assert.deepEqual(await snapshot(context, org, lead), after);
    context.observations.push({ test: 'concurrent-http-claim', leadId: lead.id, statuses: responses.map(response => response.status), winner: roles[winner], ownershipLedgerReplayNoMutation: true,
      realtimeEventsBeforeReplay: realtimeBefore, realtimeEventsAfterReplay: realtimeAfter, duplicateRealtimeInvalidationOnReplay: realtimeAfter > realtimeBefore });

    // Revoke the exact queue capability first: the existing tenant session is
    // still valid, so SQL audience validation itself must reject receipt replay.
    await context.db.query('update public.round_robin_members set is_active=false where organization_id=$1 and round_robin_id=$2 and user_id=$3', [org.id, queue.id, after.owner]);
    try {
      const replay = await context.request(org, roles[winner], 'POST', `/v1/leads/${lead.id}/claim-queue-pool`, body, { 'Idempotency-Key': keys[winner] });
      assert.ok([403, 404].includes(replay.status), `Revoked queue member replay must fail, got ${replay.status}`);
      assert.deepEqual(await snapshot(context, org, lead), after);
    } finally {
      await context.db.query('update public.round_robin_members set is_active=true where organization_id=$1 and round_robin_id=$2 and user_id=$3', [org.id, queue.id, after.owner]);
    }
    await context.db.query('update public.organization_members set is_active=false where organization_id=$1 and user_id=$2', [org.id, after.owner]);
    try {
      const replay = await context.request(org, roles[winner], 'POST', `/v1/leads/${lead.id}/claim-queue-pool`, body, { 'Idempotency-Key': keys[winner] });
      assert.ok([401, 403, 404].includes(replay.status), `Revoked organization membership must fail, got ${replay.status}`);
      assert.deepEqual(await snapshot(context, org, lead), after);
    } finally {
      await context.db.query('update public.organization_members set is_active=true where organization_id=$1 and user_id=$2', [org.id, after.owner]);
      for (const table of ['team_members', 'round_robin_members']) await context.db.query(`update public.${table} child set membership_generation=om.membership_generation
        from public.organization_members om where child.organization_id=$1 and child.user_id=$2 and om.organization_id=child.organization_id and om.user_id=child.user_id`, [org.id, after.owner]);
    }
  });

  await test('two organizations and outsider cannot read or mutate private pool through Go API or Data API RLS', async () => {
    const queue = await context.createQueue(org, 'tenant-isolation', { open: false });
    const lead = await context.createLead(org, queue, 'private-pool');
    const before = await snapshot(context, org, lead);
    for (const [organization, role] of [[foreign, 'admin'], [org, 'outsider']]) {
      const shown = await context.request(organization, role, 'GET', `/v1/leads/${lead.id}`);
      assert.equal(shown.status, 404);
      const read = await context.dataAPI(organization, role, 'GET', `/rest/v1/leads?id=eq.${lead.id}&select=id,name,organization_id,assigned_user_id`);
      assert.equal(read.status, 200);
      assert.deepEqual(read.body, []);
      const claim = await context.request(organization, role, 'POST', `/v1/leads/${lead.id}/claim-queue-pool`, claimBody(queue, before), { 'Idempotency-Key': crypto.randomUUID() });
      const unchanged = await snapshot(context, org, lead);
      context.observations.push({ test: 'foreign-or-outsider-claim', role, organizationId: organization.id, status: claim.status,
        errorCode: claim.body?.error?.code || claim.body?.code, ownerAfter: unchanged.owner, ownershipLedgersUnchanged: JSON.stringify(unchanged) === JSON.stringify(before) });
      assert.deepEqual(unchanged, before);
      assert.ok([403, 404].includes(claim.status));
    }
    for (const role of ['broker1', 'leader', 'admin']) {
      const shown = requireStatus(await context.request(org, role, 'GET', `/v1/leads/${lead.id}`), 200, `private pool audience ${role}`).data;
      assert.equal(shown.queuePool?.roundRobinId, queue.id);
      assert.equal(shown.queuePool?.canClaim, true);
      const read = await context.dataAPI(org, role, 'GET', `/rest/v1/leads?id=eq.${lead.id}&select=id`);
      assert.equal(read.status, 200);
      const expectedDataAPI = role === 'admin' ? [lead.id] : [];
      assert.deepEqual(read.body.map(item => item.id), expectedDataAPI);
      context.observations.push({ test: 'LegacyDataAPIGrantsPreserved', role, goStatus: 200, goQueueId: shown.queuePool.roundRobinId,
        goCanClaim: true, dataAPIStatus: read.status, expectedDataAPILeadIds: expectedDataAPI, actualDataAPILeadIds: read.body.map(item => item.id),
        reason: 'The APP uses authorized Go reads. A restrictive pool policy is a ceiling and does not add legacy permissive REST grants.' });
    }
    for (const role of ['broker1', 'admin']) {
      const patch = await context.dataAPI(org, role, 'PATCH', `/rest/v1/leads?id=eq.${lead.id}`, { assigned_user_id: org.users[role].id });
      assert.ok([200, 400, 401, 403].includes(patch.status));
      if (patch.status === 200) assert.deepEqual(patch.body, []);
      const generic = await context.request(org, role, 'POST', `/v1/leads/${lead.id}/assign`, { assignedUserId: org.users[role].id });
      assert.ok([403, 409].includes(generic.status));
    }
    const rpc = await context.dataAPI(org, 'admin', 'POST', '/rest/v1/rpc/distribute_lead_from_backend', { p_organization_id: org.id, p_lead_id: lead.id, p_idempotency_key: crypto.randomUUID(), p_round_robin_id: queue.id });
    assert.ok([401, 403, 404].includes(rpc.status), 'Authenticated clients cannot invoke backend allocator RPC.');
    assert.deepEqual(await snapshot(context, org, lead), before);
    context.observations.push({ test: 'api-and-data-api-isolation', leadId: lead.id, foreignOrganization: foreign.id, genericMutationDenied: true, backendRPCDenied: true });
  });

  await test('real Go runtime visits all five brokers in two complete rounds without repeat or budget reset', async () => {
    const queue = await context.createQueue(org, 'fair-two-rounds', { timeout: true });
    const lead = await context.createLead(org, queue, 'fair-rotation');
    const initial = await snapshot(context, org, lead);
    const owners = [initial.owner];
    for (let index = 1; index < 10; index++) {
      await expireSyntheticLead(context, org, lead);
      await context.runtimeOnce();
      const state = await snapshot(context, org, lead);
      assert.equal(state.runtime.episode_id, initial.runtime.episode_id);
      assert.notEqual(state.owner, owners.at(-1));
      assert.equal(state.runtime.assignment_count, index);
      owners.push(state.owner);
    }
    assert.equal(new Set(owners.slice(0, 5)).size, 5);
    assert.equal(new Set(owners.slice(5, 10)).size, 5);
    const visits = (await context.db.query('select round_number,count(*)::int n from private.queue_round_visits where organization_id=$1 and lead_id=$2 group by round_number order by round_number', [org.id, lead.id])).rows;
    assert.deepEqual(visits, [{ round_number: 1, n: 5 }, { round_number: 2, n: 5 }]);
    context.observations.push({ test: 'fair-two-rounds', leadId: lead.id, owners, visits, realGoRuntime: true, timerMethod: 'synthetic due_at and next_action_at advanced before each real Go cycle; not elapsed-time proof' });
  });

  await test('queue close and reopen preserve human/manual ownership and claim while backlog retains episode history', async () => {
    const queue = await context.createQueue(org, 'close-reopen');
    const backlog = await context.createLead(org, queue, 'backlog');
    const claimable = await context.createLead(org, queue, 'claim-during-closed');
    const contacted = await context.createLead(org, queue, 'human-contacted');
    const manual = await context.createLead(org, queue, 'manual-owned', { autoDistribute: false, assignedUserId: org.users.broker5.id });
    const contactedBefore = await snapshot(context, org, contacted);
    const ownerRole = Object.keys(org.users).find(role => org.users[role].id === contactedBefore.owner);
    requireStatus(await context.request(org, ownerRole, 'POST', `/v1/leads/${contacted.id}/first-response`, { lead_id: contacted.id, channel: 'phone', is_automation: false }), 200, 'human first response');
    const history = await snapshot(context, org, backlog);
    await setSchedule(context, org, queue, false);
    for (const item of [backlog, claimable, contacted]) await expireSyntheticLead(context, org, item);
    await context.runtimeOnce();
    const closed = await snapshot(context, org, backlog);
    assert.equal(closed.owner, null);
    assert.ok(['pool_ready', 'pool_waiting'].includes(closed.runtime.state));
    assert.equal((await snapshot(context, org, contacted)).owner, contactedBefore.owner);
    assert.equal((await snapshot(context, org, contacted)).runtime.state, 'human_protected');
    assert.equal((await snapshot(context, org, manual)).owner, org.users.broker5.id);
    const pooled = await snapshot(context, org, claimable);
    requireStatus(await context.request(org, 'broker3', 'POST', `/v1/leads/${claimable.id}/claim-queue-pool`, claimBody(queue, pooled), { 'Idempotency-Key': crypto.randomUUID() }), 200, 'closed pool manual claim');
    await setSchedule(context, org, queue, true);
    await expireSyntheticLead(context, org, backlog);
    await context.runtimeOnce();
    const reopened = await snapshot(context, org, backlog);
    assert.ok(reopened.owner);
    assert.equal(reopened.runtime.episode_id, history.runtime.episode_id);
    assert.ok(reopened.visits > history.visits);
    assert.ok(reopened.runtime.assignment_count > history.runtime.assignment_count);
    assert.equal((await snapshot(context, org, claimable)).owner, org.users.broker3.id);
    assert.equal((await snapshot(context, org, claimable)).runtime.state, 'manual_protected');
    assert.equal((await snapshot(context, org, contacted)).owner, contactedBefore.owner);
    assert.equal((await snapshot(context, org, manual)).owner, org.users.broker5.id);
    context.observations.push({ test: 'close-reopen', queueId: queue.id, backlogLeadId: backlog.id, episodePreserved: true, visitsBefore: history.visits, visitsAfter: reopened.visits, claimedOwnerPreserved: true, humanAndManualPreserved: true });
  });
}
