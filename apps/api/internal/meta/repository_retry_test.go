package meta

import (
	"os"
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

func TestMetaLeadDetailsStateCanStillEnrichLegacyPendingRecords(t *testing.T) {
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

func TestClassifyMetaLeadIntake(t *testing.T) {
	t.Parallel()

	phone := "+5511999999999"
	email := "lead@example.com"
	tests := []struct {
		name    string
		details map[string]any
		raw     map[string]any
		lead    leadData
		want    metaLeadIntakeDisposition
	}{
		{
			name: "accepts real name and canonical phone",
			details: map[string]any{"field_data": []any{
				map[string]any{"name": "full_name", "values": []any{"Maria Silva"}},
				map[string]any{"name": "phone_number", "values": []any{phone}},
			}},
			lead: leadData{Name: "Maria Silva", NameFromProvider: true, Phone: &phone},
			want: metaLeadIntakeReady,
		},
		{
			name: "accepts email when form has no phone",
			details: map[string]any{"field_data": []any{
				map[string]any{"name": "full_name", "values": []any{"Maria Silva"}},
				map[string]any{"name": "email", "values": []any{email}},
			}},
			lead: leadData{Name: "Maria Silva", NameFromProvider: true, Email: &email},
			want: metaLeadIntakeReady,
		},
		{
			name:    "waits instead of creating a synthetic contact without fields",
			details: map[string]any{},
			raw:     map[string]any{"leadgen_id": "lead-123"},
			lead:    leadData{Name: "Lead Meta - Formulario"},
			want:    metaLeadIntakeWaitForIdentity,
		},
		{
			name: "accepts a configured provider name without imposing a contact channel",
			details: map[string]any{"field_data": []any{
				map[string]any{"name": "full_name", "values": []any{"Maria Silva"}},
			}},
			lead: leadData{Name: "Maria Silva", NameFromProvider: true},
			want: metaLeadIntakeReady,
		},
		{
			name: "waits when a default or fallback name did not come from Meta",
			details: map[string]any{"field_data": []any{
				map[string]any{"name": "phone_number", "values": []any{phone}},
			}},
			lead: leadData{Name: "Nome padrao", Phone: &phone},
			want: metaLeadIntakeWaitForIdentity,
		},
		{
			name: "ignores explicit Meta dummy lead",
			details: map[string]any{"field_data": []any{
				map[string]any{"name": "full_name", "values": []any{"<test lead: dummy data for full_name>"}},
				map[string]any{"name": "phone_number", "values": []any{"<test lead: dummy data for phone_number>"}},
			}},
			lead: leadData{Name: "<test lead: dummy data for full_name>"},
			want: metaLeadIntakeIgnoreTest,
		},
		{
			name: "ignores dummy marker retained only in the webhook payload",
			details: map[string]any{"field_data": []any{
				map[string]any{"name": "full_name", "values": []any{"Maria Silva"}},
				map[string]any{"name": "phone_number", "values": []any{phone}},
			}},
			raw: map[string]any{"field_data": []any{
				map[string]any{"name": "full_name", "values": []any{"<test lead: dummy data for full_name>"}},
			}},
			lead: leadData{Name: "Maria Silva", NameFromProvider: true, Phone: &phone},
			want: metaLeadIntakeIgnoreTest,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := classifyMetaLeadIntake(test.details, test.raw, test.lead); got != test.want {
				t.Fatalf("classifyMetaLeadIntake() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestAggregateResultsDefersIncompleteIdentityWithoutCountingALead(t *testing.T) {
	t.Parallel()

	status, organizationID, errorMessage, processed := aggregateResults([]LeadgenResult{{
		Status:         "skipped",
		OrganizationID: "organization-123",
		DetailsPending: true,
		Error:          "Meta lead details are incomplete",
	}})

	if status != "deferred" || organizationID != "organization-123" || errorMessage == "" || processed != 0 {
		t.Fatalf(
			"aggregateResults() = status %q, organization %q, error %q, processed %d",
			status,
			organizationID,
			errorMessage,
			processed,
		)
	}
}

func TestDeferredMetaLeadRetriesQuicklyBeforeLongBackoff(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	finishStart := strings.Index(source, "func (repo Repository) FinishWebhookEvent")
	finishEnd := strings.Index(source[finishStart:], "func isRetryableMetaWebhookFailure")
	if finishStart < 0 || finishEnd < 0 {
		t.Fatal("FinishWebhookEvent source boundary was not found")
	}
	finish := source[finishStart : finishStart+finishEnd]

	previous := -1
	for _, delay := range []string{
		"interval '30 seconds'",
		"interval '1 minute'",
		"interval '2 minutes'",
		"interval '5 minutes'",
		"interval '15 minutes'",
		"interval '30 minutes'",
		"interval '6 hours'",
	} {
		index := strings.Index(finish, delay)
		if index < 0 {
			t.Fatalf("deferred Meta retry schedule is missing %q", delay)
		}
		if index <= previous {
			t.Fatalf("deferred Meta retry schedule is out of order around %q", delay)
		}
		previous = index
	}
}

func TestMetaWebhookClaimDoesNotAutomaticallyReopenPermanentFailures(t *testing.T) {
	t.Parallel()

	query := strings.ToLower(claimPendingWebhookEventsQuery)
	for _, permanentFailure := range []string{
		"apps in dev mode should only access leads",
		"unsupported get request",
		"meta page access token is missing",
		"lead name is invalid",
	} {
		if strings.Contains(query, permanentFailure) {
			t.Fatalf("claim query still reopens permanent failure %q", permanentFailure)
		}
	}

	for _, required := range []string{
		"status = 'received'",
		"status = 'deferred'",
		"coalesce(attempts, 0) < 29",
		"status = 'failed'",
		"coalesce(attempts, 0) < 5",
		"next_retry_at is not null",
		"next_retry_at <= now()",
		"status = 'processing'",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("claim query is missing %q", required)
		}
	}

	failedStart := strings.Index(query, "status = 'failed'")
	if failedStart < 0 {
		t.Fatal("failed claim branch was not found")
	}
	processingStart := strings.Index(query[failedStart:], "status = 'processing'")
	if processingStart < 0 {
		t.Fatal("failed/processing claim branches were not found")
	}
	failedBranch := query[failedStart : failedStart+processingStart]
	if strings.Contains(failedBranch, "coalesce(next_retry_at") {
		t.Fatal("failed events with a null retry deadline can still fall back to their receive time")
	}
}
