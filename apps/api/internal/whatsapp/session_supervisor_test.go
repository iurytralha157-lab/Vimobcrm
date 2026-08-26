package whatsapp

import (
	"errors"
	"testing"
	"time"
)

func TestEvolutionWebhookConnectBodySubscribesOnlyToCRMEvents(t *testing.T) {
	body := evolutionWebhookConnectBody("https://example.com/webhook")
	subscriptions, ok := body["subscribe"].([]string)
	if !ok {
		t.Fatalf("expected string subscriptions, got %#v", body["subscribe"])
	}

	for _, subscription := range subscriptions {
		if subscription == "ALL" || subscription == "HISTORY_SYNC" || subscription == "PRESENCE" ||
			subscription == "GROUP" || subscription == "LABEL" || subscription == "CONTACT" {
			t.Fatalf("unexpected high-volume subscription %q in %#v", subscription, subscriptions)
		}
	}

	for _, required := range []string{"MESSAGE", "SEND_MESSAGE", "READ_RECEIPT", "CONNECTION"} {
		if !containsString(subscriptions, required) {
			t.Fatalf("expected subscription %q in %#v", required, subscriptions)
		}
	}
}

func TestEvolutionWebhookConnectBodyPreservesMobileNotifications(t *testing.T) {
	body := evolutionWebhookConnectBody("https://example.com/webhook")
	advanced, ok := body["advancedSettings"].(map[string]any)
	if !ok {
		t.Fatalf("expected advancedSettings map, got %#v", body["advancedSettings"])
	}
	if advanced["alwaysOnline"] != false {
		t.Fatalf("expected alwaysOnline=false, got %#v", advanced["alwaysOnline"])
	}
	if advanced["readMessages"] != false {
		t.Fatalf("expected readMessages=false, got %#v", advanced["readMessages"])
	}
	if advanced["ignoreStatus"] != false {
		t.Fatalf("expected ignoreStatus=false, got %#v", advanced["ignoreStatus"])
	}
	if advanced["ignoreGroups"] != false {
		t.Fatalf("expected ignoreGroups=false, got %#v", advanced["ignoreGroups"])
	}
}

func TestWebhookConfigurationDueOnlyForURLOrVersionChanges(t *testing.T) {
	settings := map[string]any{
		"webhook_url":                  "https://example.com/webhook",
		"webhook_subscription_version": whatsappWebhookSubscriptionVersion,
		"webhook_last_configured_at":   "2020-01-01T00:00:00Z",
	}

	if webhookConfigurationDue(settings, "https://example.com/webhook") {
		t.Fatal("expected an old timestamp not to reconnect a correctly configured session")
	}
	if !webhookConfigurationDue(settings, "https://example.com/other") {
		t.Fatal("expected a webhook URL change to require configuration")
	}

	settings["webhook_subscription_version"] = "legacy"
	if !webhookConfigurationDue(settings, "https://example.com/webhook") {
		t.Fatal("expected a subscription version change to require configuration")
	}
}

func TestWebhookConfigurationAllowedIsIndependentFromNativeProcessorRollout(t *testing.T) {
	const (
		sessionID  = "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"
		webhookURL = "https://api.vimobcrm.com.br/v1/whatsapp/webhook/evolution-go"
	)

	settings := map[string]any{
		"webhook_url":                  "https://example.com/legacy",
		"webhook_subscription_version": "legacy",
	}

	if !webhookConfigurationAllowed(nil, sessionID, settings, webhookURL, "connected") {
		t.Fatal("expected a due tokenless backend URL to be configured without a native processor rollout")
	}
	if !webhookConfigurationAllowed([]string{"c15fe784-741b-4764-a60c-c60ffc50d606"}, sessionID, settings, webhookURL, "connected") {
		t.Fatal("expected a native processor allowlist not to control callback URL security")
	}
}

func TestWebhookConfigurationAllowedDoesNotUseConnectAsSessionRecovery(t *testing.T) {
	const (
		canarySession = "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"
		webhookURL    = "https://example.com/webhook"
	)

	settings := map[string]any{
		"webhook_url":                  webhookURL,
		"webhook_subscription_version": whatsappWebhookSubscriptionVersion,
	}

	if webhookConfigurationAllowed([]string{canarySession}, canarySession, settings, webhookURL, "connected") {
		t.Fatal("expected a configured, connected canary not to be reconfigured")
	}
	if webhookConfigurationAllowed([]string{canarySession}, canarySession, settings, webhookURL, "disconnected") {
		t.Fatal("expected reconnect to use the provider recovery endpoint instead of instance.connect")
	}
}

