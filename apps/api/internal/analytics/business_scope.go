package analytics

import (
	"fmt"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/leadscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type businessAnalyticsScope struct {
	args  []any
	leads string
	users string
	teams string
	all   string
	user  string
	team  string
}

// Filters narrow this scope; they never grant access. The first argument is
// always the tenant organization. Roster membership is checked in SQL too,
// so revoking a team link cannot expose names through a stale actor snapshot.
// Keep the dashboard
// rule excluding unassigned cards for restricted readers without changing the
// shared Pipeline/WhatsApp queue-pool contract.
func newBusinessAnalyticsScope(viewer tenant.Context, args ...any) businessAnalyticsScope {
	all := fmt.Sprintf("$%d", len(args)+1)
	user := fmt.Sprintf("$%d", len(args)+2)
	team := fmt.Sprintf("$%d", len(args)+3)
	args = append(args, leadscope.CanViewAll(viewer), viewer.UserID, leadscope.CanViewTeam(viewer))
	return businessAnalyticsScope{
		args:  args,
		leads: "(" + leadscope.VisibilitySQL("l", all, user, team, leadscope.CanViewOwn(viewer)) + " and (" + all + "::boolean or l.assigned_user_id is not null))",
		all:   all, user: user, team: team,
	}
}

func (scope *businessAnalyticsScope) restrictUsers(viewer tenant.Context) {
	own := "false"
	if leadscope.CanViewOwn(viewer) {
		own = "true"
	}
	scope.users = "(" + scope.all + "::boolean or (" + own + " and u.id = " + scope.user + `::uuid) or (` + scope.team + `::boolean and exists (
		select 1 from public.team_members roster_member
		where roster_member.organization_id = $1::uuid
		  and roster_member.user_id = u.id
		  and roster_member.is_active = true
		  and roster_member.membership_generation = om.membership_generation
		  and ` + scope.currentLedTeamSQL("roster_member.team_id") + `)))`
}

func (scope *businessAnalyticsScope) restrictTeams() {
	scope.teams = "(" + scope.all + "::boolean or (" + scope.team + "::boolean and " + scope.currentLedTeamSQL("tm.team_id") + "))"
}

// teamExpression is a trusted SQL expression, never a caller-provided filter.
func (scope businessAnalyticsScope) currentLedTeamSQL(teamExpression string) string {
	return `exists (
		select 1 from public.team_members roster_leader
		join public.teams roster_team
		  on roster_team.id = roster_leader.team_id
		 and roster_team.organization_id = roster_leader.organization_id
		 and coalesce(roster_team.is_active, true) = true
		join public.organization_members roster_membership
		  on roster_membership.organization_id = roster_leader.organization_id
		 and roster_membership.user_id = roster_leader.user_id
		 and roster_membership.is_active = true
		 and roster_membership.deleted_at is null
		 and roster_membership.membership_generation = roster_leader.membership_generation
		join public.users roster_user on roster_user.id = roster_leader.user_id
		 and coalesce(roster_user.is_active, false) = true
		where roster_leader.organization_id = $1::uuid
		  and roster_leader.user_id = ` + scope.user + `::uuid
		  and roster_leader.team_id = ` + teamExpression + `
		  and roster_leader.is_active = true
		  and roster_leader.is_leader = true
	)`
}
