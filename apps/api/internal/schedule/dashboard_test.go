package schedule

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestParseDashboardFilter(t *testing.T) {
	values := url.Values{
		"dateFrom":  {"2026-09-01"},
		"dateTo":    {"2026-09-08"},
		"teamId":    {"11111111-1111-4111-8111-111111111111"},
		"userId":    {"22222222-2222-4222-8222-222222222222"},
		"source":    {"Meta"},
		"eventType": {"VISIT"},
		"status":    {"COMPLETED"},
	}

	filter, err := ParseDashboardFilter(values)
	if err != nil {
		t.Fatalf("parse dashboard filter: %v", err)
	}
	if got := filter.DateFrom.Format(dashboardDateLayout); got != "2026-09-01" {
		t.Fatalf("dateFrom = %q", got)
	}
	if got := filter.DateTo.Format(dashboardDateLayout); got != "2026-09-08" {
		t.Fatalf("dateTo = %q", got)
	}
	if filter.DateBasis != DashboardDateBasisStartTime {
		t.Fatalf("default dateBasis = %q", filter.DateBasis)
	}
	if filter.TeamID != "11111111-1111-4111-8111-111111111111" || filter.UserID != "22222222-2222-4222-8222-222222222222" {
		t.Fatalf("unexpected normalized UUID filters: %#v", filter)
	}
	if filter.Source != "Meta" || filter.EventType != "visit" || filter.Status != "completed" {
		t.Fatalf("unexpected text filters: %#v", filter)
	}
}

func TestParseDashboardFilterRejectsInvalidInput(t *testing.T) {
	tests := []struct {
		name   string
		values url.Values
	}{
		{name: "missing start", values: url.Values{"dateTo": {"2026-09-08"}}},
		{name: "non canonical date", values: url.Values{"dateFrom": {"2026-9-1"}, "dateTo": {"2026-09-08"}}},
		{name: "reversed range", values: url.Values{"dateFrom": {"2026-09-09"}, "dateTo": {"2026-09-08"}}},
		{name: "oversized range", values: url.Values{"dateFrom": {"2020-01-01"}, "dateTo": {"2026-01-01"}}},
		{name: "invalid basis", values: url.Values{"dateFrom": {"2026-09-01"}, "dateTo": {"2026-09-08"}, "dateBasis": {"start_time; drop table"}}},
		{name: "invalid team", values: url.Values{"dateFrom": {"2026-09-01"}, "dateTo": {"2026-09-08"}, "teamId": {"not-a-uuid"}}},
		{name: "oversized source", values: url.Values{"dateFrom": {"2026-09-01"}, "dateTo": {"2026-09-08"}, "source": {strings.Repeat("á", 161)}}},
		{name: "invalid event type", values: url.Values{"dateFrom": {"2026-09-01"}, "dateTo": {"2026-09-08"}, "eventType": {"deal"}}},
		{name: "invalid status", values: url.Values{"dateFrom": {"2026-09-01"}, "dateTo": {"2026-09-08"}, "status": {"done"}}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := ParseDashboardFilter(test.values)
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("error = %v, want ErrInvalidInput", err)
			}
		})
	}
}

func TestParseDashboardEventsFilterDefaultsAndPagination(t *testing.T) {
	baseValues := func() url.Values {
		return url.Values{
			"dateFrom": {"2026-09-08"},
			"dateTo":   {"2026-09-08"},
		}
	}

	defaults, err := ParseDashboardEventsFilter(baseValues())
	if err != nil {
		t.Fatalf("parse dashboard events defaults: %v", err)
	}
	if defaults.Limit != defaultDashboardEventsLimit || defaults.Offset != 0 {
		t.Fatalf("default pagination = limit %d offset %d", defaults.Limit, defaults.Offset)
	}
	if defaults.DateBasis != DashboardDateBasisStartTime {
		t.Fatalf("dashboard filter was not preserved: %#v", defaults.DashboardFilter)
	}

	customValues := baseValues()
	customValues.Set("limit", "100")
	customValues.Set("offset", "40")
	custom, err := ParseDashboardEventsFilter(customValues)
	if err != nil {
		t.Fatalf("parse dashboard events custom pagination: %v", err)
	}
	if custom.Limit != 100 || custom.Offset != 40 {
		t.Fatalf("custom pagination = limit %d offset %d", custom.Limit, custom.Offset)
	}

	for _, test := range []struct {
		name  string
		key   string
		value string
	}{
		{name: "zero limit", key: "limit", value: "0"},
		{name: "limit above maximum", key: "limit", value: "101"},
		{name: "non numeric limit", key: "limit", value: "many"},
		{name: "negative offset", key: "offset", value: "-1"},
		{name: "non numeric offset", key: "offset", value: "next"},
	} {
		t.Run(test.name, func(t *testing.T) {
			values := baseValues()
			values.Set(test.key, test.value)
			_, parseErr := ParseDashboardEventsFilter(values)
			if !errors.Is(parseErr, ErrInvalidInput) {
				t.Fatalf("error = %v, want ErrInvalidInput", parseErr)
			}
		})
	}
}

