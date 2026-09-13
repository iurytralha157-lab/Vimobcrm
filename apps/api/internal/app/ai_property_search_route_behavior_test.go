package app

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestAIRunPropertyGuardRejectsSettingsAIAloneWithoutCallingHandler(t *testing.T) {
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	})
	guarded := tenant.RequirePermission(
		permissions.SettingsAI,
		tenant.RequireAnyPermission(
			[]string{permissions.PropertyView, permissions.PropertyManage},
			next,
		),
	)
	request := httptest.NewRequest(http.MethodPost, "/v1/ai/run", nil)
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		OrganizationID: "10000000-0000-4000-8000-000000000001",
		UserID:         "20000000-0000-4000-8000-000000000001",
		MemberRole:     "user",
		Permissions:    []string{permissions.SettingsAI},
	}))
	recorder := httptest.NewRecorder()

	guarded.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
	if called {
		t.Fatal("AI handler was called without a property permission")
	}
}
