// Explicit owned-PG fixture test. No provider transport is constructed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifiedClient } from './whatsapp-ci-fixture.mjs';

assert.equal(process.env.VIMOB_RUN_WHATSAPP_CI, 'LOCAL_WRITE_TEST');
assert.ok(process.env.VIMOB_WHATSAPP_CI_ROOT, 'owned fixture root required');
assert.ok(process.argv[2], 'explicit owning-host claim definition preimage required');
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const preimage = (await readFile(process.argv[2], 'utf8')).replace(/^\uFEFF/, '').replaceAll('\r', '');
const cutover = await readFile(path.join(repository, 'supabase/cutovers/20261117_prefilter_notification_blocked_push_claim.sql'), 'utf8');
const transactionBody = cutover.replace(/^\\.*$/gm, '').replace(/^begin;\s*$/gm, '').replace(/^commit;\s*$/gm, '');
const beforeMD5 = 'fd5d88955a50359567c13b09780ac644';
const afterMD5 = '5745e185e04aeafdde8d0486bed3de60';
const body = preimage.split('AS $function$')[1]?.split('$function$')[0];
assert.equal(createHash('md5').update(body || '').digest('hex'), beforeMD5);
const { client } = await verifiedClient(process.env.VIMOB_WHATSAPP_CI_ROOT);
const results = [];
async function check(name, fn) { await fn(); results.push({ name, result: 'pass' }); }
async function apply(direction) {
  assert.ok(['apply', 'rollback'].includes(direction));
  await client.query(transactionBody.replace(":'direction'", `'${direction}'`));
}
async function fingerprint() {
  return (await client.query(`select md5(replace(prosrc,chr(13),'')) body,
    to_jsonb(p)-array['prosrc','prosqlbody'] attributes
    from pg_proc p where oid='private.claim_notification_deliveries(text,integer,interval,text[])'::regprocedure`)).rows[0];
}
async function rejects(name, fn, expected) {
  await client.query('savepoint rejected_change');
  let error;
  try { await fn(); } catch (caught) { error = caught; }
  await client.query('rollback to savepoint rejected_change');
  assert.ok(error, `${name} unexpectedly succeeded`);
  assert.equal(error.message, expected);
  results.push({ name, result: 'pass' });
}
try {
  await client.query('begin');
  await client.query("set local statement_timeout='20s';set local lock_timeout='1s'");
  await client.query(preimage);
  const original = await fingerprint();
  await check('cutover applies exact postimage and preserves catalog contract', async () => {
    await apply('apply');
    const patched = await fingerprint();
    assert.equal(patched.body, afterMD5);
    assert.deepEqual(patched.attributes, original.attributes);
  });
  await rejects('repeat apply rejects drift', () => apply('apply'), 'notification_blocked_push_prefilter_preimage_drift');
  await check('rollback restores exact original body and attributes', async () => {
    await apply('rollback');
    assert.deepEqual(await fingerprint(), original);
  });
  await rejects('repeat rollback rejects drift', () => apply('rollback'), 'notification_blocked_push_prefilter_preimage_drift');
  await rejects('invalid direction rejects before DDL', async () => {
    await client.query(transactionBody.replace(":'direction'", "'invalid'"));
  }, 'notification_blocked_push_prefilter_invalid_preflight');
  await rejects('helper drift rejects before DDL', async () => {
    const { rows } = await client.query(`select pg_get_functiondef('private.whatsapp_inbound_push_is_unstarted(private.notification_deliveries)'::regprocedure) definition`);
    await client.query(rows[0].definition.replace('select p_delivery.channel', 'select /* synthetic drift */ p_delivery.channel'));
    await apply('apply');
  }, 'notification_blocked_push_prefilter_helper_drift');

  const ids = Object.fromEntries(['org', 'otherOrg', 'user', 'otherUser', 'session', 'lead', 'conversation', 'message', 'startedMessage',
    'notice', 'ordinaryNotice', 'startedNotice', 'foreignNotice'].map(key => [key, randomUUID()]));
  await client.query(`insert into public.organizations(id,name,is_active) values
    ($1,'Synthetic notification prefilter A',true),($2,'Synthetic notification prefilter B',true)`, [ids.org, ids.otherOrg]);
  for (const [org, user] of [[ids.org, ids.user], [ids.otherOrg, ids.otherUser]]) {
    await client.query(`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,
      raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values($1,'authenticated','authenticated',$2,'',now(),'{}','{}',now(),now())`, [user, `${user}@example.invalid`]);
    await client.query(`insert into public.users(id,organization_id,name,email,role,is_active)
      values($1,$2,'Synthetic prefilter user',$3,'admin',true) on conflict(id) do update
      set organization_id=excluded.organization_id,role='admin',is_active=true`, [user, org, `${user}@example.invalid`]);
    await client.query(`insert into public.organization_members(organization_id,user_id,role,is_active)
      values($1,$2,'admin',true) on conflict(user_id,organization_id) do update set role='admin',is_active=true,deleted_at=null`, [org, user]);
  }
  await client.query(`insert into public.whatsapp_sessions(id,organization_id,owner_user_id,instance_name,provider,status,is_active)
    values($1::uuid,$2::uuid,$3::uuid,$1::uuid::text,'evolution_go','connected',true)`, [ids.session, ids.org, ids.user]);
  await client.query(`insert into public.leads(id,organization_id,assigned_user_id,name,source)
    values($1,$2,$3,'Synthetic prefilter lead','manual')`, [ids.lead, ids.org, ids.user]);
  await client.query(`insert into public.whatsapp_conversations(id,organization_id,session_id,remote_jid,is_group)
    values($1,$2,$3,'5511998880001@s.whatsapp.net',false)`, [ids.conversation, ids.org, ids.session]);
  await client.query('select public.activate_whatsapp_conversation_lead_binding($1,$2,$3,null)', [ids.org, ids.conversation, ids.lead]);
  for (const messageID of [ids.message, ids.startedMessage]) {
    await client.query(`insert into public.whatsapp_messages(id,organization_id,conversation_id,session_id,lead_id,
    provider_message_id,message_id,from_me,direction,message_type,status,capture_state,sent_at)
    values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$1::uuid::text,$1::uuid::text,false,'inbound','text','received','suppressed',now())`,
    [messageID, ids.org, ids.conversation, ids.session, ids.lead]);
    await client.query("update public.whatsapp_messages set content='Synthetic historical body',capture_state='captured' where id=$1", [messageID]);
  }
  for (const [id, org, user, key, started] of [
    [ids.notice, ids.org, ids.user, 'whatsapp_inbound_attendant', false],
    [ids.ordinaryNotice, ids.org, ids.user, 'synthetic_ordinary', false],
    [ids.startedNotice, ids.org, ids.user, 'whatsapp_inbound_attendant', true],
    [ids.foreignNotice, ids.otherOrg, ids.otherUser, 'whatsapp_inbound_attendant', false],
  ]) {
    await client.query(`insert into public.notifications(id,organization_id,user_id,title,content,type,metadata)
      values($1,$2,$3,'Synthetic prefilter notification','Synthetic content','whatsapp',
        jsonb_build_object('event_key',$4::text,'whatsapp_message_id',$5::text,'whatsapp_inbound_provider_started',$6::boolean))`,
    [id, org, user, key, started ? ids.startedMessage : ids.message, started]);
  }
  // No attendance entry exists: the real installed reassignment helper must
  // admit an untouched push, so equality cannot pass vacuously with all false.
  const notices = [[ids.notice, ids.org], [ids.ordinaryNotice, ids.org], [ids.startedNotice, ids.org],
    [ids.foreignNotice, ids.otherOrg], [randomUUID(), ids.org]];
  const workers = ['legacy', 'synthetic|wa_push_v2', 'synthetic|lead_wa_general_v1|push_device_v3|wa_push_v2'];
  const scopes = [null, ['push'], ['whatsapp'], ['email'], ['push', 'whatsapp', 'email']];
  await check('differential eligibility channels states attempts expiry schedule tenant and worker scopes', async () => {
    const { rows } = await client.query(`with cases as materialized (
      select jsonb_populate_record(null::private.notification_deliveries,jsonb_build_object(
        'notification_id',notice.id,'organization_id',notice.org,'user_id',$3::uuid,
        'channel',channel,'status',status,'attempt_count',attempt,'max_attempts',24,
        'expires_at',now()+expiry*interval '1 hour','next_attempt_at',now()+schedule*interval '1 hour')) delivery
      from jsonb_to_recordset($1::jsonb) notice(id uuid,org uuid)
      cross join unnest(array['push','whatsapp','email']) channel
      cross join unnest(array['queued','retry_wait','blocked_dependency','leased','sending','accepted','delivered','cancelled','dead_letter','permanent_failed']) status
      cross join unnest(array[0,1]) attempt cross join unnest(array[-1,1]) expiry cross join unnest(array[-1,1]) schedule
    ), classified as materialized (
      select delivery,private.whatsapp_inbound_push_needs_reassignment(delivery) needs_reassignment from cases
    ), scoped as materialized (
      select delivery,needs_reassignment,worker,scope.channels from classified cross join unnest($2::text[]) worker
      cross join jsonb_to_recordset($4::jsonb) scope(channels text[])
    ), compared as (
      select (((delivery).status in('queued','retry_wait') and (delivery).next_attempt_at<=now())
        or(right(worker,11)='|wa_push_v2' and (delivery).status='blocked_dependency'
          and needs_reassignment))
        and (delivery).expires_at>now() and (delivery).attempt_count<(delivery).max_attempts
        and (channels is null or (delivery).channel=any(channels)) old_eligible,
      (((delivery).status in('queued','retry_wait') and (delivery).next_attempt_at<=now())
        or(right(worker,11)='|wa_push_v2' and (delivery).status='blocked_dependency'
          and (delivery).channel='push' and (delivery).attempt_count=0
          and needs_reassignment))
        and (delivery).expires_at>now() and (delivery).attempt_count<(delivery).max_attempts
        and (channels is null or (delivery).channel=any(channels)) new_eligible,
        needs_reassignment,
        (delivery).channel channel,(delivery).attempt_count attempts,(delivery).notification_id notification_id
      from scoped
    ) select count(*)::int cases,count(*)filter(where (old_eligible is true)<>(new_eligible is true))::int mismatches,
      count(*)filter(where needs_reassignment)::int true_reassignment,
      count(*)filter(where needs_reassignment and (channel<>'push' or attempts<>0))::int implication_violations,
      count(*)filter(where needs_reassignment and notification_id=any($5::uuid[]))::int forbidden_reassignment
      from compared`, [JSON.stringify(notices.map(([id, org]) => ({ id, org }))), workers, ids.user,
      JSON.stringify(scopes.map(channels => ({ channels }))),
      [ids.ordinaryNotice,ids.startedNotice,ids.foreignNotice,notices[4][0]]]);
    assert.equal(rows[0].cases, 18000);
    assert.equal(rows[0].mismatches, 0);
    assert.equal(rows[0].implication_violations, 0);
    assert.equal(rows[0].forbidden_reassignment, 0);
    assert.ok(rows[0].true_reassignment > 0);
    results.push({ name: 'differential-case-count', cases: rows[0].cases, trueReassignment: rows[0].true_reassignment });
  });
  await check('final apply still changes only guarded predicate and rollback stays exact', async () => {
    await apply('apply');
    assert.equal((await fingerprint()).body, afterMD5);
    await apply('rollback');
    assert.deepEqual(await fingerprint(), original);
  });
  await client.query('rollback');
  console.log(JSON.stringify({ results, rollback: true, providerTransports: 0, skips: 0 }));
} catch (error) {
  await client.query('rollback').catch(() => {});
  console.log(JSON.stringify({ results, rollback: true, error: error.message, code: error.code, position: error.position }));
  process.exitCode = 1;
} finally { await client.end(); }
