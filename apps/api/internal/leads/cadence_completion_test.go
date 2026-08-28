package leads

import (
	"errors"
	"testing"
)

func TestCompleteCadenceTaskRequestPrefersMaterializedTaskID(t *testing.T) {
	request := CompleteCadenceTaskRequest{
		LeadID: "10000000-0000-4000-8000-000000000001",
		TaskID: "20000000-0000-4000-8000-000000000001",
	}

	normalized, err := request.Validate()
	if err != nil {
		t.Fatalf("expected request with materialized task id to be valid, got %v", err)
	}
	if normalized.TaskID != request.TaskID {
		t.Fatalf("unexpected normalized task id %q", normalized.TaskID)
	}
}

func TestCompleteCadenceTaskRequestRejectsUnknownCompatibilityType(t *testing.T) {
	request := CompleteCadenceTaskRequest{
		LeadID: "10000000-0000-4000-8000-000000000001",
		TaskID: "20000000-0000-4000-8000-000000000001",
		Type:   "automatic_magic",
	}

	if _, err := request.Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for an unknown type, got %v", err)
	}
}

func TestCompleteCadenceTaskRequestKeepsTemplateIDCompatibility(t *testing.T) {
	request := CompleteCadenceTaskRequest{
		LeadID:         "10000000-0000-4000-8000-000000000001",
		TemplateTaskID: "30000000-0000-4000-8000-000000000001",
		Type:           "message",
		Title:          "Enviar mensagem",
		DayOffset:      1,
	}

	if _, err := request.Validate(); err != nil {
		t.Fatalf("expected template id compatibility to remain valid, got %v", err)
	}
}

func TestCompleteCadenceTaskRequestRequiresStableTaskReference(t *testing.T) {
	request := CompleteCadenceTaskRequest{
		LeadID: "10000000-0000-4000-8000-000000000001",
		Type:   "call",
		Title:  "Primeira ligacao",
	}

	if _, err := request.Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput without a stable task reference, got %v", err)
	}
}
