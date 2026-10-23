package leads

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func validAutomationStageInput() automationStageCommand {
	execution := pipelinePostgresID(10)
	return automationStageCommand{pipelinePostgresID(1), execution, "stage-node", "synthetic-lease", "automation:" + execution + ":stage-node:move_lead"}
}

func TestAutomationStageCommandAuthenticatesAndRejectsForgedAuthority(t *testing.T) {
	valid, _ := json.Marshal(validAutomationStageInput())
	for _, test := range []struct {
		name, token, body string
		status            int
	}{
		{"no token", "", string(valid), 401}, {"wrong token", "wrong", string(valid), 401},
		{"forged actor", "local-test", strings.TrimSuffix(string(valid), "}") + `,"actorId":"forged"}`, 400},
		{"forged admin", "local-test", strings.TrimSuffix(string(valid), "}") + `,"isSuperAdmin":true}`, 400},
		{"forged destination", "local-test", strings.TrimSuffix(string(valid), "}") + `,"stageId":"forged"}`, 400},
		{"trailing JSON", "local-test", string(valid) + ` {}`, 400},
		{"valid", "local-test", string(valid), 200},
	} {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			handler := AutomationStageCommandHandler{token: "local-test", execute: func(_ context.Context, input automationStageCommand) (automationStageResponse, error) {
				calls++
				if input != validAutomationStageInput() {
					t.Fatal("identities changed")
				}
				return automationStageResponse{OK: true, Status: "succeeded", Response: json.RawMessage(`{}`)}, nil
			}}
			request := httptest.NewRequest(http.MethodPost, "/v1/internal/automations/stage-command", strings.NewReader(test.body))
			request.Header.Set("X-Internal-Token", test.token)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.status {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			if (calls == 1) != (test.status == 200) {
				t.Fatal("rejected request reached executor")
			}
		})
	}
}

func TestAutomationStageCommandDisabledAndSafeErrors(t *testing.T) {
	response := httptest.NewRecorder()
	(AutomationStageCommandHandler{}).ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/", nil))
	if response.Code != 503 {
		t.Fatal("empty token must disable endpoint")
	}
	for _, test := range []struct {
		err    error
		status int
		code   string
	}{
		{&pgconn.PgError{Code: "40001", Message: "secret SQL"}, 503, "automation_command_retryable"},
		{context.DeadlineExceeded, 503, "automation_command_retryable"},
		{errors.New("synthetic secret db detail"), 503, "automation_command_retryable"},
		{commandError("automation_lease_changed", 409), 409, "automation_lease_changed"},
		{ErrLostReasonRequired, 400, "lost_reason_required"},
	} {
		w := httptest.NewRecorder()
		writeAutomationCommandError(w, httptest.NewRequest(http.MethodPost, "/", nil), test.err)
		if w.Code != test.status || !strings.Contains(w.Body.String(), test.code) || strings.Contains(w.Body.String(), "secret") {
			t.Fatalf("unsafe/wrong error: %d %s", w.Code, w.Body.String())
		}
	}
}

func TestAutomationStageCommandBindsEffectAndImmutableNode(t *testing.T) {
	input := validAutomationStageInput()
	for _, mutate := range []func(*automationStageCommand){
		func(i *automationStageCommand) { i.EffectKey = "other" }, func(i *automationStageCommand) { i.OrganizationID = "bad" },
		func(i *automationStageCommand) { i.LeaseToken = "" }, func(i *automationStageCommand) { i.NodeKey = " other " },
	} {
		candidate := input
		mutate(&candidate)
		if candidate.validate() {
			t.Fatal("invalid identity accepted")
		}
	}
	graph := `{"nodes":[{"id":"stage-node","type":"action","action_type":"move_lead","config":{"stage_id":"` + pipelinePostgresID(8) + `","lost_reason":"Real configured reason"}}]}`
	config, raw, err := deriveAutomationStageConfig([]byte(graph), input.NodeKey)
	if err != nil || config.LostReason == nil || *config.LostReason != "Real configured reason" || len(raw) == 0 {
		t.Fatal("immutable config was not derived")
	}
	for _, invalid := range []string{`{}`, strings.ReplaceAll(graph, "move_lead", "assign_user"), strings.ReplaceAll(graph, "action\"", "trigger\""), strings.ReplaceAll(graph, pipelinePostgresID(8), "bad")} {
		if _, _, err := deriveAutomationStageConfig([]byte(invalid), input.NodeKey); err == nil {
			t.Fatal("noncanonical action was accepted")
		}
	}
}
