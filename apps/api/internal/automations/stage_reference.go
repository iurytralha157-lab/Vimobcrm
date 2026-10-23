package automations

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

var ErrAutomationStageUnavailable = fmt.Errorf("%w: stage or pipeline is unavailable", ErrInvalidInput)

func validateStageReference(ctx context.Context, tx pgx.Tx, organizationID, pipelineID, stageID string) error {
	if pipelineID == "" && stageID == "" {
		return nil
	}
	var exists bool
	if stageID == "" {
		err := tx.QueryRow(ctx, `select true from public.pipelines p
		  where p.id=$1::uuid and p.organization_id=$2::uuid
		    and coalesce(p.is_active, true) = true for key share of p`, pipelineID, organizationID).Scan(&exists)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrAutomationStageUnavailable
		}
		return err
	}
	if err := tx.QueryRow(ctx, `
		select true
		from public.stages s
		join public.pipelines p on p.id = s.pipeline_id
		where s.id = $1::uuid
		  and ($2::text = '' or s.pipeline_id = nullif($2::text, '')::uuid)
		  and s.organization_id = $3::uuid
		  and p.organization_id = $3::uuid
		  and coalesce(s.is_active, true) = true
		  and coalesce(p.is_active, true) = true
		for key share of s, p
	`, stageID, pipelineID, organizationID).Scan(&exists); errors.Is(err, pgx.ErrNoRows) {
		return ErrAutomationStageUnavailable
	} else if err != nil {
		return err
	}
	return nil
}
