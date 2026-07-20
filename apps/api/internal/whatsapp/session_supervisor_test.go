package whatsapp

import (
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

func TestWebhookConfigurationAllowedDoesNotReconnectConfiguredConnectedSession(t *testing.T) {
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
	if !webhookConfigurationAllowed([]string{canarySession}, canarySession, settings, webhookURL, "disconnected") {
		t.Fatal("expected a disconnected canary to be reconfigured")
	}
}

func TestEvolutionSupervisorConnectPlanMigratesEveryDisconnectedSessionToBackend(t *testing.T) {
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
	if !shouldConnect {
		t.Fatal("expected disconnected non-canary supervision to keep reconnecting")
	}
	if !appliesWebhook {
		t.Fatal("expected disconnected session reconnect to apply the tokenless backend webhook")
	}
	if body["webhookUrl"] != "https://api.vimobcrm.com.br/v1/whatsapp/webhook/evolution-go" {
		t.Fatalf("unexpected webhook reconnect body %#v", body)
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
