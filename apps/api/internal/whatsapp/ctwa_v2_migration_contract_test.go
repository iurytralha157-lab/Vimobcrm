package whatsapp

import (
	"strings"
	"testing"
)

const ctwaV2Migration = "20260904121500_add_ctwa_ad_v2_evolution_clid_contract.sql"

func TestCTWAV2MigrationKeepsProofClosedAcrossDatabaseBoundaries(t *testing.T) {
	source := strings.ToLower(readCTWAContractFile(t,
		"supabase", "migrations", ctwaV2Migration,
	))
	compact := compactCTWAContract(source)

	for _, fragment := range []string{
		"begin; set local lock_timeout = '5s';",
		"create or replace function private.whatsapp_metadata_ctwa_confirmation_method(p_metadata jsonb)",
		"create or replace function private.whatsapp_metadata_is_ctwa_ad(p_metadata jsonb)",
		"create or replace function public.whatsapp_webhook_has_lead_creation_context(p_metadata jsonb)",
		"create or replace function private.validate_managed_whatsapp_ctwa_ad()",
		"create or replace function public.enrich_whatsapp_lead_entry_attribution(",
		"create or replace preserves the existing trigger bindings",
		"commit;",
	} {
		requireCTWAContractContains(t, compact, fragment)
	}

	method := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"create or replace function private.whatsapp_metadata_ctwa_confirmation_method(p_metadata jsonb)",
		"revoke all on function private.whatsapp_metadata_ctwa_confirmation_method(jsonb)",
	))
	for _, fragment := range []string{
		"v_attribution->>'entry_point_conversion_source'",
		"v_referral->>'entry_point_conversion_source'",
		"return 'entry_point_ctwa_ad'",
		"v_attribution->>'explicit_source_type'",
		"v_referral->>'explicit_source_type'",
		"v_explicit_source_type_top is null or v_explicit_source_type_top = 'ad'",
		"v_explicit_source_type_referral is null or v_explicit_source_type_referral = 'ad'",
		"v_attribution->'ctwa_proof_conflict'",
		"v_referral->'ctwa_proof_conflict'",
		"v_proof_conflict_top <> 'false'::jsonb",
		"v_proof_conflict_referral <> 'false'::jsonb",
		"v_ctwa_clid_top_json <> v_ctwa_clid_referral_json",
		"v_show_ad_attribution_top <> v_show_ad_attribution_referral",
		"coalesce(v_explicit_source_type_top, v_explicit_source_type_referral, '') <> 'ad'",
		"v_attribution->>'ctwa_clid'",
		"v_referral->>'ctwa_clid'",
		"jsonb_typeof(v_ctwa_clid_top_json) <> 'string'",
		"jsonb_typeof(v_ctwa_clid_referral_json) <> 'string'",
		"octet_length(v_ctwa_clid) not between 8 and 512",
		"v_ctwa_clid ~ '[[:cntrl:]]'",
		"v_attribution->'show_ad_attribution'",
		"v_referral->'show_ad_attribution'",
		"v_show_ad_attribution_top <> 'true'::jsonb",
		"v_show_ad_attribution_referral <> 'true'::jsonb",
		"v_attribution->'ctwa_show_ad_attribution_invalid'",
		"v_referral->'ctwa_show_ad_attribution_invalid'",
		"jsonb_typeof(v_show_ad_attribution_top) <> 'boolean'",
		"jsonb_typeof(v_show_ad_attribution_referral) <> 'boolean'",
		"return 'evolution_ctwa_clid_v1'",
	} {
		requireCTWAContractContains(t, method, fragment)
	}
	for _, forbidden := range []string{
		"v_attribution->>'source_type'",
		"v_referral->>'source_type'",
		"source_id",
		"source_url",
		"initial_message",
	} {
		if strings.Contains(method, forbidden) {
			t.Fatalf("CTWA v2 proof must not authorize from %q", forbidden)
		}
	}
	entryPointBranch := strings.Index(method, "if v_entry_point_top is not null or v_entry_point_referral is not null then")
	fallbackBranch := strings.Index(method, "if coalesce(v_explicit_source_type_top, v_explicit_source_type_referral, '') <> 'ad'")
	if entryPointBranch < 0 || fallbackBranch < 0 || entryPointBranch >= fallbackBranch {
		t.Fatal("a present non-CTWA entry point must be rejected before evaluating the Evolution fallback")
	}
	clidTypeGuard := strings.Index(method, "jsonb_typeof(v_ctwa_clid_top_json) <> 'string'")
	if clidTypeGuard < 0 || clidTypeGuard >= entryPointBranch {
		t.Fatal("a malformed click id must fail closed before either CTWA confirmation branch")
	}
	showInvalidGuard := strings.Index(method, "v_show_invalid_top <> 'false'::jsonb")
	showTypeGuard := strings.Index(method, "jsonb_typeof(v_show_ad_attribution_top) <> 'boolean'")
	if showInvalidGuard < 0 || showInvalidGuard >= entryPointBranch || showTypeGuard < 0 || showTypeGuard >= entryPointBranch {
		t.Fatal("malformed show attribution must fail closed before either CTWA confirmation branch")
	}

	creationGate := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"create or replace function public.whatsapp_webhook_has_lead_creation_context(p_metadata jsonb)",
		"revoke all on function public.whatsapp_webhook_has_lead_creation_context(jsonb)",
	))
	for _, fragment := range []string{
		"managed_context.contract_version = 'ctwa_ad_v1' then managed_context.confirmation_method = 'entry_point_ctwa_ad'",
		"managed_context.declared_confirmation_method in ('', 'entry_point_ctwa_ad')",
		"managed_context.contract_version = 'ctwa_ad_v2' then managed_context.confirmation_method in ( 'entry_point_ctwa_ad', 'evolution_ctwa_clid_v1' )",
		"managed_context.declared_confirmation_method = managed_context.confirmation_method",
		"when managed_context.contract_version <> '' then false",
		"else managed_context.confirmation_method is not null",
		"end, false) and case",
		"when managed_context.is_managed then coalesce(",
		"managed_context.rule_id is not null and managed_context.session_id is not null and managed_context.round_robin_id is not null",
	} {
		requireCTWAContractContains(t, creationGate, fragment)
	}
	for _, forbidden := range []string{"source_id", "source_url", "initial_message"} {
		if strings.Contains(creationGate, forbidden) {
			t.Fatalf("lead creation context must not authorize from %q", forbidden)
		}
	}

	trigger := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"create or replace function private.validate_managed_whatsapp_ctwa_ad()",
		"revoke all on function private.validate_managed_whatsapp_ctwa_ad()",
	))
	for _, fragment := range []string{
		"old.metadata->'ctwa_confirmation_method'",
		"new.metadata->'ctwa_confirmation_method'",
		"v_contract_version = 'ctwa_ad_v1'",
		"v_confirmation_method = 'entry_point_ctwa_ad'",
		"v_contract_version = 'ctwa_ad_v2'",
		"v_declared_confirmation_method = v_confirmation_method",
		"message = 'trusted_whatsapp_lead_provenance_required'",
		"message = 'managed_whatsapp_ctwa_ad_required'",
	} {
		requireCTWAContractContains(t, trigger, fragment)
	}

	enrichment := compactCTWAContract(sectionCTWAContract(
		t,
		source,
		"create or replace function public.enrich_whatsapp_lead_entry_attribution(",
		"revoke all on function public.enrich_whatsapp_lead_entry_attribution(",
	))
	for _, fragment := range []string{
		"v_confirmation_method := private.whatsapp_metadata_ctwa_confirmation_method(",
		"if v_confirmation_method is null then return false",
		"'ctwa_confirmation_method', v_confirmation_method",
		"'entry_point_conversion_source', v_entry_point_conversion_source",
		"'ctwa_clid', v_ctwa_clid",
		"'show_ad_attribution', v_show_ad_attribution",
	} {
		requireCTWAContractContains(t, enrichment, fragment)
	}
	if strings.Contains(enrichment, "'entry_point_conversion_source', 'ctwa_ad'") {
		t.Fatal("attribution enrichment must preserve a missing entry point instead of manufacturing ctwa_ad")
	}

	for _, fragment := range []string{
		"revoke all on function private.whatsapp_metadata_ctwa_confirmation_method(jsonb) from public, anon, authenticated, service_role",
		"revoke all on function private.whatsapp_metadata_is_ctwa_ad(jsonb) from public, anon, authenticated, service_role",
		"revoke all on function public.whatsapp_webhook_has_lead_creation_context(jsonb) from public, anon, authenticated; grant execute on function public.whatsapp_webhook_has_lead_creation_context(jsonb) to service_role",
		"revoke all on function public.enrich_whatsapp_lead_entry_attribution( uuid, uuid, uuid, text ) from public, anon, authenticated; grant execute on function public.enrich_whatsapp_lead_entry_attribution( uuid, uuid, uuid, text ) to service_role",
	} {
		requireCTWAContractContains(t, compact, fragment)
	}
}
