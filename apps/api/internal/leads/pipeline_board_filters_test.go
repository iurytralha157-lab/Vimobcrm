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

func TestPageFilterParsingAndContactComposition(t *testing.T) {
	pipelineFilter, err := ParsePipelineBoardFilter(mapValues("filterPage", " page-123 "))
	if err != nil {
		t.Fatalf("ParsePipelineBoardFilter() error = %v", err)
	}
	if pipelineFilter.FilterPage != "page-123" {
		t.Fatalf("FilterPage = %q, want page-123", pipelineFilter.FilterPage)
	}
	if _, err := ParsePipelineBoardFilter(mapValues("filterPage", strings.Repeat("p", maxPipelineMetaFilterText+1))); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("oversized filterPage error = %v, want ErrInvalidInput", err)
	}

	contactFilter, err := ParseContactListFilter(mapValues("pageId", " page-123 "))
	if err != nil {
		t.Fatalf("ParseContactListFilter() error = %v", err)
	}
	if contactFilter.PageID != "page-123" {
		t.Fatalf("PageID = %q, want page-123", contactFilter.PageID)
	}
	contactFilter.CampaignID = "campaign-123"

	where, args, err := buildContactWhere(tenant.Context{
		UserID:         "10000000-0000-0000-0000-000000000001",
		OrganizationID: "20000000-0000-0000-0000-000000000001",
		MemberRole:     "admin",
	}, contactFilter)
	if err != nil {
		t.Fatalf("buildContactWhere() error = %v", err)
	}
	joined := strings.Join(where, "\n")
	for _, want := range []string{
		"entry.organization_id = $1::uuid",
		"entry.page_id = $",
		"entry.campaign_id = $",
		"lm.page_id = $",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("buildContactWhere() SQL missing %q in:\n%s", want, joined)
		}
	}
	if strings.Count(joined, "from public.lead_entry_events entry") != 1 {
		t.Fatalf("page and campaign must compose in one historical-entry EXISTS:\n%s", joined)
	}
	if strings.Count(joined, "from public.lead_meta lm") != 1 {
		t.Fatalf("page and campaign must compose in one legacy lead_meta EXISTS:\n%s", joined)
	}
	if strings.Contains(joined, "l.meta_campaign_id =") || strings.Contains(joined, "l.utm_campaign =") {
		t.Fatalf("page composition must not mix the lead projection with another attribution origin:\n%s", joined)
	}
	if got := args[len(args)-2:]; got[0] != "page-123" || got[1] != "campaign-123" {
		t.Fatalf("buildContactWhere() attribution args = %#v", got)
	}
}

func TestLeadAttributionPageRequiresOneAtomicLegacyMetaRow(t *testing.T) {
	args := []any{"20000000-0000-0000-0000-000000000001"}
	conditions := []string{}
	if !addLeadAttributionFilterCondition(&args, &conditions, "l", "lm", leadAttributionFilter{
		Page:     "page-123",
		Campaign: "campaign-123",
		AdSet:    "adset-123",
		Ad:       "ad-123",
	}) {
		t.Fatal("page attribution filter was not added")
	}
	if len(conditions) != 1 {
		t.Fatalf("conditions = %#v, want one atomic attribution condition", conditions)
	}
	joined := conditions[0]
	for _, want := range []string{
		"entry.page_id = $",
		"entry.campaign_id = $",
		"entry.adset_id = $",
		"entry.ad_id = $",
		"lm.page_id = $",
		"lm.campaign_id = $",
		"lm.adset_id = $",
		"lm.ad_id = $",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("atomic attribution SQL missing %q:\n%s", want, joined)
		}
	}
	if strings.Count(joined, "from public.lead_meta lm") != 1 {
		t.Fatalf("legacy fallback must use one lead_meta row:\n%s", joined)
	}
	if strings.Contains(joined, "l.meta_campaign_id =") || strings.Contains(joined, "l.meta_adset_id =") || strings.Contains(joined, "l.meta_ad_id =") {
		t.Fatalf("atomic page fallback must not combine attribution from public.leads:\n%s", joined)
	}
}

