import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { definition } from './production-distribution-postgres-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baselineFile = '20260722000000_production_public_private_baseline.sql';
const migrationFile = '20261015162230_harden_lead_queue_redistribution_rotation.sql';
export const browserIDs = Object.freeze({
  organizationID: '71000000-0000-4000-8000-000000000001',
  userID: '72000000-0000-4000-8000-000000000001',
  sessionID: '73000000-0000-4000-8000-000000000001',
  pipelineID: '74000000-0000-4000-8000-000000000001',
  stageID: '75000000-0000-4000-8000-000000000001',
  queueID: '76000000-0000-4000-8000-000000000001',
  teamID: '79000000-0000-4000-8000-000000000001',
  brokerIDs: ['72000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000004'],
  memberIDs: ['77000000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000002', '77000000-0000-4000-8000-000000000003'],
  leadID: '78000000-0000-4000-8000-000000000001',
  poolLeadID: '78000000-0000-4000-8000-000000000002',
  email: 'adminhomologacao@example.invalid',
});

async function domainTableNames() {
  const names = new Set(['admin_subscription_plans', 'lead_meta', 'round_robin_rules', 'tags', 'lead_tags', 'whatsapp_session_access', 'whatsapp_outbox']);
  const domains = ['leads', 'tenant', 'me', 'pipelines', 'roundrobin', 'teams', 'users', 'settings',
    'propertyscope', 'leadscope', 'stageconfig', 'cadences', 'attention', 'gamification', 'schedule', 'presence', 'telemetry'];
  for (const domain of domains) {
    const directory = path.join(root, 'apps/api/internal', domain);
    for (const filename of await readdir(directory)) {
      if (!filename.endsWith('.go') || filename.endsWith('_test.go')) continue;
      const source = await readFile(path.join(directory, filename), 'utf8');
      for (const match of source.matchAll(/public\.([a-z_][a-z_0-9]*)/g)) names.add(match[1]);
    }
  }
  return names;
}

function createTable(source, schema, name) {
  const marker = `CREATE TABLE IF NOT EXISTS "${schema}"."${name}" (`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `Missing production table ${schema}.${name}`);
  // Some real tables end in WITH(storage_options), not a bare closing `);`.
  // Respect quoted defaults so their contents cannot terminate extraction.
  let quote = null;
  for (let index = start; index < source.length; index++) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index + 1] === quote) index++;
      else if (character === quote) quote = null;
    } else if (character === "'" || character === '"') quote = character;
    else if (character === ';') return source.slice(start, index + 1);
  }
  assert.fail(`Unterminated production table ${schema}.${name}`);
}

