import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize, sha256 } from '../supabase/local-schema-baseline-contract.mjs';
import { transactionalMigration } from '../supabase/local-schema-baseline-history.mjs';
import { loadCloudSource } from './cloud-baseline-contract.mjs';
import { assertFreshCloudReadback, cloudIdentityGuard, cloudPhaseGuard } from './cloud-export-promote.mjs';
import { writeCloudExport } from './cloud-export.mjs';
import { STAGING_REF, RUN_ID, SOURCE_CHAIN, BASELINE_ID, DEFINITION_HASH_CONTEXT, RPC_DECISIONS, RPC_CHANGES, inventoryCanonicalRPCs } from './rpc-hardening-contract.mjs';
import { rpcHardeningSmoke } from './rpc-hardening-smoke.mjs';

const literal = value => `'${value.replaceAll("'", "''")}'`;
const LEDGER_DIGEST = '245380ac45861494d87c3dca6ea04cabcb82f301edf28d34c8bbb407585cdf1f';

export function validateRpcInputs(source, { target, readback, preflight, verification, now = Date.now() }) {
  assertFreshCloudReadback(target, readback, now);
  assert.equal(target.projectRef, STAGING_REF, 'This supplement belongs only to the already provisioned staging project.');
  assert.equal(preflight.projectRef, STAGING_REF);
  assert.deepEqual(preflight.definitionHashContext, DEFINITION_HASH_CONTEXT,
    'Definition hashes must be collected under the exact fixed deparser context.');
  const age = now - Date.parse(preflight.observedAtUTC);
  assert.ok(Number.isFinite(age) && age >= 0 && age <= 15 * 60_000, 'Fresh read-only staging SQL preflight is required.');
  assert.equal(preflight.phases, 35); assert.equal(preflight.users, 0); assert.equal(preflight.objects, 0);
  assert.equal(preflight.vaultEntries, 0); assert.equal(preflight.cronPresent, false);
  assert.equal(preflight.sentinel.length, 1);
  const sentinel = preflight.sentinel[0];
  assert.equal(sentinel.project_ref, STAGING_REF); assert.equal(sentinel.run_id, RUN_ID);
  assert.equal(sentinel.baseline_id, BASELINE_ID); assert.equal(sentinel.source_chain_sha256, SOURCE_CHAIN);
  assert.equal(verification.projectRef, STAGING_REF); assert.equal(verification.sentinelRunId, RUN_ID);
  assert.equal(verification.sourceChainSHA256, SOURCE_CHAIN);
  assert.equal(sha256(JSON.stringify(verification.catalog.phaseHistory)), LEDGER_DIGEST, 'Reviewed original ledger hashes changed.');
  // This historical supplement checks the installed ledger, not later forwards.
  // Every current source stays hash-checked and participates in the RPC scan.
  for (const forward of source.forwards) {
    assert.equal(sha256(normalize(forward.source)),forward.sha256,'Canonical forward source changed after validation.');
  }
  const installedPhases = verification.catalog.phaseHistory.slice(15);
  assert.equal(installedPhases.length,20,'The reviewed historical ledger requires exactly twenty installed forwards.');
  const installedForwards = source.forwards.filter(forward => installedPhases.some(phase =>
    phase.phase === `40-forward-${forward.file.slice(0,14)}.sql`));
  assert.equal(installedForwards.length,20,'An installed canonical forward is absent from the current sources.');
  for (const [index,forward] of installedForwards.entries()) {
    const phase=verification.catalog.phaseHistory[15+index];
    assert.equal(phase.phase,`40-forward-${forward.file.slice(0,14)}.sql`);
    assert.equal(phase.payloadSHA256,sha256(transactionalMigration(normalize(forward.source))),
      'Canonical forward payload differs from the already installed reviewed ledger.');
  }
  const exposed = preflight.exposedDefiners.filter(row => row.returns !== 'trigger');
  assert.equal(exposed.length, 39); assert.equal(new Set(exposed.map(row => row.signature)).size, 39);
  assert.deepEqual(exposed.map(row => row.signature).sort(), RPC_DECISIONS.map(row => row.signature).sort());
  for (const expected of RPC_DECISIONS) {
    const actual = exposed.find(row => row.signature === expected.signature);
    assert.equal(actual.owner, 'postgres'); assert.equal(actual.definitionMD5, expected.definitionMD5);
    assert.equal(actual.publicExecute, false); assert.equal(actual.anonExecute, true);
    assert.equal(actual.authenticatedExecute, true); assert.equal(actual.serviceExecute, true);
  }
  return inventoryCanonicalRPCs(source);
}

