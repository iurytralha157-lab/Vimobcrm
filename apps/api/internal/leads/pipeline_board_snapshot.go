package leads

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type pipelineBoardReadQueryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type pipelineBoardReadBeginner interface {
	BeginTx(context.Context, pgx.TxOptions) (pgx.Tx, error)
}

// One short, read-only snapshot owns the pipeline, stages, limited cards and
// exact aggregates. Separate Read Committed statements can observe a move twice
// or not at all. No transaction is retained across HTTP pagination requests.
func (repo Repository) readPipelineBoardSnapshot(ctx context.Context, db pipelineBoardReadBeginner, actor tenant.Context, filter PipelineBoardFilter) ([]PipelineBoardStage, error) {
	tx, err := db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	stages, err := readPipelineBoardInSnapshot(ctx, tx, actor, filter)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return stages, nil
}

func readPipelineBoardInSnapshot(ctx context.Context, queryer pipelineBoardReadQueryer, actor tenant.Context, filter PipelineBoardFilter) ([]PipelineBoardStage, error) {
	pipelineID, err := resolvePipelineBoardPipelineIDWithQueryer(ctx, queryer, actor, filter.PipelineID)
	if err != nil {
		return nil, err
	}
	if pipelineID == "" {
		return []PipelineBoardStage{}, nil
	}
	stages, err := listPipelineBoardStagesWithQueryer(ctx, queryer, actor, pipelineID)
	if err != nil {
		return nil, err
	}
	stageIDs := make([]string, 0, len(stages))
	for _, stage := range stages {
		stageIDs = append(stageIDs, stage.ID)
	}
	boardFilter := filter
	boardFilter.PipelineID = pipelineID
	boardFilter.StageID = ""
	boardFilter.StageIDs = stageIDs
	boardFilter.Offset = 0
	leadsByStage, err := listInitialPipelineBoardLeadsByStageWithQueryer(ctx, queryer, actor, boardFilter)
	if err != nil {
		return nil, err
	}
	metrics, err := listPipelineBoardStageMetricsWithQueryer(ctx, queryer, actor, boardFilter)
	if err != nil {
		return nil, err
	}
	for index := range stages {
		metric := metrics[stages[index].ID]
		stages[index].Leads = leadsByStage[stages[index].ID]
		stages[index].TotalLeadCount = metric.LeadCount
		stages[index].TotalValue = metric.TotalValue
		stages[index].HasMore = metric.LeadCount > int64(len(stages[index].Leads))
	}
	return stages, nil
}
