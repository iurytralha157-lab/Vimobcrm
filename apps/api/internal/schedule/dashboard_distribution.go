package schedule

// Additive dashboard series. Each one aggregates only filtered_events, so tenant,
// event-privacy and lead-visibility scoping stay those of the shared CTE.

// Outcome precedence mirrors how the Agenda presents an event: a reschedule is
// also a closed event, and a no-show on an activity that cannot have one stays
// out, exactly like the KPI. Open events enter only with a recorded outcome.
const scheduleDashboardOutcomeRowsCTE = `by_outcome_rows as (
			select outcome_key as key, count(*)::bigint as total
			from (
				select case
					when outcome = 'rescheduled' then 'rescheduled'
					when status = 'no_show' or outcome = 'no_show' then 'no_show'
					when status = 'cancelled' or outcome = 'cancelled' then 'cancelled'
					else coalesce(outcome, '__none__')
				end as outcome_key
				from filtered_events
				where (status in ('completed', 'cancelled', 'no_show') or outcome is not null)
				  and not (
					(status = 'no_show' or outcome is not distinct from 'no_show')
					and event_type not in ('visit', 'meeting')
				  )
			) outcome_events
			group by outcome_key
		)`

// An all-day event has no real hour on the scheduled basis, so it would pile up
// at midnight; on the created/result bases the instant is a real one.
func scheduleDashboardHourDistributionCTE(dateBasis DashboardDateBasis) string {
	allDayGuard := ""
	if dateBasis == DashboardDateBasisStartTime {
		allDayGuard = " and not filtered_events.is_all_day"
	}
	return `hour_distribution_rows as (
			select generated.hour::integer as report_hour, count(filtered_events.id)::bigint as total
			from generate_series(0, 23) as generated(hour)
			left join filtered_events on filtered_events.report_hour = generated.hour` + allDayGuard + `
			group by generated.hour
		)`
}
