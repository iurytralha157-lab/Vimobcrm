package automations

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

type activeStageReferenceTx struct {
	pgx.Tx
	organization   string
	pipeline       string
	stage          string
	stageActive    bool
	pipelineActive bool
	query          string
	args           []any
}

func (tx *activeStageReferenceTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	tx.query, tx.args = query, args
	if len(args) == 2 {
		if !strings.Contains(query, "p.organization_id=$2::uuid") || !strings.Contains(query, "coalesce(p.is_active, true) = true for key share of p") {
			panic("pipeline-only reference must retain tenant, activity and lock checks")
		}
		return activeStageReferenceRow{exists: args[0] == tx.pipeline && args[1] == tx.organization && tx.pipelineActive}
	}
	if !strings.Contains(query, "coalesce(s.is_active, true) = true") || !strings.Contains(query, "coalesce(p.is_active, true) = true") ||
		!strings.Contains(query, "s.organization_id = $3::uuid") || !strings.Contains(query, "p.organization_id = $3::uuid") || !strings.Contains(query, "for key share of s, p") {
		panic("publication must lock and validate active same-tenant stage and pipeline")
	}
	return activeStageReferenceRow{exists: len(args) == 3 && args[0] == tx.stage && (args[1] == "" || args[1] == tx.pipeline) && args[2] == tx.organization && tx.stageActive && tx.pipelineActive}
}

func TestAutomationStageReferencePreservesOptionalPipelineAndStage(t *testing.T) {
	for _, testCase := range []struct {
		name            string
		pipeline, stage string
		pipelineActive  bool
		want            error
	}{
		{"pipeline-only trigger filter", "pipeline", "", true, nil},
		{"inactive pipeline-only filter", "pipeline", "", false, ErrAutomationStageUnavailable},
		{"stage-only action destination", "", "stage", true, nil},
		{"wrong parent pipeline", "wrong", "stage", true, ErrAutomationStageUnavailable},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			tx := &activeStageReferenceTx{organization: "org", pipeline: "pipeline", stage: "stage", stageActive: true, pipelineActive: testCase.pipelineActive}
			if err := validateStageReference(context.Background(), tx, "org", testCase.pipeline, testCase.stage); !errors.Is(err, testCase.want) {
				t.Fatalf("optional reference result: %v want %v", err, testCase.want)
			}
		})
	}
}

type activeStageReferenceRow struct{ exists bool }

func (row activeStageReferenceRow) Scan(dest ...any) error {
	if !row.exists {
		return pgx.ErrNoRows
	}
	*dest[0].(*bool) = true
	return nil
}

func TestAutomationStageReferenceRequiresActiveSameTenantDestination(t *testing.T) {
	for _, testCase := range []struct {
		name           string
		organization   string
		stageActive    bool
		pipelineActive bool
		invalid        bool
	}{
		{"active destination", "organization-A", true, true, false},
		{"archived stage", "organization-A", false, true, true},
		{"archived pipeline", "organization-A", true, false, true},
		{"foreign organization", "organization-B", true, true, true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			tx := &activeStageReferenceTx{organization: testCase.organization, pipeline: "pipeline", stage: "stage", stageActive: testCase.stageActive, pipelineActive: testCase.pipelineActive}
			err := validateStageReference(context.Background(), tx, "organization-A", "pipeline", "stage")
			if errors.Is(err, ErrInvalidInput) != testCase.invalid || (!testCase.invalid && err != nil) {
				t.Fatalf("destination validation: %v", err)
			}
			if testCase.invalid {
				response := httptest.NewRecorder()
				writeAutomationError(response, httptest.NewRequest(http.MethodPut, "/v1/automations/synthetic/flow", nil), err)
				if response.Code != 400 || !strings.Contains(response.Body.String(), `"code":"automation_stage_unavailable"`) || strings.Contains(response.Body.String(), "organization-B") {
					t.Fatalf("missing safe destination error: %d %s", response.Code, response.Body.String())
				}
			}
		})
	}
}
