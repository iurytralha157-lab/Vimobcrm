package leads

import (
	"context"
	"strings"

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

func readPipelineBoardInSnapshot(ctx context.Context, tx pgx.Tx, actor tenant.Context, filter PipelineBoardFilter) ([]PipelineBoardStage, error) {
	stages, err := listPipelineBoardSnapshotStages(ctx, tx, actor, filter.PipelineID)
	if err != nil {
		return nil, err
	}
	if len(stages) == 0 {
		return stages, nil
	}
	stageIDs := make([]string, 0, len(stages))
	for _, stage := range stages {
		stageIDs = append(stageIDs, stage.ID)
	}
	boardFilter := filter
	boardFilter.PipelineID = stages[0].PipelineID
	boardFilter.StageID = ""
	boardFilter.StageIDs = stageIDs
	boardFilter.Offset = 0
	previewSQL, previewArgs, err := listInitialPipelineBoardLeadsByStageQuery(actor, boardFilter)
	if err != nil {
		return nil, err
	}
	metricsSQL, metricsArgs, err := listPipelineBoardStageMetricsQuery(actor, boardFilter)
	if err != nil {
		return nil, err
	}
	batch := &pgx.Batch{}
	batch.Queue(previewSQL, previewArgs...)
	batch.Queue(metricsSQL, metricsArgs...)
	results := tx.SendBatch(ctx, batch)
	defer results.Close()
	previewRows, err := results.Query()
	if err != nil {
		return nil, err
	}
	leadsByStage, err := scanInitialPipelineBoardLeadsByStage(previewRows, actor, stageIDs)
	if err != nil {
		return nil, err
	}
	metricRows, err := results.Query()
	if err != nil {
		return nil, err
	}
	metrics, err := scanPipelineBoardStageMetrics(metricRows, stageIDs)
	if err != nil {
		return nil, err
	}
	if err := results.Close(); err != nil {
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

func listPipelineBoardSnapshotStages(ctx context.Context, queryer pipelineBoardReadQueryer, actor tenant.Context, pipelineID string) ([]PipelineBoardStage, error) {
	var requestedID *string
	if strings.TrimSpace(pipelineID) != "" {
		normalized, ok := normalizeUUID(pipelineID)
		if !ok {
			return nil, ErrInvalidInput
		}
		requestedID = &normalized
	}
	rows, err := queryer.Query(ctx, `
		with selected_pipeline as (
			select p.id
			from public.pipelines p
			where p.organization_id = $1::uuid
			  and ($2::uuid is null or p.id = $2::uuid)
			order by (p.is_default is true) desc, p.position asc, p.created_at asc
			limit 1
		)
		select `+pipelineBoardStageFields+`
		from selected_pipeline p
		join public.stages s on s.pipeline_id = p.id
		where s.organization_id = $1::uuid and s.is_active = true
		order by s.position asc, s.created_at asc
	`, actor.OrganizationID, requestedID)
	if err != nil {
		return nil, err
	}
	stages, err := scanPipelineBoardStages(rows)
	if err != nil {
		return nil, err
	}
	if len(stages) == 0 && requestedID != nil {
		// An explicit pipeline without active stages is valid. Only an unavailable
		// reference gets the existing not-found error.
		if _, err := resolvePipelineBoardPipelineIDWithQueryer(ctx, queryer, actor, *requestedID); err != nil {
			return nil, err
		}
	}
	return stages, nil
}
