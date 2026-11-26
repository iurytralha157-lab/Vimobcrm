package leads

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) Assign(ctx context.Context, tenantContext tenant.Context, leadID string, input assignInput) (Lead, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return Lead{}, ErrLeadNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Lead{}, err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getLeadSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, leadID)
	if err != nil {
		return Lead{}, err
	}
	if isQueuePoolSnapshot(current) {
		return Lead{}, ErrQueuePoolConflict
	}

	if !canOperateLeadSnapshot(tenantContext, current) {
		return Lead{}, tenant.ErrOrganizationAccessDenied
	}
	if err := validateLeadAssignmentRevision(current, input); err != nil {
		return Lead{}, err
	}

	if input.AssignedUserID != nil {
		if err := repo.validateAssignedUser(ctx, tx, tenantContext.OrganizationID, input.AssignedUserID); err != nil {
			return Lead{}, err
		}
	}
	if err := repo.validateRoundRobinAssigneeTeam(ctx, tx, tenantContext.OrganizationID, current.TeamID, input.AssignedUserID); err != nil {
		return Lead{}, err
	}

	if err := repo.transferLeadAssignee(ctx, tx, tenantContext, current, input.AssignedUserID, "manual_transfer"); err != nil {
		return Lead{}, err
	}

	updatedLead, err := repo.getLeadForMutation(ctx, tx, tenantContext, leadID)
	if err != nil {
		return Lead{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Lead{}, err
	}
	repo.hydrateMutationLeadAvatar(tenantContext.OrganizationID, &updatedLead)

	return updatedLead, nil
}

func (repo Repository) transferLeadAssignee(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, current leadSnapshot, assignedUserID *string, reason string) error {
	if tenantContext.UserID != "" && reason != "auto_redistribution" {
		if err := prepareManualQueueTransfer(ctx, tx, tenantContext, current.ID, assignedUserID); err != nil {
			return err
		}
	}
	_, err := tx.Exec(ctx, `
		update public.leads
		set assigned_user_id = $3::uuid,
		    assigned_at = case when $3::uuid is null then null else now() end,
		    board_order_at = now(),
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, current.ID, nullable(assignedUserID))
	if err != nil {
		return err
	}

	if err := repo.insertLeadAssignmentLog(ctx, tx, tenantContext, current, assignedUserID, reason); err != nil {
		return err
	}
	return repo.insertTransferNotification(ctx, tx, tenantContext, current, assignedUserID, reason)
}

func (repo Repository) insertLeadAssignmentLog(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, current leadSnapshot, assignedUserID *string, reason string) error {
	usesCanonicalLog, err := repo.assignmentLogUsesCanonicalSchema(ctx, tx)
	if err != nil {
		return err
	}
	if usesCanonicalLog {
		var assignmentID string
		err = tx.QueryRow(ctx, `
			insert into public.assignments_log (
				organization_id,
				lead_id,
				old_user_id,
				new_user_id,
				reason,
				created_by
			)
			values (
				$1::uuid,
				$2::uuid,
				$3::uuid,
				$4::uuid,
				$5,
				$6::uuid
			)
			returning id::text
		`, tenantContext.OrganizationID, current.ID, nullableString(current.AssignedUserID), nullable(assignedUserID), reason, nullableString(tenantContext.UserID)).Scan(&assignmentID)
		if err == nil && reason == manualQueueRedistribution {
			// Managed leads also write a runtime transfer. Link the exact event
			// from this transaction so the history can show one named action.
			_, err = tx.Exec(ctx, `update private.queue_runtime_events
				set metadata = metadata || jsonb_build_object('assignment_log_id', $3::text)
				where organization_id = $1::uuid and lead_id = $2::uuid and event_type = 'manual_transfer'
				  and metadata->>'history_transaction_id' = pg_catalog.txid_current()::text
				  and not (metadata ? 'assignment_log_id')`, tenantContext.OrganizationID, current.ID, assignmentID)
		}
		return err
	}

	_, err = tx.Exec(ctx, `
		insert into public.assignments_log (
			organization_id,
			lead_id,
			assigned_user_id,
			user_id,
			reason,
			assigned_at
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4::uuid,
			$5,
			now()
		)
	`, tenantContext.OrganizationID, current.ID, nullable(assignedUserID), nullableString(tenantContext.UserID), reason)
	return err
}
