import assert from 'node:assert/strict';
import { inventoryDump } from './cloud-baseline-plan.mjs';

export const STAGING_REF = 'lfkfuhvjvqgwyikzcfep';
export const RUN_ID = 'f7196a56-e7bb-4221-b61d-f3a95245338c';
export const SOURCE_CHAIN = '48dd4fdc5f5dcfbaf08d514cb66167a8c5366542afd016b9027d3758196ad22c';
export const BASELINE_ID = 'local-20261016-238-v1';
export const DEFINITION_HASH_CONTEXT = Object.freeze({ searchPath: 'pg_catalog',
  deparser: 'pg_catalog.pg_get_functiondef', digest: 'pg_catalog.md5' });
const runtime = 'supabase/functions/_shared/automation-runtime.ts';
const historical = 'supabase/migrations/20260722000000_production_public_private_baseline.sql';

// MD5 values identify pg_get_functiondef from the selected Cloud catalog under
// the explicit DEFINITION_HASH_CONTEXT, not hashes of SQL source text.
// No function body is rewritten by this supplement.
export const RPC_DECISIONS = [
  ['admin_dashboard_feed(integer)', '43d169d2048c8b9d2a212b7bff749df6', 'retain-guarded', 'EXISTS current auth.uid() with super_admin role; no direct application caller found.'],
  ['admin_dashboard_pending_boards()', 'a1a8905703b7926d58c856b65d963517', 'retain-guarded', 'EXISTS current auth.uid() with super_admin role; no direct application caller found.'],
  ['admin_list_organizations(text,text,text)', 'c2bfd8db5db71f31678756f081de528b', 'retain-guarded', 'EXISTS current auth.uid() with super_admin role; no direct application caller found.'],
  ['can_access_whatsapp_session(uuid,uuid)', '6a92170882ab79afaf377b03732ce98e', 'service', 'Arbitrary session/user pair is accepted; no direct POLICY or application consumer in the canonical chain.'],
  ['can_manage_session(uuid)', '745c80f063b443458d17a1f12423c866', 'retain-guarded', 'Organization and owner/admin predicates derive from the current auth.uid().'],
  ['cancel_disabled_automation_runtime(integer)', '6116bfacbb1052a22f0ec4bd211e5936', 'service', `${runtime}:950; adminClient service_role; global worker maintenance.`],
  ['check_storage_org_access(text)', '64628e293d161a6a241b8e016da7d2d0', 'retain-guarded', 'UUID parse fails closed; membership/super_admin is checked against current auth.uid().'],
  ['complete_automation_event(uuid,text)', '84b532ec33643bb4680aa284a6b661da', 'service', `${runtime}:263; adminClient service_role; worker lease is not caller authorization.`],
  ['copy_default_dre_groups(uuid)', 'e315dd76b8a8a9b846f59885dbfda9f9', 'service', `apps/api/internal/financial/repository_dre.go:152 uses the SQL pool; postgres owner retained. ${historical}:27754-27755.`],
  ['count_unique_sessions(uuid,timestamp with time zone,timestamp with time zone)', '9ec54d5b4192a2d42b6fb0f33d3ff821', 'retain-guarded', 'Explicit null/current-organization check or super_admin before counting.'],
  ['enter_automation_delay_wait(uuid,uuid,uuid,text,text,timestamp with time zone)', '21ac27c1ce3558e39af2372197551ee1', 'service', `${runtime}:827; adminClient service_role.`],
  ['fail_automation_event(uuid,text,text,integer)', 'ec523a75559aea5eae0ec95e8df57068', 'service', `${runtime}:268; adminClient service_role.`],
  ['find_duplicate_lead_by_phone(text)', 'a30292834512937f76bc78485cf1323f', 'retain-guarded', 'Requires auth.uid(), derives its organization and filters every lead by that organization.'],
  ['finish_automation_external_effect(text,text,jsonb,text,text)', 'bfa72438066ab7ef29011610e9817249', 'service', `${runtime}:570; adminClient service_role; effect key is not caller authorization.`],
  ['generate_organization_api_key(text,uuid)', 'e23bcb9b95a361485eee7571bb9e0daa', 'retain-guarded', 'Explicit EXISTS for current organization admin or super_admin before secret generation.'],
  ['get_my_org_id()', '78fd9dd78022e00d3bdbe763609e5249', 'retain-guarded', 'Returns only the organization of current auth.uid().'],
  ['get_or_create_active_season(uuid)', '01931db136605c35ca5d864e641a14b6', 'service', `Creates a season for arbitrary organization without caller check. No application/POLICY caller found. ${historical}:27933-27934.`],
  ['get_session_owner(uuid)', 'a0c7a6a348f614351c2dcafca8f535c1', 'service', 'Arbitrary session ID returns owner; no direct POLICY or application consumer in the canonical chain.'],
  ['get_sla_pending_leads()', '0d76743b7fb171177cccd33cf7994d33', 'service', 'supabase/functions/sla-checker/index.ts:78-96: private worker authorization and service_role client; global lead scan.'],
  ['get_sla_start_at(uuid)', 'c6c23fb4372007c1c286930eb237951f', 'service', 'Arbitrary lead ID exposes time; nested get_sla_pending_leads runs as postgres and remains callable.'],
  ['get_user_organization_role(uuid)', '2d7c5cc5d45f1a134bd4f01ab4138899', 'service', 'Arbitrary user ID returns roles/permissions; default auth.uid() does not constrain explicit argument. No POLICY/app caller found.'],
  ['has_whatsapp_session_ownership(uuid,uuid)', '5db8b9833a9465325e6e1dc5fc039ad9', 'service', 'Arbitrary session/user pair is accepted; no direct POLICY or application consumer in the canonical chain.'],
  ['list_all_organizations_admin()', '6a09a6364a92b5417f9466aa02585f46', 'retain-guarded', 'Calls is_super_admin -> private.is_super_admin, which uses EXISTS for current auth.uid().'],
  ['list_all_users_admin()', 'e356b376d5ac671952cec3fbba86bbf8', 'retain-guarded', 'Calls is_super_admin -> private.is_super_admin, which uses EXISTS for current auth.uid().'],
  ['mark_overdue_financial_entries()', 'c70d273984efab95070c20fdc338fc0c', 'service', `Global financial UPDATE without caller check; no current code caller. ${historical}:28136-28137.`],
  ['notify_financial_entries()', '85f31013a51c51487e6205f2c46e49c1', 'service', `Global financial notification sweep without caller check; nested create_notification remains postgres. ${historical}:28173-28174.`],
  ['notify_whatsapp_on_lead(uuid,uuid,text,text)', 'b4e31c566a303d9b938a183ab4b7cf10', 'retain-noop', 'Body only RETURN; legacy notification is disabled. No direct application caller found.'],
  ['rebind_whatsapp_conversation_session(uuid,uuid)', '05c0f5503b6ab05d2d44b31391c474cd', 'retired', 'supabase/cutovers/20260919_enable_strict_whatsapp_message_binding.sql:730-736 explicitly retires the pre-ledger helper, including service_role.'],
  ['recover_stuck_executions(integer)', 'e6ce3b6f867c1cf6752e5c1a49c312ac', 'service', `Global execution UPDATE without caller check; no current code caller. ${historical}:28243-28244.`],
  ['release_due_automation_delays(integer)', '12f09ff6c9a88063ce1b07aa63669175', 'service', `${runtime}:943; adminClient service_role; global due-delay scan.`],
  ['release_execution_step_lock(uuid,text)', '2b6ef87b8e4b8922b75c43caea97caba', 'service', `Mutates execution by supplied ID/token, no caller check; no current code caller. ${historical}:28273-28274.`],
  ['reserve_automation_external_effect(uuid,uuid,text,text,text,text,jsonb)', '09d431cf23f26b3d14e409ffb76c5ce1', 'service', `${runtime}:521,541; adminClient service_role.`],
  ['resolve_site_domain(text)', '37327fea41c3d1fcc8ee3eda01b1485e', 'retain-public', 'supabase/functions/resolve-site-domain/index.ts:117 exposes public active-site configuration; requires domain configuration review separately.'],
  ['resume_automation_delay(uuid,uuid,text,timestamp with time zone,jsonb,uuid,uuid)', 'c2b1369231746a4e56814c1ad6e8addd', 'service', 'Nested release_due_automation_delays/process_automation_inbound_message calls execute as postgres, retained.'],
  ['start_automation_execution_from_event(uuid,uuid,uuid,uuid,uuid,text,jsonb)', 'e3594609ad6c61aca8fdf1140d19cd7d', 'service', `${runtime}:231; adminClient service_role.`],
  ['try_acquire_execution_step_lock(uuid,integer)', '0ed78f73d1a5a54dc6b023bbc94abd1d', 'service', `Mutates execution by supplied ID, no caller check; no current code caller. ${historical}:28412-28413.`],
  ['user_has_session_access(uuid)', 'bf1c6b56b202516fae1a789bfe1686ef', 'retain-guarded', 'Access row must belong to current auth.uid() and can_view=true.'],
  ['verify_billing_payment_receipt(uuid)', '7d0a2ac8c37eb47b577357701b9fcb0a', 'retain-public', 'lib/billing/payment-receipt.server.ts:34-41 deliberately uses anon client and a normalized receipt UUID capability.'],
  ['vimob_can_access_whatsapp_conversation(uuid,text)', '0d20aecc179b6dda58c94131e4c13ada', 'retain-guarded', 'Nested private helper checks current auth.uid() owns active session and is an organization member.'],
].map(([signature, definitionMD5, decision, evidence]) => ({ signature, definitionMD5, decision, evidence }));