func TestScheduleDashboardQueryUsesSafeScopedAggregates(t *testing.T) {
	filter, err := ParseDashboardFilter(url.Values{
		"dateFrom":  {"2026-09-01"},
		"dateTo":    {"2026-09-08"},
		"teamId":    {"11111111-1111-4111-8111-111111111111"},
		"userId":    {"22222222-2222-4222-8222-222222222222"},
		"source":    {"Meta' or true --"},
		"eventType": {"visit"},
		"status":    {"completed"},
	})
	if err != nil {
		t.Fatalf("parse dashboard filter: %v", err)
	}
	tenantContext := tenant.Context{
		OrganizationID: "33333333-3333-4333-8333-333333333333",
		UserID:         "44444444-4444-4444-8444-444444444444",
		MemberRole:     "user",
		Permissions: []string{
			permissions.ScheduleView,
			permissions.LeadViewOwn,
			permissions.LeadViewTeam,
		},
	}

	query, args, err := buildScheduleDashboardQuery(tenantContext, filter)
	if err != nil {
		t.Fatalf("build dashboard query: %v", err)
	}
	for _, fragment := range []string{
		"public.organization_attention_settings",
		"organization_settings.timezone",
		"'America/Sao_Paulo'",
		"se.start_time >= bounds.from_at",
		"se.start_time < bounds.to_at",
		"schedule_event_assignees dashboard_assignee",
		"schedule_event_assignees dashboard_team_assignee",
		"dashboard_team_member.is_active = true",
		"se.team_id is null",
		"filtered_events as materialized",
		"se.end_time < bounds.as_of",
		"se.start_time >= bounds.as_of",
		"count(*) filter (where status = 'scheduled')::bigint as open",
		"overdue_owner_rows as (",
		"performer_ranking_rows as (",
		"coalesce(membership.is_active, false) = true",
		"and member.user_id = users.id",
		"and coalesce(member.is_active, false) = true",
		"and coalesce(leader.is_leader, false) = true",
		"selected_team_member.team_id = $10::uuid",
		"event_responsibilities as materialized (",
		"select filtered_events.id as event_id, filtered_events.user_id",
		"join public.schedule_event_assignees assignee",
		"se.team_id",
		"join filtered_events responsibility_event",
		"responsibility_event.team_id = $10::uuid",
		"responsibility_event.team_id is null",
		"scoped_responsibilities as materialized (",
		"where ($9::uuid is null or event_responsibilities.user_id = $9::uuid)",
		"responsibility_team_member.team_id = $10::uuid",
		"select user_id from scoped_responsibilities",
		"join filtered_events on filtered_events.id = scoped_responsibilities.event_id",
		"group by scoped_responsibilities.user_id",
		"where status = 'completed'",
		"round((totals.completed::numeric * 100) / totals.eligible, 2)",
		"round((totals.no_show::numeric * 100) / totals.appointment_eligible, 2)",
		"count(*) filter (where status = 'no_show' and event_type in ('visit', 'meeting'))::bigint as no_show",
		"coalesce(responsible_counts.eligible, 0)::bigint as eligible",
		"coalesce(responsible_counts.appointment_eligible, 0)::bigint as appointment_eligible",
		"generate_series(0, bounds.date_to - bounds.date_from) as generated(day_offset)",
	} {
		if !strings.Contains(query, fragment) {
			t.Fatalf("dashboard query missing %q", fragment)
		}
	}
	for _, obsoleteFragment := range []string{
		"weekly_rows as (",
		"by_outcome_rows as (",
		"top_performer_rows as (",
		"scheduler_ranking_rows as (",
		"upcoming_event_rows as (",
	} {
		if strings.Contains(query, obsoleteFragment) {
			t.Fatalf("dashboard query still computes removed panel data %q", obsoleteFragment)
		}
	}
	if !strings.Contains(query, scheduleEventListScopeSQL("$2", "$3")) {
		t.Fatal("dashboard must reuse the Agenda event visibility scope")
	}
	if !strings.Contains(query, scheduleEventListLeadVisibilitySQL("$3", "$2", "$4", "$5", "$6", true)) {
		t.Fatal("dashboard must reuse the Agenda lead visibility scope")
	}
	if !strings.Contains(query, "coalesce(se.visibility, 'default') <> 'private'") {
		t.Fatal("team-leader detail access must not expose private events")
	}
	if strings.Contains(query, filter.Source) {
		t.Fatal("source filter must be parameterized")
	}
	if strings.Contains(query, "membership.deleted_at") {
		t.Fatal("dashboard must not depend on organization_members.deleted_at, which is absent from the production baseline")
	}
	if strings.Contains(query, "coalesce(se.created_by, se.user_id)") || strings.Contains(query, "coalesce(created_by, user_id)") {
		t.Fatal("scheduler authorship must never fall back to the responsible user")
	}
	if strings.Contains(query, "union all\n\t\t\tselect filtered_events.id as event_id, assignee.user_id") {
		t.Fatal("primary and additional responsibility rows must be deduplicated per event/user")
	}
	guardedNoShowAggregates := strings.Count(query, "status = 'no_show' and event_type in ('visit', 'meeting')") +
		strings.Count(query, "filtered_events.status = 'no_show'\n\t\t\t\t\t  and filtered_events.event_type in ('visit', 'meeting')")
	if guardedNoShowAggregates < 2 {
		t.Fatalf("no-show totals/ranking must exclude invalid legacy activity types, found %d guarded aggregates", guardedNoShowAggregates)
	}
	if count := strings.Count(query, "filtered_events.event_type in ('visit', 'meeting')"); count < 2 {
		t.Fatalf("daily/weekly no-show series must exclude invalid legacy activity types, found %d guarded aggregates", count)
	}
	if len(args) != 13 || args[11] != filter.EventType || args[12] != filter.Status {
		t.Fatalf("unexpected query args: %#v", args)
	}
	assertEveryPositionalArgumentIsUsed(t, query, args)
	if args[10] != filter.Source {
		t.Fatalf("source argument = %#v", args[10])
	}
	if args[8] != filter.UserID || args[9] != filter.TeamID {
		t.Fatalf("roster scope arguments = %#v, %#v", args[8], args[9])
	}
}

