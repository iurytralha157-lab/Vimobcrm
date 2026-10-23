import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixtureRoot } from './whatsapp-ci-contract.mjs';
import { MIGRATIONS } from './whatsapp-ci-schema.mjs';
import { repository, verifiedClient, sqlFile } from './whatsapp-ci-fixture.mjs';
import { materializeSQL, B1_FUNCTION_SOURCE, STRICT_CHECK_SOURCE, QUEUE_COLUMNS_SOURCE, CREATIVE_LEDGER_SOURCE, QUEUE_SOURCES, ADDITIONAL_SOURCES } from './whatsapp-ci-sql-source.mjs';

export function schemaSources(sharedQueue = true) {
  assert.equal(typeof sharedQueue, 'boolean');
  return ['scripts/tests/whatsapp-ci-infrastructure.sql', ...MIGRATIONS.flatMap(name => [
    ...(name === '20260904123000_managed_whatsapp_distribution_auto_reply.sql' ? [CREATIVE_LEDGER_SOURCE] : []),
    ...(name === '20260920170647_add_durable_whatsapp_lead_avatar_enrichment.sql' ? [STRICT_CHECK_SOURCE, QUEUE_COLUMNS_SOURCE] : []),
    ...(name === '20261012133549_whatsapp_contradictory_pn_ingress_barrier.sql' ? [B1_FUNCTION_SOURCE] : []), 'supabase/migrations/' + name]),
    ...(sharedQueue ? QUEUE_SOURCES : [])];
}
export async function bootstrap(rootValue, sharedQueue = true) {
const root = fixtureRoot(rootValue);
const { client } = await verifiedClient(root);
try {
  assert.equal((await client.query("select count(*)::int as n from pg_tables where schemaname in('public','private','auth','storage','realtime')")).rows[0].n, 0,
    'schema bootstrap requires a fresh empty owned cluster');
} finally { await client.end(); }
assert.equal(new Set(MIGRATIONS).size, MIGRATIONS.length);
assert.deepEqual([...MIGRATIONS].sort(), MIGRATIONS);
// Preflight all sources before the first schema write; no partial list due to a
// typo or missing file, and no implicit execution of future migrations.
const sources = schemaSources(sharedQueue);
const records = [];
for (const file of sources) {
  assert.ok(ADDITIONAL_SOURCES.includes(file) || /^(scripts\/tests\/whatsapp-ci-infrastructure\.sql|supabase\/migrations\/[0-9]{14}_[a-z0-9_]+\.sql)$/.test(file));
  const source = await readFile(path.join(repository, file));
  assert.ok(source.length && !source.includes(0));
  const { sourceSha256, executedSha256, operationalOmission, functionOnly, ddlOnly, ddlBlocks, canonicalSourceSha256 } = materializeSQL(file, source);
  records.push({ file, sourceSha256, executedSha256, operationalOmission, functionOnly: Boolean(functionOnly), ddlOnly: Boolean(ddlOnly),
    ...(ddlBlocks ? { ddlBlocks, canonicalSourceSha256 } : {}) });
}
await writeFile(path.join(root, 'results', 'schema-plan.json'), JSON.stringify(records, null, 2));
for (const record of records) {
  console.log('Applying synthetic fixture source: ' + record.file);
  try {
    const result = await sqlFile(root, record.file, { mode: record.file.endsWith('_production_public_private_baseline.sql') ? 'baseline' : 'migration' }, record.sourceSha256);
    assert.equal(result.executedSha256, record.executedSha256, 'SQL materialization changed after preflight');
    await writeFile(path.join(root, 'results', path.basename(record.file) + '.log'), result.stdout + result.stderr);
  } catch (error) {
    await writeFile(path.join(root, 'results', path.basename(record.file) + '.log'), String(error.stdout || '') + String(error.stderr || ''));
    throw new Error('fixture schema failed at ' + record.file, { cause: error });
  }
}
await writeFile(path.join(root, 'results', 'schema-sources.json'), JSON.stringify(records, null, 2));
console.log(`Canonical focal DDL ready (${MIGRATIONS.length} migrations, shared queue ${sharedQueue ? 'included' : 'excluded in diagnostic only'}). This is not a complete Supabase reset or production-ledger rehearsal.`);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await bootstrap(process.argv[2]);
