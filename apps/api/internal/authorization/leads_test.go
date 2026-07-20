package authorization

import (
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestLeadAuthorizationUsesVisibilityThenOperation(t *testing.T) {
	context := tenant.Context{
		UserID:         "user-1",
		OrganizationID: "org-1",
		Permissions:    []string{permissions.LeadViewAll},
	}
	lead := LeadResource{AssignedUserID: "user-2"}
	if !CanViewLead(context, lead) {
		t.Fatal("view-all user should see the lead")
	}
	if CanOperateLead(context, lead) {
		t.Fatal("read-only user must not operate the lead")
	}
	context.Permissions = append(context.Permissions, permissions.LeadOperate)
	if !CanOperateLead(context, lead) {
		t.Fatal("visible lead should be operable with lead_operate")
	}
}

func TestLeaderUsesTeamIDAndFallsBackForLegacyLead(t *testing.T) {
	context := tenant.Context{
		UserID:       "leader-1",
		Permissions:  []string{permissions.LeadViewTeam, permissions.LeadOperate},
		LedTeamIDs:   []string{"team-1"},
		LedUserIDs:   []string{"user-1"},
		IsTeamLeader: true,
	}
	if !CanOperateLead(context, LeadResource{AssignedUserID: "outside", TeamID: "team-1"}) {
		t.Fatal("leader should operate an explicit team lead")
	}
	if CanViewLead(context, LeadResource{AssignedUserID: "user-1", TeamID: "team-2"}) {
		t.Fatal("explicit foreign team_id must override assignee membership")
	}
	if !CanViewLead(context, LeadResource{AssignedUserID: "user-1"}) {
		t.Fatal("legacy lead without team_id should retain current visibility during migration")
	}
}

func TestLeadAuthorizationMatrix(t *testing.T) {
	tests := []struct {
		name                  string
		context               tenant.Context
		lead                  LeadResource
		view, operate, remove bool
	}{
		{"standard operates own lead", tenant.Context{UserID: "user-1", Permissions: []string{permissions.LeadViewOwn, permissions.LeadOperate}}, LeadResource{AssignedUserID: "user-1"}, true, true, false},
		{"standard operates own lead owned by another team", tenant.Context{UserID: "user-1", Permissions: []string{permissions.LeadViewOwn, permissions.LeadOperate}}, LeadResource{AssignedUserID: "user-1", TeamID: "team-2"}, true, true, false},
		{"standard cannot see another user lead", tenant.Context{UserID: "user-1", Permissions: []string{permissions.LeadViewOwn, permissions.LeadOperate}}, LeadResource{AssignedUserID: "user-2"}, false, false, false},
		{"leader operates explicit led team lead", tenant.Context{UserID: "leader", LedTeamIDs: []string{"team-1"}, Permissions: []string{permissions.LeadViewTeam, permissions.LeadOperate}}, LeadResource{AssignedUserID: "user-2", TeamID: "team-1"}, true, true, false},
		{"leader cannot see explicit foreign team lead", tenant.Context{UserID: "leader", LedTeamIDs: []string{"team-1"}, LedUserIDs: []string{"user-2"}, Permissions: []string{permissions.LeadViewTeam, permissions.LeadOperate}}, LeadResource{AssignedUserID: "user-2", TeamID: "team-2"}, false, false, false},
		{"view all remains read only without operate", tenant.Context{UserID: "auditor", Permissions: []string{permissions.LeadViewAll}}, LeadResource{AssignedUserID: "user-2"}, true, false, false},
		{"delete requires its own permission", tenant.Context{UserID: "user-1", Permissions: []string{permissions.LeadViewOwn, permissions.LeadOperate, permissions.LeadDelete}}, LeadResource{AssignedUserID: "user-1"}, true, true, true},
		{"admin bypasses individual keys", tenant.Context{UserID: "admin", MemberRole: "admin"}, LeadResource{AssignedUserID: "user-2", TeamID: "team-2"}, true, true, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := CanViewLead(tt.context, tt.lead); got != tt.view {
				t.Fatalf("CanViewLead() = %v, want %v", got, tt.view)
			}
			if got := CanOperateLead(tt.context, tt.lead); got != tt.operate {
				t.Fatalf("CanOperateLead() = %v, want %v", got, tt.operate)
			}
			if got := CanDeleteLead(tt.context, tt.lead); got != tt.remove {
				t.Fatalf("CanDeleteLead() = %v, want %v", got, tt.remove)
			}
		})
	}
}
