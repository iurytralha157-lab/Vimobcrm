package stageconfig

import (
	"errors"
	"testing"
)

func TestInactivityMoveCreatesCycle(t *testing.T) {
	next := map[string]string{"b": "c", "c": "d"}
	if !inactivityMoveCreatesCycle(next, "d", "b") {
		t.Fatal("d→b→c→d must be a cycle")
	}
	if !inactivityMoveCreatesCycle(map[string]string{"b": "a"}, "a", "b") {
		t.Fatal("a→b→a must be a cycle")
	}
	if inactivityMoveCreatesCycle(next, "a", "b") {
		t.Fatal("a→b→c→d is a path")
	}
	// A pre-existing loop elsewhere must not hang the check.
	if inactivityMoveCreatesCycle(map[string]string{"x": "y", "y": "x"}, "a", "x") {
		t.Fatal("unrelated loop reported as this rule's cycle")
	}
}

func TestStageInactivityMoveRequestValidation(t *testing.T) {
	days, enabled := 2, false
	base := StageInactivityRequest{StageID: "11111111-1111-4111-8111-111111111111", TriggerDays: &days, IsEnabled: &enabled,
		Clock: InactivityClockLastInteraction, StartMode: InactivityStartAtActivation}

	alert, err := base.Validate(true)
	if err != nil || alert.Action != InactivityActionNotify || alert.TargetStageID != "" {
		t.Fatalf("omitted action must stay an alert: %#v %v", alert, err)
	}
	move := base
	move.Action, move.TargetStageID = InactivityActionMoveStage, "22222222-2222-4222-8222-222222222222"
	input, err := move.Validate(true)
	if err != nil || input.Action != InactivityActionMoveStage || input.TargetStageID != move.TargetStageID {
		t.Fatalf("move = %#v %v", input, err)
	}
	for name, request := range map[string]StageInactivityRequest{
		"move without destination": func() StageInactivityRequest { r := move; r.TargetStageID = ""; return r }(),
		"move with alert text":     func() StageInactivityRequest { r := move; r.AlertMessage = "Oi"; return r }(),
		"alert with destination":   func() StageInactivityRequest { r := base; r.TargetStageID = move.TargetStageID; return r }(),
		"unknown action":           func() StageInactivityRequest { r := move; r.Action = "delete_lead"; return r }(),
	} {
		if _, err := request.Validate(true); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("%s accepted: %v", name, err)
		}
	}
}

func TestStageInactivityMovePolicyValidation(t *testing.T) {
	policy, _ := explicitInactivityFixture()
	policy.ActionKind = InactivityActionMoveStage
	if policy.Validate() == nil {
		t.Fatal("move policy without destination accepted")
	}
	target, actor := "77777777-7777-4777-8777-777777777777", "88888888-8888-4888-8888-888888888888"
	policy.TargetStageID = &target
	policy.Enabled = true
	if policy.Validate() == nil {
		t.Fatal("enabled move policy without acting manager accepted")
	}
	policy.ActingUserID = &actor
	if err := policy.Validate(); err != nil {
		t.Fatalf("valid move policy: %v", err)
	}
	same := policy.StageID
	policy.TargetStageID = &same
	if policy.Validate() == nil {
		t.Fatal("move into the same stage accepted")
	}
}
