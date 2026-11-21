package schedule

import (
	"context"
	"fmt"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) List(ctx context.Context, tenantContext tenant.Context, filter ListFilter) ([]Event, error) {
	page, err := repo.ListPage(ctx, tenantContext, filter)
	return page.Events, err
}

func (repo Repository) ListPage(ctx context.Context, tenantContext tenant.Context, filter ListFilter) (EventPage, error) {
	if !canViewSchedule(tenantContext) {
		return EventPage{}, tenant.ErrOrganizationAccessDenied
	}
	filter, err := normalizeScheduleListFilter(filter)
	if err != nil {
		return EventPage{}, err
	}
	canViewAll := canViewAllScheduleEvents(tenantContext)
	args := scheduleEventsQueryArgs(tenantContext, canViewAll)
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
	}

	addFilter := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}

	if filter.EventID != "" {
		addFilter("se.id = $%d::uuid", filter.EventID)
	}
	if filter.UserID != "" {
		args = append(args, filter.UserID)
		index := len(args)
		where = append(where, fmt.Sprintf(`(
			se.user_id = $%d::uuid
			or exists (
				select 1
				from public.schedule_event_assignees filter_sea
				where filter_sea.organization_id = se.organization_id
				  and filter_sea.event_id = se.id
				  and filter_sea.user_id = $%d::uuid
			)
		)`, index, index))
	}
	if filter.LeadID != "" {
		addFilter("se.lead_id = $%d::uuid", filter.LeadID)
		// Filtering must not reveal a relation hidden by the lead projection.
		// Appointment participation and busy-slot access grant no lead access.
		where = append(where, leadScheduleVisibilitySQL("$4", "$5", "$6", tenantContext.HasPermission(permissions.LeadViewOwn)))
	}
	if filter.StartTime != nil {
		addFilter("se.end_time >= $%d::timestamptz", *filter.StartTime)
	}
	if filter.EndTime != nil {
		addFilter("se.start_time <= $%d::timestamptz", *filter.EndTime)
	}

	args = append(args, filter.Limit+1, filter.Offset)
	query := scheduleEventsQuery(strings.Join(where, " and "), tenantContext.HasPermission(permissions.LeadViewOwn))
	if filter.LeadPreview {
		query = scheduleLeadPreviewEventsQuery(strings.Join(where, " and "), tenantContext.HasPermission(permissions.LeadViewOwn))
	}
	query += fmt.Sprintf(" limit $%d::integer offset $%d::bigint", len(args)-1, len(args))
	rows, err := repo.db.Pool().Query(ctx, query, args...)
	if err != nil {
		return EventPage{}, err
	}
	defer rows.Close()

	events := []Event{}
	for rows.Next() {
		event, err := scanEvent(rows)
		if err != nil {
			return EventPage{}, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return EventPage{}, err
	}

	return scheduleEventPage(events, filter), nil
}

func (repo Repository) Get(ctx context.Context, tenantContext tenant.Context, eventID string) (Event, error) {
	eventID, ok := normalizeUUID(eventID)
	if !ok {
		return Event{}, ErrEventNotFound
	}

	events, err := repo.List(ctx, tenantContext, ListFilter{EventID: eventID})
	if err != nil {
		return Event{}, err
	}
	if len(events) == 0 {
		return Event{}, ErrEventNotFound
	}

	return events[0], nil
}

func (repo Repository) Capabilities(ctx context.Context, tenantContext tenant.Context) (Capabilities, error) {
	var capabilities Capabilities
	err := repo.db.Pool().QueryRow(ctx, `
		select
			$3::boolean or exists (
				select 1
				from public.team_members tm
				join public.organization_members member
				  on member.organization_id = tm.organization_id
				 and member.user_id = tm.user_id
				 and member.membership_generation = tm.membership_generation
				 and member.is_active = true
				 and member.deleted_at is null
				where tm.organization_id = $1::uuid
				  and tm.user_id = $2::uuid
				  and tm.is_active = true
				  and tm.is_leader = true
			) as is_team_leader,
			coalesce(
				(
					select timezone_name.name
					from public.organization_attention_settings organization_settings
					join pg_catalog.pg_timezone_names timezone_name
					  on timezone_name.name = nullif(btrim(organization_settings.timezone), '')
					where organization_settings.organization_id = $1::uuid
					limit 1
				),
				'America/Sao_Paulo'
			) as time_zone
	`, tenantContext.OrganizationID, tenantContext.UserID, canManageSchedule(tenantContext)).Scan(
		&capabilities.IsTeamLeader,
		&capabilities.TimeZone,
	)
	if err != nil {
		return Capabilities{}, err
	}

	return capabilities, nil
}
