import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadCloudSource, classifyBlock } from './cloud-baseline-contract.mjs';
import { inventoryDump } from './cloud-baseline-plan.mjs';
import { buildCloudExport, rehearsalGuard } from './cloud-export-build.mjs';
import { statements, assertDDL, assertReferenceInsert, isReviewedPrologue, isReviewedStorageSetting } from './cloud-export-sql.mjs';
import { writeCloudExport } from './cloud-export.mjs';
import { promoteCloudExport } from './cloud-export-promote.mjs';
import { sha256 } from '../supabase/local-schema-baseline-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = { kind: 'vimob-cloud-staging-target-v1', environment: 'staging', projectRef: 'lfkfuhvjvqgwyikzcfep', supabaseUrl: 'https://lfkfuhvjvqgwyikzcfep.supabase.co' };
const database = 'vimob_cloud_rehearsal_20261023';
const source = await loadCloudSource(root);
const draft = buildCloudExport(source, { target, rehearsalDatabase: database });
const runId = 'e8707b81-a36a-4934-b82b-049dbfb39452';
const readback = { observedAtUTC: '2026-10-23T20:00:00Z', project: { id: target.projectRef, ref: target.projectRef,
  organization_id: 'snqyytbmmbfasotklrje', name: 'vimob-homologacao', status: 'ACTIVE_HEALTHY' } };
const promote = (change = {}) => promoteCloudExport(draft, { target, readback, sentinelRunId: runId, now: Date.parse(readback.observedAtUTC), ...change });

test('canonical export contains only scoped drafts, exact static tables and bounded TOC phases', () => {
  assert.equal(draft.manifest.ready, false); assert.equal(draft.manifest.remoteApplySupported, false);
  assert.equal(draft.manifest.source.prefixMigrations, 238);
  assert.deepEqual(draft.manifest.staticReferenceInsertCounts, {
    'private.queue_timezone_catalog': 1196, 'public.admin_subscription_plans': 3,
    'public.available_permissions': 38, 'public.help_articles': 30, 'public.home_publications': 4 });
  assert.ok(Object.keys(draft.files).filter(name => name.startsWith('10-domain-')).length > 1);
  for (const [name, sql] of Object.entries(draft.files)) {
    assert.ok(sql.startsWith(rehearsalGuard(target, database)));
    assert.ok(sql.endsWith('\nCOMMIT;\n'));
    assert.ok(Buffer.byteLength(sql) < 500_000, `Phase exceeds the reviewed size limit: ${name}`);
    assert.equal(sha256(sql), draft.manifest.files.find(row => row.file === name).sha256);
    assert.ok(!sql.includes('SET session_replication_role'));
  }
  assert.ok(!draft.files['22-realtime-overlays.sql'].includes('CREATE PUBLICATION'));
  assert.ok(draft.files['22-realtime-overlays.sql'].includes('native_realtime_publication_requires_review'));
  assert.ok(!draft.files['00-extension-proposals.sql'].includes(' VERSION '));
});

test('application function statements retain exact original body/proconfig/owner source', () => {
  const domain = Object.entries(draft.files).filter(([name]) => name.startsWith('10-domain-')).map(([, sql]) => sql).join('\n');
  assert.ok(domain.includes('GRANT USAGE ON SCHEMA private TO authenticated;'));
  assert.ok(domain.includes('GRANT USAGE ON SCHEMA private TO service_role;'));
  assert.ok(domain.includes('GRANT USAGE ON SCHEMA private TO anon;'));
  assert.ok(domain.includes('GRANT USAGE ON SCHEMA public TO postgres;'));
  let checked = 0;
  for (const artifact of source.artifacts.filter(row => row.kind === 'schema')) {
    for (const block of inventoryDump(artifact.source, artifact.file)) {
      if (block.type !== 'FUNCTION' || classifyBlock(block) !== 'domain-candidate') continue;
      for (const statement of statements(block.source)) {
        if (statement.tokens[0].value === 'set') continue;
        assert.ok(domain.includes(statement.source), 'Canonical function statement changed.');
      }
      checked++;
    }
  }
  assert.ok(checked > 700);
});

test('scoped defaults reset leaves native defaults and PostgreSQL built-ins intact', () => {
  const first = draft.files['10-domain-001.sql'];
  assert.ok(first.includes('unexpected_postgres_global_defaults_require_review'));
  assert.ok(first.includes('unexpected_scoped_defaults_require_review'));
  assert.ok(first.includes('IN SCHEMA public REVOKE ALL ON FUNCTIONS'));
  assert.ok(first.includes('IN SCHEMA private REVOKE ALL ON TYPES'));
  assert.ok(!first.includes('IN SCHEMA storage REVOKE'));
  assert.ok(!first.includes('FOR ROLE supabase_admin'));
});

test('lexer preserves internal semicolons and rejects psql escapes and malformed bodies', () => {
  const sql = "CREATE FUNCTION public.safe() RETURNS text LANGUAGE sql AS $body$ SELECT 'semi;colon'; $body$;\nALTER FUNCTION public.safe() OWNER TO postgres;";
  assert.equal(statements(sql).length, 2);
  assert.equal(statements(sql)[0].source, sql.slice(0, sql.indexOf('$body$;') + '$body$;'.length));
  assert.throws(() => statements('\\connect another_database\n'));
  assert.throws(() => statements('SELECT $body$unterminated;'));
  assert.throws(() => statements("SELECT 'unterminated;"));
  assert.throws(() => statements('SELECT 1'));
});

