package tenant

import "testing"

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
