import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { expireSyntheticLead, queueState, requireStatus, setSchedule, snapshot, wakeSyntheticLead } from './queue-full-schema-support.mjs';

async function readAllHistory(context, org, role, lead) {
  const rows = []; const cursors = new Set(); let cursor;
  for (let page = 0; page < 100; page++) {
    const query = new URLSearchParams({ pageSize: '2', ...(cursor ? { cursor } : {}) });
    const result = requireStatus(await context.request(org, role, 'GET', `/v1/leads/${lead.id}/history-raw?${query}`), 200, 'paged queue history');
    assert.ok(Array.isArray(result.data.queueRuntimeEvents));
    rows.push(...result.data.queueRuntimeEvents);
    if (!result.pagination.hasOlder) return { rows, snapshotAt: result.pagination.snapshotAt, pages: page + 1 };
    assert.ok(result.pagination.nextCursor && !cursors.has(result.pagination.nextCursor), 'history cursor must advance');
    cursor = result.pagination.nextCursor; cursors.add(cursor);
  }
  assert.fail('history pagination did not terminate');
}

export async function runQueueHistoryFullSchemaCases(context, test) {
  const [org, foreign] = context.fixture.organizations;
  await test('managed import receipt completes queue_closed and replays without creating another lead or event', async () => {
    const queue = await context.createQueue(org, 'import-managed-receipt', { open: false });
    const payload = { name: `Sintético import receipt ${crypto.randomUUID()}`, source: queue.source,
      pipelineId: org.pipelineId, stageId: org.stageId, autoDistribute: true, roundRobinId: queue.id,
      importMode: true, importRequestKey: crypto.randomUUID() };
    const first = requireStatus(await context.request(org, 'admin', 'POST', '/v1/leads', payload), 201, 'first managed import');
    assert.equal(first.distributionOutcome, 'queue_closed');
    const lead = { id: first.leadId };
    context.created.push({ kind: 'lead', organizationId: org.id, id: lead.id, label: 'import-managed-receipt' });
    const before = await snapshot(context, org, lead);
    const replay = requireStatus(await context.request(org, 'admin', 'POST', '/v1/leads', payload), 201, 'managed import replay');
    assert.equal(replay.leadId, lead.id); assert.equal(replay.distributionOutcome, first.distributionOutcome);
    assert.deepEqual(await snapshot(context, org, lead), before);
    const receipt = (await context.db.query(`select lead_id::text,distribution_outcome,completed_at is not null completed
      from private.contact_import_request_receipts where organization_id=$1 and actor_id=$2 and request_key=$3`,
    [org.id, org.users.admin.id, payload.importRequestKey])).rows[0];
    assert.deepEqual(receipt, { lead_id: lead.id, distribution_outcome: 'queue_closed', completed: true });
    requireStatus(await context.request(org, 'admin', 'POST', '/v1/leads', { ...payload, name: `${payload.name} changed` }), 409, 'key payload conflict');
    context.observations.push({ test: 'managed-import-closed-replay', leadId: lead.id, outcome: first.distributionOutcome, noMutationOnReplay: true });
  });

  await test('pool and claim history stays authorized, paginated, hydrated and metadata-whitelisted', async () => {
    const queue = await context.createQueue(org, 'private-history', { open: false, members: [{ userId: org.users.broker1.id, weight: 1, isActive: true }] });
    const lead = await context.createLead(org, queue, 'private-history');
    const pooled = await snapshot(context, org, lead);
    assert.equal(pooled.owner, null);
    const injected = crypto.randomUUID(); const hidden = crypto.randomUUID();
    await context.db.query(`insert into private.queue_runtime_events(id,organization_id,lead_id,round_robin_id,episode_id,round_number,event_type,
      actor_id,to_user_id,metadata) values($1,$2,$3,$4,$5,1,'quarantined',$6,$6,
      '{"reason":"max_retries","integration_secret":"synthetic-never-render","to_user_name":"foreign-injected-name","history_transition_key":"private-internal"}')`,
    [injected, org.id, lead.id, queue.id, pooled.runtime.episode_id, foreign.users.admin.id]);
    await context.db.query(`insert into private.queue_runtime_events(id,organization_id,lead_id,round_robin_id,episode_id,round_number,event_type)
      values($1,$2,$3,$4,$5,1,'entered_pool')`, [hidden, foreign.id, lead.id, queue.id, crypto.randomUUID()]);
    const history = await readAllHistory(context, org, 'broker1', lead);
    assert.ok(history.rows.some(row => row.event_type === 'entered_pool' && row.metadata.reason === 'queue_closed'));
    const safe = history.rows.find(row => row.id === injected);
    assert.ok(safe && !safe.actor && !safe.to_user, 'foreign actor names must not hydrate');
    assert.doesNotMatch(JSON.stringify(history.rows), /synthetic-never-render|foreign-injected-name|private-internal/);
    assert.equal(history.rows.some(row => row.id === hidden), false);
    assert.equal(new Set(history.rows.map(row => row.id)).size, history.rows.length, 'pages must not repeat private events');
    const expected = (await context.db.query('select id::text from private.queue_runtime_events where organization_id=$1 and lead_id=$2 and created_at<=$3::timestamptz',
      [org.id, lead.id, history.snapshotAt])).rows.map(row => row.id).sort();
    assert.deepEqual(history.rows.map(row => row.id).sort(), expected);
    for (const [who, role] of [[org, 'broker5'], [foreign, 'admin']]) {
      const denied = await context.request(who, role, 'GET', `/v1/leads/${lead.id}/history-raw?pageSize=2`);
      assert.ok([403, 404].includes(denied.status), 'pool history must reject unrelated users and other organizations');
    }
    const claim = { roundRobinId: queue.id, episodeId: pooled.runtime.episode_id, expectedRevision: Number(pooled.runtime.revision) };
    const key = crypto.randomUUID();
    requireStatus(await context.request(org, 'broker1', 'POST', `/v1/leads/${lead.id}/claim-queue-pool`, claim, { 'Idempotency-Key': key }), 200, 'claim with history');
    const claimed = await readAllHistory(context, org, 'broker1', lead);
    const claimEvents = claimed.rows.filter(row => row.event_type === 'manual_claim');
    assert.equal(claimEvents.length, 1); assert.equal(claimEvents[0].actor.id, org.users.broker1.id);
    assert.ok(claimEvents[0].to_user.name);
    assert.equal(claimEvents[0].to_user.id, org.users.broker1.id);
    requireStatus(await context.request(org, 'broker1', 'POST', `/v1/leads/${lead.id}/claim-queue-pool`, claim, { 'Idempotency-Key': key }), 200, 'claim replay with history');
    assert.equal((await readAllHistory(context, org, 'broker1', lead)).rows.filter(row => row.event_type === 'manual_claim').length, 1);
    const legacy = requireStatus(await context.request(org, 'admin', 'GET', `/v1/leads/${lead.id}/history-raw`), 200, 'legacy history projection');
    assert.deepEqual(legacy.data.queueRuntimeEvents.map(row => row.id).sort(), claimed.rows.map(row => row.id).sort());
    context.observations.push({ test: 'private-pool-claim-history', leadId: lead.id, pages: history.pages, foreignLabelsRedacted: true, replayClaimEvents: 1 });
  });

  await test('assignment history distinguishes initial distribution, redistribution and pool reopening/resumption', async () => {
    const queue = await context.createQueue(org, 'rotation-history', { timeout: true });
    const lead = await context.createLead(org, queue, 'rotation-history');
    await expireSyntheticLead(context, org, lead); await context.runtimeOnce();
    let history = await readAllHistory(context, org, 'admin', lead);
    const assigned = history.rows.filter(row => row.event_type === 'assigned').sort((a, b) => a.created_at.localeCompare(b.created_at));
    assert.equal(assigned.length, 2);
    assert.equal(assigned[0].metadata.is_initial_distribution, true); assert.equal(assigned[1].metadata.is_initial_distribution, false);
    assert.equal(assigned[0].metadata.assignment_count, 0);
    assert.equal(assigned[1].metadata.assignment_count, 1); assert.notEqual(assigned[0].to_user_id, assigned[1].to_user_id);
    await setSchedule(context, org, queue, false); await wakeSyntheticLead(context, org, lead); await context.runtimeOnce();
    assert.equal((await snapshot(context, org, lead)).owner, null);
    await setSchedule(context, org, queue, true); await wakeSyntheticLead(context, org, lead); await context.runtimeOnce();
    history = await readAllHistory(context, org, 'admin', lead);
    const resumed = history.rows.filter(row => row.event_type === 'resumed');
    assert.equal(resumed.length, 1);
    assert.ok(history.rows.some(row => row.event_type === 'assigned' && row.id === resumed[0].metadata.distribution_event_id));
    assert.ok(history.rows.every(row => row.queue?.id === queue.id));
    context.observations.push({ test: 'rotation-history-classification', leadId: lead.id, initial: 1, redistributed: 1, resumed: 1 });
  });

  await test('manual transfer captures committed source destination actor and exact ownership-log identity once', async () => {
    const queue = await context.createQueue(org, 'manual-history', { timeout: true });
    const lead = await context.createLead(org, queue, 'manual-history');
    const before = requireStatus(await context.request(org, 'admin', 'GET', `/v1/leads/${lead.id}`), 200, 'read transfer revision').data;
    const target = Object.entries(org.users).find(([role, user]) => role.startsWith('broker') && user.id !== before.assignedUserId)[1].id;
    requireStatus(await context.request(org, 'admin', 'POST', `/v1/leads/${lead.id}/assign`, {
      assignedUserId: target, expectedUpdatedAt: before.updatedAt }), 200, 'manual queue transfer');
    const history = await readAllHistory(context, org, 'admin', lead);
    const events = history.rows.filter(row => row.event_type === 'manual_transfer');
    assert.equal(events.length, 1);
    assert.equal(events[0].from_user_id, before.assignedUserId); assert.equal(events[0].to_user_id, target);
    assert.equal(events[0].actor_id, org.users.admin.id); assert.equal(events[0].actor.id, org.users.admin.id);
    const log = (await context.db.query('select id::text,old_user_id::text,new_user_id::text from public.assignments_log where organization_id=$1 and lead_id=$2 and reason=$3',
      [org.id, lead.id, 'manual_transfer'])).rows;
    assert.equal(log.length, 1); assert.equal(events[0].metadata.assignment_log_id, log[0].id);
    assert.equal(log[0].old_user_id, before.assignedUserId); assert.equal(log[0].new_user_id, target);
    assert.equal((await snapshot(context, org, lead)).runtime.state, 'manual_protected');
    context.observations.push({ test: 'manual-transfer-history-exact-log', leadId: lead.id, actor: events[0].actor_id, destination: target, correlatedEvents: 1 });
  });

  await test('configuration history retains every simultaneous queue setting before and after', async () => {
    const queue = await context.createQueue(org, 'configuration-history');
    const current = await queueState(context, org, queue);
    requireStatus(await context.request(org, 'admin', 'PATCH', `/v1/round-robins/${queue.id}`, { expectedRevision: current.revision,
      name: `${current.name} revisada`, settings: { ...current.settings, enable_redistribution: true,
        redistribution_timeout_minutes: 15, redistribution_warning_minutes: 3, redistribution_max_attempts: 10 } }), 200, 'edit queue configuration');
    const events = requireStatus(await context.request(org, 'admin', 'GET', `/v1/round-robins/${queue.id}/history`), 200, 'queue configuration history').data;
    const change = events.find(event => event.entity_type === 'distribution_queue' && event.action === 'update' && event.new_data.name === `${current.name} revisada`);
    assert.ok(change, 'the actual queue update must have an audit record');
    assert.equal(change.old_data.name, current.name);
    assert.equal(change.new_data.settings.redistribution_timeout_minutes, 15);
    assert.equal(change.new_data.settings.redistribution_warning_minutes, 3);
    assert.equal(change.new_data.settings.redistribution_max_attempts, 10);
    assert.equal(change.user.id, org.users.admin.id);
    context.observations.push({ test: 'configuration-history-all-diffs', queueId: queue.id, simultaneousFields: 5, beforeAfterRetained: true });
  });
}