func TestScheduleDashboardQueryBuildsHourlySeriesOnlyForOneDay(t *testing.T) {
	tenantContext := tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		MemberRole:     "admin",
	}

	query, _, err := buildScheduleDashboardQuery(tenantContext, DashboardFilter{
		DateFrom:  time.Date(2026, time.September, 8, 0, 0, 0, 0, time.UTC),
		DateTo:    time.Date(2026, time.September, 8, 0, 0, 0, 0, time.UTC),
		DateBasis: DashboardDateBasisStartTime,
	})
	if err != nil {
		t.Fatalf("build single-day dashboard query: %v", err)
	}
	for _, fragment := range []string{
		"generate_series(0, 23) as generated(hour)",
		"where bounds.date_from = bounds.date_to",
		"extract(hour from (se.start_time at time zone bounds.report_timezone))::integer as report_hour",
		"left join filtered_events on filtered_events.report_hour = hours.report_hour",
		"'hourly', coalesce((",
		"'hour', hourly_rows.report_hour",
		"'no_show', hourly_rows.no_show",
	} {
		if !strings.Contains(query, fragment) {
			t.Fatalf("hourly dashboard query missing %q", fragment)
		}
	}
	if count := strings.Count(query, "hours.report_hour"); count < 3 {
		t.Fatalf("hourly query must zero-fill and order all generated hours, found %d references", count)
	}
}

