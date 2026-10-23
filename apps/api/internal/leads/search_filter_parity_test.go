package leads

import (
	"net/url"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/searchtext"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestContactLiteralSearchAndAttributionFiltersArePreserved(t *testing.T) {
	context := tenant.Context{OrganizationID: "11111111-1111-4111-8111-111111111111", UserID: "22222222-2222-4222-8222-222222222222", IsSuperAdmin: true}
	for _, value := range []string{"All", "all", "None", "none", "null", "undefined", "Allison", "None%_"} {
		t.Run("search "+value, func(t *testing.T) {
			for _, mode := range []string{"compact", "full", "export"} {
				filter, err := ParseContactListFilter(url.Values{"search": {" " + value + " "}, "mode": {mode}})
				if err != nil || filter.Search != value {
					t.Fatalf("%s silently changed literal search %q to %q: %v", mode, value, filter.Search, err)
				}
				where, args, err := buildContactWhere(context, filter)
				if err != nil || !hasSearchFilterArgument(args, searchtext.Pattern(value)) || !strings.Contains(strings.Join(where, " and "), "l.name") {
					t.Fatalf("%s discarded the list/count/export literal search: %v", mode, err)
				}
			}
		})
	}
	for _, value := range []string{"none", "null", "undefined", "None", "__all__"} {
		t.Run("attribution "+value, func(t *testing.T) {
			values := url.Values{"source": {value}, "pageId": {value}, "campaignId": {value}, "adSetId": {value}, "adId": {value}}
			filter, err := ParseContactListFilter(values)
			if err != nil {
				t.Fatal(err)
			}
			if filter.Source != value || filter.PageID != value || filter.CampaignID != value || filter.AdSetID != value || filter.AdID != value || len(filter.CampaignIDs) != 1 || filter.CampaignIDs[0] != value {
				t.Fatalf("literal attribution was interpreted as absent: %#v", filter)
			}
			plural, err := ParseContactListFilter(url.Values{"campaignIds": {value}})
			if err != nil || len(plural.CampaignIDs) != 1 || plural.CampaignIDs[0] != filter.CampaignIDs[0] {
				t.Fatalf("singular/plural campaign semantics diverged: %#v %v", plural, err)
			}
			where, args, err := buildContactWhere(context, filter)
			if err != nil || !hasSearchFilterArgument(args, value) || !strings.Contains(strings.Join(where, " and "), "entry.page_id") {
				t.Fatalf("literal attribution did not reach parameterized SQL: %v", err)
			}
		})
	}
}

func TestContactLiteralFiltersKeepExplicitLegacyAllSentinels(t *testing.T) {
	for _, value := range []string{"all", "__all__"} {
		filter, err := ParseContactListFilter(url.Values{"teamId": {value}, "pipelineId": {value}, "assigneeId": {value}})
		if err != nil || filter.TeamID != "" || filter.PipelineID != "" || filter.AssigneeID != "" || filter.Source != "" || filter.PageID != "" || len(filter.CampaignIDs) != 0 || filter.AdSetID != "" || filter.AdID != "" {
			t.Fatalf("explicit legacy all sentinel lost compatibility: %#v %v", filter, err)
		}
	}
	filter, err := ParseContactListFilter(url.Values{"source": {"all"}, "pageId": {"all"}, "campaignId": {"all"}, "adSetId": {"all"}, "adId": {"all"}})
	if err != nil || filter.Source != "" || filter.PageID != "" || len(filter.CampaignIDs) != 0 || filter.AdSetID != "" || filter.AdID != "" {
		t.Fatalf("explicit opaque all sentinel lost compatibility: %#v %v", filter, err)
	}
	if _, err := ParseContactListFilter(url.Values{"teamId": {"not-a-uuid"}}); err == nil {
		t.Fatal("invalid ID must not turn into an unfiltered request")
	}
}

func TestCRMSearchFiltersShareFormattedPhoneSemantics(t *testing.T) {
	for _, organization := range []string{"11111111-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333"} {
		context := tenant.Context{OrganizationID: organization, UserID: "22222222-2222-4222-8222-222222222222", IsSuperAdmin: true}
		builders := []struct {
			name  string
			build func(string) ([]string, []any, error)
		}{
			{"contacts", func(query string) ([]string, []any, error) {
				return buildContactWhere(context, ContactListFilter{Search: query})
			}},
			{"pipeline", func(query string) ([]string, []any, error) {
				return buildPipelineLeadWhere(context, PipelineBoardFilter{Search: query})
			}},
			{"dashboard", func(query string) ([]string, []any, error) {
				return (Repository{}).buildDashboardLeadWhere(context, DashboardFilter{SearchQuery: query}, dashboardLeadWhereOptions{})
			}},
		}
		for _, builder := range builders {
			t.Run(builder.name+" "+organization, func(t *testing.T) {
				for _, query := range []string{"(11) 99999-8888", "+55 (11) 99999-8888", "9999"} {
					where, args, err := builder.build(query)
					if err != nil || len(args) == 0 || args[0] != organization {
						t.Fatalf("search lost tenant scope: %#v %v", args, err)
					}
					digits := strings.NewReplacer("(", "", ")", "", " ", "", "-", "", "+", "").Replace(query)
					joined := strings.Join(where, " and ")
					phoneSQL := "regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g') like $"
					if builder.name == "pipeline" {
						phoneSQL = searchtext.PipelinePhoneSQL("l.phone", "$")
					}
					if !hasSearchFilterArgument(args, "%"+digits+"%") || !strings.Contains(joined, phoneSQL) {
						t.Fatalf("formatted phone query %q has no normalized phone alternative: %s args=%#v", query, joined, args)
					}
					for _, clause := range where {
						if strings.Contains(clause, "regexp_replace(") && (!strings.HasPrefix(clause, "(") || !strings.HasSuffix(clause, ")")) {
							t.Fatal("the phone OR must stay grouped inside the authorized WHERE")
						}
					}
				}
				for _, query := range []string{"Lote 123", "Joao2026", "name12@example.invalid", "abc1", "123"} {
					where, args, err := builder.build(query)
					if err != nil || args[0] != organization || !hasSearchFilterArgument(args, searchtext.Pattern(query)) {
						t.Fatalf("literal text lost scope or matching: %#v %v", args, err)
					}
					if strings.Contains(strings.Join(where, " and "), "regexp_replace(") {
						t.Fatalf("text/short query %q acquired a broad numeric alternative", query)
					}
				}
			})
		}
	}
}

func hasSearchFilterArgument(args []any, value string) bool {
	for _, argument := range args {
		if text, ok := argument.(string); ok && text == value {
			return true
		}
	}
	return false
}
