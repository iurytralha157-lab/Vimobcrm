package admin

import (
	"os"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestCanCreateAdminInvitationRequiresPrivilegedRole(t *testing.T) {
	tests := []struct {
		name    string
		context tenant.Context
		want    bool
	}{
		{name: "superadmin", context: tenant.Context{IsSuperAdmin: true}, want: true},
		{name: "owner", context: tenant.Context{MemberRole: "owner"}, want: true},
		{name: "admin", context: tenant.Context{MemberRole: "admin"}, want: true},
		{
			name: "manager with users and permissions manage",
			context: tenant.Context{
				MemberRole:  "manager",
				Permissions: []string{"users_manage", "permissions_manage"},
			},
			want: false,
		},
		{
			name: "delegated user",
			context: tenant.Context{
				MemberRole:  "user",
				Permissions: []string{"users_manage", "permissions_manage"},
			},
			want: false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := canCreatePrivilegedInvitation(test.context); got != test.want {
				t.Fatalf("canCreatePrivilegedInvitation() = %t, want %t", got, test.want)
			}
		})
	}
}

func TestCreateInvitationEnforcesAdminGrantAuthority(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read admin repository source: %v", err)
	}
	text := string(source)
	start := strings.Index(text, "func (repo Repository) CreateInvitation(")
	end := strings.Index(text[start+1:], "\nfunc (")
	if start < 0 || end < 0 {
		t.Fatal("could not isolate CreateInvitation")
	}
	function := text[start : start+1+end]
	guard := strings.Index(function, `(role == "admin" || role == "manager") && !canCreatePrivilegedInvitation`)
	insert := strings.Index(function, "insert into public.invitations")
	if guard < 0 || insert <= guard {
		t.Fatal("admin invitation authority must be enforced before persistence")
	}
}
