import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadCloudSource } from './cloud-baseline-contract.mjs';
import { statements } from './cloud-export-sql.mjs';
import { sha256 } from '../supabase/local-schema-baseline-contract.mjs';
import { RPC_DECISIONS, RPC_CHANGES, STAGING_REF, RUN_ID, SOURCE_CHAIN, BASELINE_ID, DEFINITION_HASH_CONTEXT, inventoryCanonicalRPCs } from './rpc-hardening-contract.mjs';
import { buildRpcHardening, rpcACLStatements } from './rpc-hardening-build.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const source=await loadCloudSource(root);
const verification=JSON.parse(await fs.readFile(path.join(root,'deploy/staging/cloud-verification.json'),'utf8'));
const epoch='2026-10-24T17:09:34.389Z';
const target={kind:'vimob-cloud-staging-target-v1',environment:'staging',projectRef:STAGING_REF,supabaseUrl:`https://${STAGING_REF}.supabase.co`};
function fixture() {
  return {target:structuredClone(target),now:Date.parse(epoch),verification:structuredClone(verification),
    readback:{observedAtUTC:epoch,project:{id:STAGING_REF,ref:STAGING_REF,status:'ACTIVE_HEALTHY',name:'vimob-homologacao',organization_id:'snqyytbmmbfasotklrje'}},
    preflight:{observedAtUTC:epoch,projectRef:STAGING_REF,definitionHashContext:structuredClone(DEFINITION_HASH_CONTEXT),users:0,objects:0,vaultEntries:0,cronPresent:false,phases:35,
      sentinel:[{project_ref:STAGING_REF,run_id:RUN_ID,baseline_id:BASELINE_ID,source_chain_sha256:SOURCE_CHAIN}],
      exposedDefiners:RPC_DECISIONS.map(row=>({signature:row.signature,definitionMD5:row.definitionMD5,returns:'fixture_non_trigger',owner:'postgres',
        publicExecute:false,anonExecute:true,authenticatedExecute:true,serviceExecute:true}))}};
}

test('finite source-backed matrix covers all39 non-trigger RPCs and the retired overload',()=>{
  const inventory=inventoryCanonicalRPCs(source);
  assert.equal(inventory.length,40); assert.equal(RPC_DECISIONS.length,39);
  assert.equal(RPC_CHANGES.length,24); assert.equal(RPC_CHANGES.filter(row=>row.decision==='service').length,22);
  assert.equal(RPC_DECISIONS.filter(row=>row.decision.startsWith('retain-')).length,16);
  assert.ok(inventory.every(row=>row.canonical.line>0));
  assert.ok(inventory.filter(row=>['service','retired'].includes(row.decision)).every(row=>row.directPolicyConsumers.length===0));
});

test('ACL supplement changes only the reviewed public signatures and preserves retired service denial',()=>{
  const parsed=statements(rpcACLStatements());
  assert.equal(parsed.filter(row=>row.tokens[0].value==='revoke').length,24);
  assert.equal(parsed.filter(row=>row.tokens[0].value==='grant').length,22);
  assert.ok(parsed.every(row=>row.tokens[2].value==='on'&&row.tokens[3].value==='function'&&row.tokens[4].value==='public'));
  for(const row of RPC_CHANGES.filter(row=>row.decision==='retired')) {
    assert.ok(rpcACLStatements().includes(`public.${row.signature} FROM PUBLIC, anon, authenticated, service_role;`));
    assert.ok(!rpcACLStatements().includes(`public.${row.signature} TO service_role;`));
  }
});

