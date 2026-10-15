import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { definition } from './production-distribution-postgres-fixture.mjs';

// Real production job schema, enrollment trigger and stop-on-stage function;
// the remaining activity tables are a declared minimal synthetic interface.
// Notifications terminate in the local table: no dispatcher/provider is run.
export async function installWorkerSubstrate(db, root) {
  const source = await readFile(path.join(root, 'supabase/migrations/20260722000000_production_public_private_baseline.sql'), 'utf8');
  const marker = 'CREATE TABLE IF NOT EXISTS "public"."lead_redistribution_jobs" (';
  const start = source.indexOf(marker), end = source.indexOf('\n);', start);
  assert.ok(start >= 0 && end > start);
  const jobs = source.slice(start, end + 3);
  const { rows: [jobTable] } = await db.query(`select to_regclass('public.lead_redistribution_jobs') as identity,
    coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.lead_redistribution_jobs')),false) as rls`);
  assert.equal(jobTable.identity, 'lead_redistribution_jobs', 'Install the production substrate before worker interfaces');
  assert.equal(jobTable.rls, true, 'Production job RLS must already be installed');
  const jobSecurity = [
    'CREATE POLICY "backend manages lead redistribution jobs" ON "public"."lead_redistribution_jobs" TO "service_role" USING (true) WITH CHECK (true);',
    'ALTER TABLE "public"."lead_redistribution_jobs" ENABLE ROW LEVEL SECURITY;',
    'GRANT ALL ON TABLE "public"."lead_redistribution_jobs" TO "service_role";',
  ];
  for (const sql of jobSecurity) {
    assert.ok(source.includes(sql), 'Job security substrate must match production DDL literally');
  }
  await db.query(`alter table public.leads add column if not exists first_response_is_automation boolean default false;
    alter table public.lead_timeline_events add column if not exists actor_user_id uuid;
    alter table public.whatsapp_messages add column if not exists sent_at timestamptz,
      add column if not exists received_at timestamptz,add column if not exists direction text,
      add column if not exists metadata jsonb default '{}',add column if not exists client_message_id text;
    create table public.lead_action_facts(id uuid primary key default gen_random_uuid(),organization_id uuid,lead_id uuid,
      is_automated boolean default false,is_inbound boolean default false,actor_user_id uuid,source_type text,
      source_id text,action_type text,occurred_at timestamptz default clock_timestamp());
    create table public.activities(id uuid primary key default gen_random_uuid(),organization_id uuid,lead_id uuid,user_id uuid,
      type text,content text,metadata jsonb default '{}',created_at timestamptz default clock_timestamp());
    create table public.lead_tasks(id uuid primary key default gen_random_uuid(),organization_id uuid,lead_id uuid,
      created_by uuid,done_by uuid,created_at timestamptz default clock_timestamp(),completed_at timestamptz,done_at timestamptz);
    create table public.schedule_events(id uuid primary key default gen_random_uuid(),organization_id uuid,lead_id uuid,
      status text default 'scheduled',created_at timestamptz default clock_timestamp(),completed_at timestamptz);
    create table public.audit_logs(id uuid primary key default gen_random_uuid(),organization_id uuid,entity_type text,
      entity_id text,user_id uuid,source text,created_at timestamptz default clock_timestamp());`);
  const enroll = definition(source, 'CREATE OR REPLACE FUNCTION "private"."enroll_round_robin_redistribution"()', '$_$');
  await db.query(enroll);
  await db.query(`CREATE TRIGGER trg_enroll_round_robin_redistribution AFTER INSERT ON public.round_robin_logs
    FOR EACH ROW EXECUTE FUNCTION private.enroll_round_robin_redistribution()`);
  const stage = await readFile(path.join(root, 'supabase/migrations/20260722103039_stop_redistribution_on_stage_move.sql'), 'utf8');
  // This migration is self-contained and includes both its real trigger and
  // historical no-op backfill (the disposable target starts without jobs).
  await db.query(stage);
  const retry = await installWorkerRetryMigration(db, root);
  return { realProductionEnrollment: true, realStageStopTrigger: true, externalNotificationDispatcher: false,
    jobSchemaSha256: createHash('sha256').update(jobs).digest('hex'),
    jobSecuritySha256: createHash('sha256').update(jobSecurity.join('\n')).digest('hex'),
    enrollmentSha256: createHash('sha256').update(enroll).digest('hex'),
    retry,
    syntheticActivityInterfaces: ['lead_action_facts', 'activities', 'lead_tasks', 'schedule_events', 'audit_logs'] };
}

export async function installWorkerRetryMigration(db, root) {
  const filename = '20261015184139_isolate_lead_redistribution_worker_retry_clocks.sql';
  const sql = await readFile(path.join(root, 'supabase/migrations', filename), 'utf8');
  await db.query(sql);
  // Run the exact client-mutation boundary after adding retry columns so the
  // fixture proves both historical and new columns use the backend contract.
  const boundaryFilename = '20261015193555_restrict_lead_redistribution_job_client_mutations.sql';
  const boundarySQL = await readFile(path.join(root, 'supabase/migrations', boundaryFilename), 'utf8');
  await db.query(boundarySQL);
  return { filename, sha256: createHash('sha256').update(sql).digest('hex'),
    mutationBoundary: { filename: boundaryFilename, sha256: createHash('sha256').update(boundarySQL).digest('hex') } };
}
