package propertyscope

import (
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestCanReadAndViewAllPreserveCanonicalPropertyScope(t *testing.T) {
	settingsOnly := tenant.Context{MemberRole: "user", Permissions: []string{permissions.SettingsAI}}
	if CanRead(settingsOnly) {
		t.Fatal("settings_ai alone must not grant property visibility")
	}

	viewer := tenant.Context{MemberRole: "user", Permissions: []string{permissions.PropertyView}}
	if !CanRead(viewer) || CanViewAll(viewer) {
		t.Fatal("property_view must grant only scoped property visibility")
	}

	for _, legacyAlias := range []string{"property_view_all", "property_view_team"} {
		context := tenant.Context{MemberRole: "user", Permissions: []string{legacyAlias}}
		if !CanRead(context) || CanViewAll(context) || CanViewTeam(context) {
			t.Fatalf("legacy alias %q must resolve to own-only property_view", legacyAlias)
		}
	}

	manager := tenant.Context{MemberRole: "user", Permissions: []string{permissions.PropertyManage}}
	if !CanRead(manager) || !CanViewAll(manager) {
		t.Fatal("property_manage must grant organization-wide property visibility")
	}
}

func TestVisibilitySQLContainsOwnTeamAndAllBranches(t *testing.T) {
	clause := VisibilitySQL("p", "$4", "$5", "$6")
	for _, required := range []string{
		"$4::boolean",
		"p.responsible_user_id = $5::uuid",
		"p.created_by = $5::uuid",
		"$6::boolean",
		"from public.team_members leader",
		"member.organization_id = leader.organization_id",
		"member.is_active = true",
		"leader.organization_id = p.organization_id",
		"leader.is_active = true",
		"leader.is_leader = true",
		"member.user_id = p.responsible_user_id",
		"member.user_id = p.created_by",
	} {
		if !strings.Contains(clause, required) {
			t.Fatalf("canonical property visibility is missing %q: %s", required, clause)
		}
	}
}
