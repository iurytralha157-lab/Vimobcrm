package webhooks

import (
	"testing"
	"time"
)

func TestWebhookOccurredAtUsesProviderTimestamp(t *testing.T) {
	want := time.Date(2026, 7, 1, 12, 30, 0, 0, time.UTC)
	cases := []map[string]any{
		{"created_at": "2026-07-01T12:30:00Z"},
		{"timestamp": "1782909000"},
		{"timestamp": "1782909000000"},
	}

	for _, payload := range cases {
		if got := webhookOccurredAt(payload); !got.Equal(want) {
			t.Fatalf("webhookOccurredAt(%v) = %s, want %s", payload, got, want)
		}
	}
}

func TestValidateIncomingLeadFieldsRejectsOversizedOrMalformedContactData(t *testing.T) {
	validEmail := "lead@example.com"
	validPhone := "+55 11 99999-9999"
	if err := validateIncomingLeadFields(
		"Lead valido", &validEmail, &validPhone, nil, nil, nil, nil,
		nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil,
	); err != nil {
		t.Fatalf("valid lead fields returned error: %v", err)
	}

	invalidEmail := "Nome <lead@example.com>"
	if err := validateIncomingLeadFields(
		"Lead valido", &invalidEmail, &validPhone, nil, nil, nil, nil,
		nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil,
	); err == nil {
		t.Fatal("display-name email should be rejected")
	}

	shortPhone := "123"
	if err := validateIncomingLeadFields(
		"Lead valido", nil, &shortPhone, nil, nil, nil, nil,
		nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil,
	); err == nil {
		t.Fatal("short phone should be rejected")
	}

	longMessage := string(make([]byte, 10_001))
	if err := validateIncomingLeadFields(
		"Lead valido", nil, nil, &longMessage, nil, nil, nil,
		nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil,
	); err == nil {
		t.Fatal("oversized message should be rejected")
	}
}
