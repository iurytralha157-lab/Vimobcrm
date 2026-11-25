import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// This runner has no database URL input and always creates a fresh memory DB.
const modulePath = process.argv[2] || process.env.VIMOB_QUEUE_PGLITE_MODULE;
if (!modulePath || !path.isAbsolute(modulePath)) {
  throw new Error('Set VIMOB_QUEUE_PGLITE_MODULE to an absolute pinned PGlite dist/index.js path.');
}
const { PGlite } = await import(pathToFileURL(modulePath).href);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const database = await PGlite.create({ dataDir: 'memory://', username: 'postgres' });
const read = relative => readFile(path.join(root, relative), 'utf8');
function extractDefinition(source, marker, delimiter) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing legacy prerequisite ${marker}`);
  const body = source.indexOf(delimiter, start);
  const end = source.indexOf(delimiter, body + delimiter.length);
  if (body < 0 || end < 0) throw new Error(`Incomplete legacy prerequisite ${marker}`);
  return source.slice(start, end + delimiter.length) + ';';
}
try {
  await database.exec(await read('supabase/tests/queue_runtime.fixture.sql'));
  const picker = await read('supabase/migrations/20261013034403_management_all_day_overnight_eligibility.sql');
  await database.exec(extractDefinition(picker, 'create or replace function private.pick_round_robin_ticket_candidate(', '$body$'));
  const legacy = await read('supabase/migrations/20260729011728_forward_distribution_ticket_upgrade.sql');
  await database.exec(extractDefinition(legacy, 'create or replace function private.distribute_lead(', '$body$'));
  const outbox = await read('supabase/migrations/20260905093544_normalize_notification_delivery_outbox.sql');
  await database.exec(extractDefinition(outbox, 'create or replace function private.notification_dispatch_required(', '$function$'));
  for (const file of [
    '20261015022236_queue_operating_schedule_contract.sql',
    '20261015022536_queue_runtime_state_and_audience.sql',
    '20261015022817_queue_runtime_transition_engine.sql',
    '20261015023126_queue_runtime_claim_and_guards.sql',
    '20261015023712_queue_runtime_canonical_and_batch.sql',
    '20261015024500_queue_notification_delivery_authorization.sql',
  ]) {
    await database.exec(await read(`supabase/migrations/${file}`));
    console.log(`PASS migration ${file}`);
  }
  await database.exec(await read('supabase/tests/queue_runtime.test.sql'));
  await database.exec(await read('supabase/tests/queue_runtime_edgecases.test.sql'));
  await database.exec(await read('supabase/tests/queue_notification_delivery.test.sql'));
  console.log('PASS queue runtime behavioral SQL assertions (single-session, in-memory PostgreSQL).');

  // Load the real outbox schema and provider-start implementation without
  // re-materializing historical notifications or running provider workers.
  await database.exec(`
    alter table public.leads add column meta_lead_id text;
    alter table public.notifications add primary key(id);
    alter table public.notifications add column is_read boolean not null default false;
    create table public.push_tokens(id uuid primary key, user_id uuid, organization_id uuid, is_active boolean not null default true);
  `);
  await database.exec(outbox.slice(
    outbox.indexOf('create table if not exists private.notification_deliveries'),
    outbox.indexOf('create or replace function private.notification_safe_integer'),
  ));
  await database.exec(extractDefinition(outbox, 'create or replace function private.start_notification_delivery(', '$function$'));
  const pushScope = await read('supabase/migrations/20261012223833_push_device_user_owned_delivery_scope.sql');
  for (const name of ['push_notification_recipient_is_active', 'lock_push_notification_recipient']) {
    await database.exec(extractDefinition(pushScope, `create function private.${name}(`, '$$'));
  }
  for (const file of [
    '20261016173733_authorize_queue_notification_at_attempt_start.sql',
    '20261109114553_preserve_legacy_short_redistribution_warnings.sql',
  ]) {
    await database.exec(await read(`supabase/migrations/${file}`));
    console.log(`PASS migration ${file}`);
  }
  const migration = await read('supabase/migrations/20261125140615_allow_meta_unassigned_admin_push.sql');
  await database.exec(`insert into public.notifications(title,metadata)
    values ('preexisting reserved test row','{"dedupe_key":"meta_unassigned_admin_alert:fixture"}')`);
  try {
    await database.exec(migration);
    throw new Error('Migration accepted preexisting reserved metadata');
  } catch (error) {
    if (error.message !== 'meta_unassigned_admin_push_preexisting_reserved_notifications') throw error;
    await database.exec('rollback');
  }
  await database.exec("delete from public.notifications where title = 'preexisting reserved test row'");
  await database.exec(migration);
  await database.exec(await read('supabase/tests/meta_unassigned_admin_push.test.sql'));
  console.log('PASS marked Meta lead push channel, SQL authorization, and disable switch regression.');

  console.log('Not a concurrent multi-connection or complete Supabase migration-chain test.');
} catch (error) {
  console.error(JSON.stringify({ message: error.message, code: error.code, detail: error.detail, where: error.where }));
  process.exitCode = 1;
} finally {
  await database.close();
}
