package site

import (
	"strings"
	"testing"
)

func TestSanitizeSitePayloadGoogleSearchConsoleVerification(t *testing.T) {
	payload, err := sanitizeSitePayload(map[string]any{
		"google_search_console_verification": "  abcDEF_1234567890-token  ",
	})
	if err != nil {
		t.Fatalf("expected valid verification token: %v", err)
	}
	if got := payload["google_search_console_verification"]; got != "abcDEF_1234567890-token" {
		t.Fatalf("unexpected normalized token: %#v", got)
	}

	for _, invalid := range []any{
		"short",
		"<script>alert(1)</script>",
		123,
	} {
		if _, err := sanitizeSitePayload(map[string]any{
			"google_search_console_verification": invalid,
		}); err == nil {
			t.Fatalf("expected invalid token to fail: %#v", invalid)
		}
	}
}

func TestSanitizeSitePayloadGoogleMeasurementIdentifiers(t *testing.T) {
	payload, err := sanitizeSitePayload(map[string]any{
		"google_analytics_id": " g-abc1234567 ",
		"gtm_id":              " gtm-abcd1234 ",
	})
	if err != nil {
		t.Fatalf("expected valid Google identifiers: %v", err)
	}
	if got := payload["google_analytics_id"]; got != "G-ABC1234567" {
		t.Fatalf("unexpected Analytics identifier: %#v", got)
	}
	if got := payload["gtm_id"]; got != "GTM-ABCD1234" {
		t.Fatalf("unexpected Tag Manager identifier: %#v", got)
	}

	legacyPayload, err := sanitizeSitePayload(map[string]any{
		"google_analytics_id": "UA-123456-7",
	})
	if err != nil || legacyPayload["google_analytics_id"] != "UA-123456-7" {
		t.Fatalf("legacy Analytics identifiers must remain readable and editable: %#v, %v", legacyPayload, err)
	}

	for field, invalid := range map[string]any{
		"google_analytics_id": "GTM-ABC123",
		"gtm_id":              "<script>alert(1)</script>",
	} {
		if _, err := sanitizeSitePayload(map[string]any{field: invalid}); err == nil {
			t.Fatalf("expected invalid %s to fail: %#v", field, invalid)
		}
	}
}

func TestSiteReturningColumnsIncludesGoogleSearchConsoleVerification(t *testing.T) {
	if !strings.Contains(siteReturningColumns(), "google_search_console_verification") {
		t.Fatal("site responses must include the Search Console verification token")
	}
}
