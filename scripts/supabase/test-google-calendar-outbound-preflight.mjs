import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const modulePath = process.argv[2];
if (!modulePath || !path.isAbsolute(modulePath)) {
  throw new Error('Pass the absolute path to the locally pinned PGlite dist/index.js. This runner uses memory:// only.');
}
const { PGlite } = await import(pathToFileURL(modulePath).href);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sql = await readFile(path.join(root, 'scripts/maintenance/google-calendar-outbound-preflight.sql'), 'utf8');
const fixture = await readFile(path.join(root, 'supabase/tests/google_calendar_outbound_protocol.fixture.sql'), 'utf8');
const database = await PGlite.create({ dataDir: 'memory://', username: 'postgres' });
const target = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const owner = '20000000-0000-4000-8000-000000000001';
const otherOwner = '20000000-0000-4000-8000-000000000002';
const connection = '30000000-0000-4000-8000-000000000001';
const otherConnection = '30000000-0000-4000-8000-000000000002';
const event = '40000000-0000-4000-8000-000000000001';
const otherEvent = '40000000-0000-4000-8000-000000000002';
const eventRemoved = '40000000-0000-4000-8000-000000000003';
const jobId = suffix => `50000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;

async function job(suffix, organizationId, userId, connectionId, eventId, action = 'push_upsert', status = 'queued') {
  await database.query(`insert into public.google_calendar_sync_jobs
    (id, organization_id, connection_id, action, status, created_at, next_run_at, payload)
    values ($1, $2, $3, $4, $5, now() - interval '3 hours', now() - interval '2 hours',
      jsonb_build_object('event_id', $6::text, 'owner_user_id', $7::text))`,
  [jobId(suffix), organizationId, connectionId, action, status, eventId, userId]);
}
const total = (rows, field, isTarget = true) => rows.filter(row => row.is_target_organization === isTarget)
  .reduce((sum, row) => sum + Number(row[field]), 0);
async function report() { return (await database.query(sql, [target])).rows; }

try {
  await database.exec(fixture);
  await database.query('insert into public.organizations(id) values ($1),($2)', [target, other]);
  await database.query(`insert into public.users(id, organization_id, role, is_active)
    values ($1,$2,'admin',true),($3,$4,'admin',true)`, [owner, target, otherOwner, other]);
  await database.query(`insert into public.google_calendar_tokens(id, organization_id, user_id, token_secret_ref)
    values ($1,$2,$3,$1),($4,$5,$6,$4)`, [connection, target, owner, otherConnection, other, otherOwner]);
  await database.query('insert into public.schedule_events(id, organization_id, user_id) values ($1,$2,$3),($4,$5,$6)',
    [event, target, owner, otherEvent, other, otherOwner]);
  await job(1, target, owner, connection, event);
  await job(2, target, owner, connection, event, 'push_delete');
  await job(3, other, otherOwner, otherConnection, otherEvent);
  await job(4, target, owner, connection, event, 'pull_incremental', 'dead');
  await job(5, target, owner, connection, eventRemoved, 'push_upsert', 'dead');
  await job(6, target, owner, otherConnection, event);
  let rows = await report();
  assert.equal(total(rows, 'jobs'), 5);
  assert.equal(total(rows, 'jobs', false), 2);
  assert.equal(total(rows, 'missing_connection', false), 1);
  assert.equal(total(rows, 'eligible_before_event_order'), 2);
  assert.equal(total(rows, 'eligible_event_heads'), 1);
  assert.equal(total(rows, 'eligible_event_heads', false), 1);
  assert.equal(total(rows, 'obsolete_upserts'), 1);
  assert.equal(total(rows, 'different_connection_tenant'), 1);
  assert.equal(total(rows, 'owner_mismatch'), 1);
  assert.ok(rows.every(row => !Object.keys(row).some(key => /payload|token_secret|event_id|organization_id|connection_id/.test(key))));
  console.log('PASS global eligibility, target grouping, sibling order, obsolete jobs and metadata-only output.');

  await job(7, target, owner, null, event);
  rows = await report();
  assert.equal(total(rows, 'would_bind_during_hardening'), 1);
  assert.equal(total(rows, 'eligible_event_heads'), 1);
  await database.query(`insert into public.google_calendar_tokens(id, organization_id, user_id)
    values ($1,$2,$3)`, ['30000000-0000-4000-8000-000000000003', target, owner]);
  rows = await report();
  assert.equal(total(rows, 'ambiguous_hardening_binding'), 1);
  await database.query('delete from public.google_calendar_sync_jobs where id=$1', [jobId(7)]);
  await database.query('delete from public.google_calendar_tokens where id=$1', ['30000000-0000-4000-8000-000000000003']);
  console.log('PASS preflight forecasts legacy binding and reports ambiguous migration matches without mutating jobs.');

  await database.query(`update public.google_calendar_sync_jobs set status='running',locked_at=now() where id=$1`, [jobId(1)]);
  rows = await report();
  assert.equal(total(rows, 'eligible_event_heads'), 0);
  assert.equal(total(rows, 'active_sibling'), 3);
  console.log('PASS active sibling prevents a second claim for the same event.');

  await database.exec('alter table public.google_calendar_tokens add column disconnecting_at timestamptz');
  await database.query('update public.google_calendar_tokens set disconnecting_at=now() where id=$1', [otherConnection]);
  rows = await report();
  assert.equal(total(rows, 'eligible_event_heads', false), 0);
  assert.equal(total(rows, 'disconnecting', false), 1);
  console.log('PASS disconnecting connections are ineligible after the schema cut.');

  const before = (await database.query('select id,status,attempts,locked_at from public.google_calendar_sync_jobs order by id')).rows;
  await database.exec('begin read only');
  await report();
  await database.exec('rollback');
  assert.deepEqual((await database.query('select id,status,attempts,locked_at from public.google_calendar_sync_jobs order by id')).rows, before);
  console.log('PASS preflight executes in READ ONLY and preserves job state including dead pulls.');
} finally {
  await database.close();
}
