import assert from 'node:assert/strict';
import { normalize, sha256, digestJSON } from '../supabase/local-schema-baseline-contract.mjs';
import { transactionalMigration } from '../supabase/local-schema-baseline-history.mjs';
import { buildCloudExport } from './cloud-export-build.mjs';
import { promoteCloudExport, assertFreshCloudReadback, cloudIdentityGuard, cloudPhaseGuard, cloudPhaseLedger } from './cloud-export-promote.mjs';
import { statements } from './cloud-export-sql.mjs';

export function verifyBaselineTrial(source, trial, target) {
  const manifest = trial.manifest;
  assert.equal(manifest.kind, 'vimob-cloud-baseline-transaction-trial-v1');
  assert.equal(manifest.classification, 'prepared-for-reviewed-transactional-cloud-trial');
  assert.deepEqual(manifest.target, target);
  assert.equal(manifest.files.length, 15, 'This forward preparation expects the reviewed fifteen-phase baseline.');
  const epoch = Date.parse(manifest.execution.observedAtUTC);
  assert.ok(Number.isFinite(epoch), 'The historical baseline readback timestamp is required.');
  const originalReadback = { observedAtUTC: manifest.execution.observedAtUTC, project: {
    id: target.projectRef, ref: target.projectRef, name: 'vimob-homologacao',
    status: manifest.execution.projectStatusObserved, organization_id: manifest.execution.organizationId } };
  const expectedDraft = buildCloudExport(source, { target, rehearsalDatabase: manifest.rehearsalDatabase });
  // Reproduce historical bytes at their recorded time. This is not the fresh
  // authorization check for a new package; buildCloudForwards checks that below.
  const expected = promoteCloudExport(expectedDraft, { target, readback: originalReadback,
    sentinelRunId: manifest.execution.sentinelRunId, now: epoch });
  assert.deepEqual(manifest, expected.manifest, 'Baseline trial manifest differs from current canonical derivation.');
  assert.deepEqual(Object.keys(trial.files).sort(), manifest.files.map(row => row.file).sort());
  for (const entry of manifest.files) {
    assert.equal(sha256(trial.files[entry.file]), entry.sha256, 'Baseline trial SQL hash mismatch.');
    assert.equal(trial.files[entry.file], expected.files[entry.file], 'Baseline trial SQL differs from canonical derivation.');
  }
  return manifest.files.map(({ file, payloadSHA256, ordinal }) => ({ file, payloadSHA256, ordinal }));
}

export function buildCloudForwards(source, trial, { target, readback, now = Date.now() }) {
  assertFreshCloudReadback(target, readback, now);
  const previous = verifyBaselineTrial(source, trial, target);
  assert.deepEqual(source.forwards.map(({ file, sha256: hash }) => ({ file, sha256: hash })), trial.manifest.source.forwardsPending);
  const runId = trial.manifest.execution.sentinelRunId;
  const baseline = source.manifest;
  const guard = cloudIdentityGuard(target, baseline, runId);
  const files = {}, entries = [];
  for (const forward of source.forwards) {
    const canonical = normalize(forward.source);
    assert.equal(sha256(canonical), forward.sha256, 'Canonical forward changed after source validation.');
    const payload = transactionalMigration(canonical);
    const derived = statements(payload);
    assert.ok(derived.length > 0, 'Empty forward is not allowed.');
    assert.ok(!derived.some(statement => ['begin', 'commit', 'rollback', 'start', 'savepoint', 'release'].includes(statement.tokens[0].value)),
      'A derived forward must not contain transaction boundaries.');
    const canonicalStatements = statements(canonical);
    const removedOuterTransaction = canonicalStatements[0].tokens[0].value === 'begin';
    if (removedOuterTransaction) assert.equal(canonicalStatements.at(-1).tokens[0].value, 'commit');
    const originalInner = removedOuterTransaction ? canonicalStatements.slice(1, -1) : canonicalStatements;
    assert.deepEqual(derived.map(statement => statement.tokens), originalInner.map(statement => statement.tokens),
      'Only outer transaction controls may change in a derived forward.');
    for (const statement of originalInner) {
      assert.ok(payload.includes(statement.source), 'A canonical statement body changed while stripping its outer transaction.');
    }
    const payloadSHA256 = sha256(payload);
    const ordinal = previous.length;
    const file = `40-forward-${forward.file.slice(0, 14)}.sql`;
    assert.equal(files[file], undefined, 'Forward timestamp must be unique.');
    const sql = guard + cloudPhaseGuard(previous, runId, baseline.sourceChainSHA256) + payload
      + cloudPhaseLedger(file, payloadSHA256, ordinal, runId, baseline.sourceChainSHA256);
    assert.ok(Buffer.byteLength(sql) < 500_000, 'Forward phase exceeds the reviewed payload limit.');
    files[file] = sql;
    entries.push({ file, ordinal, sha256: sha256(sql), bytes: Buffer.byteLength(sql), payloadSHA256,
      canonicalFile: forward.file, canonicalSHA256: forward.sha256, removedOuterTransaction });
    previous.push({ file, payloadSHA256, ordinal });
  }
  return { files, manifest: {
    kind: 'vimob-cloud-forward-transaction-trial-v1', classification: 'prepared-for-reviewed-canonical-forward-trial',
    ready: false, trialPassed: false, remoteApplySupported: false, target,
    baseline: { baselineId: baseline.baselineId, sourceChainSHA256: baseline.sourceChainSHA256,
      baselineManifestDigest: digestJSON(trial.manifest), baselinePhaseCount: trial.manifest.files.length,
      phasesRequiredBeforeFirstForward: trial.manifest.files.map(({ file, payloadSHA256, ordinal }) => ({ file, payloadSHA256, ordinal })) },
    source: { canonicalForwards: source.forwards.map(({ file, sha256: hash }) => ({ file, sha256: hash })) },
    files: entries, count: entries.length, firstOrdinal: trial.manifest.files.length,
    lastOrdinal: previous.length - 1, outerTransactionsRemoved: entries.filter(row => row.removedOuterTransaction).length,
    execution: { projectRef: target.projectRef, organizationId: readback.project.organization_id,
      observedAtUTC: readback.observedAtUTC, sentinelSchema: 'vimob_cloud_staging', sentinelTable: 'sentinel',
      phaseHistoryTable: 'phase_history', sentinelRunId: runId, requiredRole: 'postgres', superuserAllowed: false,
      note: 'No database connection or execution is implemented. Every forward requires all baseline phases and exact preceding payload hashes in the staging ledger.' },
    preservation: ['Canonical files and source-lock remain unchanged.',
      'The existing transactionalMigration helper removes only an outer transaction wrapper in the derived payload.',
      'Function bodies, predecessor preconditions, proconfig, ownership and ACL SQL remain canonical.',
      'Canonical filename/SHA256, derived payload SHA256 and complete guarded phase SHA256 are separate evidence.',
      'The source chain represented by the baseline remains baseline-equivalent; no historical execution is invented.'],
    remainingValidation: ['complete and verify baseline phase history', 'execute each forward transactionally in order',
      'verify effective catalog and runtime predecessor guards', 'application acceptance tests'],
  } };
}
