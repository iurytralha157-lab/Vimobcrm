import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Explicit, already-owned disposable loopback server only. Never starts a
// service, reads application env/DSNs or creates cluster-wide roles.
const port = Number(process.argv[2]);
assert.ok(Number.isInteger(port) && port >= 20000 && port <= 65535,
  'Pass the explicitly authorized disposable PostgreSQL loopback port');
const database = `vimob_feedback_command_${randomBytes(6).toString('hex')}`;
const settings = { host: '127.0.0.1', port, user: 'postgres', database: 'postgres',
  connectionTimeoutMillis: 5000, query_timeout: 10000 };
const admin = new pg.Client(settings);
let db, created = false, checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const root = new URL('../../', import.meta.url);
const source = (await Promise.all(['lead_feedback.go', 'lead_feedback_receipts.go']
  .map(file => readFile(new URL(`apps/api/internal/leads/${file}`, root), 'utf8')))).join('\n');
const statements = Array.from(source.matchAll(/`([^`]+)`/g), match => match[1]);
const sql = fragment => {
  const matches = statements.filter(value => value.includes(fragment));
  assert.equal(matches.length, 1, `Exactly one actual Go SQL statement: ${fragment}`);
  return matches[0];
};
const claimSQL = sql('insert into private.lead_feedback_command_receipts');
const readSQL = sql('from private.lead_feedback_command_receipts');
const updateSQL = sql('update public.leads');
const auditSQL = sql('insert into public.audit_logs');
const activitySQL = sql('insert into public.activities');
const finishSQL = sql('update private.lead_feedback_command_receipts');
const orgA = '10000000-0000-4000-8000-000000000001';
const orgB = '10000000-0000-4000-8000-000000000002';
const actorA = '20000000-0000-4000-8000-000000000001';
const actorB = '20000000-0000-4000-8000-000000000002';
const leadA = '30000000-0000-4000-8000-000000000001';
const leadB = '30000000-0000-4000-8000-000000000002';
const command = '40000000-0000-4000-8000-000000000001';
const command2 = '40000000-0000-4000-8000-000000000002';
const command3 = '40000000-0000-4000-8000-000000000003';

// SQL/schema complement to the Go kernel's synthetic-transport tests. The Go
// middleware and current lead authorization are tested there, not reimplemented
// or claimed as verified by this isolated SQL fixture.
async function record(org, actor, lead, key, content, failAfterActivity = false) {
  const digest = createHash('sha256').update(JSON.stringify(['lead-feedback:v1', lead, content])).digest('hex');
  await db.query('begin');
  try {
    const before = await db.query('select feedback from public.leads where organization_id=$1 and id=$2 for no key update', [org, lead]);
    if (!before.rowCount) throw new Error('not found');
    const inserted = await db.query(claimSQL, [org, actor, key, lead, digest]);
    const receipt = (await db.query(readSQL, [org, actor, key])).rows[0];
    if (receipt.payload_sha256 !== digest || receipt.lead_id !== lead) throw new Error('conflict');
    if (receipt.activity_id && receipt.recorded_at) {
      await db.query('commit');
      return receipt;
    }
    if (inserted.rowCount !== 1) throw new Error('unavailable');
    await db.query(updateSQL, [org, lead, content]);
    if (before.rows[0].feedback !== content) {
      await db.query(auditSQL, [org, actor, lead, { feedback: before.rows[0].feedback }, { feedback: content }]);
    }
    const activity = (await db.query(activitySQL, [org, lead, actor, content])).rows[0];
    if (failAfterActivity) throw new Error('rollback');
    check((await db.query(finishSQL, [org, actor, key, digest, activity.id, activity.created_at])).rowCount === 1,
      'receipt completion is unique');
    await db.query('commit');
    return { ...receipt, activity_id: activity.id, recorded_at: activity.created_at };
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}

try {
  await admin.connect();
  const roles = await admin.query("select rolname from pg_roles where rolname in ('anon','authenticated','service_role')");
  assert.equal(roles.rowCount, 3, 'Disposable server must already contain Supabase fixture roles; none are created here');
  await admin.query(`create database "${database}"`); created = true;
  db = new pg.Client({ ...settings, database }); await db.connect();
  await db.query(`
    create schema private;
    create table public.leads(id uuid primary key, organization_id uuid not null, feedback text, updated_at timestamptz default now());
    create table public.activities(id uuid primary key default gen_random_uuid(),organization_id uuid,lead_id uuid,user_id uuid,type text,content text,metadata jsonb,created_at timestamptz default now());
    create table public.audit_logs(organization_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,old_data jsonb,new_data jsonb);
  `);
  await db.query(await readFile(new URL('supabase/migrations/20261017053625_add_lead_feedback_command_receipts.sql', root), 'utf8'));
  await db.query('insert into public.leads(id,organization_id) values($1,$2),($3,$4)', [leadA, orgA, leadB, orgB]);
  const first = await record(orgA, actorA, leadA, command, 'First synthetic note');
  const replay = await record(orgA, actorA, leadA, command, 'First synthetic note');
  check(first.activity_id === replay.activity_id, 'equal replay returns the same receipt');
  await assert.rejects(record(orgA, actorA, leadA, command, 'Different synthetic note'), /conflict/); checks++;
  await record(orgA, actorA, leadA, command2, 'Newer synthetic note');
  await db.query('delete from public.activities where id=$1', [first.activity_id]);
  const tombstone = await record(orgA, actorA, leadA, command, 'First synthetic note');
  check(tombstone.activity_id === first.activity_id, 'deleted activity never recreated by replay');
  check((await db.query('select feedback from public.leads where id=$1', [leadA])).rows[0].feedback === 'Newer synthetic note',
    'old retry never overwrites newer feedback');
  await record(orgB, actorA, leadB, command, 'Independent tenant note');
  await record(orgB, actorB, leadB, command, 'Independent actor note');
  check((await db.query('select count(*)::int as count from private.lead_feedback_command_receipts')).rows[0].count === 4,
    'receipt namespaces keep both tenants and actors');
  await assert.rejects(record(orgB, actorA, leadA, command3, 'Invalid cross-tenant reference'), /not found/); checks++;
  await assert.rejects(record(orgA, actorA, leadA, command3, 'Rolled back note', true), /rollback/); checks++;
  check((await db.query('select count(*)::int as count from private.lead_feedback_command_receipts where command_id=$1', [command3])).rows[0].count === 0,
    'rollback removes pending receipt and note together');
  await db.query('delete from public.leads where id=$1', [leadA]);
  await assert.rejects(record(orgA, actorA, leadA, command, 'First synthetic note'), /not found/); checks++;
  check((await db.query('select count(*)::int as count from private.lead_feedback_command_receipts where lead_id=$1', [leadA])).rows[0].count === 2,
    'receipt survives lead deletion');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      const allowed = await db.query('select has_table_privilege($1,$2,$3) as allowed', [role, 'private.lead_feedback_command_receipts', privilege]);
      check(!allowed.rows[0].allowed, 'browser and service roles have no receipt table grant');
    }
  }
  const security = await db.query("select relrowsecurity,pg_get_userbyid(relowner) as owner from pg_class where oid='private.lead_feedback_command_receipts'::regclass");
  check(security.rows[0].relrowsecurity && security.rows[0].owner === 'postgres', 'receipt is RLS-enabled and owner-controlled');
  console.log(`PASS ${checks} SQL fixture checks; actual Go mutation SQL and new migration, synthetic owned database only.`);
} catch (error) {
  const code = typeof error?.code === 'string' ? error.code : 'fixture_error';
  const databaseError = /^[0-9A-Z]{5}$/.test(code) && typeof error?.severity === 'string';
  const assertionError = code === 'ERR_ASSERTION';
  // This script only creates synthetic data in its random owned database.
  // SQL messages/assertion labels are useful; never dump Detail, query/params,
  // stack, connection errors, config or environment while diagnosing a fixture.
  const message = databaseError || assertionError
    ? String(error.message).replace(/\s+/g, ' ').slice(0, 500)
    : 'Non-SQL fixture failure; connection/configuration details omitted.';
  process.stderr.write(`Feedback SQL fixture failed [${code}]: ${message}\n`);
  process.exitCode = 1;
} finally {
  if (db) await db.end().catch(() => {});
  if (created) await admin.query(`drop database "${database}"`);
  await admin.end();
}
