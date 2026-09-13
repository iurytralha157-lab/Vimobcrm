package schedule

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/propertyscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const scheduleDashboardOverduePredicateSQL = `(
	se.status = 'scheduled'
	and case
		when coalesce(se.is_all_day, false) then
			(se.end_time at time zone bounds.report_timezone)::date
				< (bounds.as_of at time zone bounds.report_timezone)::date
		else se.end_time < bounds.as_of
	end
)`

func (repo Repository) Dashboard(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) (DashboardReport, error) {
	if !canViewSchedule(tenantContext) {
		return DashboardReport{}, tenant.ErrOrganizationAccessDenied
	}

	query, args, err := buildScheduleDashboardQuery(tenantContext, filter)
	if err != nil {
		return DashboardReport{}, err
	}

	var raw []byte
	if err := repo.db.Pool().QueryRow(ctx, query, args...).Scan(&raw); err != nil {
		return DashboardReport{}, err
	}

	var report DashboardReport
	if err := json.Unmarshal(raw, &report); err != nil {
		return DashboardReport{}, fmt.Errorf("decode schedule dashboard: %w", err)
	}
	report.Period = DashboardPeriod{
		DateFrom:  filter.DateFrom.Format(dashboardDateLayout),
		DateTo:    filter.DateTo.Format(dashboardDateLayout),
		DateBasis: filter.DateBasis,
	}
	report.normalizeCollections()
	return report, nil
}

func (repo Repository) DashboardEvents(ctx context.Context, tenantContext tenant.Context, filter DashboardEventsFilter) (DashboardEventsPage, error) {
	if !canViewSchedule(tenantContext) {
		return DashboardEventsPage{}, tenant.ErrOrganizationAccessDenied
	}

	query, args, err := buildScheduleDashboardEventsQuery(tenantContext, filter)
	if err != nil {
		return DashboardEventsPage{}, err
	}

	var raw []byte
	if err := repo.db.Pool().QueryRow(ctx, query, args...).Scan(&raw); err != nil {
		return DashboardEventsPage{}, err
	}

	var page DashboardEventsPage
	if err := json.Unmarshal(raw, &page); err != nil {
		return DashboardEventsPage{}, fmt.Errorf("decode schedule dashboard events: %w", err)
	}
	page.normalizeCollections()
	return page, nil
}

func buildScheduleDashboardEventsQuery(tenantContext tenant.Context, filter DashboardEventsFilter) (string, []any, error) {
	if filter.Limit < 1 || filter.Limit > maxDashboardEventsLimit {
		return "", nil, fmt.Errorf("%w: limit must be between 1 and %d", ErrInvalidInput, maxDashboardEventsLimit)
	}
	if filter.Offset < 0 {
		return "", nil, fmt.Errorf("%w: offset must be a non-negative integer", ErrInvalidInput)
	}

	scope, err := buildScheduleDashboardQueryScope(tenantContext, filter.DashboardFilter)
	if err != nil {
		return "", nil, err
	}

	args := append([]any(nil), scope.args...)
	args = append(args, filter.Limit)
	limitPlaceholder := fmt.Sprintf("$%d", len(args))
	args = append(args, filter.Offset)
	offsetPlaceholder := fmt.Sprintf("$%d", len(args))

	query := `
		with ` + scheduleDashboardFilteredEventsCTEs(scope) + `,
		paged_event_rows as (
			select
				filtered_events.id::text as id,
				filtered_events.title,
				filtered_events.event_type,
				filtered_events.start_time,
				filtered_events.end_time,
				filtered_events.is_all_day,
				filtered_events.user_id::text as user_id,
				left(coalesce(nullif(btrim(owner.name), ''), 'Usuário removido'), 255) as user_name,
				owner.avatar_url as user_avatar_url,
				lead.id::text as lead_id,
				left(nullif(btrim(lead.name), ''), 255) as lead_name,
				property.id::text as property_id,
				left(nullif(btrim(property.title), ''), 255) as property_title,
				left(nullif(btrim(property.code), ''), 120) as property_code,
				filtered_events.status,
				filtered_events.outcome,
				filtered_events.is_overdue
			from filtered_events
			left join public.users owner on owner.id = filtered_events.user_id
			left join public.leads lead
			  on lead.organization_id = filtered_events.organization_id
			 and lead.id = filtered_events.lead_id
			` + schedulePropertyJoinSQL("filtered_events", "property", "$9", "$10", "$11", "$12") + `
			order by filtered_events.start_time asc, filtered_events.id asc
			limit ` + limitPlaceholder + `::integer
			offset ` + offsetPlaceholder + `::bigint
		),
		page_totals as (
			select
				(select count(*)::bigint from filtered_events) as total,
				(select count(*)::bigint from paged_event_rows) as page_count
		)
		select jsonb_build_object(
			'items', coalesce((
				select jsonb_agg(to_jsonb(paged_event_rows) order by paged_event_rows.start_time, paged_event_rows.id)
				from paged_event_rows
			), '[]'::jsonb),
			'total', page_totals.total,
			'limit', ` + limitPlaceholder + `::integer,
			'offset', ` + offsetPlaceholder + `::bigint,
			'has_more', page_totals.total > ` + offsetPlaceholder + `::bigint
				and page_totals.total - ` + offsetPlaceholder + `::bigint > page_totals.page_count
		)::text
		from page_totals`

	return query, args, nil
}

