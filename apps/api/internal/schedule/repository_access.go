package schedule

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/authorization"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/propertyscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) validateTeam(ctx context.Context, querier queryRower, organizationID string, teamID *string) error {
	if teamID == nil {
		return nil
	}

	var exists bool
	err := querier.QueryRow(ctx, `
		select exists (
			select 1
			from public.teams t
			where t.organization_id = $1::uuid
			  and t.id = $2::uuid
			  and coalesce(t.is_active, true) = true
		)
	`, organizationID, *teamID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalidReference
	}

	return nil
}

func (repo Repository) validateLead(ctx context.Context, querier queryRower, tenantContext tenant.Context, leadID *string) error {
	if leadID == nil {
		return nil
	}
	if !tenantContext.HasPermission(permissions.LeadOperate) {
		return tenant.ErrOrganizationAccessDenied
	}
	if err := requireScheduleLeadOutsideQueuePool(ctx, querier, tenantContext, *leadID); err != nil {
		return err
	}

	var resource authorization.LeadResource
	err := querier.QueryRow(ctx, `
		select coalesce(l.assigned_user_id::text, ''),
		       coalesce(nullif(to_jsonb(l)->>'team_id', ''), '')
		from public.leads l
		where l.organization_id = $1::uuid
		  and l.id = $2::uuid
	`, tenantContext.OrganizationID, *leadID).Scan(&resource.AssignedUserID, &resource.TeamID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidReference
	}
	if err != nil {
		return err
	}
	if !authorization.CanOperateLead(tenantContext, resource) {
		return ErrInvalidReference
	}

	return nil
}

func (repo Repository) validateProperty(ctx context.Context, querier queryRower, tenantContext tenant.Context, propertyID *string) error {
	if propertyID == nil {
		return nil
	}
	if !canViewProperties(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}

	var exists bool
	err := querier.QueryRow(ctx, `
		select exists (
			select 1
			from public.properties p
			where p.organization_id = $1::uuid
			  and p.id = $2::uuid
			  and `+propertyscope.VisibilitySQL("p", "$3", "$4", "$5")+`
		)
	`,
		tenantContext.OrganizationID,
		*propertyID,
		propertyscope.CanViewAll(tenantContext),
		tenantContext.UserID,
		propertyscope.CanViewTeam(tenantContext),
	).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalidReference
	}

	return nil
}

func (repo Repository) ensureEventPerformer(
	ctx context.Context,
	querier queryRower,
	tenantContext tenant.Context,
	current eventSnapshot,
	input updateInput,
	userID string,
) error {
	if err := repo.ensureAssignableUser(ctx, querier, tenantContext, userID); err != nil {
		return err
	}

	nextPrimaryUserID := current.UserID
	if input.UserID.Set && input.UserID.Value != nil {
		nextPrimaryUserID = *input.UserID.Value
	}
	if userID == nextPrimaryUserID {
		return nil
	}

	if input.AssigneeIDs.Set {
		for _, assigneeID := range input.AssigneeIDs.Value {
			if assigneeID == userID {
				return nil
			}
		}
		return fmt.Errorf("%w: performed_by must identify an event participant", ErrInvalidInput)
	}

	var isAssignee bool
	err := querier.QueryRow(ctx, `
		select exists (
			select 1
			from public.schedule_event_assignees sea
			where sea.organization_id = $1::uuid
			  and sea.event_id = $2::uuid
			  and sea.user_id = $3::uuid
		)
	`, tenantContext.OrganizationID, current.ID, userID).Scan(&isAssignee)
	if err != nil {
		return err
	}
	if !isAssignee {
		return fmt.Errorf("%w: performed_by must identify an event participant", ErrInvalidInput)
	}

	return nil
}

func (repo Repository) getSnapshotForUpdate(ctx context.Context, tx pgx.Tx, organizationID string, eventID string) (eventSnapshot, error) {
	var snapshot eventSnapshot
	var leadID, outcome, outcomeNotes, performedBy, rescheduledFromID, rescheduledToID pgtype.Text
	err := tx.QueryRow(ctx, `
		select
			id::text,
			organization_id::text,
			user_id::text,
			lead_id::text,
			title,
			coalesce(event_type, 'task'),
			start_time,
			end_time,
			coalesce(is_all_day, false),
			status,
			outcome,
			outcome_notes,
			performed_by::text,
			rescheduled_from_event_id::text,
			rescheduled_to_event_id::text,
			visibility,
			coalesce(updated_at, created_at, start_time)
		from public.schedule_events
		where organization_id = $1::uuid
		  and id = $2::uuid
		limit 1
		for update
	`, organizationID, eventID).Scan(&snapshot.ID, &snapshot.OrganizationID, &snapshot.UserID, &leadID, &snapshot.Title, &snapshot.EventType, &snapshot.StartTime, &snapshot.EndTime, &snapshot.IsAllDay, &snapshot.Status, &outcome, &outcomeNotes, &performedBy, &rescheduledFromID, &rescheduledToID, &snapshot.Visibility, &snapshot.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return eventSnapshot{}, ErrEventNotFound
	}
	if err != nil {
		return eventSnapshot{}, err
	}

	snapshot.LeadID = textValue(leadID)
	snapshot.Outcome = textValue(outcome)
	snapshot.OutcomeNotes = textPtr(outcomeNotes)
	snapshot.PerformedBy = textValue(performedBy)
	snapshot.RescheduledFromID = textValue(rescheduledFromID)
	snapshot.RescheduledToID = textValue(rescheduledToID)
	return snapshot, nil
}

