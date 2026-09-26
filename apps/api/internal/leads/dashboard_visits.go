package leads

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const dashboardVisitListLimit = 100
const dashboardVisitAlertListLimit = 20

// $3 is the active user in buildDashboardLeadWhere; the formatted placeholder
// is the organization admin flag appended by buildDashboardScheduledVisitsWhere. Keep this scope
// aligned with scheduleDashboardDetailScopeSQL in the Agenda domain.
const dashboardVisitEventVisibilitySQL = `(
	coalesce(se.visibility, 'default') = 'public'
	or $%[1]d::boolean
	or se.user_id = $3::uuid
	or exists (
		select 1 from public.schedule_event_assignees visit_assignee
		where visit_assignee.organization_id = se.organization_id
		  and visit_assignee.event_id = se.id
		  and visit_assignee.user_id = $3::uuid
	)
	or (
		coalesce(se.visibility, 'default') <> 'private'
		and exists (
			select 1
			from public.team_members visit_leader
			join public.team_members visit_member
			  on visit_member.organization_id = visit_leader.organization_id
			 and visit_member.team_id = visit_leader.team_id
			 and coalesce(visit_member.is_active, true) = true
			where visit_leader.organization_id = se.organization_id
			  and visit_leader.user_id = $3::uuid
			  and coalesce(visit_leader.is_active, true) = true
			  and coalesce(visit_leader.is_leader, false) = true
			  and (
				visit_member.user_id = se.user_id
				or exists (
					select 1 from public.schedule_event_assignees visit_team_assignee
					where visit_team_assignee.organization_id = se.organization_id
					  and visit_team_assignee.event_id = se.id
					  and visit_team_assignee.user_id = visit_member.user_id
				)
			  )
		)
	)
)`

type DashboardVisit struct {
	ID              string  `json:"id"`
	Title           string  `json:"title"`
	EventType       string  `json:"event_type"`
	Status          string  `json:"status"`
	CreatedAt       *string `json:"created_at"`
	StartTime       string  `json:"start_time"`
	EndTime         string  `json:"end_time"`
	LeadID          string  `json:"lead_id"`
	LeadName        string  `json:"lead_name"`
	Source          string  `json:"source"`
	CreatedByID     *string `json:"created_by_id"`
	CreatedByName   string  `json:"created_by_name"`
	CreatedByAvatar *string `json:"created_by_avatar"`
	OwnerID         string  `json:"owner_id"`
	OwnerName       string  `json:"owner_name"`
	IsUpcoming      bool    `json:"is_upcoming"`
	IsOverdue       bool    `json:"is_overdue"`
}

type DashboardVisitCreator struct {
	ID        *string `json:"id"`
	Name      string  `json:"name"`
	AvatarURL *string `json:"avatarUrl"`
	Count     int64   `json:"count"`
}

type DashboardVisitSource struct {
	Source string `json:"source"`
	Count  int64  `json:"count"`
}

type DashboardVisits struct {
	ReportTimezone  string                  `json:"reportTimezone"`
	Total           int64                   `json:"total"`
	Upcoming        int64                   `json:"upcoming"`
	Overdue         int64                   `json:"overdue"`
	Visits          []DashboardVisit        `json:"visits"`
	VisitsTruncated bool                    `json:"visitsTruncated"`
	UpcomingVisits  []DashboardVisit        `json:"upcomingVisits"`
	OverdueVisits   []DashboardVisit        `json:"overdueVisits"`
	Creators        []DashboardVisitCreator `json:"creators"`
	Sources         []DashboardVisitSource  `json:"sources"`
}