func buildScheduleDashboardQuery(tenantContext tenant.Context, filter DashboardFilter) (string, []any, error) {
	scope, err := buildScheduleDashboardQueryScope(tenantContext, filter)
	if err != nil {
		return "", nil, err
	}

	query := `
		with ` + scheduleDashboardFilteredEventsCTEs(scope) + `,
		days as (
			select (bounds.date_from + generated.day_offset)::date as report_date
			from bounds
			cross join lateral generate_series(0, bounds.date_to - bounds.date_from) as generated(day_offset)
		),
		hours as (
			select generated.hour::integer as report_hour
			from bounds
			cross join lateral generate_series(0, 23) as generated(hour)
			where bounds.date_from = bounds.date_to
		),
		totals as (
			select
				count(*)::bigint as total,
				count(*) filter (
					where status in ('completed', 'no_show', 'cancelled') or is_overdue
				)::bigint as eligible,
				count(*) filter (
					where event_type in ('visit', 'meeting')
					  and (status in ('completed', 'no_show', 'cancelled') or is_overdue)
				)::bigint as appointment_eligible,
				count(*) filter (where status = 'scheduled')::bigint as open,
				count(*) filter (where is_overdue)::bigint as overdue,
				count(*) filter (where is_upcoming)::bigint as upcoming,
				count(*) filter (where event_type = 'visit')::bigint as visits,
				count(*) filter (where event_type = 'meeting')::bigint as meetings,
				count(*) filter (where event_type = 'call')::bigint as calls,
				count(*) filter (where status = 'completed')::bigint as completed,
				count(*) filter (where status = 'cancelled')::bigint as cancelled,
				count(*) filter (where status = 'no_show' and event_type in ('visit', 'meeting'))::bigint as no_show
			from filtered_events
		),
		daily_rows as (
			select
				days.report_date,
				count(filtered_events.id)::bigint as total,
				count(filtered_events.id) filter (where filtered_events.status = 'scheduled')::bigint as open,
				count(filtered_events.id) filter (where filtered_events.is_overdue)::bigint as overdue,
				count(filtered_events.id) filter (where filtered_events.status = 'completed')::bigint as completed,
				count(filtered_events.id) filter (where filtered_events.status = 'cancelled')::bigint as cancelled,
				count(filtered_events.id) filter (
					where filtered_events.status = 'no_show'
					  and filtered_events.event_type in ('visit', 'meeting')
				)::bigint as no_show
			from days
			left join filtered_events on filtered_events.report_date = days.report_date
			group by days.report_date
		),
		hourly_rows as (
			select
				hours.report_hour,
				count(filtered_events.id)::bigint as total,
				count(filtered_events.id) filter (where filtered_events.status = 'scheduled')::bigint as open,
				count(filtered_events.id) filter (where filtered_events.is_overdue)::bigint as overdue,
				count(filtered_events.id) filter (where filtered_events.status = 'completed')::bigint as completed,
				count(filtered_events.id) filter (where filtered_events.status = 'cancelled')::bigint as cancelled,
				count(filtered_events.id) filter (
					where filtered_events.status = 'no_show'
					  and filtered_events.event_type in ('visit', 'meeting')
				)::bigint as no_show
			from hours
			left join filtered_events on filtered_events.report_hour = hours.report_hour
			group by hours.report_hour
		),
		by_type_rows as (
			select event_type as key, count(*)::bigint as total
			from filtered_events
			group by event_type
		),
		by_source_rows as (
			select
				source_key as key,
				case when source_key = '__none__' then 'Sem origem' else source_key end as label,
				count(*)::bigint as total
			from filtered_events
			group by source_key
		),
		active_roster as (
			select users.id as user_id, users.name, users.avatar_url
			from public.users users
			join public.organization_members membership
			  on membership.organization_id = $1::uuid
			 and membership.user_id = users.id
			 and coalesce(membership.is_active, false) = true
			where coalesce(users.is_active, false) = true
			  and (
				$3::boolean
				or users.id = $2::uuid
				or exists (
					select 1
					from public.team_members leader
					join public.team_members member
					  on member.organization_id = leader.organization_id
					 and member.team_id = leader.team_id
					 and member.user_id = users.id
					 and coalesce(member.is_active, false) = true
					where leader.organization_id = $1::uuid
					  and leader.user_id = $2::uuid
					  and coalesce(leader.is_active, false) = true
					  and coalesce(leader.is_leader, false) = true
				)
			  )
			  and ($13::uuid is null or users.id = $13::uuid)
			  and (
				$14::uuid is null
				or exists (
					select 1
					from public.team_members selected_team_member
					where selected_team_member.organization_id = $1::uuid
					  and selected_team_member.team_id = $14::uuid
					  and selected_team_member.user_id = users.id
					  and coalesce(selected_team_member.is_active, false) = true
				)
			  )
		),
		event_responsibilities as materialized (
			select filtered_events.id as event_id, filtered_events.user_id
			from filtered_events
			where filtered_events.user_id is not null
			union
			select filtered_events.id as event_id, assignee.user_id
			from filtered_events
			join public.schedule_event_assignees assignee
			  on assignee.organization_id = filtered_events.organization_id
			 and assignee.event_id = filtered_events.id
		),
		scoped_responsibilities as materialized (
			select event_responsibilities.event_id, event_responsibilities.user_id
			from event_responsibilities
			join filtered_events responsibility_event
			  on responsibility_event.id = event_responsibilities.event_id
			where ($13::uuid is null or event_responsibilities.user_id = $13::uuid)
			  and (
				$14::uuid is null
				or responsibility_event.team_id = $14::uuid
				or (
					responsibility_event.team_id is null
					and exists (
						select 1
						from public.team_members responsibility_team_member
						where responsibility_team_member.organization_id = $1::uuid
						  and responsibility_team_member.team_id = $14::uuid
						  and responsibility_team_member.user_id = event_responsibilities.user_id
						  and coalesce(responsibility_team_member.is_active, false) = true
					)
				)
			  )
		),
		responsible_user_ids as (
			select user_id from active_roster
			union
			select user_id from scoped_responsibilities
		),
		responsible_counts as (
			select
				scoped_responsibilities.user_id,
				count(*)::bigint as total,
				count(*) filter (
					where filtered_events.status in ('completed', 'no_show', 'cancelled') or filtered_events.is_overdue
				)::bigint as eligible,
				count(*) filter (where filtered_events.event_type in ('visit', 'meeting'))::bigint as appointments,
				count(*) filter (
					where filtered_events.event_type in ('visit', 'meeting')
					  and (filtered_events.status in ('completed', 'no_show', 'cancelled') or filtered_events.is_overdue)
				)::bigint as appointment_eligible,
				count(*) filter (where filtered_events.status = 'scheduled')::bigint as open,
				count(*) filter (where filtered_events.status = 'completed')::bigint as completed,
				count(*) filter (
					where filtered_events.status = 'no_show'
					  and filtered_events.event_type in ('visit', 'meeting')
				)::bigint as no_show,
				count(*) filter (where filtered_events.is_overdue)::bigint as overdue
			from scoped_responsibilities
			join filtered_events on filtered_events.id = scoped_responsibilities.event_id
			group by scoped_responsibilities.user_id
		),
		performer_ranking_rows as (
			select
				responsible_user_ids.user_id::text as user_id,
				left(coalesce(nullif(btrim(users.name), ''), 'Usuário removido'), 255) as name,
				users.avatar_url,
				coalesce(responsible_counts.total, 0)::bigint as total,
				coalesce(responsible_counts.eligible, 0)::bigint as eligible,
				coalesce(responsible_counts.appointments, 0)::bigint as appointments,
				coalesce(responsible_counts.appointment_eligible, 0)::bigint as appointment_eligible,
				coalesce(responsible_counts.open, 0)::bigint as open,
				coalesce(responsible_counts.completed, 0)::bigint as completed,
				coalesce(responsible_counts.no_show, 0)::bigint as no_show,
				coalesce(responsible_counts.overdue, 0)::bigint as overdue,
				case
					when coalesce(responsible_counts.eligible, 0) = 0 then 0
					else round((responsible_counts.completed::numeric * 100) / responsible_counts.eligible, 2)
				end as completion_rate,
				case
					when coalesce(responsible_counts.appointment_eligible, 0) = 0 then 0
					else round((responsible_counts.no_show::numeric * 100) / responsible_counts.appointment_eligible, 2)
				end as no_show_rate
			from responsible_user_ids
			left join public.users users on users.id = responsible_user_ids.user_id
			left join responsible_counts on responsible_counts.user_id = responsible_user_ids.user_id
			order by total desc, completion_rate desc, name asc, user_id asc
		),
		overdue_owner_rows as (
			select user_id, name, avatar_url, overdue
			from performer_ranking_rows
			where overdue > 0
			order by overdue desc, name asc, user_id asc
		)
		select jsonb_build_object(
			'report_timezone', bounds.report_timezone,
			'kpis', jsonb_build_object(
				'total', totals.total,
				'eligible', totals.eligible,
				'appointment_eligible', totals.appointment_eligible,
				'open', totals.open,
				'overdue', totals.overdue,
				'upcoming', totals.upcoming,
				'visits', totals.visits,
				'meetings', totals.meetings,
				'calls', totals.calls,
				'completed', totals.completed,
				'cancelled', totals.cancelled,
				'no_show', totals.no_show,
				'completion_rate', case
					when totals.eligible = 0 then 0
					else round((totals.completed::numeric * 100) / totals.eligible, 2)
				end,
				'no_show_rate', case
					when totals.appointment_eligible = 0 then 0
					else round((totals.no_show::numeric * 100) / totals.appointment_eligible, 2)
				end
			),
			'daily', coalesce((
				select jsonb_agg(jsonb_build_object(
					'date', daily_rows.report_date::text,
					'total', daily_rows.total,
					'open', daily_rows.open,
					'overdue', daily_rows.overdue,
					'completed', daily_rows.completed,
					'cancelled', daily_rows.cancelled,
					'no_show', daily_rows.no_show
				) order by daily_rows.report_date)
				from daily_rows
			), '[]'::jsonb),
			'hourly', coalesce((
				select jsonb_agg(jsonb_build_object(
					'hour', hourly_rows.report_hour,
					'total', hourly_rows.total,
					'open', hourly_rows.open,
					'overdue', hourly_rows.overdue,
					'completed', hourly_rows.completed,
					'cancelled', hourly_rows.cancelled,
					'no_show', hourly_rows.no_show
				) order by hourly_rows.report_hour)
				from hourly_rows
			), '[]'::jsonb),
			'by_type', coalesce((
				select jsonb_agg(jsonb_build_object('key', key, 'count', total) order by total desc, key asc)
				from by_type_rows
			), '[]'::jsonb),
			'by_source', coalesce((
				select jsonb_agg(jsonb_build_object('key', key, 'label', label, 'count', total) order by total desc, key asc)
				from by_source_rows
			), '[]'::jsonb),
			'overdue_by_owner', coalesce((
				select jsonb_agg(to_jsonb(overdue_owner_rows) order by overdue_owner_rows.overdue desc, overdue_owner_rows.name, overdue_owner_rows.user_id)
				from overdue_owner_rows
			), '[]'::jsonb),
			'performer_ranking', coalesce((
				select jsonb_agg(to_jsonb(performer_ranking_rows) order by performer_ranking_rows.total desc, performer_ranking_rows.completion_rate desc, performer_ranking_rows.name, performer_ranking_rows.user_id)
				from performer_ranking_rows
			), '[]'::jsonb)
		)::text
		from bounds
		cross join totals`

	return query, scope.args, nil
}

