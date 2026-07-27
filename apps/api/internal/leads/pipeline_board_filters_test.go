package leads

import (
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

func TestBuildPipelineLeadWhereUsesEntryDateForAttributionFilter(t *testing.T) {
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
	})
	if err != nil {
		t.Fatalf("buildPipelineLeadWhere() error = %v", err)
	}

	joined := strings.Join(where, "\n")
	for _, want := range []string{
		"entry.occurred_at >= $",
		"entry.occurred_at <= $",
		"l.created_at >= $",
		"l.created_at <= $",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("buildPipelineLeadWhere() SQL missing %q in:\n%s", want, joined)
		}
	}
}

func TestBuildPipelineLeadWhereKeepsCreatedDateWithoutAttribution(t *testing.T) {
	tenantContext := tenant.Context{
		UserID:         "10000000-0000-0000-0000-000000000001",
		OrganizationID: "20000000-0000-0000-0000-000000000001",
		MemberRole:     "admin",
	}
	dateFrom := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)

	where, _, err := buildPipelineLeadWhere(tenantContext, PipelineBoardFilter{DateFrom: &dateFrom})
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
}
