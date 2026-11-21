package automations

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) CancelExecution(ctx context.Context, tenantContext tenant.Context, executionID string) error {
	if !canManageAutomations(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}

	executionID, ok := normalizeUUID(executionID)
	if !ok {
		return ErrInvalidInput
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
		update public.automation_executions
		set status = 'cancelled',
		    cancellation_requested_at = now(),
		    completed_at = now(),
		    error_message = 'Cancelado manualmente pelo usuario',
		    next_execution_at = null,
		    locked_at = null,
		    locked_by = null,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and status in ('queued', 'running', 'waiting')
	`, tenantContext.OrganizationID, executionID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		if err := tx.QueryRow(ctx, `
			select exists (
				select 1
				from public.automation_executions
				where organization_id = $1::uuid and id = $2::uuid
			)
		`, tenantContext.OrganizationID, executionID).Scan(&exists); err != nil {
			return err
		}
		if exists {
			return ErrExecutionNotCancellable
		}
		return ErrExecutionNotFound
	}
	if _, err := tx.Exec(ctx, `
		update public.automation_execution_steps
		set status = 'cancelled',
		    completed_at = now(),
		    error_message = 'cancelled_by_user'
		where execution_id = $1::uuid
		  and organization_id = $2::uuid
		  and status in ('running', 'waiting')
	`, executionID, tenantContext.OrganizationID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	return nil
}

func (repo Repository) CancelAutomationExecutions(ctx context.Context, tenantContext tenant.Context, automationID string) (int, error) {
	if !canManageAutomations(tenantContext) {
		return 0, tenant.ErrOrganizationAccessDenied
	}
	automationID, ok := normalizeUUID(automationID)
	if !ok {
		return 0, ErrInvalidInput
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	var exists bool
	if err := tx.QueryRow(ctx, `
		select true from public.automations
		where id = $1::uuid and organization_id = $2::uuid and deleted_at is null
		for update
	`, automationID, tenantContext.OrganizationID).Scan(&exists); errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrAutomationNotFound
	} else if err != nil {
		return 0, err
	}

	rows, err := tx.Query(ctx, `
		update public.automation_executions
		set status = 'cancelled', cancellation_requested_at = now(), completed_at = now(),
		    error_message = 'Cancelado manualmente pelo usuario', next_execution_at = null,
		    locked_at = null, locked_by = null, updated_at = now()
		where organization_id = $1::uuid and automation_id = $2::uuid
		  and status in ('queued', 'running', 'waiting')
		returning id::text
	`, tenantContext.OrganizationID, automationID)
	if err != nil {
		return 0, err
	}
	executionIDs := []string{}
	for rows.Next() {
		var executionID string
		if err := rows.Scan(&executionID); err != nil {
			rows.Close()
			return 0, err
		}
		executionIDs = append(executionIDs, executionID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()
	if len(executionIDs) > 0 {
		if _, err := tx.Exec(ctx, `
			update public.automation_execution_steps
			set status = 'cancelled', completed_at = now(), error_message = 'cancelled_by_user'
			where organization_id = $1::uuid and execution_id = any($2::uuid[])
			  and status in ('running', 'waiting')
		`, tenantContext.OrganizationID, executionIDs); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(executionIDs), nil
}

func (repo Repository) CancelLeadExecutions(ctx context.Context, tenantContext tenant.Context, leadID string) (int, error) {
	if !canManageAutomations(tenantContext) {
		return 0, tenant.ErrOrganizationAccessDenied
	}
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return 0, ErrInvalidInput
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	var leadExists bool
	if err := tx.QueryRow(ctx, `
		select exists (
			select 1 from public.leads
			where organization_id = $1::uuid and id = $2::uuid
		)
	`, tenantContext.OrganizationID, leadID).Scan(&leadExists); err != nil {
		return 0, err
	}
	if !leadExists {
		return 0, ErrInvalidInput
	}

	rows, err := tx.Query(ctx, `
		update public.automation_executions
		set status = 'cancelled', cancellation_requested_at = now(), completed_at = now(),
		    error_message = 'Cancelado manualmente na conversa', next_execution_at = null,
		    locked_at = null, locked_by = null, updated_at = now()
		where organization_id = $1::uuid and lead_id = $2::uuid
		  and status in ('queued', 'running', 'waiting')
		returning id::text
	`, tenantContext.OrganizationID, leadID)
	if err != nil {
		return 0, err
	}
	executionIDs := []string{}
	for rows.Next() {
		var executionID string
		if err := rows.Scan(&executionID); err != nil {
			rows.Close()
			return 0, err
		}
		executionIDs = append(executionIDs, executionID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()

	if len(executionIDs) > 0 {
		if _, err := tx.Exec(ctx, `
			update public.automation_execution_steps
			set status = 'cancelled', completed_at = now(), error_message = 'cancelled_by_user'
			where organization_id = $1::uuid and execution_id = any($2::uuid[])
			  and status in ('running', 'waiting')
		`, tenantContext.OrganizationID, executionIDs); err != nil {
			return 0, err
		}

		if _, err := tx.Exec(ctx, `
			insert into public.lead_timeline_events (
				organization_id, lead_id, event_type, title, description,
				user_id, actor_user_id, metadata, event_at
			) values (
				$1::uuid, $2::uuid,
				'automation_stopped_manually',
				'Automacao interrompida manualmente',
				'Fluxo interrompido pelo botao da conversa',
				$3::uuid, $3::uuid,
				jsonb_build_object('execution_ids', to_jsonb($4::text[])),
				now()
			)
		`, tenantContext.OrganizationID, leadID, tenantContext.UserID, executionIDs); err != nil {
			return 0, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(executionIDs), nil
}
