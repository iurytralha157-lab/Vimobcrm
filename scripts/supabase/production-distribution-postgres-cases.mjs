import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { makeQueue, makeLead, canonical, preview, poolRedistribute, observeWait } from './production-distribution-postgres-fixture.mjs';

const ids = results => results.map(result => result.assigned_user_id);

export async function runSequentialCases({ db, test, report }) {
  await test('Existing owner C starts circular order D E A B C before repeating', async () => {
    const q = await makeQueue(db), lead = await makeLead(db, q, q.users[2]), recipients = [];
    for (let n = 0; n < 10; n++) recipients.push((await canonical(db, q, lead)).assigned_user_id);
    const round = [...q.users.slice(3), ...q.users.slice(0, 3)];
    assert.deepEqual(recipients, [...round, ...round]);
  });

  await test('Five eligible recipients complete two rounds despite 25/311/692/693/694 accumulated events', async () => {
    const q = await makeQueue(db), lead = await makeLead(db, q, q.users[0]);
    const totals = [25, 311, 692, 693, 694];
    for (let n = 0; n < totals.length; n++) await db.query(`insert into public.round_robin_logs
      (organization_id,round_robin_id,assigned_user_id,member_id,reason,metadata)
      select $1,$2,$3,$4,'historical_test_event',jsonb_build_object('member_id',$4::uuid::text) from generate_series(1,$5::int)`,
    [q.org, q.queue, q.users[n], q.members[n], totals[n]]);
    const result = [];
    for (let n = 0; n < 10; n++) result.push(await canonical(db, q, lead));
    assert.deepEqual(ids(result), [...q.users.slice(1), q.users[0], ...q.users.slice(1), q.users[0]]);
    report.rotation = { accumulatedEvents: totals, recipientsByIndex: ids(result).map(id => q.users.indexOf(id)),
      distinctFirstFive: new Set(ids(result).slice(0, 5)).size };
  });

  await test('Initial weighted 4:1:1:1:1 tickets survive interleaved redistributions', async () => {
    const q = await makeQueue(db, { weighted: true });
    const rotationLead = await makeLead(db, q, q.users[0]);
    const initial = [], redistribution = [];
    for (let n = 0; n < 16; n++) {
      initial.push(await canonical(db, q, await makeLead(db, q), randomUUID(), true));
      redistribution.push(await canonical(db, q, rotationLead));
    }
    assert.deepEqual(initial.map(result => Number(result.distribution_ticket)), Array.from({ length: 16 }, (_, n) => n + 1));
    assert.deepEqual(q.users.map(user => ids(initial).filter(id => id === user).length), [8, 2, 2, 2, 2]);
    assert.ok(redistribution.every(result => result.distribution_ticket == null));
    for (let n = 0; n < 15; n += 5) assert.equal(new Set(ids(redistribution).slice(n, n + 5)).size, 5);
  });

  await test('Preview is non-consuming and repeated preview agrees with committed recipient', async () => {
    const q = await makeQueue(db), lead = await makeLead(db, q, q.users[0]);
    const first = await preview(db, q, lead, q.users[0]);
    for (let n = 0; n < 8; n++) assert.equal((await preview(db, q, lead, q.users[0])).user_id, first.user_id);
    assert.equal((await canonical(db, q, lead)).assigned_user_id, first.user_id);
    assert.equal((await preview(db, q, lead, first.user_id)).user_id, q.users[2]);
  });

  await test('Repeated last-recipient preview cannot consume or advance a completed round', async () => {
    const q = await makeQueue(db), lead = await makeLead(db, q, q.users[0]);
    for (let n = 0; n < 4; n++) await canonical(db, q, lead);
    const read = async () => (await db.query(`select round_no,visited_user_ids,last_user_id from private.round_robin_rotation_state
      where organization_id=$1 and lead_id=$2 and round_robin_id=$3`, [q.org, lead, q.queue])).rows[0];
    const before = await read();
    for (let n = 0; n < 8; n++) assert.equal((await preview(db, q, lead, q.users[4])).user_id, q.users[0]);
    assert.deepEqual(await read(), before);
    assert.equal((await canonical(db, q, lead)).assigned_user_id, q.users[0]);
    assert.equal(Number((await read()).round_no), Number(before.round_no) + 1);
  });

  await test('Browser roles cannot execute private preview and backend cannot read private rotation tables', async () => {
    const q = await makeQueue(db), lead = await makeLead(db, q, q.users[0]);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const { rows: [permissions] } = await db.query(`select
        has_table_privilege($1,'private.round_robin_rotation_state','SELECT') as table_read,
        has_function_privilege($1,'private.preview_round_robin_redistribution_candidate(uuid,uuid,uuid,uuid,uuid,timestamptz)','EXECUTE') as preview`, [role]);
      assert.equal(permissions.table_read, false);
      assert.equal(permissions.preview, role === 'service_role');
      await db.query(`set role ${role}`);
      try {
        if (role === 'service_role') assert.equal((await preview(db, q, lead, q.users[0])).user_id, q.users[1]);
        else await assert.rejects(preview(db, q, lead, q.users[0]), error => error.code === '42501');
        await assert.rejects(db.query('select * from private.round_robin_rotation_state'), error => error.code === '42501');
      } finally { await db.query('reset role'); }
    }
  });

  await test('Direct plus team duplicates never multiply a recipient within a round', async () => {
    const q = await makeQueue(db), team = randomUUID();
    await db.query('insert into public.teams(id,organization_id) values($1,$2)', [team, q.org]);
    for (const user of q.users) await db.query('insert into public.team_members(id,organization_id,team_id,user_id) values($1,$2,$3,$4)',
      [randomUUID(), q.org, team, user]);
    await db.query(`insert into public.round_robin_members(id,organization_id,round_robin_id,team_id,position)
      values($1,$2,$3,$4,-1)`, [randomUUID(), q.org, q.queue, team]);
    const lead = await makeLead(db, q, q.users[0]), recipients = [];
    for (let n = 0; n < 10; n++) recipients.push((await canonical(db, q, lead)).assigned_user_id);
    assert.equal(new Set(recipients.slice(0, 5)).size, 5);
    assert.equal(new Set(recipients.slice(5, 10)).size, 5);
  });

  await test('Unavailable user returning mid-round is served before any already visited user', async () => {
    const q = await makeQueue(db), lead = await makeLead(db, q, q.users[0]);
    await db.query('update public.users set is_active=false where id=$1', [q.users[2]]);
    assert.equal((await canonical(db, q, lead)).assigned_user_id, q.users[1]);
    assert.equal((await canonical(db, q, lead)).assigned_user_id, q.users[3]);
    await db.query('update public.users set is_active=true where id=$1', [q.users[2]]);
    const next = [(await canonical(db, q, lead)).assigned_user_id, (await canonical(db, q, lead)).assigned_user_id];
    assert.deepEqual(new Set(next), new Set([q.users[2], q.users[4]]));
    assert.notEqual((await canonical(db, q, lead)).assigned_user_id, next.at(-1));
  });

  await test('Reordering and adding an eligible member preserve already visited set', async () => {
    const q = await makeQueue(db), lead = await makeLead(db, q, q.users[0]);
    assert.equal((await canonical(db, q, lead)).assigned_user_id, q.users[1]);
    await db.query('update public.round_robin_members set position=10-position where round_robin_id=$1', [q.queue]);
    const user = randomUUID();
    await db.query('insert into public.users(id,organization_id,name) values($1,$2,$3)', [user, q.org, 'Synthetic new member']);
    await db.query('insert into public.organization_members(organization_id,user_id) values($1,$2)', [q.org, user]);
    await db.query(`insert into public.round_robin_members(id,organization_id,round_robin_id,user_id,position)
      values($1,$2,$3,$4,-1)`, [randomUUID(), q.org, q.queue, user]);
    const recipients = [];
    for (let n = 0; n < 4; n++) recipients.push((await canonical(db, q, lead)).assigned_user_id);
    assert.deepEqual(new Set(recipients), new Set([user, ...q.users.slice(2)]));
    assert.ok(!recipients.includes(q.users[0]) && !recipients.includes(q.users[1]));
  });

  await test('Sole eligible current owner fails safely without reassignment or ticket consumption', async () => {
    const q = await makeQueue(db, { count: 1 }), lead = await makeLead(db, q, q.users[0]);
    const result = await canonical(db, q, lead);
    assert.equal(result.success, false);
    assert.equal((await db.query('select assigned_user_id from public.leads where id=$1', [lead])).rows[0].assigned_user_id, q.users[0]);
    assert.equal(Number((await db.query('select count(*) from public.assignments_log where lead_id=$1', [lead])).rows[0].count), 1);
  });

  await test('Unowned old lead resumes rotation even when canonical preserve flag is true', async () => {
    const q = await makeQueue(db, { weighted: true }), lead = await makeLead(db, q, q.users[0]);
    assert.equal((await canonical(db, q, lead)).assigned_user_id, q.users[1]);
    await db.query('update public.leads set assigned_user_id=null where id=$1', [lead]);
    const resumed = await canonical(db, q, lead, randomUUID(), true);
    assert.equal(resumed.assigned_user_id, q.users[2]);
    assert.equal(resumed.distribution_ticket, null);
  });

  await test('Removal of current owner preserves circular cursor without restarting at A', async () => {
    const q = await makeQueue(db), lead = await makeLead(db, q, q.users[0]);
    assert.equal((await canonical(db, q, lead)).assigned_user_id, q.users[1]);
    assert.equal((await canonical(db, q, lead)).assigned_user_id, q.users[2]);
    await db.query('delete from public.round_robin_members where id=$1', [q.members[2]]);
    assert.equal((await canonical(db, q, lead)).assigned_user_id, q.users[3]);
    assert.equal((await canonical(db, q, lead)).assigned_user_id, q.users[4]);
    assert.equal((await canonical(db, q, lead)).assigned_user_id, q.users[0]);
  });

  await test('Team schedule excludes unavailable member; direct entry remains independent', async () => {
    const q = await makeQueue(db), team = randomUUID(), teamMembers = q.users.map(() => randomUUID());
    await db.query('insert into public.teams(id,organization_id) values($1,$2)', [team, q.org]);
    for (let n = 0; n < q.users.length; n++) {
      await db.query('insert into public.team_members(id,organization_id,team_id,user_id) values($1,$2,$3,$4)',
        [teamMembers[n], q.org, team, q.users[n]]);
      await db.query(`insert into public.member_availability(organization_id,team_member_id,day_of_week,is_all_day,is_active)
        values($1,$2,extract(dow from clock_timestamp() at time zone 'UTC'),true,$3)`, [q.org, teamMembers[n], n !== 1]);
    }
    await db.query('update public.round_robin_members set is_active=false where round_robin_id=$1', [q.queue]);
    await db.query(`insert into public.round_robin_members(id,organization_id,round_robin_id,team_id,position)
      values($1,$2,$3,$4,0)`, [randomUUID(), q.org, q.queue, team]);
    const lead = await makeLead(db, q, q.users[0]);
    assert.equal((await canonical(db, q, lead)).assigned_user_id, q.users[2]);
    await db.query('update public.round_robin_members set is_active=true where id=$1', [q.members[1]]);
    await db.query('update public.users set is_active=false where id=any($1::uuid[])', [[q.users[0], ...q.users.slice(3)]]);
    assert.equal((await preview(db, q, lead, q.users[2])).user_id, q.users[1]);
    assert.equal((await canonical(db, q, lead)).assigned_user_id, q.users[1]);
  });

  await test('Old replica wrong-recipient confirmed log aborts owner and every child mutation atomically', async () => {
    const q = await makeQueue(db), lead = await makeLead(db, q, q.users[0]);
    await db.query('begin');
    await db.query('update public.leads set assigned_user_id=$1 where id=$2', [q.users[2], lead]);
    await assert.rejects(db.query(`insert into public.round_robin_logs(organization_id,round_robin_id,lead_id,
      assigned_user_id,member_id,reason,metadata) values($1,$2,$3,$4,$5,'auto_redistribution','{}')`,
    [q.org, q.queue, lead, q.users[2], q.members[2]]), error => error.code === '40001');
    await db.query('rollback');
    assert.equal((await db.query('select assigned_user_id from public.leads where id=$1', [lead])).rows[0].assigned_user_id, q.users[0]);
    assert.equal(Number((await db.query('select count(*) from public.round_robin_logs where lead_id=$1', [lead])).rows[0].count), 0);
    assert.equal((await canonical(db, q, lead)).assigned_user_id, q.users[1]);
  });

  await test('Keep-assignee logs cannot consume a visit and same-owner transfer logs fail closed', async () => {
    const q = await makeQueue(db), lead = await makeLead(db, q, q.users[0]);
    assert.equal((await canonical(db, q, lead)).assigned_user_id, q.users[1]);
    await db.query(`insert into public.round_robin_logs(organization_id,round_robin_id,lead_id,assigned_user_id,reason)
      values($1,$2,$3,$4,'keep_assignee')`, [q.org, q.queue, lead, q.users[1]]);
    assert.equal((await preview(db, q, lead, q.users[1])).user_id, q.users[2]);
    await assert.rejects(db.query(`insert into public.round_robin_logs(organization_id,round_robin_id,lead_id,assigned_user_id,reason)
      values($1,$2,$3,$4,'round_robin')`, [q.org, q.queue, lead, q.users[1]]), error => error.code === '40001');
    assert.equal((await canonical(db, q, lead)).assigned_user_id, q.users[2]);
  });

  await test('Foreign queue scope preview returns no candidate and creates no private state', async () => {
    const q = await makeQueue(db), foreign = await makeQueue(db), lead = await makeLead(db, q, q.users[0]);
    assert.equal(await preview(db, { ...q, queue: foreign.queue }, lead, q.users[0]), undefined);
    assert.equal(Number((await db.query('select count(*) from private.round_robin_rotation_state where lead_id=$1', [lead])).rows[0].count), 0);
  });

  await test('Canonical replay preserves one durable event, one transfer and next recipient', async () => {
    const q = await makeQueue(db), lead = await makeLead(db, q, q.users[0]), key = randomUUID();
    const first = await canonical(db, q, lead, key), second = await canonical(db, q, lead, key);
    assert.deepEqual(second, first);
    assert.equal(Number((await db.query('select count(*) from private.lead_distribution_events where lead_id=$1', [lead])).rows[0].count), 1);
    assert.equal(Number((await db.query('select count(*) from public.assignments_log where lead_id=$1', [lead])).rows[0].count), 2);
    assert.equal((await canonical(db, q, lead)).assigned_user_id, q.users[2]);
  });

  await test('Rollback after recipient selection restores owner, visit state and idempotency event', async () => {
    const q = await makeQueue(db), lead = await makeLead(db, q, q.users[0]), key = randomUUID();
    await db.query('begin');
    const result = await canonical(db, q, lead, key);
    assert.equal(result.assigned_user_id, q.users[1]);
    await db.query('rollback');
    assert.equal(Number((await db.query('select count(*) from private.lead_distribution_events where lead_id=$1', [lead])).rows[0].count), 0);
    assert.equal((await db.query('select assigned_user_id from public.leads where id=$1', [lead])).rows[0].assigned_user_id, q.users[0]);
    assert.equal((await canonical(db, q, lead, key)).assigned_user_id, q.users[1]);
  });

  await test('Pool hook uses complete rounds and retains counter and replay protection', async () => {
    const q = await makeQueue(db), lead = await makeLead(db, q, q.users[0]), recipients = [];
    const baseNow = Date.now();
    for (let n = 0; n < 10; n++) {
      const now = new Date(baseNow + n * 120000).toISOString();
      const result = await poolRedistribute(db, q, lead, randomUUID(), now);
      assert.equal(result.success, true, JSON.stringify(result));
      assert.equal(result.redistribution_count, n + 1);
      recipients.push(result.assigned_user_id);
    }
    assert.deepEqual(recipients, [...q.users.slice(1), q.users[0], ...q.users.slice(1), q.users[0]]);
    assert.equal(Number((await db.query('select count(*) from public.lead_pool_history where lead_id=$1', [lead])).rows[0].count), 10);
  });

  await test('Pool limits and existing human activity continue blocking redistribution', async () => {
    const q = await makeQueue(db), limited = await makeLead(db, q, q.users[0]), handled = await makeLead(db, q, q.users[0]);
    await db.query('update public.pipelines set pool_max_redistributions=2 where id=$1', [q.pipeline]);
    await db.query('update public.leads set redistribution_count=2 where id=$1', [limited]);
    assert.equal((await poolRedistribute(db, q, limited)).reason, 'pool_redistribution_limit_reached');
    await db.query(`update public.leads set first_response_at='2026-01-01T00:00:30Z' where id=$1`, [handled]);
    assert.equal((await poolRedistribute(db, q, handled)).reason, 'lead_has_activity_after_distribution');
    for (const lead of [limited, handled]) assert.equal((await db.query('select assigned_user_id from public.leads where id=$1', [lead])).rows[0].assigned_user_id, q.users[0]);
  });

  await test('Foreign tenant and inactive membership cannot become recipients', async () => {
    const q = await makeQueue(db), lead = await makeLead(db, q, q.users[0]);
    await db.query('update public.organization_members set is_active=false where organization_id=$1 and user_id=$2', [q.org, q.users[1]]);
    await db.query('update public.users set organization_id=$1 where id=$2', [randomUUID(), q.users[2]]);
    await db.query('delete from public.organization_members where organization_id=$1 and user_id=$2', [q.org, q.users[2]]);
    const result = [];
    for (let n = 0; n < 6; n++) result.push((await canonical(db, q, lead)).assigned_user_id);
    assert.ok(result.every(id => ![q.users[1], q.users[2]].includes(id)));
    assert.equal(new Set(result.slice(0, 3)).size, 3);
  });

  await test('Active membership in queue tenant preserves legitimate multi-organization recipient', async () => {
    const q = await makeQueue(db), lead = await makeLead(db, q, q.users[0]);
    await db.query('update public.users set organization_id=$1 where id=$2', [randomUUID(), q.users[1]]);
    assert.equal((await preview(db, q, lead, q.users[0])).user_id, q.users[1]);
    assert.equal((await canonical(db, q, lead)).assigned_user_id, q.users[1]);
  });
}

