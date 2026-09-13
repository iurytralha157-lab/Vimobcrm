package stageconfig

import (
	"errors"
	"os"
	"strings"
	"testing"
)

func TestStageAutomationRequestRequiresValidAssigneeTarget(t *testing.T) {
	for _, request := range []StageAutomationRequest{
		{StageID: "11111111-1111-4111-8111-111111111111", AutomationType: "change_assignee_on_enter"},
		{StageID: "11111111-1111-4111-8111-111111111111", AutomationType: "change_assignee_on_enter", ActionConfig: map[string]any{"target_user_id": "not-a-uuid"}},
		{StageID: "11111111-1111-4111-8111-111111111111", AutomationType: "change_assignee_on_enter", ActionConfig: map[string]any{"target_user_id": 42}},
	} {
		if _, err := request.Validate(true); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("Validate(%#v) error = %v, want ErrInvalidInput", request, err)
		}
	}

	input, err := (StageAutomationRequest{
		StageID:        "11111111-1111-4111-8111-111111111111",
		AutomationType: "change_assignee_on_enter",
		ActionConfig:   map[string]any{"target_user_id": "22222222-2222-4222-8222-222222222222"},
	}).Validate(true)
	if err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	actionConfig := input.Config["action_config"].(map[string]any)
	if actionConfig["target_user_id"] != "22222222-2222-4222-8222-222222222222" {
		t.Fatalf("target_user_id = %#v", actionConfig["target_user_id"])
	}
}

func TestStageAutomationRequestRequiresCanonicalDealStatus(t *testing.T) {
	for _, status := range []string{"", "closed", "ganho"} {
		request := StageAutomationRequest{
			StageID:        "11111111-1111-4111-8111-111111111111",
			AutomationType: "change_deal_status_on_enter",
		}
		if status != "" {
			request.ActionConfig = map[string]any{"deal_status": status}
		}
		if _, err := request.Validate(true); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("Validate(status=%q) error = %v, want ErrInvalidInput", status, err)
		}
	}

	status := " WON "
	input, err := (StageAutomationRequest{
		StageID:        "11111111-1111-4111-8111-111111111111",
		AutomationType: "change_deal_status_on_enter",
		DealStatus:     &status,
	}).Validate(true)
	if err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	actionConfig := input.Config["action_config"].(map[string]any)
	if actionConfig["deal_status"] != "won" {
		t.Fatalf("deal_status = %#v", actionConfig["deal_status"])
	}
}

func TestAutomationRepositoryValidatesReferencesUnderStageLock(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}
	text := string(source)
	for _, contract := range []string{
		"repo.lockAutomationStage",
		"repo.validateAutomationReferences",
		"from public.organization_members member",
		"coalesce(member.is_active, false) = true",
		"coalesce(app_user.is_active, false) = true",
		"for key share of member, app_user",
		"repo.validateAutomationStatusConflict",
	} {
		if !strings.Contains(text, contract) {
			t.Fatalf("automation persistence must contain %q", contract)
		}
	}
}
