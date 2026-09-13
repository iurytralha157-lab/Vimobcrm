package whatsapp

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
)

func TestEvolutionInstanceKeyPrefersStableIdentifiersBeforeInstanceName(t *testing.T) {
	client := functionsClient{}

	tests := []struct {
		name    string
		session evolutionSessionConfig
		payload map[string]any
		body    map[string]any
		want    string
	}{
		{
			name: "resolved key wins",
			session: evolutionSessionConfig{
				InstanceName: "display-name",
				InstanceID:   "stored-provider-id",
				Settings: map[string]any{
					"evolution_go_resolved_instance_key": "resolved-provider-id",
				},
			},
			payload: map[string]any{"instance_id": "payload-provider-id"},
			want:    "resolved-provider-id",
		},
		{
			name: "explicit payload wins over stored id and display name",
			session: evolutionSessionConfig{
				InstanceName: "display-name",
				InstanceID:   "stored-provider-id",
				Settings:     map[string]any{},
			},
			payload: map[string]any{"instance_id": "payload-provider-id"},
			want:    "payload-provider-id",
		},
		{
			name: "stored provider id wins over display name",
			session: evolutionSessionConfig{
				InstanceName: "display-name",
				InstanceID:   "stored-provider-id",
				Settings:     map[string]any{},
			},
			want: "stored-provider-id",
		},
		{
			name: "stored provider id wins over legacy payload name",
			session: evolutionSessionConfig{
				InstanceName: "display-name",
				InstanceID:   "stored-provider-id",
				Settings:     map[string]any{},
			},
			payload: map[string]any{"instance_name": "legacy-payload-name"},
			body:    map[string]any{"name": "legacy-body-name"},
			want:    "stored-provider-id",
		},
		{
			name: "display name remains the legacy fallback",
			session: evolutionSessionConfig{
				InstanceName: "display-name",
				Settings:     map[string]any{},
			},
			want: "display-name",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := client.evolutionInstanceKey(tt.session, tt.payload, tt.body); got != tt.want {
				t.Fatalf("evolutionInstanceKey() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestFirstEligibleRecoveryObservationDoesNotReconnect(t *testing.T) {
	var infoCalls atomic.Int32
	var reconnectCalls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/instance/info/provider-id":
			infoCalls.Add(1)
			_, _ = response.Write([]byte(`{"message":"success","data":{"connected":true}}`))
		case request.Method == http.MethodPost && request.URL.Path == "/instance/reconnect":
			reconnectCalls.Add(1)
			_, _ = response.Write([]byte(`{"message":"success"}`))
		default:
			http.Error(response, "unexpected provider request", http.StatusNotFound)
		}
	}))
	t.Cleanup(provider.Close)

	repo := Repository{functions: functionsClient{
		evolutionGoAPIURL: provider.URL,
		evolutionGoAPIKey: "backend-global-key",
		httpClient:        provider.Client(),
	}}

	outcome, err := repo.recoverSession(
		context.Background(),
		Session{AdvancedSettings: map[string]any{}},
		"provider-id",
		"session-token",
		"",
	)
	if err != nil {
		t.Fatalf("first recovery observation: %v", err)
	}
	if outcome != evolutionRecoveryDeferred {
		t.Fatalf("first recovery outcome = %v, want deferred", outcome)
	}
	if infoCalls.Load() != 1 {
		t.Fatalf("provider info calls = %d, want 1", infoCalls.Load())
	}
	if reconnectCalls.Load() != 0 {
		t.Fatalf("provider reconnect calls = %d, want 0 on the first eligible observation", reconnectCalls.Load())
	}

}

