package leads

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
)

var ErrLeadDestinationBusy = errors.New("lead destination is being changed by another transaction")

// A null stage may clear the destination, but must not leave a selected funnel
// with an invisible lead. Pipeline-only clears retain their existing behavior:
// applyDestinationAssignments also clears the stage in that branch.
func validateLeadUpdateDestination(current leadSnapshot, input updateInput) error {
	if !input.StageID.Set || input.StageID.Value != nil {
		return nil
	}
	pipelineID := current.PipelineID
	if input.PipelineID.Set {
		pipelineID = ""
		if input.PipelineID.Value != nil {
			pipelineID = *input.PipelineID.Value
		}
	}
	if pipelineID != "" {
		return distribution.ErrIntakeDestinationUnavailable
	}
	return nil
}

// The caller already owns the lead row. Validate effective references after all
// trigger/automation effects using the same transaction, never a Pool. NOWAIT is
// essential: a structure writer can own the destination and wait for this lead.
// Returning immediately lets the caller roll back instead of adding a lock cycle.
// Unrelated profile/status edits do not repair or reject legacy orphan leads.
func validatePersistedLeadUpdateDestination(ctx context.Context, tx leadTeamQueryer, organizationID, leadID string, input updateInput) error {
	if !input.PipelineID.Set && !input.StageID.Set {
		return nil
	}
	var pipelineID, stageID string
	err := tx.QueryRow(ctx, `select coalesce(pipeline_id::text,''),coalesce(stage_id::text,'')
		from public.leads where organization_id=$1::uuid and id=$2::uuid`, organizationID, leadID).Scan(&pipelineID, &stageID)
	if err != nil {
		return leadUpdateDestinationError(err)
	}
	if pipelineID == "" && stageID == "" {
		return nil
	}
	if pipelineID == "" || stageID == "" {
		return distribution.ErrIntakeDestinationUnavailable
	}
	var lockedID string
	err = tx.QueryRow(ctx, `select id::text from public.pipelines
		where organization_id=$1::uuid and id=$2::uuid and coalesce(is_active,true)
		for share nowait`, organizationID, pipelineID).Scan(&lockedID)
	if err != nil {
		return leadUpdateDestinationError(err)
	}
	err = tx.QueryRow(ctx, `select id::text from public.stages
		where organization_id=$1::uuid and pipeline_id=$2::uuid and id=$3::uuid
		  and coalesce(is_active,true) for share nowait`, organizationID, pipelineID, stageID).Scan(&lockedID)
	return leadUpdateDestinationError(err)
}

func leadUpdateDestinationError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return distribution.ErrIntakeDestinationUnavailable
	}
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && postgresError.Code == "55P03" {
		return ErrLeadDestinationBusy
	}
	return err
}
