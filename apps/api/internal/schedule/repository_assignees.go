package schedule

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) ListAssignees(ctx context.Context, tenantContext tenant.Context, eventID string) ([]AssigneeUser, error) {
	eventID, ok := normalizeUUID(eventID)
	if !ok {
		return nil, ErrEventNotFound
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := repo.ensureCanViewEvent(ctx, tx, tenantContext, eventID); err != nil {
		return nil, err
	}

	result, err := loadScheduleAssignees(ctx, tx, tenantContext.OrganizationID, eventID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return result, nil
}

func (repo Repository) AddAssignee(ctx context.Context, tenantContext tenant.Context, eventID string, userID string) ([]AssigneeUser, error) {
	eventID, ok := normalizeUUID(eventID)
	if !ok {
		return nil, ErrEventNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, eventID)
	if err != nil {
		return nil, err
	}
	if ok, err := repo.canEditEvent(ctx, tx, tenantContext, current); err != nil {
		return nil, err
	} else if !ok {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if err := validateFinalAppointmentMutation(current); err != nil {
		return nil, err
	}
	if err := repo.ensureAssignableUser(ctx, tx, tenantContext, userID); err != nil {
		return nil, err
	}

	assigneeAdded := false
	if userID != current.UserID {
		if err := validateScheduleAssigneeAddition(ctx, tx, tenantContext.OrganizationID, eventID, userID); err != nil {
			return nil, err
		}
		tag, err := tx.Exec(ctx, `
			insert into public.schedule_event_assignees (
				organization_id,
				event_id,
				user_id
			)
			values (
				$1::uuid,
				$2::uuid,
				$3::uuid
			)
			on conflict (event_id, user_id) do nothing
		`, tenantContext.OrganizationID, eventID, userID)
		if err != nil {
			return nil, err
		}
		assigneeAdded = tag.RowsAffected() > 0
	}

	if assigneeAdded {
		if err := repo.insertScheduleNotifications(ctx, tx, tenantContext.OrganizationID, tenantContext.UserID, []string{userID}, "Voce foi adicionado a uma atividade", current.Title, map[string]any{
			"schedule_event_id": eventID,
			"event_type":        current.EventType,
		}); err != nil {
			return nil, err
		}
	}
	googleJobEnqueued := false
	if assigneeAdded {
		googleJobEnqueued, err = repo.enqueueScheduleGoogleMutation(
			ctx,
			tx,
			tenantContext.OrganizationID,
			tenantContext.UserID,
			eventID,
			current.UserID,
			current.UserID,
		)
		if err != nil {
			return nil, err
		}
	}

	result, err := loadScheduleAssignees(ctx, tx, tenantContext.OrganizationID, eventID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	if googleJobEnqueued {
		repo.kickGoogleCalendarOutboundWorker(ctx)
	}
	return result, nil
}

func (repo Repository) RemoveAssignee(ctx context.Context, tenantContext tenant.Context, eventID string, userID string) ([]AssigneeUser, error) {
	eventID, ok := normalizeUUID(eventID)
	if !ok {
		return nil, ErrEventNotFound
	}
	userID, ok = normalizeUUID(userID)
	if !ok {
		return nil, ErrInvalidInput
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, eventID)
	if err != nil {
		return nil, err
	}
	if ok, err := repo.canEditEvent(ctx, tx, tenantContext, current); err != nil {
		return nil, err
	} else if !ok {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if err := validateFinalAppointmentMutation(current); err != nil {
		return nil, err
	}

	tag, err := tx.Exec(ctx, `
		delete from public.schedule_event_assignees
		where organization_id = $1::uuid
		  and event_id = $2::uuid
		  and user_id = $3::uuid
	`, tenantContext.OrganizationID, eventID, userID)
	if err != nil {
		return nil, err
	}
	googleJobEnqueued := false
	if tag.RowsAffected() > 0 {
		googleJobEnqueued, err = repo.enqueueScheduleGoogleMutation(
			ctx,
			tx,
			tenantContext.OrganizationID,
			tenantContext.UserID,
			eventID,
			current.UserID,
			current.UserID,
		)
		if err != nil {
			return nil, err
		}
	}

	result, err := loadScheduleAssignees(ctx, tx, tenantContext.OrganizationID, eventID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	if googleJobEnqueued {
		repo.kickGoogleCalendarOutboundWorker(ctx)
	}
	return result, nil
}

func (repo Repository) insertAssignees(ctx context.Context, tx pgx.Tx, organizationID string, eventIDs []string, assigneeIDs []string) error {
	if len(eventIDs) == 0 || len(assigneeIDs) == 0 {
		return nil
	}

	batch := &pgx.Batch{}
	for _, eventID := range eventIDs {
		for _, userID := range assigneeIDs {
			batch.Queue(`
				insert into public.schedule_event_assignees (
					organization_id,
					event_id,
					user_id
				)
				values (
					$1::uuid,
					$2::uuid,
					$3::uuid
				)
				on conflict (event_id, user_id) do nothing
			`, organizationID, eventID, userID)
		}
	}

	results := tx.SendBatch(ctx, batch)
	defer func() { _ = results.Close() }()
	for range eventIDs {
		for range assigneeIDs {
			_, err := results.Exec()
			if err != nil {
				return err
			}
		}
	}

	return results.Close()
}

func (repo Repository) replaceAssignees(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	eventID string,
	assigneeIDs []string,
) ([]string, error) {
	rows, err := tx.Query(ctx, `
		select user_id::text
		from public.schedule_event_assignees
		where organization_id = $1::uuid
		  and event_id = $2::uuid
	`, tenantContext.OrganizationID, eventID)
	if err != nil {
		return nil, err
	}

	existing := map[string]struct{}{}
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			rows.Close()
			return nil, err
		}
		existing[userID] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	next := make(map[string]struct{}, len(assigneeIDs))
	added := make([]string, 0, len(assigneeIDs))
	for _, userID := range assigneeIDs {
		next[userID] = struct{}{}
		if _, wasAssigned := existing[userID]; !wasAssigned {
			added = append(added, userID)
		}
	}
	if err := repo.validateAssignees(ctx, tx, tenantContext, added); err != nil {
		return nil, err
	}
	for userID := range existing {
		if _, remainsAssigned := next[userID]; remainsAssigned {
			continue
		}
		if _, err := tx.Exec(ctx, `
			delete from public.schedule_event_assignees
			where organization_id = $1::uuid
			  and event_id = $2::uuid
			  and user_id = $3::uuid
		`, tenantContext.OrganizationID, eventID, userID); err != nil {
			return nil, err
		}
	}
	if err := repo.insertAssignees(ctx, tx, tenantContext.OrganizationID, []string{eventID}, added); err != nil {
		return nil, err
	}
	return added, nil
}

func (repo Repository) validateUser(ctx context.Context, querier queryRower, organizationID string, userID string) error {
	var exists bool
	err := querier.QueryRow(ctx, `
		select exists (
			select 1
			from public.users u
			join public.organization_members om
			  on om.user_id = u.id
			 and om.organization_id = $1::uuid
			where u.id = $2::uuid
			  and coalesce(u.is_active, false) = true
			  and coalesce(om.is_active, false) = true
		)
	`, organizationID, userID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalidReference
	}

	return nil
}

func (repo Repository) validateAssignees(ctx context.Context, querier queryRower, tenantContext tenant.Context, assigneeIDs []string) error {
	for _, userID := range assigneeIDs {
		if err := repo.ensureAssignableUser(ctx, querier, tenantContext, userID); err != nil {
			return err
		}
	}

	return nil
}

func (repo Repository) ensureAssignableUser(ctx context.Context, querier queryRower, tenantContext tenant.Context, userID string) error {
	if err := repo.validateUser(ctx, querier, tenantContext.OrganizationID, userID); err != nil {
		return err
	}
	if canAssignAnyScheduleUser(tenantContext) || userID == tenantContext.UserID {
		return nil
	}
	if tenantContext.LeadsUser(userID) {
		return nil
	}

	var allowed bool
	err := querier.QueryRow(ctx, `
		select exists (
			select 1
			from public.team_members leader
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
			where leader.organization_id = $1::uuid
			  and leader.user_id = $2::uuid
			  and coalesce(leader.is_active, true) = true
			  and coalesce(leader.is_leader, false) = true
			  and member.user_id = $3::uuid
		)
	`, tenantContext.OrganizationID, tenantContext.UserID, userID).Scan(&allowed)
	if err != nil {
		return err
	}
	if !allowed {
		return tenant.ErrOrganizationAccessDenied
	}

	return nil
}
