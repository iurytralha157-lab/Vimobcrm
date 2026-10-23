import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { classifyBlock, loadCloudSource, PRODUCTION_PROJECT_REF, validateCloudTarget } from './cloud-baseline-contract.mjs';
import { buildCloudPlan, inventoryDump } from './cloud-baseline-plan.mjs';
import { digestJSON, sha256 } from '../supabase/local-schema-baseline-contract.mjs';

const target = { kind: 'vimob-cloud-staging-target-v1', environment: 'staging',
  projectRef: 'abcdefghijklmnopqrst', supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co' };
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const header = (name, type = 'TABLE', schema = 'public', owner = 'postgres') =>
  `-- Name: ${name}; Type: ${type}; Schema: ${schema}; Owner: ${owner}\n--\n`;

function sourceFixture(sql) {
  return { manifest: { baselineId: 'synthetic-plan', sourceChain: [{ file: 'synthetic.sql' }],
    sourceChainSHA256: '0'.repeat(64), expectedDataSHA256: '0'.repeat(64),
    referenceDataTables: ['public.available_permissions'] },
  artifacts: [{ file: 'synthetic.sql', kind: 'schema', source: sql, sha256: sha256(sql) }], forwards: [] };
}

test('target contract accepts only the exact public staging origin and no secrets', () => {
  assert.deepEqual(validateCloudTarget(target), target);
  for (const invalid of [
    { ...target, environment: 'production' },
    { ...target, projectRef: PRODUCTION_PROJECT_REF, supabaseUrl: `https://${PRODUCTION_PROJECT_REF}.supabase.co` },
    { ...target, supabaseUrl: 'https://supabase.vimobcrm.com.br' },
    { ...target, supabaseUrl: 'https://another-ref.supabase.co' },
    { ...target, supabaseUrl: `${target.supabaseUrl}/` },
    { ...target, supabaseUrl: `${target.supabaseUrl}?credential=synthetic` },
    { ...target, password: 'synthetic-secret' },
    { ...target, databaseUrl: 'postgresql://synthetic' },
  ]) assert.throws(() => validateCloudTarget(invalid));
});

test('projection preserves platform objects and rejects unexpected owners and schemas', () => {
  const block = { schema: 'auth', type: 'TABLE', name: 'users', owner: 'supabase_auth_admin' };
  assert.equal(classifyBlock(block), 'managed-platform-preserved');
  assert.equal(classifyBlock({ ...block, schema: 'public', owner: 'postgres' }), 'domain-candidate');
  assert.equal(classifyBlock({ schema: 'public', name: 'leads supabase_realtime', type: 'PUBLICATION TABLE', owner: 'postgres' }), 'platform-overlay-review');
  for (const invalid of [
    { ...block, owner: 'unknown_admin' }, { ...block, schema: 'custom_schema' },
    { ...block, type: 'UNKNOWN TYPE' }, { ...block, schema: 'public' },
    { ...block, schema: 'storage', type: 'POLICY', name: 'unreviewed policy' },
    { ...block, type: 'TRIGGER', name: 'users unexpected_trigger' },
  ]) assert.throws(() => classifyBlock(invalid));
});

test('TOC scanner ignores fake headers inside function bodies, quotes and nested comments', () => {
  const fake = header('fake');
  const sql = `${header('safe()', 'FUNCTION')}CREATE FUNCTION public.safe() RETURNS text AS $body$\n${fake}SELECT 'text';\n$body$ LANGUAGE sql;\n`
    + `/* outer /* nested */\n${fake}*/\nSELECT E'escaped \\' quote\n${fake}';\n`
    + `${header('real')}CREATE TABLE public.real(id integer);\n`;
  assert.deepEqual(inventoryDump(sql, 'synthetic.sql').map(row => row.name), ['safe()', 'real']);
  assert.throws(() => inventoryDump(`${header('bad')}SELECT 'unterminated`, 'bad.sql'));
  assert.throws(() => inventoryDump('-- Name: malformed\n', 'bad.sql'));
});

test('contact literals require contextual review without claiming recipient dispatch', () => {
  const contact = 'operational@real-provider.invalid';
  const sql = `${header('billing()', 'FUNCTION', 'private')}CREATE FUNCTION private.billing() RETURNS jsonb AS $$ SELECT jsonb_build_object('support_email', '${contact}'); $$ LANGUAGE sql;\n`;
  const plan = buildCloudPlan(sourceFixture(sql), target), serialized = JSON.stringify(plan);
  assert.equal(plan.ready, false);
  assert.equal(plan.applySupported, false);
  assert.equal(plan.databaseAccessed, false);
  assert.equal(plan.executableSQLIncluded, false);
  assert.equal(plan.literalRisks[0].category, 'OPERATIONAL_EMAIL_LITERAL');
  const review = plan.blockers.find(row => row.code === 'OPERATIONAL_LITERALS_REQUIRE_REVIEW');
  assert.ok(review);
  assert.match(review.action, /contact metadata/);
  assert.match(review.action, /does not establish a recipient or dispatch/);
  assert.ok(!serialized.includes(contact));
  assert.ok(!serialized.includes('CREATE FUNCTION'));
  assert.ok(!plan.blockers.some(row => row.code === 'TARGET_NOT_SELECTED'));
});

test('WhatsApp JID suffixes and reserved synthetic addresses do not become operational emails', () => {
  const sql = `${header('normalize()', 'FUNCTION')}CREATE FUNCTION public.normalize() RETURNS text AS $$ SELECT '@s.whatsapp.net', 'person@example.com', 'user@tenant.test'; $$ LANGUAGE sql;\n`;
  assert.deepEqual(buildCloudPlan(sourceFixture(sql)).literalRisks, []);
});

test('unknown objects produce blockers instead of inclusion in application candidates', () => {
  const sql = `${header('dangerous', 'TABLE', 'public', 'supabase_admin')}CREATE TABLE public.dangerous(id integer);\n`;
  const plan = buildCloudPlan(sourceFixture(sql));
  assert.equal(plan.counts['domain-candidate'], 0);
  assert.equal(plan.unknownObjects.length, 1);
  assert.ok(plan.blockers.some(row => row.code === 'UNKNOWN_OBJECTS_REQUIRE_REVIEW'));
});

test('artifact mutation after validation fails closed', () => {
  const source = sourceFixture(`${header('safe')}CREATE TABLE public.safe(id integer);\n`);
  source.artifacts[0].source += 'DROP SCHEMA public CASCADE;';
  assert.throws(() => buildCloudPlan(source), /Artifact bytes changed/);
});

test('forwards are scanned for operational literals and cannot change after validation', () => {
  const source = sourceFixture(`${header('safe')}CREATE TABLE public.safe(id integer);\n`);
  const sql = "SELECT 'recipient@operational.invalid';\n";
  source.forwards = [{ file: 'synthetic-forward.sql', source: sql, sha256: sha256(sql) }];
  const plan = buildCloudPlan(source);
  assert.equal(plan.literalRisks[0].artifact, 'synthetic-forward.sql');
  assert.ok(!JSON.stringify(plan).includes('recipient@operational.invalid'));
  source.forwards[0].source += 'SELECT 2;';
  assert.throws(() => buildCloudPlan(source), /Forward bytes changed/);
});

test('source validator rejects changed canonical migrations, forwards and artifacts', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vimob-cloud-source-test-'));
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
    await fs.rm(root, { recursive: true, force: true });
  });
  const sqlDirectory = path.join(root, 'supabase/reconciliation/local-bootstrap');
  const migrationsDirectory = path.join(root, 'supabase/migrations');
  await fs.mkdir(sqlDirectory, { recursive: true });
  await fs.mkdir(migrationsDirectory, { recursive: true });
  const prefix = { file: '20260101000000_synthetic_prefix.sql', sha256: sha256('SELECT 1;\n') };
  const forward = { file: '20260102000000_synthetic_forward.sql', sha256: sha256('SELECT 2;\n') };
  const artifact = { file: 'schema.sql', kind: 'schema', schemaOnly: true, sha256: sha256('SELECT 3;\n') };
  const manifest = { kind: 'vimob-local-schema-baseline-v1', classification: 'local-schema-baseline',
    originalHistoryExecution: false, productionDataIncluded: false, scope: 'fresh-local-database-only',
    baselineId: 'synthetic-source', sourceChain: [prefix], sourceChainSHA256: digestJSON([prefix]),
    expectedCatalogSHA256: '0'.repeat(64), expectedDataSHA256: '0'.repeat(64), artifacts: [artifact],
    referenceDataTables: ['private.queue_timezone_catalog', 'public.admin_subscription_plans',
      'public.available_permissions', 'public.help_articles', 'public.home_publications'],
    provenance: { knownHistoricalExceptions: [{}, {}, {}], sourceContainsOnlySyntheticData: true, originalHistoryStillArchived: true } };
  await fs.writeFile(path.join(sqlDirectory, 'baseline-20261016.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(root, 'supabase/migrations.source-lock.json'), JSON.stringify({ algorithm: 'sha256-utf8-lf-v1', migrations: [prefix, forward] }));
  await fs.writeFile(path.join(migrationsDirectory, prefix.file), 'SELECT 1;\n');
  await fs.writeFile(path.join(migrationsDirectory, forward.file), 'SELECT 2;\n');
  await fs.writeFile(path.join(sqlDirectory, artifact.file), 'SELECT 3;\n');
  assert.equal((await loadCloudSource(root)).forwards.length, 1);
  for (const [filename, original] of [[path.join(migrationsDirectory, prefix.file), 'SELECT 1;\n'],
    [path.join(migrationsDirectory, forward.file), 'SELECT 2;\n'], [path.join(sqlDirectory, artifact.file), 'SELECT 3;\n']]) {
    await fs.writeFile(filename, 'SELECT 999;\n');
    await assert.rejects(loadCloudSource(root));
    await fs.writeFile(filename, original);
  }
});

test('current canonical baseline creates an actionable inventory and stays blocked', async () => {
  const plan = buildCloudPlan(await loadCloudSource(repositoryRoot));
  assert.equal(plan.unknownObjects.length, 0);
  assert.ok(plan.counts['domain-candidate'] > 0);
  assert.ok(plan.counts['platform-overlay-review'] > 0);
  assert.ok(plan.counts['cloud-extension-prerequisite'] > 0);
  assert.ok(plan.literalRisks.some(row => row.object === 'create_billing_payment_receipt_from_payment()'));
  assert.equal(plan.ready, false);
});
