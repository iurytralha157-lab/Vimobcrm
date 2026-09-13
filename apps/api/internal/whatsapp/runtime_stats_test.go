package whatsapp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestEvolutionHTTPClientUsesBoundedReusableTransport(t *testing.T) {
	client := newEvolutionHTTPClient()
	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("transport type = %T, want *http.Transport", client.Transport)
	}
	if client.Timeout != 30*time.Second {
		t.Fatalf("client timeout = %s, want 30s", client.Timeout)
	}
	if transport.MaxConnsPerHost != 16 || transport.MaxIdleConnsPerHost != 8 || transport.MaxIdleConns != 32 {
		t.Fatalf("unexpected provider pool bounds: max=%d idle_per_host=%d idle=%d", transport.MaxConnsPerHost, transport.MaxIdleConnsPerHost, transport.MaxIdleConns)
	}
	if transport.ResponseHeaderTimeout != 15*time.Second || transport.TLSHandshakeTimeout != 10*time.Second {
		t.Fatalf("unexpected provider transport timeouts: header=%s tls=%s", transport.ResponseHeaderTimeout, transport.TLSHandshakeTimeout)
	}
}

func TestEvolutionMutationHTTPFailuresAreOutcomeUnknownButStatusReadsAreNot(t *testing.T) {
	tests := []struct {
		name        string
		action      string
		status      int
		wantUnknown bool
		wantError   bool
	}{
		{name: "create 408", action: "instance.create", status: http.StatusRequestTimeout, wantUnknown: true, wantError: true},
		{name: "create 425", action: "instance.create", status: http.StatusTooEarly, wantUnknown: true, wantError: true},
		{name: "create 500", action: "instance.create", status: http.StatusInternalServerError, wantUnknown: true, wantError: true},
		{name: "create 503", action: "instance.create", status: http.StatusServiceUnavailable, wantUnknown: true, wantError: true},
		{name: "create 429", action: "instance.create", status: http.StatusTooManyRequests, wantUnknown: false, wantError: true},
		{name: "status 503", action: "instance.status", status: http.StatusServiceUnavailable, wantUnknown: false, wantError: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			provider := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				response.Header().Set("Content-Type", "application/json")
				response.WriteHeader(test.status)
				_, _ = response.Write([]byte(`{"error":"simulated provider response"}`))
			}))
			defer provider.Close()

			stats := &whatsappRuntimeCounters{}
			client := functionsClient{
				evolutionGoAPIURL: provider.URL,
				evolutionGoAPIKey: "provider-key",
				httpClient:        provider.Client(),
				runtimeStats:      stats,
			}
			payload := map[string]any{"instance_id": "existing-instance"}
			if test.action == "instance.create" {
				payload = map[string]any{"body": map[string]any{"name": "new-instance", "token": "session-token"}}
			}
			_, err := client.invokeEvolution(context.Background(), test.action, payload)
			if (err != nil) != test.wantError {
				t.Fatalf("invokeEvolution() error = %v, wantError=%v", err, test.wantError)
			}
			if errors.Is(err, ErrProviderOutcomeUnknown) != test.wantUnknown {
				t.Fatalf("invokeEvolution() error = %v, outcomeUnknown=%v", err, test.wantUnknown)
			}
			wantUnknownCount := uint64(0)
			if test.wantUnknown {
				wantUnknownCount = 1
			}
			if got := stats.providerOutcomeUnknown.Load(); got != wantUnknownCount {
				t.Fatalf("provider outcome-unknown count = %d, want %d", got, wantUnknownCount)
			}
		})
	}

	t.Run("transport failure differs for mutation and status read", func(t *testing.T) {
		provider := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
		client := functionsClient{
			evolutionGoAPIURL: provider.URL,
			evolutionGoAPIKey: "provider-key",
			httpClient:        provider.Client(),
			runtimeStats:      &whatsappRuntimeCounters{},
		}
		provider.Close()

		_, statusErr := client.invokeEvolution(context.Background(), "instance.status", map[string]any{"instance_id": "existing-instance"})
		if !errors.Is(statusErr, ErrProviderFailed) || errors.Is(statusErr, ErrProviderOutcomeUnknown) {
			t.Fatalf("status transport error = %v, want definitive read failure", statusErr)
		}
		_, mutationErr := client.invokeEvolution(context.Background(), "instance.create", map[string]any{
			"body": map[string]any{"name": "new-instance", "token": "session-token"},
		})
		if !errors.Is(mutationErr, ErrProviderOutcomeUnknown) {
			t.Fatalf("mutation transport error = %v, want outcome unknown", mutationErr)
		}
	})
}