async function installFunctions(db, baseline, install) {
  const unified = await readFile(path.join(root, 'supabase/migrations/20260728183851_unify_lead_distribution.sql'), 'utf8');
  const forward = await readFile(path.join(root, 'supabase/migrations/20260729011728_forward_distribution_ticket_upgrade.sql'), 'utf8');
  const ledgerStart = unified.indexOf('create table private.lead_distribution_events (');
  const ledgerEnd = unified.indexOf('\n);', ledgerStart);
  await install(unified.slice(ledgerStart, ledgerEnd + 3), '20260728183851:private.lead_distribution_events');
  for (const [source, marker, delimiter, provenance] of [
    [baseline, 'CREATE OR REPLACE FUNCTION "private"."safe_uuid"(', '$$', baselineFile],
    [baseline, 'CREATE OR REPLACE FUNCTION "public"."pick_round_robin_for_lead"(', '$$', baselineFile],
    [unified, 'create or replace function private.round_robin_ticket_sequence_name(', '$$', '20260728183851'],
    [unified, 'create or replace function private.next_round_robin_ticket(', '$$', '20260728183851'],
    [unified, 'create or replace function private.normalize_lead_distribution_source(', '$$', '20260728183851'],
    [forward, 'create or replace function private.distribute_lead(', '$body$', '20260729011728'],
    [unified, 'create or replace function public.distribute_lead_from_backend(', '$$', '20260728183851'],
    [unified, 'create or replace function private.pick_round_robin_ticket_candidate(', '$$', '20260728183851'],
    [baseline, 'CREATE OR REPLACE FUNCTION "private"."enroll_round_robin_redistribution"()', '$_$', baselineFile],
  ]) await install(definition(source, marker, delimiter), `${provenance}:${marker}`);
  for (const filename of ['20260729021500_remove_ticket_sequence_runtime_acl_ddl.sql',
    '20260922120632_keep_direct_queue_members_outside_team_schedules.sql',
    '20261015193322_guard_lead_distribution_ticket_sequence_acl_hotpath.sql']) {
    await install(await readFile(path.join(root, 'supabase/migrations', filename), 'utf8'), filename);
  }
  const poolFile = '20260908034600_harden_edge_reentry_and_pool_redistribution.sql';
  await install(definition(await readFile(path.join(root, 'supabase/migrations', poolFile), 'utf8'),
    'create or replace function public.redistribute_lead_from_pool_backend(', '$$'), poolFile);
  const enrollment = baseline.split(/\r?\n/).find(line => line.startsWith('CREATE OR REPLACE TRIGGER "trg_enroll_round_robin_redistribution"'));
  assert.ok(enrollment); await install(enrollment, `${baselineFile}:enrollment trigger`);
  for (const prefix of ['ALTER TABLE "public"."lead_redistribution_jobs" ENABLE ROW LEVEL SECURITY;',
    'CREATE POLICY "backend manages lead redistribution jobs"',
    'GRANT ALL ON TABLE "public"."lead_redistribution_jobs" TO "service_role";']) {
    const sql = baseline.split(/\r?\n/).find(line => line.startsWith(prefix));
    assert.ok(sql); await install(sql, `${baselineFile}:original job RLS/policy/ACL`);
  }
  const retryFile = '20261015184139_isolate_lead_redistribution_worker_retry_clocks.sql';
  await install(await readFile(path.join(root, 'supabase/migrations', retryFile), 'utf8'), retryFile);
  const boundaryFile = '20261015193555_restrict_lead_redistribution_job_client_mutations.sql';
  await install(await readFile(path.join(root, 'supabase/migrations', boundaryFile), 'utf8'), boundaryFile);
  const stageStop = await readFile(path.join(root, 'supabase/migrations/20260722103039_stop_redistribution_on_stage_move.sql'), 'utf8');
  await install(definition(stageStop, 'create or replace function private.stop_active_redistribution_on_stage_move()', '$$'),
    '20260722103039:real stage-stop function');
  const stageTrigger = stageStop.match(/create trigger trg_stop_redistribution_on_stage_move[\s\S]*?execute function[^;]+;/)?.[0];
  assert.ok(stageTrigger); await install(stageTrigger, '20260722103039:real stage-stop trigger');
  await db.query(`revoke all on function private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz) from public,anon,authenticated;
    grant execute on function private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz) to service_role;
    revoke all on function public.distribute_lead_from_backend(uuid,uuid,text,uuid,boolean,text,timestamptz) from public,anon,authenticated;
    grant execute on function public.distribute_lead_from_backend(uuid,uuid,text,uuid,boolean,text,timestamptz) to service_role;
    revoke all on function public.redistribute_lead_from_pool_backend(uuid,uuid,text,uuid,uuid,timestamptz,integer,timestamptz) from public,anon,authenticated;
    grant execute on function public.redistribute_lead_from_pool_backend(uuid,uuid,text,uuid,uuid,timestamptz,integer,timestamptz) to service_role;`);
  await install(await readFile(path.join(root, 'supabase/migrations', migrationFile), 'utf8'), migrationFile);
}

