package leads

import (
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestDashboardTeamFilterPrioritizesLeadTeamID(t *testing.T) {
	context := tenant.Context{
		UserID:         "11111111-1111-4111-8111-111111111111",
		OrganizationID: "22222222-2222-4222-8222-222222222222",
		Permissions:    []string{permissions.LeadViewTeam, permissions.LeadOperate},
	}
	filter := DashboardFilter{TeamID: "33333333-3333-4333-8333-333333333333"}

	where, _, err := (Repository{}).buildDashboardLeadWhere(context, filter, dashboardLeadWhereOptions{})
	if err != nil {
		t.Fatalf("build dashboard lead where: %v", err)
	}
	query := strings.Join(where, " and ")
	if !strings.Contains(query, "to_jsonb(l)->>'team_id'") {
		t.Fatalf("team filter does not use lead team_id: %s", query)
	}
	if !strings.Contains(query, "is null") || !strings.Contains(query, "dtm.user_id = l.assigned_user_id") {
		t.Fatalf("team filter lost the legacy assignee fallback: %s", query)
	}
}
