package whatsapp

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func readWhatsAppNonleadRetentionFile(t *testing.T, folder, name string) string {
	t.Helper()
	_, source, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot resolve test path")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(source), "..", "..", "..", ".."))
	data, err := os.ReadFile(filepath.Join(root, "supabase", folder, name))
	if err != nil {
		t.Fatal(err)
	}
	return strings.ToLower(string(data))
}

// These are destructive SQL safety boundaries, not a substitute for a local
// Postgres migration test or a production canary.
func TestWhatsAppNonleadRetentionMigrationKeepsLeadEvidence(t *testing.T) {
	t.Parallel()
	index := readWhatsAppNonleadRetentionFile(t, "migrations", "20260927223239_whatsapp_nonlead_retention_guard.sql")
	indexCutover := readWhatsAppNonleadRetentionFile(t, "cutovers", "20260927_prepare_whatsapp_nonlead_retention_indexes.sql")
	classifier := readWhatsAppNonleadRetentionFile(t, "migrations", "20260927204508_whatsapp_legacy_nonlead_control_terminalization.sql")
	cleanup := readWhatsAppNonleadRetentionFile(t, "migrations", "20260927223519_whatsapp_nonlead_retention_function.sql")
	preview := readWhatsAppNonleadRetentionFile(t, "cutovers", "20260927_whatsapp_nonlead_retention_preview.sql")
	suppressedAudit := readWhatsAppNonleadRetentionFile(t, "cutovers", "20260927_whatsapp_suppressed_message_retention_audit.sql")
	activation := readWhatsAppNonleadRetentionFile(t, "cutovers", "20260927_activate_whatsapp_nonlead_control_retention.sql")
	deleteGuard := readWhatsAppNonleadRetentionFile(t, "migrations", "20260927231221_whatsapp_inbox_terminal_delete_guard.sql")

	if !strings.Contains(indexCutover, "create index concurrently") ||
		strings.Contains(index, "create index concurrently") ||
		!strings.Contains(index, "whatsapp_nonlead_retention_online_indexes_not_prepared") ||
		!strings.Contains(index, "if exists (select 1 from public.whatsapp_webhook_inbox limit 1)") ||
		strings.Contains(indexCutover, "whatsapp_suppressed_retention_audit_idx") {
		t.Fatal("retention indexes must build online on populated inboxes without adding canonical-message write overhead")
	}
	for _, required := range []string{
		"v_provider_payload := p_payload - '__vimob_ingress'",
		"v_snapshot->'messages' is distinct from '[]'::jsonb",
		"v_ingress->>'routing_key' is distinct from '__session__'",
		"jsonb_object_keys(v_provider_payload)",
		"data_key.key not in ('state', 'status', 'loggedin', 'connected')",
	} {
		if !strings.Contains(classifier, required) {
			t.Fatalf("legacy nonlead classifier is missing strict schema gate: %s", required)
		}
	}
	if strings.Count(cleanup, "delete from public.whatsapp_webhook_inbox") != 3 ||
		strings.Count(cleanup, "private.whatsapp_legacy_is_nonlead_control(inbox.event_type, inbox.payload)") != 3 ||
		strings.Count(cleanup, "private.whatsapp_nonlead_retention_payload_safe(inbox.event_type, inbox.payload)") != 3 ||
		strings.Count(cleanup, "from private.whatsapp_webhook_legacy_routing_freeze as frozen") != 3 {
		t.Fatal("each inbox delete must require exact nonlead control proof and exclude frozen rows")
	}
	for _, required := range []string{
		"inbox.processed_at < pg_catalog.now() - interval '7 days'",
		"inbox.dead_lettered_at < pg_catalog.now() - interval '7 days'",
		"inbox.created_at < pg_catalog.now() - interval '7 days'",
		"limit p_limit",
		"p_limit > 500",
		"create or replace function private.cleanup_whatsapp_nonlead_control_retention(",
		"revoke all on function private.cleanup_whatsapp_nonlead_control_retention(integer)",
	} {
		if !strings.Contains(cleanup, required) {
			t.Fatalf("retention safety gate missing: %s", required)
		}
	}
	wrapperParts := strings.SplitN(cleanup, "create or replace function public.cleanup_whatsapp_retention()", 2)
	if len(wrapperParts) != 2 {
		t.Fatal("legacy public retention wrapper is missing")
	}
	wrapper := strings.ReplaceAll(wrapperParts[1], "\r\n", "\n")
	if !strings.Contains(wrapper, "begin\n  return;\nend;") ||
		strings.Contains(wrapper, "delete from ") ||
		strings.Contains(wrapper, "private.cleanup_whatsapp_nonlead_control_retention(500)") {
		t.Fatal("legacy public retention wrapper must remain inert when an old cron invokes it")
	}
	for _, forbidden := range []string{
		"delete from public.whatsapp_messages",
		"delete from public.whatsapp_outbox",
		"delete from storage.objects",
		"cron.schedule",
	} {
		if strings.Contains(cleanup, forbidden) {
			t.Fatalf("unsafe retention action present: %s", forbidden)
		}
	}
	if !strings.Contains(preview, "begin transaction read only") ||
		strings.Contains(preview, "delete from ") ||
		strings.Contains(preview, "cleanup_whatsapp_nonlead_control_retention(500)") {
		t.Fatal("canary inventory must stay read-only")
	}
	if !strings.Contains(suppressedAudit, "begin transaction read only") ||
		!strings.Contains(suppressedAudit, "tombstone_required_hold") ||
		!strings.Contains(suppressedAudit, "lead_history_hold") ||
		strings.Contains(suppressedAudit, "delete from ") {
		t.Fatal("canonical-message audit must report HOLD without deleting")
	}
	if !strings.Contains(activation, "cron.schedule(v_job_name, v_schedule, v_command)") ||
		!strings.Contains(activation, "select private.cleanup_whatsapp_nonlead_control_retention(500);") ||
		strings.Contains(activation, "select public.cleanup_whatsapp_retention();") ||
		!strings.Contains(activation, "whatsapp_nonlead_retention_delete_guard_missing_or_bypassed") ||
		!strings.Contains(activation, "whatsapp_nonlead_retention_job_readback_failed") {
		t.Fatal("operator cron cutover must schedule only the bounded control cleanup with readback")
	}
	for _, required := range []string{
		"before delete on public.whatsapp_webhook_inbox",
		"revoke truncate on table public.whatsapp_webhook_inbox",
		"'service_role', 'public.whatsapp_webhook_inbox', 'truncate'",
		"old.status not in ('pending', 'retry', 'processed', 'dead')",
		"old.event_type is distinct from 'qrcode'",
		"old.created_at >= pg_catalog.now() - interval '2 minutes'",
		"old.processed_at >= pg_catalog.now() - interval '7 days'",
		"old.dead_lettered_at >= pg_catalog.now() - interval '7 days'",
		"private.whatsapp_legacy_is_nonlead_control(old.event_type, old.payload)",
		"private.whatsapp_nonlead_retention_payload_safe(old.event_type, old.payload)",
		"from private.whatsapp_webhook_legacy_routing_freeze as frozen",
	} {
		if !strings.Contains(deleteGuard, required) {
			t.Fatalf("inbox delete guard missing: %s", required)
		}
	}
}
