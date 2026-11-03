import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadCloudSource } from './cloud-baseline-contract.mjs';
import { buildCloudExport } from './cloud-export-build.mjs';
import { promoteCloudExport } from './cloud-export-promote.mjs';
import { buildCloudForwards, verifyBaselineTrial } from './cloud-forward-build.mjs';
import { transactionalMigration } from '../supabase/local-schema-baseline-history.mjs';
import { statements } from './cloud-export-sql.mjs';
import { normalize, sha256 } from '../supabase/local-schema-baseline-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = await loadCloudSource(root);
const target = { kind: 'vimob-cloud-staging-target-v1', environment: 'staging', projectRef: 'lfkfuhvjvqgwyikzcfep', supabaseUrl: 'https://lfkfuhvjvqgwyikzcfep.supabase.co' };
const readback = { observedAtUTC: '2026-10-23T20:00:00Z', project: { id: target.projectRef, ref: target.projectRef,
  name: 'vimob-homologacao', status: 'ACTIVE_HEALTHY', organization_id: 'snqyytbmmbfasotklrje' } };
const now = Date.parse(readback.observedAtUTC);
const runId = 'f7196a56-e7bb-4221-b61d-f3a95245338c';
const baselineDraft = buildCloudExport(source, { target, rehearsalDatabase: 'vimob_cloud_rehearsal_20261023' });
const trial = promoteCloudExport(baselineDraft, { target, readback, sentinelRunId: runId, now });
const options = { target, readback, now };
const prepared = buildCloudForwards(source, trial, options);

test('twenty-one canonical forwards become twenty-one planned phases after the fifteen-phase baseline', () => {
  assert.equal(prepared.manifest.count, 21);
  assert.equal(prepared.manifest.firstOrdinal, 15);
  assert.equal(prepared.manifest.lastOrdinal, 35);
  assert.equal(prepared.manifest.outerTransactionsRemoved, 19);
  assert.equal(prepared.manifest.ready, false);
  assert.equal(prepared.manifest.trialPassed, false);
  assert.equal(prepared.manifest.remoteApplySupported, false);
  assert.deepEqual(prepared.manifest.source.canonicalForwards, source.forwards.map(({ file, sha256: hash }) => ({ file, sha256: hash })));
});

test('every phase records separate canonical, derived payload and guarded file hashes', () => {
  for (const [index, entry] of prepared.manifest.files.entries()) {
    const canonical = source.forwards[index], sql = prepared.files[entry.file];
    assert.equal(entry.ordinal, 15 + index);
    assert.equal(entry.canonicalFile, canonical.file);
    assert.equal(entry.canonicalSHA256, sha256(normalize(canonical.source)));
    assert.equal(entry.payloadSHA256, sha256(transactionalMigration(normalize(canonical.source))));
    assert.equal(entry.sha256, sha256(sql));
    assert.ok(Buffer.byteLength(sql) < 500_000);
    assert.ok(sql.includes(runId)); assert.ok(sql.includes(target.projectRef));
    assert.ok(sql.includes('vimob_cloud_staging.sentinel'));
    assert.ok(sql.includes('vimob_cloud_staging.phase_history'));
  }
});

test('first forward requires all baseline payload hashes and later forwards require their predecessors', () => {
  const first = prepared.files[prepared.manifest.files[0].file];
  assert.ok(first.includes(') <> 15'));
  for (const entry of trial.manifest.files) {
    assert.ok(first.includes(entry.file)); assert.ok(first.includes(entry.payloadSHA256));
  }
  const last = prepared.files[prepared.manifest.files.at(-1).file];
  assert.ok(last.includes(') <> 35'));
  for (const entry of prepared.manifest.files.slice(0, -1)) {
    assert.ok(last.includes(entry.file)); assert.ok(last.includes(entry.payloadSHA256));
  }
});

test('only one outer BEGIN/COMMIT remains per guarded phase', () => {
  for (const sql of Object.values(prepared.files)) {
    const outer = statements(sql).filter(statement => ['begin', 'commit', 'rollback'].includes(statement.tokens[0].value));
    assert.deepEqual(outer.map(statement => statement.tokens[0].value), ['begin', 'commit']);
  }
});

test('function bodies, predecessor preconditions, proconfig and ACL statements remain exact', () => {
  let checked = 0;
  for (const [index, forward] of source.forwards.entries()) {
    const sql = prepared.files[prepared.manifest.files[index].file];
    const canonical = statements(normalize(forward.source));
    const inner = canonical[0].tokens[0].value === 'begin' ? canonical.slice(1, -1) : canonical;
    for (const statement of inner) {
      assert.ok(sql.includes(statement.source), 'A canonical statement was rewritten.'); checked++;
    }
  }
  assert.ok(checked > 100);
});

test('immutable baseline file and manifest tampering fail before forward preparation', () => {
  const file = trial.manifest.files[0].file;
  assert.throws(() => verifyBaselineTrial(source, { ...trial, files: { ...trial.files, [file]: `${trial.files[file]}SELECT 1;` } }, target));
  const wrong = structuredClone(trial.manifest); wrong.files[0].payloadSHA256 = '0'.repeat(64);
  assert.throws(() => verifyBaselineTrial(source, { ...trial, manifest: wrong }, target));
  const reordered = structuredClone(trial.manifest); [reordered.files[0], reordered.files[1]] = [reordered.files[1], reordered.files[0]];
  assert.throws(() => verifyBaselineTrial(source, { ...trial, manifest: reordered }, target));
  const missing = structuredClone(trial.manifest); missing.files.pop();
  assert.throws(() => verifyBaselineTrial(source, { ...trial, manifest: missing }, target));
});

test('canonical forward mutations cannot reuse the reviewed baseline manifest', () => {
  const changed = { ...source, forwards: source.forwards.map((entry, index) => index ? entry : { ...entry, source: `${entry.source}\nSELECT 1;\n` }) };
  assert.throws(() => buildCloudForwards(changed, trial, options));
  const wrongHash = { ...source, forwards: source.forwards.map((entry, index) => index ? entry : { ...entry, sha256: '0'.repeat(64) }) };
  assert.throws(() => buildCloudForwards(wrongHash, trial, options));
});

test('new package requires fresh exact project metadata, not only historical trial readback', () => {
  assert.throws(() => buildCloudForwards(source, trial, { ...options, now: now + 16 * 60_000 }));
  assert.throws(() => buildCloudForwards(source, trial, { ...options,
    readback: { ...readback, project: { ...readback.project, id: 'iemalzlfnbouobyjwlwi' } } }));
  assert.throws(() => buildCloudForwards(source, trial, { ...options,
    readback: { ...readback, project: { ...readback.project, status: 'INACTIVE' } } }));
});

test('wrapper stripping rejects nested controls and preserves quoted transaction words', () => {
  const sql = "BEGIN;\nCREATE FUNCTION public.synthetic() RETURNS text LANGUAGE sql AS $$ SELECT 'COMMIT; BEGIN;'; $$;\nCOMMIT;\n";
  const derived = transactionalMigration(sql);
  assert.ok(derived.includes("$$ SELECT 'COMMIT; BEGIN;'; $$"));
  assert.deepEqual(statements(derived).map(statement => statement.tokens[0].value), ['create']);
  assert.throws(() => transactionalMigration('BEGIN; SAVEPOINT unsafe; SELECT 1; COMMIT;'));
  assert.throws(() => transactionalMigration('BEGIN; SELECT 1;'));
});