func TestEvolutionSupervisorConnectPlanDoesNotUseWebhookMigrationAsRecovery(t *testing.T) {
	const (
		canarySession = "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"
		otherSession  = "c15fe784-741b-4764-a60c-c60ffc50d606"
	)

	body, shouldConnect, appliesWebhook := evolutionSupervisorConnectPlan(
		[]string{canarySession},
		otherSession,
		map[string]any{"webhook_subscription_version": "legacy"},
		"https://api.vimobcrm.com.br/v1/whatsapp/webhook/evolution-go",
		"disconnected",
	)
	if shouldConnect || appliesWebhook || body != nil {
		t.Fatalf("expected disconnected session to wait for the guarded recovery path, got body=%#v shouldConnect=%v appliesWebhook=%v", body, shouldConnect, appliesWebhook)
	}
}

func TestEvolutionSupervisorConnectPlanMigratesConnectedSessionWithLegacyURL(t *testing.T) {
	body, shouldConnect, appliesWebhook := evolutionSupervisorConnectPlan(
		nil,
		"c15fe784-741b-4764-a60c-c60ffc50d606",
		map[string]any{
			"webhook_url":                  "https://project.supabase.co/functions/v1/evolution-go-webhook?webhook_token=legacy",
			"webhook_subscription_version": whatsappWebhookSubscriptionVersion,
		},
		"https://api.vimobcrm.com.br/v1/whatsapp/webhook/evolution-go",
		"connected",
	)
	if !shouldConnect || !appliesWebhook {
		t.Fatalf("expected legacy callback migration, got body=%#v shouldConnect=%v appliesWebhook=%v", body, shouldConnect, appliesWebhook)
	}
	if body["webhookUrl"] != "https://api.vimobcrm.com.br/v1/whatsapp/webhook/evolution-go" {
		t.Fatalf("unexpected migrated webhook body %#v", body)
	}
}

func TestEvolutionSupervisorConnectPlanDoesNothingForConfiguredConnectedSession(t *testing.T) {
	const backendURL = "https://api.vimobcrm.com.br/v1/whatsapp/webhook/evolution-go"
	settings := map[string]any{
		"webhook_url":                  backendURL,
		"webhook_subscription_version": whatsappWebhookSubscriptionVersion,
	}
	body, shouldConnect, appliesWebhook := evolutionSupervisorConnectPlan(nil, "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9", settings, backendURL, "connected")
	if shouldConnect || appliesWebhook || body != nil {
		t.Fatalf("expected configured connected session not to reconnect, got body=%#v shouldConnect=%v appliesWebhook=%v", body, shouldConnect, appliesWebhook)
	}
}

func TestEvolutionSupervisorConnectPlanFailsClosedWithoutBackendURL(t *testing.T) {
	body, shouldConnect, appliesWebhook := evolutionSupervisorConnectPlan(
		nil,
		"c15fe784-741b-4764-a60c-c60ffc50d606",
		map[string]any{},
		"",
		"disconnected",
	)
	if shouldConnect || appliesWebhook || body != nil {
		t.Fatalf("expected missing backend URL to fail closed, got body=%#v shouldConnect=%v appliesWebhook=%v", body, shouldConnect, appliesWebhook)
	}
}

func TestNotificationSafeSettingsPlanRequiresExplicitRolloutAndCurrentVersion(t *testing.T) {
	const sessionID = "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"

	if notificationSafeSettingsDue(nil, sessionID, map[string]any{}) {
		t.Fatal("expected no advanced-settings mutation without rollout")
	}
	if !notificationSafeSettingsDue([]string{sessionID}, sessionID, map[string]any{}) {
		t.Fatal("expected allowlisted canary without version to require advanced settings")
	}
	settings := map[string]any{"notification_safe_settings_version": whatsappNotificationSafeVersion}
	if notificationSafeSettingsDue([]string{sessionID}, sessionID, settings) {
		t.Fatal("expected current advanced-settings version not to repeat")
	}
}

func TestRecordNotificationSafeSettingsAppliedOnlyOnProviderSuccess(t *testing.T) {
	now := time.Date(2026, time.July, 12, 20, 30, 0, 0, time.UTC)
	settings := map[string]any{}
	if recordNotificationSafeSettingsApplied(settings, map[string]any{"ok": false}, now) {
		t.Fatal("expected provider failure not to be recorded")
	}
	if _, exists := settings["notification_safe_settings_applied_at"]; exists {
		t.Fatal("provider failure wrote notification-safe timestamp")
	}

	if !recordNotificationSafeSettingsApplied(settings, map[string]any{"ok": true}, now) {
		t.Fatal("expected provider success to be recorded")
	}
	if settings["notification_safe_settings_applied_at"] != "2026-07-12T20:30:00Z" {
		t.Fatalf("unexpected applied timestamp %#v", settings["notification_safe_settings_applied_at"])
	}
	if settings["notification_safe_settings_version"] != whatsappNotificationSafeVersion {
		t.Fatalf("unexpected applied version %#v", settings["notification_safe_settings_version"])
	}
}

