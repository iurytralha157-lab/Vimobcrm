import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../supabase/local-schema-baseline-contract.mjs';
import { validateCloudTarget, loadCloudSource } from './cloud-baseline-contract.mjs';
import { rehearsalGuard, buildCloudExport } from './cloud-export-build.mjs';
import { writeCloudExport } from './cloud-export.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const literal = value => `'${value.replaceAll("'", "''")}'`;

export function assertFreshCloudReadback(target, readback, now = Date.now()) {
  validateCloudTarget(target);
  assert.equal(readback.project.id, target.projectRef);
  assert.equal(readback.project.ref, target.projectRef);
  assert.equal(readback.project.status, 'ACTIVE_HEALTHY');
  assert.equal(readback.project.name, 'vimob-homologacao');
  assert.equal(readback.project.organization_id, 'snqyytbmmbfasotklrje', 'Cloud trial belongs only to the selected test organization.');
  const age = now - Date.parse(readback.observedAtUTC);
  assert.ok(Number.isFinite(age) && age >= 0 && age <= 15 * 60_000, 'Fresh project API readback is required.');
}

export function cloudIdentityGuard(target, baseline, sentinelRunId) {
  validateCloudTarget(target); assert.match(sentinelRunId, UUID);
  assert.match(baseline.sourceChainSHA256, /^[0-9a-f]{64}$/);
  assert.match(baseline.baselineId, /^[a-z0-9_-]+$/);
  return `BEGIN;
SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '5s';
SET LOCAL transaction_timeout = '180s';
SET LOCAL standard_conforming_strings = on;
SET LOCAL search_path = pg_catalog;
SET LOCAL check_function_bodies = false;
SET LOCAL default_tablespace = '';
SET LOCAL default_table_access_method = heap;
DO $vimob_cloud_guard$ BEGIN
  IF current_user <> 'postgres' OR current_database() <> 'postgres'
    OR (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) THEN
    RAISE EXCEPTION 'cloud_trial_requires_postgres_non_superuser';
  END IF;
  IF (SELECT count(*) FROM vimob_cloud_staging.sentinel) <> 1 OR NOT EXISTS (
    SELECT 1 FROM vimob_cloud_staging.sentinel WHERE singleton
      AND project_ref=${literal(target.projectRef)} AND run_id=${literal(sentinelRunId)}::uuid
      AND baseline_id=${literal(baseline.baselineId)} AND source_chain_sha256=${literal(baseline.sourceChainSHA256)}
  ) THEN RAISE EXCEPTION 'cloud_trial_staging_identity_mismatch'; END IF;
END $vimob_cloud_guard$;
`;
}

export function cloudPhaseGuard(expectedPriorPhases, sentinelRunId, sourceChainSHA256) {
  assert.match(sentinelRunId, UUID); assert.match(sourceChainSHA256, /^[0-9a-f]{64}$/);
  for (const [index, phase] of expectedPriorPhases.entries()) {
    assert.equal(phase.ordinal, index); assert.match(phase.file, /^\d{2}-[a-z0-9-]+\.sql$/);
    assert.match(phase.payloadSHA256, /^[0-9a-f]{64}$/);
  }
  const ordinal = expectedPriorPhases.length;
  const expected = expectedPriorPhases.length ? `VALUES ${expectedPriorPhases.map(phase =>
    `(${literal(phase.file)},${literal(phase.payloadSHA256)},${phase.ordinal})`).join(',')}` :
    "SELECT ''::text,''::text,0::integer WHERE false";
  return `DO $vimob_phase$ BEGIN
  IF (SELECT count(*) FROM vimob_cloud_staging.phase_history WHERE run_id=${literal(sentinelRunId)}::uuid) <> ${ordinal}
    OR EXISTS (SELECT 1 FROM vimob_cloud_staging.phase_history h WHERE h.run_id=${literal(sentinelRunId)}::uuid
      AND h.source_chain_sha256<>${literal(sourceChainSHA256)})
    OR EXISTS (SELECT 1 FROM (${expected}) e(phase_name,payload_sha256,ordinal)
      LEFT JOIN vimob_cloud_staging.phase_history h ON h.run_id=${literal(sentinelRunId)}::uuid AND h.phase_name=e.phase_name
      WHERE h.phase_name IS NULL OR h.payload_sha256<>e.payload_sha256 OR h.ordinal<>e.ordinal) THEN
    RAISE EXCEPTION 'cloud_trial_phase_order_or_hash_mismatch';
  END IF;
END $vimob_phase$;
`;
}

export function cloudPhaseLedger(file, payloadSHA256, ordinal, sentinelRunId, sourceChainSHA256) {
  assert.match(file, /^\d{2}-[a-z0-9-]+\.sql$/); assert.match(payloadSHA256, /^[0-9a-f]{64}$/);
  assert.ok(Number.isSafeInteger(ordinal) && ordinal >= 0); assert.match(sentinelRunId, UUID);
  assert.match(sourceChainSHA256, /^[0-9a-f]{64}$/);
  return `\nINSERT INTO vimob_cloud_staging.phase_history(run_id,phase_name,payload_sha256,source_chain_sha256,ordinal)
VALUES (${literal(sentinelRunId)}::uuid,${literal(file)},${literal(payloadSHA256)},${literal(sourceChainSHA256)},${ordinal});\nCOMMIT;\n`;
}

