package leads

import (
	"strings"
	"testing"

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
