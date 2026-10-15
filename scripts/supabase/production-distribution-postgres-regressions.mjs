import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { makeQueue, makeLead, preview, canonical } from './production-distribution-postgres-fixture.mjs';

// Build before applying the candidate: these are real cold legacy records,
// without rotation state created by the new log trigger.
export async function prepareRegressionCases(db) {
  const now = new Date(), eventTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const clocks = [];
  for (const source of ['meta', 'whatsapp']) {
    const q = await makeQueue(db, { count: 3 }), team = randomUUID();
    await db.query('insert into public.teams(id,organization_id) values($1,$2)', [team, q.org]);
    await db.query('update public.round_robin_members set is_active=false where id=$1', [q.members[0]]);
    for (const n of [1, 2]) {
      const member = randomUUID();
      await db.query('insert into public.team_members(id,organization_id,team_id,user_id) values($1,$2,$3,$4)',
        [member, q.org, team, q.users[n]]);
      await db.query('update public.round_robin_members set team_id=$1 where id=$2', [team, q.members[n]]);
      await db.query(`insert into public.member_availability(organization_id,team_member_id,day_of_week,is_all_day)
        values($1,$2,$3,true)`, [q.org, member, n === 1 ? eventTime.getUTCDay() : now.getUTCDay()]);
    }
    clocks.push({ ...q, source, lead: await makeLead(db, q, q.users[0]), eventTime: eventTime.toISOString() });
  }
  const legacy = [];
  for (const reason of ['meta_lead_ads', 'grupo_olx']) {
    for (const solePrevious of [false, true]) {
      const q = await makeQueue(db, { count: 3 }), lead = await makeLead(db, q, q.users[0]);
      await db.query(`insert into public.round_robin_logs(organization_id,round_robin_id,lead_id,assigned_user_id,reason,metadata)
        values($1,$2,$3,$4,$5,jsonb_build_object('member_id',$6::uuid::text))`,
      [q.org, q.queue, lead, q.users[0], reason, q.members[0]]);
      await db.query('update public.leads set assigned_user_id=null where id=$1', [lead]);
      if (solePrevious) await db.query('update public.round_robin_members set is_active=false where id=any($1::uuid[])', [q.members.slice(1)]);
      legacy.push({ ...q, lead, reason, solePrevious });
    }
  }
  return { clocks, legacy };
}

export async function runRegressionCases({ db, prepared, test, report }) {
  for (const q of prepared.clocks) {
    await test(`Delayed ${q.source} event uses current eligibility and replays without a second transfer`, async () => {
      const key = randomUUID();
      const distribute = async () => (await db.query(`select private.distribute_lead($1,$2,$3,$4,false,$5,$6) result`,
        [q.org, q.lead, key, q.queue, q.source, q.eventTime])).rows[0].result;
      const first = await distribute(), replay = await distribute();
      assert.equal(first.success, true);
      assert.equal(first.assigned_user_id, q.users[2], 'Yesterday-only broker must not receive the transfer today');
      assert.equal(replay.assigned_user_id, first.assigned_user_id);
      assert.equal(replay.distribution_event_id, first.distribution_event_id);
      const { rows: [counts] } = await db.query(`select
        (select count(*) from public.round_robin_logs where lead_id=$1) as logs,
        (select count(*) from private.lead_distribution_events where lead_id=$1) as events`, [q.lead]);
      assert.equal(Number(counts.logs), 1); assert.equal(Number(counts.events), 1);
      report.regressionEvidence.push({ source: q.source, eventTime: q.eventTime, selectedIndex: 2,
        replaySameEvent: true, confirmedTransfers: Number(counts.logs) });
    });
  }
  for (const q of prepared.legacy) {
    await test(`Cold legacy ${q.reason} resume ${q.solePrevious ? 'accepts sole previous broker' : 'visits another eligible broker first'}`, async () => {
      const result = (await db.query(`select private.distribute_lead($1,$2,$3,$4,true,'test-legacy-resume',clock_timestamp()) result`,
        [q.org, q.lead, randomUUID(), q.queue])).rows[0].result;
      assert.equal(result.success, true);
      assert.equal(result.assigned_user_id, q.users[q.solePrevious ? 0 : 1]);
      assert.equal(result.algorithm_version, 'lead_queue_rotation_v1');
      assert.equal(result.distribution_ticket, null, 'Legacy resume must not consume a new-lead weighted ticket');
      if (!q.solePrevious) assert.equal((await preview(db, q, q.lead, q.users[1])).user_id, q.users[2]);
      report.regressionEvidence.push({ reason: q.reason, solePrevious: q.solePrevious,
        selectedIndex: q.solePrevious ? 0 : 1, algorithmVersion: result.algorithm_version });
    });
  }
  await runNotificationRegression({ db, test, report });
}

export async function runNotificationRegression({ db, test, report }) {
  await test('Production notification uniqueness permits two rounds and cold sole-owner resume while replay stays idempotent', async () => {
    const q = await makeQueue(db, { count: 3 }), lead = await makeLead(db, q, q.users[0]);
    const recipients = [];
    const transferAndReplay = async preserve => {
      const key = randomUUID(), first = await canonical(db, q, lead, key, preserve);
      const replay = await canonical(db, q, lead, key, preserve);
      assert.equal(first.success, true);
      assert.equal(replay.distribution_event_id, first.distribution_event_id);
      assert.equal(replay.assigned_user_id, first.assigned_user_id);
      recipients.push(first.assigned_user_id);
    };
    for (let n = 0; n < 6; n++) await transferAndReplay(false);
    assert.deepEqual(recipients, [q.users[1], q.users[2], q.users[0], q.users[1], q.users[2], q.users[0]]);
    await db.query('update public.leads set assigned_user_id=null where id=$1', [lead]);
    await db.query('delete from private.round_robin_rotation_state where organization_id=$1 and lead_id=$2', [q.org, lead]);
    await db.query('update public.round_robin_members set is_active=false where id=any($1::uuid[])', [q.members.slice(1)]);
    await transferAndReplay(true);
    assert.equal(recipients.at(-1), q.users[0]);
    const { rows: [counts] } = await db.query(`select
      (select count(*) from public.round_robin_logs where lead_id=$1) as logs,
      (select count(*) from private.lead_distribution_events where lead_id=$1) as events,
      count(*) as notices,count(distinct metadata->>'dedupe_key') as keys,
      bool_and(metadata->>'dedupe_key' like 'new_lead_received:%') as semantic_prefix
      from public.notifications where lead_id=$1`, [lead]);
    for (const key of ['logs', 'events', 'notices', 'keys']) assert.equal(Number(counts[key]), 7, key);
    assert.equal(counts.semantic_prefix, true);
    const newLead = await makeLead(db, q), initialKey = randomUUID();
    const initial = await canonical(db, q, newLead, initialKey, true);
    await canonical(db, q, newLead, initialKey, true);
    const { rows: initialNotices } = await db.query('select metadata from public.notifications where lead_id=$1', [newLead]);
    assert.equal(initialNotices.length, 1);
    assert.equal(initialNotices[0].metadata.dedupe_key, `new_lead_received:${newLead}:${initial.assigned_user_id}`);
    report.regressionEvidence.push({ notificationUniqueness: 'production index retained',
      orderedTransfers: 7, confirmedNotifications: 7, distinctKeys: 7, initialKeyUnchanged: true,
      replayDuplicates: 0, coldSolePreviousRecipient: true });
  });
}
