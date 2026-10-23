import assert from 'node:assert/strict';
import { catalogFingerprint, referenceDataFingerprint } from './local-schema-baseline-catalog.mjs';
import { digestJSON } from './local-schema-baseline-contract.mjs';

export async function readBaselineHistory(db, baseline, { requireAllForwards = true } = {}) {
  const { manifest, forwards } = baseline;
  const attestation = (await db.query('select * from vimob_local_bootstrap.attestation where singleton')).rows[0];
  assert.equal(attestation?.baseline_id, manifest.baselineId);
  assert.equal(attestation?.classification, 'local-schema-baseline');
  assert.equal(attestation?.historical_execution, false);
  assert.equal(attestation?.source_chain_sha256, manifest.sourceChainSHA256);
  assert.equal(attestation?.baseline_catalog_sha256, manifest.expectedCatalogSHA256);
  assert.equal(attestation?.artifacts_sha256, digestJSON(manifest.artifacts));
  assert.equal(attestation?.baseline_data_sha256, manifest.expectedDataSHA256);
  const rows = (await db.query('select file,sha256,classification,catalog_sha256,data_sha256 from vimob_local_bootstrap.history order by file')).rows;
  const prefix = rows.filter(row => row.classification === 'baseline-equivalent');
  assert.deepEqual(prefix.map(({ file, sha256 }) => ({ file, sha256 })), manifest.sourceChain);
  const tail = rows.filter(row => row.classification === 'forward-executed');
  assert.equal(prefix.length + tail.length, rows.length, 'Unknown history classification is forbidden.');
  assert.deepEqual(tail.map(({ file, sha256 }) => ({ file, sha256 })), forwards.slice(0, tail.length).map(({ file, sha256 }) => ({ file, sha256 })), 'Forward history is not an exact reviewed prefix.');
  if (requireAllForwards) assert.equal(tail.length, forwards.length, 'Reviewed forward migrations remain pending.');
  const catalog = await catalogFingerprint(db, manifest.catalogOptions);
  const expectedCatalog = tail.at(-1)?.catalog_sha256 || manifest.expectedCatalogSHA256;
  assert.equal(catalog.sha256, expectedCatalog, 'Schema or privilege drift after baseline/forward attestation.');
  const data = await referenceDataFingerprint(db, manifest.referenceDataTables);
  assert.equal(data.sha256, tail.at(-1)?.data_sha256 || manifest.expectedDataSHA256, 'Static reference data differs from the attested baseline/forward.');
  return { classification: 'local-schema-baseline', historicalExecution: false, baselineMigrations: prefix.length,
    executedForwardMigrations: tail.length, pendingForwards: forwards.length - tail.length, catalogSHA256: catalog.sha256,
    sourceChainSHA256: manifest.sourceChainSHA256, referenceDataSHA256: data.sha256, coveredFiles: rows.map(row => row.file), catalogCounts: catalog.counts };
}

// Existing migrations may contain one outer transaction. Remove only that
// wrapper, never a COMMIT inside a string, comment, function or DO body.
export function transactionalMigration(source) {
  const statements = [];
  let start = 0, index = 0, quote = null, dollar = null, line = false, block = 0;
  while (index < source.length) {
    const char = source[index], next = source[index + 1];
    if (line) { if (char === '\n') line = false; index++; continue; }
    if (block) {
      if (char === '/' && next === '*') { block++; index += 2; }
      else if (char === '*' && next === '/') { block--; index += 2; }
      else index++;
      continue;
    }
    if (dollar) {
      if (source.startsWith(dollar, index)) { index += dollar.length; dollar = null; } else index++;
      continue;
    }
    if (quote) {
      if (char === '\\' && quote === "'") { index += 2; continue; }
      if (char === quote && next === quote) { index += 2; continue; }
      if (char === quote) quote = null;
      index++; continue;
    }
    if (char === '-' && next === '-') { line = true; index += 2; continue; }
    if (char === '/' && next === '*') { block = 1; index += 2; continue; }
    if (char === "'" || char === '"') { quote = char; index++; continue; }
    if (char === '$') {
      const token = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (token) { dollar = token; index += token.length; continue; }
    }
    if (char === ';') { statements.push({ start, end: index + 1, text: source.slice(start, index) }); start = index + 1; }
    index++;
  }
  assert.ok(!quote && !dollar && !block, 'Unterminated SQL lexical construct.');
  const code = text => text.replace(/--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//g, '').trim();
  assert.equal(code(source.slice(start)), '', 'Migration must end with a semicolon.');
  const meaningful = statements.filter(statement => code(statement.text));
  const first = meaningful[0], last = meaningful.at(-1);
  const wrapped = /^begin(?:\s+transaction)?$/i.test(code(first?.text || ''));
  if (wrapped) assert.match(code(last.text), /^commit$/i, 'Outer transaction must have a matching final COMMIT.');
  const inner = wrapped ? meaningful.slice(1, -1) : meaningful;
  for (const statement of inner) assert.doesNotMatch(code(statement.text), /^(?:begin|commit|rollback|start\s+transaction|savepoint|release\s+savepoint)\b/i, 'Nested top-level transaction command is forbidden.');
  return wrapped ? `${source.slice(0, first.start)}${source.slice(first.end, last.start)}${source.slice(last.end)}` : source;
}