test('preview contains identical guarded ACL prefix, rolls back all fixtures; apply has no fixture DML',()=>{
  const bundle=buildRpcHardening(source,fixture());
  const preview=bundle.files['60-rpc-hardening-preview.sql'],apply=bundle.files['61-rpc-hardening-apply.sql'];
  assert.ok(preview.startsWith(apply.slice(0,-'\nCOMMIT;\n'.length)));
  assert.ok(preview.endsWith('\nROLLBACK;\n')); assert.ok(apply.endsWith('\nCOMMIT;\n'));
  assert.equal(statements(preview).filter(row=>row.tokens[0].value==='begin').length,1);
  assert.equal(statements(preview).filter(row=>row.tokens[0].value==='rollback').length,1);
  assert.equal(statements(apply).filter(row=>row.tokens[0].value==='commit').length,1);
  assert.ok(!apply.includes('INSERT INTO auth.users')); assert.ok(!apply.includes('INSERT INTO public.organizations'));
  assert.ok(!/INSERT\s+INTO\s+vimob_cloud_staging\.phase_history/i.test(preview+apply));
  assert.ok(!/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION|ALTER\s+FUNCTION|DISABLE\s+TRIGGER|session_replication_role/i.test(preview+apply));
  assert.ok(apply.includes('rpc_body_owner_or_proconfig_changed'));
  assert.ok(apply.includes('rpc_retained_acl_changed'));
  assert.ok(apply.includes('rpc_definition_hash_context_mismatch'));
  assert.equal((apply.match(/pg_catalog\.md5\(pg_catalog\.pg_get_functiondef\(p\.oid\)\)/g)??[]).length,3);
  assert.ok(apply.includes('cloud_trial_phase_order_or_hash_mismatch'));
  assert.equal(bundle.manifest.ready,false);assert.equal(bundle.manifest.sqlSmokeExecuted,false);
  for(const row of bundle.manifest.files) assert.equal(row.sha256,sha256(bundle.files[row.file]));
});

test('prepared smoke exercises permission rejection for both tenant identities and service worker effects',()=>{
  const preview=buildRpcHardening(source,fixture()).files['60-rpc-hardening-preview.sql'];
  assert.ok(preview.includes('SET LOCAL ROLE anon;'));
  assert.ok(preview.includes('SET LOCAL ROLE authenticated;'));
  assert.ok(preview.includes('SET LOCAL ROLE service_role;'));
  assert.ok(preview.includes('WHEN insufficient_privilege THEN NULL;'));
  assert.ok(preview.includes('cf910000-0000-4000-8000-000000000001'));
  assert.ok(preview.includes('cf910000-0000-4000-8000-000000000002'));
  assert.ok(preview.includes('rpc_smoke_synthetic_transition_or_tenant_sibling_changed'));
  assert.ok(preview.includes('rpc_smoke_requires_empty_business_domain'));
  assert.ok(preview.includes("IS DISTINCT FROM 'invalid_event'"));
  assert.ok(preview.includes("IS DISTINCT FROM 'execution_not_running'"));
  assert.ok(preview.includes("IS DISTINCT FROM 'not_waiting'"));
  assert.equal((preview.match(/IS DISTINCT FROM true/g)??[]).length,3);
  assert.ok(preview.includes("'probe','probe',now()+interval '1 hour') IS DISTINCT FROM false"));
});

test('composite-return hashes are pinned only in the explicit pg_catalog deparser context',()=>{
  const options=fixture();
  const oldHashes={
    'rebind_whatsapp_conversation_session(uuid,uuid)':'34bdd67554764ae9f16a84bf8395a4ba',
    'release_due_automation_delays(integer)':'0e7ddfeb9ebe3dcd98ba9b6819017922',
  };
  for(const [signature,oldHash] of Object.entries(oldHashes)) {
    const changed=structuredClone(options);
    changed.preflight.exposedDefiners.find(row=>row.signature===signature).definitionMD5=oldHash;
    assert.throws(()=>buildRpcHardening(source,changed));
  }
  const bundle=buildRpcHardening(source,options),sql=bundle.files['61-rpc-hardening-apply.sql'];
  assert.equal(bundle.manifest.kind,'vimob-cloud-staging-rpc-hardening-draft-v3');
  assert.deepEqual(bundle.manifest.definitionHashContext,DEFINITION_HASH_CONTEXT);
  for(const expected of ['05c0f5503b6ab05d2d44b31391c474cd','12f09ff6c9a88063ce1b07aa63669175','5123f4c32d88eb68042c85578fb9d4b1']) assert.ok(sql.includes(expected));
  for(const prior of [...Object.values(oldHashes),'e9270f6d124d650e1ad6e703d639627a']) assert.ok(!sql.includes(prior));
});