func TestPipelineBoardTagFiltersUseAnySelectedTag(t *testing.T) {
	firstTagID := "30000000-0000-4000-8000-000000000001"
	secondTagID := "30000000-0000-4000-8000-000000000002"
	filter, err := ParsePipelineBoardFilter(map[string][]string{
		"filterTags": {secondTagID + "," + firstTagID, firstTagID},
	})
	if err != nil {
		t.Fatalf("ParsePipelineBoardFilter() error = %v", err)
	}
	if len(filter.FilterTags) != 2 || filter.FilterTags[0] != secondTagID || filter.FilterTags[1] != firstTagID {
		t.Fatalf("FilterTags = %#v", filter.FilterTags)
	}

	where, args, err := buildPipelineLeadWhere(tenant.Context{
		UserID:         "10000000-0000-0000-0000-000000000001",
		OrganizationID: "20000000-0000-0000-0000-000000000001",
		MemberRole:     "admin",
	}, filter)
	if err != nil {
		t.Fatalf("buildPipelineLeadWhere() error = %v", err)
	}
	joined := strings.Join(where, "\n")
	if !strings.Contains(joined, "lt.tag_id = any($") || !strings.Contains(joined, "::uuid[])") {
		t.Fatalf("pipeline tag filter must use OR semantics via ANY(uuid[]):\n%s", joined)
	}
	tagIDs, ok := args[len(args)-1].([]string)
	if !ok || len(tagIDs) != 2 {
		t.Fatalf("pipeline tag args = %#v", args[len(args)-1])
	}
}

func TestPipelineBoardTagFiltersKeepLegacyTagIDAndRejectInvalidLists(t *testing.T) {
	legacyTagID := "30000000-0000-4000-8000-000000000001"
	filter, err := ParsePipelineBoardFilter(mapValues("filterTag", legacyTagID))
	if err != nil {
		t.Fatalf("ParsePipelineBoardFilter() legacy error = %v", err)
	}
	if filter.FilterTag != legacyTagID || len(filter.FilterTags) != 1 || filter.FilterTags[0] != legacyTagID {
		t.Fatalf("legacy filter was not migrated: %#v", filter)
	}
	if _, err := ParsePipelineBoardFilter(mapValues("filterTags", "not-a-uuid")); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid filterTags error = %v, want ErrInvalidInput", err)
	}
}

func TestPipelineBoardUnassignedFilterTakesPrecedenceOverUserFilters(t *testing.T) {
	filter, err := ParsePipelineBoardFilter(map[string][]string{
		"unassigned":    {"TRUE"},
		"filterUserId":  {"10000000-0000-4000-8000-000000000002"},
		"filterUserIds": {"10000000-0000-4000-8000-000000000002,10000000-0000-4000-8000-000000000003"},
	})
	if err != nil {
		t.Fatalf("ParsePipelineBoardFilter() error = %v", err)
	}
	if !filter.Unassigned {
		t.Fatal("Unassigned = false, want true")
	}

	where, args, err := buildPipelineLeadWhere(tenant.Context{
		UserID:         "10000000-0000-4000-8000-000000000001",
		OrganizationID: "20000000-0000-4000-8000-000000000001",
		MemberRole:     "admin",
	}, filter)
	if err != nil {
		t.Fatalf("buildPipelineLeadWhere() error = %v", err)
	}

	if len(args) != 4 {
		t.Fatalf("buildPipelineLeadWhere() args = %#v, want only visibility args", args)
	}
	if len(where) != 3 {
		t.Fatalf("buildPipelineLeadWhere() where = %#v, want organization, visibility, and unassigned predicates", where)
	}
	if !strings.Contains(where[1], "l.assigned_user_id = $3::uuid") {
		t.Fatalf("buildPipelineLeadWhere() lost canonical visibility predicate: %#v", where)
	}
	if where[2] != "l.assigned_user_id is null" {
		t.Fatalf("buildPipelineLeadWhere() where = %#v, want unassigned predicate after canonical visibility", where)
	}
}