// The caller keeps the event lock until its protected content has been read.
func (repo Repository) ensureCanViewEvent(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, eventID string) error {
	current, err := repo.getSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, eventID)
	if err != nil {
		return err
	}
	ok, err := repo.canViewEvent(ctx, tx, tenantContext, current)
	if err != nil {
		return err
	}
	if !ok {
		return tenant.ErrOrganizationAccessDenied
	}

	return nil
}

func (repo Repository) canViewEvent(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, snapshot eventSnapshot) (bool, error) {
	if !canViewSchedule(tenantContext) {
		return false, nil
	}
	if canViewAllScheduleEvents(tenantContext) {
		return true, nil
	}
	participant, err := repo.isEventParticipant(ctx, tx, tenantContext.OrganizationID, snapshot.ID, tenantContext.UserID, snapshot.UserID)
	if err != nil {
		return false, err
	}
	if participant {
		return true, nil
	}
	if snapshot.Visibility == "public" {
		return true, nil
	}
	if snapshot.Visibility == "private" {
		return false, nil
	}
	if snapshot.Visibility == "default" {
		return repo.isEventInScheduleActorScope(ctx, tx, tenantContext, snapshot.ID)
	}
	canViewLead, err := repo.canAccessEventLead(ctx, tx, tenantContext, snapshot.LeadID)
	if err != nil || !canViewLead {
		return canViewLead, err
	}

	return repo.isEventInScheduleScope(ctx, tx, tenantContext, snapshot.ID)
}

func (repo Repository) canEditEvent(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, snapshot eventSnapshot) (bool, error) {
	if !canManageSchedule(tenantContext) {
		return false, nil
	}
	if canViewAllScheduleEvents(tenantContext) {
		return true, nil
	}
	participant, err := repo.isEventParticipant(ctx, tx, tenantContext.OrganizationID, snapshot.ID, tenantContext.UserID, snapshot.UserID)
	if err != nil {
		return false, err
	}
	if participant {
		return true, nil
	}
	if snapshot.Visibility == "private" {
		return false, nil
	}
	canViewLead, err := repo.canAccessEventLead(ctx, tx, tenantContext, snapshot.LeadID)
	if err != nil || !canViewLead {
		return canViewLead, err
	}
	return repo.isEventInScheduleScope(ctx, tx, tenantContext, snapshot.ID)
}

func (repo Repository) canAccessEventLead(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, leadID string) (bool, error) {
	if strings.TrimSpace(leadID) == "" {
		return true, nil
	}

	var exists bool
	err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.leads l
			where l.organization_id = $1::uuid
			  and l.id = $2::uuid
			  and `+leadVisibilitySQL("$3", "$4", "$5", tenantContext.HasPermission(permissions.LeadViewOwn))+`
		)
	`, tenantContext.OrganizationID, leadID, canViewAllLeads(tenantContext), tenantContext.UserID, tenantContext.HasPermission(permissions.LeadViewTeam)).Scan(&exists)
	return exists, err
}

func (repo Repository) isEventInScheduleScope(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, eventID string) (bool, error) {
	var exists bool
	err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.schedule_events se
			where se.organization_id = $1::uuid
			  and se.id = $2::uuid
			  and `+scheduleEventScopeSQL("$3", "false")+`
			  and `+scheduleEventLeadVisibilitySQL(
		"false",
		"$3",
		"$4",
		"$5",
		"$6",
		tenantContext.HasPermission(permissions.LeadViewOwn),
	)+`
		)
	`, tenantContext.OrganizationID, eventID, tenantContext.UserID, canViewAllLeads(tenantContext), tenantContext.UserID, tenantContext.HasPermission(permissions.LeadViewTeam)).Scan(&exists)
	return exists, err
}

func (repo Repository) isEventInScheduleActorScope(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, eventID string) (bool, error) {
	var exists bool
	err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.schedule_events se
			where se.organization_id = $1::uuid
			  and se.id = $2::uuid
			  and `+scheduleEventScopeSQL("$3", "false")+`
		)
	`, tenantContext.OrganizationID, eventID, tenantContext.UserID).Scan(&exists)
	return exists, err
}

func (repo Repository) isEventParticipant(ctx context.Context, tx pgx.Tx, organizationID string, eventID string, userID string, ownerID string) (bool, error) {
	if userID == ownerID {
		return true, nil
	}

	var exists bool
	err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.schedule_event_assignees
			where organization_id = $1::uuid
			  and event_id = $2::uuid
			  and user_id = $3::uuid
		)
	`, organizationID, eventID, userID).Scan(&exists)
	return exists, err
}

func canManageSchedule(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin") ||
		tenantContext.HasPermission(permissions.ScheduleManage)
}

func canViewSchedule(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin") ||
		tenantContext.HasPermission(permissions.ScheduleView)
}

func canViewAllScheduleEvents(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin || tenantContext.HasRole("owner", "admin")
}

func canAssignAnyScheduleUser(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin || tenantContext.HasRole("owner", "admin")
}

func canViewAllLeads(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin") ||
		tenantContext.HasPermission(permissions.LeadViewAll)
}

func canViewProperties(tenantContext tenant.Context) bool {
	return propertyscope.CanRead(tenantContext)
}