type scheduleDashboardQueryScope struct {
	dateExpression string
	args           []any
	where          []string
}

func buildScheduleDashboardQueryScope(tenantContext tenant.Context, filter DashboardFilter) (scheduleDashboardQueryScope, error) {
	dateExpression, err := scheduleDashboardDateExpression(filter.DateBasis)
	if err != nil {
		return scheduleDashboardQueryScope{}, err
	}
	if filter.DateFrom.IsZero() || filter.DateTo.IsZero() || filter.DateTo.Before(filter.DateFrom) {
		return scheduleDashboardQueryScope{}, fmt.Errorf("%w: dashboard period is invalid", ErrInvalidInput)
	}
	periodDays := int(filter.DateTo.Sub(filter.DateFrom)/(24*time.Hour)) + 1
	if periodDays > maxDashboardPeriodDays {
		return scheduleDashboardQueryScope{}, fmt.Errorf("%w: dashboard date range is too large", ErrInvalidInput)
	}

	var selectedUserID any
	if filter.UserID != "" {
		selectedUserID = filter.UserID
	}
	var selectedTeamID any
	if filter.TeamID != "" {
		selectedTeamID = filter.TeamID
	}
	args := []any{
		tenantContext.OrganizationID,
		tenantContext.UserID,
		canViewAllScheduleEvents(tenantContext),
		canViewAllLeads(tenantContext),
		tenantContext.UserID,
		tenantContext.HasPermission(permissions.LeadViewTeam),
		filter.DateFrom.Format(dashboardDateLayout),
		filter.DateTo.Format(dashboardDateLayout),
		propertyscope.CanRead(tenantContext),
		propertyscope.CanViewAll(tenantContext),
		tenantContext.UserID,
		propertyscope.CanViewTeam(tenantContext),
		selectedUserID,
		selectedTeamID,
	}
	where := []string{
		"se.organization_id = $1::uuid",
		scheduleEventListScopeSQL("$2", "$3"),
		scheduleEventListLeadVisibilitySQL(
			"$3",
			"$2",
			"$4",
			"$5",
			"$6",
			tenantContext.HasPermission(permissions.LeadViewOwn),
		),
		scheduleDashboardDetailScopeSQL("$2", "$3"),
		dateExpression + " >= bounds.from_at",
		dateExpression + " < bounds.to_at",
	}

	addFilter := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}

	if filter.UserID != "" {
		args = append(args, filter.UserID)
		index := len(args)
		where = append(where, fmt.Sprintf(`(
			se.user_id = $%d::uuid
			or exists (
				select 1
				from public.schedule_event_assignees dashboard_assignee
				where dashboard_assignee.organization_id = se.organization_id
				  and dashboard_assignee.event_id = se.id
				  and dashboard_assignee.user_id = $%d::uuid
			)
		)`, index, index))
	}
	if filter.TeamID != "" {
		args = append(args, filter.TeamID)
		index := len(args)
		where = append(where, fmt.Sprintf(`(
			se.team_id = $%d::uuid
			or (
			  se.team_id is null
			  and exists (
				select 1
				from public.team_members dashboard_team_member
				where dashboard_team_member.organization_id = se.organization_id
				  and dashboard_team_member.team_id = $%d::uuid
				  and dashboard_team_member.is_active = true
				  and (
					dashboard_team_member.user_id = se.user_id
					or exists (
						select 1
						from public.schedule_event_assignees dashboard_team_assignee
						where dashboard_team_assignee.organization_id = se.organization_id
						  and dashboard_team_assignee.event_id = se.id
						  and dashboard_team_assignee.user_id = dashboard_team_member.user_id
					)
				  )
			  )
			)
		)`, index, index))
	}
	if filter.Source == "__none__" {
		where = append(where, "coalesce(nullif(btrim(se.lead_source_snapshot), ''), left(nullif(btrim(l.source), ''), 160), '__none__') = '__none__'")
	} else if filter.Source != "" {
		addFilter("coalesce(nullif(btrim(se.lead_source_snapshot), ''), left(nullif(btrim(l.source), ''), 160), '__none__') = $%d", filter.Source)
	}
	if filter.EventType != "" {
		addFilter("lower(btrim(se.event_type)) = $%d", filter.EventType)
	}
	switch filter.Status {
	case "cancelled", "canceled":
		where = append(where, "lower(btrim(se.status)) in ('cancelled', 'canceled')")
	case "overdue":
		where = append(where, scheduleDashboardOverduePredicateSQL)
	case "upcoming":
		where = append(where, "se.status = 'scheduled'", "se.start_time >= bounds.as_of")
	case "":
	default:
		addFilter("se.status = $%d", filter.Status)
	}

	return scheduleDashboardQueryScope{
		dateExpression: dateExpression,
		args:           args,
		where:          where,
	}, nil
}

