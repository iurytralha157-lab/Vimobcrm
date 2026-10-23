import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seed, newLead, distribute, runtime, claim, step, expire, snapshot, waitForBlocked,
  closedWeek, openWeek, parkOtherWork } from './queue-postgres-fixture.mjs';

export async function runConcurrencyCases({ observer: db, sessions, pids, test }) {
  const [a, b] = sessions;
  await test('eight simultaneous claimants: one owner, one receipt, one claim event', async () => {
    const f = await seed(db, { pool: true, count: 8 }), r = await runtime(db, f);
    const results = await Promise.all(sessions.map((session, n) => claim(session, f, f.users[n], `claim-${n}`, r)));
    assert.equal(results.filter(result => result.success).length, 1, JSON.stringify(results));
    const winner = results.find(result => result.success).assigned_user_id;
    const after = await snapshot(db, f);
    assert.equal(after.owner, winner); assert.equal(after.runtime.state, 'manual_protected');
    assert.equal((await db.query('select count(*) n from private.queue_pool_claim_receipts where organization_id=$1', [f.org])).rows[0].n, '1');
    assert.equal((await db.query("select count(*) n from private.queue_runtime_events where organization_id=$1 and event_type='manual_claim'", [f.org])).rows[0].n, '1');
  });

  await test('claim in flight: concurrent retry is busy; committed retry is idempotent', async () => {
    const f = await seed(db, { pool: true }), r = await runtime(db, f), key = randomUUID();
    await a.query('begin');
    assert.equal((await claim(a, f, f.users[0], key, r)).reason, 'claimed');
    assert.equal((await claim(b, f, f.users[0], key, r)).reason, 'queue_busy');
    await a.query('commit');
    const before = await snapshot(db, f);
    assert.equal((await claim(b, f, f.users[0], key, r)).reason, 'already_claimed');
    assert.deepEqual(await snapshot(db, f), before);
  });

  await test('same lead initial idempotency: observed row wait returns one durable result', async () => {
    const f = await seed(db), lead = await newLead(db, f), key = randomUUID();
    await a.query('begin');
    const first = await distribute(a, f, lead, key);
    const waiting = distribute(b, f, lead, key).then(result => ({ result }), error => ({ error }));
    await waitForBlocked(db, pids[1], 'same lead initial retry');
    await a.query('commit');
    const second = await waiting; if (second.error) throw second.error;
    assert.deepEqual(second.result, first);
    const { rows: [counts] } = await db.query(`select
      (select count(*) from private.lead_distribution_events where organization_id=$1 and lead_id=$2) events,
      (select count(*) from public.assignments_log where organization_id=$1 and lead_id=$2) assignments,
      (select count(*) from private.queue_round_visits where organization_id=$1 and lead_id=$2) visits`, [f.org, lead]);
    assert.deepEqual(counts, { events: '1', assignments: '1', visits: '1' });
  });

  await test('same tenant idempotency key on different leads: exactly one ledger owner', async () => {
    const f = await seed(db), l1 = await newLead(db, f), l2 = await newLead(db, f), key = randomUUID();
    await a.query('begin'); assert.equal((await distribute(a, f, l1, key)).reason, 'assigned');
    const waiting = distribute(b, f, l2, key).then(result => ({ result }), error => ({ error }));
    await waitForBlocked(db, pids[1], 'cross-lead unique ledger key');
    await a.query('commit'); const result = await waiting; if (result.error) throw result.error;
    assert.equal(result.result.reason, 'idempotency_key_conflict');
    assert.equal((await db.query('select assigned_user_id from public.leads where id=$1', [l2])).rows[0].assigned_user_id, null);
  });

  await test('two organizations share an idempotency key without crossing owners or pool ACL', async () => {
    const one = await seed(db), two = await seed(db), key = randomUUID();
    const leads = await Promise.all([newLead(db, one), newLead(db, two)]);
    const results = await Promise.all([distribute(a, one, leads[0], key), distribute(b, two, leads[1], key)]);
    assert.equal(results[0].reason, 'assigned'); assert.equal(results[1].reason, 'assigned');
    assert.ok(one.users.includes(results[0].assigned_user_id)); assert.ok(two.users.includes(results[1].assigned_user_id));
    const pool = await seed(db, { pool: true }), r = await runtime(db, pool);
    assert.equal((await claim(a, pool, one.users[0], key, r)).reason, 'forbidden');
    assert.equal((await db.query('select private.queue_pool_read_access($1,$2,$3) allowed', [pool.org, pool.lead, one.users[0]])).rows[0].allowed, false);
  });

  await test('same actor and claim key in two organizations produce independent receipts', async () => {
    const one = await seed(db, { pool: true }), two = await seed(db, { pool: true }), actor = one.users[0];
    await db.query('insert into public.organization_members(organization_id,user_id) values($1,$2)', [two.org, actor]);
    await db.query('insert into public.user_organization_roles(organization_id,user_id,role_id) values($1,$2,$3)', [two.org, actor, two.role]);
    await db.query('insert into public.round_robin_members(id,organization_id,round_robin_id,user_id,position) values($1,$2,$3,$4,20)',
      [randomUUID(), two.org, two.queue, actor]);
    const [r1, r2] = await Promise.all([runtime(db, one), runtime(db, two)]);
    const results = await Promise.all([claim(a, one, actor, 'same-cross-org-claim', r1), claim(b, two, actor, 'same-cross-org-claim', r2)]);
    assert.ok(results.every(result => result.reason === 'claimed'));
    assert.equal((await snapshot(db, one)).owner, actor); assert.equal((await snapshot(db, two)).owner, actor);
    assert.equal((await db.query('select count(*) n from private.queue_pool_claim_receipts where actor_id=$1', [actor])).rows[0].n, '2');
  });

  await test('parallel initial assignments in one weighted queue remain atomic', async () => {
    const f = await seed(db, { count: 3 }); await db.query("update public.round_robins set strategy='weighted' where id=$1", [f.queue]);
    await db.query('update public.round_robin_members set weight=3 where round_robin_id=$1 and user_id=$2', [f.queue, f.users[0]]);
    const leads = [];
    for (let n = 0; n < 30; n++) leads.push(await newLead(db, f));
    const received = new Map(f.users.map(user => [user, 0]));
    for (let start = 0; start < leads.length; start += sessions.length) {
      const results = await Promise.allSettled(leads.slice(start, start + sessions.length).map((lead, n) => distribute(sessions[n], f, lead)));
      for (const result of results) {
        if (result.status === 'rejected') throw result.reason;
        assert.equal(result.value.reason, 'assigned');
        received.set(result.value.assigned_user_id, received.get(result.value.assigned_user_id) + 1);
      }
    }
    assert.deepEqual(f.users.map(user => received.get(user)), [18, 6, 6], 'weights3:1:1 across six complete ticket cycles');
    assert.equal((await db.query('select count(*) n from private.queue_round_visits where organization_id=$1', [f.org])).rows[0].n, '31');
  });

  await test('first-ever queue tickets initialize one real sequence across eight connections', async () => {
    const f = await seed(db, { pool: true });
    await db.query("update public.round_robins set settings=jsonb_set(settings,'{operating_schedule}',$2) where id=$1", [f.queue, openWeek()]);
    const leads = [];
    for (let n = 0; n < sessions.length; n++) leads.push(await newLead(db, f));
    const results = await Promise.all(sessions.map((session, n) => distribute(session, f, leads[n])));
    assert.ok(results.every(result => result.reason === 'assigned'));
    const { rows: [tickets] } = await db.query(`select count(*) n,count(distinct distribution_ticket) unique_tickets,
      min(distribution_ticket)::text first,max(distribution_ticket)::text last from private.lead_distribution_events
      where organization_id=$1 and outcome='assigned'`, [f.org]);
    assert.deepEqual(tickets, { n: '8', unique_tickets: '8', first: '1', last: '8' });
  });

  await test('parallel due workers visit every available user before beginning another round', async () => {
    const f = await seed(db); await parkOtherWork(db, f);
    for (let n = 0; n < 9; n++) {
      await expire(db, f);
      const before = await runtime(db, f);
      const results = await Promise.all(sessions.map(session => session.query('select private.process_queue_runtime_batch(500,clock_timestamp()) result')));
      for (const { rows: [result] } of results) assert.equal(result.result.failed, 0);
      const after = await runtime(db, f); assert.equal(after.assignment_count, before.assignment_count + 1);
    }
    const { rows } = await db.query('select round_number,count(*) n from private.queue_round_visits where organization_id=$1 group by round_number order by round_number', [f.org]);
    assert.deepEqual(rows, [{ round_number: 1, n: '5' }, { round_number: 2, n: '5' }]);
  });

  await test('held lead is skipped by another worker without consuming a visit or budget', async () => {
    const f = await seed(db); await expire(db, f); const before = await runtime(db, f);
    await a.query('begin'); assert.equal((await step(a, f)).reason, 'assigned');
    assert.equal((await step(b, f)).reason, 'queue_busy');
    await a.query('commit');
    assert.equal((await runtime(db, f)).assignment_count, before.assignment_count + 1);
  });

  await test('queue config writer holds lock: intake cannot use the previous open calendar', async () => {
    const f = await seed(db), lead = await newLead(db, f);
    await a.query('begin');
    await a.query("update public.round_robins set settings=jsonb_set(settings,'{operating_schedule}',$2) where id=$1", [f.queue, closedWeek()]);
    await assert.rejects(distribute(b, f, lead), error => error.code === '55P03');
    await a.query('commit');
    assert.equal((await distribute(b, f, lead)).reason, 'queue_closed');
    assert.equal((await db.query('select assigned_user_id from public.leads where id=$1', [lead])).rows[0].assigned_user_id, null);
  });

  await test('assignment holds calendar snapshot: config update waits until assignment commits', async () => {
    const f = await seed(db), lead = await newLead(db, f);
    await a.query('begin'); assert.equal((await distribute(a, f, lead)).reason, 'assigned');
    const waiting = b.query("update public.round_robins set settings=jsonb_set(settings,'{operating_schedule}',$2) where id=$1", [f.queue, closedWeek()])
      .then(result => ({ result }), error => ({ error }));
    await waitForBlocked(db, pids[1], 'configuration writer behind active assignment');
    await a.query('commit'); const result = await waiting; if (result.error) throw result.error;
    const target = { ...f, lead }; assert.equal((await step(b, target)).reason, 'queue_closed');
    assert.equal((await snapshot(db, target)).owner, null);
  });

  await test('claim racing with reopening worker retains manual protection', async () => {
    const f = await seed(db, { pool: true }), r = await runtime(db, f);
    await db.query("update public.round_robins set settings=jsonb_set(settings,'{operating_schedule}',$2) where id=$1", [f.queue, openWeek()]);
    await a.query('begin'); assert.equal((await claim(a, f, f.users[0], 'open-claim', r)).reason, 'claimed');
    assert.equal((await step(b, f)).reason, 'queue_busy');
    await a.query('commit'); const before = await snapshot(db, f);
    assert.equal((await step(b, f, { force: true })).reason, 'queue_protected');
    assert.deepEqual(await snapshot(db, f), before);
  });

  await test('rollback after downstream failure conserves owner, SLA, visits, budget and outbox', async () => {
    const f = await seed(db); await expire(db, f); const before = await snapshot(db, f);
    await a.query("select set_config('queue_homologation.fail_notification','yes',false)");
    await assert.rejects(step(a, f), error => error.message.includes('synthetic_notification_failure'));
    await a.query("select set_config('queue_homologation.fail_notification','',false)");
    assert.deepEqual(await snapshot(db, f), before);
    assert.equal((await step(b, f)).reason, 'assigned');
    assert.equal((await runtime(db, f)).assignment_count, before.runtime.assignment_count + 1);
  });

  await test('transaction rollback after successful claim permits exactly one later claimant', async () => {
    const f = await seed(db, { pool: true }), r = await runtime(db, f), before = await snapshot(db, f);
    await a.query('begin'); assert.equal((await claim(a, f, f.users[0], 'rolled-back', r)).reason, 'claimed');
    await a.query('rollback'); assert.deepEqual(await snapshot(db, f), before);
    assert.equal((await claim(b, f, f.users[1], 'after-rollback', r)).reason, 'claimed');
    assert.equal((await snapshot(db, f)).owner, f.users[1]);
  });
}
