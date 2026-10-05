package whatsapp

import (
	"net/url"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestConversationAdvancedFiltersParseAndBind(t *testing.T) {
	values := url.Values{
		"pipelineId":  {unreadCountSessionID},
		"teamId":      {unreadCountSecondSession},
		"userId":      {unreadCountUserID},
		"leadSource":  {"meta"},
		"tagIds":      {unreadCountSessionID + "," + unreadCountSecondSession, unreadCountSessionID},
		"dealStatus":  {"open"},
		"pageId":      {"page-a"},
		"campaignIds": {"campaign, with comma", "campaign-b", "campaign-b"},
	}
	filter, err := ParseConversationListFilter(values)
	if err != nil {
		t.Fatal(err)
	}
	if len(filter.TagIDs) != 2 || len(filter.CampaignIDs) != 2 || filter.CampaignIDs[0] != "campaign, with comma" {
		t.Fatalf("multi-value filters were not normalized: %#v", filter)
	}
	if filter.LastMessageFrom != nil || filter.LastMessageTo != nil {
		t.Fatal("period must not default")
	}
	args, where, empty, err := conversationFilterSQL(tenant.Context{
		OrganizationID: unreadCountOrganizationID, UserID: unreadCountUserID,
	}, filter)
	if err != nil || empty {
		t.Fatalf("SQL filter = empty:%v error:%v", empty, err)
	}
	sql := strings.Join(where, " and ")
	for _, clause := range []string{
		"l.pipeline_id =", "from public.team_members tm", "l.assigned_user_id =",
		"l.source =", "from public.lead_tags lt", "l.deal_status =",
		"entry.organization_id = wc.organization_id", "entry.lead_id = l.id",
		"entry.page_id", "entry.campaign_id", "entry.is_countable = true",
		"lm.organization_id = wc.organization_id", "lm.page_id", "lm.campaign_id",
	} {
		if !strings.Contains(sql, clause) {
			t.Fatalf("missing %q in %s", clause, sql)
		}
	}
	if strings.Contains(sql, "campaign, with comma") || len(args) != 12 {
		t.Fatalf("filter values must be bound: args=%#v where=%s", args, sql)
	}
}

func TestConversationAdvancedFiltersRejectInvalidAndNoLeadCombinations(t *testing.T) {
	for _, values := range []url.Values{
		{"pipelineId": {"invalid"}},
		{"teamId": {"invalid"}},
		{"userId": {"invalid"}},
		{"tagIds": {"invalid"}},
		{"dealStatus": {"deleted"}},
		{"withoutLead": {"true"}, "pageId": {"page-a"}},
		{"withoutLead": {"true"}, "teamId": {unreadCountSecondSession}},
	} {
		if _, err := ParseConversationListFilter(values); err == nil {
			t.Fatalf("expected invalid filter for %#v", values)
		}
	}
	_, _, empty, err := conversationFilterSQL(tenant.Context{}, ConversationListFilter{
		WithoutLead: true, CampaignIDs: []string{"campaign-a"},
	})
	if err != nil || !empty {
		t.Fatalf("repository must fail closed without lead: empty=%v error=%v", empty, err)
	}
}
