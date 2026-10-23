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
	begins, reads, commits, rollbacks int
}

type boardSnapshotTx struct {
	pgx.Tx
	fixture *boardSnapshotFixture
}

type boardSnapshotRow struct{ err error }

func (row boardSnapshotRow) Scan(...any) error { return row.err }

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
	return boardSnapshotRow{err: pgx.ErrNoRows}
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
		fixture.begins != 1 || fixture.reads != 2 || fixture.commits != 1 || fixture.rollbacks != 1 {
		t.Fatalf("snapshot did not own one read transaction: %+v", fixture)
	}
}

func TestPipelineBoardSnapshotFailureNeverReturnsPartialBoard(t *testing.T) {
	for _, phase := range []string{"begin", "read", "commit"} {
		t.Run(phase, func(t *testing.T) {
			failure := errors.New("synthetic snapshot " + phase + " failure")
			fixture := &boardSnapshotFixture{}
			switch phase {
			case "begin":
				fixture.beginErr = failure
			case "read":
				fixture.readErr = failure
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
			} else if fixture.rollbacks != 1 || (phase == "read" && fixture.commits != 0) {
				t.Fatalf("read/commit failure did not roll back: %+v", fixture)
			}
		})
	}
}

func TestPipelineBoardSnapshotInvalidFilterStopsBeforeSQL(t *testing.T) {
	fixture := &boardSnapshotFixture{}
	board, err := (Repository{}).readPipelineBoardSnapshot(context.Background(), fixture, tenant.Context{}, PipelineBoardFilter{PipelineID: "invalid"})
	if !errors.Is(err, ErrInvalidInput) || board != nil || fixture.reads != 0 || fixture.commits != 0 || fixture.rollbacks != 1 {
		t.Fatalf("invalid filter reached SQL or returned data: %v, %v, %+v", board, err, fixture)
	}
}