export async function runConcurrencyCases({ db, sessions, pids, test, report }) {
  await test('Eight simultaneous canonical calls with one idempotency key commit exactly one transfer', async () => {
    const q = await makeQueue(db), lead = await makeLead(db, q, q.users[0]), key = randomUUID();
    await db.query('begin');
    await db.query('select id from public.leads where id=$1 for update', [lead]);
    const work = sessions.map(session => canonical(session, q, lead, key));
    await observeWait(db, pids, report, 'same-lead-same-idempotency');
    await db.query('commit');
    const results = await Promise.all(work);
    assert.ok(results.every(result => result.assigned_user_id === q.users[1]));
    assert.equal(new Set(results.map(result => result.distribution_event_id)).size, 1);
    assert.equal(Number((await db.query('select count(*) from public.assignments_log where lead_id=$1', [lead])).rows[0].count), 2);
    assert.equal((await canonical(db, q, lead)).assigned_user_id, q.users[2]);
  });

  await test('Eight independent transfers on one lead serialize full ordered rounds', async () => {
    const q = await makeQueue(db), lead = await makeLead(db, q, q.users[0]);
    await db.query('begin');
    await db.query('select id from public.leads where id=$1 for update', [lead]);
    const work = sessions.map(session => canonical(session, q, lead));
    await observeWait(db, pids, report, 'same-lead-distinct-transfers');
    await db.query('commit');
    const results = await Promise.all(work);
    assert.equal(new Set(results.map(result => result.distribution_event_id)).size, 8);
    const committed = (await db.query(`select assigned_user_id from public.assignments_log where lead_id=$1
      and old_user_id is not null order by created_at,id`, [lead])).rows.map(row => row.assigned_user_id);
    assert.deepEqual(committed, [...q.users.slice(1), q.users[0], ...q.users.slice(1, 4)]);
  });

  await test('Concurrent initial weighted ingress allocates unique actual PostgreSQL tickets', async () => {
    const q = await makeQueue(db, { weighted: true });
    const leads = [];
    for (let n = 0; n < 16; n++) leads.push(await makeLead(db, q));
    const results = [];
    for (let offset = 0; offset < 16; offset += 8) results.push(...await Promise.all(sessions.map((session, n) =>
      canonical(session, q, leads[offset + n], randomUUID(), true))));
    assert.equal(new Set(results.map(result => result.distribution_ticket)).size, 16);
    assert.deepEqual(q.users.map(user => ids(results).filter(id => id === user).length), [8, 2, 2, 2, 2]);
  });

  await test('Eight initial ingresses create one cold sequence without duplicate creation and retain weights', async () => {
    // makeQueue eagerly creates the template queue's sequence. Reuse only its
    // organization, users and pipeline; this distinct target queue stays cold.
    const template = await makeQueue(db, { weighted: true });
    const q = { ...template, queue: randomUUID(), members: template.users.map(() => randomUUID()) };
    await db.query(`insert into public.round_robins(id,organization_id,strategy,settings,target_pipeline_id,target_stage_id)
      values($1,$2,'weighted',$3,$4,$5)`, [q.queue, q.org,
      { timezone: 'UTC', enable_redistribution: true }, q.pipeline, q.stage]);
    for (let n = 0; n < q.users.length; n++) await db.query(`insert into public.round_robin_members
      (id,organization_id,round_robin_id,user_id,position,weight) values($1,$2,$3,$4,$5,$6)`,
    [q.members[n], q.org, q.queue, q.users[n], n, n === 0 ? 4 : 1]);
    const sequenceName = (await db.query('select private.round_robin_ticket_sequence_name($1) as name', [q.queue])).rows[0].name;
    assert.equal((await db.query("select to_regclass(format('private.%I',$1::text)) as existing", [sequenceName])).rows[0].existing, null);
    const leads = [];
    for (let n = 0; n < 8; n++) leads.push(await makeLead(db, q));
    const results = await Promise.all(sessions.map((session, n) => canonical(session, q, leads[n], randomUUID(), true)));
    assert.ok(results.every(result => result.success), JSON.stringify(results));
    assert.equal(new Set(results.map(result => result.distribution_ticket)).size, 8);
    assert.deepEqual(results.map(result => Number(result.distribution_ticket)).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(q.users.map(user => ids(results).filter(id => id === user).length), [4, 1, 1, 1, 1]);
    assert.equal(Number((await db.query(`select count(*) from pg_class relation join pg_namespace namespace
      on namespace.oid=relation.relnamespace where namespace.nspname='private' and relation.relname=$1
      and relation.relkind='S'`, [sequenceName])).rows[0].count), 1);
    report.coldSequenceBootstrap = { independentSessions: 8, fixtureEnsureCallsForTarget: 0,
      sequenceExistedBeforeCalls: false, uniqueTickets: 8, weights: [4, 1, 1, 1, 1] };
  });
}