test('V3 checks ambiguous rebind2 by exact OID only and preserves byte-identical V2 ACL apply SQL',()=>{
  const bundle=buildRpcHardening(source,fixture());
  const preview=bundle.files['60-rpc-hardening-preview.sql'];
  assert.equal(sha256(bundle.files['61-rpc-hardening-apply.sql']),'e7de34357dc7555dc505f67e61c095e322d75637ef59a027b6b8859362d7193b');
  assert.equal((preview.match(/rpc_smoke_rebind_two_arg_exact_oid_permission_denied/g)??[]).length,3);
  assert.equal((preview.match(/has_function_privilege\(current_user,function_oid,'EXECUTE'\) IS DISTINCT FROM false/g)??[]).length,3);
  const rebindInvocations=preview.match(/SELECT public\.rebind_whatsapp_conversation_session\([^)]*\)/g)??[];
  assert.equal(rebindInvocations.length,3);
  assert.equal((preview.match(/'SELECT public\./g)??[]).length,47,'23 real denial calls for each client role plus the explicit three-argument retired overload for service_role.');
  assert.ok(rebindInvocations.every(call=>call.includes('rpc-hardening-probe')),'Only the explicit three-argument overload is invoked.');
  assert.ok(!/WHEN\s+(?:ambiguous_function|OTHERS)|SQLSTATE\s*'42725'/i.test(preview));
  assert.equal((preview.match(/EXCEPTION WHEN insufficient_privilege THEN NULL;/g)??[]).length,3);
  assert.ok(preview.includes('exact-OID ACL checked; direct invocation unavailable due to ambiguous defaulted overload'));
});

test('production, another staging project, stale metadata, stale SQL snapshot and nonempty target fail closed',()=>{
  for(const mutate of [
    o=>{o.target.projectRef='iemalzlfnbouobyjwlwi';o.target.supabaseUrl='https://iemalzlfnbouobyjwlwi.supabase.co';},
    o=>{o.target.projectRef='aaaaaaaaaaaaaaaaaaaa';o.target.supabaseUrl='https://aaaaaaaaaaaaaaaaaaaa.supabase.co';},
    o=>{o.readback.project.organization_id='other-org';},
    o=>{o.readback.observedAtUTC='2020-01-01T00:00:00Z';},
    o=>{o.preflight.observedAtUTC='2020-01-01T00:00:00Z';},
    o=>{o.preflight.users=1;},o=>{o.preflight.objects=1;},o=>{o.preflight.vaultEntries=1;},
    o=>{o.preflight.cronPresent=true;},o=>{o.preflight.sentinel[0].run_id='00000000-0000-4000-8000-000000000000';},
  ]) {const options=fixture();mutate(options);assert.throws(()=>buildRpcHardening(source,options));}
});

test('unknown RPC, changed owner/body/effective ACL and ledger hash/order are rejected',()=>{
  for(const mutate of [
    o=>{o.preflight.exposedDefiners[0].signature='unreviewed_function()';},
    o=>{o.preflight.exposedDefiners[0].owner='supabase_admin';},
    o=>{o.preflight.exposedDefiners[0].definitionMD5='0'.repeat(32);},
    o=>{o.preflight.exposedDefiners[0].publicExecute=true;},
    o=>{o.preflight.exposedDefiners[0].serviceExecute=false;},
    o=>{delete o.preflight.definitionHashContext;},
    o=>{o.preflight.definitionHashContext.searchPath='public';},
    o=>{o.preflight.definitionHashContext.deparser='pg_get_functiondef';},
    o=>{o.verification.catalog.phaseHistory[0].payloadSHA256='0'.repeat(64);},
    o=>{o.verification.catalog.phaseHistory.reverse();},
    o=>{o.preflight.phases=36;},
  ]) {const options=fixture();mutate(options);assert.throws(()=>buildRpcHardening(source,options));}
});

test('source chain changes and direct policy/forward dependencies require review',()=>{
  let changed=structuredClone(source);changed.manifest.sourceChainSHA256='0'.repeat(64);
  assert.throws(()=>buildRpcHardening(changed,fixture()));
  changed=structuredClone(source);changed.forwards[0].source+='\nSELECT public.get_session_owner(NULL);\n';
  assert.throws(()=>buildRpcHardening(changed,fixture()));
  changed=structuredClone(source);changed.forwards.push({...changed.forwards[0]});
  assert.throws(()=>buildRpcHardening(changed,fixture()));
  changed=structuredClone(source);changed.artifacts.find(row=>row.kind==='schema').source+=
    '\n--\n-- Name: x direct_policy; Type: POLICY; Schema: public; Owner: postgres\n--\nCREATE POLICY direct_policy ON public.users USING (public."get_session_owner"(NULL) IS NULL);\n';
  assert.throws(()=>buildRpcHardening(changed,fixture()));
});
