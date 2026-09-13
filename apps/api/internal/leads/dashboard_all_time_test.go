package leads

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestDashboardAllTimeDoesNotSynthesizeADateRange(t *testing.T) {
	filter := DashboardFilter{Source: "meta", Limit: defaultDashboardTaskLimit}

	if _, _, ok := dashboardExplicitDateRange(filter); ok {
		t.Fatal("an omitted date range must remain all-time")
	}
	if _, ok := dashboardPreviousPeriodFilter(filter); ok {
		t.Fatal("all-time must not invent a previous comparison period")
	}
	if trend := calculateTrend(250, 0); trend != 0 {
		t.Fatalf("all-time trend = %d, want 0", trend)
	}

	args, clause := dashboardDetailLimitClause([]any{"seed"})
	if clause != "limit $2" {
		t.Fatalf("detail clause = %q, want %q", clause, "limit $2")
	}
	if len(args) != 2 || args[1] != dashboardDetailLimit {
		t.Fatalf("detail args = %#v", args)
	}
}

func TestDashboardDealDetailsStayEmptyWithoutOptIn(t *testing.T) {
	wonDeals, lostDeals, err := (Repository{}).dashboardDealDetails(
		context.Background(),
		nil,
		tenant.Context{},
		DashboardFilter{},
	)
	if err != nil {
		t.Fatalf("dashboardDealDetails() error = %v", err)
	}
	if wonDeals == nil || lostDeals == nil {
		t.Fatalf("omitted details must serialize as empty arrays: won=%#v lost=%#v", wonDeals, lostDeals)
	}
	if len(wonDeals) != 0 || len(lostDeals) != 0 {
		t.Fatalf("omitted details = %d won and %d lost, want zero", len(wonDeals), len(lostDeals))
	}
}

func TestDashboardAllTimeLeadWhereKeepsTenantAndExplicitNonDateFilters(t *testing.T) {
	tenantContext := tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		Permissions:    []string{permissions.LeadViewOwn},
	}
	filter := DashboardFilter{
		UserID:      "22222222-2222-4222-8222-222222222222",
		Source:      "meta",
		CampaignID:  "campaign-123",
		TagID:       "33333333-3333-4333-8333-333333333333",
		DealStatus:  "open",
		SearchQuery: "Maria",
		PipelineID:  "44444444-4444-4444-8444-444444444444",
	}

	where, args, err := (Repository{}).buildDashboardLeadWhere(
		tenantContext,
		filter,
		dashboardLeadWhereOptions{DateColumn: "created_at"},
	)
	if err != nil {
		t.Fatalf("buildDashboardLeadWhere() error = %v", err)
	}
	query := strings.Join(where, " and ")
	for _, fragment := range []string{
		"l.organization_id = $1::uuid",
		"l.assigned_user_id =",
		"l.source =",
		"l.pipeline_id =",
		"l.deal_status =",
		"from public.lead_tags",
		"from public.lead_entry_events",
	} {
		if !strings.Contains(query, fragment) {
			t.Fatalf("all-time lead predicate is missing %q: %s", fragment, query)
		}
	}
	if strings.Contains(query, "l.created_at >=") || strings.Contains(query, "l.created_at <=") {
		t.Fatalf("all-time lead predicate synthesized a period: %s", query)
	}
	if len(args) < 2 || args[0] != tenantContext.OrganizationID {
		t.Fatalf("tenant arguments = %#v", args)
	}
}

func TestDashboardExplicitLeadWhereAppliesBothDateBounds(t *testing.T) {
	from := time.Date(2026, time.August, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, time.August, 31, 23, 59, 59, 0, time.UTC)
	tenantContext := tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		Permissions:    []string{permissions.LeadViewOwn},
	}

	where, _, err := (Repository{}).buildDashboardLeadWhere(
		tenantContext,
		DashboardFilter{DateFrom: &from, DateTo: &to},
		dashboardLeadWhereOptions{DateColumn: "created_at"},
	)
	if err != nil {
		t.Fatalf("buildDashboardLeadWhere() error = %v", err)
	}
	query := strings.Join(where, " and ")
	if !strings.Contains(query, "l.created_at >=") || !strings.Contains(query, "l.created_at <=") {
		t.Fatalf("explicit lead predicate lost a date bound: %s", query)
	}
}

