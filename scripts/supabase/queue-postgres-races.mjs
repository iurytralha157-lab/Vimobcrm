import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seed, runtime, claim, step, expire, snapshot, armBarrier, releaseBarrier, waitForBlocked, parkOtherWork, newLead, distribute } from './queue-postgres-fixture.mjs';

// The test trigger only pauses after the real ownership guard. It does not
// change eligibility, authorization, ownership, or the production functions.
async function interleave({ db, a, b, pidA, pidB, key, operation, mutation }) {
  await armBarrier(db, a, key);
  const pending = operation().then(result => ({ result }), error => ({ error }));
  const polling = new AbortController();
  let changed;
  try {
    await waitForBlocked(db, pidA, 'assignment paused after production guard');
    changed = mutation().then(result => ({ result }), error => ({ error }));
    const observed = await Promise.race([
      changed.then(result => ({ ...result, serialized: false })),
      waitForBlocked(db, pidB, 'conflicting writer serialized with assignment', polling.signal).then(lock => ({ serialized: Boolean(lock) })),
    ]);
    polling.abort();
    await db.query('select pg_advisory_unlock($1)', [key]);
    const assigned = await pending, change = await changed;
    return { ...assigned, serialized: observed.serialized, mutationError: change.error };
  } finally {
    polling.abort();
    await releaseBarrier(db, a, key);
    await pending;
    if (changed) await changed;
  }
}

