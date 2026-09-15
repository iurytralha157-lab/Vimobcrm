package meta

import "testing"

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
