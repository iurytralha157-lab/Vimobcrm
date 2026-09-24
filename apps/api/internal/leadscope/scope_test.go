package leadscope

import (
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestLeadScopeCapabilities(t *testing.T) {
	if CanRead(tenant.Context{Permissions: []string{permissions.SettingsAI, permissions.PropertyView}}) {
		t.Fatal("AI and property permissions must not grant lead visibility")
	}
	if !CanRead(tenant.Context{Permissions: []string{permissions.LeadViewOwn}}) {
		t.Fatal("lead_view_own must grant scoped lead visibility")
	}
	if !CanRead(tenant.Context{Permissions: []string{permissions.LeadViewTeam}}) {
		t.Fatal("lead_view_team must grant scoped lead visibility")
	}
	if !CanViewAll(tenant.Context{Permissions: []string{permissions.LeadViewAll}}) {
		t.Fatal("lead_view_all must grant organization-wide lead visibility")
	}
}

func TestLeadVisibilitySQLUsesRequestedAliasForOwnAndTeam(t *testing.T) {
	clause := VisibilitySQL("candidate", "$3", "$4", "$5", true)
	for _, required := range []string{
		"candidate.assigned_user_id = $4::uuid",
		"to_jsonb(candidate)->>'team_id'",
		"leader.organization_id = candidate.organization_id",
		"member.user_id = candidate.assigned_user_id",
		"coalesce(team.is_active, true) = true",
		"broker.is_active, false",
		"broker_membership.organization_id = member.organization_id",
		"broker_membership.user_id = member.user_id",
		"broker_membership.is_active, false",
		"broker_membership.deleted_at is null",
	} {
		if !strings.Contains(clause, required) {
			t.Fatalf("lead scope missing %q: %s", required, clause)
		}
	}
	if strings.Contains(clause, "nullif(to_jsonb(candidate)->>'team_id', '') is null") {
		t.Fatal("an explicit foreign team must not hide a lead assigned to a broker in a led team")
	}
	if strings.Contains(clause, "broker.organization_id = member.organization_id") {
		t.Fatal("a broker's primary profile organization must not replace active membership in the lead organization")
	}
}
