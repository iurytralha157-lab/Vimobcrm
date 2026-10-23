package distribution

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestIntakeDestinationRequiresACompleteSelectedPipeline(t *testing.T) {
	pipeline, stage := "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"
	empty := ""
	for _, scenario := range []struct {
		name            string
		pipeline, stage *string
		want            error
	}{
		{"intentionally unscoped", nil, nil, nil},
		{"selected pipeline without stage", &pipeline, nil, ErrIntakeDestinationUnavailable},
		{"stage without pipeline", nil, &stage, ErrIntakeDestinationUnavailable},
		{"empty pipeline", &empty, &stage, ErrIntakeDestinationUnavailable},
		{"empty stage", &pipeline, &empty, ErrIntakeDestinationUnavailable},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			stub := &intakeRoutingQueryer{}
			if err := LockIntakePipelineDestination(t.Context(), stub, "org", scenario.pipeline, scenario.stage); !errors.Is(err, scenario.want) {
				t.Fatalf("error=%v, want %v", err, scenario.want)
			}
			if len(stub.calls) != 0 {
				t.Fatal("incomplete destination reached SQL")
			}
		})
	}
}

func TestIntakeDestinationLocksParentThenExactActiveTenantStage(t *testing.T) {
	org, pipeline, stage := "11111111-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"
	sentinel := errors.New("synthetic SQL failure")
	for _, scenario := range []struct {
		name  string
		rows  []pgx.Row
		want  error
		calls int
	}{
		{"valid", []pgx.Row{intakeRoutingRow{values: []any{pipeline}}, intakeRoutingRow{values: []any{stage}}}, nil, 2},
		{"foreign missing or inactive parent", []pgx.Row{intakeRoutingRow{err: pgx.ErrNoRows}}, ErrIntakeDestinationUnavailable, 1},
		{"foreign inactive or mismatched stage", []pgx.Row{intakeRoutingRow{values: []any{pipeline}}, intakeRoutingRow{err: pgx.ErrNoRows}}, ErrIntakeDestinationUnavailable, 2},
		{"parent SQL failure", []pgx.Row{intakeRoutingRow{err: sentinel}}, sentinel, 1},
		{"stage SQL failure", []pgx.Row{intakeRoutingRow{values: []any{pipeline}}, intakeRoutingRow{err: sentinel}}, sentinel, 2},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			stub := &intakeRoutingQueryer{rows: scenario.rows}
			if err := LockIntakePipelineDestination(context.Background(), stub, org, &pipeline, &stage); !errors.Is(err, scenario.want) {
				t.Fatalf("error=%v", err)
			}
			if len(stub.calls) != scenario.calls {
				t.Fatalf("SQL calls=%d", len(stub.calls))
			}
			for index, call := range stub.calls {
				if !strings.Contains(call.sql, "for share") || !strings.Contains(call.sql, "coalesce(is_active,true)") || call.args[0] != org || call.args[1] != pipeline {
					t.Fatal("lock lost active tenant scope")
				}
				if index == 0 && !strings.Contains(call.sql, "public.pipelines") {
					t.Fatal("child locked before parent")
				}
				if index == 1 && (!strings.Contains(call.sql, "pipeline_id=$2::uuid") || call.args[2] != stage) {
					t.Fatal("stage lost exact parent relation")
				}
			}
		})
	}
}

func TestPersistedIntakeChecksEffectiveDestinationInsteadOfRequest(t *testing.T) {
	pipeline, stage := "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"
	for _, scenario := range []struct {
		name, pipeline, stage string
		want                  error
		calls                 int
	}{
		{"unscoped", "", "", nil, 1},
		{"trigger removed stage", pipeline, "", ErrIntakeDestinationUnavailable, 1},
		{"trigger removed parent", "", stage, ErrIntakeDestinationUnavailable, 1},
		{"valid effective destination", pipeline, stage, nil, 3},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			stub := &intakeRoutingQueryer{rows: []pgx.Row{intakeRoutingRow{values: []any{scenario.pipeline, scenario.stage}}, intakeRoutingRow{values: []any{pipeline}}, intakeRoutingRow{values: []any{stage}}}}
			if err := ValidatePersistedIntakeDestination(t.Context(), stub, "org", "lead"); !errors.Is(err, scenario.want) {
				t.Fatalf("error=%v", err)
			}
			if len(stub.calls) != scenario.calls || stub.calls[0].args[0] != "org" || stub.calls[0].args[1] != "lead" {
				t.Fatal("effective read lost lead/tenant scope")
			}
		})
	}
	stub := &intakeRoutingQueryer{rows: []pgx.Row{intakeRoutingRow{err: pgx.ErrNoRows}}}
	if err := ValidatePersistedIntakeDestination(t.Context(), stub, "org", "foreign"); !errors.Is(err, ErrIntakeDestinationUnavailable) {
		t.Fatalf("missing scoped lead=%v", err)
	}
}
