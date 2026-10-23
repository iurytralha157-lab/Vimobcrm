package schedule

import (
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// History detail access matches the Agenda route gates, including the module
// requirement for administrators. Lead access alone never grants event details.
func CanReadHistoryDetails(actor tenant.Context) bool {
	return actor.HasModule("agenda") && canViewSchedule(actor)
}

// Managers' full scope is independent of a requester parameter. SQL callers
// must not bind an extra unused parameter for those queries.
func HistoryDetailsRequesterRequired(actor tenant.Context) bool {
	return CanReadHistoryDetails(actor) && !canViewAllScheduleEvents(actor)
}

// HistoryDetailsScopeSQL exposes the existing full-detail rule without changing
// Agenda list/mutation behavior. Aliases/placeholders are fixed internal SQL,
// never request input; the caller independently binds organization and lead.
func HistoryDetailsScopeSQL(actor tenant.Context, eventAlias, userPlaceholder string) string {
	if !CanReadHistoryDetails(actor) {
		return "false"
	}
	if canViewAllScheduleEvents(actor) {
		return "true"
	}
	teamScope := strings.ReplaceAll(scheduleEventTeamLeaderScopeSQL(userPlaceholder), "se.", eventAlias+".")
	return `(` + eventAlias + `.user_id = ` + userPlaceholder + `::uuid
		or exists (select 1 from public.schedule_event_assignees history_assignee
			where history_assignee.organization_id = ` + eventAlias + `.organization_id
			  and history_assignee.event_id = ` + eventAlias + `.id
			  and history_assignee.user_id = ` + userPlaceholder + `::uuid)
		or ` + eventAlias + `.visibility = 'public'
		or (` + eventAlias + `.visibility = 'default' and ` + teamScope + `)
	)`
}
