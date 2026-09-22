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
