package leads

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
)

type destinationTestRow struct {
	values []any
	err    error
}

func (row destinationTestRow) Scan(targets ...any) error {
	if row.err != nil {
		return row.err
	}
	if len(targets) != len(row.values) {
		return errors.New("unexpected destination scan shape")
	}
	for index, value := range row.values {
		reflect.ValueOf(targets[index]).Elem().Set(reflect.ValueOf(value))
	}
	return nil
}

type destinationTestQueryer struct {
	row   pgx.Row
	calls int
}

func (q *destinationTestQueryer) QueryRow(context.Context, string, ...any) pgx.Row {
	q.calls++
	return q.row
}

func TestCreateDestinationRejectsSelectedEmptyPipelineAndKeepsUnscopedIntake(t *testing.T) {
	pipeline, stage := "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"
	text := func(value string) pgtype.Text { return pgtype.Text{String: value, Valid: true} }
	for _, scenario := range []struct {
		name     string
		pipeline *string
		row      pgx.Row
		want     error
		scoped   bool
	}{
		{"explicit empty", &pipeline, destinationTestRow{values: []any{pipeline, pgtype.Text{}, pgtype.Text{}}}, distribution.ErrIntakeDestinationUnavailable, false},
		{"default empty", nil, destinationTestRow{values: []any{text(pipeline), pgtype.Text{}, pgtype.Text{}}}, distribution.ErrIntakeDestinationUnavailable, false},
		{"no pipeline configured", nil, destinationTestRow{err: pgx.ErrNoRows}, nil, false},
		{"explicit complete", &pipeline, destinationTestRow{values: []any{pipeline, text(stage), text("Active")}}, nil, true},
		{"default complete", nil, destinationTestRow{values: []any{text(pipeline), text(stage), text("Active")}}, nil, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			q := &destinationTestQueryer{row: scenario.row}
			got, err := (Repository{}).resolveDestination(t.Context(), q, "11111111-1111-4111-8111-111111111111", scenario.pipeline, nil)
			if !errors.Is(err, scenario.want) {
				t.Fatalf("destination=%#v error=%v", got, err)
			}
			if err == nil && ((got.PipelineID != nil && got.StageID != nil) != scenario.scoped) {
				t.Fatalf("destination scope changed: %#v", got)
			}
			if q.calls != 1 {
				t.Fatal("preflight unexpectedly wrote or queried again")
			}
		})
	}
}

func TestDestinationGuardRejectsBeforeLegacyCreationOutcomeEffects(t *testing.T) {
	actor, before := creationOutcomeActor(), creationOutcomeSnapshot()
	pipeline := "33333333-3333-4333-8333-333333333333"
	for _, deferred := range []bool{false, true} {
		tx := &creationOutcomeTestTx{}
		ops := creationOutcomeOperations(tx, before, "won")
		ops.snapshot = func() (leadSnapshot, error) {
			return before, distribution.LockIntakePipelineDestination(t.Context(), nil, actor.OrganizationID, &pipeline, nil)
		}
		_, err := runLeadCreationOutcome(t.Context(), tx, actor, createInput{DealStatus: "open"}, leadCreationOutcome{LeadID: before.ID, Deferred: deferred}, ops)
		if !errors.Is(err, distribution.ErrIntakeDestinationUnavailable) || len(tx.sequence) != 0 {
			t.Fatalf("deferred=%t error=%v effects=%v", deferred, err, tx.sequence)
		}
	}
}

func TestDestinationHTTPFailureIsActionableWithoutTenantReferenceDisclosure(t *testing.T) {
	response := httptest.NewRecorder()
	writeLeadError(response, httptest.NewRequest(http.MethodPost, "/v1/leads", nil), distribution.ErrIntakeDestinationUnavailable)
	if response.Code != 400 || !strings.Contains(response.Body.String(), `"code":"lead_destination_unavailable"`) || !strings.Contains(response.Body.String(), "coluna ativa") {
		t.Fatalf("response=%d %s", response.Code, response.Body.String())
	}
}
