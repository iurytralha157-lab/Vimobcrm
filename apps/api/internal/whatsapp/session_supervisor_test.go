package whatsapp

import "testing"

func TestEvolutionWebhookConnectBodySubscribesOnlyToCRMEvents(t *testing.T) {
	body := evolutionWebhookConnectBody("https://example.com/webhook")
	subscriptions, ok := body["subscribe"].([]string)
	if !ok {
		t.Fatalf("expected string subscriptions, got %#v", body["subscribe"])
	}

	for _, subscription := range subscriptions {
		if subscription == "ALL" || subscription == "HISTORY_SYNC" || subscription == "PRESENCE" {
			t.Fatalf("unexpected high-volume subscription %q in %#v", subscription, subscriptions)
		}
	}

	for _, required := range []string{"MESSAGE", "SEND_MESSAGE", "READ_RECEIPT", "CONNECTION"} {
		if !containsString(subscriptions, required) {
			t.Fatalf("expected subscription %q in %#v", required, subscriptions)
		}
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
