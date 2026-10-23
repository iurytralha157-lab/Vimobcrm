import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = new URL('../../', import.meta.url);
const migration = 'supabase/migrations/20261016121216_pipeline_stage_assignee_clock_consistency.sql';
const predecessor = 'supabase/migrations/20261016043851_pipeline_stage_assignee_team_consistency.sql';
const baseline = 'supabase/migrations/20260722000000_production_public_private_baseline.sql';
const history = 'supabase/migrations/20260921115616_add_silent_historical_lead_import.sql';
const clocks = 'supabase/migrations/20260912172606_advance_pipeline_board_order_on_reentry_and_distribution.sql';
const cycles = 'supabase/migrations/20260913104722_repair_cadence_operational_schema.sql';

// No application env/config is read. Only an explicit owned, loopback server is
// accepted, and this harness creates/drops its own random database exclusively.
export function parseAssigneeClockTarget(marker, raw) {
  assert.equal(marker, 'LOCAL_WRITE_TEST', 'Explicit LOCAL_WRITE_TEST marker is required');
  let url;
  try { url = new URL(raw); } catch { assert.fail('Pass an explicit loopback PostgreSQL fixture URL'); }
  const port = Number(url.port);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol)
    && ['127.0.0.1', '[::1]'].includes(url.hostname)
    && url.username === 'postgres' && !url.password && url.pathname === '/postgres'
    && !url.search && !url.hash && Number.isInteger(port) && port >= 20000 && port <= 65535,
  'Target must be postgres on an explicit loopback fixture port/database, without password/options');
  return { host: url.hostname.replace(/^\[|\]$/g, ''), port, user: 'postgres', database: 'postgres',
    connectionTimeoutMillis: 5000, statement_timeout: 10000, lock_timeout: 3000 };
}

export function sourceFunction(source, name, quoted = false) {
  const spelling = quoted ? name.split('.').map(value => `"${value}"`).join('\\.') : name.replace('.', '\\.');
  const match = source.match(new RegExp(`create or replace function ${spelling}\\(\\)[\\s\\S]*?\\$\\$;`, 'i'));
  assert.ok(match, `Missing real function ${name}`);
  return match[0];
}

function sourceTrigger(source, name) {
  const match = source.match(new RegExp(`create trigger ${name}\\s[\\s\\S]*?execute function [^;]+;`, 'i'));
  assert.ok(match, `Missing real trigger ${name}`);
  return match[0];
}

async function installComposition(db) {
  const [base, hist, clock, cycle] = await Promise.all([baseline, history, clocks, cycles]
    .map(file => readFile(new URL(file, root), 'utf8')));
  await db.query(`create schema private; create schema extensions;
    create extension pgcrypto with schema extensions;
    create table private.historical_lead_import_contexts(transaction_id text primary key,
      token_sha256 text not null,organization_id uuid,actor_user_id uuid);
    create table public.users(id uuid primary key,is_active boolean default true);
    create table public.organization_members(organization_id uuid,user_id uuid,is_active boolean default true,
      deleted_at timestamptz,membership_generation bigint default 1);
    create table public.team_members(organization_id uuid,team_id uuid,user_id uuid,is_active boolean default true,
      membership_generation bigint default 1);
    create table public.stage_automations(id uuid default gen_random_uuid(),organization_id uuid,stage_id uuid,
      trigger_type text default 'on_enter',automation_type text,action_config jsonb default '{}',
      is_active boolean default true,created_at timestamptz default now());
    create table public.leads(id uuid primary key,organization_id uuid,pipeline_id uuid,stage_id uuid,team_id uuid,
      assigned_user_id uuid,assigned_at timestamptz,first_touch_at timestamptz,
      stage_entered_at timestamptz,board_order_at timestamptz,last_entry_at timestamptz,created_at timestamptz default now(),
      attention_eligible boolean default true,attention_enrolled_at timestamptz,reentry_count integer default 0,source text,
      operational_effects_suppressed boolean default false,deal_status text default 'open',
      won_at timestamptz,lost_at timestamptz,lost_reason text);`);
  for (const table of ['lead_assignment_cycles', 'lead_stage_cycles', 'lead_attention_instances',
    'lead_redistribution_jobs', 'lead_attention_events']) {
    const statement = base.match(new RegExp(`CREATE TABLE IF NOT EXISTS "public"\\."${table}" \\([\\s\\S]*?\\n\\);`));
    assert.ok(statement, `Missing real table ${table}`);
    await db.query(statement[0]);
  }
  for (const [source, name, quoted] of [
    [base, 'public.set_lead_assigned_at', true], [base, 'public.set_lead_assigned_at_on_insert', true],
    [clock, 'private.guard_lead_clocks'], [hist, 'private.historical_import_effects_suppressed'],
    [cycle, 'private.capture_lead_cycles'],
  ]) await db.query(sourceFunction(source, name, quoted));
  await db.query(await readFile(new URL(predecessor, root), 'utf8'));
  for (const name of ['tr_set_assigned_at', 'tr_set_assigned_at_insert', 'trg_guard_lead_clocks',
    'trigger_execute_stage_automations', 'trg_capture_lead_cycles']) {
    await db.query(sourceTrigger(hist, name));
  }
}

