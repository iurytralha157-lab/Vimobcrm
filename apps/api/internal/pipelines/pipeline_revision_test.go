package pipelines

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestPipelineRevisionValidation(t *testing.T) {
	valid := strings.Repeat("a1", 32)
	for _, scenario := range []struct {
		name, revision string
		want           error
	}{
		{"missing", "", ErrPipelineChanged}, {"short", "abc", ErrInvalidInput},
		{"uppercase", strings.ToUpper(valid), ErrInvalidInput}, {"space", " " + valid, ErrInvalidInput},
		{"nonhex", strings.Repeat("z", 64), ErrInvalidInput}, {"valid", valid, nil},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			_, err := (DeletePipelineRequest{ExpectedRevision: scenario.revision}).Validate()
			if !errors.Is(err, scenario.want) {
				t.Fatalf("delete error=%v, want %v", err, scenario.want)
			}
			name := "Renamed"
			input, err := (UpdatePipelineRequest{ExpectedRevision: scenario.revision, Name: patchString{Set: true, Value: &name}}).Validate()
			if !errors.Is(err, scenario.want) {
				t.Fatalf("patch error=%v, want %v", err, scenario.want)
			}
			if err == nil && input.ExpectedRevision != valid {
				t.Fatal("revision altered")
			}
		})
	}
	actor := tenant.Context{OrganizationID: stageArchiveFixtureID(1), MemberRole: "admin"}
	if err := (Repository{}).Delete(context.Background(), actor, stageArchiveFixtureID(101), deletePipelineInput{}); !errors.Is(err, ErrPipelineChanged) {
		t.Fatalf("missing revision reached DB: %v", err)
	}
	if _, err := (Repository{}).Update(context.Background(), actor, stageArchiveFixtureID(101), updatePipelineInput{}); !errors.Is(err, ErrPipelineChanged) {
		t.Fatalf("missing patch revision reached DB: %v", err)
	}
}

func TestPipelineRevisionHTTPFailClosed(t *testing.T) {
	actor := tenant.Context{OrganizationID: stageArchiveFixtureID(1), MemberRole: "admin"}
	for _, method := range []string{http.MethodPatch, http.MethodDelete} {
		for _, scenario := range []struct {
			name, body string
			status     int
			code       string
		}{
			{"missing body", "", 409, "pipeline_changed"}, {"missing token", `{"name":"Rename"}`, 409, "pipeline_changed"},
			{"null", `{"expectedRevision":null}`, 409, "pipeline_changed"}, {"empty", `{"expectedRevision":""}`, 409, "pipeline_changed"},
			{"malformed", `{"expectedRevision":"bad"}`, 400, "invalid_pipeline_input"},
			{"wrong type", `{"expectedRevision":1}`, 400, "invalid_json"},
			{"unknown", `{"expected_revision":"bad"}`, 400, "invalid_json"},
			{"trailing", `{} {}`, 400, "invalid_json"}, {"invalid", `{`, 400, "invalid_json"},
		} {
			// DELETE remains strict: name is not part of its body contract.
			if method == http.MethodDelete && scenario.name == "missing token" {
				scenario.body = `{}`
			}
			t.Run(method+"/"+scenario.name, func(t *testing.T) {
				req := httptest.NewRequest(method, "/", strings.NewReader(scenario.body))
				req.SetPathValue("id", stageArchiveFixtureID(101))
				req = req.WithContext(tenant.ContextWithTenant(req.Context(), actor))
				response := httptest.NewRecorder()
				handler := NewHandler(NewRepository(nil))
				if method == http.MethodPatch {
					handler.Update(response, req)
				} else {
					handler.Delete(response, req)
				}
				if response.Code != scenario.status || !strings.Contains(response.Body.String(), `"code":"`+scenario.code+`"`) {
					t.Fatalf("response=%d %s", response.Code, response.Body.String())
				}
			})
		}
		actor.MemberRole = "broker"
		req := httptest.NewRequest(method, "/", strings.NewReader(`{}`))
		req = req.WithContext(tenant.ContextWithTenant(req.Context(), actor))
		response := httptest.NewRecorder()
		handler := NewHandler(NewRepository(nil))
		if method == http.MethodPatch {
			handler.Update(response, req)
		} else {
			handler.Delete(response, req)
		}
		if response.Code != 403 {
			t.Fatalf("permission lost for %s: %d", method, response.Code)
		}
		actor.MemberRole = "admin"
	}
}
