package leads

import (
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestBuildDashboardPropertyWhereIgnoresPeriodForPropertyKPI(t *testing.T) {
	now := time.Now()
	where, _, err := buildDashboardPropertyWhere(tenant.Context{
		OrganizationID: "11111111-1111-1111-1111-111111111111",
		UserID:         "22222222-2222-2222-2222-222222222222",
		MemberRole:     "admin",
	}, DashboardFilter{DateFrom: &now, DateTo: &now}, false)
	if err != nil {
		t.Fatalf("buildDashboardPropertyWhere returned error: %v", err)
	}

	joined := strings.Join(where, " ")
	if strings.Contains(joined, "p.created_at") {
		t.Fatalf("property KPI must not apply dashboard period: %s", joined)
	}
}

func TestBuildDashboardPropertyWhereFiltersSelectedUserByResponsible(t *testing.T) {
	where, _, err := buildDashboardPropertyWhere(tenant.Context{
		OrganizationID: "11111111-1111-1111-1111-111111111111",
		UserID:         "22222222-2222-2222-2222-222222222222",
		MemberRole:     "admin",
	}, DashboardFilter{UserID: "33333333-3333-3333-3333-333333333333"}, false)
	if err != nil {
		t.Fatalf("buildDashboardPropertyWhere returned error: %v", err)
	}

	selectedUserClause := where[len(where)-1]
	if !strings.Contains(selectedUserClause, "p.responsible_user_id") {
		t.Fatalf("selected user must filter responsible properties: %s", selectedUserClause)
	}
	if strings.Contains(selectedUserClause, "p.created_by") {
		t.Fatalf("selected user must not count properties only created by the user: %s", selectedUserClause)
	}
}

func TestPropertyUserVisibilityKeepsOwnCreatedAndResponsibleProperties(t *testing.T) {
	clause := propertyUserVisibilitySQL("$2", "$3", "$4")
	if !strings.Contains(clause, "p.responsible_user_id = $3::uuid") {
		t.Fatalf("default user scope must include responsible properties: %s", clause)
	}
	if !strings.Contains(clause, "p.created_by = $3::uuid") {
		t.Fatalf("default user scope must include properties created by the user: %s", clause)
	}
}
