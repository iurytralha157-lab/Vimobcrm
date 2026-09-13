package webhooks

import "testing"

func TestValidateOutgoingWebhookURLRejectsSSRFPrimitives(t *testing.T) {
	for _, rawURL := range []string{
		"http://example.com/hook",
		"https://localhost/hook",
		"https://service.local/hook",
		"https://127.0.0.1/hook",
		"https://10.0.0.1/hook",
		"https://100.64.0.1/hook",
		"https://192.0.2.1/hook",
		"https://[2001:db8::1]/hook",
		"https://user:password@example.com/hook",
	} {
		if _, err := validateOutgoingWebhookURL(rawURL); err == nil {
			t.Fatalf("expected URL %q to be rejected", rawURL)
		}
	}
	if _, err := validateOutgoingWebhookURL("https://hooks.example.com/vimob"); err != nil {
		t.Fatalf("public HTTPS URL rejected: %v", err)
	}
}

func TestOutgoingWebhookEventsAreAllowlistedAndUnique(t *testing.T) {
	events, err := normalizeOutgoingWebhookEvents([]string{" lead.created ", "lead.reentered"})
	if err != nil || len(events) != 2 || events[0] != "lead.created" {
		t.Fatalf("normalized events = %#v, %v", events, err)
	}
	for _, events := range [][]string{
		nil,
		{"lead.updated"},
		{"lead.created", "lead.created"},
	} {
		if _, err := normalizeOutgoingWebhookEvents(events); err == nil {
			t.Fatalf("expected events %#v to be rejected", events)
		}
	}
}

func TestWebhookSignatureCoversTimestampAndBody(t *testing.T) {
	first := webhookSignature("01234567890123456789012345678901", "1700000000", []byte(`{"ok":true}`))
	if first == webhookSignature("01234567890123456789012345678901", "1700000001", []byte(`{"ok":true}`)) {
		t.Fatal("timestamp must be authenticated")
	}
	if first == webhookSignature("01234567890123456789012345678901", "1700000000", []byte(`{"ok":false}`)) {
		t.Fatal("payload must be authenticated")
	}
}

func TestWebhookDeliveryRetriesOnlyTransientFailures(t *testing.T) {
	for _, status := range []int{0, 408, 425, 429, 500, 503} {
		if !webhookDeliveryShouldRetry(status) {
			t.Fatalf("HTTP %d should be retryable", status)
		}
	}
	for _, status := range []int{301, 400, 401, 403, 404, 409, 410, 422, 700} {
		if webhookDeliveryShouldRetry(status) {
			t.Fatalf("HTTP %d should be terminal", status)
		}
	}
}