func TestDashboardExplicitPeriodKeepsFiltersAndBuildsPreviousWindow(t *testing.T) {
	from := time.Date(2026, time.August, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, time.August, 31, 0, 0, 0, 0, time.UTC)
	filter := DashboardFilter{
		DateFrom:   &from,
		DateTo:     &to,
		TeamID:     dashboardTestUUID,
		CampaignID: "campaign-123",
	}

	actualFrom, actualTo, ok := dashboardExplicitDateRange(filter)
	if !ok || !actualFrom.Equal(from) || !actualTo.Equal(to) {
		t.Fatalf("explicit range = (%v, %v, %v)", actualFrom, actualTo, ok)
	}
	previous, ok := dashboardPreviousPeriodFilter(filter)
	if !ok {
		t.Fatal("explicit range must have a previous comparison period")
	}
	if previous.DateFrom == nil || previous.DateTo == nil {
		t.Fatal("previous period is incomplete")
	}
	if !previous.DateTo.Equal(from) || !previous.DateFrom.Equal(from.Add(-to.Sub(from))) {
		t.Fatalf("previous period = %v to %v", previous.DateFrom, previous.DateTo)
	}
	if previous.TeamID != filter.TeamID || previous.CampaignID != filter.CampaignID {
		t.Fatalf("previous period lost non-date filters: %#v", previous)
	}

	args, clause := dashboardDetailLimitClause([]any{"seed"})
	if clause != "limit $2" || len(args) != 2 || args[1] != dashboardDetailLimit {
		t.Fatalf("explicit detail query must remain bounded: clause=%q args=%#v", clause, args)
	}
}

func TestDashboardAllTimeEvolutionIntervalsStayBounded(t *testing.T) {
	from := time.Date(2016, time.January, 10, 12, 0, 0, 0, time.UTC)
	to := time.Date(2026, time.September, 12, 12, 0, 0, 0, time.UTC)

	intervals, labels := dashboardEvolutionIntervals(from, to, "")
	if len(intervals) == 0 || len(intervals) > dashboardMaxEvolutionBucketCount {
		t.Fatalf("all-time intervals = %d, want between 1 and %d", len(intervals), dashboardMaxEvolutionBucketCount)
	}
	if len(labels) != len(intervals) {
		t.Fatalf("labels = %d, intervals = %d", len(labels), len(intervals))
	}
}

func TestDashboardExplicitMonthlyPeriodStaysWithinEvolutionBudget(t *testing.T) {
	from := time.Date(2026, time.August, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, time.August, 31, 23, 59, 59, 0, time.UTC)

	intervals, labels := dashboardEvolutionIntervals(from, to, "day")
	if len(intervals) == 0 || len(intervals) > dashboardMaxEvolutionBucketCount {
		t.Fatalf("monthly intervals = %d, want between 1 and %d", len(intervals), dashboardMaxEvolutionBucketCount)
	}
	if len(labels) != len(intervals) {
		t.Fatalf("labels = %d, intervals = %d", len(labels), len(intervals))
	}
}

func TestDashboardHourlyEvolutionKeepsExactlyTwentyFourBuckets(t *testing.T) {
	from := time.Date(2026, time.August, 1, 0, 0, 0, 0, time.UTC)
	to := from.Add(24 * time.Hour)

	intervals, labels := dashboardEvolutionIntervals(from, to, "hour")
	if len(intervals) != dashboardMaxEvolutionBucketCount || len(labels) != dashboardMaxEvolutionBucketCount {
		t.Fatalf("hourly evolution = %d intervals and %d labels", len(intervals), len(labels))
	}
}

