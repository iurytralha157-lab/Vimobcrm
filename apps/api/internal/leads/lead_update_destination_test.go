package leads

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
)

func TestLeadUpdateDestinationNullPreservesExplicitClears(t *testing.T) {
	pipeline := pipelinePostgresID(3)
	for _, scenario := range []struct {
		name, currentPipeline, body string
		blocked                     bool
	}{
		{"null stage retains selected pipeline", pipeline, `{"stageId":null}`, true},
		{"explicit new pipeline and null stage", "", `{"pipelineId":"` + pipeline + `","stageId":null}`, true},
		{"explicit clear both", pipeline, `{"pipelineId":null,"stageId":null}`, false},
		{"pipeline only clears both", pipeline, `{"pipelineId":null}`, false},
		{"unscoped lead stays unscoped", "", `{"stageId":null}`, false},
		{"profile edit on legacy orphan", pipeline, `{"name":"Updated name"}`, false},
		{"valid stage is resolved separately", pipeline, `{"stageId":"` + pipelinePostgresID(4) + `"}`, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			var request UpdateRequest
			if err := json.Unmarshal([]byte(scenario.body), &request); err != nil {
				t.Fatal(err)
			}
			input, err := request.Validate()
			if err != nil {
				t.Fatal(err)
			}
			err = validateLeadUpdateDestination(leadSnapshot{PipelineID: scenario.currentPipeline}, input)
			if errors.Is(err, distribution.ErrIntakeDestinationUnavailable) != scenario.blocked {
				t.Fatalf("precheck=%v blocked=%t", err, scenario.blocked)
			}
		})
	}
}

type updateDestinationQueryer struct {
	rows    []pgx.Row
	queries []string
	args    [][]any
}

func (q *updateDestinationQueryer) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	q.queries = append(q.queries, query)
	q.args = append(q.args, args)
	if len(q.rows) < len(q.queries) {
		return destinationTestRow{err: errors.New("unexpected query")}
	}
	return q.rows[len(q.queries)-1]
}

func TestLeadUpdateDestinationFinalGuardChecksEffectiveReferencesWithoutWaiting(t *testing.T) {
	org, lead, pipeline, stage := pipelinePostgresID(1), pipelinePostgresID(8), pipelinePostgresID(3), pipelinePostgresID(4)
	row := func(values ...any) pgx.Row { return destinationTestRow{values: values} }
	lockError := fmt.Errorf("private postgres details: %w", &pgconn.PgError{Code: "55P03", Message: "hidden tenant identifiers"})
	otherError := errors.New("database transport error")
	for _, scenario := range []struct {
		name string
		rows []pgx.Row
		want error
	}{
		{"complete effective destination", []pgx.Row{row(pipeline, stage), row(pipeline), row(stage)}, nil},
		{"intentional unscoped", []pgx.Row{row("", "")}, nil},
		{"effective null stage", []pgx.Row{row(pipeline, "")}, distribution.ErrIntakeDestinationUnavailable},
		{"effective stage without parent", []pgx.Row{row("", stage)}, distribution.ErrIntakeDestinationUnavailable},
		{"lead missing or foreign", []pgx.Row{destinationTestRow{err: pgx.ErrNoRows}}, distribution.ErrIntakeDestinationUnavailable},
		{"parent missing foreign or inactive", []pgx.Row{row(pipeline, stage), destinationTestRow{err: pgx.ErrNoRows}}, distribution.ErrIntakeDestinationUnavailable},
		{"stage missing foreign inactive or mismatched", []pgx.Row{row(pipeline, stage), row(pipeline), destinationTestRow{err: pgx.ErrNoRows}}, distribution.ErrIntakeDestinationUnavailable},
		{"parent busy", []pgx.Row{row(pipeline, stage), destinationTestRow{err: lockError}}, ErrLeadDestinationBusy},
		{"stage busy", []pgx.Row{row(pipeline, stage), row(pipeline), destinationTestRow{err: lockError}}, ErrLeadDestinationBusy},
		{"unrelated error is retained", []pgx.Row{destinationTestRow{err: otherError}}, otherError},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			q := &updateDestinationQueryer{rows: scenario.rows}
			err := validatePersistedLeadUpdateDestination(t.Context(), q, org, lead, updateInput{StageID: patchString{Set: true}})
			if !errors.Is(err, scenario.want) || len(q.queries) != len(scenario.rows) {
				t.Fatalf("guard=%v queries=%d", err, len(q.queries))
			}
			if !reflect.DeepEqual(q.args[0], []any{org, lead}) {
				t.Fatal("effective destination read lost tenant scope")
			}
			if len(q.queries) > 1 {
				if !strings.Contains(q.queries[1], "public.pipelines") || !strings.Contains(q.queries[1], "for share nowait") || !strings.Contains(q.queries[1], "coalesce(is_active,true)") || !reflect.DeepEqual(q.args[1], []any{org, pipeline}) {
					t.Fatal("parent must be active, scoped and fail fast")
				}
			}
			if len(q.queries) > 2 {
				if !strings.Contains(q.queries[2], "public.stages") || !strings.Contains(q.queries[2], "for share nowait") || !strings.Contains(q.queries[2], "coalesce(is_active,true)") || !reflect.DeepEqual(q.args[2], []any{org, pipeline, stage}) {
					t.Fatal("stage must retain tenant and parent membership without waiting")
				}
			}
		})
	}
	if err := validatePersistedLeadUpdateDestination(t.Context(), nil, org, lead, updateInput{Name: patchString{Set: true}}); err != nil {
		t.Fatalf("unrelated legacy profile edit unexpectedly checked destination: %v", err)
	}
}

func TestLeadUpdateDestinationBusyHTTPDoesNotExposeLockDetails(t *testing.T) {
	response := httptest.NewRecorder()
	err := fmt.Errorf("hidden SQL and organization IDs: %w", ErrLeadDestinationBusy)
	writeLeadError(response, httptest.NewRequest(http.MethodPatch, "/v1/leads/synthetic", nil), err)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), `"code":"lead_destination_busy"`) || !strings.Contains(response.Body.String(), "revise a coluna") || strings.Contains(response.Body.String(), "hidden") {
		t.Fatalf("unsafe busy response: %d %s", response.Code, response.Body.String())
	}
}

func TestLeadUpdateDestinationGuardsBracketMutationWithoutChangingCAS(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	start := strings.Index(string(source), "func (repo Repository) Update(")
	if start < 0 {
		t.Fatal("Update body missing")
	}
	end := strings.Index(string(source)[start:], "func hasLeadColumnAssignment(")
	if end < 0 {
		t.Fatal("Update body missing")
	}
	body := string(source)[start : start+end]
	previous := -1
	for _, marker := range []string{"validateLeadUpdateRevision(current, input)", "validateLeadUpdateDestination(current, input)", "repo.applyDestinationDealStatus(", "prepareManualQueueTransfer(", "repo.applyDestinationAssignments(", "repo.enqueueDealWonNotifications(", "validatePersistedLeadUpdateDestination(ctx, tx,", "repo.getLeadForMutation(", "tx.Commit(ctx)"} {
		index := strings.Index(body, marker)
		if index <= previous {
			t.Fatalf("guard ordering changed at %q", marker)
		}
		previous = index
	}
}