async function seedBrowser(db) {
  const id = browserIDs;
  await db.query(`insert into public.organizations(id,name,subscription_status,subscription_type)
    values($1,'Homologação local — distribuição','active','free')`, [id.organizationID]);
  for (const [n, userID] of [id.userID, ...id.brokerIDs].entries()) {
    await db.query(`insert into public.users(id,organization_id,name,email,role,is_active)
      values($1,$2,$3,$4,$5,true)`, [userID, id.organizationID, n === 0 ? 'Administrador local' : `Corretor ${'ABC'[n - 1]}`,
      n === 0 ? id.email : `corretor${n}@example.invalid`, n === 0 ? 'admin' : 'user']);
    await db.query(`insert into public.organization_members(user_id,organization_id,role,is_active)
      values($1,$2,$3,true)`, [userID, id.organizationID, n === 0 ? 'admin' : 'user']);
  }
  await db.query(`insert into public.organization_modules(organization_id,module_name,is_enabled)
    values($1,'crm',true),($1,'properties',true),($1,'whatsapp',true),($1,'agenda',true)`, [id.organizationID]);
  await db.query(`insert into public.pipelines(id,organization_id,name,is_default,is_active,position,pool_enabled,pool_timeout_minutes,pool_max_redistributions)
    values($1,$2,'Homologação distribuição',true,true,0,true,1,0)`, [id.pipelineID, id.organizationID]);
  await db.query(`insert into public.stages(id,organization_id,pipeline_id,name,stage_key,color,position,is_active)
    values($1,$2,$3,'Novos','new','#FF4529',0,true)`, [id.stageID, id.organizationID, id.pipelineID]);
  await db.query(`insert into public.round_robins(id,organization_id,name,strategy,is_active,target_pipeline_id,target_stage_id,pipeline_id,settings)
    values($1,$2,'Fila homologação A → B → C','simple',true,$3,$4,$3,$5)`,
    [id.queueID, id.organizationID, id.pipelineID, id.stageID,
      { timezone: 'America/Sao_Paulo', enable_redistribution: true, redistribution_timeout_minutes: 1, redistribution_max_attempts: 0 }]);
  await db.query('select private.ensure_round_robin_ticket_sequence($1)', [id.queueID]);
  for (let n = 0; n < id.brokerIDs.length; n++) await db.query(`insert into public.round_robin_members
    (id,organization_id,round_robin_id,user_id,position,weight,is_active) values($1,$2,$3,$4,$5,1,true)`,
  [id.memberIDs[n], id.organizationID, id.queueID, id.brokerIDs[n], n]);
  await db.query(`update public.pipelines set default_round_robin_id=$1 where id=$2`, [id.queueID, id.pipelineID]);
  await seedBrowserTeam(db);
  for (const [leadID, name] of [[id.leadID, 'Lead homologação rotação'], [id.poolLeadID, 'Lead homologação bolsão']]) {
    await db.query(`insert into public.leads(id,organization_id,pipeline_id,stage_id,name,phone,origin_round_robin_id,intake_scope_key,source)
      values($1,$2,$3,$4,$5,$6,$7,$8,'manual')`, [leadID, id.organizationID, id.pipelineID, id.stageID, name,
      leadID === id.leadID ? '+5511999990001' : '+5511999990002', id.queueID, `queue:${id.queueID}`]);
  }
  // Use the actual canonical assignment for the rotation card; the pool card
  // intentionally remains unowned for the existing assume/retry UI.
  const result = (await db.query(`select private.distribute_lead($1,$2,'browser-seed-initial',$3,false,'manual',clock_timestamp()) result`,
    [id.organizationID, id.leadID, id.queueID])).rows[0].result;
  assert.equal(result.success, true); assert.equal(result.assigned_user_id, id.brokerIDs[0]);
  await db.query(`insert into auth.sessions(id,user_id,created_at,updated_at) values($1,$2,now(),now())`, [id.sessionID, id.userID]);
  return result;
}

async function seedBrowserTeam(db) {
  const id = browserIDs;
  await db.query(`insert into public.teams(id,organization_id,name,is_active)
    values($1,$2,'Equipe homologação A/B/C',true) on conflict(id) do nothing`, [id.teamID, id.organizationID]);
  await db.query(`insert into public.team_pipelines(organization_id,team_id,pipeline_id)
    select $1,$2,$3 where not exists(select 1 from public.team_pipelines where team_id=$2 and pipeline_id=$3)`,
  [id.organizationID, id.teamID, id.pipelineID]);
  for (const userID of id.brokerIDs) await db.query(`insert into public.team_members(organization_id,team_id,user_id,is_active)
    select $1,$2,$3,true where not exists(select 1 from public.team_members where team_id=$2 and user_id=$3)`,
  [id.organizationID, id.teamID, userID]);
}

