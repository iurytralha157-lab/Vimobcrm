package users

import (
	"os"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestCanManageOrganizationMemberRolePreventsPrivilegeEscalation(t *testing.T) {
	tests := []struct {
		name        string
		context     tenant.Context
		currentRole string
		desiredRole string
		want        bool
	}{
		{
			name:        "superadmin can manage owner",
			context:     tenant.Context{IsSuperAdmin: true},
			currentRole: "owner",
			desiredRole: "admin",
			want:        true,
		},
		{
			name:        "owner can promote user to admin",
			context:     tenant.Context{MemberRole: "owner"},
			currentRole: "user",
			desiredRole: "admin",
			want:        true,
		},
		{
			name:        "admin can demote peer admin",
			context:     tenant.Context{MemberRole: "admin"},
			currentRole: "admin",
			desiredRole: "user",
			want:        true,
		},
		{
			name:        "admin cannot alter owner",
			context:     tenant.Context{MemberRole: "admin"},
			currentRole: "owner",
			desiredRole: "user",
			want:        false,
		},
		{
			name: "manager with both explicit permissions cannot grant admin",
			context: tenant.Context{
				MemberRole:  "manager",
				Permissions: []string{"users_manage", "permissions_manage"},
			},
			currentRole: "user",
			desiredRole: "admin",
			want:        false,
		},
		{
			name: "manager cannot promote a peer to manager",
			context: tenant.Context{
				MemberRole:  "manager",
				Permissions: []string{"users_manage", "permissions_manage"},
			},
			currentRole: "user",
			desiredRole: "manager",
			want:        false,
		},
		{
			name: "admin with permission can promote user to manager",
			context: tenant.Context{
				MemberRole:  "admin",
				Permissions: []string{"users_manage", "permissions_manage"},
			},
			currentRole: "user",
			desiredRole: "manager",
			want:        true,
		},
		{
			name: "user manager can still manage peer users",
			context: tenant.Context{
				MemberRole:  "user",
				Permissions: []string{"users_manage"},
			},
			currentRole: "user",
			desiredRole: "user",
			want:        true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := canManageOrganizationMemberRole(test.context, test.currentRole, test.desiredRole); got != test.want {
				t.Fatalf("canManageOrganizationMemberRole() = %t, want %t", got, test.want)
			}
		})
	}
}

func TestUpdateOrganizationUserPreservesRawMemberRoleAndEnforcesAuthority(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read users repository source: %v", err)
	}
	text := string(source)
	start := strings.Index(text, "func (repo Repository) UpdateOrganizationUser(")
	end := strings.Index(text[start+1:], "\nfunc (")
	if start < 0 || end < 0 {
		t.Fatal("could not isolate UpdateOrganizationUser")
	}
	function := text[start : start+1+end]
	for _, required := range []string{
		"repo.organizationMemberRole",
		"canManageOrganizationMemberRole",
		"memberRole = desiredMemberRole",
	} {
		if !strings.Contains(function, required) {
			t.Fatalf("UpdateOrganizationUser is missing %q", required)
		}
	}
}
