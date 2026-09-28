package leads

import (
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestDashboardEntryFilterOptionsUseArrivalDateAndCurrentCardScope(t *testing.T) {
	from := time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, time.September, 27, 23, 59, 59, 0, time.UTC)
	query, args, err := (Repository{}).buildDashboardEntryFilterOptionsQuery(tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		MemberRole:     "admin",
	}, DashboardFilter{
		DateFrom: &from, DateTo: &to,
		PipelineID:  "33333333-3333-4333-8333-333333333333",
		TeamID:      "44444444-4444-4444-8444-444444444444",
		UserID:      "22222222-2222-4222-8222-222222222222",
		DealStatus:  "open",
		TagID:       "55555555-5555-4555-8555-555555555555",
		SearchQuery: "contato",
		PageID:      "selected-page",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{
		"l.organization_id = $1::uuid",
		"l.pipeline_id =",
		"l.assigned_user_id =",
		"from public.team_members",
		"l.deal_status =",
		"from public.lead_tags",
		"e.entry_type = 'reentry' and e.is_countable = true",
		"entry.occurred_at >=",
		"entry.occurred_at <=",
		"from entries entry",
		"select distinct",
	} {
		if !strings.Contains(query, required) {
			t.Errorf("entry filter option query is missing %q", required)
		}
	}
	for _, forbidden := range []string{"l.created_at >=", "l.created_at <=", "btrim(entry.page_id) ="} {
		if strings.Contains(query, forbidden) {
			t.Errorf("entry filter option query has a card-date or page predicate: %q", forbidden)
		}
	}
	for _, arg := range args {
		if arg == "selected-page" {
			t.Fatal("selected page must leave page options available; descendants are narrowed by the same row")
		}
	}
}

func TestDashboardEntryFilterOptionsCascadeFromTheSameArrival(t *testing.T) {
	sources := map[string]struct{}{}
	pages := map[string]LeadMetaPageOption{}
	campaigns := map[string]LeadMetaCampaignOption{}
	adsets := map[string]LeadMetaAdsetOption{}
	ads := map[string]LeadMetaAdOption{}
	collect := func(row dashboardEntryOptionRow) {
		collectDashboardEntryOptionRow(row, "page-b", sources, pages, campaigns, adsets, ads)
	}
	collect(dashboardEntryOptionRow{Source: "form", PageID: "page-a", CampaignID: "123456789", CampaignName: "Campanha A"})
	collect(dashboardEntryOptionRow{Source: "whatsapp", PageID: "page-b", CampaignID: "987654321", AdsetID: "adset-b", AdID: "ad-b"})
	if len(sources) != 2 || len(pages) != 2 {
		t.Fatalf("all in-range sources and pages must remain selectable: sources=%#v pages=%#v", sources, pages)
	}
	if len(campaigns) != 1 || campaigns["987654321"].Name != "987654321" {
		t.Fatalf("numeric-only reentry campaign must remain selectable: %#v", campaigns)
	}
	if len(adsets) != 1 || adsets["987654321-adset-b"].CampaignID != "987654321" {
		t.Fatalf("adset must belong to the selected page's campaign: %#v", adsets)
	}
	if len(ads) != 1 || ads["987654321-adset-b-ad-b"].AdsetID != "adset-b" {
		t.Fatalf("ad must belong to the selected page's entry: %#v", ads)
	}
}