export function promoteCloudExport(draft, { target, readback, sentinelRunId, now = Date.now() }) {
  validateCloudTarget(target); assert.match(sentinelRunId, UUID);
  assert.equal(draft.manifest.kind, 'vimob-cloud-baseline-draft-export-v1');
  assert.equal(draft.manifest.classification, 'local-rehearsal-draft-only');
  assert.equal(draft.manifest.ready, false);
  assert.deepEqual(draft.manifest.target, target);
  assertFreshCloudReadback(target, readback, now);
  const baseline = draft.manifest.source;
  const originalGuard = rehearsalGuard(target, draft.manifest.rehearsalDatabase);
  const cloudGuard = cloudIdentityGuard(target, baseline, sentinelRunId);
  assert.deepEqual(Object.keys(draft.files).sort(), draft.manifest.files.map(row => row.file).sort());
  const files = {}, fileEvidence = [], expectedPriorPhases = [];
  for (const [ordinal, entry] of draft.manifest.files.entries()) {
    const sql = draft.files[entry.file];
    assert.equal(sha256(sql), entry.sha256, 'Draft SQL hash mismatch.');
    assert.ok(sql.startsWith(originalGuard), 'Only the exact generated rehearsal guard can be replaced.');
    assert.ok(sql.endsWith('\nCOMMIT;\n'), 'Only the generated final transaction boundary is accepted.');
    const payload = sql.slice(originalGuard.length, -'\nCOMMIT;\n'.length);
    const payloadSHA256 = sha256(payload);
    const phaseGuard = cloudPhaseGuard(expectedPriorPhases, sentinelRunId, baseline.sourceChainSHA256);
    const ledger = cloudPhaseLedger(entry.file, payloadSHA256, ordinal, sentinelRunId, baseline.sourceChainSHA256);
    const promoted = cloudGuard + phaseGuard + payload + ledger;
    files[entry.file] = promoted;
    fileEvidence.push({ file: entry.file, sha256: sha256(promoted), bytes: Buffer.byteLength(promoted), draftSHA256: entry.sha256, payloadSHA256, ordinal });
    expectedPriorPhases.push({ file: entry.file, payloadSHA256, ordinal });
  }
  return { files, manifest: { ...draft.manifest, kind: 'vimob-cloud-baseline-transaction-trial-v1',
    classification: 'prepared-for-reviewed-transactional-cloud-trial', ready: false, trialPassed: false,
    remoteApplySupported: false, files: fileEvidence,
    execution: { projectRef: target.projectRef, organizationId: readback.project.organization_id,
      projectStatusObserved: readback.project.status, observedAtUTC: readback.observedAtUTC,
      sentinelSchema: 'vimob_cloud_staging', sentinelTable: 'sentinel', sentinelRunId,
      phaseHistoryTable: 'phase_history', phaseHistoryRequiredColumns: ['run_id uuid','phase_name text','payload_sha256 text','source_chain_sha256 text','ordinal integer'],
      requiredRole: 'postgres', superuserAllowed: false,
      description: 'No connection or remote execution is implemented. Root must verify the target API and staging sentinel, review each phase, apply it transactionally and inspect catalog results. Local rehearsal is not claimed.' } } };
}

async function main() {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index += 2) {
    assert.ok(['--draft-dir', '--target', '--readback', '--run-id', '--output-dir'].includes(args[index]) && args[index + 1] && !options[args[index]], 'Invalid promotion arguments.');
    options[args[index]] = args[index + 1];
  }
  for (const key of ['--draft-dir', '--target', '--readback', '--output-dir']) assert.ok(path.isAbsolute(options[key] ?? ''));
  const manifest = JSON.parse(await fs.readFile(path.join(options['--draft-dir'], 'manifest.json'), 'utf8'));
  const files = {};
  for (const entry of manifest.files) {
    assert.match(entry.file, /^\d{2}-[a-z0-9-]+\.sql$/);
    files[entry.file] = await fs.readFile(path.join(options['--draft-dir'], entry.file), 'utf8');
  }
  const target = JSON.parse(await fs.readFile(options['--target'], 'utf8'));
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const expectedDraft = buildCloudExport(await loadCloudSource(repositoryRoot), { target, rehearsalDatabase: manifest.rehearsalDatabase });
  assert.deepEqual(manifest, expectedDraft.manifest, 'Draft manifest is not the exact export of the current canonical source.');
  const readback = JSON.parse(await fs.readFile(options['--readback'], 'utf8'));
  const promoted = promoteCloudExport({ manifest, files }, { target, readback, sentinelRunId: options['--run-id'] });
  await writeCloudExport(options['--output-dir'], promoted);
  console.log(JSON.stringify({ result: 'cloud-transaction-trial-prepared-not-executed', projectRef: target.projectRef,
    ready: false, trialPassed: false, files: promoted.manifest.files.map(({ file, sha256 }) => ({ file, sha256 })) }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Cloud trial promotion failed closed. No database was accessed. Verify draft hashes, fresh public project readback and staging sentinel identity.'); process.exitCode = 1; });
}