async function installBrowserCardReadModels(db, baseline) {
  const provenance = [];
  const file = filename => readFile(path.join(root, 'supabase/migrations', filename), 'utf8');
  const install = async (sql, origin) => { await db.query(sql); provenance.push({ origin, sha256: createHash('sha256').update(sql).digest('hex') }); };
  const exists = async (table, column) => (await db.query(`select exists(select 1 from information_schema.columns
    where table_schema='public' and table_name=$1 and column_name=$2) as present`, [table, column])).rows[0].present;
  for (const table of ['whatsapp_session_access', 'whatsapp_outbox']) {
    if (!(await exists(table, 'id'))) {
      await install(createTable(baseline, 'public', table), `${baselineFile}:${table}`);
      for (const match of baseline.matchAll(/^ALTER TABLE ONLY "public"\."([^"]+)"\s+ADD CONSTRAINT[\s\S]*?;/gm)) {
        if (match[1] === table && /PRIMARY KEY|UNIQUE /.test(match[0])) await install(match[0], `${baselineFile}:key ${table}`);
      }
    }
  }
  if (!(await exists('whatsapp_session_access', 'grant_scope'))) {
    const filename = '20261007211500_enforce_whatsapp_session_sharing_scope.sql';
    const source = await file(filename), start = source.indexOf('alter table public.whatsapp_session_access');
    await install(source.slice(start, source.indexOf(';', start) + 1), `${filename}:grant scope columns`);
  }
  if (!(await exists('whatsapp_messages', 'capture_state'))) {
    const filename = '20260922173000_add_whatsapp_attendance_capture_gate.sql', source = await file(filename);
    for (const marker of ['alter table public.whatsapp_messages\n  add column capture_state',
      'alter table public.whatsapp_messages\n  alter column capture_state set default',
      'alter table public.whatsapp_messages\n  add constraint whatsapp_messages_capture_state_check']) {
      const start = source.indexOf(marker); assert.ok(start >= 0);
      await install(source.slice(start, source.indexOf(';', start) + 1), filename);
    }
  }
  const bindingFile = '20260919181318_queue_scoped_lead_identity_and_whatsapp_binding.sql';
  const bindingSource = await file(bindingFile), bindingStart = bindingSource.indexOf('create table if not exists public.whatsapp_conversation_lead_bindings (');
  await install(bindingSource.slice(bindingStart, bindingSource.indexOf('\n);', bindingStart) + 3), `${bindingFile}:binding read model`);
  const cadenceFile = '20260913104722_repair_cadence_operational_schema.sql';
  for (const match of (await file(cadenceFile)).matchAll(/^alter table public\.([a-z_]+)\s+add column[^;]+;/gmi)) {
    await install(match[0], `${cadenceFile}:additive ${match[1]}`);
  }
  for (const filename of ['20260726235820_google_calendar_bidirectional_sync.sql',
    '20260908062156_add_schedule_outcomes_and_dashboard_indexes.sql']) {
    for (const match of (await file(filename)).matchAll(/^alter table public\.schedule_events\s+add column[^;]+;/gmi)) {
      await install(match[0], `${filename}:schedule read model columns`);
    }
  }
  await install(await file('20260728181626_durable_realtime_event_bus.sql'), '20260728181626:real durable invalidation bus');
  return provenance;
}

// Add only the missing read models to a previously installed browser target.
// Never reset cards or rotation state after interactive testing has started.
export async function completeBrowserReadModels(configPath) {
  assert.equal(path.basename(configPath), 'browser-target.json', 'Only the separately provisioned browser target is accepted');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(config.kind, 'vimob-production-distribution-hotfix-postgres-v1');
  assert.equal(config.host, '127.0.0.1'); assert.equal(config.port, 57533);
  assert.match(config.database, /^vimob_distribution_hotfix_[a-f0-9]{12}$/);
  const { Client } = createRequire(path.join(config.dependencyRoot, 'package.json'))('pg');
  const db = new Client({ host: config.host, port: config.port, database: config.database, user: config.user,
    password: config.password, ssl: false, application_name: 'vimob-browser-read-models', statement_timeout: 15000 });
  await db.connect();
  try {
    const guard = (await db.query(`select current_database() as name,
      (select count(*) from public.production_distribution_hotfix_sentinel where run_id=$1) as sentinel`, [config.runId])).rows[0];
    assert.equal(guard.name, config.database); assert.equal(Number(guard.sentinel), 1);
    assert.equal(path.resolve((await db.query('show data_directory')).rows[0].data_directory).toLowerCase(), path.resolve(config.datadir).toLowerCase());
    const baseline = await readFile(path.join(root, 'supabase/migrations', baselineFile), 'utf8');
    await db.query('begin');
    const exists = (await db.query("select to_regclass('public.error_events') is not null as present")).rows[0].present;
    if (!exists) {
      await db.query(createTable(baseline, 'public', 'error_events'));
      for (const match of baseline.matchAll(/^ALTER TABLE ONLY "public"\."error_events"\s+ADD CONSTRAINT[\s\S]*?;/gm)) {
        if (/PRIMARY KEY|UNIQUE /.test(match[0])) await db.query(match[0]);
      }
    }
    await db.query(`insert into public.organization_modules(organization_id,module_name,is_enabled)
      select $1,'whatsapp',true where not exists(select 1 from public.organization_modules
        where organization_id=$1 and module_name='whatsapp')`, [browserIDs.organizationID]);
    await db.query(`update public.organization_modules set is_enabled=true
      where organization_id=$1 and module_name='whatsapp'`, [browserIDs.organizationID]);
    await db.query(`insert into public.organization_modules(organization_id,module_name,is_enabled)
      select $1,'agenda',true where not exists(select 1 from public.organization_modules
        where organization_id=$1 and module_name='agenda')`, [browserIDs.organizationID]);
    await db.query(`delete from public.organization_modules where organization_id=$1 and module_name='schedule'`, [browserIDs.organizationID]);
    const cardProvenance = await installBrowserCardReadModels(db, baseline);
    await seedBrowserTeam(db);
    await db.query('commit');
    const resultPath = path.join(path.dirname(configPath), 'browser-fixture-result.json');
    const report = JSON.parse(await readFile(resultPath, 'utf8'));
    if (!report.tables.includes('error_events')) report.tables.push('error_events');
    for (const table of ['whatsapp_session_access', 'whatsapp_conversation_lead_bindings', 'whatsapp_outbox']) if (!report.tables.includes(table)) report.tables.push(table);
    report.ids = browserIDs;
    report.readModelCompletion = { completedAt: new Date().toISOString(), telemetryOriginalDDL: baselineFile,
      whatsappModuleEnabled: true, whatsappSessionsCreated: false, externalProviderStarted: false,
      teamID: browserIDs.teamID, cardsAndRotationStateReset: false };
    report.cardReadModelProvenance = cardProvenance;
    await writeFile(resultPath, JSON.stringify(report, null, 2) + '\n');
    return { success: true, ids: browserIDs, resultPath };
  } catch (error) { await db.query('rollback'); throw error; }
  finally { await db.end(); }
}