func TestDashboardFunnelTotalIgnoresLeadsOutsideVisibleStages(t *testing.T) {
	stages := []PipelineBoardStage{{ID: "stage-a"}, {ID: "stage-b"}}
	counts := map[string]int64{
		"stage-a":       4,
		"stage-b":       6,
		"removed-stage": 90,
	}

	if total := dashboardVisibleFunnelTotal(stages, counts); total != 10 {
		t.Fatalf("visible funnel total = %d, want 10", total)
	}
}

func TestDashboardOpenAPIContractDocumentsAllTimeAndLazyDetails(t *testing.T) {
	raw, err := os.ReadFile("../../../../packages/contracts/openapi/v1.yaml")
	if err != nil {
		t.Fatalf("read OpenAPI contract: %v", err)
	}
	source := string(raw)

	statsRoute := dashboardContractSection(t, source, "  /v1/dashboard/stats:", "  /v1/dashboard/funnel:")
	if !strings.Contains(statsRoute, "DashboardIncludeDetails") {
		t.Fatal("dashboard stats route does not expose the lazy detail opt-in")
	}
	parameters := dashboardContractSection(t, source, "    DashboardDateFrom:", "    MarketingAnalyticsDateFrom:")
	for _, fragment := range []string{
		"Omit both dashboard dates to query all visible history",
		"name: includeDetails",
		"default: false",
		"Aggregate totals are always exact",
	} {
		if !strings.Contains(parameters, fragment) {
			t.Fatalf("dashboard parameter contract is missing %q", fragment)
		}
	}
	statsSchema := dashboardContractSection(t, source, "    DashboardStats:", "    WonConversionBucket:")
	for _, fragment := range []string{
		"- wonDealsTruncated",
		"- lostDealsTruncated",
		"Empty unless includeDetails=true",
	} {
		if !strings.Contains(statsSchema, fragment) {
			t.Fatalf("dashboard response contract is missing %q", fragment)
		}
	}
}

func dashboardContractSection(t *testing.T, source, startMarker, endMarker string) string {
	t.Helper()
	start := strings.Index(source, startMarker)
	if start < 0 {
		t.Fatalf("OpenAPI contract is missing %q", startMarker)
	}
	relativeEnd := strings.Index(source[start+len(startMarker):], endMarker)
	if relativeEnd < 0 {
		t.Fatalf("OpenAPI contract is missing %q after %q", endMarker, startMarker)
	}
	return source[start : start+len(startMarker)+relativeEnd]
}

func TestDashboardLostReasonSQLUsesTheCanonicalFiniteBuckets(t *testing.T) {
	expression := dashboardLostReasonKeySQL("l.lost_reason")
	for _, fragment := range []string{
		"translate(lower(btrim(coalesce(l.lost_reason, '')))",
		"then 'nao_respondeu'",
		"then 'sem_interesse'",
		"else 'outros'",
	} {
		if !strings.Contains(expression, fragment) {
			t.Fatalf("lost-reason SQL is missing %q: %s", fragment, expression)
		}
	}
}

func TestBuildLostReasonBucketsFromCountsKeepsExactTotals(t *testing.T) {
	counts := map[string]int64{"nao_respondeu": 3, "sem_interesse": 1, "outros": 2}
	buckets := buildLostReasonBucketsFromCounts(counts, 6)

	if len(buckets) != 3 {
		t.Fatalf("buckets = %d, want 3", len(buckets))
	}
	if buckets[0].Key != "nao_respondeu" || buckets[0].Count != 3 || buckets[0].Percentage != 50 {
		t.Fatalf("first bucket = %#v", buckets[0])
	}
	if len(counts) != 3 {
		t.Fatalf("input counts were mutated: %#v", counts)
	}
}