func TestEvolutionConnectionObservationDistinguishesProviderFailures(t *testing.T) {
	tests := []struct {
		name        string
		result      map[string]any
		wantStatus  string
		wantKnown   bool
		wantMissing bool
	}{
		{
			name:       "connected",
			result:     map[string]any{"ok": true, "normalizedStatus": "connected"},
			wantStatus: "connected",
			wantKnown:  true,
		},
		{
			name:       "provider explicitly disconnected",
			result:     map[string]any{"ok": true, "normalizedStatus": "disconnected"},
			wantStatus: "disconnected",
			wantKnown:  true,
		},
		{
			name:        "missing instance",
			result:      map[string]any{"ok": false, "status": 404, "error": "instance not found"},
			wantStatus:  "disconnected",
			wantKnown:   true,
			wantMissing: true,
		},
		{
			name:       "old provider disconnected response",
			result:     map[string]any{"ok": false, "status": 400, "error": "client disconnected"},
			wantStatus: "disconnected",
			wantKnown:  true,
		},
		{
			name:      "provider unavailable",
			result:    map[string]any{"ok": false, "status": 503, "error": "upstream unavailable"},
			wantKnown: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, known, missing := evolutionConnectionObservation(tt.result)
			if status != tt.wantStatus || known != tt.wantKnown || missing != tt.wantMissing {
				t.Fatalf("observation = (%q, %v, %v), want (%q, %v, %v)", status, known, missing, tt.wantStatus, tt.wantKnown, tt.wantMissing)
			}
		})
	}
}

func TestSessionAutoReconnectDefaultsOnAndHonorsLogout(t *testing.T) {
	if !sessionAutoReconnectEnabled(nil) {
		t.Fatal("expected existing sessions without a flag to keep automatic recovery enabled")
	}
	if sessionAutoReconnectEnabled(map[string]any{"auto_reconnect_enabled": false}) {
		t.Fatal("expected an intentional logout to disable automatic recovery")
	}
	if !sessionAutoReconnectEnabled(map[string]any{"auto_reconnect_enabled": true}) {
		t.Fatal("expected an explicitly enabled session to be recovered")
	}
}

func TestProviderStaleClientErrorRequiresExactDisconnectedClientSignal(t *testing.T) {
	if !isProviderStaleClientError(errors.New("provider failed: client disconnected")) {
		t.Fatal("expected stale in-memory client to allow force reconnect fallback")
	}
	if isProviderStaleClientError(errors.New("provider temporarily unavailable")) {
		t.Fatal("expected transient provider failures not to force reconnect")
	}
}