func TestWhatsAppRuntimeStatsExposeProviderAndSupervisorWithoutAffectingReadiness(t *testing.T) {
	stats := &whatsappRuntimeCounters{}
	now := time.Now().UTC()
	stats.providerStarted(now)
	stats.providerFinished(now.Add(time.Millisecond), false, true)
	stats.supervisorStarted(now)
	stats.supervisorFinished(now.Add(time.Second), 7, 1, nil)

	handler := NewHandler(Repository{functions: functionsClient{
		evolutionGoAPIURL:      "https://evolution.example.com",
		evolutionGoAPIKey:      "secret",
		evolutionGoImageDigest: "sha256:" + strings.Repeat("a", 64),
		runtimeStats:           stats,
	}}).WithWorkerConfig(WorkerConfig{
		SessionSupervisorEnabled:     true,
		SessionSupervisorInterval:    time.Minute,
		SessionSupervisorBatch:       50,
		SessionSupervisorRecoveryIDs: []string{"13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"},
	})

	snapshot := handler.RuntimeStats()
	provider := snapshot["provider"].(map[string]any)
	if provider["configured"] != true || provider["releaseEvidence"] != "configured_image_digest" || provider["requests"] != uint64(1) || provider["failures"] != uint64(1) || provider["outcomeUnknown"] != uint64(1) {
		t.Fatalf("unexpected provider stats: %#v", provider)
	}
	supervisor := snapshot["sessionSupervisor"].(map[string]any)
	if supervisor["recoveryCanaryCount"] != 1 || supervisor["recoveryGloballyEnabled"] != false || supervisor["lastClaimed"] != int64(7) || supervisor["lastErrors"] != int64(1) || supervisor["operationalStatus"] != "degraded" {
		t.Fatalf("unexpected supervisor stats: %#v", supervisor)
	}
	if supervisor["concurrency"] != whatsappSessionSupervisorConcurrency ||
		supervisor["probeTimeoutMillis"] != whatsappSessionSupervisorProbeTimeout.Milliseconds() ||
		supervisor["cycleTimeoutMillis"] != whatsappSessionSupervisorCycleTimeout.Milliseconds() ||
		supervisor["claimLeaseMillis"] != whatsappSessionSupervisorClaimLease.Milliseconds() ||
		supervisor["leadershipMode"] != "postgres_advisory_lock" ||
		supervisor["stateStore"] != "private.whatsapp_session_supervisor_state" {
		t.Fatalf("missing supervisor scale controls: %#v", supervisor)
	}
}

func TestWhatsAppRuntimeStatsTreatReplicaWithoutLeadershipAsHealthyStandby(t *testing.T) {
	stats := &whatsappRuntimeCounters{}
	stats.supervisorStandby(time.Now().UTC())
	handler := NewHandler(Repository{functions: functionsClient{runtimeStats: stats}}).WithWorkerConfig(WorkerConfig{
		SessionSupervisorEnabled:  true,
		SessionSupervisorInterval: time.Minute,
		SessionSupervisorBatch:    50,
	})

	supervisor := handler.RuntimeStats()["sessionSupervisor"].(map[string]any)
	if supervisor["operationalStatus"] != "standby" || supervisor["leadershipMisses"] != uint64(1) || supervisor["lastStandbyAt"] == nil {
		t.Fatalf("unexpected standby supervisor stats: %#v", supervisor)
	}
}

func TestLifecycleTerminalMutationsAreIdempotentButFailClosedOnUnknownOutcome(t *testing.T) {
	if err := confirmedEvolutionTerminalMutation("instance.delete", map[string]any{"ok": false, "status": 404, "error": "instance not found"}, nil); err != nil {
		t.Fatalf("missing delete must converge: %v", err)
	}
	if err := confirmedEvolutionTerminalMutation("instance.logout", map[string]any{"ok": false, "status": 400, "error": "client disconnected"}, nil); err != nil {
		t.Fatalf("already logged out must converge: %v", err)
	}
	unknown := errors.Join(ErrProviderFailed, ErrProviderOutcomeUnknown, context.DeadlineExceeded)
	if err := confirmedEvolutionTerminalMutation("instance.delete", nil, unknown); !errors.Is(err, ErrProviderOutcomeUnknown) {
		t.Fatalf("unknown destructive outcome = %v, want reconciliation-required error", err)
	}
	if err := confirmedEvolutionTerminalMutation("instance.delete", map[string]any{"ok": false, "status": 500, "error": "database unavailable"}, nil); !errors.Is(err, ErrProviderFailed) {
		t.Fatalf("provider rejection = %v, want provider failure", err)
	}
}

