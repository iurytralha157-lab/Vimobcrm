package leads

import (
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Use the production resolver rather than granting permissions directly: an
// ordinary broker receives defaults even without a custom role or overrides.
// PostgreSQL's queue-specific projection is exercised by the real-PG suite.
func TestQueuePoolClaimPermissionResolverContract(t *testing.T) {
	cases := []struct {
		name      string
		role      string
		leader    bool
		grants    []string
		overrides map[string]bool
		allowed   bool
	}{
		{name: "broker without roles or overrides", role: "user", allowed: true},
		{name: "unrelated custom role preserves defaults", role: "user", grants: []string{permissions.PropertyManage}, allowed: true},
		{name: "operation explicitly denied", role: "user", overrides: map[string]bool{permissions.LeadOperate: false}},
		{name: "legacy operation alias denied", role: "user", overrides: map[string]bool{"lead_transfer": false}},
		{name: "read scope explicitly denied", role: "user", overrides: map[string]bool{permissions.LeadViewOwn: false}},
		{name: "manager retains all read", role: "manager", overrides: map[string]bool{permissions.LeadViewOwn: false}, allowed: true},
		{name: "leader retains team read", role: "user", leader: true, overrides: map[string]bool{permissions.LeadViewOwn: false}, allowed: true},
		{name: "leader with every read denied", role: "user", leader: true, overrides: map[string]bool{
			permissions.LeadViewOwn: false, permissions.LeadViewTeam: false, permissions.LeadViewAll: false,
		}},
		{name: "custom legacy all read grant", role: "user", grants: []string{"lead_edit_all"}, overrides: map[string]bool{permissions.LeadViewOwn: false}, allowed: true},
		{name: "custom operation grant does not erase deny", role: "user", grants: []string{"lead_edit_all"}, overrides: map[string]bool{permissions.LeadOperate: false}},
		{name: "admin wildcard precedes deny", role: "admin", overrides: map[string]bool{permissions.LeadOperate: false, permissions.LeadViewOwn: false}, allowed: true},
		{name: "owner wildcard precedes deny", role: "owner", overrides: map[string]bool{permissions.LeadOperate: false}, allowed: true},
		{name: "custom wildcard precedes deny", role: "user", grants: []string{"*"}, overrides: map[string]bool{permissions.LeadOperate: false}, allowed: true},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			actor := tenant.Context{
				OrganizationID: "11111111-1111-4111-8111-111111111111",
				UserID:         "22222222-2222-4222-8222-222222222222",
				MemberRole:     test.role,
				IsTeamLeader:   test.leader,
				Permissions:    permissions.Resolve(test.role, test.leader, test.grants, test.overrides),
			}
			if got := canClaimQueuePool(actor); got != test.allowed {
				t.Fatalf("claim permission = %v, want %v; effective = %v", got, test.allowed, actor.Permissions)
			}
		})
	}
}

func TestQueuePoolClaimSuperAdminStillRequiresExplicitOrganization(t *testing.T) {
	actor := tenant.Context{UserID: "22222222-2222-4222-8222-222222222222", IsSuperAdmin: true}
	if canClaimQueuePool(actor) {
		t.Fatal("an organization must be selected before claim")
	}
	actor.OrganizationID = "11111111-1111-4111-8111-111111111111"
	if !canClaimQueuePool(actor) {
		t.Fatal("superadmin selected organization must pass the Go permission gate; SQL audience remains required")
	}
}