func scheduleDashboardFilteredEventsCTEs(scope scheduleDashboardQueryScope) string {
	return `timezone_config as (
			select coalesce(
				(
					select timezone_name.name
					from public.organization_attention_settings organization_settings
					join pg_catalog.pg_timezone_names timezone_name
					  on timezone_name.name = nullif(btrim(organization_settings.timezone), '')
					where organization_settings.organization_id = $1::uuid
					limit 1
				),
				'America/Sao_Paulo'
			) as report_timezone
		),
		bounds as (
			select
				timezone_config.report_timezone,
				$7::date as date_from,
				$8::date as date_to,
				$13::uuid as selected_user_id,
				$14::uuid as selected_team_id,
				(($7::date)::timestamp without time zone at time zone timezone_config.report_timezone) as from_at,
				((($8::date + 1)::timestamp without time zone) at time zone timezone_config.report_timezone) as to_at,
				statement_timestamp() as as_of
			from timezone_config
		),
		filtered_events as materialized (
			select
				se.id,
				se.organization_id,
				se.user_id,
				se.team_id,
				se.lead_id,
				se.property_id,
				left(coalesce(nullif(btrim(se.title), ''), 'Compromisso'), 255) as title,
				case
					when lower(btrim(se.event_type)) in ('call', 'email', 'meeting', 'task', 'message', 'visit')
						then lower(btrim(se.event_type))
					else '__unknown__'
				end as event_type,
				case coalesce(nullif(lower(btrim(se.status)), ''), 'scheduled')
					when 'canceled' then 'cancelled'
					when 'cancelled' then 'cancelled'
					when 'scheduled' then 'scheduled'
					when 'completed' then 'completed'
					when 'no_show' then 'no_show'
					else '__unknown__'
				end as status,
				coalesce(
					nullif(btrim(se.lead_source_snapshot), ''),
					left(nullif(btrim(l.source), ''), 160),
					'__none__'
				) as source_key,
				case
					when lower(btrim(se.outcome)) in (
						'contacted', 'activity_completed', 'qualified', 'proposal',
						'visit_completed', 'meeting_completed', 'follow_up', 'no_show',
						'rescheduled', 'cancelled', 'other'
					) then lower(btrim(se.outcome))
					else null
				end as outcome,
				se.start_time,
				se.end_time,
				coalesce(se.is_all_day, false) as is_all_day,
				` + scheduleDashboardOverduePredicateSQL + ` as is_overdue,
				(
					se.status = 'scheduled'
					and se.start_time >= bounds.as_of
				) as is_upcoming,
				(` + scope.dateExpression + ` at time zone bounds.report_timezone)::date as report_date,
				extract(hour from (` + scope.dateExpression + ` at time zone bounds.report_timezone))::integer as report_hour
			from public.schedule_events se
			cross join bounds
			left join public.leads l
			  on l.organization_id = se.organization_id
			 and l.id = se.lead_id
			where ` + strings.Join(scope.where, " and ") + `
		)`
}