test('DDL rejects platform targets, role grants, foreign owners and session controls', () => {
  for (const sql of ['CREATE TABLE auth.users(id integer);', 'ALTER FUNCTION public.test() OWNER TO supabase_admin;',
    'GRANT postgres TO anon;', 'GRANT SELECT ON TABLE public.test, auth.users TO anon;',
    'ALTER TABLE public.test SET SCHEMA auth;', 'DROP SCHEMA public CASCADE;', 'SELECT pg_sleep(1);']) {
    assert.throws(() => assertDDL(statements(sql)[0], ['public', 'private']));
  }
  assert.equal(isReviewedPrologue(statements('SET ROLE supabase_admin;')[0]), false);
  assert.equal(isReviewedStorageSetting(statements("SET default_tablespace = 'unreviewed';")[0]), false);
  assertDDL(statements('CREATE CONSTRAINT TRIGGER safe AFTER INSERT ON public.test DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.safe();')[0], ['public', 'private']);
  assertDDL(statements("CREATE TABLE public.test(owner text DEFAULT 'owner');")[0], ['public', 'private']);
});

test('static data accepts only allowlisted literal INSERT and excludes operational rows', () => {
  const allowlist = source.manifest.referenceDataTables;
  assert.equal(assertReferenceInsert(statements("INSERT INTO public.available_permissions(name) VALUES ('synthetic');")[0], allowlist), 'public.available_permissions');
  for (const sql of ["INSERT INTO auth.users(id) VALUES ('synthetic');", "INSERT INTO public.users(name) VALUES ('synthetic');",
    'DELETE FROM public.available_permissions;', 'INSERT INTO public.available_permissions(name) SELECT name FROM public.users;',
    'INSERT INTO public.available_permissions(name) VALUES(pg_sleep(1));',
    "INSERT INTO public.available_permissions(name) VALUES('synthetic') ON CONFLICT(name) DO UPDATE SET name='changed';"]) {
    assert.throws(() => assertReferenceInsert(statements(sql)[0], allowlist));
  }
});

test('source artifact changes, unsafe rehearsal database and production target fail closed', () => {
  const changed = { ...source, artifacts: source.artifacts.map((artifact, index) => index ? artifact : { ...artifact, source: `${artifact.source}\nDROP SCHEMA public CASCADE;` }) };
  assert.throws(() => buildCloudExport(changed, { target, rehearsalDatabase: database }));
  assert.throws(() => buildCloudExport(source, { target, rehearsalDatabase: 'postgres' }));
  assert.throws(() => buildCloudExport(source, { target: { ...target, projectRef: 'iemalzlfnbouobyjwlwi', supabaseUrl: 'https://iemalzlfnbouobyjwlwi.supabase.co' }, rehearsalDatabase: database }));
});

test('Cloud promotion binds every transaction to staging sentinel, phase order and source hashes', () => {
  const promoted = promote();
  assert.equal(promoted.manifest.trialPassed, false); assert.equal(promoted.manifest.ready, false);
  for (const [name, sql] of Object.entries(promoted.files)) {
    assert.ok(sql.includes('vimob_cloud_staging.sentinel'));
    assert.ok(sql.includes('vimob_cloud_staging.phase_history'));
    assert.ok(sql.includes('cloud_trial_phase_order_or_hash_mismatch'));
    assert.ok(sql.includes(runId)); assert.ok(sql.includes(target.projectRef));
    assert.ok(!sql.includes('vimob.staging_project_ref'));
    assert.equal(sha256(sql), promoted.manifest.files.find(row => row.file === name).sha256);
  }
  assert.ok(Object.values(promoted.files)[1].includes('00-extension-proposals.sql'));
});

test('Cloud promotion refuses stale/wrong project evidence and tampered SQL/guards', () => {
  assert.throws(() => promote({ now: Date.parse(readback.observedAtUTC) + 16 * 60_000 }));
  assert.throws(() => promote({ readback: { ...readback, project: { ...readback.project, ref: 'iemalzlfnbouobyjwlwi' } } }));
  assert.throws(() => promote({ readback: { ...readback, project: { ...readback.project, organization_id: 'another-org' } } }));
  const tampered = { ...draft, files: { ...draft.files, '00-extension-proposals.sql': `${draft.files['00-extension-proposals.sql']}SELECT 1;` } };
  assert.throws(() => promoteCloudExport(tampered, { target, readback, sentinelRunId: runId, now: Date.parse(readback.observedAtUTC) }));
});

test('writer keeps SQL outside Git and refuses existing output directories', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'vimob-cloud-export-test-'));
  t.after(async () => {
    assert.ok(path.resolve(temporary).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
    await fs.rm(temporary, { recursive: true, force: true });
  });
  const sample = { files: { '10-domain-001.sql': 'SELECT 1;\n' }, manifest: { ready: false } };
  const output = path.join(temporary, 'package');
  await writeCloudExport(output, sample);
  assert.equal(await fs.readFile(path.join(output, '10-domain-001.sql'), 'utf8'), 'SELECT 1;\n');
  await assert.rejects(writeCloudExport(output, sample));
  const gitRoot = path.join(temporary, 'repository');
  await fs.mkdir(path.join(gitRoot, '.git'), { recursive: true });
  await assert.rejects(writeCloudExport(path.join(gitRoot, 'package'), sample));
  await assert.rejects(writeCloudExport(path.join(root, 'export-test-must-not-exist'), sample));
});
