import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

// Deliberately accepts no database URL, container name, .env or remote settings.
// Creates and destroys only its own networkless, portless, tmpfs PostgreSQL.
assert.equal(process.argv[2], 'LOCAL_WRITE_TEST', 'Usage: node scripts/supabase/test-activity-read-scope-postgres.mjs LOCAL_WRITE_TEST');
assert.equal(process.argv.length, 3, 'No existing database/container target is accepted');
const root = new URL('../../', import.meta.url);
const baselinePath = 'supabase/reconciliation/local-bootstrap/baseline-20261016.sql';
const migrationPath = 'supabase/migrations/20261018210058_restrict_activity_reads_to_visible_leads_and_active_session.sql';
const projectionMigrationPath = 'supabase/migrations/20261018222847_restrict_activity_sensitive_columns_to_canonical_api.sql';
const runId = randomUUID();
const container = `vimob-dashboard-activities-${runId.slice(0, 8)}`;
const context = 'desktop-linux';
const image = 'postgres:17-alpine';
let created = false;
let assertions = 0;

function docker(args, input, allowFailure = false) {
  const result = spawnSync('docker', ['--context', context, ...args], {
    input, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (!allowFailure) assert.equal(result.status, 0, `${args[0]} failed: ${result.stderr || result.error?.message}`);
  return result;
}
function sql(input) {
  const result = docker(['exec', '-i', container, 'psql', '-X', '-qAt', '--no-password',
    '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], input);
  const passes = result.stderr.match(/NOTICE:\s+PASS:.*$/gm) ?? [];
  assertions += passes.length;
  for (const line of passes) process.stdout.write(`${line.replace(/^NOTICE:\s+/, '')}\n`);
  return result.stdout;
}
function functionSQL(source, name) {
  const start = source.indexOf(`CREATE FUNCTION ${name}(`);
  assert.ok(start >= 0, `Missing reviewed function ${name}`);
  const rest = source.slice(start);
  const body = /\bAS (\$[A-Za-z_0-9]*\$)/.exec(rest);
  assert.ok(body, `Missing dollar body for ${name}`);
  const end = rest.indexOf(body[1], body.index + body[0].length);
  assert.ok(end > body.index, `Missing function terminator for ${name}`);
  return rest.slice(0, end + body[1].length + 1);
}
function policySQL(source, table, name) {
  const start = source.indexOf(`CREATE POLICY ${name} ON public.${table} `);
  assert.ok(start >= 0, `Missing reviewed policy ${table}.${name}`);
  const end = source.indexOf(';', start);
  return source.slice(start, end + 1);
}

try {
  const endpoint = docker(['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}']).stdout.trim();
  assert.ok(endpoint.startsWith('npipe:////./pipe/') || endpoint.startsWith('unix:///'), 'Docker endpoint must be a local OS pipe');
  docker(['image', 'inspect', image, '--format', '{{.Id}}']); // Never pull images.
  docker(['run', '--detach', '--pull=never', '--name', container,
    '--label', `vimob.dashboard.activity-run=${runId}`, '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data:rw', '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', image]);
  created = true;
  const config = JSON.parse(docker(['inspect', container]).stdout)[0];
  assert.equal(config.HostConfig.NetworkMode, 'none');
  assert.equal(Object.keys(config.HostConfig.PortBindings ?? {}).length, 0);
  assert.ok(config.HostConfig.Tmpfs['/var/lib/postgresql/data']);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (docker(['exec', container, 'pg_isready', '-U', 'postgres'], undefined, true).status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, 'Exclusive fixture PostgreSQL did not become ready');
  process.stdout.write(`Local engine: ${sql('select version();').trim()}\n`);
  const source = await readFile(new URL(baselinePath, root), 'utf8');
  sql(await readFile(new URL('supabase/tests/activity_read_scope.fixture.sql', root), 'utf8'));
  const functions = [
    'auth.uid', 'auth.jwt', 'private.is_super_admin', 'private.is_org_member',
    'private.get_user_organization_id', 'private.is_admin', 'private.has_org_role',
    'private.has_permission', 'private.user_has_permission_in_organization', 'private.user_has_permission',
    'private.lead_view_all_granted', 'private.can_read_lead', 'private.can_access_lead_by_id',
    'public.is_super_admin', 'public.is_admin', 'public.user_has_permission', 'private.has_active_lead_read_session',
    'private.queue_runtime_actor_active', 'private.queue_runtime_actor_admin', 'private.queue_pool_audience',
    'private.queue_pool_read_access', 'private.queue_pool_related_read_access',
  ];
  sql('set check_function_bodies=off;\n' + functions.map(name => functionSQL(source, name)).join('\n'));
  const policies = {
    leads: ['leads_select_active_broker_team', 'leads_select_requires_active_session',
      'vimob_active_membership_guard', 'queue_pool_private_read'],
    activities: ['vimob_canonical_ad7468a679b0911da5b9a704', 'vimob_canonical_d2f1d45677b08252ccd6422e',
      'vimob_canonical_7fd29cb5715a1c2ca34af2ac', 'vimob_canonical_f30f9e34e9a9422480976534',
      'vimob_active_membership_guard', 'queue_pool_related_private_read'],
  };
  sql(Object.entries(policies).flatMap(([table, names]) => names.map(name => policySQL(source, table, name))).join('\n'));
  sql(`set role authenticated; select fixture.actor(1);
    select fixture.check(exists(select 1 from public.activities where id=fixture.id(212)), 'BEFORE: ordinary user sees unrelated broker history');
    select fixture.actor(2);
    select fixture.check(exists(select 1 from public.activities where id=fixture.id(211)), 'BEFORE: leader sees unrelated broker history');
    select fixture.actor(1,'recovery');
    select fixture.check(exists(select 1 from public.activities where id=fixture.id(231)), 'BEFORE: recovery session reads organization activity');`);
  const before = sql(`select md5(string_agg(polname||':'||pg_get_expr(polqual,polrelid),',' order by polname)) from pg_policy
    where polrelid='public.activities'::regclass;`);
  const migration = await readFile(new URL(migrationPath, root), 'utf8');
  // The migration must abort atomically if a required upstream security gate
  // is missing. This mutation is restricted to our exclusive fixture database.
  sql('drop policy leads_select_requires_active_session on public.leads;');
  const rejected = docker(['exec', '-i', container, 'psql', '-X', '-qAt', '--no-password',
    '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], migration, true);
  assert.notEqual(rejected.status, 0, 'Migration unexpectedly accepted a missing lead session policy');
  assert.match(rejected.stderr, /activity_read_preflight_failed/, 'Migration must reject the expected precondition');
  process.stdout.write('PASS: missing prerequisite rejects migration with activity_read_preflight_failed.\n');
  assert.match(before.trim(), /^[0-9a-f]{32}$/, 'Expected a safe catalog fingerprint');
  sql(`select fixture.check(not exists(select 1 from pg_policies where schemaname='public'
      and tablename='activities' and policyname='activities_select_requires_visible_lead_and_session'),
      'failed preflight creates no activity policy');
    select fixture.check((select md5(string_agg(polname||':'||pg_get_expr(polqual,polrelid),',' order by polname))
      from pg_policy where polrelid='public.activities'::regclass)='${before.trim()}',
      'failed preflight preserves every prior activity policy');`);
  sql(policySQL(source, 'leads', 'leads_select_requires_active_session'));
  sql(migration);
  const after = sql(`select md5(string_agg(polname||':'||pg_get_expr(polqual,polrelid),',' order by polname)) from pg_policy
    where polrelid='public.activities'::regclass and polname<>'activities_select_requires_visible_lead_and_session';`);
  assert.equal(after, before, 'Migration must preserve every preexisting activity policy');
  sql(await readFile(new URL('supabase/tests/activity_read_scope.test.sql', root), 'utf8'));
  sql(`insert into auth.sessions values(fixture.id(101),fixture.id(1)),(fixture.id(104),fixture.id(4));
    update public.activities set type='property_selected',content='PRIVATE-CODE Private property',
      metadata='{"property_id":"10000000-0000-4000-8000-000000009001","property_price":950000,"commission_percentage":7.5}'
      where id=fixture.id(211);
    set role authenticated; select fixture.actor(1);
    select fixture.check((select content='PRIVATE-CODE Private property' and metadata->>'commission_percentage'='7.5'
      from public.activities where id=fixture.id(211)), 'BEFORE: lead reader can fetch raw private property and commission data');`);
  const projectionMigration = await readFile(new URL(projectionMigrationPath, root), 'utf8');
  const aclFingerprintSQL = `select md5(coalesce(c.relacl::text,'')||coalesce((select string_agg(a.attnum||':'||coalesce(a.attacl::text,''),',' order by a.attnum)
    from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),''))
    from pg_class c where c.oid='public.activities'::regclass;`;
  const originalACL = sql(aclFingerprintSQL);
  sql('alter policy activities_select_requires_visible_lead_and_session on public.activities to service_role;');
  const projectionRejected = docker(['exec', '-i', container, 'psql', '-X', '-qAt', '--no-password',
    '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], projectionMigration, true);
  assert.notEqual(projectionRejected.status, 0);
  assert.match(projectionRejected.stderr, /activity_projection_preflight_failed/);
  assert.equal(sql(aclFingerprintSQL), originalACL, 'Rejected projection preflight must preserve ACL');
  process.stdout.write('PASS: projection preflight rejects missing authenticated session ceiling without ACL changes.\n');
  sql('alter policy activities_select_requires_visible_lead_and_session on public.activities to authenticated;');
  // A grant inherited through an unexpected role must abort, not silently leave
  // raw SELECT available after the nominal column restriction.
  sql('create role fixture_activity_reader; grant select on public.activities to fixture_activity_reader; grant fixture_activity_reader to authenticated;');
  const inheritedACL = sql(aclFingerprintSQL);
  const inheritedRejected = docker(['exec', '-i', container, 'psql', '-X', '-qAt', '--no-password',
    '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], projectionMigration, true);
  assert.notEqual(inheritedRejected.status, 0);
  assert.match(inheritedRejected.stderr, /activity_projection_postflight_failed/);
  assert.equal(sql(aclFingerprintSQL), inheritedACL, 'Rejected inherited privilege must roll back every ACL mutation');
  process.stdout.write('PASS: inherited SELECT aborts projection transaction with every prior ACL preserved.\n');
  sql('revoke fixture_activity_reader from authenticated; revoke select on public.activities from fixture_activity_reader; drop role fixture_activity_reader;');
  const policiesBeforeProjection = sql(`select md5(string_agg(polname||':'||pg_get_expr(polqual,polrelid),',' order by polname))
    from pg_policy where polrelid='public.activities'::regclass;`);
  const mutationPrivileges = `select string_agg(role||':'||privilege||':'||has_table_privilege(role,'public.activities',privilege),',' order by role,privilege)
    from unnest(array['anon','authenticated','service_role']) role cross join unnest(array['INSERT','UPDATE','DELETE']) privilege;`;
  const mutationsBeforeProjection = sql(mutationPrivileges);
  // Explicit old column/PUBLIC grants must also be removed by the real DDL.
  sql('grant select(content) on public.activities to public; grant select(metadata) on public.activities to authenticated,anon;');
  sql(projectionMigration);
  assert.equal(sql(mutationPrivileges), mutationsBeforeProjection, 'Projection migration must preserve mutation privileges');
  assert.equal(sql(`select md5(string_agg(polname||':'||pg_get_expr(polqual,polrelid),',' order by polname))
    from pg_policy where polrelid='public.activities'::regclass;`), policiesBeforeProjection, 'Projection migration must preserve every RLS policy');
  sql(await readFile(new URL('supabase/tests/activity_projection.test.sql', root), 'utf8'));
  process.stdout.write(`PASS: ${assertions} SQL assertions; existing policies unchanged. Composition fixture, not full schema replay or Realtime delivery.\n`);
} finally {
  if (created) {
    const actual = docker(['inspect', container, '--format', '{{index .Config.Labels "vimob.dashboard.activity-run"}}']).stdout.trim();
    assert.equal(actual, runId, 'Refusing cleanup: container ownership label changed');
    docker(['rm', '--force', container]);
    process.stdout.write('Exclusive networkless fixture container removed.\n');
  }
}