func TestSupervisorMutationSQLPreservesLogoutAndDeletedSessions(t *testing.T) {
	source := readWhatsAppSourceFunction(t, "session_supervisor.go", `func (repo Repository) updateSessionStatusFromProviderIfCurrent`)
	assertLifecycleMutationGuards(t, "provider status update", source, 1)

	failureSource := readWhatsAppSourceFunction(t, "session_supervisor.go", `func (repo Repository) recordSessionRecoveryFailure`)
	assertLifecycleMutationGuards(t, "recovery failure update", failureSource, 1)
	intentGuard := regexp.MustCompile(`(?i)and\s+lower\(\s*coalesce\(\s*(?:whatsapp_sessions\.)?advanced_settings\s*->>\s*'auto_reconnect_enabled'\s*,\s*'true'\s*\)\s*\)\s*<>\s*'false'`)
	if !intentGuard.MatchString(failureSource) {
		t.Fatalf("recovery failure update must preserve intentional logout\n%s", strings.TrimSpace(failureSource))
	}
}

func TestPatchSessionSettingsTreatsNilRemovalListAsEmpty(t *testing.T) {
	source := readWhatsAppSourceFunction(t, "session_supervisor.go", `func (repo Repository) patchSessionSettings`)
	if !strings.Contains(source, "coalesce($4::text[], '{}'::text[])") {
		t.Fatalf("nil removeKeys must not turn the JSONB patch into SQL NULL\n%s", strings.TrimSpace(source))
	}
}

func TestRecoveryExhaustionDoesNotDisablePassiveSynchronization(t *testing.T) {
	source := readWhatsAppSourceFunction(t, "session_supervisor.go", `func (repo Repository) recordSessionRecoveryFailure`)
	if strings.Contains(source, `patch["auto_reconnect_enabled"] = false`) {
		t.Fatalf("recovery exhaustion must block provider mutation without disabling passive status sync\n%s", strings.TrimSpace(source))
	}
	deferredSource := readWhatsAppSourceFunction(t, "session_supervisor.go", `func (repo Repository) recordSessionRecoveryDeferred`)
	if strings.Contains(deferredSource, "auto_reconnect_failure_count") {
		t.Fatalf("the first provider-owned grace observation must not count as a failed CRM attempt\n%s", strings.TrimSpace(deferredSource))
	}
}

func TestSupervisorClaimsPrivateStateInsteadOfMutatingSessionFreshness(t *testing.T) {
	source := readWhatsAppSourceFunction(t, "session_supervisor.go", `func (repo Repository) superviseActiveSessionsWithLimit`)
	if !strings.Contains(source, "private.claim_whatsapp_sessions_for_supervision") {
		t.Fatalf("supervisor must use the backend-only atomic claim function\n%s", strings.TrimSpace(source))
	}
	for _, forbidden := range []string{
		"supervisor_last_claimed_at_ms",
		"supervisor_probe_claim_token",
		"set updated_at = now()",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("supervisor claim leaked operational state into whatsapp_sessions via %q\n%s", forbidden, strings.TrimSpace(source))
		}
	}
}

func TestSupervisorProviderObservationUsesWebhookTupleFence(t *testing.T) {
	source := readWhatsAppSourceFunction(t, "session_supervisor.go", `func (repo Repository) updateSessionStatusFromProviderIfCurrent`)
	for _, required := range []string{
		"webhook_state_event_at_ms",
		"webhook_state_event_rank",
		"webhook_state_event_key",
		"supervisor_state.claim_token",
		"for update",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("provider observation is missing freshness fence %q\n%s", required, strings.TrimSpace(source))
		}
	}
	if strings.Contains(source, "updated_at = $4::timestamptz") {
		t.Fatalf("generic row churn must not be interpreted as provider freshness\n%s", strings.TrimSpace(source))
	}
	if !strings.Contains(source, `coalesce(status, '') <> 'connected' or last_connected_at is null`) {
		t.Fatalf("last_connected_at must move only on a real transition or null repair\n%s", strings.TrimSpace(source))
	}
}

