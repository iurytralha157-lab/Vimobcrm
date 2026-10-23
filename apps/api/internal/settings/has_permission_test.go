package settings

import (
	"context"
	"errors"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestHasPermissionRejectsUnknownKeysBeforePrivilegedRoleBypass(t *testing.T) {
	tests := []struct {
		name       string
		member     tenant.Context
		permission string
	}{
		{name: "missing key for super admin", member: tenant.Context{UserID: "user", IsSuperAdmin: true}},
		{name: "unknown key for owner", member: tenant.Context{UserID: "user", MemberRole: "owner"}, permission: "not_a_permission"},
		{name: "unknown key for admin", member: tenant.Context{UserID: "user", MemberRole: "admin"}, permission: "not_a_permission"},
		{name: "unknown key for member", member: tenant.Context{UserID: "user"}, permission: "not_a_permission"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			allowed, err := (Repository{}).HasPermission(context.Background(), test.member, test.permission)
			if allowed || !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("allowed = %t, error = %v; want false and ErrInvalidInput", allowed, err)
			}
		})
	}
}

func TestHasPermissionKeepsKnownKeysWorking(t *testing.T) {
	tests := []struct {
		name       string
		member     tenant.Context
		permission string
		want       bool
	}{
		{name: "owner", member: tenant.Context{UserID: "user", MemberRole: "owner"}, permission: permissions.UsersManage, want: true},
		{name: "explicit grant", member: tenant.Context{UserID: "user", Permissions: []string{permissions.UsersManage}}, permission: " USERS_MANAGE ", want: true},
		{name: "not granted", member: tenant.Context{UserID: "user"}, permission: permissions.UsersManage},
		{name: "no user", member: tenant.Context{MemberRole: "owner"}, permission: permissions.UsersManage},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			allowed, err := (Repository{}).HasPermission(context.Background(), test.member, test.permission)
			if err != nil || allowed != test.want {
				t.Fatalf("allowed = %t, error = %v; want %t and nil", allowed, err, test.want)
			}
		})
	}
}
