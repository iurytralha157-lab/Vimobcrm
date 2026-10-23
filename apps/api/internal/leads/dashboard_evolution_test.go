package leads

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestDashboardEvolutionCivilMidnightPreservesLateEveningLead(t *testing.T) {
	location, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		t.Fatal(err)
	}
	// These are the actual ISO instants sent by the browser for local midnights.
	from, _ := time.Parse(time.RFC3339, "2026-10-08T03:00:00Z")
	to, _ := time.Parse(time.RFC3339, "2026-10-15T03:00:00Z")
	intervals, labels := dashboardEvolutionIntervals(from.In(location), to.In(location), "day")
	if len(intervals) != 7 || labels[0] != "08/10" {
		t.Fatalf("buckets = %v / %v", intervals, labels)
	}
	if got := intervals[1].UTC().Format(time.RFC3339); got != "2026-10-09T03:00:00Z" {
		t.Fatalf("next civil midnight = %s", got)
	}
	evening, _ := time.Parse(time.RFC3339, "2026-10-09T01:00:00Z") // Oct 8, 22:00 local
	if !evening.Before(intervals[1]) {
		t.Fatal("the actual SQL CASE would move a late-evening lead into the next civil day")
	}
}

func TestDashboardHourlyEvolutionLabelsActualStartAndFractionalTimezone(t *testing.T) {
	for _, timezone := range []string{"America/Sao_Paulo", "Asia/Kathmandu"} {
		t.Run(timezone, func(t *testing.T) {
			location, err := time.LoadLocation(timezone)
			if err != nil {
				t.Fatal(err)
			}
			from := time.Date(2026, 10, 8, 10, 37, 0, 0, location)
			intervals, labels := dashboardEvolutionIntervals(from, from.Add(68*time.Minute), "hour")
			if len(intervals) != 2 || labels[0] != "10:00" || labels[1] != "11:00" || intervals[0].Minute() != 0 {
				t.Fatalf("partial-day buckets = %v / %v", intervals, labels)
			}
		})
	}
}

func TestDashboardEvolutionDSTDayHasCorrectBoundariesAndDistinctRepeatedHours(t *testing.T) {
	location, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	from := time.Date(2026, 3, 8, 0, 0, 0, 0, location)
	intervals, labels := dashboardEvolutionIntervals(from, from.AddDate(0, 0, 1), "hour")
	if len(intervals) != 23 {
		t.Fatalf("spring day = %d buckets", len(intervals))
	}
	for _, label := range labels {
		if label == "02:00" {
			t.Fatal("nonexistent civil hour must not be synthesized")
		}
	}
	from = time.Date(2026, 11, 1, 0, 0, 0, 0, location)
	intervals, labels = dashboardEvolutionIntervals(from, from.AddDate(0, 0, 1), "hour")
	if len(intervals) > dashboardMaxEvolutionBucketCount || len(intervals) != len(labels) {
		t.Fatal("fall day must keep bounded labeled ranges")
	}
	if !strings.Contains(labels[0], "01:59") || !intervals[1].After(intervals[0]) {
		t.Fatalf("fall compressed ranges = %v", labels)
	}
}

func TestDashboardGoCalendarNormalizationRegressionFacts(t *testing.T) {
	saoPaulo, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2018, 11, 3, 0, 0, 0, 0, saoPaulo)
	next := start.AddDate(0, 0, 1)
	if next.Day() != 3 || next.Hour() != 23 {
		t.Fatalf("expected the missing midnight to normalize backwards, got %v", next)
	}
	t.Logf("Go Sao Paulo: %v + one calendar day = %v", start, next)
	apia, err := time.LoadLocation("Pacific/Apia")
	if err != nil {
		t.Fatal(err)
	}
	start = time.Date(2011, 12, 29, 0, 0, 0, 0, apia)
	next = start.AddDate(0, 0, 1)
	if !next.Equal(start) {
		t.Fatalf("expected the skipped civil day not to advance AddDate, got %v", next)
	}
	t.Logf("Go Apia: %v + one calendar day = %v (same instant)", start, next)
}

func TestDashboardEvolutionUsesFirstRealMidnightWithoutCarryingDSTHour(t *testing.T) {
	location, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		t.Fatal(err)
	}
	from := time.Date(2018, 11, 3, 0, 0, 0, 0, location)
	to := time.Date(2018, 11, 6, 0, 0, 0, 0, location)
	intervals, labels := dashboardEvolutionIntervals(from, to, "day")
	wantLabels := []string{"03/11", "04/11", "05/11"}
	wantInstants := []string{"2018-11-03T03:00:00Z", "2018-11-04T03:00:00Z", "2018-11-05T02:00:00Z"}
	if len(intervals) != len(wantLabels) {
		t.Fatalf("DST civil buckets = %v / %v", intervals, labels)
	}
	for index := range intervals {
		if labels[index] != wantLabels[index] || intervals[index].UTC().Format(time.RFC3339) != wantInstants[index] {
			t.Fatalf("DST bucket %d = %v / %q", index, intervals[index], labels[index])
		}
	}
	lateEvening := time.Date(2018, 11, 4, 23, 30, 0, 0, location)
	if !lateEvening.Before(intervals[2]) || lateEvening.Before(intervals[1]) {
		t.Fatal("the SQL CASE must keep late evening in the actual November 4 bucket")
	}
}