func scheduleDashboardDateExpression(dateBasis DashboardDateBasis) (string, error) {
	switch dateBasis {
	case DashboardDateBasisStartTime:
		return "se.start_time", nil
	case DashboardDateBasisCreatedAt:
		return "se.created_at", nil
	case DashboardDateBasisCompletedAt:
		return "coalesce(se.outcome_recorded_at, se.completed_at)", nil
	default:
		return "", fmt.Errorf("%w: dateBasis is invalid", ErrInvalidInput)
	}
}

func scheduleDashboardDetailScopeSQL(userIDPlaceholder string, canViewAllPlaceholder string) string {
	return `(
		coalesce(se.visibility, 'default') = 'public'
		or ` + canViewAllPlaceholder + `::boolean
		or se.user_id = ` + userIDPlaceholder + `::uuid
		or exists (
			select 1
			from public.schedule_event_assignees dashboard_scope_assignee
			where dashboard_scope_assignee.organization_id = se.organization_id
			  and dashboard_scope_assignee.event_id = se.id
			  and dashboard_scope_assignee.user_id = ` + userIDPlaceholder + `::uuid
		)
		or (
			coalesce(se.visibility, 'default') <> 'private'
			and ` + scheduleEventTeamLeaderScopeSQL(userIDPlaceholder) + `
		)
	)`
}

func (report *DashboardReport) normalizeCollections() {
	if report.Daily == nil {
		report.Daily = []DashboardDailyPoint{}
	}
	if report.Hourly == nil {
		report.Hourly = []DashboardHourlyPoint{}
	}
	if report.Weekly == nil {
		report.Weekly = []DashboardWeeklyPoint{}
	}
	if report.ByType == nil {
		report.ByType = []DashboardCount{}
	}
	if report.BySource == nil {
		report.BySource = []DashboardSourceCount{}
	}
	if report.ByOutcome == nil {
		report.ByOutcome = []DashboardCount{}
	}
	if report.UpcomingEvents == nil {
		report.UpcomingEvents = []DashboardUpcomingEvent{}
	}
	if report.OverdueByOwner == nil {
		report.OverdueByOwner = []DashboardOverdueOwner{}
	}
	if report.PerformerRanking == nil {
		report.PerformerRanking = []DashboardPerformerRanking{}
	}
	if report.TopPerformers == nil {
		report.TopPerformers = []DashboardTopPerformer{}
	}
}

func (page *DashboardEventsPage) normalizeCollections() {
	if page.Items == nil {
		page.Items = []DashboardEventItem{}
	}
}
