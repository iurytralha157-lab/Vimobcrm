// Reduced, disposable PostgreSQL proof for Dashboard's direct read boundary.
// Uses real migration/helper definitions, synthetic tables and auth.uid(). This
// is not a Supabase reset, complete migration-chain check, or production audit.
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.VIMOB_RUN_DASHBOARD_RLS_DB_TESTS !== "LOCAL_WRITE_TEST") {
  throw new Error("Set VIMOB_RUN_DASHBOARD_RLS_DB_TESTS=LOCAL_WRITE_TEST for the disposable Docker fixture.");
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
if (args.length % 2 !== 0 || args.some((arg, index) => index % 2 === 0 &&
    (!["--container", "--label"].includes(arg) || args.indexOf(arg) !== index))) {
  throw new Error("Only one --container and one --label option are supported.");
}
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const container = option("--container", "vimob-dashboard-schema-20261012");
const label = option("--label", "dashboard-schema-20261012");
if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(container ?? "") ||
    !/^dashboard-schema-[a-zA-Z0-9_-]+$/.test(label ?? "")) {
  throw new Error("An explicitly named dashboard fixture container and label are required.");
}
const database = `dashboard_permissions_${randomUUID().replaceAll("-", "")}`;
let created = false;
let containerID;

function docker(argv, input) {
  const result = spawnSync("docker", argv, {
    input, encoding: "utf8", maxBuffer: 12 * 1024 * 1024, timeout: 60_000,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || String(result.error));
  return result.stdout;
}
function verifyTarget() {
  const [state] = JSON.parse(docker(["inspect", container]));
  if (state.Config?.Labels?.["vimob.test"] !== label ||
      (containerID && state.Id !== containerID)) {
    throw new Error("Docker fixture identity or vimob.test label changed; refusing database operations.");
  }
  const bindings = Object.values(state.NetworkSettings?.Ports ?? {}).flatMap((value) => value ?? []);
  if (bindings.some((binding) => !["127.0.0.1", "::1"].includes(binding.HostIp))) {
    throw new Error("Dashboard fixture published ports must be bound only to loopback.");
  }
  containerID = state.Id;
}
function psql(db, sql) {
  if (!containerID) throw new Error("Docker fixture identity must be verified before database operations.");
  return docker(["exec", "-i", containerID, "psql", "-U", "postgres", "-d", db,
    "-v", "ON_ERROR_STOP=1", "-P", "pager=off"], sql);
}
const readMigration = (name) => readFileSync(path.join(root, "supabase", "migrations", name), "utf8");
function extractFunction(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Migration function marker missing: ${marker}`);
  const rest = source.slice(start);
  const opening = rest.match(/\bas\s+(\$[a-zA-Z0-9_]*\$)/i);
  if (!opening) throw new Error("Migration function delimiter missing.");
  const end = rest.indexOf(opening[1], opening.index + opening[0].length);
  if (end < 0) throw new Error("Migration function terminator missing.");
  return `${rest.slice(0, end + opening[1].length)};\n`;
}
function fixtureSQL() {
  const baseline = readMigration("20260722000000_production_public_private_baseline.sql");
  const generation = readMigration("20261009030225_membership_access_generation.sql");
  const permissions = readMigration("20261009034132_scope_legacy_permission_helper_to_active_membership.sql");
  const scoped = readMigration("20261009061438_whatsapp_team_generation_read_scope.sql");
  let sql = `
create schema auth; create schema private; create schema extensions;
create extension pgtap with schema extensions;
set search_path = public, extensions;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
create table auth.users (
  id uuid primary key, instance_id uuid, aud text, role text, email text,
  encrypted_password text, email_confirmed_at timestamptz, raw_app_meta_data jsonb,
  raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz,
  confirmation_token text, email_change text, email_change_token_new text, recovery_token text);
create table auth.sessions (id uuid primary key, user_id uuid references auth.users(id),
  created_at timestamptz, updated_at timestamptz);
create table public.organizations (id uuid primary key, name text, slug text unique, is_active boolean);
create table public.users (id uuid primary key, organization_id uuid, name text, email text, role text, is_active boolean);
create table public.organization_members (organization_id uuid, user_id uuid, role text,
  is_active boolean, deleted_at timestamptz, primary key(user_id, organization_id));
create table public.teams (id uuid primary key, organization_id uuid, name text, is_active boolean);
create table public.team_members (organization_id uuid, team_id uuid, user_id uuid,
  is_active boolean, is_leader boolean, primary key(team_id,user_id));
create table public.round_robin_members (organization_id uuid, user_id uuid, is_active boolean);
create table public.leads (id uuid primary key, organization_id uuid, assigned_user_id uuid,
  team_id uuid, name text, source text);
create table public.lead_attachments (id uuid primary key, lead_id uuid references public.leads(id),
  file_name text, file_url text);
create table public.user_permission_overrides (organization_id uuid, user_id uuid,
  permission_key text, allowed boolean, primary key(organization_id,user_id,permission_key));
create table public.organization_roles (id uuid primary key, organization_id uuid, name text, is_active boolean);
create table public.available_permissions (id uuid primary key default gen_random_uuid(), key text unique);
insert into public.available_permissions (key) values ('dashboard_view'), ('lead_view_all'), ('lead_view_own'), ('lead_view_team');
create table public.organization_role_permissions (organization_role_id uuid,
  permission_key text, organization_id uuid, role_id uuid, permission_id uuid);
create table public.user_organization_roles (user_id uuid, organization_role_id uuid,
  organization_id uuid, role_id uuid, is_active boolean);
`;
  const picker = generation.indexOf("-- The canonical picker below replaces only candidate eligibility.");
  if (picker < 0) throw new Error("Generation fixture extraction drifted.");
  // Extract the real column/trigger prerequisites, excluding unrelated routing.
  sql += generation.slice(0, picker);
  sql += extractFunction(readMigration("20260803202340_hotfix_auth_user_least_privilege.sql"), "create or replace function private.is_super_admin()");
  sql += extractFunction(readMigration("20260827000000_distinguish_disabled_and_deleted_organization_members.sql"), "create or replace function private.is_org_member(");
  sql += extractFunction(baseline, 'CREATE OR REPLACE FUNCTION "private"."has_org_role"');
  sql += extractFunction(baseline, 'CREATE OR REPLACE FUNCTION "private"."has_permission"');
  sql += extractFunction(permissions, "create or replace function private.user_has_permission_in_organization(");
  sql += extractFunction(permissions, "create or replace function private.lead_view_all_granted(");
  const start = scoped.indexOf("create or replace function private.can_read_lead(");
  const end = scoped.indexOf("create or replace function private.whatsapp_actor_can_read_lead(");
  if (start < 0 || end <= start) throw new Error("Scoped helper extraction drifted.");
  sql += scoped.slice(start, end);
  sql += extractFunction(readMigration("20260924142938_align_lead_visibility_with_active_broker_teams.sql"), "create or replace function private.can_read_lead_by_id(");
  sql += `
revoke all on function private.can_read_lead_by_id(uuid) from public, anon;
grant execute on function private.can_read_lead_by_id(uuid) to authenticated, service_role;
grant usage on schema public, private, auth, extensions to authenticated;
grant select on public.leads, public.lead_attachments to authenticated, service_role;
alter table public.leads enable row level security;
create policy leads_select_active_broker_team on public.leads for select to authenticated
  using (private.can_read_lead(organization_id,assigned_user_id,team_id));
alter table public.lead_attachments enable row level security;
create policy "Users can view accessible lead attachments" on public.lead_attachments for select to authenticated
  using (private.can_read_lead_by_id(lead_id));
set check_function_bodies = off;
`;
  // These real legacy definitions are never executed. Their unrelated platform
  // dependencies are deliberately absent; only their EXECUTE boundary is tested.
  for (const name of ["get_dashboard_stats", "get_dashboard_team_lead_ids", "get_funnel_data", "get_lead_sources_data"]) {
    sql += extractFunction(baseline, `CREATE OR REPLACE FUNCTION "public"."${name}"`);
  }
  sql += `
set check_function_bodies = on;
create function public.get_dashboard_stats(p_scope text) returns json
  language sql security definer as $$select '{}'::json$$;
grant execute on all functions in schema public to anon, authenticated, service_role;
`;
  // Seed an old explicit client grant, including a synthetic overload. The new
  // migration must remove it without depending on the installation's old ACL.
  sql += readMigration("20261009061000_lock_legacy_team_rpc_gateway.sql");
  return { sql, readHelper: scoped.slice(start, end) };
}

try {
  verifyTarget();
  console.log(`Disposable Dashboard fixture database: ${database} (container ${container}).`);
  // Mark the unique task-owned name before CREATE so an unknown Docker result
  // still reaches verified cleanup; IF EXISTS handles failure before creation.
  created = true;
  psql("postgres", `create database "${database}";`);
  const fixture = fixtureSQL();
  psql(database, fixture.sql);
  const migration = readMigration("20261012181651_enforce_own_lead_read_permission.sql");
  // Simulate a stale helper without generation fencing. A rejected migration
  // must leave both the helper and the seeded client RPC grant untouched.
  const staleHelper = fixture.readHelper
    .replaceAll("leader_membership.membership_generation = leader.membership_generation", "1 = 1")
    .replaceAll("broker_organization_member.membership_generation = broker_member.membership_generation", "1 = 1");
  if (staleHelper === fixture.readHelper) throw new Error("Generation preflight fixture drifted.");
  psql(database, staleHelper);
  let rejected = false;
  try {
    psql(database, migration);
  } catch (error) {
    if (!String(error).includes("own_lead_read_preflight_failed")) throw error;
    rejected = true;
  }
  if (!rejected) throw new Error("Own read migration accepted a stale generation helper.");
  const unchanged = psql(database, `select
    strpos(pg_get_functiondef('private.can_read_lead(uuid,uuid,uuid)'::regprocedure::oid), 'denied_own_permission') = 0
    and has_function_privilege('authenticated', 'public.get_dashboard_stats()', 'execute') as untouched;`);
  if (!/^\s*t\s*$/m.test(unchanged)) throw new Error("Rejected migration changed the fixture before its preflight passed.");
  psql(database, fixture.readHelper);
  psql(database, migration);
  console.log("Dashboard read migration preflight rejected stale generation scope without partial changes.");
  const testSQL = readFileSync(path.join(root, "supabase", "tests", "lead_own_permission_read_parity.test.sql"), "utf8");
  const expected = Number(testSQL.match(/select plan\((\d+)\)/i)?.[1]);
  const output = psql(database, testSQL);
  const passed = output.match(/^\s*ok \d+ - /gm)?.length ?? 0;
  if (/^\s*not ok \d+|Looks like you (?:failed|planned)/im.test(output) || passed !== expected) {
    throw new Error(output);
  }
  console.log(`Dashboard read permission fixture: ${passed}/${expected} pgTAP assertions passed (reduced schema, synthetic data).`);
  const sessionMigration = readMigration("20261012201751_restrict_lead_data_api_reads_to_active_session.sql");
  // A stale read contract must reject this migration without leaving a helper or policy behind.
  psql(database, fixture.readHelper);
  let sessionRejected = false;
  try { psql(database, sessionMigration); } catch (error) {
    if (!String(error).includes("lead_session_read_preflight_failed")) throw error;
    sessionRejected = true;
  }
  if (!sessionRejected) throw new Error("Session read migration accepted a stale own-permission helper.");
  const noPartialSession = psql(database, `select
    to_regprocedure('private.has_active_lead_read_session()') is null
    and not exists (select 1 from pg_policies where policyname in (
      'leads_select_requires_active_session', 'lead_attachments_select_requires_active_session')) as untouched;`);
  if (!/^\s*t\s*$/m.test(noPartialSession)) throw new Error("Rejected session migration left partial changes.");
  psql(database, migration);
  psql(database, sessionMigration);
  const sessionSQL = readFileSync(path.join(root, "supabase", "tests", "lead_active_session_read.test.sql"), "utf8");
  const sessionExpected = Number(sessionSQL.match(/select plan\((\d+)\)/i)?.[1]);
  const sessionOutput = psql(database, sessionSQL);
  const sessionPassed = sessionOutput.match(/^\s*ok \d+ - /gm)?.length ?? 0;
  if (/^\s*not ok \d+|Looks like you (?:failed|planned)/im.test(sessionOutput) || sessionPassed !== sessionExpected) {
    throw new Error(sessionOutput);
  }
  console.log(`Active session read fixture: ${sessionPassed}/${sessionExpected} pgTAP assertions passed (two tenants, synthetic data).`);
} finally {
  if (created) {
    verifyTarget();
    if (!/^dashboard_permissions_[0-9a-f]{32}$/.test(database)) throw new Error("Cleanup database scope is invalid.");
    psql("postgres", `drop database if exists "${database}" with (force);`);
    console.log("Disposable Dashboard permission database removed after verified cleanup.");
  }
}
