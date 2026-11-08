package pipelines

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

type stageAutomationNamesRow struct {
	names []string
	err   error
}

func (row stageAutomationNamesRow) Scan(dest ...any) error {
	if row.err == nil {
		*dest[0].(*[]string) = row.names
	}
	return row.err
}

type stageAutomationQuery struct {
	names []string
	query string
	args  []any
	err   error
}

func (query *stageAutomationQuery) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	if sql == stageMoveRulesAvailableSQL {
		return boolRow{value: false}
	}
	query.query, query.args = sql, args
	return stageAutomationNamesRow{names: query.names, err: query.err}
}

func TestStageAutomationDependenciesPreserveNarrowTenantScope(t *testing.T) {
	for _, organization := range []string{"organization-A", "organization-B"} {
		for _, stageID := range []string{"stage", ""} {
			query := &stageAutomationQuery{}
			if err := (Repository{}).ensureStageAutomationReferencesSafe(context.Background(), query, organization, "pipeline", stageID); err != nil {
				t.Fatal(err)
			}
			wantPipeline := "pipeline"
			if stageID != "" {
				wantPipeline = "" // An archive must not block on a sibling stage.
			}
			if len(query.args) != 3 || query.args[0] != organization || query.args[1] != wantPipeline || query.args[2] != stageID {
				t.Fatalf("dependency scope broadened: %#v", query.args)
			}
		}
	}
}

func TestStageAutomationDependenciesFailClosedAndExplainFlows(t *testing.T) {
	for _, operation := range []string{"archive", "delete"} {
		t.Run(operation, func(t *testing.T) {
			var err error
			if operation == "archive" {
				err = (Repository{}).ensureStageArchiveRoutingSafe(context.Background(), &archiveQuery{automations: []string{"Follow-up"}}, "org", "pipeline", "stage")
			} else {
				err = (Repository{}).ensureStageAutomationReferencesSafe(context.Background(), &stageAutomationQuery{names: []string{"Follow-up"}}, "org", "", "stage")
			}
			var dependency *StageAutomationDependenciesError
			if !errors.As(err, &dependency) || !errors.Is(err, ErrHasDependencies) {
				t.Fatalf("live flow allowed: %v", err)
			}
			response := httptest.NewRecorder()
			writePipelineError(response, httptest.NewRequest(http.MethodPatch, "/v1/stages/synthetic", nil), err)
			if response.Code != 409 || !strings.Contains(response.Body.String(), `"code":"stage_has_automation_dependencies"`) || !strings.Contains(response.Body.String(), "Follow-up") {
				t.Fatalf("missing actionable conflict: %d %s", response.Code, response.Body.String())
			}
		})
	}
	want := errors.New("synthetic dependency read failure")
	if err := (Repository{}).ensureStageAutomationReferencesSafe(context.Background(), &stageAutomationQuery{err: want}, "org", "", "stage"); !errors.Is(err, want) {
		t.Fatalf("read failure ignored: %v", err)
	}
	message := (&StageAutomationDependenciesError{Automations: []string{"First\nflow", "Second", "Third", "Fourth", "Fifth", "Sixth"}}).Error()
	if strings.Contains(message, "\n") || strings.Contains(message, "Sixth") || !strings.Contains(message, "First flow") || !strings.Contains(message, "outros fluxos") {
		t.Fatalf("names should be bounded plain text: %q", message)
	}
}

func TestStageAutomationDependenciesUseExecutableGraphsOnly(t *testing.T) {
	for _, contract := range []string{
		"version.id = a.active_flow_version_id", "version.organization_id = a.organization_id", "version.automation_id = a.id",
		"a.organization_id = $1::uuid and a.is_active = true and a.deleted_at is null", "version.requires_review = false",
		"version.id = execution.flow_version_id", "version.organization_id = execution.organization_id", "version.automation_id = execution.automation_id",
		"status in ('queued', 'running', 'waiting')", "select distinct organization_id, automation_id, flow_version_id",
		"a.active_flow_version_id is null", "legacy.flow_version_id is null", "legacy.organization_id = a.organization_id",
		"jsonb_typeof(graph.graph->'nodes') = 'array'", "node->>'type' = 'action' and node->>'action_type' = 'move_lead'",
		"node#>>'{config,stage_id}'", "node#>>'{config,to_stage_id}'", "node#>>'{config,pipeline_id}'",
		"order by name limit 6", "organization_id = $1::uuid",
	} {
		if !strings.Contains(stageAutomationReferencesSQL, contract) {
			t.Fatalf("missing executable-reference contract %q", contract)
		}
	}
	if strings.Contains(stageAutomationReferencesSQL, "a.flow_definition") || strings.Contains(stageAutomationReferencesSQL, "'completed'") || strings.Contains(stageAutomationReferencesSQL, "'cancelled'") {
		t.Fatal("abandoned drafts and terminal executions must not block stage maintenance")
	}
}

func TestStageAutomationDependenciesRunAfterPermissionBeforeDeletion(t *testing.T) {
	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, name := range []string{"Delete", "DeleteStage"} {
		start := strings.Index(source, "func (repo Repository) "+name+"(")
		if start < 0 {
			t.Fatalf("missing %s", name)
		}
		method := source[start:]
		if next := strings.Index(method[1:], "\nfunc "); next >= 0 {
			method = method[:next+1]
		}
		permission := strings.Index(method, "canManagePipelines(")
		dependencies := strings.Index(method, "repo.hasDeletionDependencies(")
		mutation := strings.Index(method, "tx.Exec(")
		if permission < 0 || dependencies < permission || mutation < dependencies {
			t.Fatalf("%s must authorize before revealing names and check before deleting", name)
		}
	}
	if !strings.Contains(source, "if err := repo.ensureStageAutomationReferencesSafe(ctx, tx, organizationID, pipelineID, stageID); err != nil") {
		t.Fatal("both deletion endpoints must check visual flow dependencies")
	}
}
