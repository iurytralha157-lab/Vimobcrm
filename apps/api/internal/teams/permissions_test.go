package teams

import (
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestCanManageTeamsDoesNotBypassManagerOverrides(t *testing.T) {
	manager := tenant.Context{UserID: "manager", OrganizationID: "org", MemberRole: "manager"}
	if canManageTeams(manager) {
		t.Fatal("manager role must not grant team management implicitly")
	}

	manager.Permissions = []string{permissions.TeamManage}
	if !canManageTeams(manager) {
		t.Fatal("explicit team_manage permission must grant access")
	}
}

func TestCanViewAllTeamsUsesEffectiveReadPermissionOutsideLeaderScope(t *testing.T) {
	manager := tenant.Context{
		UserID:         "manager",
		OrganizationID: "org",
		MemberRole:     "manager",
		Permissions:    []string{permissions.TeamView},
	}
	if !canViewAllTeams(manager) {
		t.Fatal("manager with team_view must receive organization-wide read access")
	}
	manager.IsTeamLeader = true
	manager.LedTeamIDs = []string{"led-team"}
	if !canViewAllTeams(manager) {
		t.Fatal("manager must retain organization-wide read access when also leading a team")
	}

	leader := manager
	leader.MemberRole = "user"
	leader.IsTeamLeader = true
	leader.LedTeamIDs = []string{"led-team"}
	if canViewAllTeams(leader) {
		t.Fatal("team leader must stay restricted to led teams")
	}
	if !canViewTeam(leader, "led-team") || canViewTeam(leader, "other-team") {
		t.Fatal("team leader visibility must follow led team ids")
	}
}

func TestCanManageTeamPipelineUsesPipelinePermissionAndLeaderScope(t *testing.T) {
	manager := tenant.Context{
		UserID:         "manager",
		OrganizationID: "org",
		MemberRole:     "manager",
		Permissions:    []string{permissions.PipelineManage},
	}
	if !canManageTeamPipeline(manager, "any-team") {
		t.Fatal("pipeline manager must be able to manage organization team links")
	}

	leader := manager
	leader.MemberRole = "user"
	leader.IsTeamLeader = true
	leader.LedTeamIDs = []string{"led-team"}
	if !canManageTeamPipeline(leader, "led-team") || canManageTeamPipeline(leader, "other-team") {
		t.Fatal("leader pipeline management must stay inside led teams")
	}

	manager.Permissions = []string{permissions.TeamManage}
	if canManageTeamPipeline(manager, "any-team") {
		t.Fatal("team_manage alone must not grant pipeline management")
	}
}
