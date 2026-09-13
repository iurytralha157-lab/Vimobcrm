package leads

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestBuildPipelineLeadWhereMetaFiltersMatchIDOrName(t *testing.T) {
	tenantContext := tenant.Context{
		UserID:         "10000000-0000-0000-0000-000000000001",
		OrganizationID: "20000000-0000-0000-0000-000000000001",
		MemberRole:     "admin",
	}

	where, args, err := buildPipelineLeadWhere(tenantContext, PipelineBoardFilter{
		FilterCampaign: "campaign-alpha",
		FilterAdSet:    "adset-alpha",
		FilterAd:       "ad-alpha",
	})
	if err != nil {
		t.Fatalf("buildPipelineLeadWhere() error = %v", err)
	}

	joined := strings.Join(where, "\n")
	for _, want := range []string{
		"from public.lead_entry_events entry",
		"entry.is_countable = true",
		"entry.campaign_id = $",
		"entry.campaign_name = $",
		"l.meta_campaign_id = $",
		"l.utm_campaign = $",
		"lm.campaign_id = $",
		"lm.campaign_name = $",
		"l.meta_adset_id = $",
		"lm.adset_id = $",
		"lm.adset_name = $",
		"l.meta_ad_id = $",
		"lm.ad_id = $",
		"lm.ad_name = $",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("buildPipelineLeadWhere() SQL missing %q in:\n%s", want, joined)
		}
	}
	if got := args[len(args)-3:]; got[0] != "campaign-alpha" || got[1] != "adset-alpha" || got[2] != "ad-alpha" {
		t.Fatalf("buildPipelineLeadWhere() meta args = %#v", got)
	}
}

func TestBuildDashboardLeadWhereMetaFiltersMatchIDOrName(t *testing.T) {
	tenantContext := tenant.Context{
		UserID:         "10000000-0000-0000-0000-000000000001",
		OrganizationID: "20000000-0000-0000-0000-000000000001",
		MemberRole:     "admin",
	}

	where, args, err := (Repository{}).buildDashboardLeadWhere(tenantContext, DashboardFilter{
		CampaignID: "campaign-alpha",
		AdSetID:    "adset-alpha",
		AdID:       "ad-alpha",
	}, dashboardLeadWhereOptions{})
	if err != nil {
		t.Fatalf("buildDashboardLeadWhere() error = %v", err)
	}

	joined := strings.Join(where, "\n")
	for _, want := range []string{
		"from public.lead_entry_events entry",
		"entry.is_countable = true",
		"entry.campaign_id = $",
		"entry.campaign_name = $",
		"l.meta_campaign_id = $",
		"l.utm_campaign = $",
		"dlm.campaign_id = $",
		"dlm.campaign_name = $",
		"l.meta_adset_id = $",
		"dlm.adset_id = $",
		"dlm.adset_name = $",
		"l.meta_ad_id = $",
		"dlm.ad_id = $",
		"dlm.ad_name = $",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("buildDashboardLeadWhere() SQL missing %q in:\n%s", want, joined)
		}
	}
	if got := args[len(args)-3:]; got[0] != "campaign-alpha" || got[1] != "adset-alpha" || got[2] != "ad-alpha" {
		t.Fatalf("buildDashboardLeadWhere() meta args = %#v", got)
	}
}

func TestBuildPipelineLeadWhereOperationalDateIsIndependentFromAttribution(t *testing.T) {
	tenantContext := tenant.Context{
		UserID:         "10000000-0000-0000-0000-000000000001",
		OrganizationID: "20000000-0000-0000-0000-000000000001",
		MemberRole:     "admin",
	}
	dateFrom := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	dateTo := time.Date(2026, 7, 31, 23, 59, 59, 0, time.UTC)

	where, _, err := buildPipelineLeadWhere(tenantContext, PipelineBoardFilter{
		FilterCampaign: "campaign-alpha",
		DateFrom:       &dateFrom,
		DateTo:         &dateTo,
		DateMode:       PipelineBoardDateModeOperational,
	})
	if err != nil {
		t.Fatalf("buildPipelineLeadWhere() error = %v", err)
	}

	joined := strings.Join(where, "\n")
	for _, want := range []string{
		"l.created_at >= $",
		"l.created_at <= $",
		"coalesce(l.deal_status, 'open') = 'open'",
		"when l.deal_status = 'won' then l.won_at",
		"when l.deal_status = 'lost' then l.lost_at",
		"l.stage_entered_at >= $",
		"from public.stages terminal_stage",
		"terminal_stage.is_won = true",
		"terminal_stage.is_lost = true",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("buildPipelineLeadWhere() SQL missing %q in:\n%s", want, joined)
		}
	}
	if strings.Contains(joined, "entry.occurred_at >= $") || strings.Contains(joined, "entry.occurred_at <= $") {
		t.Fatalf("board date contract must not silently become attribution occurrence date:\n%s", joined)
	}
}

