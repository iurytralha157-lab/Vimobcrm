package settings

import (
	"reflect"
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

func TestNormalizeRolePermissionKeysUsesCanonicalCatalog(t *testing.T) {
	got, ok := normalizeRolePermissionKeys([]string{
		" team_view ",
		"settings_teams",
		"team_view",
	})
	if !ok {
		t.Fatal("normalizeRolePermissionKeys() rejected known permissions")
	}
	want := []string{permissions.TeamView, permissions.TeamManage}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("normalizeRolePermissionKeys() = %v, want %v", got, want)
	}
}

func TestNormalizeRolePermissionKeysRejectsUnknownPermission(t *testing.T) {
	if _, ok := normalizeRolePermissionKeys([]string{"permission_that_does_not_exist"}); ok {
		t.Fatal("normalizeRolePermissionKeys() accepted an unknown permission")
	}
}

func TestDelegatedPermissionManagerCannotDelegatePermissionsTheyDoNotHold(t *testing.T) {
	delegated := tenant.Context{
		UserID:         "delegated-user",
		OrganizationID: "organization",
		MemberRole:     "user",
		Permissions: []string{
			permissions.PermissionsManage,
			permissions.TeamView,
		},
	}
	if !canDelegatePermissionKeys(delegated, []string{permissions.TeamView}) {
		t.Fatal("delegated permission manager must be able to delegate a permission they hold")
	}
	if canDelegatePermissionKeys(delegated, []string{permissions.UsersManage}) {
		t.Fatal("delegated permission manager must not delegate a permission they do not hold")
	}

	admin := tenant.Context{MemberRole: "admin"}
	if !canDelegatePermissionKeys(admin, []string{permissions.UsersManage, permissions.SettingsBilling}) {
		t.Fatal("organization admins retain unrestricted permission delegation")
	}
}

func TestDelegatedPermissionManagerCannotMutateOwnPermissionState(t *testing.T) {
	delegated := tenant.Context{
		UserID:      "delegated-user",
		MemberRole:  "user",
		Permissions: []string{permissions.PermissionsManage},
	}
	if canMutatePermissionTarget(delegated, delegated.UserID) {
		t.Fatal("delegated permission manager must not mutate their own permissions or custom role")
	}
	if !canMutatePermissionTarget(delegated, "another-user") {
		t.Fatal("delegated permission manager must still be able to manage another eligible user")
	}
	if !canMutatePermissionTarget(tenant.Context{UserID: "admin", MemberRole: "admin"}, "admin") {
		t.Fatal("organization admins retain the existing self-management flow")
	}
}

func TestPermissionTransitionEnforcesDelegationCeilingOnlyOnNewGrants(t *testing.T) {
	delegated := tenant.Context{
		MemberRole: "user",
		Permissions: []string{
			permissions.PermissionsManage,
			permissions.TeamView,
		},
	}

	if !canApplyPermissionTransition(
		delegated,
		[]string{permissions.UsersManage},
		[]string{permissions.UsersManage},
	) {
		t.Fatal("an unchanged pre-existing grant must not make an unrelated edit fail")
	}
	if canApplyPermissionTransition(
		delegated,
		[]string{},
		[]string{permissions.UsersManage},
	) {
		t.Fatal("a newly granted permission above the actor ceiling must be rejected")
	}
	if !canApplyPermissionTransition(
		delegated,
		[]string{},
		[]string{permissions.TeamView},
	) {
		t.Fatal("a newly granted permission held by the actor must be accepted")
	}
	if !canApplyPermissionTransition(
		delegated,
		[]string{permissions.UsersManage},
		[]string{},
	) {
		t.Fatal("revoking a grant must remain allowed")
	}
}