// GetDashboardVisits starts with the exact same event and lead predicate as
// the Visits KPI. The period is se.created_at; it is never applied a second
// time to leads.created_at. This also preserves Dashboard's visibility,
// attribution, team and pipeline filters for every detail and aggregate.
func (repo Repository) GetDashboardVisits(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) (DashboardVisits, error) {
	where, args, err := repo.buildDashboardScheduledVisitsWhere(tenantContext, filter)
	if err != nil {
		return DashboardVisits{}, err
	}

	args = append(args, dashboardVisitListLimit, dashboardVisitAlertListLimit)
	visitLimit := fmt.Sprintf("$%d", len(args)-1)
	alertLimit := fmt.Sprintf("$%d", len(args))

	query := `
		with timezone_config as (
			select coalesce((
				select zone.name
				from public.organization_attention_settings settings
				join pg_catalog.pg_timezone_names zone
				  on zone.name = nullif(btrim(settings.timezone), '')
				where settings.organization_id = $1::uuid
				limit 1
			), 'America/Sao_Paulo') as report_timezone
		), bounds as (
			select report_timezone, statement_timestamp() as as_of
			from timezone_config
		), filtered_visits as materialized (
			select
				se.id::text as id,
				left(coalesce(nullif(btrim(se.title), ''), 'Visita'), 500) as title,
				se.event_type,
				coalesce(se.status, 'scheduled') as status,
				se.created_at,
				se.start_time,
				se.end_time,
				l.id::text as lead_id,
				left(coalesce(nullif(btrim(l.name), ''), 'Lead sem nome'), 300) as lead_name,
				left(coalesce(nullif(btrim(l.source), ''), 'Sem origem'), 180) as source,
				se.created_by::text as created_by_id,
				left(coalesce(nullif(btrim(creator.name), ''), 'Não identificado'), 300) as created_by_name,
				left(creator.avatar_url, 2048) as created_by_avatar,
				se.user_id::text as owner_id,
				left(coalesce(nullif(btrim(owner.name), ''), 'Usuário removido'), 300) as owner_name,
				coalesce(se.status = 'scheduled' and se.start_time >= bounds.as_of, false) as is_upcoming,
				coalesce(se.status = 'scheduled' and case
					when coalesce(se.is_all_day, false) then
						(se.end_time at time zone bounds.report_timezone)::date
							< (bounds.as_of at time zone bounds.report_timezone)::date
					else se.end_time < bounds.as_of
				end, false) as is_overdue
			from public.schedule_events se
			join public.leads l
			  on l.id = se.lead_id
			 and l.organization_id = se.organization_id
			left join public.users creator on creator.id = se.created_by
			left join public.users owner on owner.id = se.user_id
			cross join bounds
			where ` + strings.Join(where, " and ") + `
		), totals as (
			select count(*)::bigint as total,
				count(*) filter (where is_upcoming)::bigint as upcoming,
				count(*) filter (where is_overdue)::bigint as overdue
			from filtered_visits
		)
		select jsonb_build_object(
			'reportTimezone', bounds.report_timezone,
			'total', totals.total,
			'upcoming', totals.upcoming,
			'overdue', totals.overdue,
			'visitsTruncated', totals.total > ` + visitLimit + `::integer,
			'visits', coalesce((
				select jsonb_agg(to_jsonb(recent) order by recent.created_at desc nulls last, recent.id)
				from (
					select * from filtered_visits
					order by created_at desc nulls last, id
					limit ` + visitLimit + `::integer
				) recent
			), '[]'::jsonb),
			'upcomingVisits', coalesce((
				select jsonb_agg(to_jsonb(next_visit) order by next_visit.start_time, next_visit.id)
				from (
					select * from filtered_visits where is_upcoming
					order by start_time, id
					limit ` + alertLimit + `::integer
				) next_visit
			), '[]'::jsonb),
			'overdueVisits', coalesce((
				select jsonb_agg(to_jsonb(late_visit) order by late_visit.end_time, late_visit.id)
				from (
					select * from filtered_visits where is_overdue
					order by end_time, id
					limit ` + alertLimit + `::integer
				) late_visit
			), '[]'::jsonb),
			'creators', coalesce((
				select jsonb_agg(jsonb_build_object(
					'id', ranked.created_by_id,
					'name', ranked.created_by_name,
					'avatarUrl', ranked.created_by_avatar,
					'count', ranked.visit_count
				) order by ranked.visit_count desc, ranked.created_by_name)
				from (
					select created_by_id, max(created_by_name) as created_by_name,
						max(created_by_avatar) as created_by_avatar, count(*)::bigint as visit_count
					from filtered_visits
					group by created_by_id
					order by visit_count desc, created_by_name
					limit 50
				) ranked
			), '[]'::jsonb),
			'sources', coalesce((
				select jsonb_agg(jsonb_build_object('source', ranked.source, 'count', ranked.visit_count)
					order by ranked.visit_count desc, ranked.source)
				from (
					select source, count(*)::bigint as visit_count
					from filtered_visits
					group by source
					order by visit_count desc, source
					limit 50
				) ranked
			), '[]'::jsonb)
		)::text
		from totals cross join bounds`

	var raw []byte
	if err := repo.db.Pool().QueryRow(ctx, query, args...).Scan(&raw); err != nil {
		return DashboardVisits{}, err
	}
	var result DashboardVisits
	if err := json.Unmarshal(raw, &result); err != nil {
		return DashboardVisits{}, fmt.Errorf("decode dashboard visits: %w", err)
	}
	return result, nil
}