// Browser/API homologation substrate, NOT a complete migration replay. Tables,
// defaults, checks, PKs and unique constraints below are literal production DDL.
// Only selected functions/triggers are installed; omitted FKs/policies are listed.
export async function installBrowserFixture(configPath) {
  assert.equal(path.basename(configPath), 'browser-target.json', 'Only the separately provisioned browser target is accepted');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(config.kind, 'vimob-production-distribution-hotfix-postgres-v1');
  assert.equal(config.host, '127.0.0.1'); assert.equal(config.port, 57533);
  assert.match(config.database, /^vimob_distribution_hotfix_[a-f0-9]{12}$/);
  const { Client } = createRequire(path.join(config.dependencyRoot, 'package.json'))('pg');
  const db = new Client({ host: config.host, port: config.port, database: config.database, user: config.user,
    password: config.password, ssl: false, application_name: 'vimob-hotfix-browser-fixture', statement_timeout: 15000 });
  const report = { ids: browserIDs, sourceCommit: 'ef1cefca6faa59a78fd2aecbbecbf31ed1030c4b',
    fullSupabaseMigrationReplay: false, productionAccessed: false, installed: [], omittedForeignKeys: [],
    authInterface: 'Local Auth HTTP stub plus minimal synthetic auth.sessions; no real Supabase Auth service',
    externalNotificationDispatch: false };
  await db.connect();
  try {
    const guard = (await db.query(`select current_database() as name,
      (select count(*) from public.production_distribution_hotfix_sentinel where run_id=$1) as sentinel`, [config.runId])).rows[0];
    assert.equal(guard.name, config.database); assert.equal(Number(guard.sentinel), 1);
    assert.equal(path.resolve((await db.query('show data_directory')).rows[0].data_directory).toLowerCase(), path.resolve(config.datadir).toLowerCase());
    assert.equal(Number((await db.query(`select count(*) from pg_tables where schemaname in ('public','private','auth')
      and tablename<>'production_distribution_hotfix_sentinel'`)).rows[0].count), 0, 'Browser target must be pristine');
    const install = async (sql, provenance) => {
      try { await db.query(sql); }
      catch (error) { error.message = `${provenance}: ${error.message}`; throw error; }
      report.installed.push({ provenance, sha256: createHash('sha256').update(sql).digest('hex') });
    };
    await db.query('begin');
    await db.query(`create schema private; create schema auth; create schema if not exists extensions;
      create extension if not exists pgcrypto with schema extensions;
      grant usage on schema private to service_role;
      create table auth.sessions(id uuid primary key,user_id uuid not null,created_at timestamptz,updated_at timestamptz);`);
    const baseline = await readFile(path.join(root, 'supabase/migrations', baselineFile), 'utf8');
    for (const match of baseline.matchAll(/^CREATE TYPE "public"\."[^"]+" AS ENUM \([\s\S]*?^\);/gm)) await install(match[0], `${baselineFile}:enum`);
    await install(definition(baseline, 'CREATE OR REPLACE FUNCTION "public"."normalize_phone"(', '$$'),
      `${baselineFile}:phone normalization for the original identity index`);
    const requested = await domainTableNames(), selected = new Set();
    for (const match of baseline.matchAll(/^CREATE TABLE IF NOT EXISTS "public"\."([^"]+)" \(/gm)) {
      if (!requested.has(match[1])) continue;
      selected.add(match[1]); await install(createTable(baseline, 'public', match[1]), `${baselineFile}:public.${match[1]}`);
    }
    report.tables = [...selected];
    for (const line of baseline.split(/\r?\n/).filter(line => /^CREATE UNIQUE INDEX /.test(line))) {
      const table = line.match(/ON "public"\."([^"]+)"/);
      if (table && selected.has(table[1])) await install(line, `${baselineFile}:unique index ${table[1]}`);
    }
    for (const match of baseline.matchAll(/^ALTER TABLE ONLY "public"\."([^"]+)"\s+ADD CONSTRAINT[\s\S]*?;/gm)) {
      if (!selected.has(match[1])) continue;
      if (/PRIMARY KEY|UNIQUE /.test(match[0])) await install(match[0], `${baselineFile}:key ${match[1]}`);
    }
    // Additive columns are copied literally. We do not execute data sweeps,
    // mutate old tables, or copy application changes from another checkout.
    for (const filename of ['20260728183232_harden_billing_access_state.sql',
      '20260827000000_distinguish_disabled_and_deleted_organization_members.sql',
      '20260919181318_queue_scoped_lead_identity_and_whatsapp_binding.sql',
      '20260920012629_preserve_deleted_round_robin_identity.sql',
      '20260920170647_add_durable_whatsapp_lead_avatar_enrichment.sql']) {
      const source = await readFile(path.join(root, 'supabase/migrations', filename), 'utf8');
      for (const match of source.matchAll(/^alter table public\.([a-z_]+)\s+add column[^;]+;/gmi)) {
        if (selected.has(match[1]) && ['admin_subscription_plans', 'organizations', 'organization_members',
          'leads', 'round_robins'].includes(match[1])) await install(match[0], `${filename}:additive ${match[1]}`);
      }
    }
    for (const match of baseline.matchAll(/^ALTER TABLE ONLY "public"\."([^"]+)"\s+ADD CONSTRAINT[\s\S]*?;/gm)) {
      if (!selected.has(match[1]) || !/FOREIGN KEY/.test(match[0])) continue;
      const referenced = match[0].match(/REFERENCES "([^"]+)"\."([^"]+)"/);
      if (referenced?.[1] === 'public' && selected.has(referenced[2])) await install(match[0], `${baselineFile}:FK ${match[1]}`);
      else report.omittedForeignKeys.push({ table: match[1], references: referenced?.slice(1).join('.') });
    }
    for (const line of baseline.split(/\r?\n/).filter(line => /^CREATE INDEX /.test(line)
      && /ON "public"\."(round_robin_logs|assignments_log|lead_redistribution_jobs)"/.test(line))) await install(line, `${baselineFile}:distribution index`);
    await installFunctions(db, baseline, install);
    report.cardReadModelProvenance = await installBrowserCardReadModels(db, baseline);
    if (!report.tables.includes('whatsapp_conversation_lead_bindings')) report.tables.push('whatsapp_conversation_lead_bindings');
    report.seedAssignment = await seedBrowser(db);
    await db.query('commit'); report.success = true;
    const resultPath = path.join(path.dirname(configPath), 'browser-fixture-result.json');
    await writeFile(resultPath, JSON.stringify(report, null, 2) + '\n');
    return { ...report, resultPath };
  } catch (error) { await db.query('rollback'); throw error; }
  finally { await db.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = process.argv[2] === '--complete-read-models'
    ? await completeBrowserReadModels(process.argv[3]) : await installBrowserFixture(process.argv[2]);
  console.log(JSON.stringify({ success: result.success, ids: result.ids, tables: result.tables?.length, resultPath: result.resultPath }));
}