export const RETIRED_OVERLOAD = { signature: 'rebind_whatsapp_conversation_session(uuid,uuid,text)',
  definitionMD5: '5123f4c32d88eb68042c85578fb9d4b1', decision: 'retired',
  evidence: 'Same B1 retirement, cutover lines735-736; root Cloud readback 2026-10-24 under pg_catalog confirms service_role still has EXECUTE.' };
export const RPC_CHANGES = [...RPC_DECISIONS.filter(row => ['service', 'retired'].includes(row.decision)), RETIRED_OVERLOAD];
const compact = value => value.replace(/,\s*/g, ',');

export function inventoryCanonicalRPCs(source) {
  assert.equal(source.manifest.sourceChainSHA256, SOURCE_CHAIN);
  assert.equal(source.manifest.baselineId, BASELINE_ID);
  const blocks = source.artifacts.filter(row => row.kind === 'schema')
    .flatMap(row => inventoryDump(row.source, row.file));
  const rows = [...RPC_DECISIONS, RETIRED_OVERLOAD].map(row => {
    const block = blocks.find(block => block.schema === 'public' && block.type === 'FUNCTION' && compact(block.name) === row.signature);
    assert.ok(block, 'A reviewed RPC is absent from the immutable canonical baseline.');
    const name = row.signature.split('(')[0];
    const callPattern = new RegExp(`\\b${name}"?\\s*\\(`, 'i');
    const policyConsumers = blocks.filter(other => other.type === 'POLICY' && callPattern.test(other.source));
    if (RPC_CHANGES.some(change => change.signature === row.signature)) {
      assert.equal(policyConsumers.length, 0, 'Changing a direct policy dependency requires separate caller review.');
      for (const forward of source.forwards) {
        assert.ok(!callPattern.test(forward.source), 'A reviewed RPC occurs in a forward: review its effective definition/callers first.');
      }
    }
    return { ...row, canonical: { file: block.artifact, line: block.line },
      directPolicyConsumers: policyConsumers.map(other => ({ file: other.artifact, line: other.line, name: other.name })) };
  });
  assert.equal(rows.length, 40); assert.equal(RPC_CHANGES.length, 24);
  return rows;
}
