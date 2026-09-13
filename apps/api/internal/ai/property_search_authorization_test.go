package ai

import (
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/propertyscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestAIPropertySearchRequiresPropertyAccess(t *testing.T) {
	settingsOnly := tenant.Context{
		OrganizationID: "00000000-0000-4000-8000-000000000001",
		UserID:         "00000000-0000-4000-8000-000000000002",
		MemberRole:     "user",
		Permissions:    []string{permissions.SettingsAI},
	}
	if propertyscope.CanRead(settingsOnly) {
		t.Fatal("settings_ai alone must not expose property candidates")
	}

	withView := settingsOnly
	withView.Permissions = []string{permissions.SettingsAI, permissions.PropertyView}
	if !propertyscope.CanRead(withView) {
		t.Fatal("property_view must allow scoped property candidates")
	}

	withManage := settingsOnly
	withManage.Permissions = []string{permissions.SettingsAI, permissions.PropertyManage}
	if !propertyscope.CanRead(withManage) || !propertyscope.CanViewAll(withManage) {
		t.Fatal("property_manage must allow organization-wide property candidates")
	}
}

func TestAIPropertySearchVisibilityMatchesOwnTeamAndAllScope(t *testing.T) {
	clause := propertyscope.VisibilitySQL("p", "$4", "$5", "$6")
	for _, required := range []string{
		"$4::boolean",
		"p.responsible_user_id = $5::uuid",
		"p.created_by = $5::uuid",
		"$6::boolean",
		"from public.team_members leader",
		"member.user_id = p.responsible_user_id",
		"member.user_id = p.created_by",
	} {
		if !strings.Contains(clause, required) {
			t.Fatalf("AI property scope is missing %q: %s", required, clause)
		}
	}

	regular := tenant.Context{Permissions: []string{permissions.PropertyView}}
	if propertyscope.CanViewAll(regular) || propertyscope.CanViewTeam(regular) {
		t.Fatal("property_view alone must remain own-scoped")
	}
	leader := regular
	leader.IsTeamLeader = true
	if !propertyscope.CanViewTeam(leader) {
		t.Fatal("team leaders must receive team-scoped property candidates")
	}
}
