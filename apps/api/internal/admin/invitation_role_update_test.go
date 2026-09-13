package admin

import (
	"os"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestNormalizeInvitationRoleUpdate(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "user", input: "user", want: "user"},
		{name: "manager", input: " manager ", want: "manager"},
		{name: "admin", input: "admin", want: "admin"},
		{name: "empty", input: "", wantErr: true},
		{name: "owner", input: "owner", wantErr: true},
		{name: "super admin", input: "super_admin", wantErr: true},
		{name: "case is not silently changed", input: "ADMIN", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := normalizeInvitationRoleUpdate(test.input)
			if test.wantErr {
				if err == nil {
					t.Fatalf("normalizeInvitationRoleUpdate(%q) unexpectedly succeeded with %q", test.input, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("normalizeInvitationRoleUpdate(%q): %v", test.input, err)
			}
			if got != test.want {
				t.Fatalf("normalizeInvitationRoleUpdate(%q) = %q, want %q", test.input, got, test.want)
			}
		})
	}
}

func TestInvitationRoleUpdatePrivilegedAuthority(t *testing.T) {
	privilegedManager := tenant.Context{
		MemberRole:  "manager",
		Permissions: []string{"users_manage", "permissions_manage"},
	}
	for _, role := range []string{"manager", "admin"} {
		if !isPrivilegedInvitationRole(role) {
			t.Fatalf("%q must be treated as a privileged invitation role", role)
		}
		if canCreatePrivilegedInvitation(privilegedManager) {
			t.Fatalf("manager must not gain privileged-invitation authority for role %q through delegated permissions", role)
		}
	}
	if isPrivilegedInvitationRole("user") {
		t.Fatal("user invitation must not be treated as privileged")
	}
	if !canCreatePrivilegedInvitation(tenant.Context{IsSuperAdmin: true}) {
		t.Fatal("superadmin must retain privileged-invitation authority")
	}
}

func TestUpdateInvitationRoleScopesPendingRowAndPreservesCredentials(t *testing.T) {
	function := invitationFunctionSource(t, "repository.go", "UpdateInvitationRole")

	for _, required := range []string{
		"normalizeUUID(invitationID)",
		"normalizeUUID(tenantContext.OrganizationID)",
		"normalizeInvitationRoleUpdate(request.Role)",
		"isPrivilegedInvitationRole(desiredRole) && !canManagePrivileged",
		"organization_id = $2::uuid",
		"used_at is null",
		"expires_at > now()",
		"$4::boolean or coalesce(nullif(role, ''), 'user') not in ('admin', 'manager')",
		"to_jsonb(invitations) - 'token' - 'token_hash'",
		"errors.Is(err, pgx.ErrNoRows)",
	} {
		if !strings.Contains(function, required) {
			t.Fatalf("UpdateInvitationRole is missing contract guard %q", required)
		}
	}

	setStart := strings.Index(function, "set role = $3")
	whereStart := strings.Index(function, "where id = $1::uuid")
	if setStart < 0 || whereStart <= setStart {
		t.Fatal("could not isolate UpdateInvitationRole SET clause")
	}
	setClause := function[setStart:whereStart]
	if !strings.Contains(setClause, "updated_at = now()") {
		t.Fatal("role update must advance updated_at")
	}
	for _, forbidden := range []string{"token", "token_hash", "expires_at"} {
		if strings.Contains(setClause, forbidden) {
			t.Fatalf("UpdateInvitationRole must preserve %s; SET clause was %q", forbidden, setClause)
		}
	}
}

func TestInvitationAcceptanceClaimsLatestPersistedRoleBeforeMembership(t *testing.T) {
	lookup := invitationFunctionSource(t, "invitation_accept.go", "invitationByTokenForAccept")
	if !strings.Contains(lookup, "item.TokenHash = tokenHash") {
		t.Fatal("acceptance lookup must retain the hash of the presented token for the atomic claim")
	}

	claim := invitationFunctionSource(t, "invitation_accept.go", "claimInvitationForActivation")
	for _, required := range []string{
		"update public.invitations",
		"set used_at = now()",
		"id = $1::uuid",
		"token_hash = $2",
		"used_at is null",
		"expires_at > now()",
		"returning coalesce(nullif(role, ''), 'user')",
		"errors.Is(err, pgx.ErrNoRows)",
	} {
		if !strings.Contains(claim, required) {
			t.Fatalf("atomic invitation claim is missing %q", required)
		}
	}

	activation := invitationFunctionSource(t, "invitation_accept.go", "activateInvitationForUser")
	claimIndex := strings.Index(activation, "claimInvitationForActivation(ctx, tx, invitation)")
	roleIndex := strings.Index(activation, "memberRoleFromInvitation(persistedRole)")
	membershipIndex := strings.Index(activation, "insert into public.organization_members")
	if claimIndex < 0 || roleIndex <= claimIndex || membershipIndex <= roleIndex {
		t.Fatal("acceptance must atomically claim and reread the persisted role before writing membership")
	}
	if strings.Contains(activation, "set used_at = now()") {
		t.Fatal("acceptance must not defer its invitation claim until after membership writes")
	}
}

func TestResendRechecksCurrentPrivilegedRoleAtTokenRotation(t *testing.T) {
	function := invitationFunctionSource(t, "repository.go", "ResendInvitation")
	guard := "$6::boolean or coalesce(nullif(role, ''), 'user') not in ('admin', 'manager')"
	if !strings.Contains(function, guard) {
		t.Fatal("resend must atomically recheck current privileged-role authority when rotating the token")
	}
	roleRefresh := strings.Index(function, `stringValue(item["role"])`)
	emailSend := strings.Index(function, "repo.sendInvitationEmail")
	if roleRefresh < 0 || emailSend <= roleRefresh {
		t.Fatal("resend email must use the role returned by the guarded token rotation")
	}
}

func invitationFunctionSource(t *testing.T, filename string, functionName string) string {
	t.Helper()
	source, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("read %s: %v", filename, err)
	}
	text := strings.ReplaceAll(string(source), "\r\n", "\n")
	start := strings.Index(text, "func (repo Repository) "+functionName+"(")
	if start < 0 {
		start = strings.Index(text, "func "+functionName+"(")
	}
	if start < 0 {
		t.Fatalf("could not find %s in %s", functionName, filename)
	}
	rest := text[start+1:]
	end := strings.Index(rest, "\nfunc ")
	if end < 0 {
		return text[start:]
	}
	return text[start : start+1+end]
}