func TestScheduleDashboardEventsQueryReusesDashboardScopeAndListsEntirePeriod(t *testing.T) {
	values := url.Values{
		"dateFrom":  {"2026-09-01"},
		"dateTo":    {"2026-09-30"},
		"dateBasis": {"created_at"},
		"teamId":    {"11111111-1111-4111-8111-111111111111"},
		"userId":    {"22222222-2222-4222-8222-222222222222"},
		"source":    {"Meta' or true --"},
		"eventType": {"meeting"},
		"status":    {"overdue"},
		"limit":     {"35"},
		"offset":    {"70"},
	}
	filter, err := ParseDashboardEventsFilter(values)
	if err != nil {
		t.Fatalf("parse dashboard events filter: %v", err)
	}
	tenantContext := tenant.Context{
		OrganizationID: "33333333-3333-4333-8333-333333333333",
		UserID:         "44444444-4444-4444-8444-444444444444",
		MemberRole:     "user",
		Permissions: []string{
			permissions.ScheduleView,
			permissions.LeadViewOwn,
			permissions.LeadViewTeam,
		},
	}

	dashboardQuery, dashboardArgs, err := buildScheduleDashboardQuery(tenantContext, filter.DashboardFilter)
	if err != nil {
		t.Fatalf("build dashboard query: %v", err)
	}
	eventsQuery, eventsArgs, err := buildScheduleDashboardEventsQuery(tenantContext, filter)
	if err != nil {
		t.Fatalf("build dashboard events query: %v", err)
	}
	if len(eventsArgs) != len(dashboardArgs)+6 {
		t.Fatalf("events args = %d, dashboard args = %d", len(eventsArgs), len(dashboardArgs))
	}
	if !reflect.DeepEqual(eventsArgs[:len(dashboardArgs)], dashboardArgs) {
		t.Fatalf("dashboard/event shared args diverged:\n dashboard=%#v\n events=%#v", dashboardArgs, eventsArgs)
	}
	if got := eventsArgs[len(eventsArgs)-2:]; !reflect.DeepEqual(got, []any{35, 70}) {
		t.Fatalf("pagination args = %#v", got)
	}
	assertEveryPositionalArgumentIsUsed(t, dashboardQuery, dashboardArgs)
	assertEveryPositionalArgumentIsUsed(t, eventsQuery, eventsArgs)

	for _, fragment := range []string{
		"filtered_events as materialized (",
		"left(coalesce(nullif(btrim(se.title), ''), 'Compromisso'), 255) as title",
		"when lower(btrim(se.event_type)) in ('call', 'email', 'meeting', 'task', 'message', 'visit')",
		"case coalesce(nullif(lower(btrim(se.status)), ''), 'scheduled')",
		"when lower(btrim(se.outcome)) in (",
		"coalesce(se.is_all_day, false) as is_all_day",
		"se.created_at >= bounds.from_at",
		"se.created_at < bounds.to_at",
		"schedule_event_assignees dashboard_assignee",
		"schedule_event_assignees dashboard_team_assignee",
		"coalesce(se.visibility, 'default') <> 'private'",
		"se.end_time < bounds.as_of",
		"filtered_events.status",
		"filtered_events.outcome",
		"filtered_events.is_overdue",
		"order by filtered_events.start_time asc, filtered_events.id asc",
		"'items', coalesce((",
		"'total', page_totals.total",
		"'has_more'",
	} {
		if !strings.Contains(eventsQuery, fragment) {
			t.Fatalf("dashboard events query missing %q", fragment)
		}
	}
	if strings.Contains(eventsQuery, "where filtered_events.is_upcoming") {
		t.Fatal("dashboard events endpoint must list the whole selected period, not only future events")
	}
	if strings.Contains(eventsQuery, filter.Source) {
		t.Fatal("dashboard events source filter must remain parameterized")
	}
	if strings.Count(eventsQuery, "filtered_events as materialized (") != 1 || strings.Count(dashboardQuery, "filtered_events as materialized (") != 1 {
		t.Fatal("both dashboard queries must be built from the shared filtered event CTE")
	}
}