function catalogPreflight(inventory) {
  const rows = inventory.map(row => `(${literal(`public.${row.signature}`)},${literal(row.definitionMD5)},${literal(row.decision)})`).join(',\n');
  return `
-- This temp snapshot also proves every retained RPC's effective ACL is unchanged.
CREATE TEMP TABLE vimob_rpc_expected(signature text PRIMARY KEY, definition_md5 text NOT NULL, decision text NOT NULL) ON COMMIT DROP;
INSERT INTO pg_temp.vimob_rpc_expected VALUES ${rows};
DO $rpc_preflight$
DECLARE expected record; function_oid oid; actor text;
BEGIN
  IF pg_catalog.current_setting('search_path')<>'pg_catalog' THEN
    RAISE EXCEPTION 'rpc_definition_hash_context_mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users) OR EXISTS (SELECT 1 FROM storage.objects)
     OR EXISTS (SELECT 1 FROM vault.secrets) OR to_regnamespace('cron') IS NOT NULL THEN
    RAISE EXCEPTION 'rpc_supplement_requires_empty_isolated_staging';
  END IF;
  FOR expected IN SELECT * FROM pg_temp.vimob_rpc_expected LOOP
    function_oid := to_regprocedure(expected.signature);
    IF function_oid IS NULL OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
      WHERE p.oid=function_oid AND p.prosecdef AND r.rolname='postgres'
        AND pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))=expected.definition_md5) THEN
      RAISE EXCEPTION 'rpc_definition_owner_or_security_changed: %', expected.signature;
    END IF;
    IF expected.decision IN ('service','retired') AND EXISTS (
      SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      LEFT JOIN pg_roles grantee ON grantee.oid=a.grantee
      WHERE p.oid=function_oid AND (a.grantor<>p.proowner OR
        (a.grantee<>0 AND grantee.rolname NOT IN ('postgres','anon','authenticated','service_role')))
    ) THEN RAISE EXCEPTION 'rpc_unreviewed_acl_grantor_or_role: %',expected.signature; END IF;
    FOREACH actor IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF NOT has_schema_privilege(actor,'public','USAGE') OR has_schema_privilege(actor,'public','CREATE') THEN
        RAISE EXCEPTION 'rpc_unexpected_public_schema_privileges';
      END IF;
    END LOOP;
  END LOOP;
END $rpc_preflight$;
CREATE TEMP TABLE vimob_rpc_before ON COMMIT DROP AS
SELECT e.signature,p.proowner,p.prosecdef,p.proconfig,pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) AS definition_md5,
  p.proacl,has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute
FROM pg_temp.vimob_rpc_expected e JOIN pg_proc p ON p.oid=to_regprocedure(e.signature);
`;
}

export function rpcACLStatements() {
  return RPC_CHANGES.map(row => `REVOKE EXECUTE ON FUNCTION public.${row.signature} FROM PUBLIC, anon, authenticated${row.decision === 'retired' ? ', service_role' : ''};\n`
    + (row.decision === 'service' ? `GRANT EXECUTE ON FUNCTION public.${row.signature} TO service_role;\n` : '')).join('');
}

function catalogPostflight() {
  return `
DO $rpc_postflight$
DECLARE expected record; function_oid oid;
BEGIN
  IF pg_catalog.current_setting('search_path')<>'pg_catalog' THEN
    RAISE EXCEPTION 'rpc_definition_hash_context_mismatch';
  END IF;
  FOR expected IN SELECT * FROM pg_temp.vimob_rpc_expected LOOP
    function_oid := to_regprocedure(expected.signature);
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_temp.vimob_rpc_before b ON b.signature=expected.signature
      WHERE p.oid=function_oid AND p.proowner=b.proowner AND p.prosecdef=b.prosecdef
        AND p.proconfig IS NOT DISTINCT FROM b.proconfig
        AND pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))=b.definition_md5) THEN
      RAISE EXCEPTION 'rpc_body_owner_or_proconfig_changed: %',expected.signature;
    END IF;
    IF expected.decision IN ('service','retired') THEN
      IF has_function_privilege('anon',function_oid,'EXECUTE')
         OR has_function_privilege('authenticated',function_oid,'EXECUTE')
         OR has_function_privilege('service_role',function_oid,'EXECUTE')<>(expected.decision='service')
         OR NOT has_function_privilege('postgres',function_oid,'EXECUTE')
         OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
           WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN
        RAISE EXCEPTION 'rpc_effective_execute_contract_failed: %',expected.signature;
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_temp.vimob_rpc_before b ON b.signature=expected.signature
      WHERE p.oid=function_oid AND p.proacl IS NOT DISTINCT FROM b.proacl
        AND has_function_privilege('anon',p.oid,'EXECUTE')=b.anon_execute
        AND has_function_privilege('authenticated',p.oid,'EXECUTE')=b.authenticated_execute
        AND has_function_privilege('service_role',p.oid,'EXECUTE')=b.service_execute) THEN
      RAISE EXCEPTION 'rpc_retained_acl_changed: %',expected.signature;
    END IF;
  END LOOP;
END $rpc_postflight$;
`;
}

