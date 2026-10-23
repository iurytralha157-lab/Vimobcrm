package cadences

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// Pipeline configuration locks parent before children. Acquiring this compatible
// parent lock before the stage also avoids a stage->parent FK lock inversion
// when a dedicated template is first created during an operational-rules save.
func (repo Repository) lockOperationalStageParentFirst(ctx context.Context, tx pgx.Tx, organizationID, stageID string) (operationalStage, error) {
	stage, err := repo.loadOperationalStage(ctx, tx, organizationID, stageID, false)
	if err != nil {
		return operationalStage{}, err
	}
	var pipelineID string
	err = tx.QueryRow(ctx, `select id::text from public.pipelines
 where organization_id=$1::uuid and id=$2::uuid for key share`, organizationID, stage.PipelineID).Scan(&pipelineID)
	if errors.Is(err, pgx.ErrNoRows) {
		return operationalStage{}, ErrCadenceNotFound
	}
	if err != nil {
		return operationalStage{}, err
	}
	locked, err := repo.loadOperationalStage(ctx, tx, organizationID, stageID, true)
	if err != nil {
		return operationalStage{}, err
	}
	if locked.PipelineID != pipelineID {
		return operationalStage{}, ErrOperationalRulesConflict
	}
	return locked, nil
}
