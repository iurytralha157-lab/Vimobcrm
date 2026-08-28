package analytics

import (
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"
)

func TestValidateSiteAnalyticsValues(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		values  url.Values
		wantErr bool
	}{
		{name: "keeps the API defaults when dates are omitted", values: url.Values{}},
		{
			name: "accepts local calendar dates",
			values: url.Values{
				"dateFrom": {"2026-08-01"},
				"dateTo":   {"2026-08-31"},
			},
		},
		{
			name: "rejects timestamps before PostgreSQL casts",
			values: url.Values{
				"dateFrom": {"2026-08-01T03:00:00.000Z"},
				"dateTo":   {"2026-08-31T02:59:59.999Z"},
			},
			wantErr: true,
		},
		{
			name: "rejects impossible dates",
			values: url.Values{
				"dateFrom": {"2026-02-30"},
				"dateTo":   {"2026-03-01"},
			},
			wantErr: true,
		},
		{
			name: "rejects inverted dates",
			values: url.Values{
				"dateFrom": {"2026-08-02"},
				"dateTo":   {"2026-08-01"},
			},
			wantErr: true,
		},
		{
			name: "rejects ranges longer than 366 days",
			values: url.Values{
				"dateFrom": {"2025-01-01"},
				"dateTo":   {"2026-01-02"},
			},
			wantErr: true,
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			err := validateSiteAnalyticsValues(test.values)
			if test.wantErr && !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("expected ErrInvalidInput, got %v", err)
			}
			if !test.wantErr && err != nil {
				t.Fatalf("expected valid filters, got %v", err)
			}
		})
	}
}

func TestValidateCampaignInsightsValues(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		values  url.Values
		wantErr bool
	}{
		{
			name:    "rejects missing date range",
			values:  url.Values{},
			wantErr: true,
		},
		{
			name: "rejects an unbounded date range",
			values: url.Values{
				"dateFrom": {"2026-07-01"},
			},
			wantErr: true,
		},
		{
			name: "accepts local calendar dates and UUID filters",
			values: url.Values{
				"dateFrom": {"2026-07-01"},
				"dateTo":   {"2026-07-31"},
				"teamId":   {"11111111-1111-4111-8111-111111111111"},
				"userId":   {"22222222-2222-4222-8222-222222222222"},
				"tagId":    {"33333333-3333-4333-8333-333333333333"},
			},
		},
		{
			name: "rejects UTC timestamps to prevent local date drift",
			values: url.Values{
				"dateFrom": {"2026-07-01T03:00:00.000Z"},
				"dateTo":   {"2026-07-31T02:59:59.999Z"},
			},
			wantErr: true,
		},
		{
			name: "rejects inverted dates",
			values: url.Values{
				"dateFrom": {"2026-08-01"},
				"dateTo":   {"2026-07-31"},
			},
			wantErr: true,
		},
		{
			name: "rejects ranges longer than 366 days",
			values: url.Values{
				"dateFrom": {"2025-01-01"},
				"dateTo":   {"2026-01-02"},
			},
			wantErr: true,
		},
		{
			name: "rejects malformed UUID filters before SQL casts",
			values: url.Values{
				"dateFrom": {"2026-07-01"},
				"dateTo":   {"2026-07-31"},
				"teamId":   {"not-a-uuid"},
			},
			wantErr: true,
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			err := validateCampaignInsightsValues(test.values)
			if test.wantErr && !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("expected ErrInvalidInput, got %v", err)
			}
			if !test.wantErr && err != nil {
				t.Fatalf("expected valid filters, got %v", err)
			}
		})
	}
}

func TestCampaignInsightsDoesNotFabricateUnknownHistoricalFollowers(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}
	query := string(source)
	for _, required := range []string{
		"follower_day.followers is not null",
		"count(followers) = count(*) then sum(followers)",
		"'followers', (select followers from latest_social)",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("campaign insights is missing nullable follower contract %q", required)
		}
	}
	if strings.Contains(query, "'followers', coalesce((select followers from latest_social), 0)") {
		t.Fatal("unknown follower snapshots must not be exposed as zero")
	}
}

func TestCampaignInsightsScopesContactToTheAttributedEntry(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}
	query := string(source)
	for _, required := range []string{
		"from public.lead_action_facts as fact",
		"fact.qualifies_first_outreach = true",
		"fact.is_automated = false",
		"fact.occurred_at >= attribution.occurred_at",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("campaign insights contact attribution is missing %q", required)
		}
	}
	if strings.Contains(query, "lead.first_response_at >= attribution.occurred_at") {
		t.Fatal("global first_response_at must not classify contact for a later Meta reentry")
	}
}

func TestCampaignInsightsUsesCanonicalEntryOrderAndImmutableWonValue(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}
	query := string(source)
	for _, required := range []string{
		"candidate.occurred_at desc,",
		"candidate.created_at desc,",
		"jsonb_typeof(funnel.metadata->'value_snapshot') = 'number'",
		"(funnel.metadata->>'value_snapshot')::numeric",
		"has_crm_scope_filter",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("campaign insights is missing canonical funnel contract %q", required)
		}
	}
	if strings.Contains(query, "then coalesce(lead.valor_interesse, 0)") {
		t.Fatal("historical revenue must not be recalculated from the lead's current value")
	}
}
