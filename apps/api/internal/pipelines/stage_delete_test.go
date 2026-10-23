package pipelines

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestStageDeleteRevisionInput(t *testing.T) {
	for _, scenario := range []struct {
		name, revision string
		want           error
	}{
		{"missing", "", ErrStagesChanged},
		{"malformed", "bad", ErrInvalidInput},
		{"zero", "0001-01-01T00:00:00Z", ErrInvalidInput},
		{"date only", "2026-10-16", ErrInvalidInput},
		{"whitespace", " 2026-10-16T12:00:00.123456Z", ErrInvalidInput},
		{"exact microseconds", "2026-10-16T09:00:00.123456-03:00", nil},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			input, err := (DeleteStageRequest{ExpectedUpdatedAt: scenario.revision}).Validate()
			if !errors.Is(err, scenario.want) {
				t.Fatalf("revision error=%v, want %v", err, scenario.want)
			}
			if err == nil && input.ExpectedUpdatedAt.Nanosecond() != 123456000 {
				t.Fatal("delete token lost database microseconds")
			}
		})
	}
	actor := tenant.Context{OrganizationID: stageArchiveFixtureID(1), MemberRole: "admin"}
	if err := (Repository{}).DeleteStage(context.Background(), actor, stageArchiveFixtureID(202), deleteStageInput{}); !errors.Is(err, ErrStagesChanged) {
		t.Fatalf("missing revision reached the database: %v", err)
	}
	actor.MemberRole = "broker"
	if err := (Repository{}).DeleteStage(context.Background(), actor, stageArchiveFixtureID(202), deleteStageInput{ExpectedUpdatedAt: time.Now()}); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("permission guard reached the database: %v", err)
	}
}

func TestStageDeleteHTTPRequiresExactRevision(t *testing.T) {
	actor := tenant.Context{OrganizationID: stageArchiveFixtureID(1), MemberRole: "admin"}
	for _, scenario := range []struct {
		name, body string
		status     int
		code       string
	}{
		{"absent body", "", 409, "pipeline_stages_changed"},
		{"missing field", `{}`, 409, "pipeline_stages_changed"},
		{"null field", `{"expectedUpdatedAt":null}`, 409, "pipeline_stages_changed"},
		{"empty field", `{"expectedUpdatedAt":""}`, 409, "pipeline_stages_changed"},
		{"malformed timestamp", `{"expectedUpdatedAt":"bad"}`, 400, "invalid_pipeline_input"},
		{"wrong type", `{"expectedUpdatedAt":1}`, 400, "invalid_json"},
		{"unknown field", `{"expected_updated_at":"2026-10-16T12:00:00Z"}`, 400, "invalid_json"},
		{"trailing JSON", `{} {}`, 400, "invalid_json"},
		{"invalid JSON", `{`, 400, "invalid_json"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodDelete, "/", strings.NewReader(scenario.body))
			request.SetPathValue("id", stageArchiveFixtureID(202))
			request = request.WithContext(tenant.ContextWithTenant(request.Context(), actor))
			response := httptest.NewRecorder()
			NewHandler(NewRepository(nil)).DeleteStage(response, request)
			if response.Code != scenario.status || !strings.Contains(response.Body.String(), `"code":"`+scenario.code+`"`) {
				t.Fatalf("response=%d %s", response.Code, response.Body.String())
			}
		})
	}
	actor.MemberRole = "broker"
	request := httptest.NewRequest(http.MethodDelete, "/", strings.NewReader(`{}`))
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), actor))
	response := httptest.NewRecorder()
	NewHandler(NewRepository(nil)).DeleteStage(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("unauthorized deletion returned %d", response.Code)
	}
}
