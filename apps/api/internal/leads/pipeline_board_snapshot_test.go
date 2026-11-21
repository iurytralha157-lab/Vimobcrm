package leads

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type boardSnapshotFixture struct {
	options                           pgx.TxOptions
	beginErr, readErr, commitErr      error
	previewErr, metricsErr, closeErr  error
	begins, reads, commits, rollbacks int
	batches, batchCloses              int
	hasPipeline, hasStage             bool
}

type boardSnapshotTx struct {
	pgx.Tx
	fixture *boardSnapshotFixture
}

const snapshotPipelineID = "10000000-0000-4000-8000-000000000001"

type boardSnapshotRow struct{ err error }

func (row boardSnapshotRow) Scan(dest ...any) error {
	if row.err == nil {
		*dest[0].(*string) = snapshotPipelineID
	}
	return row.err
}

type boardSnapshotRows struct {
	pgx.Rows
	stage bool
}

func (rows *boardSnapshotRows) Next() bool {
	if !rows.stage {
		return false
	}
	rows.stage = false
	return true
}

func (rows *boardSnapshotRows) Scan(dest ...any) error {
	*dest[0].(*string) = "10000000-0000-4000-8000-000000000002"
	*dest[2].(*string) = snapshotPipelineID
	return nil
}

func (*boardSnapshotRows) Close()     {}
func (*boardSnapshotRows) Err() error { return nil }

type boardSnapshotBatch struct {
	pgx.BatchResults
	fixture *boardSnapshotFixture
	queries int
}

func (result *boardSnapshotBatch) Query() (pgx.Rows, error) {
	result.queries++
	if result.queries == 1 && result.fixture.previewErr != nil {
		return nil, result.fixture.previewErr
	}
	if result.queries == 2 && result.fixture.metricsErr != nil {
		return nil, result.fixture.metricsErr
	}
	return &boardSnapshotRows{}, nil
}

func (result *boardSnapshotBatch) Close() error {
	result.fixture.batchCloses++
	return result.fixture.closeErr
}

func (fixture *boardSnapshotFixture) BeginTx(_ context.Context, options pgx.TxOptions) (pgx.Tx, error) {
	fixture.begins++
	fixture.options = options
	if fixture.beginErr != nil {
		return nil, fixture.beginErr
	}
	return &boardSnapshotTx{fixture: fixture}, nil
}

func (tx *boardSnapshotTx) QueryRow(_ context.Context, query string, _ ...any) pgx.Row {
	tx.fixture.reads++
	if !strings.Contains(query, "from public.pipelines") {
		return boardSnapshotRow{err: errors.New("unexpected snapshot row read")}
	}
	if tx.fixture.readErr != nil {
		return boardSnapshotRow{err: tx.fixture.readErr}
	}
	if tx.fixture.hasPipeline {
		return boardSnapshotRow{}
	}
	return boardSnapshotRow{err: pgx.ErrNoRows}
}

func (tx *boardSnapshotTx) Query(_ context.Context, query string, _ ...any) (pgx.Rows, error) {
	tx.fixture.reads++
	if !strings.Contains(query, "with selected_pipeline") {
		return nil, errors.New("unexpected snapshot query")
	}
	if tx.fixture.readErr != nil {
		return nil, tx.fixture.readErr
	}
	return &boardSnapshotRows{stage: tx.fixture.hasStage}, nil
}

func (tx *boardSnapshotTx) SendBatch(_ context.Context, batch *pgx.Batch) pgx.BatchResults {
	tx.fixture.batches++
	if len(batch.QueuedQueries) != 2 || !strings.Contains(batch.QueuedQueries[0].SQL, "with requested_stages(stage_id)") ||
		!strings.Contains(batch.QueuedQueries[1].SQL, "group by l.stage_id") {
		tx.fixture.previewErr = errors.New("unexpected snapshot batch")
	}
	return &boardSnapshotBatch{fixture: tx.fixture}
}

func (tx *boardSnapshotTx) Commit(context.Context) error {
	tx.fixture.commits++
	return tx.fixture.commitErr
}

func (tx *boardSnapshotTx) Rollback(context.Context) error {
	tx.fixture.rollbacks++
	return nil
}

