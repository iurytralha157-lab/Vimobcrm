package whatsapp

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestManagedWhatsAppReentryMigrationContract(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to locate managed WhatsApp migration contract test")
	}
	migrationPath := filepath.Clean(filepath.Join(
		filepath.Dir(sourceFile),
		"..", "..", "..", "..",
		"supabase", "migrations",
		"20260903045350_refine_managed_whatsapp_reentry_and_queue_tags.sql",
	))
	raw, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	source := strings.ToLower(string(raw))
	compactSource := strings.Join(strings.Fields(source), " ")

	required := []string{
		"process_managed_whatsapp_lead_entry",
		"public.lookup_managed_whatsapp_lead_entry(",
		"private.managed_whatsapp_message_fingerprint(",
		"create or replace function public.distribute_lead_from_backend(",
		"p_round_robin_id uuid default null",
		"p_preserve_assignee boolean default true",
		"p_source text default null",
		"p_now timestamptz default clock_timestamp()",
		"end;\n$managed_whatsapp_refinement_preflight$;",
		"and not procedure_definition.proretset",
		"public.idx_lead_redistribution_jobs_one_active",
		"and index_definition.indisunique",
		"p_provider_message_id text",
		"p_session_id::text || ':' || v_provider_message_id",
		"managed_whatsapp_provider_message_collision",
		"managed_whatsapp_pending_context_invalid",
		"managed_whatsapp_pending_message_evidence_missing",
		"legacy_whatsapp_message_already_persisted",
		"conflicting_legacy_message",
		"from public.whatsapp_inbound_logs as inbound_log",
		"conflicting_log.lead_id is distinct from v_pending_log.lead_id",
		"conflicting_log.matched_rule_id is distinct from v_pending_log.matched_rule_id",
		"conflicting_log.match_details->>'target_round_robin_id'",
		"conflicting_log.match_details->>'message_fingerprint'",
		"conflicting_message.from_me",
		"message.conversation_id = v_pending_log.conversation_id",
		"conflicting_message.conversation_id is distinct from v_pending_log.conversation_id",
		"managed_whatsapp_ledger_result_missing",
		"from public.leads as ledger_lead",
		"'handled', false, 'pending', true",
		"message.lead_id = p_lead_id",
		"coalesce(message.content, '') is not distinct from coalesce(p_message, '')",
		"on conflict (organization_id, provider, provider_event_id)",
		"reentry_count = coalesce(lead.reentry_count, 0) + 1",
		"v_reentry_behavior = 'keep_assignee'",
		"superseded_by_whatsapp_reentry",
		"private.distribute_lead(",
		"private.enqueue_managed_whatsapp_initial_distribution(",
		"initial_distribution_pending",
		"allow_assigned_redistribution",
		"'allow_assigned_redistribution', v_allow_assigned_redistribution",
		"~ '^[0-9]{1,9}$'",
		"initial_distribution_result",
		"pending_distribution_job_id",
		"managed_whatsapp_pending_distribution_job_missing",
		"from private.lead_distribution_events as distribution_event",
		"distribution_event.outcome <> 'processing'",
		"last_whatsapp_session_id",
		"last_whatsapp_provider_event_id",
		"last_whatsapp_entry_event_id",
		"private.apply_round_robin_auto_tags(",
		"trg_apply_round_robin_auto_tags",
		"on conflict (lead_id, tag_id) do nothing",
		"attached_tag.organization_id = p_organization_id",
		"trg_scope_distribution_notification_dedupe",
		"grant execute on function public.process_managed_whatsapp_lead_entry",
		"grant execute on function public.lookup_managed_whatsapp_lead_entry",
		"grant execute on function public.distribute_lead_from_backend",
		"revoke all on function public.distribute_lead_from_backend( uuid, uuid, text, uuid, boolean, text, timestamptz ) from public, anon, authenticated, service_role",
		"revoke all on function public.upsert_whatsapp_webhook_lead( uuid, text, text, text, text, timestamptz, text, uuid, text, text, text, uuid, uuid, uuid, timestamptz, uuid, uuid, uuid, timestamptz, text, timestamptz, jsonb ) from public, anon, authenticated",
		"grant execute on function public.upsert_whatsapp_webhook_lead( uuid, text, text, text, text, timestamptz, text, uuid, text, text, text, uuid, uuid, uuid, timestamptz, uuid, uuid, uuid, timestamptz, text, timestamptz, jsonb ) to service_role",
		") to service_role",
	}
	for _, fragment := range required {
		if !strings.Contains(source, fragment) && !strings.Contains(compactSource, fragment) {
			t.Fatalf("managed WhatsApp migration contract is missing %q", fragment)
		}
	}

	forbidden := []string{
		"grant execute on function public.process_managed_whatsapp_lead_entry(\n  uuid, uuid, uuid, uuid, text, text, timestamptz\n) to anon",
		"grant execute on function public.process_managed_whatsapp_lead_entry(\n  uuid, uuid, uuid, uuid, text, text, timestamptz\n) to authenticated",
		"grant execute on function public.lookup_managed_whatsapp_lead_entry(\n  uuid, uuid, text, text\n) to anon",
		"grant execute on function public.lookup_managed_whatsapp_lead_entry(\n  uuid, uuid, text, text\n) to authenticated",
		"grant execute on function public.distribute_lead_from_backend(\n  uuid, uuid, text, uuid, boolean, text, timestamptz\n) to anon",
		"grant execute on function public.distribute_lead_from_backend(\n  uuid, uuid, text, uuid, boolean, text, timestamptz\n) to authenticated",
	}

	bridgeStart := strings.Index(source, "create or replace function public.distribute_lead_from_backend(")
	if bridgeStart < 0 {
		t.Fatal("canonical backend distribution bridge is missing")
	}
	bridgeEndOffset := strings.Index(source[bridgeStart:], "revoke all on function public.distribute_lead_from_backend(")
	if bridgeEndOffset < 0 {
		t.Fatal("unable to isolate canonical backend distribution bridge")
	}
	bridgeCompact := strings.Join(strings.Fields(source[bridgeStart:bridgeStart+bridgeEndOffset]), " ")
	for _, fragment := range []string{
		"p_round_robin_id uuid default null, p_preserve_assignee boolean default true, p_source text default null, p_now timestamptz default clock_timestamp()",
		"returns jsonb language sql volatile security definer set search_path = ''",
		"select private.distribute_lead( p_organization_id, p_lead_id, p_idempotency_key, p_round_robin_id, p_preserve_assignee, p_source, p_now )",
	} {
		if !strings.Contains(bridgeCompact, fragment) {
			t.Fatalf("canonical backend distribution bridge is missing %q", fragment)
		}
	}
	if strings.Contains(bridgeCompact, "p_preserve_existing_assignment") || strings.Contains(bridgeCompact, "p_event_at") {
		t.Fatal("canonical backend distribution bridge must preserve existing parameter names for create-or-replace and named callers")
	}
	for _, fragment := range forbidden {
		if strings.Contains(source, fragment) {
			t.Fatalf("managed WhatsApp RPC must remain service-role only; found %q", fragment)
		}
	}

	processStart := strings.Index(source, "create or replace function public.process_managed_whatsapp_lead_entry(")
	if processStart < 0 {
		t.Fatal("managed WhatsApp intake RPC is missing")
	}
	processSource := source[processStart:]
	processCompact := strings.Join(strings.Fields(processSource), " ")
	ledgerLookup := strings.Index(processSource, "-- the immutable provider message is the idempotency boundary")
	mutableContextLookup := strings.Index(processSource, "if v_has_pending_context then")
	if ledgerLookup < 0 || mutableContextLookup < 0 || ledgerLookup >= mutableContextLookup {
		t.Fatal("exact provider retries must be resolved from the durable ledger before mutable rule/queue validation")
	}
	if strings.Contains(processSource[:ledgerLookup], "or p_rule_id is null") {
		t.Fatal("exact provider retries must not require a current matched rule")
	}
	if strings.Contains(processCompact, "'success', true, 'reason', 'duplicate_retry'") {
		t.Fatal("exact provider retries must never invent a successful ledger outcome")
	}

	fingerprintStart := strings.Index(source, "create or replace function private.managed_whatsapp_message_fingerprint(")
	if fingerprintStart < 0 {
		t.Fatal("immutable managed WhatsApp fingerprint is missing")
	}
	fingerprintEnd := strings.Index(source[fingerprintStart:], "revoke all on function private.managed_whatsapp_message_fingerprint(")
	if fingerprintEnd < 0 {
		t.Fatal("unable to isolate immutable managed WhatsApp fingerprint")
	}
	fingerprintSection := source[fingerprintStart : fingerprintStart+fingerprintEnd]
	for _, fragment := range []string{
		"p_organization_id uuid",
		"p_session_id uuid",
		"p_provider_message_id text",
		"p_message text",
	} {
		if !strings.Contains(fingerprintSection, fragment) {
			t.Fatalf("immutable provider fingerprint is missing %q", fragment)
		}
	}
	if strings.Contains(fingerprintSection, "p_rule_id") {
		t.Fatal("provider fingerprint must remain independent of mutable rule selection")
	}

	lookupStart := strings.Index(source, "create or replace function public.lookup_managed_whatsapp_lead_entry(")
	if lookupStart < 0 {
		t.Fatal("managed WhatsApp provider lookup is missing")
	}
	lookupEndOffset := strings.Index(source[lookupStart:], "revoke all on function public.lookup_managed_whatsapp_lead_entry(")
	if lookupEndOffset < 0 {
		t.Fatal("unable to isolate managed WhatsApp provider lookup")
	}
	lookupSection := source[lookupStart : lookupStart+lookupEndOffset]
	lookupCompact := strings.Join(strings.Fields(lookupSection), " ")
	legacyMessageLookup := strings.Index(lookupCompact, "select message.* into v_legacy_message from public.whatsapp_messages as message")
	managedLogLookup := strings.Index(lookupCompact, "select inbound_log.* into v_pending_log from public.whatsapp_inbound_logs as inbound_log")
	legacyLogLookup := strings.Index(lookupCompact, "select inbound_log.* into v_legacy_log from public.whatsapp_inbound_logs as inbound_log")
	legacyQuarantine := strings.Index(lookupCompact, "'handled', false, 'pending', false, 'quarantined', true, 'reason', 'legacy_whatsapp_intake_incomplete'")
	legacyMiss := -1
	if legacyMessageLookup >= 0 {
		if offset := strings.Index(lookupCompact[legacyMessageLookup:], "return jsonb_build_object('handled', false, 'pending', false);"); offset >= 0 {
			legacyMiss = legacyMessageLookup + offset
		}
	}
	for _, fragment := range []string{
		"coalesce(v_legacy_message.content, '') is distinct from coalesce(p_message, '')",
		"coalesce(v_legacy_message.from_me, false) = true",
		"lower(coalesce(v_legacy_message.direction, 'inbound')) = 'outbound'",
		"conflicting_legacy_message.lead_id is distinct from v_legacy_message.lead_id",
		"conflicting_legacy_message.conversation_id is distinct from v_legacy_message.conversation_id",
		"conflicting_legacy_log.lead_id is distinct from v_legacy_log.lead_id",
		"conflicting_legacy_log.conversation_id is distinct from v_legacy_log.conversation_id",
		"conflicting_legacy_log.matched_rule_id is distinct from v_legacy_log.matched_rule_id",
		"v_legacy_log.lead_id is distinct from v_legacy_message.lead_id",
		"v_legacy_log.conversation_id is distinct from v_legacy_message.conversation_id",
		"managed_whatsapp_message_distribution', 'false' ))) not in ('true', '1', 'yes')",
		"if v_legacy_log.id is not null then",
		"'handled', true, 'pending', false, 'duplicate_retry', true, 'legacy_non_managed_retry', true, 'reason', 'legacy_whatsapp_message_already_persisted'",
		"'matched_rule_id', null, 'target_round_robin_id', null",
	} {
		if !strings.Contains(lookupCompact, fragment) {
			t.Fatalf("legacy persisted-message lookup is missing %q", fragment)
		}
	}
	if managedLogLookup < 0 || legacyMessageLookup < 0 || managedLogLookup >= legacyMessageLookup {
		t.Fatal("managed pending provenance must win before the legacy persisted-message no-op")
	}
	if legacyLogLookup < 0 || legacyQuarantine < 0 || legacyMiss < 0 || legacyLogLookup >= legacyMessageLookup || legacyMessageLookup >= legacyQuarantine || legacyQuarantine >= legacyMiss {
		t.Fatal("legacy non-managed intake must be detected and quarantined before a lookup miss can consult current rules")
	}
	if strings.Contains(compactSource, "coalesce(message.provider_message_id, message.message_id) = v_provider_message_id") ||
		strings.Contains(compactSource, "coalesce(conflicting_message.provider_message_id, conflicting_message.message_id) = v_provider_message_id") {
		t.Fatal("provider-message evidence must keep provider/message-id predicates indexable without changing coalesce semantics")
	}
	for _, fragment := range []string{
		"message.provider_message_id = v_provider_message_id or ( message.provider_message_id is null and message.message_id = v_provider_message_id )",
		"conflicting_message.provider_message_id = v_provider_message_id or ( conflicting_message.provider_message_id is null and conflicting_message.message_id = v_provider_message_id )",
	} {
		if !strings.Contains(compactSource, fragment) {
			t.Fatalf("indexable provider-message evidence is missing %q", fragment)
		}
	}
	for _, forbiddenIndex := range []string{
		"create index if not exists idx_leads_managed_whatsapp_initial_provider_event",
		"create index if not exists idx_whatsapp_inbound_logs_org_session_message",
	} {
		if strings.Contains(compactSource, forbiddenIndex) {
			t.Fatalf("online rollout migration must not build blocking provenance index %q", forbiddenIndex)
		}
	}
	for _, forbiddenScrub := range []string{
		"private.remove_deleted_tag_from_round_robins",
		"trg_remove_deleted_tag_from_round_robins",
	} {
		if strings.Contains(compactSource, forbiddenScrub) {
			t.Fatalf("auto-tag migration must not synchronously scrub queues on tag deletion: found %q", forbiddenScrub)
		}
	}

	for _, fragment := range []string{
		"v_pending_context := public.lookup_managed_whatsapp_lead_entry(",
		"p_rule_id is not null and p_rule_id is distinct from v_effective_rule_id",
		"queue.id = v_pending_round_robin_id and coalesce(queue.is_active, true) = true",
		"elsif p_rule_id is null then",
	} {
		if !strings.Contains(processCompact, fragment) {
			t.Fatalf("pending immutable-context contract is missing %q", fragment)
		}
	}

	initialStart := strings.Index(source, "if v_is_initial then")
	if initialStart < 0 {
		t.Fatal("managed WhatsApp migration is missing the initial-entry branch")
	}
	initialEndOffset := strings.Index(source[initialStart:], "insert into public.lead_entry_events (")
	if initialEndOffset < 0 {
		t.Fatal("unable to isolate the initial-entry branch")
	}
	initialSection := source[initialStart : initialStart+initialEndOffset]
	initialCompact := strings.Join(strings.Fields(initialSection), " ")
	for _, fragment := range []string{
		"last_contact_at = greatest(",
		"last_entry_at = greatest(",
		"when v_should_apply_state then",
		"from private.lead_distribution_events as distribution_event",
		"if v_should_apply_state and v_assigned_user_id is null then",
		"v_pending_job_id := private.enqueue_managed_whatsapp_initial_distribution(",
		"message = 'managed_whatsapp_pending_distribution_job_missing'",
		"'initial_distribution_result', v_initial_distribution_result",
	} {
		if !strings.Contains(initialSection, fragment) && !strings.Contains(initialCompact, fragment) {
			t.Fatalf("initial-entry branch is missing %q", fragment)
		}
	}
	if strings.Contains(initialSection, "reentry_count =") {
		t.Fatal("initial-entry baseline must not increment reentry_count")
	}
	if strings.Contains(initialCompact, "'success', true, 'reason', 'initial_entry_recorded'") {
		t.Fatal("initial-entry result must reflect the canonical distribution ledger instead of fixed success")
	}

	if calls := strings.Count(source, "v_pending_job_id := private.enqueue_managed_whatsapp_initial_distribution("); calls != 2 {
		t.Fatalf("pending distribution helper must be called by initial and reentry branches; got %d calls", calls)
	}

	operationalStart := strings.Index(source, "v_distribution_result := private.distribute_lead(")
	if operationalStart < 0 {
		t.Fatal("managed WhatsApp reentry is missing canonical distribution")
	}
	operationalEndOffset := strings.Index(source[operationalStart:], "v_tags_applied := private.apply_round_robin_auto_tags(")
	if operationalEndOffset < 0 {
		t.Fatal("unable to isolate managed WhatsApp operational distribution section")
	}
	operationalSection := source[operationalStart : operationalStart+operationalEndOffset]
	operationalCompact := strings.Join(strings.Fields(operationalSection), " ")
	if strings.Contains(operationalSection, "v_occurred_at") {
		t.Fatal("provider event time must not drive current distribution, job enrollment, or assignment logs")
	}
	for _, fragment := range []string{
		"v_reentry_behavior = 'keep_assignee', 'whatsapp', v_now",
		"'managed_whatsapp_reentry_keep_assignee'",
		"v_same_assignee_redistribution := v_reentry_behavior = 'redistribute' and v_assigned_user_id is not distinct from v_previous_assigned_user_id",
		"'success', false, 'reason', case",
		"or v_same_assignee_redistribution then",
		"set round_robin_id = v_round_robin_id",
		"original_assigned_user_id = v_assigned_user_id",
		"due_at = v_now",
		"'allow_assigned_redistribution', v_assigned_user_id is not null",
		"v_now, v_assigned_user_id is not null",
		"v_pending_job_id := private.enqueue_managed_whatsapp_initial_distribution(",
		"where pending_job.organization_id = p_organization_id and pending_job.lead_id = p_lead_id and pending_job.id = v_pending_job_id",
		"attempt_count = 0",
		"max_attempts = v_pending_max_attempts",
		"timeout_minutes = v_pending_timeout_minutes",
		"warning_minutes = v_pending_warning_minutes",
		"enrolled_at = v_now",
		"status = 'pending'",
		"last_redistributed_at = null",
		"if not found then v_pending_job_id := null",
	} {
		if !strings.Contains(operationalCompact, fragment) {
			t.Fatalf("current-time/pending distribution contract is missing %q", fragment)
		}
	}

	restoreStart := strings.Index(operationalCompact, "update public.lead_redistribution_jobs as previous_job set status = v_previous_job.status")
	restoreGuard := strings.Index(operationalCompact, "from public.lead_redistribution_jobs as canonical_active_job where canonical_active_job.organization_id = p_organization_id and canonical_active_job.lead_id = p_lead_id and canonical_active_job.id <> v_previous_job.id and canonical_active_job.status in ('pending', 'warning_sent')")
	canonicalJobLookup := strings.Index(operationalCompact, "select job.id into v_pending_job_id from public.lead_redistribution_jobs as job")
	canonicalJobRebind := strings.Index(operationalCompact, "set round_robin_id = v_round_robin_id")
	if restoreStart < 0 || restoreGuard < 0 || canonicalJobLookup < 0 || canonicalJobRebind < 0 ||
		restoreStart >= restoreGuard || restoreGuard >= canonicalJobLookup || canonicalJobLookup >= canonicalJobRebind {
		t.Fatal("prior-job restore must be guarded before the canonical active job is selected, accelerated and rebound")
	}
	if !strings.Contains(operationalCompact[restoreGuard:canonicalJobLookup], "if found then v_pending_job_id := v_previous_job.id") {
		t.Fatal("the prior job may be reused only when its guarded restore actually updated the row")
	}

	queueSettingsReload := strings.Index(operationalCompact, "select coalesce(queue.settings, '{}'::jsonb) into v_pending_queue_settings from public.round_robins as queue")
	if queueSettingsReload < canonicalJobLookup || queueSettingsReload >= canonicalJobRebind {
		t.Fatal("an active job must reload target-queue settings before it is rebound")
	}
	for _, fragment := range []string{
		"v_pending_timeout_minutes := least(10080, greatest(1",
		"v_pending_warning_minutes := least( v_pending_warning_minutes, v_pending_timeout_minutes - 1 )",
		"v_pending_max_attempts := least(1000, greatest(0",
	} {
		if !strings.Contains(operationalCompact[queueSettingsReload:canonicalJobRebind], fragment) {
			t.Fatalf("target-queue job reset is missing clamp %q", fragment)
		}
	}

	if locks := strings.Count(processCompact, "for no key update of queue"); locks != 2 {
		t.Fatalf("both current and immutable queue validations must hold a no-key-update lock; got %d", locks)
	}
	if failures := strings.Count(processCompact, "message = 'managed_whatsapp_pending_distribution_job_missing'"); failures != 2 {
		t.Fatalf("initial and reentry pending branches must fail closed without a durable job; got %d guards", failures)
	}

	if !strings.Contains(compactSource, "'distribution_pending', true, 'pending_distribution_job_id', v_pending_job_id") {
		t.Fatal("durable intake results must expose the pending distribution job")
	}
}
