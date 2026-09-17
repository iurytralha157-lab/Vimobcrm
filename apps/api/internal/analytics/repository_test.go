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
			name: "rejects dateFrom without dateTo",
			values: url.Values{
				"dateFrom": {"2026-08-01"},
			},
			wantErr: true,
		},
		{
			name: "rejects dateTo without dateFrom",
			values: url.Values{
				"dateTo": {"2026-08-31"},
			},
			wantErr: true,
		},
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
				"dateFrom":  {"2026-07-01"},
				"dateTo":    {"2026-07-31"},
				"accountId": {"act_123456789"},
				"objective": {"OUTCOME_LEADS"},
				"teamId":    {"11111111-1111-4111-8111-111111111111"},
				"userId":    {"22222222-2222-4222-8222-222222222222"},
				"tagId":     {"33333333-3333-4333-8333-333333333333"},
			},
		},
		{
			name: "accepts multiple tag UUID filters",
			values: url.Values{
				"dateFrom": {"2026-07-01"},
				"dateTo":   {"2026-07-31"},
				"tagIds":   {"33333333-3333-4333-8333-333333333333,44444444-4444-4444-8444-444444444444"},
			},
		},
		{
			name: "rejects malformed multi-tag UUID filters",
			values: url.Values{
				"dateFrom": {"2026-07-01"},
				"dateTo":   {"2026-07-31"},
				"tagIds":   {"33333333-3333-4333-8333-333333333333,not-a-uuid"},
			},
			wantErr: true,
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
		{
			name: "rejects oversized provider filters",
			values: url.Values{
				"dateFrom":  {"2026-07-01"},
				"dateTo":    {"2026-07-31"},
				"accountId": {strings.Repeat("x", 256)},
			},
			wantErr: true,
		},
		{
			name: "rejects unsupported deal statuses",
			values: url.Values{
				"dateFrom":   {"2026-07-01"},
				"dateTo":     {"2026-07-31"},
				"dealStatus": {"deleted"},
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

func TestNormalizeCampaignInsightTagIDsTrimsCanonicalizesAndDeduplicates(t *testing.T) {
	first := "33333333-3333-4333-8333-333333333333"
	second := "44444444-4444-4444-8444-444444444444"
	got, err := normalizeCampaignInsightTagIDs("  " + first + ", " + second + "," + first + "  ")
	if err != nil {
		t.Fatalf("normalizeCampaignInsightTagIDs() error = %v", err)
	}
	if want := first + "," + second; got != want {
		t.Fatalf("normalizeCampaignInsightTagIDs() = %q, want %q", got, want)
	}
}

func TestSiteSummaryExposesOrganizationFreshnessOutsideSelectedPeriod(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("site_repository.go")
	if err != nil {
		t.Fatalf("read site_repository.go: %v", err)
	}
	query := string(source)
	for _, required := range []string{
		"lastObservedAtSQL := siteAnalyticsObservedAtSQL(\"e.\", capabilities.lastSeenAt)",
		"select max(`+lastObservedAtSQL+`) as last_collected_at",
		"where e.organization_id = $1::uuid",
		"'lastCollectedAt', f.last_collected_at",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("site summary is missing freshness contract %q", required)
		}
	}
}

func TestSiteSummaryPreviousConversionRateUsesConvertedSessions(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("site_repository.go")
	if err != nil {
		t.Fatalf("read site_repository.go: %v", err)
	}
	query := string(source)
	for _, required := range []string{
		"count(distinct session_id) filter (",
		"where event_type = 'form_submit' and session_id not like 'site-contact:%'",
		")::int converted_sessions",
		"round(p.converted_sessions::numeric*100/p.sessions,2)",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("site summary is missing session conversion contract %q", required)
		}
	}
	if strings.Contains(query, "round(p.conversions::numeric*100/p.sessions,2)") {
		t.Fatal("previous conversion rate must not exceed 100% because one session submitted more than once")
	}
}

func TestCampaignInsightsDoesNotFabricateUnknownHistoricalFollowers(t *testing.T) {
	source, err := os.ReadFile("marketing_repository.go")
	if err != nil {
		t.Fatalf("read marketing_repository.go: %v", err)
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

func TestCampaignInsightsExposesSanitizedMetaCapabilitiesToDashboardViewers(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("marketing_repository.go")
	if err != nil {
		t.Fatalf("read marketing_repository.go: %v", err)
	}
	query := string(source)
	for _, required := range []string{
		"@> array['ads_read']::text[] as marketing_token_available",
		"integration.token_expires_at > now() + interval '5 minutes'",
		"'instagram_manage_insights'",
		"coalesce(bool_or(marketing_token_available), false)",
		"'marketingTokenAvailable'",
		"'instagramInsightsAvailable'",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("campaign insights is missing sanitized capability contract %q", required)
		}
	}
	if strings.Contains(query, "'accessToken'") || strings.Contains(query, "'userAccessToken'") {
		t.Fatal("campaign insights must never expose Meta credentials")
	}
}

func TestCampaignInsightsRecalculatesPaidMediaMetricsForSelectedPeriod(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("marketing_repository.go")
	if err != nil {
		t.Fatalf("read marketing_repository.go: %v", err)
	}
	query := string(source)
	for _, required := range []string{
		"left join paid_ads as current_paid_ad",
		"when asset.source_kind = 'paid' then jsonb_strip_nulls",
		"'impressions', current_paid_ad.impressions",
		"'spend', current_paid_ad.spend",
		"else asset.metrics",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("campaign insights is missing period-scoped paid media contract %q", required)
		}
	}
}

func TestCampaignInsightsFallsBackToTenantScopedAdFacts(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("marketing_repository.go")
	if err != nil {
		t.Fatalf("read marketing_repository.go: %v", err)
	}
	query := string(source)
	for _, required := range []string{
		"from paid as preferred_campaign",
		"from paid as preferred_adset",
		"from paid as account_metric",
		"from paid as campaign_metric",
		"from paid as adset_metric",
		"then 'adset_fallback'",
		"else 'ad_fallback'",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("campaign insights is missing safe paid-fact fallback %q", required)
		}
	}
}

func TestCampaignInsightsSupportsTenantScopedMarketingDimensionsAndReconciliation(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("marketing_repository.go")
	if err != nil {
		t.Fatalf("read marketing_repository.go: %v", err)
	}
	query := string(source)
	for _, required := range []string{
		"metric.organization_id = $1::uuid",
		"metric.external_account_id = params.account_id",
		"metric.objective = params.objective",
		"from available_accounts as account",
		"from available_objectives as objective",
		"'filterOptions'",
		"'reportedResults', (select leads_reported + conversations from summary)",
		"'crmAttributedLeads', (select leads from summary)",
		"'meta_leads_plus_messaging_conversations_non_unique'",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("campaign insights is missing dimension/reconciliation contract %q", required)
		}
	}
}

func TestCampaignInsightsScopesContactToTheAttributedEntry(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("marketing_repository.go")
	if err != nil {
		t.Fatalf("read marketing_repository.go: %v", err)
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

	source, err := os.ReadFile("marketing_repository.go")
	if err != nil {
		t.Fatalf("read marketing_repository.go: %v", err)
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
