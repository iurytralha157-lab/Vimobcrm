package tenant

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestContextHasPermission(t *testing.T) {
	tests := []struct {
		name       string
		ctx        Context
		permission string
		want       bool
	}{
		{
			name:       "super admin always allowed",
			ctx:        Context{IsSuperAdmin: true},
			permission: "lead_manage",
			want:       true,
		},
		{
			name:       "owner always allowed",
			ctx:        Context{MemberRole: "owner"},
			permission: "lead_manage",
			want:       true,
		},
		{
			name:       "explicit permission allowed",
			ctx:        Context{Permissions: []string{"lead_view_all", "lead_manage"}},
			permission: "lead_manage",
			want:       true,
		},
		{
			name:       "missing permission denied",
			ctx:        Context{Permissions: []string{"lead_view_all"}},
			permission: "lead_manage",
			want:       false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.ctx.HasPermission(tt.permission); got != tt.want {
				t.Fatalf("HasPermission() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestContextHasModule(t *testing.T) {
	tenantContext := Context{EnabledModules: []string{"CRM", " Gamification "}}

	if !tenantContext.HasModule("gamification") {
		t.Fatal("expected enabled module to be matched case insensitively")
	}
	if tenantContext.HasModule("automations") {
		t.Fatal("disabled module must not be available")
	}
	if tenantContext.HasModule(" ") {
		t.Fatal("empty module must not be available")
	}
}

func TestCloneContextPreservesEmptyContractArrays(t *testing.T) {
	for _, permissions := range [][]string{nil, {}} {
		cloned := cloneContext(Context{Permissions: permissions, EnabledModules: nil})

		if cloned.Permissions == nil {
			t.Fatal("expected empty permissions to remain a non-nil array")
		}
		if len(cloned.Permissions) != 0 {
			t.Fatalf("expected no permissions, got %v", cloned.Permissions)
		}
		if cloned.EnabledModules == nil {
			t.Fatal("expected empty enabled modules to remain a non-nil array")
		}

		payload, err := json.Marshal(cloned)
		if err != nil {
			t.Fatalf("marshal cloned context: %v", err)
		}
		if !strings.Contains(string(payload), `"permissions":[]`) {
			t.Fatalf("expected permissions array in JSON, got %s", payload)
		}
		if !strings.Contains(string(payload), `"enabledModules":[]`) {
			t.Fatalf("expected enabled modules array in JSON, got %s", payload)
		}
	}
}

func TestContextHasRoleUsesOrganizationMembershipOnly(t *testing.T) {
	tests := []struct {
		name string
		ctx  Context
		role string
		want bool
	}{
		{
			name: "organization admin allowed",
			ctx:  Context{MemberRole: "admin", UserRole: "user"},
			role: "admin",
			want: true,
		},
		{
			name: "global admin does not leak into organization",
			ctx:  Context{MemberRole: "user", UserRole: "admin"},
			role: "admin",
			want: false,
		},
		{
			name: "super admin remains platform scoped",
			ctx:  Context{IsSuperAdmin: true},
			role: "admin",
			want: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.ctx.HasRole(tt.role); got != tt.want {
				t.Fatalf("HasRole(%q) = %v, want %v", tt.role, got, tt.want)
			}
		})
	}
}

func TestNormalizeUUID(t *testing.T) {
	valid := "550e8400-e29b-41d4-a716-446655440000"

	got, ok := normalizeUUID(" " + valid + " ")
	if !ok {
		t.Fatal("normalizeUUID() rejected a valid UUID")
	}
	if got != valid {
		t.Fatalf("normalizeUUID() = %q, want %q", got, valid)
	}

	if _, ok := normalizeUUID("not-a-uuid"); ok {
		t.Fatal("normalizeUUID() accepted an invalid UUID")
	}
}
