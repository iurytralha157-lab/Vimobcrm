package leads

import (
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestDashboardTeamFilterMatchesCurrentAssigneeTeamLikePipeline(t *testing.T) {
	context := tenant.Context{
		UserID:         "11111111-1111-4111-8111-111111111111",
		OrganizationID: "22222222-2222-4222-8222-222222222222",
		Permissions:    []string{permissions.LeadViewTeam, permissions.LeadOperate},
	}
	teamID := "33333333-3333-4333-8333-333333333333"
	filter := DashboardFilter{TeamID: teamID}

	where, args, err := (Repository{}).buildDashboardLeadWhere(context, filter, dashboardLeadWhereOptions{})
	if err != nil {
		t.Fatalf("build dashboard lead where: %v", err)
	}
	teamClause := where[len(where)-1]
	if strings.Contains(teamClause, "to_jsonb(l)->>'team_id'") {
		t.Fatalf("team filter must not prefer assignment provenance over the current assignee team: %s", teamClause)
	}
	for _, fragment := range []string{
		"join public.teams dt",
		"dt.id = dtm.team_id",
		"dt.organization_id = dtm.organization_id",
		"dt.is_active = true",
		"join public.users du",
		"coalesce(du.is_active, false) = true",
		"join public.organization_members dom",
		"dom.organization_id = dtm.organization_id",
		"dom.user_id = dtm.user_id",
		"coalesce(dom.is_active, false) = true",
		"dom.deleted_at is null",
		"dtm.organization_id = l.organization_id",
		"dtm.team_id = $5::uuid",
		"dtm.user_id = l.assigned_user_id",
		"coalesce(dtm.is_active, true) = true",
	} {
		if !strings.Contains(teamClause, fragment) {
			t.Fatalf("team filter does not match the pipeline assignee scope %q: %s", fragment, teamClause)
		}
	}
	if strings.Contains(teamClause, "l.assigned_user_id is null") || strings.Contains(teamClause, "l.team_id = $5::uuid") {
		t.Fatalf("team-only filter must not include unassigned queue provenance: %s", teamClause)
	}
	if len(args) != 5 || args[4] != teamID {
		t.Fatalf("team filter args = %#v, want selected team %q", args, teamID)
	}
}

func TestDashboardTeamAndUnassignedFiltersUseQueueProvenance(t *testing.T) {
	context := tenant.Context{
		UserID:         "11111111-1111-4111-8111-111111111111",
		OrganizationID: "22222222-2222-4222-8222-222222222222",
		MemberRole:     "admin",
	}
	filter := DashboardFilter{
		TeamID: "33333333-3333-4333-8333-333333333333",
		UserID: "unassigned",
	}

	where, _, err := (Repository{}).buildDashboardLeadWhere(context, filter, dashboardLeadWhereOptions{})
	if err != nil {
		t.Fatalf("build dashboard lead where: %v", err)
	}
	query := strings.Join(where, " and ")
	for _, fragment := range []string{
		"l.assigned_user_id is null",
		"l.team_id = $5::uuid",
	} {
		if !strings.Contains(query, fragment) {
			t.Fatalf("team + unassigned predicate is missing %q: %s", fragment, query)
		}
	}
	if strings.Contains(query, "from public.team_members dtm") {
		t.Fatalf("team + unassigned must use queue provenance instead of current membership: %s", query)
	}
}

func TestDashboardLeaderCanCountMultiTeamBrokerLeadsAcrossOriginalTeams(t *testing.T) {
	leader := tenant.Context{
		UserID:         "11111111-1111-4111-8111-111111111111",
		OrganizationID: "22222222-2222-4222-8222-222222222222",
		IsTeamLeader:   true,
		Permissions:    []string{permissions.LeadViewTeam},
	}
	teamID := "33333333-3333-4333-8333-333333333333"
	repo := Repository{}
	selectedWhere, _, err := repo.buildDashboardLeadWhere(leader, DashboardFilter{TeamID: teamID}, dashboardLeadWhereOptions{})
	if err != nil {
		t.Fatalf("build selected-team dashboard where: %v", err)
	}
	visibility := selectedWhere[1]
	for _, fragment := range []string{
		"leader.is_leader = true",
		"member.team_id = leader.team_id",
		"member.user_id = l.assigned_user_id",
	} {
		if !strings.Contains(visibility, fragment) {
			t.Fatalf("leader visibility lacks assignee-team path %q: %s", fragment, visibility)
		}
	}
	if strings.Contains(visibility, "team_id', '') is null") {
		t.Fatalf("leader's assignee-team path must also admit leads from the broker's other teams: %s", visibility)
	}
	if teamClause := selectedWhere[len(selectedWhere)-1]; !strings.Contains(teamClause, "dtm.user_id = l.assigned_user_id") || strings.Contains(teamClause, "l.team_id") {
		t.Fatalf("selected dashboard team must follow assignee membership across lead origins: %s", teamClause)
	}

	allWhere, allArgs, err := repo.buildDashboardLeadWhere(leader, DashboardFilter{}, dashboardLeadWhereOptions{})
	if err != nil {
		t.Fatalf("build unfiltered dashboard where: %v", err)
	}
	userSQL := dashboardLeadDistributionUserSQL(allWhere, len(allArgs))
	teamSQL := dashboardLeadDistributionTeamSQL(allWhere, len(allArgs))
	if !strings.Contains(userSQL, visibility) || !strings.Contains(teamSQL, visibility) {
		t.Fatal("broker and team distributions must use the same leader lead scope as dashboard stats")
	}
	if !strings.Contains(userSQL, "group by assigned_user_id") ||
		!strings.Contains(teamSQL, "tm.user_id = f.assigned_user_id") ||
		!strings.Contains(teamSQL, "group by tm.team_id") {
		t.Fatal("distribution counts must follow the broker and all active teams they belong to")
	}
}
