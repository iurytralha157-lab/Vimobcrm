package roundrobin

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	destinationTestOrg           = "11111111-1111-4111-8111-111111111111"
	destinationTestOtherOrg      = "11111111-1111-4111-8111-111111111112"
	destinationTestPipeline      = "22222222-2222-4222-8222-222222222222"
	destinationTestOtherPipeline = "22222222-2222-4222-8222-222222222223"
	destinationTestStage         = "33333333-3333-4333-8333-333333333333"
)

// The in-memory rows model existing but inactive or concurrently locked
// references. Current SQL determines whether activity/locking is required.
type destinationTestQueryer struct {
	organization                string
	pipelineActive, stageActive bool
	pipelineExists, stageExists bool
	pipelineBusy, stageBusy     bool
	stagePipeline               string
	err                         error
	calls                       []string
}

func activeDestinationTestQueryer() *destinationTestQueryer {
	return &destinationTestQueryer{organization: destinationTestOrg, pipelineActive: true, stageActive: true, pipelineExists: true, stageExists: true, stagePipeline: destinationTestPipeline}
}

func (q *destinationTestQueryer) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	q.calls = append(q.calls, sql)
	if q.err != nil {
		return hardeningErrorRow{q.err}
	}
	if len(args) < 2 {
		return hardeningErrorRow{errors.New("missing tenant/reference arguments")}
	}
	exists := args[0] == q.organization
	active, busy := q.pipelineActive, q.pipelineBusy
	if strings.Contains(sql, "public.stages") {
		exists = exists && q.stageExists && args[1] == destinationTestStage
		if len(args) != 3 {
			return hardeningErrorRow{errors.New("stage query omitted pipeline binding")}
		}
		if args[2] != nil {
			exists = exists && args[2] == q.stagePipeline
		}
		active, busy = q.stageActive, q.stageBusy
	} else if strings.Contains(sql, "public.pipelines") {
		exists = exists && q.pipelineExists && args[1] == destinationTestPipeline
	} else {
		return hardeningErrorRow{errors.New("unexpected reference query")}
	}
	if strings.Contains(sql, "is_active") {
		exists = exists && active
	}
	locked := exists && !busy && strings.Contains(strings.ToLower(sql), "for share skip locked")
	return destinationTestRow{exists: exists, locked: locked}
}

func (*destinationTestQueryer) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("unexpected rowset query")
}
func (*destinationTestQueryer) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, errors.New("unexpected reference mutation")
}

type destinationTestRow struct{ exists, locked bool }

func (row destinationTestRow) Scan(dest ...any) error {
	if len(dest) < 1 || len(dest) > 2 {
		return fmt.Errorf("unexpected reference columns: %d", len(dest))
	}
	*(dest[0].(*bool)) = row.exists
	if len(dest) == 2 {
		*(dest[1].(*pgtype.Text)) = pgtype.Text{String: "locked-reference", Valid: row.locked}
	}
	return nil
}

func TestQueueNewDestinationRejectsInactiveAndForeignReferences(t *testing.T) {
	for _, scenario := range []string{"active", "inactive pipeline", "inactive stage", "missing pipeline", "missing stage", "foreign tenant", "different pipeline"} {
		t.Run(scenario, func(t *testing.T) {
			q := activeDestinationTestQueryer()
			want := ErrInvalidReference
			switch scenario {
			case "active":
				want = nil
			case "inactive pipeline":
				q.pipelineActive = false
			case "inactive stage":
				q.stageActive = false
			case "missing pipeline":
				q.pipelineExists = false
			case "missing stage":
				q.stageExists = false
			case "foreign tenant":
				q.organization = destinationTestOtherOrg
			case "different pipeline":
				q.stagePipeline = destinationTestOtherPipeline
			}
			err := (Repository{}).validateDestination(context.Background(), q, destinationTestOrg, stringPointer(destinationTestPipeline), stringPointer(destinationTestStage))
			if !errors.Is(err, want) {
				t.Fatalf("error=%v, want %v", err, want)
			}
		})
	}
}

func TestQueueDestinationLocksParentThenStageWithoutWaitingOnBusyReferences(t *testing.T) {
	for _, scenario := range []string{"active", "busy pipeline", "busy stage", "query failure"} {
		t.Run(scenario, func(t *testing.T) {
			q := activeDestinationTestQueryer()
			var want error
			switch scenario {
			case "busy pipeline":
				q.pipelineBusy, want = true, ErrRevisionConflict
			case "busy stage":
				q.stageBusy, want = true, ErrRevisionConflict
			case "query failure":
				q.err = errors.New("synthetic reference read failure")
				want = q.err
			}
			err := (Repository{}).validateDestination(context.Background(), q, destinationTestOrg, stringPointer(destinationTestPipeline), stringPointer(destinationTestStage))
			if !errors.Is(err, want) {
				t.Fatalf("error=%v, want %v", err, want)
			}
			if !strings.Contains(q.calls[0], "public.pipelines") {
				t.Fatal("pipeline must be inspected before its stage")
			}
			if scenario == "active" && (len(q.calls) != 2 || !strings.Contains(q.calls[1], "public.stages")) {
				t.Fatalf("unexpected reference order: %#v", q.calls)
			}
			if scenario == "busy pipeline" && len(q.calls) != 1 {
				t.Fatal("busy parent must stop before accessing a child")
			}
			if scenario != "query failure" {
				for _, sql := range q.calls {
					if strings.Count(sql, "organization_id = $1::uuid") != 2 || !strings.Contains(strings.ToLower(sql), "for share skip locked") {
						t.Fatalf("both active visibility and nonblocking lock must be tenant-scoped: %s", sql)
					}
				}
			}
		})
	}
}

