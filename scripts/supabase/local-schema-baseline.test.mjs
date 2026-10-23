import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { digestJSON, normalize, readBaseline, sha256, validateManifest, validateTarget } from './local-schema-baseline-contract.mjs';
import { REFERENCE_TABLES, referenceDataFingerprint } from './local-schema-baseline-catalog.mjs';
import { transactionalMigration } from './local-schema-baseline-history.mjs';
import { assertSQLArtifact, localRestoreArguments } from './local-schema-baseline.mjs';

function manifestFixture() {
  const sourceChain = [{ file: '20260101000000_example.sql', sha256: sha256('select 1;\n') }];
  return { kind: 'vimob-local-schema-baseline-v1', classification: 'local-schema-baseline', originalHistoryExecution: false,
    productionDataIncluded: false, scope: 'fresh-local-database-only', baselineId: 'local-fixture-v1',
    sourceChain, sourceChainSHA256: digestJSON(sourceChain), expectedCatalogSHA256: sha256('catalog'), expectedDataSHA256: sha256('data'),
    referenceDataTables: REFERENCE_TABLES,
    artifacts: [{ file: 'schema.sql', kind: 'schema', schemaOnly: true, sha256: sha256('create schema example;\n') }],
    provenance: { knownHistoricalExceptions: ['trigger preconditions', 'production-only records', 'predecessor variants'],
      sourceContainsOnlySyntheticData: true, originalHistoryStillArchived: true } };
}

test('target rejects primary database, remote names and malformed run identity', () => {
  const target = { kind: 'vimob-local-schema-baseline-target-v1', runId: '22130d2f-3431-4f0d-8f43-54631f29d17c',
    runManifest: path.resolve('synthetic-manifest.json'), databaseName: 'vimob_local_baseline_fixture' };
  assert.equal(validateTarget(target), target);
  for (const patch of [{ databaseName: 'postgres' }, { databaseName: 'production' }, { databaseName: 'vimob_local_baseline_x;drop' },
    { runManifest: 'relative.json' }, { runId: 'not-a-run' }]) assert.throws(() => validateTarget({ ...target, ...patch }));
});

test('full-platform restore uses fixed container administrator only on a disposable target', () => {
  const target = { kind: 'vimob-local-schema-baseline-target-v1', runId: '22130d2f-3431-4f0d-8f43-54631f29d17c',
    runManifest: path.resolve('synthetic-manifest.json'), databaseName: 'vimob_local_baseline_fixture' };
  const syntheticMarker = 'synthetic-password-marker-never-in-argv';
  const args = localRestoreArguments({ databaseContainer: 'verified-local-container', databaseURL: `postgresql://postgres:${syntheticMarker}@127.0.0.1:57422/postgres` }, target);
  assert.equal(args[args.indexOf('--username') + 1], 'supabase_admin');
  assert.equal(args.includes('-X'), true);
  assert.equal(args.includes('--no-password'), true);
  assert.equal(args[args.indexOf('--env') + 1], 'PGPASSWORD');
  assert.equal(JSON.stringify(args).includes(syntheticMarker), false);
  assert.equal(args.includes('ON_ERROR_STOP=1'), true);
  assert.throws(() => localRestoreArguments({ databaseContainer: 'verified-local-container' }, { ...target, databaseName: 'postgres' }));
});

test('dump cannot reconnect, run shell commands, restore a false ledger or disable bounded timeouts', () => {
  assertSQLArtifact("\\restrict abc123\nSET statement_timeout = '5min';\nSET lock_timeout='5s';\ncreate schema example;\n\\unrestrict abc123");
  for (const source of ['\\connect postgres', '\\! arbitrary', 'create schema supabase_migrations;',
    'create table vimob_local_bootstrap.history(file text);', 'SET statement_timeout = 0;', "SET lock_timeout = '0';", 'SET LOCAL transaction_timeout=0;']) {
    assert.throws(() => assertSQLArtifact(source));
  }
});

test('manifest never labels baseline history executed or permits production data', () => {
  assert.equal(validateManifest(manifestFixture()).originalHistoryExecution, false);
  for (const patch of [{ originalHistoryExecution: true }, { productionDataIncluded: true }, { scope: 'production' },
    { classification: 'executed' }, { sourceChainSHA256: sha256('other') }, { referenceDataTables: ['public.leads'] }]) {
    assert.throws(() => validateManifest({ ...manifestFixture(), ...patch }));
  }
});

