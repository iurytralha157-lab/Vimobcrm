package analytics

import (
	"os"
	"strings"
	"testing"
)

func TestMarketingTeamFilterUsesCurrentMembershipAndUnassignedQueueOnly(t *testing.T) {
	for _, required := range []string{
		"params.team_id is null",
		"params.unassigned and lead.team_id = params.team_id",
		"not params.unassigned and exists (",
		"member.organization_id = lead.organization_id",
		"member.team_id = params.team_id",
		"member.user_id = lead.assigned_user_id",
		"team.organization_id = member.organization_id and team.is_active = true",
		"coalesce(assignee.is_active, false) = true",
		"membership.organization_id = member.organization_id",
		"membership.user_id = member.user_id",
		"coalesce(membership.is_active, false) = true",
		"membership.deleted_at is null",
		"membership.membership_generation = member.membership_generation",
		"coalesce(member.is_active, true) = true",
	} {
		if !strings.Contains(campaignInsightsTeamFilterSQL, required) {
			t.Errorf("stale, inactive or foreign membership can bypass %q", required)
		}
	}
	// Multiple memberships are valid across teams and organizations. EXISTS
	// must not multiply attributed leads or require the user's primary org.
	if strings.Count(campaignInsightsTeamFilterSQL, "exists (") != 1 || strings.Contains(campaignInsightsTeamFilterSQL, "assignee.organization_id") {
		t.Fatal("team filtering lost multi-membership semantics")
	}
	source, err := os.ReadFile("marketing_repository.go")
	if err != nil {
		t.Fatal(err)
	}
	query := string(source)
	if !strings.Contains(query, "and `+campaignInsightsTeamFilterSQL+`") || strings.Contains(query, "and (params.team_id is null or lead.team_id = params.team_id)") {
		t.Fatal("the canonical CRM cohort still uses queue provenance instead of current membership")
	}
	if !strings.Contains(query, "and lead.organization_id = $1::uuid") || !strings.Contains(query, "and (not params.unassigned or lead.assigned_user_id is null)") {
		t.Fatal("the team predicate changed tenant scope or the unassigned cohort")
	}
}