func TestScheduleDashboardResponsibleMetricsUseUniqueScopedParticipants(t *testing.T) {
	filter, err := ParseDashboardFilter(url.Values{
		"dateFrom": {"2026-09-01"},
		"dateTo":   {"2026-09-30"},
		"teamId":   {"11111111-1111-4111-8111-111111111111"},
		"userId":   {"22222222-2222-4222-8222-222222222222"},
	})
	if err != nil {
		t.Fatalf("parse dashboard filter: %v", err)
	}

	query, _, err := buildScheduleDashboardQuery(tenant.Context{
		OrganizationID: "33333333-3333-4333-8333-333333333333",
		UserID:         "44444444-4444-4444-8444-444444444444",
		MemberRole:     "admin",
	}, filter)
	if err != nil {
		t.Fatalf("build dashboard query: %v", err)
	}

	responsibilitiesStart := strings.Index(query, "event_responsibilities as materialized (")
	responsibilitiesEnd := strings.Index(query, "responsible_user_ids as (")
	if responsibilitiesStart < 0 || responsibilitiesEnd <= responsibilitiesStart {
		t.Fatal("dashboard query is missing the responsibility expansion")
	}
	responsibilities := query[responsibilitiesStart:responsibilitiesEnd]
	for _, fragment := range []string{
		"select filtered_events.id as event_id, filtered_events.user_id",
		"union",
		"select filtered_events.id as event_id, assignee.user_id",
		"assignee.organization_id = filtered_events.organization_id",
		"assignee.event_id = filtered_events.id",
		"$9::uuid is null or event_responsibilities.user_id = $9::uuid",
		"responsibility_team_member.team_id = $10::uuid",
		"responsibility_team_member.user_id = event_responsibilities.user_id",
		"coalesce(responsibility_team_member.is_active, false) = true",
	} {
		if !strings.Contains(responsibilities, fragment) {
			t.Fatalf("responsibility expansion missing %q", fragment)
		}
	}
	if strings.Contains(responsibilities, "union all") {
		t.Fatal("an event must count only once when its primary user is also an assignee")
	}

	countsStart := strings.Index(query, "responsible_counts as (")
	countsEnd := strings.Index(query, "performer_ranking_rows as (")
	if countsStart < 0 || countsEnd <= countsStart {
		t.Fatal("dashboard query is missing responsible counts")
	}
	counts := query[countsStart:countsEnd]
	if !strings.Contains(counts, "from scoped_responsibilities") ||
		!strings.Contains(counts, "join filtered_events on filtered_events.id = scoped_responsibilities.event_id") ||
		!strings.Contains(counts, "group by scoped_responsibilities.user_id") ||
		!strings.Contains(counts, "filtered_events.status = 'no_show'") ||
		!strings.Contains(counts, "filtered_events.event_type in ('visit', 'meeting')") {
		t.Fatal("responsible metrics must aggregate the filtered event once for every scoped participant")
	}

	totalsStart := strings.Index(query, "totals as (")
	totalsEnd := strings.Index(query, "daily_rows as (")
	if totalsStart < 0 || totalsEnd <= totalsStart {
		t.Fatal("dashboard query is missing event totals")
	}
	totals := query[totalsStart:totalsEnd]
	if !strings.Contains(totals, "from filtered_events") || strings.Contains(totals, "scoped_responsibilities") {
		t.Fatal("global KPIs must remain event-based and must not be multiplied by co-responsibility")
	}

}