func TestEvolutionProviderRequiresPairingOnlyForTerminalDisconnectReason(t *testing.T) {
	tests := []struct {
		name   string
		result map[string]any
		want   bool
	}{
		{
			name: "logged out from another device",
			result: map[string]any{"data": map[string]any{"data": map[string]any{
				"disconnect_reason": "401: logged out from another device",
			}}},
			want: true,
		},
		{
			name: "primary device logged out",
			result: map[string]any{"data": map[string]any{"data": map[string]any{
				"disconnect_reason": "403: primary device was logged out",
			}}},
			want: true,
		},
		{
			name: "unknown logout code",
			result: map[string]any{"data": map[string]any{"data": map[string]any{
				"disconnect_reason": "406",
			}}},
			want: true,
		},
		{
			name: "recoverable reconnect state",
			result: map[string]any{"data": map[string]any{"data": map[string]any{
				"disconnect_reason": "Reconnecting",
			}}},
			want: false,
		},
		{
			name: "recoverable closed websocket",
			result: map[string]any{"data": map[string]any{"data": map[string]any{
				"disconnect_reason": "Disconnected emitted because the websocket is closed by the server.",
			}}},
			want: false,
		},
		{
			name:   "unrelated provider error is not interpreted as logout",
			result: map[string]any{"error": "HTTP 401 from an intermediate proxy"},
			want:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := evolutionProviderRequiresPairing(tt.result); got != tt.want {
				t.Fatalf("evolutionProviderRequiresPairing() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestEvolutionProviderRecoveryDispositionFailsClosed(t *testing.T) {
	tests := []struct {
		name   string
		result map[string]any
		want   evolutionRecoveryOutcome
	}{
		{
			name: "provider row still marked connected",
			result: map[string]any{"data": map[string]any{"data": map[string]any{
				"connected": true,
			}}},
			want: evolutionRecoveryAttempted,
		},
		{
			name: "provider reconnecting",
			result: map[string]any{"data": map[string]any{"data": map[string]any{
				"connected": false, "disconnect_reason": "Reconnecting",
			}}},
			want: evolutionRecoveryAttempted,
		},
		{
			name: "websocket closed",
			result: map[string]any{"data": map[string]any{"data": map[string]any{
				"connected": false, "disconnect_reason": "Disconnected emitted because the websocket is closed by the server.",
			}}},
			want: evolutionRecoveryAttempted,
		},
		{
			name: "ambiguous historical disconnect",
			result: map[string]any{"data": map[string]any{"data": map[string]any{
				"connected": false, "disconnect_reason": "",
			}}},
			want: evolutionRecoveryWaiting,
		},
		{
			name: "paired device without disconnect reason",
			result: map[string]any{"data": map[string]any{"data": map[string]any{
				"connected": false, "disconnect_reason": "", "jid": "551188887777:12@s.whatsapp.net",
			}}},
			want: evolutionRecoveryAttempted,
		},
		{
			name: "temporary ban",
			result: map[string]any{"data": map[string]any{"data": map[string]any{
				"connected": false, "disconnect_reason": "402: TemporaryBan",
			}}},
			want: evolutionRecoveryProviderBlocked,
		},
		{
			name: "logged out",
			result: map[string]any{"data": map[string]any{"data": map[string]any{
				"connected": false, "disconnect_reason": "401: logged out from another device",
			}}},
			want: evolutionRecoveryRequiresPairing,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := evolutionProviderRecoveryDisposition(tt.result); got != tt.want {
				t.Fatalf("evolutionProviderRecoveryDisposition() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSessionRecoveryRolloutAndBackoffFailClosed(t *testing.T) {
	const sessionID = "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"
	if sessionIDAllowlistAllows(nil, sessionID) {
		t.Fatal("empty recovery allowlist must keep provider mutation disabled")
	}
	if !sessionIDAllowlistAllows([]string{sessionID}, sessionID) {
		t.Fatal("explicit recovery canary must be enabled")
	}
	if !sessionIDAllowlistAllows([]string{"*"}, sessionID) {
		t.Fatal("explicit wildcard rollout must be enabled")
	}

	now := time.Date(2026, time.August, 26, 12, 0, 0, 0, time.UTC)
	settings := map[string]any{
		"auto_reconnect_failure_count": 1.0,
		"auto_reconnect_retry_after":   now.Add(5 * time.Minute).Format(time.RFC3339),
	}
	if autoReconnectFailureCount(settings) != 1 {
		t.Fatalf("unexpected recovery failure count %d", autoReconnectFailureCount(settings))
	}
	if autoReconnectRetryDue(settings, now) {
		t.Fatal("recovery must wait until its backoff expires")
	}
	if !autoReconnectRetryDue(settings, now.Add(5*time.Minute)) {
		t.Fatal("recovery must become due at the retry timestamp")
	}

	grace := map[string]any{
		"auto_reconnect_grace_observed_at": now.Format(time.RFC3339),
	}
	if !autoReconnectGraceObserved(grace) || autoReconnectFailureCount(grace) != 0 {
		t.Fatal("the provider-owned reconnect grace must not count as a CRM recovery failure")
	}

	blocked := map[string]any{
		"auto_reconnect_enabled":        true,
		"auto_reconnect_blocked_reason": "recovery_exhausted",
	}
	if !sessionAutoReconnectEnabled(blocked) {
		t.Fatal("an exhausted recovery circuit must keep passive status/webhook synchronization enabled")
	}
	if autoReconnectRetryDue(blocked, now) {
		t.Fatal("an exhausted recovery circuit must not mutate the provider again")
	}
	if !autoReconnectRecoveryStatePresent(blocked) {
		t.Fatal("a connected observation must be able to clear an exhausted recovery circuit")
	}
}

func TestEvolutionRecoveryPhoneUsesOnlyProviderJID(t *testing.T) {
	stored := "+55 (11) 99999-0000"
	if got := evolutionRecoveryPhone(Session{PhoneNumber: &stored}, nil); got != "" {
		t.Fatalf("cached CRM phone must not be used for provider-global recovery, got %q", got)
	}

	info := map[string]any{"data": map[string]any{"data": map[string]any{
		"jid": "551188887777:12@s.whatsapp.net",
	}}}
	if got := evolutionRecoveryPhone(Session{}, info); got != "551188887777" {
		t.Fatalf("provider recovery phone = %q", got)
	}

	otherStored := "+55 (11) 97777-6666"
	if got := evolutionRecoveryPhone(Session{PhoneNumber: &otherStored}, info); got != "551188887777" {
		t.Fatalf("provider JID must win over stale CRM phone, got %q", got)
	}

	opaque := map[string]any{"data": map[string]any{"data": map[string]any{
		"jid": "123456789@lid",
	}}}
	if got := evolutionRecoveryPhone(Session{}, opaque); got != "" {
		t.Fatalf("opaque provider identity must not be used as a phone, got %q", got)
	}
}