export function buildRpcHardening(source, options) {
  const inventory = validateRpcInputs(source, options);
  const phases = options.verification.catalog.phaseHistory.map(row => ({ file: row.phase, ordinal: row.ordinal, payloadSHA256: row.payloadSHA256 }));
  const guard = cloudIdentityGuard(options.target, source.manifest, RUN_ID) + cloudPhaseGuard(phases, RUN_ID, SOURCE_CHAIN);
  const payload = catalogPreflight(inventory) + rpcACLStatements() + catalogPostflight();
  const files = {
    '60-rpc-hardening-preview.sql': guard + payload + rpcHardeningSmoke() + '\nROLLBACK;\n',
    '61-rpc-hardening-apply.sql': guard + payload + '\nCOMMIT;\n',
  };
  return { files, manifest: {
    kind: 'vimob-cloud-staging-rpc-hardening-draft-v3', ready: false, remoteApplySupported: false,
    preparedOnly: true, sqlExecutedByThisTool: false, sqlSmokeExecuted: false, applicationAcceptancePassed: false,
    target: options.target, baselineId: BASELINE_ID, sourceChainSHA256: SOURCE_CHAIN, sentinelRunId: RUN_ID,
    sourceArtifacts: source.artifacts.map(({ file, sha256: hash }) => ({ file, sha256: hash })),
    originalPhaseLedgerPreserved: true, requiredOriginalPhaseCount: phases.length,
    sqlPreflightObservedAtUTC: options.preflight.observedAtUTC, projectReadbackObservedAtUTC: options.readback.observedAtUTC,
    definitionHashContext: DEFINITION_HASH_CONTEXT,
    nonTriggerInventoryCount: RPC_DECISIONS.length, additionalRetiredOverloadCount: 1,
    changedSignatureCount: RPC_CHANGES.length, serviceRoleSignatureCount: RPC_CHANGES.filter(row => row.decision === 'service').length,
    retainedSignatureCount: RPC_DECISIONS.filter(row => row.decision.startsWith('retain-')).length,
    inventory, files: Object.entries(files).map(([file, sql]) => ({ file, sha256: sha256(sql), bytes: Buffer.byteLength(sql) })),
    executionOrder: ['Review the complete generated SQL and fresh project API identity.',
      'Run 60 as a single execute_sql transaction; require all assertions and ROLLBACK success.',
      'Only after successful rehearsal, submit unchanged 61 with a separate staging-specific apply_migration name.',
      'Read back actual effective ACLs and unchanged original 35-row ledger; store execution evidence separately.'],
    limits: ['rebind(uuid,uuid) direct SQL invocation is ambiguous due to the defaulted three-argument overload; each role is denied by effective ACL on its exact regprocedure OID, not a caught 42725.',
      'Other changed RPCs, including rebind(uuid,uuid,text), require actual insufficient_privilege (42501) in the SQL rehearsal.',
      'SQL role simulation does not prove Auth HTTP, PostgREST, Storage or private WebSocket behavior.',
      'A narrower RPC surface does not resolve all advisor categories or authorize general staging access.',
      'No remote client, credential loader, database connection or original phase-history INSERT exists here.'],
  } };
}

async function main() {
  const args = process.argv.slice(2), options = {};
  const keys = ['--target','--readback','--preflight','--verification','--output-dir'];
  for (let index=0; index<args.length; index+=2) {
    assert.ok(keys.includes(args[index]) && args[index+1] && !options[args[index]], 'Invalid arguments.');
    options[args[index]]=args[index+1];
  }
  for (const key of keys) assert.ok(path.isAbsolute(options[key] ?? ''), 'All paths must be absolute.');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const [source, target, readback, preflight, verification] = await Promise.all([
    loadCloudSource(root), ...keys.slice(0,4).map(async key => JSON.parse(await fs.readFile(options[key],'utf8'))),
  ]);
  const bundle = buildRpcHardening(source,{target,readback,preflight,verification});
  await writeCloudExport(options['--output-dir'],bundle);
  console.log(JSON.stringify({ result:'rpc-hardening-prepared-not-executed',ready:false,
    projectRef:STAGING_REF,changedSignatures:RPC_CHANGES.length,files:bundle.manifest.files },null,2));
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('RPC hardening preparation failed closed. No database was accessed. Check immutable sources, fresh staging readbacks and reviewed catalog/ledger hashes.'); process.exitCode=1; });
}