func TestBuildPipelineLeadWhereOriginCombinesSearchAndCreatedDate(t *testing.T) {
	tenantContext := tenant.Context{
		UserID:         "10000000-0000-0000-0000-000000000001",
		OrganizationID: "20000000-0000-0000-0000-000000000001",
		MemberRole:     "admin",
	}
	dateFrom := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)

	where, _, err := buildPipelineLeadWhere(tenantContext, PipelineBoardFilter{
		Search:   "Maria",
		DateFrom: &dateFrom,
		DateMode: PipelineBoardDateModeOrigin,
	})
	if err != nil {
		t.Fatalf("buildPipelineLeadWhere() error = %v", err)
	}

	joined := strings.Join(where, "\n")
	if !strings.Contains(joined, "l.created_at >= $") {
		t.Fatalf("buildPipelineLeadWhere() must preserve lead-created date filtering:\n%s", joined)
	}
	if strings.Contains(joined, "entry.occurred_at") {
		t.Fatalf("buildPipelineLeadWhere() must not switch dates without an attribution filter:\n%s", joined)
	}
	if !strings.Contains(joined, "coalesce(l.name, '')") {
		t.Fatalf("search must be combined with the period filter:\n%s", joined)
	}
	if strings.Contains(joined, "coalesce(l.deal_status, 'open') = 'open'") {
		t.Fatalf("origin mode must apply created_at strictly:\n%s", joined)
	}
}

func TestParsePipelineBoardFilterDateMode(t *testing.T) {
	for _, test := range []struct {
		name string
		raw  string
		want PipelineBoardDateMode
	}{
		{name: "default", want: ""},
		{name: "operational", raw: "operational", want: PipelineBoardDateModeOperational},
		{name: "origin", raw: "origin", want: PipelineBoardDateModeOrigin},
	} {
		t.Run(test.name, func(t *testing.T) {
			filter, err := ParsePipelineBoardFilter(mapValues("dateMode", test.raw))
			if err != nil {
				t.Fatalf("ParsePipelineBoardFilter() error = %v", err)
			}
			if filter.DateMode != test.want {
				t.Fatalf("DateMode = %q, want %q", filter.DateMode, test.want)
			}
		})
	}

	if _, err := ParsePipelineBoardFilter(mapValues("dateMode", "entry_origin")); err == nil {
		t.Fatal("ParsePipelineBoardFilter() accepted an unsupported date_mode")
	}
	legacy, err := ParsePipelineBoardFilter(mapValues("date_mode", "origin"))
	if err != nil || legacy.DateMode != PipelineBoardDateModeOrigin {
		t.Fatalf("legacy date_mode alias = %#v, %v", legacy.DateMode, err)
	}
	if _, err := ParsePipelineBoardFilter(map[string][]string{
		"dateMode":  {"origin"},
		"date_mode": {"operational"},
	}); err == nil {
		t.Fatal("ParsePipelineBoardFilter() accepted conflicting date mode parameters")
	}
}

func TestPipelineBoardDoesNotApplyImplicitDateFilter(t *testing.T) {
	filter, err := ParsePipelineBoardFilter(map[string][]string{})
	if err != nil {
		t.Fatalf("ParsePipelineBoardFilter() error = %v", err)
	}
	if filter.DateFrom != nil || filter.DateTo != nil || filter.DateMode != "" {
		t.Fatalf("empty request unexpectedly enables a period: %#v", filter)
	}

	where, _, err := buildPipelineLeadWhere(tenant.Context{
		UserID:         "10000000-0000-0000-0000-000000000001",
		OrganizationID: "20000000-0000-0000-0000-000000000001",
		MemberRole:     "admin",
	}, filter)
	if err != nil {
		t.Fatalf("buildPipelineLeadWhere() error = %v", err)
	}
	joined := strings.Join(where, "\n")
	for _, forbidden := range []string{
		"l.created_at >=",
		"l.created_at <=",
		"l.stage_entered_at >=",
		"l.stage_entered_at <=",
		"l.won_at",
		"l.lost_at",
		"entry.occurred_at",
	} {
		if strings.Contains(joined, forbidden) {
			t.Fatalf("empty request must not contain implicit date predicate %q:\n%s", forbidden, joined)
		}
	}
}

func TestParsePipelineBoardFilterRejectsReversedDateRange(t *testing.T) {
	if _, err := ParsePipelineBoardFilter(map[string][]string{
		"dateFrom": {"2026-09-08T23:59:59Z"},
		"dateTo":   {"2026-09-08T00:00:00Z"},
	}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("ParsePipelineBoardFilter() error = %v, want ErrInvalidInput", err)
	}
}

func TestParsePipelineBoardFilterStageCursor(t *testing.T) {
	filter, err := ParsePipelineBoardFilter(map[string][]string{
		"cursorBefore":   {"2026-09-08T12:34:56.123456Z"},
		"cursorBeforeId": {"AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"},
	})
	if err != nil {
		t.Fatalf("ParsePipelineBoardFilter() error = %v", err)
	}
	if filter.CursorBefore == nil {
		t.Fatal("CursorBefore was not parsed")
	}
	if filter.CursorBeforeID != "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" {
		t.Fatalf("CursorBeforeID = %q", filter.CursorBeforeID)
	}

	for _, values := range []map[string][]string{
		{"cursorBefore": {"2026-09-08T12:34:56Z"}},
		{"cursorBeforeId": {"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}},
		{"cursorBefore": {"not-a-date"}, "cursorBeforeId": {"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}},
		{"cursorBefore": {"2026-09-08T12:34:56Z"}, "cursorBeforeId": {"not-a-uuid"}},
	} {
		if _, err := ParsePipelineBoardFilter(values); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("ParsePipelineBoardFilter(%#v) error = %v, want ErrInvalidInput", values, err)
		}
	}
}

func mapValues(key, value string) map[string][]string {
	if value == "" {
		return map[string][]string{}
	}
	return map[string][]string{key: {value}}
}
