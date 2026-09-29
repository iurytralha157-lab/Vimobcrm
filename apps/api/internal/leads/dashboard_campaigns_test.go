package leads

import (
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestDashboardCampaignsUseScopedArrivalsAndCountEachLeadOncePerCampaign(t *testing.T) {
	from := time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 0, 27)
	viewer := tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		Permissions:    []string{permissions.LeadViewOwn},
	}
	filter := DashboardFilter{
		DateFrom: &from, DateTo: &to,
		UserID: viewer.UserID, TeamID: "33333333-3333-4333-8333-333333333333",
		PipelineID: "44444444-4444-4444-8444-444444444444",
		Source:     "meta", PageID: "page-a", CampaignID: "campaign-a",
		AdSetID: "adset-a", AdID: "ad-a",
		TagID:      "55555555-5555-4555-8555-555555555555",
		DealStatus: "open", SearchQuery: "lead",
	}
	repo := Repository{}
	query, args, err := repo.buildDashboardCampaignsQuery(viewer, filter)
	if err != nil {
		t.Fatal(err)
	}
	cte, entryWhere, expectedArgs, err := repo.buildDashboardEntriesCTE(viewer, filter)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(query, cte) || !strings.Contains(query, "from entries entry\n\t\t\twhere "+entryWhere) {
		t.Fatal("campaigns must use exactly the dashboard arrival cohort and filters")
	}
	if !reflect.DeepEqual(args, expectedArgs) {
		t.Fatalf("campaign filter arguments diverged from the dashboard cohort: %#v != %#v", args, expectedArgs)
	}
	for _, fragment := range []string{
		"l.organization_id = $1::uuid", "l.assigned_user_id =", "from public.team_members",
		"l.pipeline_id =", "l.deal_status =", "from public.lead_tags",
		"entry.occurred_at >=", "entry.occurred_at <=", "btrim(entry.source) =",
		"btrim(entry.page_id) =", "btrim(entry.campaign_id) =", "btrim(entry.adset_id) =",
		"btrim(entry.ad_id) =", "e.entry_type = 'reentry' and e.is_countable = true",
		"count(distinct lead_id)::bigint as lead_count", "count(*)::bigint as entry_count",
		"group by 1", "order by campaign_key is null, lead_count desc, lower(name), campaign_key",
	} {
		if !strings.Contains(query, fragment) {
			t.Errorf("campaign query is missing %q", fragment)
		}
	}
	if strings.Contains(query, "l.created_at >=") || strings.Contains(query, "l.created_at <=") {
		t.Fatal("campaign period must follow each arrival, not current card creation")
	}
	if grouped := strings.SplitN(query, "campaign_entries as (", 2); len(grouped) != 2 || strings.Contains(strings.ToLower(grouped[1]), "limit ") {
		t.Fatal("campaign rows must not be truncated after the initial-entry lookup")
	}
}

func TestDashboardCampaignsKeepIDAndTextIdentitySeparateAndExposeMissingAttribution(t *testing.T) {
	query, _, err := (Repository{}).buildDashboardCampaignsQuery(tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		MemberRole:     "admin",
	}, DashboardFilter{})
	if err != nil {
		t.Fatal(err)
	}
	for _, fragment := range []string{
		"when campaign_id is not null then 'id:' || campaign_id",
		"then 'text:' || coalesce(campaign_name, utm_campaign)",
		"coalesce(max(campaign_name), max(utm_campaign), max(campaign_id), '') as name",
		"select campaign_key, campaign_id, name, lead_count, entry_count",
	} {
		if !strings.Contains(query, fragment) {
			t.Errorf("campaign grouping is missing %q", fragment)
		}
	}
	if query == "" || strings.Contains(query, "where campaign_id is not null") {
		t.Fatal("arrivals without a campaign must remain available for the separate unattributed total")
	}
}

func TestDashboardCampaignsHandlerRequiresDashboardPermissionBeforeQuery(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/v1/dashboard/campaigns?userId=invalid", nil)
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		UserID: "11111111-1111-4111-8111-111111111111", OrganizationID: "22222222-2222-4222-8222-222222222222",
		MemberRole: "member", Permissions: []string{permissions.LeadViewOwn},
	}))
	recorder := httptest.NewRecorder()
	(Handler{}).ShowDashboardCampaigns(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status=%d, want forbidden; body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestDashboardCampaignsOpenAPIExposesAllDashboardFilters(t *testing.T) {
	raw, err := os.ReadFile("../../../../packages/contracts/openapi/v1.yaml")
	if err != nil {
		t.Fatal(err)
	}
	section := dashboardContractSection(t, string(raw), "  /v1/dashboard/campaigns:", "  /v1/dashboard/top-brokers:")
	for _, parameter := range []string{
		"OrganizationIdHeader", "DashboardDateFrom", "DashboardDateTo", "DashboardPipelineId",
		"DashboardTeamId", "DashboardUserId", "DashboardSource", "DashboardPageId",
		"DashboardCampaignId", "DashboardAdSetId", "DashboardAdId", "DashboardTagId",
		"DashboardTagIds", "DashboardDealStatus", "DashboardSearchQuery",
	} {
		if !strings.Contains(section, "#/components/parameters/"+parameter) {
			t.Errorf("campaign contract does not document %s", parameter)
		}
	}
	if !strings.Contains(section, "#/components/schemas/DashboardCampaignsResponse") {
		t.Fatal("campaign response schema is missing")
	}
}