func TestPipelineBoardUnassignedFilterDisabledKeepsUserFilter(t *testing.T) {
	filter, err := ParsePipelineBoardFilter(map[string][]string{
		"unassigned":   {"false"},
		"filterUserId": {"10000000-0000-4000-8000-000000000002"},
	})
	if err != nil {
		t.Fatalf("ParsePipelineBoardFilter() error = %v", err)
	}
	if filter.Unassigned {
		t.Fatal("Unassigned = true, want false")
	}

	where, args, err := buildPipelineLeadWhere(tenant.Context{
		UserID:         "10000000-0000-4000-8000-000000000001",
		OrganizationID: "20000000-0000-4000-8000-000000000001",
		MemberRole:     "admin",
	}, filter)
	if err != nil {
		t.Fatalf("buildPipelineLeadWhere() error = %v", err)
	}

	if len(args) != 5 || args[4] != "10000000-0000-4000-8000-000000000002" {
		t.Fatalf("buildPipelineLeadWhere() args = %#v, want selected user", args)
	}
	if len(where) != 3 || where[2] != "l.assigned_user_id = $5::uuid" {
		t.Fatalf("buildPipelineLeadWhere() where = %#v, want selected-user predicate", where)
	}

	if _, err := ParsePipelineBoardFilter(mapValues("unassigned", "not-a-boolean")); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("ParsePipelineBoardFilter() invalid unassigned error = %v, want ErrInvalidInput", err)
	}
}

func TestPipelineBoardUnassignedFilterComposesWithTeam(t *testing.T) {
	teamID := "30000000-0000-4000-8000-000000000001"
	filter, err := ParsePipelineBoardFilter(map[string][]string{
		"unassigned": {"true"},
		"teamId":     {teamID},
	})
	if err != nil {
		t.Fatalf("ParsePipelineBoardFilter() error = %v", err)
	}
	if filter.TeamID != teamID {
		t.Fatalf("TeamID = %q, want %q", filter.TeamID, teamID)
	}

	where, args, err := buildPipelineLeadWhere(tenant.Context{
		UserID:         "10000000-0000-4000-8000-000000000001",
		OrganizationID: "20000000-0000-4000-8000-000000000001",
		MemberRole:     "admin",
	}, filter)
	if err != nil {
		t.Fatalf("buildPipelineLeadWhere() error = %v", err)
	}

	if len(args) != 5 || args[4] != teamID {
		t.Fatalf("buildPipelineLeadWhere() args = %#v, want selected team", args)
	}
	joined := strings.Join(where, "\n")
	if !strings.Contains(joined, "nullif(to_jsonb(l)->>'team_id', '') = $5::text") {
		t.Fatalf("buildPipelineLeadWhere() missing direct team predicate: %s", joined)
	}
	if !strings.Contains(joined, "tm.team_id = $5::uuid") {
		t.Fatalf("buildPipelineLeadWhere() missing legacy team membership fallback: %s", joined)
	}
	if !strings.Contains(joined, "tm.organization_id = l.organization_id") || !strings.Contains(joined, "tm.is_active = true") {
		t.Fatalf("buildPipelineLeadWhere() team fallback is not tenant-safe and active-only: %s", joined)
	}
	if where[len(where)-1] != "l.assigned_user_id is null" {
		t.Fatalf("buildPipelineLeadWhere() where = %#v, want unassigned predicate", where)
	}

	filter.TeamID = "not-a-uuid"
	if _, _, err := buildPipelineLeadWhere(tenant.Context{}, filter); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("buildPipelineLeadWhere() invalid team error = %v, want ErrInvalidInput", err)
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
