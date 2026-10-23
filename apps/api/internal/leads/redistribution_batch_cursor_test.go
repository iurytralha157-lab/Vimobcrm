package leads

import (
	"context"
	"errors"
	"math"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5"
)

type cursorRedistributionTx struct {
	candidatePolicyTx
	requestedOffsets []int64
	scanErr          error
}

func (tx *cursorRedistributionTx) Query(_ context.Context, _ string, args ...any) (pgx.Rows, error) {
	offset := args[1].(int64)
	tx.requestedOffsets = append(tx.requestedOffsets, offset)
	if tx.scanErr != nil {
		return &candidatePolicyRows{rows: []redistributionLockedJobRow{{err: tx.scanErr}}}, nil
	}
	all := append(append([]redistributionLockedJobRow(nil), tx.older...), tx.listed)
	if offset >= int64(len(all)) {
		return &candidatePolicyRows{}, nil
	}
	end := offset + int64(args[0].(int))
	if end > int64(len(all)) {
		end = int64(len(all))
	}
	return &candidatePolicyRows{rows: all[offset:end]}, nil
}

func TestRedistributionBatchCursorMovesPastFiftyBusyJobsOnTheNextTick(t *testing.T) {
	for _, kind := range []string{"warning", "due", "policy"} {
		t.Run(kind, func(t *testing.T) {
			repo := Repository{redistributionCursors: &redistributionBatchCursors{}}
			tx := &cursorRedistributionTx{candidatePolicyTx: *newCandidatePolicyTx(kind, 40, 10, 100)}
			process := func() error {
				switch kind {
				case "warning":
					return repo.processRedistributionWarnings(context.Background(), tx)
				case "due":
					return repo.processDueRedistributions(context.Background(), tx)
				default:
					return repo.refreshPendingRedistributionPolicies(context.Background(), tx)
				}
			}
			if err := process(); err != nil {
				t.Fatal(err)
			}
			if tx.refreshSkipped != 50 || tx.policyWrites != 0 {
				t.Fatalf("first page skipped=%d policyWrites=%d", tx.refreshSkipped, tx.policyWrites)
			}
			if err := process(); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(tx.requestedOffsets, []int64{0, 50}) || tx.policyWrites != 1 || tx.policyScope[0] != tx.listed.job.ID {
				t.Fatalf("candidate51 was not reached on the next tick: offsets=%v writes=%d scope=%v", tx.requestedOffsets, tx.policyWrites, tx.policyScope)
			}
			if len(tx.executions) != 1 {
				t.Fatalf("new deadline still produced an early action: %#v", tx.executions)
			}
			page := redistributionPolicyPage
			if kind == "warning" {
				page = redistributionWarningPage
			} else if kind == "due" {
				page = redistributionDuePage
			}
			if *repo.redistributionBatchCursor(page) != 0 {
				t.Fatal("the short final page did not wrap")
			}
		})
	}
}

func TestRedistributionBatchCursorWrapsEmptyPageAndAvoidsOverflow(t *testing.T) {
	offset := int64(100)
	advanceRedistributionBatchCursor(&offset, 0)
	if offset != 0 {
		t.Fatal("empty page did not wrap")
	}
	offset = math.MaxInt64 - 20
	advanceRedistributionBatchCursor(&offset, 50)
	if offset != 0 {
		t.Fatal("cursor overflowed to a negative offset")
	}
	advanceRedistributionBatchCursor(nil, 50)
	if redistributionBatchOffset(nil) != 0 {
		t.Fatal("manual repository has a nonzero cursor")
	}
}

func TestRedistributionBatchCursorDoesNotAdvanceFailedScansOrManualRepositories(t *testing.T) {
	repo := Repository{redistributionCursors: &redistributionBatchCursors{due: 50}}
	readErr := errors.New("synthetic scan failure")
	tx := &cursorRedistributionTx{candidatePolicyTx: *newCandidatePolicyTx("due", 40, 10, 100), scanErr: readErr}
	if err := repo.processDueRedistributions(context.Background(), tx); !errors.Is(err, readErr) {
		t.Fatalf("scan failure=%v", err)
	}
	if repo.redistributionCursors.due != 50 {
		t.Fatal("failed scan advanced the cursor")
	}
	manual := Repository{}
	tx = &cursorRedistributionTx{candidatePolicyTx: *newCandidatePolicyTx("due", 40, 10, 100)}
	for tick := 0; tick < 2; tick++ {
		if err := manual.processDueRedistributions(context.Background(), tx); err != nil {
			t.Fatal(err)
		}
	}
	if !reflect.DeepEqual(tx.requestedOffsets, []int64{0, 0}) || manual.redistributionCursors != nil {
		t.Fatal("manual repository unexpectedly acquired persistent cursor state")
	}
}

func TestRedistributionBatchCursorsAreIndependentAcrossWorkerCopies(t *testing.T) {
	original := Repository{}
	first, second := original, original
	first.redistributionCursors = &redistributionBatchCursors{}
	second.redistributionCursors = &redistributionBatchCursors{}
	advanceRedistributionBatchCursor(first.redistributionBatchCursor(redistributionDuePage), 50)
	if original.redistributionCursors != nil || second.redistributionCursors.due != 0 || first.redistributionCursors.due != 50 {
		t.Fatal("worker copies share mutable cursor state")
	}
}