export async function runRaceCases({ observer: db, sessions, pids, test }) {
  const [a, b] = sessions;
  await test('revoked recipient before distribution is excluded from selection', async () => {
    const f = await seed(db), owner = (await snapshot(db, f)).owner;
    const next = f.users[(f.users.indexOf(owner) + 1) % f.users.length];
    await b.query('update public.organization_members set is_active=false where organization_id=$1 and user_id=$2', [f.org, next]);
    await expire(db, f); assert.equal((await step(a, f)).reason, 'assigned');
    assert.notEqual((await snapshot(db, f)).owner, next);
  });

  await test('recipient revocation during decision serializes or prevents inactive assignment', async () => {
    const f = await seed(db), owner = (await snapshot(db, f)).owner;
    const next = f.users[(f.users.indexOf(owner) + 1) % f.users.length]; await expire(db, f);
    const result = await interleave({ db, a, b, pidA: pids[0], pidB: pids[1], key: 811011,
      operation: () => step(a, f), mutation: () => b.query('update public.organization_members set is_active=false where organization_id=$1 and user_id=$2', [f.org, next]) });
    if (result.mutationError) {
      assert.equal(result.mutationError.code, '55P03');
      assert.equal((await db.query('select is_active from public.organization_members where organization_id=$1 and user_id=$2', [f.org, next])).rows[0].is_active, true);
      assert.equal(result.result.reason, 'assigned'); return;
    }
    if (result.error) { assert.ok(['23514', '40001', '55P03'].includes(result.error.code)); return; }
    assert.ok(result.serialized || (await snapshot(db, f)).owner !== next,
      'Recipient removal committed while assignment was paused; assignment subsequently committed to inactive member');
  });

  await test('queue membership removal during decision serializes or prevents removed assignment', async () => {
    const f = await seed(db), owner = (await snapshot(db, f)).owner;
    const next = f.users[(f.users.indexOf(owner) + 1) % f.users.length]; await expire(db, f);
    const result = await interleave({ db, a, b, pidA: pids[0], pidB: pids[1], key: 811012,
      operation: () => step(a, f), mutation: () => b.query('update public.round_robin_members set is_active=false where organization_id=$1 and round_robin_id=$2 and user_id=$3', [f.org, f.queue, next]) });
    if (result.mutationError) {
      assert.equal(result.mutationError.code, '55P03');
      assert.equal((await db.query('select is_active from public.round_robin_members where round_robin_id=$1 and user_id=$2', [f.queue, next])).rows[0].is_active, true);
      assert.equal(result.result.reason, 'assigned'); return;
    }
    if (result.error) { assert.ok(['23514', '40001', '55P03'].includes(result.error.code)); return; }
    assert.ok(result.serialized || (await snapshot(db, f)).owner !== next,
      'Queue member removal committed before assignment, but removed candidate received the lead');
  });

  await test('claim actor revocation during decision serializes or prevents inactive claim', async () => {
    const f = await seed(db, { pool: true }), r = await runtime(db, f), actor = f.users[0];
    const result = await interleave({ db, a, b, pidA: pids[0], pidB: pids[1], key: 811013,
      operation: () => claim(a, f, actor, 'revoking-claim', r),
      mutation: () => b.query('update public.organization_members set is_active=false where organization_id=$1 and user_id=$2', [f.org, actor]) });
    if (result.mutationError) {
      assert.equal(result.mutationError.code, '55P03');
      assert.equal((await db.query('select is_active from public.organization_members where organization_id=$1 and user_id=$2', [f.org, actor])).rows[0].is_active, true);
      assert.equal(result.result.reason, 'claimed'); return;
    }
    if (result.error) { assert.ok(['23514', '40001', '55P03'].includes(result.error.code)); return; }
    assert.ok(result.serialized || !result.result.success,
      'Actor revocation committed before claim ownership, yet inactive actor claimed the pool');
  });

  await test('human first response committed before worker protects the current assignment', async () => {
    const f = await seed(db), owner = (await snapshot(db, f)).owner;
    await b.query(`insert into public.lead_timeline_events(organization_id,lead_id,user_id,actor_user_id,event_type,metadata,event_at)
      values($1,$2,$3,$3,'first_response','{"is_automation":false}',clock_timestamp())`, [f.org, f.lead, owner]);
    await expire(db, f); assert.equal((await step(a, f)).reason, 'queue_protected');
    assert.equal((await snapshot(db, f)).owner, owner);
  });

  await test('human action arriving during decision serializes or preserves the contacted assignment', async () => {
    const f = await seed(db), owner = (await snapshot(db, f)).owner; await expire(db, f);
    const result = await interleave({ db, a, b, pidA: pids[0], pidB: pids[1], key: 811014,
      operation: () => step(a, f), mutation: () => b.query(`insert into public.lead_timeline_events(organization_id,lead_id,user_id,actor_user_id,event_type,metadata,event_at)
        values($1,$2,$3,$3,'first_response','{"is_automation":false}',clock_timestamp())`, [f.org, f.lead, owner]) });
    if (result.mutationError) throw result.mutationError;
    if (result.error) { assert.ok(['23514', '40001', '55P03'].includes(result.error.code)); return; }
    assert.ok(result.serialized || (await snapshot(db, f)).owner === owner,
      'Confirmed current-owner first_response committed before ownership update but the worker still reassigned');
  });

  await test('initial intake and concurrent recipient revocation preserve one valid decision', async () => {
    const f = await seed(db), lead = await newLead(db, f), next = f.users[1];
    const result = await interleave({ db, a, b, pidA: pids[0], pidB: pids[1], key: 811015,
      operation: () => distribute(a, f, lead, 'initial-revocation-race'),
      mutation: () => b.query('update public.organization_members set is_active=false where organization_id=$1 and user_id=$2', [f.org, next]) });
    if (result.mutationError) {
      assert.equal(result.mutationError.code, '55P03');
      assert.equal((await db.query('select is_active from public.organization_members where organization_id=$1 and user_id=$2', [f.org, next])).rows[0].is_active, true);
      assert.equal(result.result.reason, 'assigned'); return;
    }
    if (result.error) { assert.ok(['23514', '40001', '55P03'].includes(result.error.code)); return; }
    assert.ok(result.serialized || result.result.assigned_user_id !== next);
  });

  await test('global user deactivation cannot commit during recipient assignment', async () => {
    const f = await seed(db), next = f.users[1]; await expire(db, f);
    const result = await interleave({ db, a, b, pidA: pids[0], pidB: pids[1], key: 811016,
      operation: () => step(a, f), mutation: () => b.query('update public.users set is_active=false where id=$1', [next]) });
    if (result.mutationError) {
      assert.equal(result.mutationError.code, '55P03');
      assert.equal((await db.query('select is_active from public.users where id=$1', [next])).rows[0].is_active, true); return;
    }
    if (result.error) { assert.ok(['23514', '40001', '55P03'].includes(result.error.code)); return; }
    assert.ok(result.serialized || result.result.assigned_user_id !== next);
  });

  await test('lead_operate denial during claim is rejected atomically; committed denial blocks replay', async () => {
    const f = await seed(db, { pool: true }), r = await runtime(db, f), actor = f.users[0];
    const result = await interleave({ db, a, b, pidA: pids[0], pidB: pids[1], key: 811017,
      operation: () => claim(a, f, actor, 'permission-race', r),
      mutation: () => b.query("insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed) values($1,$2,'lead_operate',false)", [f.org, actor]) });
    assert.equal(result.mutationError?.code, '55P03'); assert.equal(result.result.reason, 'claimed');
    assert.equal((await db.query('select count(*) n from public.user_permission_overrides where organization_id=$1 and user_id=$2', [f.org, actor])).rows[0].n, '0');
    await b.query("insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed) values($1,$2,'lead_operate',false)", [f.org, actor]);
    assert.equal((await claim(a, f, actor, 'permission-race', r)).reason, 'forbidden');
  });

  await test('legacy role-permission row without tenant still locks the role organization queue', async () => {
    const f = await seed(db, { pool: true }), r = await runtime(db, f), legacyRole = randomUUID();
    await db.query('insert into public.organization_roles(id,organization_id,name) values($1,$2,$3)', [legacyRole, f.org, 'Synthetic historical role']);
    await db.query("insert into public.organization_role_permissions(organization_role_id,permission_key) values($1,'lead_operate')", [legacyRole]);
    const result = await interleave({ db, a, b, pidA: pids[0], pidB: pids[1], key: 811018,
      operation: () => claim(a, f, f.users[0], 'legacy-role-gate', r),
      mutation: () => b.query('delete from public.organization_role_permissions where organization_role_id=$1', [legacyRole]) });
    assert.equal(result.mutationError?.code, '55P03'); assert.equal(result.result.reason, 'claimed');
    assert.equal((await db.query('select count(*) n from public.organization_role_permissions where organization_role_id=$1', [legacyRole])).rows[0].n, '1');
  });

  await test('permission catalog wildcard cannot change while its queue claim is in flight', async () => {
    const f = await seed(db, { pool: true }), r = await runtime(db, f), actor = f.users[0];
    await db.query("insert into public.organization_role_permissions(organization_id,role_id,permission_id,permission_key) values($1,$2,(select id from public.available_permissions where key='*'),'*')", [f.org, f.role]);
    await db.query("insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed) values($1,$2,'lead_operate',false)", [f.org, actor]);
    const result = await interleave({ db, a, b, pidA: pids[0], pidB: pids[1], key: 811019,
      operation: () => claim(a, f, actor, 'permission-catalog-race', r),
      mutation: () => b.query("update public.available_permissions set key='synthetic_revoked_wildcard' where key='*'") });
    assert.equal(result.mutationError?.code, '55P03'); assert.equal(result.result.reason, 'claimed');
    assert.equal((await db.query("select count(*) n from public.available_permissions where key='*'")).rows[0].n, '1');
    assert.equal((await db.query("select count(*) n from public.available_permissions where key='synthetic_revoked_wildcard'")).rows[0].n, '0');
  });

  await test('profile super-admin revocation cannot bypass a denied claim permission mid-command', async () => {
    const f = await seed(db, { pool: true }), r = await runtime(db, f), actor = f.users[0];
    await db.query("update public.users set role='super_admin' where id=$1", [actor]);
    await db.query("insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed) values($1,$2,'lead_operate',false)", [f.org, actor]);
    const result = await interleave({ db, a, b, pidA: pids[0], pidB: pids[1], key: 811020,
      operation: () => claim(a, f, actor, 'profile-role-race', r), mutation: () => b.query("update public.users set role='user' where id=$1", [actor]) });
    assert.equal(result.mutationError?.code, '55P03'); assert.equal(result.result.reason, 'claimed');
    assert.equal((await db.query('select role from public.users where id=$1', [actor])).rows[0].role, 'super_admin');
    await b.query("update public.users set role='user' where id=$1", [actor]);
    assert.equal((await claim(a, f, actor, 'profile-role-race', r)).reason, 'forbidden');
  });

  await test('failed batch item retries are bounded and quarantine does not consume ownership budget', async () => {
    const f = await seed(db); await parkOtherWork(db, f); await expire(db, f); const before = await snapshot(db, f);
    await a.query("select set_config('queue_homologation.fail_notification','yes',false)");
    try {
      for (let n = 0; n < 5; n++) {
        await db.query('update private.queue_lead_runtime set next_action_at=clock_timestamp()-interval \'1 second\' where organization_id=$1 and lead_id=$2', [f.org, f.lead]);
        const response = (await a.query('select private.process_queue_runtime_batch(500,clock_timestamp()) result')).rows[0].result;
        assert.ok(response.failed >= 1);
      }
    } finally { await a.query("select set_config('queue_homologation.fail_notification','',false)"); }
    const after = await snapshot(db, f);
    assert.equal(after.owner, before.owner); assert.equal(after.runtime.assignment_count, before.runtime.assignment_count);
    assert.equal(after.visits, before.visits); assert.equal(after.notifications, before.notifications);
    assert.equal(after.runtime.retry_count, 5); assert.ok(after.runtime.quarantined_at); assert.equal(after.runtime.next_action_at, null);
    const events = await db.query("select count(*) n from private.queue_runtime_events where organization_id=$1 and event_type='runtime_quarantined'", [f.org]);
    assert.equal(events.rows[0].n, '1');
  });

  await test('post-revocation claim replay cannot restore a receipt or disclose another owner', async () => {
    const f = await seed(db, { pool: true }), r = await runtime(db, f), actor = f.users[0];
    assert.equal((await claim(a, f, actor, 'revoked-replay', r)).reason, 'claimed');
    await b.query('update public.organization_members set is_active=false where organization_id=$1 and user_id=$2', [f.org, actor]);
    assert.equal((await claim(a, f, actor, 'revoked-replay', r)).reason, 'forbidden');
    await b.query('update public.organization_members set is_active=true where organization_id=$1 and user_id=$2', [f.org, actor]);
    await b.query('begin');
    assert.equal((await b.query('select private.prepare_queue_manual_transfer($1,$2,$3,$4) allowed', [f.org, f.lead, actor, f.users[1]])).rows[0].allowed, true);
    await b.query('update public.leads set assigned_user_id=$3,assigned_at=clock_timestamp() where organization_id=$1 and id=$2', [f.org, f.lead, f.users[1]]);
    await b.query('commit');
    assert.equal((await claim(a, f, actor, 'revoked-replay', r)).reason, 'revision_conflict');
  });

  await test('busy queue in a two-queue bulk membership change rolls back every row and lock', async () => {
    const f = await seed(db), second = { ...f, queue: randomUUID(), lead: randomUUID() };
    await db.query('insert into public.round_robins(id,organization_id,settings) select $2,organization_id,settings from public.round_robins where id=$1', [f.queue, second.queue]);
    await db.query(`insert into public.round_robin_members(id,organization_id,round_robin_id,user_id,position,membership_generation)
      select gen_random_uuid(),organization_id,$2,user_id,position,membership_generation from public.round_robin_members where round_robin_id=$1`, [f.queue, second.queue]);
    await newLead(db, second, second.lead); assert.equal((await distribute(db, second)).reason, 'assigned');
    await a.query('begin'); assert.equal((await step(a, second, { force: true })).reason, 'assigned');
    await b.query('begin');
    await assert.rejects(b.query('update public.organization_members set is_active=false where organization_id=$1 and user_id=any($2::uuid[])', [f.org, f.users.slice(0, 3)]),
      error => error.code === '55P03' && error.message === 'queue_membership_busy_retry');
    await b.query('rollback'); await a.query('commit');
    assert.equal((await db.query('select count(*) n from public.organization_members where organization_id=$1 and not is_active', [f.org])).rows[0].n, '0');
    assert.equal((await step(b, f, { force: true })).reason, 'assigned', 'failed bulk writer released all queue locks');
  });

  await test('capability lock in one organization does not block unrelated tenant deactivation', async () => {
    const one = await seed(db), two = await seed(db);
    await a.query('begin'); assert.equal((await step(a, one, { force: true })).reason, 'assigned');
    await b.query('update public.organization_members set is_active=false where organization_id=$1 and user_id=$2', [two.org, two.users[0]]);
    assert.equal((await db.query('select is_active from public.organization_members where organization_id=$1 and user_id=$2', [two.org, two.users[0]])).rows[0].is_active, false);
    await a.query('commit');
  });

  await test('membership restoration cannot reactivate an old generation queue participant', async () => {
    const f = await seed(db), user = f.users[1];
    await db.query('update public.organization_members set deleted_at=clock_timestamp(),is_active=false where organization_id=$1 and user_id=$2', [f.org, user]);
    await db.query('update public.organization_members set deleted_at=null,is_active=true where organization_id=$1 and user_id=$2', [f.org, user]);
    assert.equal((await db.query('select count(*) n from private.queue_runtime_members($1,$2,clock_timestamp()) where user_id=$3', [f.org, f.queue, user])).rows[0].n, '0');
    await db.query('update public.round_robin_members set is_active=true where round_robin_id=$1 and user_id=$2', [f.queue, user]);
    assert.equal((await db.query('select count(*) n from private.queue_runtime_members($1,$2,clock_timestamp()) where user_id=$3', [f.org, f.queue, user])).rows[0].n, '1');
  });

  await test('human fact gate preserves legacy writes without waiting on a managed lifecycle lock', async () => {
    const f = await seed(db), legacy = randomUUID(), lead = randomUUID();
    await db.query("insert into public.round_robins(id,organization_id,settings) values($1,$2,'{}')", [legacy, f.org]);
    await db.query('insert into public.leads(id,organization_id,origin_round_robin_id,assigned_user_id) values($1,$2,$3,$4)', [lead, f.org, legacy, f.users[0]]);
    await a.query('begin'); await a.query('select id from public.leads where id=$1 for no key update', [lead]);
    await b.query(`insert into public.lead_timeline_events(organization_id,lead_id,user_id,actor_user_id,event_type,metadata,event_at)
      values($1,$2,$3,$3,'first_response','{"is_automation":false}',clock_timestamp())`, [f.org, lead, f.users[0]]);
    await a.query('commit');
    assert.equal((await db.query('select count(*) n from private.queue_lead_runtime where lead_id=$1', [lead])).rows[0].n, '0');
  });

  await test('derived assignment-cycle cache writes do not invert lead-to-cycle allocation locks', async () => {
    const f = await seed(db), cycle = randomUUID(), owner = (await snapshot(db, f)).owner;
    await db.query('insert into public.lead_assignment_cycles(id,organization_id,lead_id,assigned_user_id,assigned_at) values($1,$2,$3,$4,clock_timestamp())',
      [cycle, f.org, f.lead, owner]);
    await a.query('begin'); await b.query('begin');
    await a.query('select id from public.leads where id=$1 for no key update', [f.lead]);
    const polling = new AbortController();
    const cacheWrite = b.query('update public.lead_assignment_cycles set first_human_outreach_at=clock_timestamp() where id=$1', [cycle])
      .then(result => ({ result }), error => ({ error }));
    const observed = await Promise.race([cacheWrite.then(result => ({ ...result, blocked: false })),
      waitForBlocked(db, pids[1], 'cycle-cache writer must not acquire lead after its cycle row', polling.signal).then(lock => ({ blocked: Boolean(lock) }))]);
    polling.abort();
    if (observed.blocked) {
      const allocationWrite = a.query('update public.lead_assignment_cycles set ended_at=clock_timestamp() where id=$1', [cycle])
        .then(result => ({ result }), error => ({ error }));
      const first = await Promise.race([allocationWrite.then(result => ({ ...result, connection: a })), cacheWrite.then(result => ({ ...result, connection: b }))]);
      if (first.error) await first.connection.query('rollback');
      const results = await Promise.all([allocationWrite, cacheWrite]);
      await a.query('rollback'); await b.query('rollback');
      const deadlock = results.find(result => result.error?.code === '40P01');
      if (deadlock) throw deadlock.error;
      assert.fail('Cycle-cache writer unexpectedly acquired the managed lead lock');
    }
    if (observed.error) throw observed.error;
    await b.query('commit');
    await a.query('update public.lead_assignment_cycles set ended_at=clock_timestamp() where id=$1', [cycle]);
    await a.query('commit');
    assert.equal((await db.query('select private.queue_runtime_has_human_activity($1,$2,$3) active', [f.org, f.lead, (await runtime(db, f)).baseline_at])).rows[0].active, false,
      'Derived cache alone is not confirmed human contact');
  });
}
