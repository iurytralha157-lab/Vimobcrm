package automations

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAutomationHardeningMigrationContract(t *testing.T) {
	paths, err := filepath.Glob(filepath.Join("..", "..", "..", "..", "supabase", "migrations", "*.sql"))
	if err != nil {
		t.Fatalf("list active migrations: %v", err)
	}
	if len(paths) == 0 {
		t.Fatal("no active migrations found")
	}

	var migrations strings.Builder
	for _, path := range paths {
		raw, readErr := os.ReadFile(path)
		if readErr != nil {
			t.Fatalf("read migration %s: %v", filepath.Base(path), readErr)
		}
		migrations.Write(raw)
		migrations.WriteByte('\n')
	}

	sql := migrations.String()
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
		"enqueue_automation_whatsapp_outbox",
		"canonical_whatsapp_outbox_v1",
		"idx_leads_automation_inactivity_scan",
		"requires_review = false",
		"automation lead event enqueue failed",
		"automation tag event enqueue failed",
		"automation message event enqueue failed",
		"retry_exhausted",
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

	executorRaw, err := os.ReadFile(filepath.Join(root, "automation-executor", "index.ts"))
	if err != nil {
		t.Fatalf("read automation-executor: %v", err)
	}
	executor := string(executorRaw)
	if strings.Contains(executor, "waitUntil") {
		t.Fatal("automation-executor must not acknowledge before durable execution is checkpointed")
	}
	if !strings.Contains(executor, "await processSpecificExecution") {
		t.Fatal("automation-executor must apply backpressure until durable execution is checkpointed")
	}
}

func TestAutomationManualStartUsesDurableCoalescedRuntimeWake(t *testing.T) {
	repositoryRaw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository: %v", err)
	}
	repository := string(repositoryRaw)
	startOffset := strings.Index(repository, "func (repo Repository) Start(")
	if startOffset < 0 {
		t.Fatal("could not find automation Start implementation")
	}
	endOffset := strings.Index(repository[startOffset:], "func publishedFlowMetadata(")
	if endOffset < 0 {
		t.Fatal("could not isolate automation Start implementation")
	}
	start := repository[startOffset : startOffset+endOffset]
	for _, required := range []string{
		"repo.signalRuntimeWake()",
		`Status:          "queued"`,
		"DispatchPending: true",
	} {
		if !strings.Contains(start, required) {
			t.Fatalf("automation Start is missing durable wake contract %q", required)
		}
	}
	if strings.Contains(start, `"dispatch_pending"`) {
		t.Fatal("automation Start must use queued status as the durable source instead of a stale duplicate flag")
	}
	for _, forbidden := range []string{
		"automation-executor",
		"invokeDirectExecution",
		"directExecutionSlots",
	} {
		if strings.Contains(start, forbidden) {
			t.Fatalf("automation Start still contains direct execution path %q", forbidden)
		}
	}

	workerRaw, err := os.ReadFile("worker.go")
	if err != nil {
		t.Fatalf("read worker: %v", err)
	}
	worker := string(workerRaw)
	for _, required := range []string{
		"case <-repo.runtimeWake:",
		"manualWakeDebounce.Arm(automationRuntimeManualWakeDebounce)",
		"case <-manualWakeDebounce.ch:",
		"drainRuntimeBatches(",
		"pg_try_advisory_xact_lock",
		"periodicTicker := time.NewTicker(config.RuntimeInterval)",
		"defaultAutomationRuntimeDrainLimit        = 64",
		"automationRuntimeManualWakeDebounce       = 500 * time.Millisecond",
	} {
		if !strings.Contains(worker, required) {
			t.Fatalf("runtime worker is missing durable drain contract %q", required)
		}
	}
}
