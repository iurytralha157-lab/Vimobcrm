package settings

import (
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestCanManageSettingDoesNotBypassManagerOverrides(t *testing.T) {
	manager := tenant.Context{UserID: "manager", OrganizationID: "org", MemberRole: "manager"}
	if canManageSetting(manager, permissions.SettingsOrganization) {
		t.Fatal("manager role must not grant organization settings implicitly")
	}

	manager.Permissions = []string{permissions.SettingsOrganization}
	if !canManageSetting(manager, permissions.SettingsOrganization) {
		t.Fatal("explicit settings permission must grant access")
	}
}
