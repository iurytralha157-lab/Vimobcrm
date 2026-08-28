package webhooks

import "testing"

func TestWebhookRealtimePayloadNeverIncludesConfigurationOrToken(t *testing.T) {
	payload := webhookEventData(" webhook-1 ")
	if len(payload) != 1 {
		t.Fatalf("expected an identifier-only payload, got %#v", payload)
	}
	if payload["webhookId"] != "webhook-1" {
		t.Fatalf("expected normalized webhook id, got %#v", payload["webhookId"])
	}
	for _, forbidden := range []string{"api_token", "webhook", "url", "secret"} {
		if _, exists := payload[forbidden]; exists {
			t.Fatalf("realtime payload exposed forbidden field %q", forbidden)
		}
	}
}
