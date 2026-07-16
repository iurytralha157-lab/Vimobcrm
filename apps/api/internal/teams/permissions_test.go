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