func TestDashboardEvolutionSkippedDayAdvancesWithoutPhantomBucket(t *testing.T) {
	location, err := time.LoadLocation("Pacific/Apia")
	if err != nil {
		t.Fatal(err)
	}
	from := time.Date(2011, 12, 29, 0, 0, 0, 0, location)
	to := time.Date(2012, 1, 1, 0, 0, 0, 0, location)
	intervals, labels := dashboardEvolutionIntervals(from, to, "day")
	if len(intervals) != 2 || labels[0] != "29/12" || labels[1] != "31/12" || !intervals[1].After(intervals[0]) {
		t.Fatalf("skipped civil day = %v / %v", intervals, labels)
	}
	if intervals[1].UTC().Format(time.RFC3339) != "2011-12-30T10:00:00Z" {
		t.Fatalf("first instant after the skipped date = %v", intervals[1])
	}
}

func TestDashboardEvolutionGeneratesOnlyItsBoundedBudget(t *testing.T) {
	from := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	to := from.AddDate(5, 0, 0)
	for _, granularity := range []string{"hour", "day", "week", "month"} {
		intervals, labels := dashboardEvolutionIntervals(from, to, granularity)
		if len(intervals) == 0 || len(intervals) > dashboardMaxEvolutionBucketCount || cap(intervals) > dashboardMaxEvolutionBucketCount || len(labels) != len(intervals) {
			t.Fatalf("%s allocation budget = len %d cap %d labels %d", granularity, len(intervals), cap(intervals), len(labels))
		}
		for index, interval := range intervals {
			if !interval.Before(to) || (index > 0 && !interval.After(intervals[index-1])) {
				t.Fatalf("%s bucket %d does not advance: %v", granularity, index, intervals)
			}
		}
	}
}

func TestDashboardEvolutionCompressedLabelsExposeFullDateRangesAndYears(t *testing.T) {
	from := time.Date(2025, 12, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 1, 3, 0, 0, 0, 0, time.UTC)
	intervals, labels := dashboardEvolutionIntervals(from, to, "day")
	if len(intervals) > dashboardMaxEvolutionBucketCount || !strings.Contains(labels[0], "–") || !strings.Contains(labels[0], "2025") || !strings.Contains(labels[len(labels)-1], "2026") {
		t.Fatalf("compressed labels = %v", labels)
	}
	_, labels = dashboardEvolutionIntervals(from, to, "month")
	if labels[0] != "Dez 2025" || labels[1] != "Jan 2026" {
		t.Fatalf("monthly labels = %v", labels)
	}
}

func TestDashboardTextFiltersPreserveLongUnicodeHistoricalOrigins(t *testing.T) {
	source := strings.Repeat("ã", 500)
	filter, err := ParseDashboardFilter(url.Values{"source": {source}, "campaignId": {strings.Repeat("á", 255)}, "searchQuery": {strings.Repeat("é", 180)}})
	if err != nil || filter.Source != source {
		t.Fatalf("unicode filters = %#v / %v", filter, err)
	}
	_, err = ParseDashboardFilter(url.Values{"source": {strings.Repeat("ã", maxDashboardSourceLength+1)}})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatal("origin request must remain bounded")
	}
}

func TestDashboardOnlyManagementCanIncludeUnassignedCards(t *testing.T) {
	for _, viewer := range []tenant.Context{
		{MemberRole: "admin"},
		{MemberRole: "manager", Permissions: []string{permissions.LeadViewAll}},
		{MemberRole: "member", IsTeamLeader: true, Permissions: []string{permissions.LeadViewTeam}},
		{MemberRole: "member", Permissions: []string{permissions.LeadViewOwn}},
	} {
		where, _, err := (Repository{}).buildDashboardLeadWhere(viewer, DashboardFilter{}, dashboardLeadWhereOptions{})
		if err != nil {
			t.Fatal(err)
		}
		strict := false
		for _, clause := range where {
			if clause == "l.assigned_user_id is not null" {
				strict = true
			}
		}
		if strict == canViewAllLeads(viewer) {
			t.Fatalf("unassigned scope = %v for %v", strict, viewer.MemberRole)
		}
	}
}

type dashboardAggregateRecordingQuery struct {
	calls int
	sql   string
}

func (query *dashboardAggregateRecordingQuery) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("unexpected rows query")
}
func (query *dashboardAggregateRecordingQuery) QueryRow(_ context.Context, sql string, _ ...any) pgx.Row {
	query.calls++
	query.sql = sql
	return dashboardAggregateFixtureRow{}
}

type dashboardAggregateFixtureRow struct{}

func (dashboardAggregateFixtureRow) Scan(targets ...any) error {
	if len(targets) != 5 {
		return errors.New("aggregate must return all four status counts and the response average")
	}
	for index, value := range []int64{10, 6, 3, 1} {
		*targets[index].(*int64) = value
	}
	*targets[4].(*pgtype.Float8) = pgtype.Float8{}
	return nil
}

func TestDashboardPreviousStatusCountsShareOneAggregateQuery(t *testing.T) {
	query := &dashboardAggregateRecordingQuery{}
	result, err := (Repository{}).dashboardAggregate(context.Background(), query, tenant.Context{MemberRole: "admin"}, DashboardFilter{}, dashboardLeadWhereOptions{DateColumn: "created_at"})
	if err != nil {
		t.Fatal(err)
	}
	if query.calls != 1 || result.Total != 10 || result.Open != 6 || result.Lost != 3 || result.Won != 1 || !strings.Contains(query.sql, "where l.deal_status = 'won'") {
		t.Fatalf("aggregate = %#v, calls = %d", result, query.calls)
	}
}
