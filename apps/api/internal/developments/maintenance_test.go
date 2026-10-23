package developments

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestUnitExpectedVersionCannotBeBlank(t *testing.T) {
	status := "sold"
	for _, timestamp := range []string{"", " ", "bad"} {
		input := UpdateUnitInput{Status: &status, ExpectedUpdatedAt: &timestamp}
		if !errors.Is(input.Validate(), ErrInvalidInput) {
			t.Fatalf("blank/invalid CAS accepted: %q", timestamp)
		}
	}
}

func TestDevelopmentMaintenanceRejectsUnscopedFieldsAndVersions(t *testing.T) {
	for _, field := range []string{"code", "name", "status", "sort_order", "metadata"} {
		input := MaintenanceInput{ExpectedUpdatedAt: "2026-10-12T12:00:00Z", Changes: map[string]json.RawMessage{field: json.RawMessage(" null ")}}
		if _, err := validateMaintenanceInput(maintenancePhase, input); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("required field null accepted %s: %v", field, err)
		}
	}
	for _, field := range []string{"organization_id", "id", "published_on_site", "created_by", "property_id"} {
		input := MaintenanceInput{ExpectedUpdatedAt: "2026-10-12T12:00:00Z", Changes: map[string]json.RawMessage{field: json.RawMessage(`"fake"`)}}
		if _, err := validateMaintenanceInput(maintenanceDevelopment, input); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("unsafe field accepted %s: %v", field, err)
		}
	}
	for _, version := range []string{"", " ", "bad"} {
		input := MaintenanceInput{ExpectedUpdatedAt: version, Changes: map[string]json.RawMessage{"name": json.RawMessage(`"Nome"`)}}
		if _, err := validateMaintenanceInput(maintenanceDevelopment, input); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("bad version accepted %s: %v", version, err)
		}
	}
	_, err := (Repository{}).UpdateMaintenance(context.Background(), tenant.Context{MemberRole: "user"}, testUUID, testUUID, maintenancePhase, MaintenanceInput{})
	if !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("missing management allowed: %v", err)
	}
}

func TestDevelopmentMaintenanceReusesValidationAndPreservesUntouchedFields(t *testing.T) {
	snapshot := []byte(`{"code":"FASE-1","name":"Original","status":"planned","sort_order":3,"metadata":{"keep":true}}`)
	input := MaintenanceInput{Changes: map[string]json.RawMessage{"name": json.RawMessage(`"  Corrigido  "`)}}
	changes, err := normalizedMaintenanceChanges(maintenancePhase, snapshot, input)
	if err != nil || string(changes["name"]) != `"Corrigido"` || len(changes) != 1 {
		t.Fatalf("normalization changed unrelated fields: %s %v", changes, err)
	}
	input.Changes["status"] = json.RawMessage(`"wrong-status"`)
	if _, err := normalizedMaintenanceChanges(maintenancePhase, snapshot, input); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid status accepted: %v", err)
	}
}

func TestReservationExpirationRecoversPanicAndBoundsDeadline(t *testing.T) {
	_, err := runReservationExpiration(context.Background(), time.Second, func(context.Context) (int, error) { panic("synthetic") })
	if err == nil {
		t.Fatal("worker panic escaped")
	}
	_, err = runReservationExpiration(context.Background(), time.Millisecond, func(ctx context.Context) (int, error) { <-ctx.Done(); return 0, ctx.Err() })
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("worker deadline not bounded: %v", err)
	}
}

func TestDevelopmentResponsibleMemberClearingNeedsNoLookup(t *testing.T) {
	if err := requireDevelopmentResponsibleMember(context.Background(), nil, testUUID, nil); err != nil {
		t.Fatalf("clearing optional responsible member requires a query: %v", err)
	}
}
