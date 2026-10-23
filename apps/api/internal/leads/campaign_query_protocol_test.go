package leads

import (
	"fmt"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Exercise the repeated HTTP query format used by the browser, through the
// public parsers and the actual SQL builders. A successful parse must never
// silently turn a campaign selection into the unfiltered tenant query.
func TestCampaignHTTPQueryReachesScopedSQL(t *testing.T) {
	for _, role := range []struct {
		name, memberRole  string
		teamLeader        bool
		viewAll, viewTeam bool
	}{
		{"admin", "admin", false, true, true},
		{"leader", "member", true, false, true},
		{"standard", "member", false, false, false},
	} {
		t.Run(role.name, func(t *testing.T) {
			for _, domain := range []string{"contacts", "pipeline"} {
				for _, organizationID := range []string{
					"10000000-0000-4000-8000-000000000001",
					"10000000-0000-4000-8000-000000000002",
				} {
					t.Run(domain+"/"+organizationID, func(t *testing.T) {
						tc := tenant.Context{
							OrganizationID: organizationID,
							UserID:         "20000000-0000-4000-8000-000000000001",
							MemberRole:     role.memberRole,
							IsTeamLeader:   role.teamLeader,
							Permissions:    permissions.Resolve(role.memberRole, role.teamLeader, nil, nil),
						}
						build := func(raw string) ([]string, []any, error) {
							endpoint := "/v1/contacts"
							if domain == "pipeline" {
								endpoint = "/v1/pipeline-board"
							}
							request := httptest.NewRequest("GET", endpoint+"?"+raw, nil)
							if domain == "contacts" {
								filter, err := ParseContactListFilter(request.URL.Query())
								if err != nil {
									return nil, nil, err
								}
								return buildContactWhere(tc, filter)
							}
							filter, err := ParsePipelineBoardFilter(request.URL.Query())
							if err != nil {
								return nil, nil, err
							}
							return buildPipelineLeadWhere(tc, filter)
						}
						baselineWhere, baselineArgs, err := build("")
						if err != nil {
							t.Fatal(err)
						}
						if !reflect.DeepEqual(baselineArgs, []any{organizationID, role.viewAll, tc.UserID, role.viewTeam}) {
							t.Fatal("baseline lost its organization, actor or role visibility bindings")
						}
						singular, plural := "campaignId", "campaignIds"
						if domain == "pipeline" {
							singular, plural = "filterCampaign", "filterCampaigns"
						}
						for _, selection := range []struct {
							name   string
							values url.Values
							want   []string
						}{
							{"legacy one", url.Values{singular: {"campaign-a"}}, []string{"campaign-a"}},
							{"plural one", url.Values{plural: {"campaign-a"}}, []string{"campaign-a"}},
							{"plural two", url.Values{plural: {"campaign-a", "Campaign, with comma"}}, []string{"campaign-a", "Campaign, with comma"}},
							{"reversed with duplicates", url.Values{plural: {"Campaign, with comma", "campaign-a", "Campaign, with comma"}}, []string{"Campaign, with comma", "campaign-a"}},
							{"single UI compatibility alias", url.Values{singular: {"campaign-a"}, plural: {"campaign-a", "campaign-a"}}, []string{"campaign-a"}},
						} {
							t.Run(selection.name, func(t *testing.T) {
								where, args, err := build(selection.values.Encode())
								if err != nil {
									t.Fatal(err)
								}
								if len(args) != len(baselineArgs)+1 || !reflect.DeepEqual(args[:len(baselineArgs)], baselineArgs) {
									t.Fatal("selection must preserve tenant/visibility arguments and add one campaign binding")
								}
								if len(where) != len(baselineWhere)+1 || !reflect.DeepEqual(where[:len(baselineWhere)], baselineWhere) {
									t.Fatal("selection must preserve every visibility predicate and append the campaign restriction")
								}
								comparison := fmt.Sprintf("= $%d", len(args))
								var want any = selection.want[0]
								if len(selection.want) > 1 {
									comparison = fmt.Sprintf("= any($%d::text[])", len(args))
									want = selection.want
								}
								if !reflect.DeepEqual(args[len(args)-1], want) {
									t.Fatal("HTTP query did not preserve all distinct campaign values")
								}
								query := strings.Join(where, "\n")
								if !strings.Contains(query, "l.organization_id = $1::uuid") || !strings.Contains(query, "entry.organization_id = $1::uuid") || !strings.Contains(query, "entry.campaign_id "+comparison) {
									t.Fatal("campaign predicate must keep organization isolation and bind the complete selection")
								}
								for _, value := range selection.want {
									if strings.Contains(query, value) {
										t.Fatal("campaign values must be parameters, never SQL text")
									}
								}
							})
						}
					})
				}
			}
		})
	}
}