func TestScheduleDashboardVirtualStatusFiltersUseEndAndStartBoundaries(t *testing.T) {
	tenantContext := tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		MemberRole:     "admin",
	}
	for _, test := range []struct {
		status   string
		fragment string
	}{
		{status: "overdue", fragment: "when coalesce(se.is_all_day, false) then"},
		{status: "upcoming", fragment: "se.start_time >= bounds.as_of"},
	} {
		t.Run(test.status, func(t *testing.T) {
			filter, err := ParseDashboardFilter(url.Values{
				"dateFrom": {"2026-09-01"},
				"dateTo":   {"2026-09-30"},
				"status":   {test.status},
			})
			if err != nil {
				t.Fatalf("parse dashboard filter: %v", err)
			}
			query, args, err := buildScheduleDashboardQuery(tenantContext, filter)
			if err != nil {
				t.Fatalf("build dashboard query: %v", err)
			}
			if !strings.Contains(query, test.fragment) {
				t.Fatalf("%s filter missing %q", test.status, test.fragment)
			}
			if strings.Contains(query, "se.start_time < bounds.as_of") {
				t.Fatal("overdue must not classify an in-progress event from its start time")
			}
			if test.status == "overdue" {
				if count := strings.Count(query, "se.status = 'scheduled'"); count < 2 {
					t.Fatalf("overdue status must match the canonical partial-index predicate, found %d direct comparisons", count)
				}
				if count := strings.Count(query, "when coalesce(se.is_all_day, false) then"); count != 2 {
					t.Fatalf("all-day overdue CASE must guard both the virtual filter and is_overdue, found %d uses", count)
				}
				for _, allDayFragment := range []string{
					"(se.end_time at time zone bounds.report_timezone)::date",
					"(bounds.as_of at time zone bounds.report_timezone)::date",
					"else se.end_time < bounds.as_of",
				} {
					if count := strings.Count(query, allDayFragment); count != 2 {
						t.Fatalf("all-day overdue predicate must use %q in both SQL paths, found %d uses", allDayFragment, count)
					}
				}
			}
			for _, arg := range args {
				if arg == test.status {
					t.Fatalf("virtual status %q must compile to trusted SQL, not a persisted status argument", test.status)
				}
			}
		})
	}
}

func TestScheduleDashboardQuerySupportsEveryDateBasis(t *testing.T) {
	tenantContext := tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		MemberRole:     "admin",
	}
	for _, test := range []struct {
		basis      DashboardDateBasis
		expression string
	}{
		{basis: DashboardDateBasisStartTime, expression: "se.start_time"},
		{basis: DashboardDateBasisCreatedAt, expression: "se.created_at"},
		{basis: DashboardDateBasisCompletedAt, expression: "coalesce(se.outcome_recorded_at, se.completed_at)"},
	} {
		t.Run(string(test.basis), func(t *testing.T) {
			query, _, err := buildScheduleDashboardQuery(tenantContext, DashboardFilter{
				DateFrom:  time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC),
				DateTo:    time.Date(2026, time.September, 8, 0, 0, 0, 0, time.UTC),
				DateBasis: test.basis,
			})
			if err != nil {
				t.Fatalf("build dashboard query: %v", err)
			}
			if !strings.Contains(query, test.expression+" >= bounds.from_at") || !strings.Contains(query, test.expression+" < bounds.to_at") {
				t.Fatalf("query does not use %s as its half-open date basis", test.expression)
			}
		})
	}
}

func TestScheduleDashboardNoneSourceAndCancelledAliases(t *testing.T) {
	filter, err := ParseDashboardFilter(url.Values{
		"dateFrom": {"2026-09-08"},
		"dateTo":   {"2026-09-08"},
		"source":   {"__none__"},
		"status":   {"canceled"},
	})
	if err != nil {
		t.Fatalf("parse dashboard filter: %v", err)
	}
	query, _, err := buildScheduleDashboardQuery(tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		MemberRole:     "admin",
	}, filter)
	if err != nil {
		t.Fatalf("build dashboard query: %v", err)
	}
	if !strings.Contains(query, "coalesce(nullif(btrim(se.lead_source_snapshot), ''), left(nullif(btrim(l.source), ''), 160), '__none__') = '__none__'") {
		t.Fatal("__none__ must include events without a lead or without a lead source")
	}
	if !strings.Contains(query, "lower(btrim(se.status)) in ('cancelled', 'canceled')") {
		t.Fatal("cancelled KPI/filter must include both persisted spellings")
	}
}

