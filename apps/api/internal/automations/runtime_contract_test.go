package automations

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAutomationHardeningMigrationContract(t *testing.T) {
	path := filepath.Join("..", "..", "..", "..", "supabase", "migrations", "20260712201000_automation_runtime_hardening.sql")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	sql := string(raw)
	for _, required := range []string{
		"automation_flow_versions",
		"automation_event_outbox",
		"automation_execution_steps",
		"automation_effect_dispatches",
		"for update skip locked",
		"start_automation_execution_from_event",
		"causal_depth > 10",
		"recent_count >= 10",
		"cancel_disabled_automation_runtime",
		"enter_automation_delay_wait",
		"resume_automation_delay",
		"reply_pending",
		"resolve_automation_whatsapp_conversation",
		"record_automation_whatsapp_message",
		"idx_leads_automation_inactivity_scan",
		"legacy_execution_cancelled_during_versioned_runtime_migration",
		"requires_review = false",
		"automation lead event enqueue failed",
		"automation tag event enqueue failed",
		"automation message event enqueue failed",
		"retry_exhausted",
		"revoke insert, update, delete on public.automations from anon, authenticated",
	} {
		if !strings.Contains(strings.ToLower(sql), strings.ToLower(required)) {
			t.Fatalf("migration is missing contract fragment %q", required)
		}
	}
	if count := strings.Count(sql, "$$"); count == 0 || count%2 != 0 {
		t.Fatalf("migration has unbalanced dollar quotes: %d", count)
	}
}

func TestAutomationEdgeRuntimeSecurityContract(t *testing.T) {
	root := filepath.Join("..", "..", "..", "..", "supabase", "functions")
	runtimeRaw, err := os.ReadFile(filepath.Join(root, "_shared", "automation-runtime.ts"))
	if err != nil {
		t.Fatalf("read runtime: %v", err)
	}
	runtime := string(runtimeRaw)
	for _, required := range []string{
		"@supabase/supabase-js@2.108.1",
		"authorizeServiceRequest",
		"constantTimeEqual",
		"reserve_automation_external_effect",
		"finish_automation_external_effect",
		"canonical_whatsapp_outbox_v1",
		"cross_tenant_or_invalid_media_path",
		"Deno.resolveDns",
		"redirect: \"manual\"",
		"idempotency-key",
		"module_disabled",
		"webhook_allowlist_required",
		"readLimitedText",
		"WHATSAPP_MEDIA_BUCKET",
		"AbortController",
		"enter_automation_delay_wait",
		"process_automation_inbound_message",
		"enqueue_automation_whatsapp_outbox",
	} {
		if !strings.Contains(runtime, required) {
			t.Fatalf("edge runtime is missing contract fragment %q", required)
		}
	}
	if strings.Contains(strings.ToLower(runtime), "override_node") {
		t.Fatal("edge runtime must not accept arbitrary node overrides")
	}
	if strings.Contains(runtime, "evolution-go-proxy") {
		t.Fatal("automation WhatsApp delivery must use the canonical DB-first outbox, not the legacy provider proxy")
	}

	for _, functionName := range []string{"automation-executor", "automation-trigger", "automation-delay-processor", "automation-runner", "automation-inactivity"} {
		raw, err := os.ReadFile(filepath.Join(root, functionName, "index.ts"))
		if err != nil {
			t.Fatalf("read %s: %v", functionName, err)
		}
		if !strings.Contains(string(raw), "authorizeServiceRequest") {
			t.Fatalf("%s does not explicitly require service authentication", functionName)
		}
	}
}