export async function runAssigneeClockPostgres(marker, raw) {
  const settings = parseAssigneeClockTarget(marker, raw);
  const database = `vimob_assignee_clock_test_${randomBytes(8).toString('hex')}`;
  // Windows may need longer to synchronize a new/drop database directory.
  // Behavioral queries keep their 10 s timeout and the migration its own limits.
  const admin = new pg.Client({ ...settings, statement_timeout: 60000 });
  let db;
  let created = false;
  let checks = 0;
  const check = (condition, message) => { assert.ok(condition, message); checks += 1; };
  const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
  const org = id(1), foreign = id(2), pipeline = id(3), stageA = id(4), stageB = id(5);
  const ownerA = id(6), ownerB = id(7), team = id(8), lead = id(9);
  const oldAt = '2020-01-02T03:04:05.123456Z', touchAt = '2020-01-03T04:05:06.234567Z';
  try {
    await admin.connect();
    const roles = (await admin.query("select rolname from pg_roles where rolname in ('anon','authenticated','service_role')")).rows;
    assert.equal(roles.length, 3, 'Owned fixture server must already contain the three Supabase test roles');
    await admin.query(`create database "${database}"`); created = true;
    db = new pg.Client({ ...settings, database }); await db.connect();
    await installComposition(db);
    await db.query('insert into public.users(id) values($1),($2)', [ownerA, ownerB]);
    await db.query('insert into public.organization_members(organization_id,user_id) values($1,$2),($1,$3)', [org, ownerA, ownerB]);
    await db.query('insert into public.team_members(organization_id,team_id,user_id) values($1,$2,$3),($1,$2,$4)', [org, team, ownerA, ownerB]);
    const rule = async (target = ownerB) => {
      await db.query('delete from public.stage_automations');
      await db.query(`insert into public.stage_automations(organization_id,stage_id,automation_type,action_config)
        values($1,$2,'change_assignee_on_enter',$3)`, [org, stageB, { target_user_id: target }]);
    };
    const seed = async (owner = ownerA, organization = org, selectedTeam = team) => {
      await db.query('delete from public.lead_assignment_cycles; delete from public.lead_stage_cycles; delete from public.leads');
      // Seed old clocks through the real durable historical-row suppression.
      await db.query(`insert into public.leads(id,organization_id,pipeline_id,stage_id,team_id,assigned_user_id,
        assigned_at,first_touch_at,stage_entered_at,board_order_at,operational_effects_suppressed)
        values($1,$2,$3,$4,$5,$6,$7,$8,$7,$7,true)`, [lead, organization, pipeline, stageA, selectedTeam, owner, oldAt, touchAt]);
      await db.query('update public.leads set operational_effects_suppressed=false where id=$1', [lead]);
      if (owner) await db.query(`insert into public.lead_assignment_cycles(organization_id,lead_id,assigned_user_id,cycle_number,assigned_at)
        values($1,$2,$3,1,$4)`, [organization, lead, owner, oldAt]);
    };
    const observe = async () => (await db.query(`select assigned_user_id,
      assigned_at=now() as fresh,assigned_at=$2::timestamptz as preserved,first_touch_at is null as untouched,
      first_touch_at=$3::timestamptz as touch_preserved,stage_entered_at=now() as stage_fresh,
      stage_entered_at=$2::timestamptz as stage_preserved,board_order_at>$2::timestamptz as order_advanced,
      (select count(*)::integer from public.lead_assignment_cycles c where c.lead_id=l.id) as cycles,
      (select count(*)::integer from public.lead_assignment_cycles c where c.lead_id=l.id and ended_at is null) as active_cycles,
      exists(select 1 from public.lead_assignment_cycles c where c.lead_id=l.id and c.ended_at is null
        and c.assigned_user_id=l.assigned_user_id and c.assigned_at=l.assigned_at) as cycle_matches,
      deal_status from public.leads l where id=$1`, [lead, oldAt, touchAt])).rows[0];
    const move = async (explicit) => {
      await db.query('begin');
      try {
        if (explicit === undefined) await db.query('update public.leads set stage_id=$2 where id=$1', [lead, stageB]);
        else await db.query('update public.leads set stage_id=$2,assigned_user_id=$3 where id=$1', [lead, stageB, explicit]);
        const row = await observe(); await db.query('commit'); return row;
      } catch (error) { await db.query('rollback'); throw error; }
    };

    await rule(); await seed();
    const before = await move();
    check(before.assigned_user_id === ownerB && before.preserved && before.touch_preserved,
      'predecessor reproduces changed owner with old assignment/first-touch clocks under real trigger order');
    check(before.cycle_matches && before.cycles === 2, 'predecessor new assignment cycle inherits that wrong old baseline');
    await db.query(await readFile(new URL(migration, root), 'utf8'));

    await seed();
    const changed = await move();
    check(changed.assigned_user_id === ownerB && changed.fresh && changed.untouched, 'stage-only owner change renews assignment and clears old first touch');
    check(changed.active_cycles === 1 && changed.cycles === 2 && changed.cycle_matches, 'actual cycle capture sees the new final owner baseline');
    check(changed.stage_fresh && changed.order_advanced, 'real stage-entry/order clocks still advance');

    await rule(ownerA); await seed();
    const same = await move();
    check(same.assigned_user_id === ownerA && same.preserved && same.touch_preserved && same.cycles === 1,
      'same final owner preserves attendance and does not fabricate an assignment cycle');
    await rule(ownerB);
    await db.query("update public.stage_automations set created_at='2020-01-01'");
    await db.query(`insert into public.stage_automations(organization_id,stage_id,automation_type,action_config,created_at)
      values($1,$2,'change_assignee_on_enter',$3,'2020-01-02')`, [org, stageB, { target_user_id: ownerA }]);
    await seed();
    const legacyLoop = await move();
    check(legacyLoop.assigned_user_id === ownerA && legacyLoop.preserved && legacyLoop.touch_preserved && legacyLoop.cycles === 1,
      'ordered legacy rules B then original A restore original clocks without fabricating an assignment cycle');
    await rule(ownerA);
    for (const explicit of [ownerB, null]) {
      await seed(); const restored = await move(explicit);
      check(restored.assigned_user_id === ownerA && restored.preserved && restored.touch_preserved && restored.cycles === 1,
        'on-enter restoration of original owner undoes clock resets from explicit intermediate owner/null');
    }
    await rule(); await seed();
    const explicitChanged = await move(ownerB);
    check(explicitChanged.fresh && explicitChanged.untouched && explicitChanged.cycle_matches,
      'explicit assignment already matching the rule retains ordinary new-owner semantics');
    await seed(null);
    const assigned = await move();
    check(assigned.assigned_user_id === ownerB && assigned.fresh && assigned.untouched && assigned.cycle_matches,
      'unassigned lead receives a fresh owner and cycle baseline');

    for (const [name, change, restore] of [
      ['inactive user', 'update public.users set is_active=false where id=$1', 'update public.users set is_active=true where id=$1'],
      ['inactive organization member', 'update public.organization_members set is_active=false where user_id=$1', 'update public.organization_members set is_active=true where user_id=$1'],
      ['removed organization member', 'update public.organization_members set deleted_at=now() where user_id=$1', 'update public.organization_members set deleted_at=null where user_id=$1'],
      ['another organization member', `update public.organization_members set organization_id='${foreign}' where user_id=$1`, `update public.organization_members set organization_id='${org}' where user_id=$1`],
      ['inactive team member', 'update public.team_members set is_active=false where user_id=$1', 'update public.team_members set is_active=true where user_id=$1'],
      ['old membership generation', 'update public.team_members set membership_generation=0 where user_id=$1', 'update public.team_members set membership_generation=1 where user_id=$1'],
      ['another team', 'update public.team_members set team_id=null where user_id=$1', `update public.team_members set team_id='${team}' where user_id=$1`],
    ]) {
      await db.query(change, [ownerB]); await seed(); const rejected = await move();
      check(rejected.assigned_user_id === ownerA && rejected.preserved && rejected.touch_preserved && rejected.cycles === 1,
        `${name} cannot change owner or attendance baseline`);
      await db.query(restore, [ownerB]);
    }
    for (const target of [id(99), 'invalid-uuid', '']) {
      await rule(target); await seed(); const rejected = await move();
      check(rejected.assigned_user_id === ownerA && rejected.preserved && rejected.touch_preserved,
        'missing or malformed rule target preserves existing attendance');
    }
    await rule(); await db.query('update public.stage_automations set is_active=false'); await seed();
    const disabled = await move();
    check(disabled.assigned_user_id === ownerA && disabled.preserved && disabled.touch_preserved,
      'disabled rule cannot change owner or attendance baseline');
    await rule(); await seed(ownerA, foreign);
    const foreignLead = await move();
    check(foreignLead.assigned_user_id === ownerA && foreignLead.preserved && foreignLead.touch_preserved,
      'rule from another organization cannot change a lead or clock');
    await seed(ownerA, org, null);
    check((await move()).fresh, 'personal lead without team can receive a valid organization member');
    await seed(); await db.query('begin');
    await db.query('update public.leads set stage_id=stage_id where id=$1', [lead]);
    const unchanged = await observe(); await db.query('commit');
    check(unchanged.preserved && unchanged.touch_preserved && unchanged.stage_preserved, 'same-stage update preserves clocks');

    const insert = async (owner = null, suppressed = false) => {
      await db.query('delete from public.lead_assignment_cycles; delete from public.lead_stage_cycles; delete from public.leads');
      await db.query(`insert into public.leads(id,organization_id,pipeline_id,stage_id,team_id,assigned_user_id,
        assigned_at,first_touch_at,stage_entered_at,board_order_at,operational_effects_suppressed)
        values($1,$2,$3,$4,$5,$6,$7,$8,$7,$7,$9)`, [lead, org, pipeline, stageB, team, owner, oldAt, touchAt, suppressed]);
      return observe();
    };
    for (const owner of [null, ownerA]) {
      await db.query('begin'); const createdLead = await insert(owner); await db.query('commit');
      check(createdLead.assigned_user_id === ownerB && createdLead.fresh && createdLead.untouched && createdLead.cycle_matches,
        'INSERT on-enter change starts the final owner clock after ordinary INSERT setters');
    }
    await db.query('begin'); const sameInsert = await insert(ownerB); await db.query('commit');
    check(sameInsert.fresh && sameInsert.touch_preserved, 'INSERT with the same supplied owner preserves ordinary INSERT/first-touch behavior');
    await db.query('begin'); const historical = await insert(ownerA, true); await db.query('commit');
    check(historical.assigned_user_id === ownerA && historical.preserved && historical.touch_preserved && historical.cycles === 0,
      'durably suppressed historical rows retain all clocks and skip assignment effects');
    await db.query('begin');
    await db.query("select set_config('vimob.historical_import_token','synthetic-token',true)");
    await db.query(`insert into private.historical_lead_import_contexts(transaction_id,token_sha256)
      values(pg_current_xact_id()::text,encode(extensions.digest('synthetic-token','sha256'),'hex'))`);
    const contextSuppressed = await insert(ownerA); await db.query('commit');
    check(contextSuppressed.assigned_user_id === ownerA && contextSuppressed.preserved && contextSuppressed.touch_preserved
      && contextSuppressed.cycles === 0, 'real transaction-bound historical capability still suppresses the complete trigger composition');

    await db.query('begin');
    await db.query("select set_config('vimob.lead_creation_status_scope',$1,true),set_config('vimob.lead_creation_status_phase','defer',true)", [`${org}/${lead}`]);
    await db.query(`insert into public.stage_automations(organization_id,stage_id,automation_type,action_config)
      values($1,$2,'change_deal_status_on_enter','{"deal_status":"won"}')`, [org, stageB]);
    const deferred = await insert(ownerA);
    check(deferred.deal_status === 'open' && deferred.fresh && deferred.untouched, 'creation defer keeps assignee clocks while deferring status');
    await db.query('update public.leads set first_touch_at=$2 where id=$1', [lead, touchAt]);
    await db.query("select set_config('vimob.lead_creation_status_phase','apply',true)");
    await db.query('update public.leads set stage_id=stage_id where id=$1', [lead]);
    const applied = await observe(); await db.query('commit');
    check(applied.deal_status === 'won' && applied.assigned_user_id === ownerB && applied.touch_preserved,
      'creation apply does not rerun assignment or clear a subsequent first touch');

    await rule(); await seed(); await db.query('begin');
    await db.query('update public.leads set stage_id=$2 where id=$1', [lead, stageB]);
    await db.query('rollback');
    const rolledBack = await observe();
    check(rolledBack.assigned_user_id === ownerA && rolledBack.preserved && rolledBack.touch_preserved && rolledBack.cycles === 1,
      'rollback restores ownership, clocks, and assignment cycle atomically');
    console.log(`PASS ${checks} PostgreSQL checks: old bug reproduced, real assignment/clock/cycle trigger composition, synthetic owned database only.`);
    return checks;
  } finally {
    if (db) { await db.query('rollback').catch(() => undefined); await db.end(); }
    if (created) await admin.query(`drop database "${database}"`);
    await admin.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runAssigneeClockPostgres(process.argv[2], process.argv[3]);
}
