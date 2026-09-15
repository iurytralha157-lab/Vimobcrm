package meta

import (
	"strings"
	"testing"
)

func TestIsRetryableMetaWebhookFailure(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		status       string
		errorMessage string
		want         bool
	}{
		{
			name:         "temporary upstream failure",
			status:       "failed",
			errorMessage: "Meta Graph returned HTTP 503: upstream unavailable",
			want:         true,
		},
		{
			name:         "development access cannot recover by retrying",
			status:       "failed",
			errorMessage: "Meta Graph returned HTTP 400: (#3) Apps in dev mode should only access leads submitted from App special roles",
			want:         false,
		},
		{
			name:         "missing permission cannot recover by retrying",
			status:       "failed",
			errorMessage: "Meta Graph returned HTTP 400: Unsupported get request. Object does not exist or cannot be loaded due to missing permissions",
			want:         false,
		},
		{
			name:         "missing page token requires reconnection",
			status:       "failed",
			errorMessage: "Meta page access token is missing",
			want:         false,
		},
		{
			name:         "processed event never retries",
			status:       "processed",
			errorMessage: "",
			want:         false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := isRetryableMetaWebhookFailure(test.status, test.errorMessage); got != test.want {
				t.Fatalf("isRetryableMetaWebhookFailure() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestMetaLeadFallbackPreservesTheProviderEventForLaterEnrichment(t *testing.T) {
	formName := strings.Repeat("Formulário ", 30)
	name := fallbackMetaLeadName(metaFormConfig{FormName: &formName})
	if !strings.HasPrefix(name, "Lead Meta - Formulário") {
		t.Fatalf("fallbackMetaLeadName() = %q", name)
	}
	if len([]rune(name)) > 160 {
		t.Fatalf("fallback name has %d runes, want at most 160", len([]rune(name)))
	}

	metadata := map[string]any{"source": "meta"}
	setMetaLeadDetailsState(metadata, " Meta Graph temporarily unavailable ")
	if metadata["meta_details_status"] != "pending" {
		t.Fatalf("pending status = %#v", metadata["meta_details_status"])
	}
	if metadata["meta_details_error"] != "Meta Graph temporarily unavailable" {
		t.Fatalf("pending error = %#v", metadata["meta_details_error"])
	}

	setMetaLeadDetailsState(metadata, "")
	if metadata["meta_details_status"] != "complete" {
		t.Fatalf("complete status = %#v", metadata["meta_details_status"])
	}
	if _, exists := metadata["meta_details_error"]; exists {
		t.Fatalf("completed metadata retained the provider error: %#v", metadata)
	}
}
