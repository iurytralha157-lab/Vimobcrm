package pipelines

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPipelineDeletionDependenciesUseConflictContract(t *testing.T) {
	request := httptest.NewRequest(http.MethodDelete, "/v1/pipelines/11111111-1111-4111-8111-111111111111", nil)
	response := httptest.NewRecorder()
	writePipelineError(response, request, ErrHasDependencies)
	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusConflict)
	}
	if !strings.Contains(response.Body.String(), `"code":"pipeline_has_dependencies"`) {
		t.Fatalf("unexpected response: %s", response.Body.String())
	}
}

func TestStaleStageSaveUsesConflictContract(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/v1/pipelines/11111111-1111-4111-8111-111111111111/stages/reorder", nil)
	response := httptest.NewRecorder()
	writePipelineError(response, request, ErrStagesChanged)
	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusConflict)
	}
	if !strings.Contains(response.Body.String(), `"code":"pipeline_stages_changed"`) {
		t.Fatalf("unexpected response: %s", response.Body.String())
	}
}
