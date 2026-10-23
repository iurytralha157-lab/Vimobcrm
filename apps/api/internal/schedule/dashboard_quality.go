package schedule

import "strings"

// The period's missing fields belong only to rows genuinely dated within that
// period. Terminal rows with neither result timestamp cannot be assigned to a
// result period: count those separately over the same authorized/filter scope,
// never invent a completion date from scheduling/updated_at or an executor.
func scheduleDashboardQualityCTEs(scope scheduleDashboardQueryScope) string {
	withoutPeriod := make([]string, 0, len(scope.where))
	for _, clause := range scope.where {
		if clause != scope.dateExpression+" >= bounds.from_at" && clause != scope.dateExpression+" < bounds.to_at" {
			withoutPeriod = append(withoutPeriod, clause)
		}
	}
	return `period_quality as (
		select count(*)::bigint as period_events,
		       count(*) filter (where missing_creator)::bigint as missing_created_by,
		       count(*) filter (where missing_source_snapshot)::bigint as missing_lead_source_snapshot,
		       count(*) filter (where status = 'completed' and missing_performer)::bigint as completed_without_performer,
		       count(*) filter (where status = 'completed' and missing_result_time)::bigint as completed_without_result_time
		from filtered_events
	), unknown_date_quality as (
		select count(*)::bigint as unknown_result_time_in_scope
		from public.schedule_events se cross join bounds
		` + scheduleLeadJoinSQL("se", "l", "$4", "$5", "$6", scope.canViewOwnLeads) + `
		where ` + strings.Join(withoutPeriod, " and ") + `
		  and lower(btrim(se.status)) in ('completed','cancelled','canceled','no_show')
		  and se.outcome_recorded_at is null and se.completed_at is null
	)`
}
