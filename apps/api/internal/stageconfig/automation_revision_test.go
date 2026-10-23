package stageconfig

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestStageAutomationRevisionRequestContract(t *testing.T) {
	for _, scenario := range []struct {
		name, revision string
		want           error
	}{
		{"missing", "", ErrStageAutomationChanged},
		{"invalid", "yesterday", ErrInvalidInput},
		{"zero", "0001-01-01T00:00:00Z", ErrInvalidInput},
		{"date only", "2026-10-16", ErrInvalidInput},
		{"whitespace", " 2026-10-16T12:00:00Z", ErrInvalidInput},
		{"exact microseconds", "2026-10-16T12:00:00.123456Z", nil},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			request := StageAutomationRequest{AutomationType: "change_deal_status_on_enter",
				ActionConfig: map[string]any{"deal_status": "won"}, ExpectedUpdatedAt: scenario.revision}
			input, err := request.Validate(false)
			if !errors.Is(err, scenario.want) {
				t.Fatalf("edit revision: %v, want %v", err, scenario.want)
			}
			active := true
			status, err := (StageAutomationStatusRequest{IsActive: &active, ExpectedUpdatedAt: scenario.revision}).Validate()
			if !errors.Is(err, scenario.want) {
				t.Fatalf("toggle revision: %v, want %v", err, scenario.want)
			}
			if scenario.want == nil && (input.ExpectedUpdatedAt.Nanosecond() != 123456000 || !status.ExpectedUpdatedAt.Equal(input.ExpectedUpdatedAt)) {
				t.Fatal("request lost the original microsecond revision")
			}
		})
	}
	if _, err := (StageAutomationRequest{StageID: inactivityFixtureID(201), AutomationType: "change_deal_status_on_enter",
		ActionConfig: map[string]any{"deal_status": "won"}}).Validate(true); err != nil {
		t.Fatalf("creation without revision changed: %v", err)
	}
	if _, err := (StageAutomationRequest{StageID: inactivityFixtureID(201), AutomationType: "change_deal_status_on_enter",
		ActionConfig: map[string]any{"deal_status": "won"}, ExpectedUpdatedAt: "2026-10-16T12:00:00.123456Z"}).Validate(true); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("creation accepted an existing-rule revision: %v", err)
	}
}

func TestStageAutomationRevisionHTTPContract(t *testing.T) {
	actor := tenant.Context{OrganizationID: inactivityFixtureID(1), UserID: inactivityFixtureID(401), MemberRole: "admin"}
	for _, scenario := range []struct {
		name, body string
		toggle     bool
		status     int
		code       string
	}{
		{"edit missing", `{"automation_type":"change_deal_status_on_enter","deal_status":"won"}`, false, 409, "stage_automation_changed"},
		{"toggle missing", `{"is_active":true}`, true, 409, "stage_automation_changed"},
		{"edit malformed", `{"automation_type":"change_deal_status_on_enter","deal_status":"won","expected_updated_at":"bad"}`, false, 400, "invalid_stage_config_input"},
		{"toggle malformed", `{"is_active":true,"expected_updated_at":"bad"}`, true, 400, "invalid_stage_config_input"},
		{"toggle missing state", `{"expected_updated_at":"2026-10-16T12:00:00Z"}`, true, 400, "invalid_stage_config_input"},
		{"toggle null state", `{"is_active":null,"expected_updated_at":"2026-10-16T12:00:00Z"}`, true, 400, "invalid_stage_config_input"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(scenario.body))
			request.SetPathValue("id", inactivityFixtureID(301))
			request = request.WithContext(tenant.ContextWithTenant(request.Context(), actor))
			response := httptest.NewRecorder()
			handler := NewHandler(NewRepository(nil))
			if scenario.toggle {
				handler.ToggleAutomation(response, request)
			} else {
				handler.UpdateAutomation(response, request)
			}
			if response.Code != scenario.status || !strings.Contains(response.Body.String(), `"code":"`+scenario.code+`"`) {
				t.Fatalf("response=%d %s", response.Code, response.Body.String())
			}
		})
	}
}

type automationRevisionRow struct{ scan func(...any) error }

func (row automationRevisionRow) Scan(destinations ...any) error { return row.scan(destinations...) }

type automationRevisionQuery struct {
	revision time.Time
	active   bool
	err      error
}

