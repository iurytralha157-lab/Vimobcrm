import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { connectVerifiedDatabase } from './queue-local-homologation-target.mjs';
import { queueState, requireStatus, setSchedule, snapshot } from './queue-full-schema-support.mjs';

// No standalone execution, environment lookup, migration or service startup.
// The caller supplies the attested disposable full-schema context and real API.
export async function runQueueConfigurationLifecycleCases(context, test) {
  const [org, foreign] = context.fixture.organizations;
  const request = (queue, method, body, headers) => context.request(org, 'admin', method, `/v1/round-robins/${queue.id}`, body, headers);
  const epoch = async queue => (await context.db.query(`select epoch,completed_epoch from private.queue_runtime_configuration_rechecks
    where organization_id=$1 and round_robin_id=$2`, [org.id, queue.id])).rows[0];
  const drain = async (queue, condition) => {
    for (let attempt = 0; attempt < 24; attempt++) {
      await context.runtimeOnce();
      if (await condition()) return;
    }
    assert.fail(`Configuration epoch did not converge for synthetic queue ${queue.label}`);
  };
  const future = async (label, options) => {
    const queue = await context.createQueue(org, label, { timeout: true, ...options });
    const initialEpoch = (await epoch(queue)).epoch;
    const lead = await context.createLead(org, queue, label);
    assert.equal((await epoch(queue)).epoch, initialEpoch, 'Actual allocation counters must not recursively signal a configuration edit');
    const before = await snapshot(context, org, lead);
    assert.ok(before.owner);
    // Explicit synthetic timer setup; test recheck without expiring business due_at.
    await context.db.query(`update private.queue_lead_runtime set due_at=clock_timestamp()+interval '20 minutes',
      next_action_at=clock_timestamp()+interval '15 minutes' where organization_id=$1 and lead_id=$2`, [org.id, lead.id]);
    return { queue, lead, before };
  };

  await test('managed queue with one eligible permits redistribution settings and never repeats its current owner', async () => {
    const queue = await context.createQueue(org, 'managed-one-eligible', { timeout: true,
      members: [{ userId: org.users.broker1.id, weight: 1, isActive: true }] });
    const current = await queueState(context, org, queue);
    assert.equal(current.eligibleUserCount, 1);
    requireStatus(await request(queue, 'PATCH', { expectedRevision: current.revision, name: `${current.name} revisada`, settings: current.settings }), 200, 'save one-eligible managed queue');
    const lead = await context.createLead(org, queue, 'managed-one-eligible');
    const before = await snapshot(context, org, lead);
    await context.db.query(`update private.queue_lead_runtime set due_at=clock_timestamp()-interval '1 second',next_action_at=clock_timestamp()
      where organization_id=$1 and lead_id=$2`, [org.id, lead.id]);
    await context.runtimeOnce();
    const after = await snapshot(context, org, lead);
    assert.equal(after.owner, org.users.broker1.id);
    assert.equal(after.runtime.assignment_count, before.runtime.assignment_count);
    assert.equal(after.visits, before.visits);
  });

  for (const edit of ['schedule', 'deactivate', 'remove-owner']) await test(`configuration ${edit} reconciles an owner despite a future next_action`, async () => {
    const { queue, lead, before } = await future(`config-${edit}`);
    const current = await queueState(context, org, queue);
    if (edit === 'schedule') await setSchedule(context, org, queue, false);
    else if (edit === 'deactivate') requireStatus(await request(queue, 'PATCH', { expectedRevision: current.revision, isActive: false }), 200, 'disable queue');
    else requireStatus(await request(queue, 'PATCH', { expectedRevision: current.revision, members: current.members
      .filter(member => member.userId !== before.owner).map(member => ({ id: member.id, type: 'user', entityId: member.userId, weight: member.weight, isActive: member.isActive })) }), 200, 'remove current owner');
    await drain(queue, async () => {
      const after = await snapshot(context, org, lead);
      return edit === 'remove-owner' ? after.owner && after.owner !== before.owner : after.owner === null;
    });
    const after = await snapshot(context, org, lead);
    assert.equal(after.runtime.episode_id, before.runtime.episode_id);
    assert.equal(after.runtime.max_assignments, before.runtime.max_assignments);
    if (edit !== 'remove-owner') assert.equal(after.runtime.assignment_count, before.runtime.assignment_count);
    context.observations.push({ test: `configuration-${edit}`, queueId: queue.id, previousOwner: before.owner, owner: after.owner, state: after.runtime.state });
  });

  await test('availability and membership capability writers signal queue rechecks without a forced timer', async () => {
    const team = requireStatus(await context.request(org, 'admin', 'POST', '/v1/teams', {
      name: `Equipe Recheck ${crypto.randomBytes(4).toString('hex')}`, is_active: true,
      members: ['broker1', 'broker2'].map(role => ({ userId: org.users[role].id,
        availability: Array.from({ length: 7 }, (_, day_of_week) => ({ day_of_week, is_active: true, is_all_day: true, start_time: null, end_time: null })) })),
    }, { 'Idempotency-Key': crypto.randomUUID() }), 201, 'create isolated recheck team').data;
    const { queue, lead, before } = await future('config-availability', { members: [{ teamId: team.id, weight: 1, isActive: true }] });
    const oldEpoch = (await epoch(queue)).epoch;
    await context.db.query(`update public.member_availability availability set is_active=false from public.team_members member
      where availability.organization_id=$1 and member.organization_id=$1 and availability.team_member_id=member.id and member.team_id=$2 and member.user_id=$3`, [org.id, team.id, before.owner]);
    assert.ok(BigInt((await epoch(queue)).epoch) > BigInt(oldEpoch));
    await drain(queue, async () => (await snapshot(context, org, lead)).owner !== before.owner);
    const next = (await snapshot(context, org, lead)).owner;
    assert.ok(next);
    await context.db.query(`update public.team_members set is_active=false where organization_id=$1 and team_id=$2 and user_id=$3`, [org.id, team.id, next]);
    await drain(queue, async () => (await snapshot(context, org, lead)).owner === null);
  });

  await test('configuration recheck skips more than fifty locked leads and returns to them after release', async () => {
    const queue = await context.createQueue(org, 'config-busy-prefix');
    const leads = [];
    for (let index = 0; index < 55; index++) leads.push(await context.createLead(org, queue, `config-busy-${index}`));
    await context.db.query(`update private.queue_lead_runtime set next_action_at=clock_timestamp()+interval '15 minutes'
      where organization_id=$1 and round_robin_id=$2`, [org.id, queue.id]);
    await setSchedule(context, org, queue, false);
    const ids = leads.map(lead => lead.id).sort();
    const locker = await connectVerifiedDatabase(context.manifest);
    try {
      await locker.query('begin');
      await locker.query(`select id from public.leads where organization_id=$1 and id=any($2::uuid[]) order by id for no key update`, [org.id, ids.slice(0, 51)]);
      const lockedBefore = (await context.db.query(`select id,assigned_user_id from public.leads
        where organization_id=$1 and id=any($2::uuid[]) order by id`, [org.id, ids.slice(0, 51)])).rows;
      assert.equal(lockedBefore.length, 51);
      assert.ok(lockedBefore.every(lead => lead.assigned_user_id !== null));
      // runtimeOnce shares a bounded configuration lane with every fixture queue.
      // Keep all 51 locks held across bounded ticks: reaching the four unlocked
      // leads must not depend on this queue receiving the first global batch.
      const progress = [];
      let free = [];
      for (let attempt = 0; attempt < 24; attempt++) {
        await context.runtimeOnce();
        free = (await context.db.query(`select assigned_user_id from public.leads
          where organization_id=$1 and id=any($2::uuid[])`, [org.id, ids.slice(51)])).rows;
        progress.push({ tick: attempt + 1, pooled: free.filter(lead => lead.assigned_user_id === null).length });
        if (free.length === 4 && free.every(lead => lead.assigned_user_id === null)) break;
      }
      context.observations.push({ test: 'configuration-busy-prefix', queueId: queue.id,
        lockedLeadCount: lockedBefore.length, freeLeadCount: 4, progress });
      assert.equal(free.length, 4);
      assert.ok(free.every(lead => lead.assigned_user_id === null), 'All four unlocked leads must reach the pool while the 51 preceding leads remain locked');
      const lockedAfter = (await context.db.query(`select id,assigned_user_id from public.leads
        where organization_id=$1 and id=any($2::uuid[]) order by id`, [org.id, ids.slice(0, 51)])).rows;
      assert.deepEqual(lockedAfter, lockedBefore, 'A locked lead cannot be mutated while later free leads are processed');
      const pending = await epoch(queue);
      assert.ok(BigInt(pending.completed_epoch) < BigInt(pending.epoch), 'Busy pages must not acknowledge the complete epoch');
    } finally { await locker.query('rollback').catch(() => undefined); await locker.end(); }
    await drain(queue, async () => (await context.db.query(`select count(*)::int remaining from public.leads
      where organization_id=$1 and id=any($2::uuid[]) and assigned_user_id is not null`, [org.id, ids])).rows[0].remaining === 0);
    const completed = await epoch(queue);
    assert.equal(completed.completed_epoch, completed.epoch);
  });

  await test('successive configuration epochs preserve page progress before revisiting an already processed prefix', async () => {
    const queue = await context.createQueue(org, 'config-epoch-page-progress');
    const leads = [];
    for (let index = 0; index < 3; index++) leads.push(await context.createLead(org, queue, `config-epoch-page-${index}`));
    await context.db.query(`update private.queue_lead_runtime set next_action_at=clock_timestamp()+interval '15 minutes'
      where organization_id=$1 and round_robin_id=$2`, [org.id, queue.id]);
    await setSchedule(context, org, queue, false);
    await context.db.query('begin');
    try {
      await context.db.query('update private.queue_runtime_configuration_rechecks set completed_epoch=epoch where round_robin_id<>$1', [queue.id]);
      await context.db.query('update private.queue_runtime_configuration_cursor set last_queue_id=null where singleton');
      for (const id of leads.map(lead => lead.id).sort()) {
        await context.db.query('select private.request_queue_runtime_recheck($1,$2)', [org.id, queue.id]);
        const result = (await context.db.query('select private.process_queue_runtime_configuration_rechecks(1,clock_timestamp()) result')).rows[0].result;
        assert.equal(result.processed, 1);
        assert.equal(result.failed, 0);
        assert.equal((await snapshot(context, org, { id })).owner, null, 'A new epoch cannot send traversal back to its first lead');
      }
      const processed = await context.db.query('select count(*)::int n from public.leads where organization_id=$1 and id=any($2::uuid[]) and assigned_user_id is null', [org.id, leads.map(lead => lead.id)]);
      assert.equal(processed.rows[0].n, 3);
    } finally { await context.db.query('rollback'); }
  });

  await test('one-slot batches alternate durably so continuous configuration edits cannot starve normal runtime', async () => {
    const configuration = await future('config-single-slot-edits');
    const normal = await future('config-single-slot-normal');
    await setSchedule(context, org, configuration.queue, false);
    await context.db.query('begin');
    try {
      // Scope this deterministic scheduler probe to the two synthetic episodes;
      // all cursor and other fixture adjustments are rolled back below.
      await context.db.query(`update private.queue_runtime_configuration_rechecks set completed_epoch=epoch
        where round_robin_id<>$1`, [configuration.queue.id]);
      await context.db.query(`update private.queue_runtime_configuration_cursor
        set last_queue_id=null,single_slot_configuration_next=true where singleton`);
      await context.db.query(`update private.queue_runtime_worker_cursors set sort_at=null,last_id=null,pool_at=null where lane='runtime'`);
      await context.db.query(`update private.queue_lead_runtime set next_action_at=clock_timestamp()+interval '1 day'
        where lead_id<>$1 and next_action_at<=clock_timestamp()`, [normal.lead.id]);
      await context.db.query(`update private.queue_lead_runtime set next_action_at='-infinity'::timestamptz,
        due_at=clock_timestamp()-interval '1 second' where organization_id=$1 and lead_id=$2`, [org.id, normal.lead.id]);
      for (let turn = 0; turn < 2; turn++) {
        await context.db.query('select private.request_queue_runtime_recheck($1,$2)', [org.id, configuration.queue.id]);
        const result = (await context.db.query('select private.process_queue_runtime_batch(1,clock_timestamp()) result')).rows[0].result;
        assert.ok(result.processed <= 1, 'The shared batch limit remains one');
        assert.equal(result.failed, 0);
      }
      assert.ok((await snapshot(context, org, normal.lead)).runtime.assignment_count > normal.before.runtime.assignment_count,
        'A continuously pending configuration lane must leave the second one-slot tick to normal runtime');
      assert.equal((await context.db.query(`select single_slot_configuration_next next
        from private.queue_runtime_configuration_cursor where singleton`)).rows[0].next, true, 'Two lane decisions form a complete alternation');
    } finally { await context.db.query('rollback'); }
  });

  await test('pending pool blocks API deletion and old-style SQL cleanup atomically; claimed queue keeps authorized tombstone history', async () => {
    const queue = await context.createQueue(org, 'delete-pending', { open: false });
    const lead = await context.createLead(org, queue, 'delete-pending');
    const before = await snapshot(context, org, lead);
    const current = await queueState(context, org, queue);
    const denied = await request(queue, 'DELETE', undefined, { 'If-Match': `"${current.revision}"` });
    assert.equal(denied.status, 409);
    assert.equal(denied.body.error.code, 'round_robin_distribution_pending');
    assert.deepEqual(await snapshot(context, org, lead), before);
    await context.db.query('begin');
    try {
      await context.db.query('delete from public.lead_redistribution_jobs where organization_id=$1 and round_robin_id=$2', [org.id, queue.id]);
      await context.db.query('delete from public.round_robin_members where organization_id=$1 and round_robin_id=$2', [org.id, queue.id]);
      await assert.rejects(context.db.query('update public.round_robins set deleted_at=clock_timestamp(),is_active=false where organization_id=$1 and id=$2', [org.id, queue.id]), error => error.code === '23514' && error.message.includes('queue_distribution_pending'));
    } finally { await context.db.query('rollback'); }
    requireStatus(await context.request(org, 'admin', 'POST', `/v1/leads/${lead.id}/claim-queue-pool`, {
      roundRobinId: queue.id, episodeId: before.runtime.episode_id, expectedRevision: Number(before.runtime.revision),
    }, { 'Idempotency-Key': crypto.randomUUID() }), 200, 'resolve pool by claim');
    const resolved = await queueState(context, org, queue);
    requireStatus(await request(queue, 'DELETE', undefined, { 'If-Match': `"${resolved.revision}"` }), 204, 'delete resolved queue');
    const foreignEvent = crypto.randomUUID();
    await context.db.query(`insert into public.audit_logs(id,organization_id,user_id,action,entity_type,entity_id,old_data,new_data,diff,source)
      values($1,$2,$3,'update','distribution_queue_member',$4,$5::jsonb,$5::jsonb,'{}','synthetic_test')`,
    [foreignEvent, org.id, foreign.users.admin.id, crypto.randomUUID(), JSON.stringify({ round_robin_id: queue.id, user_id: foreign.users.admin.id })]);
    const history = requireStatus(await context.request(org, 'admin', 'GET', `/v1/round-robins/${queue.id}/history`), 200, 'authorized tombstone history').data;
    const hiddenParticipant = history.find(event => event.id === foreignEvent);
    assert.ok(hiddenParticipant);
    assert.equal(hiddenParticipant.user ?? null, null, 'Foreign actor profile must not hydrate');
    assert.equal(hiddenParticipant.subject_user ?? null, null, 'Foreign participant profile must not hydrate');
    assert.equal(hiddenParticipant.old_data.user_id, foreign.users.admin.id, 'The immutable audited ID survives without foreign display data');
    requireStatus(await context.request(foreign, 'admin', 'GET', `/v1/round-robins/${queue.id}/history`), 404, 'foreign tombstone history');
    requireStatus(await request(queue, 'GET'), 404, 'tombstone is not operational');
    requireStatus(await request(queue, 'PATCH', { expectedRevision: resolved.revision, isActive: true }), 404, 'tombstone cannot reactivate');
  });

  await test('legacy pending-job deletion marker rolls back old-API tombstone cleanup and expires after ordinary cleanup commit', async () => {
    const source = `qh-delete-marker-${crypto.randomBytes(5).toString('hex')}`;
    const created = requireStatus(await context.request(org, 'admin', 'POST', '/v1/round-robins', {
      name: `Compatibilidade exclusão ${source}`, isActive: true, targetPipelineId: org.pipelineId, targetStageId: org.stageId,
      settings: { enable_redistribution: false }, conditions: [{ type: 'source', values: [source] }],
      members: [{ userId: org.users.broker1.id, weight: 1, isActive: true }],
    }, { 'Idempotency-Key': crypto.randomUUID() }), 201, 'create explicit legacy compatibility queue').data;
    const queue = { id: created.id, label: 'legacy-delete-marker', source };
    context.created.push({ kind: 'queue', organizationId: org.id, ...queue });
    const lead = await context.createLead(org, queue, 'legacy-delete-marker', { autoDistribute: false });
    assert.equal((await snapshot(context, org, lead)).runtime, null, 'This marker case must not be protected by a runtime row');
    // A synthetic pending job isolates the old-API marker from the managed runtime guard.
    await context.db.query(`insert into public.lead_redistribution_jobs(organization_id,lead_id,round_robin_id,timeout_minutes,warning_minutes,due_at,status)
      values($1,$2,$3,20,5,clock_timestamp()+interval '20 minutes','pending')`, [org.id, lead.id, queue.id]);
    await context.db.query('begin');
    try {
      await context.db.query('delete from public.lead_redistribution_jobs where organization_id=$1 and round_robin_id=$2', [org.id, queue.id]);
      assert.equal((await context.db.query(`select exists(select 1 from private.queue_deleted_pending_job_transactions
        where transaction_id=txid_current() and organization_id=$1 and round_robin_id=$2) present`, [org.id, queue.id])).rows[0].present, true);
      await assert.rejects(context.db.query('update public.round_robins set deleted_at=clock_timestamp(),is_active=false where organization_id=$1 and id=$2', [org.id, queue.id]), error => error.code === '23514');
    } finally { await context.db.query('rollback'); }
    await context.db.query('delete from public.lead_redistribution_jobs where organization_id=$1 and round_robin_id=$2', [org.id, queue.id]);
    assert.equal((await context.db.query('select count(*)::int n from private.queue_deleted_pending_job_transactions')).rows[0].n, 0);
  });

  await test('configuration wake internals are private to the backend', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const row = (await context.db.query(`select has_table_privilege($1,'private.queue_runtime_configuration_rechecks','SELECT') can_read,
        has_function_privilege($1,'private.request_queue_runtime_recheck(uuid,uuid)','EXECUTE') can_request,
        has_function_privilege($1,'private.process_queue_runtime_configuration_rechecks(integer,timestamptz)','EXECUTE') can_process`, [role])).rows[0];
      assert.deepEqual(row, { can_read: false, can_request: false, can_process: false });
    }
  });
}
