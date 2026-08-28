package leads

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestPipelineBoardStageExposesQualifiedMarker(t *testing.T) {
	payload, err := json.Marshal(PipelineBoardStage{
		ID:          "11111111-1111-4111-8111-111111111111",
		IsQualified: true,
		Leads:       []PipelineBoardLead{},
	})
	if err != nil {
		t.Fatalf("marshal pipeline board stage: %v", err)
	}
	if !strings.Contains(string(payload), `"is_qualified":true`) {
		t.Fatalf("pipeline board stage JSON missing qualified marker: %s", payload)
	}

	source, err := os.ReadFile("pipeline_board.go")
	if err != nil {
		t.Fatalf("read pipeline_board.go: %v", err)
	}
	functionSource := string(source)
	start := strings.Index(functionSource, "func (repo Repository) listPipelineBoardStages")
	if start < 0 {
		t.Fatal("could not find listPipelineBoardStages source")
	}
	end := strings.Index(functionSource[start:], "func (repo Repository) listPipelineBoardLeads")
	if end < 0 {
		t.Fatal("could not isolate listPipelineBoardStages source")
	}
	functionSource = functionSource[start : start+end]

	for _, contract := range []string{
		"coalesce((to_jsonb(s)->>'is_qualified')::boolean, false)",
		"&stage.IsQualified",
	} {
		if !strings.Contains(functionSource, contract) {
			t.Fatalf("pipeline board stage projection must contain %q", contract)
		}
	}
}
