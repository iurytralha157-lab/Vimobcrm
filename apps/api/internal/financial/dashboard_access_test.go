package financial

import (
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestDashboardFinancialAccessPreservesFinancialDomainScope(t *testing.T) {
	t.Setenv("FINANCIAL_ORGANIZATION_IDS", "")
	for _, scenario := range []struct {
		name, role, organization string
		grants                   []string
		read, manage             bool
	}{
		{"user without finance", "user", "Vetter Co.", []string{permissions.DashboardView}, false, false},
		{"leader without finance", "user", "Vetter Co.", []string{permissions.DashboardView, permissions.LeadViewTeam}, false, false},
		{"manager without finance", "manager", "Vetter Co.", []string{permissions.LeadViewAll}, false, false},
		{"financial reader", "user", "Vetter Co.", []string{permissions.FinancialView}, true, false},
		{"financial manager", "user", "Vetter Co.", []string{permissions.FinancialManage}, true, true},
		{"administrator", "admin", "Vetter Co.", nil, true, true},
		{"owner", "owner", "Vetter Co.", nil, true, true},
		{"disabled organization", "admin", "Synthetic Company", nil, false, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			actor := tenant.Context{UserID: "actor", OrganizationID: "organization", OrganizationName: scenario.organization,
				MemberRole: scenario.role, Permissions: scenario.grants}
			if got := CanReadDashboardFinancial(actor); got != scenario.read {
				t.Fatalf("read=%v want=%v", got, scenario.read)
			}
			if got := CanManageDashboardFinancial(actor); got != scenario.manage {
				t.Fatalf("manage=%v want=%v", got, scenario.manage)
			}
		})
	}
}

func TestDashboardFinancialAccessKeepsOrganizationAllowlist(t *testing.T) {
	t.Setenv("FINANCIAL_ORGANIZATION_IDS", "organization-a")
	actor := tenant.Context{UserID: "actor", OrganizationID: "organization-a", MemberRole: "admin"}
	if !CanReadDashboardFinancial(actor) {
		t.Fatal("configured organization was denied")
	}
	actor.OrganizationID = "organization-b"
	if CanReadDashboardFinancial(actor) {
		t.Fatal("other organization was authorized")
	}
	actor.OrganizationID = ""
	actor.OrganizationName = "Vetter Co."
	if CanReadDashboardFinancial(actor) {
		t.Fatal("missing organization was authorized")
	}
}