test('reference-data artifact requires exact canonical provenance and cannot escape reviewed directory', () => {
  const manifest = manifestFixture();
  manifest.artifacts[0] = { ...manifest.artifacts[0], kind: 'reference-data', schemaOnly: false, sourceMigrationHashes: manifest.sourceChain };
  assert.equal(validateManifest(manifest), manifest);
  for (const patch of [{ sourceMigrationHashes: [{ file: '20260101000000_example.sql', sha256: sha256('unreviewed') }] },
    { file: '../escape.sql' }, { file: path.resolve('escape.sql') }, { schemaOnly: true }]) {
    const changed = structuredClone(manifest);
    Object.assign(changed.artifacts[0], patch);
    assert.throws(() => validateManifest(changed));
  }
});

test('static data reader refuses arbitrary tables before querying', async () => {
  let queried = false;
  await assert.rejects(referenceDataFingerprint({ query() { queried = true; } }, ['auth.users']));
  assert.equal(queried, false);
});

test('atomic forward strips only one outer transaction and preserves function/string/comment semicolons', () => {
  const body = "-- Header\nbegin;\n/* outer /* nested */ comment */\ndo $body$ begin; perform 'COMMIT;'; end $body$;\nselect 'literal;';\ncommit; -- Footer\n";
  const result = transactionalMigration(body);
  assert.match(result, /do \$body\$ begin; perform 'COMMIT;'; end \$body\$;/);
  assert.match(result, /select 'literal;';/);
  assert.doesNotMatch(result, /^begin;/m);
  assert.doesNotMatch(result, /^commit;/m);
  assert.equal(transactionalMigration("select E'escaped\\\'quote;';"), "select E'escaped\\\'quote;';");
});

test('forward refuses ambiguous transaction boundaries and incomplete SQL', () => {
  for (const source of ['begin;select 1;', 'select 1;commit;', 'begin;commit;select 1;commit;', "select 'unclosed;", 'select 1']) {
    assert.throws(() => transactionalMigration(source));
  }
});

test('canonical prefix is immutable while reviewed tail migrations remain executable', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vimob-baseline-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const approved = path.join(root, 'supabase/reconciliation/local-bootstrap');
  await fs.mkdir(approved, { recursive: true });
  await fs.mkdir(path.join(root, 'supabase/migrations'));
  const manifest = manifestFixture();
  const manifestPath = path.join(approved, 'manifest.json');
  const sourcePath = path.join(root, 'supabase/migrations', manifest.sourceChain[0].file);
  const artifactPath = path.join(approved, 'schema.sql');
  const lockPath = path.join(root, 'supabase/migrations.source-lock.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  await fs.writeFile(sourcePath, '\uFEFFselect 1;\r\n');
  await fs.writeFile(artifactPath, 'create schema example;\n');
  const tail = { file: '20260102000000_after_baseline.sql', sha256: sha256('select 2;\n') };
  await fs.writeFile(path.join(root, 'supabase/migrations', tail.file), 'select 2;\n');
  const lock = { algorithm: 'sha256-utf8-lf-v1', migrations: [...manifest.sourceChain, tail] };
  await fs.writeFile(lockPath, JSON.stringify(lock));
  const baseline = await readBaseline(root, manifestPath);
  assert.equal(baseline.forwards.length, 1);
  assert.equal(baseline.forwards[0].file, tail.file);
  await fs.writeFile(sourcePath, 'select 999;\n');
  await assert.rejects(readBaseline(root, manifestPath), /Archived canonical migration changed/);
  await fs.writeFile(sourcePath, 'select 1;\n');
  await fs.writeFile(artifactPath, 'create schema replaced;\n');
  await assert.rejects(readBaseline(root, manifestPath), /Baseline artifact changed/);
  await fs.writeFile(artifactPath, 'create schema example;\n');
  await fs.writeFile(path.join(root, 'supabase/migrations', tail.file), 'select 3;\n');
  await assert.rejects(readBaseline(root, manifestPath), /Unreviewed forward migration/);
  assert.equal(sha256(normalize('\uFEFFselect 1;\r\n')), manifest.sourceChain[0].sha256);
});
