package schedule

import (
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/leadscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/propertyscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func scheduleEventsQueryArgs(tenantContext tenant.Context, canViewAllSchedule bool) []any {
	return []any{
		tenantContext.OrganizationID,
		tenantContext.UserID,
		canViewAllSchedule,
		canViewAllLeads(tenantContext),
		tenantContext.UserID,
		tenantContext.HasPermission(permissions.LeadViewTeam),
		propertyscope.CanRead(tenantContext),
		propertyscope.CanViewAll(tenantContext),
		tenantContext.UserID,
		propertyscope.CanViewTeam(tenantContext),
	}
}

func scheduleEventListScopeSQL(userIDPlaceholder string, canManagePlaceholder string) string {
	return `(
		se.visibility in ('default', 'public')
		or ` + scheduleEventScopeSQL(userIDPlaceholder, canManagePlaceholder) + `
	)`
}

func scheduleEventListLeadVisibilitySQL(canViewAllSchedulePlaceholder string, participantUserIDPlaceholder string, canViewAllLeadsPlaceholder string, leadUserIDPlaceholder string, canViewTeamPlaceholder string, canViewOwn bool) string {
	return `(
		se.visibility in ('default', 'public')
		or ` + scheduleEventLeadVisibilitySQL(
		canViewAllSchedulePlaceholder,
		participantUserIDPlaceholder,
		canViewAllLeadsPlaceholder,
		leadUserIDPlaceholder,
		canViewTeamPlaceholder,
		canViewOwn,
	) + `
	)`
}

func scheduleEventsQuery(whereClause string, canViewOwnLeads ...bool) string {
	return scheduleEventsQueryWithLeadJoin(whereClause, scheduleLeadJoinSQL("v", "l", "$4", "$5", "$6", scheduleCanViewOwnLeadProjection(canViewOwnLeads)))
}

func scheduleEventsQueryWithLeadJoin(whereClause string, leadJoin string) string {
	return scheduleEventsQueryWithOrder(whereClause, leadJoin, "v.start_time asc, v.id asc")
}

func scheduleEventsQueryWithOrder(whereClause string, leadJoin string, orderClause string) string {
	return `
		with base as (
			select
				se.*,
				coalesce(
					jsonb_agg(distinct sea.user_id::text) filter (where sea.user_id is not null),
					'[]'::jsonb
				)::text as assignee_user_ids_json,
				coalesce(bool_or(se.user_id = $2::uuid or sea.user_id = $2::uuid), false) as is_participant,
				$3::boolean as is_manager,
				` + scheduleEventTeamLeaderScopeSQL("$2") + ` as is_team_leader
			from public.schedule_events se
			left join public.schedule_event_assignees sea
			  on sea.organization_id = se.organization_id
			 and sea.event_id = se.id
			where ` + whereClause + `
			group by se.id
		),
		visible as (
			select
				base.*,
				(
					base.visibility = 'default'
					and not base.is_participant
					and not base.is_manager
					and not base.is_team_leader
				) as is_masked
			from base
			where base.visibility <> 'private'
			   or base.is_participant
			   or base.is_manager
		)
		select
			v.id::text,
			v.organization_id::text,
			case when v.is_masked then null else v.user_id::text end,
			case when v.is_masked or l.id is null then null else v.lead_id::text end,
			case when v.is_masked or p.id is null then null else v.property_id::text end,
			case when v.is_masked then null else v.created_by::text end,
			case when v.is_masked then null else v.team_id::text end,
			case when v.is_masked or l.id is null then null else v.lead_source_snapshot end,
			case when v.is_masked then 'Horario ocupado' else v.title end,
			case when v.is_masked then 'Informacao privada' else v.description end,
			case when v.is_masked then 'task' else coalesce(v.event_type, 'task') end,
			v.start_time,
			v.end_time,
			coalesce(v.is_all_day, false),
			case when v.is_masked then null else v.location end,
			v.status,
			v.visibility,
			v.reminder_minutes,
			v.recurrence_parent_id::text,
			v.recurrence_rule,
			v.recurrence_until,
			v.recurrence_count,
			case when v.is_masked then null else v.google_event_id end,
			case when v.is_masked then null else v.google_sync_status end,
			case when v.is_masked then null else v.google_sync_target end,
			case when v.is_masked then null else v.google_task_id end,
			case when v.is_masked then null else v.completed_by::text end,
			v.completed_at,
			case when v.is_masked then null else v.outcome end,
			case when v.is_masked then null else v.outcome_notes end,
			case when v.is_masked then null else v.performed_by::text end,
			v.outcome_recorded_at,
			case when v.is_masked then null else v.rescheduled_from_event_id::text end,
			case when v.is_masked then null else v.rescheduled_to_event_id::text end,
			v.created_at,
			v.updated_at,
			case when v.is_masked then null else u.id::text end,
			case when v.is_masked then null else u.name end,
			case when v.is_masked then null else u.avatar_url end,
			case when v.is_masked then null else l.id::text end,
			case when v.is_masked then null else l.name end,
			case when v.is_masked then null else l.phone end,
			case when v.is_masked then null else p.id::text end,
			case when v.is_masked then null else p.title end,
			case when v.is_masked then null else p.code end,
			case when v.is_masked then null else cu.id::text end,
			case when v.is_masked then null else cu.name end,
			case when v.is_masked then null else pu.id::text end,
			case when v.is_masked then null else pu.name end,
			case when v.is_masked then '[]' else v.assignee_user_ids_json end,
			v.is_masked
		from visible v
		left join public.users u on u.id = v.user_id
		` + leadJoin + `
		` + schedulePropertyJoinSQL("v", "p", "$7", "$8", "$9", "$10") + `
		left join public.users cu on cu.id = v.completed_by
		left join public.users pu on pu.id = v.performed_by
		order by ` + orderClause
}

func schedulePropertyJoinSQL(eventAlias string, propertyAlias string, canReadPlaceholder string, canViewAllPlaceholder string, userIDPlaceholder string, canViewTeamPlaceholder string) string {
	return `left join public.properties ` + propertyAlias + `
		  on ` + propertyAlias + `.id = ` + eventAlias + `.property_id
		 and ` + propertyAlias + `.organization_id = ` + eventAlias + `.organization_id
		 and ` + canReadPlaceholder + `::boolean
		 and ` + propertyscope.VisibilitySQL(propertyAlias, canViewAllPlaceholder, userIDPlaceholder, canViewTeamPlaceholder)
}

func scheduleEventScopeSQL(userIDPlaceholder string, canManagePlaceholder string) string {
	return `(
		` + canManagePlaceholder + `::boolean
		or se.user_id = ` + userIDPlaceholder + `::uuid
		or exists (
			select 1
			from public.schedule_event_assignees scope_self
			where scope_self.organization_id = se.organization_id
			  and scope_self.event_id = se.id
			  and scope_self.user_id = ` + userIDPlaceholder + `::uuid
		)
		or ` + scheduleEventTeamLeaderScopeSQL(userIDPlaceholder) + `
	)`
}

func scheduleEventTeamLeaderScopeSQL(userIDPlaceholder string) string {
	return `exists (
			select 1
			from public.team_members leader
			join public.teams scope_team_entity
			  on scope_team_entity.id = leader.team_id
			 and scope_team_entity.organization_id = leader.organization_id
			 and coalesce(scope_team_entity.is_active, false) = true
			join public.team_members member
			  on member.organization_id = leader.organization_id
			 and member.team_id = leader.team_id
			 and coalesce(member.is_active, true) = true
			join public.organization_members leader_membership
			  on leader_membership.organization_id = leader.organization_id
			 and leader_membership.user_id = leader.user_id
			 and leader_membership.membership_generation = leader.membership_generation
			 and leader_membership.is_active = true
			 and leader_membership.deleted_at is null
			join public.organization_members member_membership
			  on member_membership.organization_id = member.organization_id
			 and member_membership.user_id = member.user_id
			 and member_membership.membership_generation = member.membership_generation
			 and member_membership.is_active = true
			 and member_membership.deleted_at is null
			join public.users scope_leader_user
			  on scope_leader_user.id = leader.user_id and coalesce(scope_leader_user.is_active, false) = true
			join public.users scope_member_user
			  on scope_member_user.id = member.user_id and coalesce(scope_member_user.is_active, false) = true
			where leader.organization_id = se.organization_id
			  and leader.user_id = ` + userIDPlaceholder + `::uuid
			  and coalesce(leader.is_active, true) = true
			  and coalesce(leader.is_leader, false) = true
			  and (
				  member.user_id = se.user_id
				  or exists (
					  select 1
					  from public.schedule_event_assignees scope_team
					  where scope_team.organization_id = se.organization_id
					    and scope_team.event_id = se.id
					    and scope_team.user_id = member.user_id
				  )
			  )
		)`
}

func leadScheduleVisibilitySQL(canViewAllPlaceholder string, userIDPlaceholder string, canViewTeamPlaceholder string, canViewOwn bool) string {
	return `exists (
		select 1
		from public.leads l
		where l.organization_id = se.organization_id
		  and l.id = se.lead_id
		  and ` + leadVisibilitySQL(canViewAllPlaceholder, userIDPlaceholder, canViewTeamPlaceholder, canViewOwn) + `
	)`
}

func scheduleEventLeadVisibilitySQL(canViewAllSchedulePlaceholder string, participantUserIDPlaceholder string, canViewAllLeadsPlaceholder string, leadUserIDPlaceholder string, canViewTeamPlaceholder string, canViewOwn bool) string {
	return `(
		` + canViewAllSchedulePlaceholder + `::boolean
		or se.lead_id is null
		or se.user_id = ` + participantUserIDPlaceholder + `::uuid
		or exists (
			select 1
			from public.schedule_event_assignees participant
			where participant.organization_id = se.organization_id
			  and participant.event_id = se.id
			  and participant.user_id = ` + participantUserIDPlaceholder + `::uuid
		)
		or ` + leadScheduleVisibilitySQL(
		canViewAllLeadsPlaceholder,
		leadUserIDPlaceholder,
		canViewTeamPlaceholder,
		canViewOwn,
	) + `
	)`
}

func leadVisibilitySQL(canViewAllPlaceholder string, userIDPlaceholder string, canViewTeamPlaceholder string, canViewOwn bool) string {
	return leadscope.VisibilitySQL("l", canViewAllPlaceholder, userIDPlaceholder, canViewTeamPlaceholder, canViewOwn)
}

func scanEvent(row scanner) (Event, error) {
	var event Event
	var userID, leadID, propertyID, createdBy, teamID, leadSourceSnapshot, description, location, recurrenceParentID, recurrenceRule, googleEventID, googleSyncStatus, completedBy pgtype.Text
	var eventType, googleSyncTarget, googleTaskID pgtype.Text
	var isAllDay pgtype.Bool
	var outcome, outcomeNotes, performedBy, rescheduledFromID, rescheduledToID pgtype.Text
	var reminderMinutes, recurrenceCount pgtype.Int4
	var recurrenceUntil, completedAt, outcomeRecordedAt, createdAt, updatedAt pgtype.Timestamptz
	var userRefID, userName, userAvatarURL pgtype.Text
	var leadRefID, leadName, leadPhone pgtype.Text
	var propertyRefID, propertyTitle, propertyCode pgtype.Text
	var completedUserID, completedUserName, performedUserID, performedUserName pgtype.Text
	var assigneesJSON string

	if err := row.Scan(
		&event.ID,
		&event.OrganizationID,
		&userID,
		&leadID,
		&propertyID,
		&createdBy,
		&teamID,
		&leadSourceSnapshot,
		&event.Title,
		&description,
		&eventType,
		&event.StartTime,
		&event.EndTime,
		&isAllDay,
		&location,
		&event.Status,
		&event.Visibility,
		&reminderMinutes,
		&recurrenceParentID,
		&recurrenceRule,
		&recurrenceUntil,
		&recurrenceCount,
		&googleEventID,
		&googleSyncStatus,
		&googleSyncTarget,
		&googleTaskID,
		&completedBy,
		&completedAt,
		&outcome,
		&outcomeNotes,
		&performedBy,
		&outcomeRecordedAt,
		&rescheduledFromID,
		&rescheduledToID,
		&createdAt,
		&updatedAt,
		&userRefID,
		&userName,
		&userAvatarURL,
		&leadRefID,
		&leadName,
		&leadPhone,
		&propertyRefID,
		&propertyTitle,
		&propertyCode,
		&completedUserID,
		&completedUserName,
		&performedUserID,
		&performedUserName,
		&assigneesJSON,
		&event.IsMasked,
	); err != nil {
		return Event{}, err
	}

	event.UserID = textPtr(userID)
	event.EventType = "task"
	if eventType.Valid {
		event.EventType = eventType.String
	}
	event.IsAllDay = isAllDay.Valid && isAllDay.Bool
	event.LeadID = textPtr(leadID)
	event.PropertyID = textPtr(propertyID)
	event.CreatedBy = textPtr(createdBy)
	event.TeamID = textPtr(teamID)
	event.LeadSourceSnapshot = textPtr(leadSourceSnapshot)
	event.Description = textPtr(description)
	event.Location = textPtr(location)
	event.ReminderMinutes = intPtr(reminderMinutes)
	event.RecurrenceParentID = textPtr(recurrenceParentID)
	event.RecurrenceRule = textPtr(recurrenceRule)
	event.RecurrenceUntil = timePtr(recurrenceUntil)
	event.RecurrenceCount = intPtr(recurrenceCount)
	event.GoogleEventID = textPtr(googleEventID)
	event.GoogleSyncStatus = textPtr(googleSyncStatus)
	event.GoogleSyncTarget = textPtr(googleSyncTarget)
	event.GoogleTaskID = textPtr(googleTaskID)
	event.CompletedBy = textPtr(completedBy)
	event.CompletedAt = timePtr(completedAt)
	event.Outcome = textPtr(outcome)
	event.OutcomeNotes = textPtr(outcomeNotes)
	event.PerformedBy = textPtr(performedBy)
	event.OutcomeRecordedAt = timePtr(outcomeRecordedAt)
	event.RescheduledFromID = textPtr(rescheduledFromID)
	event.RescheduledToID = textPtr(rescheduledToID)
	event.CreatedAt = timePtr(createdAt)
	event.UpdatedAt = timePtr(updatedAt)
	event.AssigneeUserIDs = decodeStringArrayJSON(assigneesJSON)

	if userRefID.Valid {
		event.User = &UserRef{ID: userRefID.String, Name: textValue(userName), AvatarURL: textPtr(userAvatarURL)}
	}
	if leadRefID.Valid {
		event.Lead = &LeadRef{ID: leadRefID.String, Name: textValue(leadName), Phone: textPtr(leadPhone)}
	}
	if propertyRefID.Valid {
		event.Property = &PropertyRef{ID: propertyRefID.String, Title: textPtr(propertyTitle), Code: textPtr(propertyCode)}
	}
	if completedUserID.Valid {
		event.CompletedByUser = &UserRef{ID: completedUserID.String, Name: textValue(completedUserName)}
	}
	if performedUserID.Valid {
		event.PerformedByUser = &UserRef{ID: performedUserID.String, Name: textValue(performedUserName)}
	}

	return redactBusyScheduleEvent(event), nil
}
