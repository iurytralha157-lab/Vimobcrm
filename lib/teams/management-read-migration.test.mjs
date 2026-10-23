import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migrations = resolve(process.cwd(), "supabase/migrations");
const names = readdirSync(migrations).filter((name) => name.endsWith("_harden_management_team_data_api_reads.sql"));
assert.equal(names.length, 1, "one forward migration must own the team read boundary");
const sql = readFileSync(resolve(migrations, names[0]), "utf8");
const executable = sql.replace(/--[^\n]*/g, "");
const fixture = readFileSync(resolve(process.cwd(), "supabase/tests/management_team_data_api_reads.test.sql"), "utf8");

test("team read hardening preserves selector grants and adds only restrictive client SELECT policies", () => {
  assert.equal((executable.match(/as restrictive for select to authenticated/gi) || []).length, 3);
  assert.doesNotMatch(executable, /drop\s+policy|revoke\s+select|revoke[^;]+on\s+table|grant[^;]+on\s+table|alter\s+role/i);
  assert.match(executable, /on public\.teams[\s\S]+on public\.team_members[\s\S]+on public\.team_pipelines/);
  assert.match(executable, /p_pipeline_id is not null[\s\S]+pipeline\.organization_id = p_organization_id/);
});

test("private policy lookups bind live session, account, selected organization and membership generation", () => {
  assert.match(executable, /not private\.has_active_lead_read_session\(\)/);
  assert.match(executable, /private\.get_user_organization_id\(\) is distinct from p_organization_id/);
  assert.match(executable, /account\.id = actor_id and coalesce\(account\.is_active, false\)/);
  assert.match(executable, /membership\.membership_generation = leader\.membership_generation/);
  assert.match(executable, /membership\.membership_generation = p_membership_generation/);
  assert.match(executable, /security definer set search_path = ''/);
  assert.doesNotMatch(executable, /user_metadata|raw_user_meta_data|auth\.jwt\(\)\s*->/);
  assert.match(executable, /revoke all on function[\s\S]+from public, anon, authenticated, service_role/);
  assert.match(executable, /grant execute on function[\s\S]+to authenticated/);
});

test("SQL fixture covers permission implications, manager leadership, sessions and tenant boundaries", () => {
  for (const scenario of ["leader default", "manager who is a leader", "TeamManage implies TeamView", "effective read and management denied", "inactive custom role", "foreign tenant member", "revoked SuperAdmin session", "revoked admin session", "pipeline selector remains usable", "globally suspended co-leader", "reinvitation does not resurrect", "contradictory legacy aliases", "legacy composite role grant expands", "composite override is ignored", "canonical denials remove team read implied by the composite role grant"]) assert.ok(fixture.includes(scenario), scenario);
  assert.match(fixture, /begin;/);
  assert.match(fixture, /rollback;\s*$/);
});
