package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestSettingsAIOnlyLeadContextNeverLoadsPropertyCandidates(t *testing.T) {
	repo := Repository{}
	contextData, err := repo.LoadLeadContext(context.Background(), tenant.Context{
		OrganizationID: "10000000-0000-4000-8000-000000000001",
		UserID:         "20000000-0000-4000-8000-000000000001",
		MemberRole:     "user",
		Permissions:    []string{permissions.SettingsAI},
	}, "", "procure um apartamento")
	if err != nil {
		t.Fatalf("load settings-only context: %v", err)
	}
	if len(contextData.Properties) != 0 {
		t.Fatalf("settings-only context received property candidates: %#v", contextData.Properties)
	}
}

func TestAIGenerateSerializesExactlyTheScopedPropertyCandidates(t *testing.T) {
	captured := make(chan map[string]any, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		captured <- payload
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "response-1", "output_text": "ok"})
	}))
	defer server.Close()

	service := NewService(Repository{}, Config{
		OpenAIAPIKey:  "test-key",
		OpenAIBaseURL: server.URL,
		DefaultModel:  "test-model",
	})
	visible := []map[string]any{
		{"id": "visible-own", "code": "OWN-1"},
		{"id": "visible-team", "code": "TEAM-1"},
	}
	_, _, _, err := service.generate(
		context.Background(),
		Agent{Name: "Agente", Config: AgentConfig{Type: "triage", Model: "test-model"}},
		RunRequest{Message: "buscar imoveis"},
		LeadContext{Properties: visible},
	)
	if err != nil {
		t.Fatalf("generate response: %v", err)
	}
	outbound := <-captured
	input, ok := outbound["input"].(string)
	if !ok {
		t.Fatalf("OpenAI input is not a string: %#v", outbound["input"])
	}
	var modelContext struct {
		CandidateProperties []map[string]any `json:"candidateProperties"`
	}
	if err := json.Unmarshal([]byte(input), &modelContext); err != nil {
		t.Fatalf("decode model input: %v", err)
	}
	gotIDs := []string{}
	for _, property := range modelContext.CandidateProperties {
		gotIDs = append(gotIDs, property["id"].(string))
	}
	if !slices.Equal(gotIDs, []string{"visible-own", "visible-team"}) {
		t.Fatalf("model candidate IDs = %#v", gotIDs)
	}
	if strings.Contains(input, "invisible-outsider") {
		t.Fatalf("model input contains an invisible property: %s", input)
	}
}

func TestAIRunToolsUsedSharesTheScopedLeadContextPropertySet(t *testing.T) {
	raw, err := os.ReadFile("service.go")
	if err != nil {
		t.Fatalf("read service source: %v", err)
	}
	source := string(raw)
	start := strings.Index(source, "func (service Service) Run(")
	end := strings.Index(source, "func (service Service) generate(")
	if start < 0 || end <= start {
		t.Fatal("could not isolate AI Run service method")
	}
	run := source[start:end]
	for _, required := range []string{
		`"properties": len(contextData.Properties)`,
		`ToolResult{Name: "searchProperties", Data: contextData.Properties}`,
		`service.generate(ctx, selected, request, contextData)`,
	} {
		if !strings.Contains(run, required) {
			t.Fatalf("AI Run output bypasses the scoped lead context contract %q: %s", required, run)
		}
	}
	if strings.Contains(run, "repo.searchProperties") {
		t.Fatal("AI service performs an unscoped property search outside LoadLeadContext")
	}
}
