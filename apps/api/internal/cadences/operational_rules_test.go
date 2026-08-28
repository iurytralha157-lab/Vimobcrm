package cadences

import (
	"errors"
	"testing"
)

const (
	testStageID    = "10000000-0000-4000-8000-000000000001"
	testPipelineID = "20000000-0000-4000-8000-000000000001"
	testTaskID     = "30000000-0000-4000-8000-000000000001"
)

func TestNormalizeOperationalRulesAcceptsGuidedStageRules(t *testing.T) {
	request := validOperationalRulesRequest()

	normalized, err := normalizeOperationalRulesRequest(testStageID, request)
	if err != nil {
		t.Fatalf("expected operational rules to be valid, got %v", err)
	}
	if normalized.StageID != testStageID || normalized.PipelineID != testPipelineID {
		t.Fatalf("unexpected normalized scope: %#v", normalized)
	}
	if normalized.Lifecycle != defaultOperationalLifecycleRule() {
		t.Fatalf("lifecycle must preserve the non-blocking audited behavior: %#v", normalized.Lifecycle)
	}
	if len(normalized.Cadence.Tasks) != 1 || normalized.Cadence.Tasks[0].DueMinutes != 60 {
		t.Fatalf("unexpected normalized cadence: %#v", normalized.Cadence)
	}
}

func TestNormalizeOperationalRulesAllowsDisabledEmptyCadence(t *testing.T) {
	request := validOperationalRulesRequest()
	request.Cadence.Enabled = false
	request.Cadence.Tasks = nil

	normalized, err := normalizeOperationalRulesRequest(testStageID, request)
	if err != nil {
		t.Fatalf("disabled cadence without obligations must be valid, got %v", err)
	}
	if normalized.Cadence.Tasks == nil || len(normalized.Cadence.Tasks) != 0 {
		t.Fatalf("disabled cadence tasks must normalize to an empty list: %#v", normalized.Cadence.Tasks)
	}
}

func TestNormalizeOperationalRulesRequiresRevision(t *testing.T) {
	request := validOperationalRulesRequest()
	request.Revision = nil

	_, err := normalizeOperationalRulesRequest(testStageID, request)
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput without a revision, got %v", err)
	}
}

func TestNormalizeOperationalRulesRejectsUnsafeOrAmbiguousRules(t *testing.T) {
	tests := map[string]func(*OperationalRulesRequest){
		"scope mismatch": func(request *OperationalRulesRequest) {
			request.StageID = "10000000-0000-4000-8000-000000000099"
		},
		"duplicate task": func(request *OperationalRulesRequest) {
			request.Cadence.Tasks = append(request.Cadence.Tasks, request.Cadence.Tasks[0])
		},
		"duplicate position": func(request *OperationalRulesRequest) {
			second := request.Cadence.Tasks[0]
			second.ID = stringPointerForTest("30000000-0000-4000-8000-000000000002")
			second.Title = "Segunda ligacao"
			request.Cadence.Tasks = append(request.Cadence.Tasks, second)
		},
		"warning after deadline": func(request *OperationalRulesRequest) {
			request.Cadence.Tasks[0].DueMinutes = 10
			request.Cadence.Tasks[0].WarningMinutes = intPointerForTest(11)
		},
		"note outcome": func(request *OperationalRulesRequest) {
			request.Cadence.Tasks[0].Type = "note"
			request.Cadence.Tasks[0].OutcomeRequired = true
		},
		"warning exceeds attention deadline": func(request *OperationalRulesRequest) {
			request.Attention.WarningMinutes = 61
		},
		"zero escalation": func(request *OperationalRulesRequest) {
			request.Attention.EscalationMinutes = intPointerForTest(0)
		},
		"automatic lifecycle": func(request *OperationalRulesRequest) {
			request.Lifecycle.OnStageMove = "auto_move"
		},
	}

	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			request := validOperationalRulesRequest()
			mutate(&request)
			_, err := normalizeOperationalRulesRequest(testStageID, request)
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("expected ErrInvalidInput, got %v", err)
			}
		})
	}
}

func validOperationalRulesRequest() OperationalRulesRequest {
	return OperationalRulesRequest{
		StageID:    testStageID,
		PipelineID: testPipelineID,
		Revision:   int64PointerForTest(0),
		Cadence: OperationalCadenceRule{
			Enabled: true,
			Tasks: []OperationalCadenceTask{{
				ID:              stringPointerForTest(testTaskID),
				Position:        0,
				Type:            "call",
				Title:           "Primeira ligacao",
				DueMinutes:      60,
				WarningMinutes:  intPointerForTest(15),
				IsRequired:      true,
				OutcomeRequired: true,
			}},
		},
		Attention: OperationalAttentionRule{
			SourceMode:                   "local",
			Mode:                         "shadow",
			FirstOutreachMinutes:         intPointerForTest(60),
			FirstEffectiveContactMinutes: intPointerForTest(240),
			StageInactivityMinutes:       intPointerForTest(1_440),
			StageMaxAgeMinutes:           intPointerForTest(4_320),
			WarningMinutes:               15,
			EscalationMinutes:            intPointerForTest(60),
			BusinessHoursOnly:            true,
		},
		Lifecycle: defaultOperationalLifecycleRule(),
	}
}

func intPointerForTest(value int) *int {
	return &value
}

func int64PointerForTest(value int64) *int64 {
	return &value
}

func stringPointerForTest(value string) *string {
	return &value
}
