package webhooks

import (
	"net/http/httptest"
	"testing"
)

func TestWebhookTokenUsesHeadersOnlyAndRejectsAmbiguity(t *testing.T) {
	request := httptest.NewRequest("POST", "https://api.vimob.test/v1/public/webhooks/generic?token=query-secret", nil)
	if token := webhookToken(request); token != "" {
		t.Fatalf("query credential accepted: %q", token)
	}

	request.Header.Set("Authorization", "Bearer header-secret")
	if token := webhookToken(request); token != "header-secret" {
		t.Fatalf("bearer token = %q", token)
	}

	request.Header.Set("X-Webhook-Token", "different-secret")
	if token := webhookToken(request); token != "" {
		t.Fatalf("conflicting credentials accepted: %q", token)
	}

	request.Header.Set("X-Webhook-Token", "header-secret")
	if token := webhookToken(request); token != "header-secret" {
		t.Fatalf("matching credentials rejected: %q", token)
	}
}

func TestWebhookIdempotencyKeyIsOptionalAndTrimmed(t *testing.T) {
	if key := webhookIdempotencyKey(nil); key != "" {
		t.Fatalf("nil request key = %q", key)
	}

	request := httptest.NewRequest("POST", "https://api.vimob.test/v1/public/webhooks/generic", nil)
	if key := webhookIdempotencyKey(request); key != "" {
		t.Fatalf("missing header key = %q", key)
	}

	request.Header.Set("Idempotency-Key", "  external-arrival-123  ")
	if key := webhookIdempotencyKey(request); key != "external-arrival-123" {
		t.Fatalf("trimmed header key = %q", key)
	}
}