func (query automationRevisionQuery) QueryRow(context.Context, string, ...any) pgx.Row {
	return automationRevisionRow{scan: func(destinations ...any) error {
		if query.err != nil {
			return query.err
		}
		*destinations[0].(*bool), *destinations[1].(*time.Time) = query.active, query.revision
		return nil
	}}
}

func TestStageAutomationRevisionLockComparesExactInstant(t *testing.T) {
	revision := time.Date(2026, 10, 16, 12, 0, 0, 123456000, time.UTC)
	for _, scenario := range []struct {
		name     string
		expected time.Time
		want     error
	}{
		{"same", revision, nil},
		{"same instant offset", revision.In(time.FixedZone("offset", -3*60*60)), nil},
		{"one microsecond old", revision.Add(-time.Microsecond), ErrStageAutomationChanged},
		{"one microsecond future", revision.Add(time.Microsecond), ErrStageAutomationChanged},
		{"missing", time.Time{}, ErrStageAutomationChanged},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			active, err := readLockedAutomationRevision(context.Background(), automationRevisionQuery{revision: revision, active: true}, "org", "stage", "rule", scenario.expected)
			if !errors.Is(err, scenario.want) || (err == nil && !active) {
				t.Fatalf("active=%v err=%v", active, err)
			}
		})
	}
	if _, err := readLockedAutomationRevision(context.Background(), automationRevisionQuery{err: pgx.ErrNoRows}, "other-org", "stage", "rule", revision); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
}

func TestStageAutomationRevisionScannerNormalizesDatabaseTokenWithoutRounding(t *testing.T) {
	row := automationRevisionRow{scan: func(destinations ...any) error {
		for _, index := range []int{0, 1, 2, 3, 6} {
			*destinations[index].(*string) = "unchanged"
		}
		*destinations[4].(*pgtype.Text) = pgtype.Text{String: `{}`, Valid: true}
		*destinations[5].(*bool) = true
		*destinations[7].(*string) = "2026-10-16 09:00:00.123456-03"
		return nil
	}}
	automation, err := scanStageAutomation(row)
	if err != nil || automation.UpdatedAt != "2026-10-16T12:00:00.123456Z" || automation.CreatedAt != "unchanged" {
		t.Fatalf("API timestamp changed precision or unrelated CreatedAt: %+v %v", automation, err)
	}
	if _, err := parseRequiredStageAutomationRevision(automation.UpdatedAt); err != nil {
		t.Fatalf("exact API token rejected by PATCH: %v", err)
	}
}

func TestStageAutomationRevisionMustAdvanceAndMissingRevisionCannotReachDatabase(t *testing.T) {
	revision := time.Date(2026, 10, 16, 12, 0, 0, 123456000, time.UTC)
	for _, next := range []time.Time{revision, revision.Add(-time.Microsecond), time.Time{}} {
		if err := requireAdvancedStageAutomationRevision(StageAutomation{UpdatedAt: next.Format(time.RFC3339Nano)}, revision); !errors.Is(err, ErrStageAutomationChanged) {
			t.Fatalf("nonadvancing revision accepted: %v", err)
		}
	}
	if err := requireAdvancedStageAutomationRevision(StageAutomation{UpdatedAt: revision.Add(time.Microsecond).Format(time.RFC3339Nano)}, revision); err != nil {
		t.Fatal(err)
	}
	actor := tenant.Context{OrganizationID: inactivityFixtureID(1), MemberRole: "admin"}
	repo := NewRepository(nil)
	if _, err := repo.UpdateAutomation(context.Background(), actor, inactivityFixtureID(301), stageAutomationInput{}); !errors.Is(err, ErrStageAutomationChanged) {
		t.Fatal(err)
	}
	if _, err := repo.ToggleAutomation(context.Background(), actor, inactivityFixtureID(301), stageAutomationStatusInput{}); !errors.Is(err, ErrStageAutomationChanged) {
		t.Fatal(err)
	}
	actor.MemberRole = "broker"
	if _, err := repo.UpdateAutomation(context.Background(), actor, inactivityFixtureID(301), stageAutomationInput{ExpectedUpdatedAt: revision}); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatal(err)
	}
	if _, err := repo.ToggleAutomation(context.Background(), actor, inactivityFixtureID(301), stageAutomationStatusInput{ExpectedUpdatedAt: revision}); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatal(err)
	}
}
