package tenant

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
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

func TestContextHasBillingAccessAt(t *testing.T) {
	now := time.Date(2026, time.July, 28, 15, 0, 0, 0, time.UTC)
	before := now.Add(-time.Second)
	after := now.Add(time.Second)

	tests := []struct {
		name          string
		tenantContext Context
		want          bool
	}{
		{
			name:          "super admin bypasses billing without organization",
			tenantContext: Context{IsSuperAdmin: true},
			want:          true,
		},
		{
			name:          "regular user without organization fails closed",
			tenantContext: Context{SubscriptionType: "paid", SubscriptionStatus: "active"},
			want:          false,
		},
		{
			name: "active paid subscription is allowed",
			tenantContext: Context{
				OrganizationID:     "organization-1",
				SubscriptionType:   "paid",
				SubscriptionStatus: "active",
			},
			want: true,
		},
		{
			name: "billing values are normalized",
			tenantContext: Context{
				OrganizationID:     "organization-1",
				SubscriptionType:   " PAID ",
				SubscriptionStatus: " ACTIVE ",
			},
			want: true,
		},
		{
			name: "active free subscription is allowed",
			tenantContext: Context{
				OrganizationID:     "organization-1",
				SubscriptionType:   "free",
				SubscriptionStatus: "active",
			},
			want: true,
		},
		{
			name: "free subscription with inconsistent status fails closed",
			tenantContext: Context{
				OrganizationID:     "organization-1",
				SubscriptionType:   "free",
				SubscriptionStatus: "trial",
				TrialEndsAt:        &after,
			},
			want: false,
		},
		{
			name: "active trial is allowed before expiration",
			tenantContext: Context{
				OrganizationID:     "organization-1",
				SubscriptionType:   "trial",
				SubscriptionStatus: "trial",
				TrialEndsAt:        &after,
			},
			want: true,
		},
		{
			name: "trial is denied at exact expiration timestamp",
			tenantContext: Context{
				OrganizationID:     "organization-1",
				SubscriptionType:   "trial",
				SubscriptionStatus: "trial",
				TrialEndsAt:        &now,
			},
			want: false,
		},
		{
			name: "expired trial is denied",
			tenantContext: Context{
				OrganizationID:     "organization-1",
				SubscriptionType:   "trial",
				SubscriptionStatus: "trial",
				TrialEndsAt:        &before,
			},
			want: false,
		},
		{
			name: "trial without expiration fails closed",
			tenantContext: Context{
				OrganizationID:     "organization-1",
				SubscriptionType:   "trial",
				SubscriptionStatus: "trial",
			},
			want: false,
		},
		{
			name: "trial type with paid status fails closed",
			tenantContext: Context{
				OrganizationID:     "organization-1",
				SubscriptionType:   "trial",
				SubscriptionStatus: "active",
				TrialEndsAt:        &after,
			},
			want: false,
		},
		{
			name: "pending paid subscription remains blocked even with a grace timestamp",
			tenantContext: Context{
				OrganizationID:     "organization-1",
				SubscriptionType:   "paid",
				SubscriptionStatus: "pending_payment",
				BillingGraceUntil:  &after,
			},
			want: false,
		},
		{
			name: "overdue paid subscription is allowed during grace",
			tenantContext: Context{
				OrganizationID:     "organization-1",
				SubscriptionType:   "paid",
				SubscriptionStatus: "overdue",
				BillingGraceUntil:  &after,
			},
			want: true,
		},
		{
			name: "past due paid subscription is denied at grace boundary",
			tenantContext: Context{
				OrganizationID:     "organization-1",
				SubscriptionType:   "paid",
				SubscriptionStatus: "past_due",
				BillingGraceUntil:  &now,
			},
			want: false,
		},
		{
			name: "expired billing grace is denied",
			tenantContext: Context{
				OrganizationID:     "organization-1",
				SubscriptionType:   "paid",
				SubscriptionStatus: "overdue",
				BillingGraceUntil:  &before,
			},
			want: false,
		},
		{
			name: "overdue without grace is denied",
			tenantContext: Context{
				OrganizationID:     "organization-1",
				SubscriptionType:   "paid",
				SubscriptionStatus: "overdue",
			},
			want: false,
		},
		{
			name: "explicitly blocked cannot be rescued by grace",
			tenantContext: Context{
				OrganizationID:     "organization-1",
				SubscriptionType:   "paid",
				SubscriptionStatus: "blocked",
				BillingGraceUntil:  &after,
			},
			want: false,
		},
		{
			name: "suspended cannot be rescued by grace",
			tenantContext: Context{
				OrganizationID:     "organization-1",
				SubscriptionType:   "paid",
				SubscriptionStatus: "suspended",
				BillingGraceUntil:  &after,
			},
			want: false,
		},
		{
			name: "legacy canceled spelling fails closed",
			tenantContext: Context{
				OrganizationID:     "organization-1",
				SubscriptionType:   "paid",
				SubscriptionStatus: "canceled",
				BillingGraceUntil:  &after,
			},
			want: false,
		},
		{
			name: "cancelled cannot be rescued by grace",
			tenantContext: Context{
				OrganizationID:     "organization-1",
				SubscriptionType:   "paid",
				SubscriptionStatus: "cancelled",
				BillingGraceUntil:  &after,
			},
			want: false,
		},
		{
			name: "missing subscription type fails closed",
			tenantContext: Context{
				OrganizationID:     "organization-1",
				SubscriptionStatus: "active",
			},
			want: false,
		},
		{
			name: "missing subscription status fails closed",
			tenantContext: Context{
				OrganizationID:   "organization-1",
				SubscriptionType: "paid",
			},
			want: false,
		},
		{
			name: "unknown subscription type fails closed",
			tenantContext: Context{
				OrganizationID:     "organization-1",
				SubscriptionType:   "enterprise",
				SubscriptionStatus: "active",
			},
			want: false,
		},
		{
			name: "unknown subscription status fails closed",
			tenantContext: Context{
				OrganizationID:     "organization-1",
				SubscriptionType:   "paid",
				SubscriptionStatus: "processing",
				BillingGraceUntil:  &after,
			},
			want: false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := test.tenantContext.HasBillingAccessAt(now); got != test.want {
				t.Fatalf("HasBillingAccessAt() = %v, want %v", got, test.want)
			}
		})
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

func TestCloneContextCopiesBillingTimestamps(t *testing.T) {
	trialEndsAt := time.Date(2026, time.July, 29, 15, 0, 0, 0, time.UTC)
	graceUntil := trialEndsAt.Add(24 * time.Hour)
	source := Context{TrialEndsAt: &trialEndsAt, BillingGraceUntil: &graceUntil}

	cloned := cloneContext(source)

	if cloned.TrialEndsAt == source.TrialEndsAt || cloned.BillingGraceUntil == source.BillingGraceUntil {
		t.Fatal("billing timestamp pointers must not be shared by cached context clones")
	}
	if !cloned.TrialEndsAt.Equal(*source.TrialEndsAt) || !cloned.BillingGraceUntil.Equal(*source.BillingGraceUntil) {
		t.Fatal("billing timestamp values changed while cloning context")
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