func TestQueueDestinationErrorsUseExistingReferenceAndConflictContracts(t *testing.T) {
	for _, scenario := range []struct {
		err    error
		status int
		code   string
	}{
		{ErrInvalidReference, 400, "invalid_round_robin_reference"},
		{ErrRevisionConflict, 409, "round_robin_revision_conflict"},
	} {
		response := httptest.NewRecorder()
		writeRoundRobinError(response, httptest.NewRequest(http.MethodPatch, "/v1/round-robins/synthetic", nil), scenario.err)
		if response.Code != scenario.status || !strings.Contains(response.Body.String(), `"code":"`+scenario.code+`"`) {
			t.Fatalf("status=%d body=%s", response.Code, response.Body)
		}
	}
}

func TestQueueRenamePreservesUnchangedLegacyDestinationEvenWhenIDsAreRepeated(t *testing.T) {
	for _, scenario := range []string{"inactive references", "removed references", "unscoped legacy queue"} {
		t.Run(scenario, func(t *testing.T) {
			current := roundRobinState{PipelineID: stringPointer(destinationTestPipeline), Metadata: map[string]any{"target_stage_id": destinationTestStage}}
			if scenario == "unscoped legacy queue" {
				current.PipelineID, current.Metadata = nil, map[string]any{}
			}
			pipeline, stage := cloneStringPointer(current.PipelineID), stringPointerFromMetadata(current.Metadata, "target_stage_id")
			q := activeDestinationTestQueryer()
			q.err = errors.New("an unchanged legacy pair must not need a fresh destination lookup")
			if err := (Repository{}).validateUpdatedDestination(context.Background(), q, destinationTestOrg, current, pipeline, stage); err != nil {
				t.Fatal(err)
			}
			if len(q.calls) != 0 {
				t.Fatalf("retained destination was revalidated: %#v", q.calls)
			}
			if !sameOptionalString(current.PipelineID, pipeline) || !sameOptionalString(stringPointerFromMetadata(current.Metadata, "target_stage_id"), stage) {
				t.Fatal("legacy destination was altered")
			}
		})
	}
}

func TestQueueDestinationChangeRevalidatesWholePair(t *testing.T) {
	for _, scenario := range []string{"new pipeline with inactive retained stage", "new stage with inactive retained pipeline", "new active pair", "clearing legacy pair"} {
		t.Run(scenario, func(t *testing.T) {
			current := roundRobinState{PipelineID: stringPointer(destinationTestPipeline), Metadata: map[string]any{"target_stage_id": destinationTestStage}}
			pipeline, stage := stringPointer(destinationTestPipeline), stringPointer(destinationTestStage)
			q := activeDestinationTestQueryer()
			var want error
			switch scenario {
			case "new pipeline with inactive retained stage":
				current.PipelineID = stringPointer(destinationTestOtherPipeline)
				q.stageActive = false
				want = ErrInvalidReference
			case "new stage with inactive retained pipeline":
				current.Metadata["target_stage_id"] = "33333333-3333-4333-8333-333333333334"
				q.pipelineActive = false
				want = ErrInvalidReference
			case "new active pair":
				current.PipelineID, current.Metadata = nil, map[string]any{}
			case "clearing legacy pair":
				pipeline, stage = nil, nil
			}
			err := (Repository{}).validateUpdatedDestination(context.Background(), q, destinationTestOrg, current, pipeline, stage)
			if !errors.Is(err, want) {
				t.Fatalf("error=%v want=%v", err, want)
			}
			if scenario != "clearing legacy pair" && len(q.calls) == 0 {
				t.Fatal("changed pair bypassed validation")
			}
		})
	}
}

func TestQueueDestinationValidationStaysBeforeMutationAndCommit(t *testing.T) {
	createSource := repositoryFunctionSource(t, "Create")
	requireRepositoryOrder(t, createSource, "repo.validateDestination(", "insert into public.round_robins")
	updateSource := repositoryFunctionSource(t, "Update")
	requireRepositoryOrder(t, updateSource, "checkExpectedRevision(", "repo.validateUpdatedDestination(")
	requireRepositoryOrder(t, updateSource, "repo.validateUpdatedDestination(", "update public.round_robins")
	requireRepositoryOrder(t, updateSource, "repo.validateUpdatedDestination(", "tx.Commit(ctx)")
}