func TestPipelineBoardSnapshotOwnsReadOnlyRepeatableReadTransaction(t *testing.T) {
	fixture := &boardSnapshotFixture{}
	board, err := (Repository{}).readPipelineBoardSnapshot(context.Background(), fixture, tenant.Context{}, PipelineBoardFilter{})
	if err != nil || board == nil || len(board) != 0 {
		t.Fatalf("no-pipeline snapshot must be an explicit empty board: %v, %v", board, err)
	}
	if fixture.options.IsoLevel != pgx.RepeatableRead || fixture.options.AccessMode != pgx.ReadOnly ||
		fixture.begins != 1 || fixture.reads != 1 || fixture.commits != 1 || fixture.rollbacks != 1 || fixture.batches != 0 {
		t.Fatalf("snapshot did not own one read transaction: %+v", fixture)
	}
}

func TestPipelineBoardSnapshotFailureNeverReturnsPartialBoard(t *testing.T) {
	for _, phase := range []string{"begin", "read", "preview", "metrics", "batch close", "commit"} {
		t.Run(phase, func(t *testing.T) {
			failure := errors.New("synthetic snapshot " + phase + " failure")
			fixture := &boardSnapshotFixture{}
			switch phase {
			case "begin":
				fixture.beginErr = failure
			case "read":
				fixture.readErr = failure
			case "preview":
				fixture.hasStage, fixture.previewErr = true, failure
			case "metrics":
				fixture.hasStage, fixture.metricsErr = true, failure
			case "batch close":
				fixture.hasStage, fixture.closeErr = true, failure
			case "commit":
				fixture.commitErr = failure
			}
			board, err := (Repository{}).readPipelineBoardSnapshot(context.Background(), fixture, tenant.Context{}, PipelineBoardFilter{})
			if !errors.Is(err, failure) || board != nil || fixture.begins != 1 {
				t.Fatalf("failed snapshot exposed a payload: %v, %v, %+v", board, err, fixture)
			}
			if phase == "begin" {
				if fixture.reads != 0 || fixture.commits != 0 || fixture.rollbacks != 0 {
					t.Fatalf("begin failure used a transaction: %+v", fixture)
				}
			} else if fixture.rollbacks != 1 || (phase != "commit" && fixture.commits != 0) {
				t.Fatalf("read/commit failure did not roll back: %+v", fixture)
			}
			if fixture.hasStage && (fixture.batches != 1 || fixture.batchCloses == 0) {
				t.Fatalf("incomplete batch accounting: %+v", fixture)
			}
		})
	}
}

func TestPipelineBoardSnapshotExplicitEmptyStillDistinguishesUnavailablePipeline(t *testing.T) {
	filter := PipelineBoardFilter{PipelineID: snapshotPipelineID}
	fixture := &boardSnapshotFixture{hasPipeline: true}
	board, err := (Repository{}).readPipelineBoardSnapshot(context.Background(), fixture, tenant.Context{}, filter)
	if err != nil || board == nil || len(board) != 0 || fixture.reads != 2 || fixture.batches != 0 || fixture.commits != 1 {
		t.Fatalf("explicit valid empty pipeline changed behavior: %v, %v, %+v", board, err, fixture)
	}
	fixture = &boardSnapshotFixture{}
	board, err = (Repository{}).readPipelineBoardSnapshot(context.Background(), fixture, tenant.Context{}, filter)
	if !errors.Is(err, ErrInvalidReference) || board != nil || fixture.reads != 2 || fixture.batches != 0 || fixture.commits != 0 {
		t.Fatalf("unavailable explicit pipeline changed behavior: %v, %v, %+v", board, err, fixture)
	}
}

func TestPipelineBoardSnapshotInvalidFilterStopsBeforeSQL(t *testing.T) {
	fixture := &boardSnapshotFixture{}
	board, err := (Repository{}).readPipelineBoardSnapshot(context.Background(), fixture, tenant.Context{}, PipelineBoardFilter{PipelineID: "invalid"})
	if !errors.Is(err, ErrInvalidInput) || board != nil || fixture.reads != 0 || fixture.commits != 0 || fixture.rollbacks != 1 {
		t.Fatalf("invalid filter reached SQL or returned data: %v, %v, %+v", board, err, fixture)
	}
}