func TestCompensatingDeleteUsesReturnedProviderKeyDirectly(t *testing.T) {
	var path string
	var apiKey string
	provider := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		path = request.URL.EscapedPath()
		apiKey = request.Header.Get("apikey")
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"ok":true}`))
	}))
	defer provider.Close()

	client := functionsClient{
		evolutionGoAPIURL: provider.URL,
		evolutionGoAPIKey: "global-provider-key",
		httpClient:        provider.Client(),
		runtimeStats:      &whatsappRuntimeCounters{},
	}
	result, err := client.deleteEvolutionInstanceByKey(context.Background(), "returned/provider key")
	if err != nil || !providerResultOK(result) {
		t.Fatalf("compensating delete result=%#v err=%v", result, err)
	}
	if path != "/instance/delete/returned%2Fprovider%20key" {
		t.Fatalf("compensating delete path = %q", path)
	}
	if apiKey != "global-provider-key" {
		t.Fatalf("compensating delete credential = %q", apiKey)
	}
}

func TestCreateOutcomeUnknownRetainsIdentityAndCompensationNeverAcceptsEarly404(t *testing.T) {
	unknownCreate := errors.Join(ErrProviderFailed, ErrProviderOutcomeUnknown, context.DeadlineExceeded)
	if action := failedCreateActionFor(unknownCreate, false); action != failedCreateRetainForReconciliation {
		t.Fatalf("unconfirmed timed-out create action = %v, want retain for reconciliation", action)
	}
	if action := failedCreateActionFor(ErrProviderFailed, false); action != failedCreateTombstone {
		t.Fatalf("definitively rejected create action = %v, want local tombstone", action)
	}
	if action := failedCreateActionFor(ErrProviderFailed, true); action != failedCreateCompensate {
		t.Fatalf("confirmed create followed by local/connect failure action = %v, want compensation", action)
	}

	provider := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		response.WriteHeader(http.StatusNotFound)
		_, _ = response.Write([]byte(`{"error":"instance not found yet"}`))
	}))
	defer provider.Close()
	repo := Repository{functions: functionsClient{
		evolutionGoAPIURL: provider.URL,
		evolutionGoAPIKey: "global-provider-key",
		httpClient:        provider.Client(),
		runtimeStats:      &whatsappRuntimeCounters{},
	}}
	if err := repo.compensateEvolutionInstance(context.Background(), "eventually-created-instance"); !errors.Is(err, ErrProviderFailed) {
		t.Fatalf("early compensating 404 = %v, want unconfirmed cleanup failure", err)
	}

	create := readWhatsAppSourceFunction(t, "session_operations.go", `func (repo Repository) CreateSession`)
	if !strings.Contains(create, "instanceName,\n\t\t\terr,\n\t\t\tfalse,") {
		t.Fatal("instance.create failure must be treated as unconfirmed and retained when outcome is unknown")
	}
}

func TestExistingEvolutionGoSessionIdentifiersRemainCutoverCompatible(t *testing.T) {
	instanceID := "stored-provider-id"
	settings := map[string]any{
		"evolution_go_resolved_instance_key": "resolved-provider-key",
		"token":                              "existing-provider-token",
		"webhook_token":                      "existing-webhook-token",
	}
	session := Session{
		InstanceName:     "legacy-instance-name",
		InstanceID:       &instanceID,
		AdvancedSettings: settings,
	}
	if got := sessionEvolutionInstanceKey(session, settings); got != "resolved-provider-key" {
		t.Fatalf("supervisor key = %q, want existing resolved key", got)
	}
	client := functionsClient{evolutionGoAPIKey: "global-provider-key"}
	providerSession := evolutionSessionConfig{
		InstanceName: session.InstanceName,
		InstanceID:   instanceID,
		Settings:     settings,
	}
	if got := client.evolutionInstanceKey(providerSession, nil, nil); got != "resolved-provider-key" {
		t.Fatalf("provider key = %q, want existing resolved key", got)
	}
	if got := client.evolutionSessionToken(providerSession, nil); got != "existing-provider-token" {
		t.Fatalf("provider token = %q, want existing token", got)
	}
	providerSession.Settings = map[string]any{"token": "existing-provider-token"}
	if got := client.evolutionInstanceKey(providerSession, nil, nil); got != instanceID {
		t.Fatalf("provider instance_id fallback = %q, want %q", got, instanceID)
	}
	providerSession.InstanceID = ""
	if got := client.evolutionInstanceKey(providerSession, nil, nil); got != session.InstanceName {
		t.Fatalf("provider instance_name fallback = %q, want %q", got, session.InstanceName)
	}
	if got := sessionEvolutionInstanceKey(Session{InstanceName: session.InstanceName, InstanceID: &instanceID}, map[string]any{}); got != instanceID {
		t.Fatalf("supervisor instance_id fallback = %q, want %q", got, instanceID)
	}
	if got := sessionEvolutionInstanceKey(Session{InstanceName: session.InstanceName}, map[string]any{}); got != session.InstanceName {
		t.Fatalf("supervisor instance_name fallback = %q, want %q", got, session.InstanceName)
	}
	webhookSession := evolutionWebhookSession{WebhookToken: stringFromMap(settings, "webhook_token")}
	if !secureWebhookTokenEqual(webhookSession.WebhookToken, "existing-webhook-token") {
		t.Fatal("existing webhook_token must remain valid after cutover")
	}
	if strings.TrimSpace(session.InstanceName) == "" || strings.TrimSpace(instanceID) == "" {
		t.Fatal("legacy instance_name and instance_id fallbacks must remain populated")
	}
}

func TestSessionLifecyclePersistsIntentAndConvergesOnlyAfterProviderResult(t *testing.T) {
	create := readWhatsAppSourceFunction(t, "session_operations.go", `func (repo Repository) CreateSession`)
	for _, required := range []string{
		`"auto_reconnect_enabled":`,
		`"lifecycle_operation":`,
		`"create"`,
		"finishFailedCreateSession",
		"clearSessionLifecycleSettings(settings)",
	} {
		if !strings.Contains(create, required) {
			t.Fatalf("create lifecycle is missing %q\n%s", required, create)
		}
	}

	remove := readWhatsAppSourceFunction(t, "session_operations.go", `func (repo Repository) DeleteSession`)
	begin := strings.Index(remove, `beginSessionLifecycle(ctx, session, "delete", true)`)
	providerDelete := strings.Index(remove, `repo.functions.invokeEvolution(ctx, "instance.delete"`)
	localDelete := strings.LastIndex(remove, "repo.deleteSessionRow")
	if begin < 0 || providerDelete < 0 || localDelete < 0 || !(begin < providerDelete && providerDelete < localDelete) {
		t.Fatal("delete must persist intent, confirm provider deletion, then tombstone locally")
	}

	logout := readWhatsAppSourceFunction(t, "session_operations.go", `func (repo Repository) LogoutSession`)
	providerLogout := strings.Index(logout, `repo.functions.invokeEvolution(ctx, "instance.logout"`)
	localLogout := strings.Index(logout, "repo.markSessionLoggedOut")
	if providerLogout < 0 || localLogout < 0 || providerLogout > localLogout {
		t.Fatal("logout must not claim a terminal local state before the provider result")
	}

	recreate := readWhatsAppSourceFunction(t, "session_operations.go", `func (repo Repository) RecreateSession`)
	providerDelete = strings.Index(recreate, `repo.functions.invokeEvolution(ctx, "instance.delete"`)
	providerCreate := strings.Index(recreate, `repo.functions.invokeEvolution(ctx, "instance.create"`)
	if providerDelete < 0 || providerCreate < 0 || providerDelete > providerCreate || !strings.Contains(recreate, "finishFailedRecreateSession") {
		t.Fatal("recreate must delete idempotently before create and compensate partial creation")
	}

	qr := readWhatsAppSourceFunction(t, "session_operations.go", `func (repo Repository) GetQRCode`)
	if strings.Contains(qr, "setSessionAutoReconnect") {
		t.Fatal("reading a QR must not silently clear a terminal logout intent")
	}
}