func TestSupervisorLeadershipAndProbeConcurrencyAreBounded(t *testing.T) {
	leadership := readWhatsAppSourceFunction(t, "session_supervisor.go", `func (repo Repository) acquireWhatsAppSessionSupervisorLeadership`)
	if !strings.Contains(leadership, "acquireWhatsAppAdvisoryLocksWithPermit") || !strings.Contains(leadership, "whatsappSessionSupervisorLeaderKey") {
		t.Fatalf("supervisor leadership must be cross-replica and non-overlapping\n%s", strings.TrimSpace(leadership))
	}
	workers := readWhatsAppSourceFunction(t, "session_supervisor.go", `func supervisorWorkerCount`)
	if !strings.Contains(workers, "whatsappSessionSupervisorConcurrency") {
		t.Fatalf("supervisor provider probes must have a hard concurrency ceiling\n%s", strings.TrimSpace(workers))
	}
}

func TestSupervisorStateMigrationIsPrivateFencedAndFair(t *testing.T) {
	_, testFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve test source path")
	}
	migrationPath := filepath.Join(
		filepath.Dir(testFile),
		"..", "..", "..", "..",
		"supabase", "migrations", "20260912173704_harden_whatsapp_session_supervisor_state.sql",
	)
	raw, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("read supervisor state migration: %v", err)
	}
	source := strings.ToLower(string(raw))
	for _, required := range []string{
		"begin;",
		"set local lock_timeout = '3s'",
		"end;\n$supervisor_foundation$;",
		"end;\n$migration$;",
		"end;\n$function$;",
		"private.whatsapp_session_supervisor_state",
		"security definer",
		"set search_path = pg_catalog",
		"for update of state skip locked",
		"partition by state.organization_id",
		"provider_instance_key",
		"whatsapp_session_supervisor_state_provider_instance_uidx",
		"provider_instance_unique_index_contract",
		"if index_definition is distinct from",
		"delete from private.whatsapp_session_supervisor_state as state",
		"where not exists",
		"'missing:' || session.id::text",
		"claim_token",
		"lease_expires_at",
		"force row level security",
		"revoke all on function private.claim_whatsapp_sessions_for_supervision",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("supervisor state migration is missing %q", required)
		}
	}
	if strings.Contains(source, "session.updated_at") {
		t.Fatal("supervisor migration must not use whatsapp_sessions.updated_at as its cursor")
	}
	backfill := strings.Index(source, "materialize every session eligible for supervision")
	providerIdentityFence := strings.Index(source, "create unique index if not exists whatsapp_session_supervisor_state_provider_instance_uidx")
	if backfill < 0 || providerIdentityFence < 0 || backfill > providerIdentityFence {
		t.Fatal("legacy provider identities must be materialized before the global uniqueness fence is installed")
	}
	if strings.Count(source, "delete from private.whatsapp_session_supervisor_state as state") < 2 {
		t.Fatal("inactive provider identities must be retired both during migration and before later claims")
	}
}

func readWhatsAppSourceFunction(t *testing.T, filename string, signature string) string {
	t.Helper()
	_, testFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve test source path")
	}
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(testFile), filename))
	if err != nil {
		t.Fatalf("read %s: %v", filename, err)
	}
	pattern := regexp.MustCompile(`(?ms)^` + regexp.QuoteMeta(signature) + `.*?^}`)
	body := pattern.FindString(string(raw))
	if body == "" {
		t.Fatalf("function %q not found in %s", signature, filename)
	}
	return body
}

func assertLifecycleMutationGuards(t *testing.T, operation string, source string, minimumOccurrences int) {
	t.Helper()
	guards := map[string]*regexp.Regexp{
		"active session":  regexp.MustCompile(`(?i)and\s+coalesce\(\s*(?:whatsapp_sessions\.)?is_active\s*,\s*true\s*\)\s*=\s*true`),
		"terminal status": regexp.MustCompile(`(?i)and\s+coalesce\(\s*(?:whatsapp_sessions\.)?status\s*,\s*''\s*\)\s+not\s+in\s*\(\s*'deleted'\s*,\s*'disabled'\s*\)`),
	}
	for name, pattern := range guards {
		if count := len(pattern.FindAllStringIndex(source, -1)); count < minimumOccurrences {
			t.Fatalf("%s must preserve %s rows in every SQL update: found %d guard(s), want at least %d\n%s", operation, name, count, minimumOccurrences, strings.TrimSpace(source))
		}
	}
}