func TestScheduleDashboardResponseContract(t *testing.T) {
	report := DashboardReport{
		ReportTimezone: "America/Sao_Paulo",
		Period: DashboardPeriod{
			DateFrom:  "2026-09-01",
			DateTo:    "2026-09-08",
			DateBasis: DashboardDateBasisStartTime,
		},
		Daily:            []DashboardDailyPoint{},
		Hourly:           []DashboardHourlyPoint{},
		Weekly:           []DashboardWeeklyPoint{},
		ByType:           []DashboardCount{},
		BySource:         []DashboardSourceCount{},
		ByOutcome:        []DashboardCount{},
		UpcomingEvents:   []DashboardUpcomingEvent{},
		OverdueByOwner:   []DashboardOverdueOwner{},
		PerformerRanking: []DashboardPerformerRanking{},
		TopPerformers:    []DashboardTopPerformer{},
	}
	payload, err := json.Marshal(Envelope[DashboardReport]{Data: report})
	if err != nil {
		t.Fatalf("marshal dashboard response: %v", err)
	}
	serialized := string(payload)
	for _, key := range []string{
		`"report_timezone"`, `"period"`, `"date_from"`, `"date_to"`, `"date_basis"`,
		`"kpis"`, `"eligible"`, `"appointment_eligible"`, `"open"`, `"overdue"`,
		`"upcoming"`, `"completion_rate"`, `"no_show_rate"`, `"daily"`, `"hourly"`, `"weekly"`, `"by_type"`, `"by_source"`,
		`"by_outcome"`, `"upcoming_events"`, `"overdue_by_owner"`,
		`"performer_ranking"`, `"top_performers"`,
	} {
		if !strings.Contains(serialized, key) {
			t.Fatalf("dashboard response missing %s: %s", key, serialized)
		}
	}
	for _, removedKey := range []string{
		`"scheduler_authorship"`,
		`"scheduler_ranking"`,
	} {
		if strings.Contains(serialized, removedKey) {
			t.Fatalf("dashboard response still exposes removed authorship field %s: %s", removedKey, serialized)
		}
	}
}

func TestScheduleDashboardEventsResponseContract(t *testing.T) {
	outcome := "visit_completed"
	page := DashboardEventsPage{
		Items: []DashboardEventItem{{
			ID:        "11111111-1111-4111-8111-111111111111",
			Title:     "Visita",
			EventType: "visit",
			StartTime: time.Date(2026, time.September, 8, 14, 0, 0, 0, time.UTC),
			EndTime:   time.Date(2026, time.September, 8, 15, 0, 0, 0, time.UTC),
			IsAllDay:  false,
			UserID:    "22222222-2222-4222-8222-222222222222",
			UserName:  "Corretora",
			Status:    "completed",
			Outcome:   &outcome,
			IsOverdue: false,
		}},
		Total:   42,
		Limit:   20,
		Offset:  20,
		HasMore: true,
	}
	payload, err := json.Marshal(Envelope[DashboardEventsPage]{Data: page})
	if err != nil {
		t.Fatalf("marshal dashboard events response: %v", err)
	}
	serialized := string(payload)
	for _, key := range []string{
		`"items"`, `"total"`, `"limit"`, `"offset"`, `"has_more"`,
		`"id"`, `"title"`, `"event_type"`, `"start_time"`, `"end_time"`, `"is_all_day"`,
		`"user_id"`, `"user_name"`, `"user_avatar_url"`,
		`"lead_id"`, `"lead_name"`, `"property_id"`, `"property_title"`, `"property_code"`,
		`"status"`, `"outcome"`, `"is_overdue"`,
	} {
		if !strings.Contains(serialized, key) {
			t.Fatalf("dashboard events response missing %s: %s", key, serialized)
		}
	}
}

func TestScheduleDashboardNormalizesEmptyCollections(t *testing.T) {
	report := DashboardReport{}
	report.normalizeCollections()
	if report.Daily == nil || report.Hourly == nil || report.Weekly == nil {
		t.Fatal("dashboard time-series collections must normalize to empty arrays")
	}

	page := DashboardEventsPage{}
	page.normalizeCollections()
	if page.Items == nil {
		t.Fatal("dashboard events items must normalize to an empty array")
	}
}

func assertEveryPositionalArgumentIsUsed(t *testing.T, query string, args []any) {
	t.Helper()
	used := make(map[int]bool, len(args))
	for _, match := range regexp.MustCompile(`\$(\d+)`).FindAllStringSubmatch(query, -1) {
		index, err := strconv.Atoi(match[1])
		if err != nil {
			t.Fatalf("parse query placeholder %q: %v", match[0], err)
		}
		used[index] = true
	}
	for index := 1; index <= len(args); index++ {
		if !used[index] {
			t.Fatalf("query does not use positional argument %s", fmt.Sprintf("$%d", index))
		}
	}
}
