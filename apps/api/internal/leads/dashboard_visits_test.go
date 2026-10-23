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

func TestDashboardVisitLeaderVisibilityRequiresCurrentMembershipGeneration(t *testing.T) {
	for _, required := range []string{
		"and $4::boolean",
		"visit_team.id = visit_leader.team_id",
		"visit_team.organization_id = visit_leader.organization_id",
		"coalesce(visit_team.is_active, false) = true",
		"coalesce(visit_leader_user.is_active, false) = true",
		"coalesce(visit_member_user.is_active, false) = true",
		"visit_leader_membership.organization_id = visit_leader.organization_id",
		"visit_leader_membership.user_id = visit_leader.user_id",
		"visit_leader_membership.membership_generation = visit_leader.membership_generation",
		"visit_leader_membership.is_active = true",
		"visit_leader_membership.deleted_at is null",
		"visit_member_membership.organization_id = visit_member.organization_id",
		"visit_member_membership.user_id = visit_member.user_id",
		"visit_member_membership.membership_generation = visit_member.membership_generation",
		"visit_member_membership.is_active = true",
		"visit_member_membership.deleted_at is null",
	} {
		if !strings.Contains(dashboardVisitEventVisibilitySQL, required) {
			t.Fatalf("dashboard visit leader scope is missing %q", required)
		}
	}
}
