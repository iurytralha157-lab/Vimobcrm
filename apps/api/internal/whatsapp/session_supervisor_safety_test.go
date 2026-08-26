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
	source := readWhatsAppSourceFunction(t, "session_supervisor.go", `func (repo Repository) updateSessionStatusFromProvider`)
	assertLifecycleMutationGuards(t, "provider status update", source, 2)

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
