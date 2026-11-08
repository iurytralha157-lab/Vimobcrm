package stageconfig

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

var ErrInactivityConfigurationChanged = errors.New("stage inactivity configuration changed")

type StageInactivityPolicyView struct {
	Revision                int64      `json:"revision"`
	Clock                   string     `json:"clock"`
	StartMode               string     `json:"start_mode"`
	ActivatedAt             time.Time  `json:"activated_at"`
	InteractionCoverageFrom *time.Time `json:"interaction_coverage_from,omitempty"`
	IsEnabled               bool       `json:"is_enabled"`
	EffectiveEnabled        bool       `json:"effective_enabled"`
	RuntimeAvailable        bool       `json:"runtime_available"`
	Action                  string     `json:"action"`
	TargetStageID           *string    `json:"target_stage_id,omitempty"`
	TargetRoundRobinID      *string    `json:"target_round_robin_id,omitempty"`
}

type StageAutomationsEnvelope struct {
	Data                       []StageAutomation `json:"data"`
	InactivityRuntimeAvailable bool              `json:"inactivity_runtime_available"`
}

type StageInactivityRequest struct {
	StageID                string `json:"stage_id,omitempty"`
	TriggerDays            *int   `json:"trigger_days"`
	AlertMessage           string `json:"alert_message"`
	IsEnabled              *bool  `json:"is_enabled"`
	Clock                  string `json:"clock"`
	StartMode              string `json:"start_mode"`
	ExpectedUpdatedAt      string `json:"expected_updated_at,omitempty"`
	ExpectedPolicyRevision *int64 `json:"expected_policy_revision,omitempty"`
	Action             string `json:"action,omitempty"`
	TargetStageID      string `json:"target_stage_id,omitempty"`
	TargetRoundRobinID string `json:"target_round_robin_id,omitempty"`
}

type stageInactivityInput struct {
	StageID                string
	Days                   int
	Message                string
	Enabled                bool
	StartMode              string
	ExpectedUpdatedAt      time.Time
	ExpectedPolicyRevision int64
	Action                 string
	TargetStageID          string
	TargetRoundRobinID     string
}

func (request StageInactivityRequest) Validate(create bool) (stageInactivityInput, error) {
	invalid := func(message string) (stageInactivityInput, error) {
		return stageInactivityInput{}, fmt.Errorf("%w: %s", ErrInvalidInput, message)
	}
	input := stageInactivityInput{Message: strings.TrimSpace(request.AlertMessage), StartMode: request.StartMode}
	if request.Clock != InactivityClockLastInteraction {
		return invalid("clock must be last_interaction")
	}
	if request.StartMode != "" && request.StartMode != InactivityStartAtActivation && request.StartMode != InactivityNewStageEntries {
		return invalid("start_mode must be activation or new_stage_entries")
	}
	if request.TriggerDays == nil || *request.TriggerDays < 1 || *request.TriggerDays > 3650 {
		return invalid("trigger_days must be an integer between 1 and 3650")
	}
	if request.IsEnabled == nil || len([]rune(input.Message)) > 1000 {
		return invalid("is_enabled is required and alert_message must have at most 1000 characters")
	}
	input.Days, input.Enabled = *request.TriggerDays, *request.IsEnabled
	if strings.TrimSpace(request.Action) != InactivityActionRedistribute && strings.TrimSpace(request.TargetRoundRobinID) != "" {
		return invalid("target_round_robin_id is only accepted with action redistribute")
	}
	switch strings.TrimSpace(request.Action) {
	case "", InactivityActionNotify:
		input.Action = InactivityActionNotify
		if strings.TrimSpace(request.TargetStageID) != "" {
			return invalid("target_stage_id is only accepted with action move_stage")
		}
	case InactivityActionMoveStage:
		input.Action = InactivityActionMoveStage
		target, valid := normalizeUUID(request.TargetStageID)
		if !valid {
			return invalid("target_stage_id is required and must be a UUID")
		}
		if input.Message != "" {
			return invalid("move_stage rules do not send an alert message")
		}
		input.TargetStageID = target
	case InactivityActionRedistribute:
		input.Action = InactivityActionRedistribute
		target, valid := normalizeUUID(request.TargetRoundRobinID)
		if !valid || strings.TrimSpace(request.TargetStageID) != "" || input.Message != "" {
			return invalid("redistribute requires a valid target_round_robin_id and does not accept target_stage_id or alert_message")
		}
		input.TargetRoundRobinID = target
	default:
		return invalid("action must be notify, move_stage or redistribute")
	}
	if create {
		stageID, valid := normalizeUUID(request.StageID)
		if !valid {
			return invalid("stage_id is required and must be a UUID")
		}
		if request.ExpectedUpdatedAt != "" || request.ExpectedPolicyRevision != nil {
			return invalid("create does not accept revision fields")
		}
		input.StageID = stageID
		return input, nil
	}
	if request.StageID != "" {
		return invalid("an existing automation cannot change stage_id")
	}
	if request.ExpectedPolicyRevision == nil || *request.ExpectedPolicyRevision < 0 {
		return invalid("expected_policy_revision is required and must be nonnegative")
	}
	revision, err := parseInactivityRevision(request.ExpectedUpdatedAt)
	if err != nil {
		return invalid("expected_updated_at must be the exact timestamp returned by the API")
	}
	input.ExpectedUpdatedAt = revision
	input.ExpectedPolicyRevision = *request.ExpectedPolicyRevision
	return input, nil
}

func parseInactivityRevision(raw string) (time.Time, error) {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02 15:04:05.999999999Z07:00", "2006-01-02 15:04:05.999999999Z07"} {
		if value, err := time.Parse(layout, strings.TrimSpace(raw)); err == nil && !value.IsZero() {
			return value, nil
		}
	}
	return time.Time{}, ErrInvalidInput
}

func inactivityPolicyView(policy StageInactivityPolicy, effective, available bool) *StageInactivityPolicyView {
	return &StageInactivityPolicyView{
		Revision: policy.Revision, Clock: policy.Clock, StartMode: policy.StartMode,
		ActivatedAt: policy.ActivatedAt, InteractionCoverageFrom: policy.InteractionCoverageFrom,
		IsEnabled: policy.Enabled, EffectiveEnabled: policy.Enabled && effective && available,
		RuntimeAvailable: available, Action: policy.ActionKind, TargetStageID: policy.TargetStageID,
		TargetRoundRobinID: policy.TargetRoundRobinID,
	}
}
