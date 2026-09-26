package leads

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestDashboardVisitsShareScopedKPIWhere(t *testing.T) {
	from := time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC)
	to := from.Add(7 * 24 * time.Hour)
	filter := DashboardFilter{
		DateFrom: &from, DateTo: &to,
		Source: "site", PageID: "test-page", CampaignID: "test-campaign",
	}
	for _, tc := range []struct {
		name string
		ctx  tenant.Context
		all  bool
	}{
		{"broker", tenant.Context{OrganizationID: "00000000-0000-0000-0000-000000000001", UserID: "00000000-0000-0000-0000-000000000002", Permissions: []string{permissions.LeadViewOwn}}, false},
		{"leader", tenant.Context{OrganizationID: "00000000-0000-0000-0000-000000000001", UserID: "00000000-0000-0000-0000-000000000004", Permissions: []string{permissions.LeadViewTeam}, IsTeamLeader: true}, false},
		{"lead_view_all_without_admin", tenant.Context{OrganizationID: "00000000-0000-0000-0000-000000000001", UserID: "00000000-0000-0000-0000-000000000005", Permissions: []string{permissions.LeadViewAll}}, false},
		{"admin", tenant.Context{OrganizationID: "00000000-0000-0000-0000-000000000001", UserID: "00000000-0000-0000-0000-000000000003", MemberRole: "admin"}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			where, args, err := (Repository{}).buildDashboardScheduledVisitsWhere(tc.ctx, filter)
			if err != nil {
				t.Fatal(err)
			}
			if len(where) < 5 || !strings.Contains(where[2], "coalesce(se.visibility, 'default') <> 'private'") ||
				!strings.Contains(where[2], "visit_assignee") || !strings.Contains(where[2], "visit_leader") {
				t.Fatalf("event privacy was not included in the KPI predicate: %q", where)
			}
			privacyIndex := -1
			for index, arg := range args {
				if flag, ok := arg.(bool); ok && flag == tc.all && index >= 4 {
					privacyIndex = index + 1
					break
				}
			}
			if privacyIndex == -1 || !strings.Contains(where[2], fmt.Sprintf("$%d::boolean", privacyIndex)) {
				t.Fatalf("event privacy parameter does not match the caller's role: %q", where[2])
			}
			joined := strings.Join(where, " and ")
			for _, expected := range []string{"se.created_at >=", "se.created_at <=", "l.source ="} {
				if !strings.Contains(joined, expected) {
					t.Fatalf("missing visit filter %q", expected)
				}
			}
			for _, value := range []string{"test-page", "test-campaign"} {
				found := false
				for _, arg := range args {
					if arg == value {
						found = true
						break
					}
				}
				if !found {
					t.Fatalf("missing attribution argument %q", value)
				}
			}
		})
	}
}
