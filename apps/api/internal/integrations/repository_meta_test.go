package integrations

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestCanManageMetaIntegrationsAllowsOrganizationAdmin(t *testing.T) {
	tenantContext := tenant.Context{
		UserRole:   "user",
		MemberRole: "admin",
	}

	if !canManageMetaIntegrations(tenantContext) {
		t.Fatal("expected organization admin to manage Meta integrations")
	}
}

func TestCanManageMetaIntegrationsRejectsRegularUser(t *testing.T) {
	tenantContext := tenant.Context{
		UserRole:   "admin",
		MemberRole: "user",
	}

	if canManageMetaIntegrations(tenantContext) {
		t.Fatal("expected regular organization user to be rejected")
	}
}

func TestFetchMetaLeadFormsUsesGraphResponseShape(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Fatalf("expected GET, got %s", r.Method)
		}
		if r.URL.Path != "/v25.0/123/leadgen_forms" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("access_token"); got != "page-token" {
			t.Fatalf("unexpected access token: %s", got)
		}
		if got := r.URL.Query().Get("limit"); got != "100" {
			t.Fatalf("unexpected limit: %s", got)
		}
		if got := r.URL.Query().Get("fields"); got == "" {
			t.Fatal("expected fields query parameter")
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{
				{
					"id":          "form-1",
					"name":        "Form principal",
					"status":      "ACTIVE",
					"leads_count": 7,
					"questions": []map[string]any{
						{"key": "full_name", "label": "Nome", "type": "FULL_NAME"},
					},
				},
			},
		})
	}))
	defer server.Close()

	repo := NewRepository(nil, ExternalConfig{
		MetaGraphBaseURL: server.URL,
		MetaGraphVersion: "v25.0",
	})

	forms, err := repo.fetchMetaLeadForms(context.Background(), "123", "page-token")
	if err != nil {
		t.Fatalf("fetchMetaLeadForms returned error: %v", err)
	}
	if len(forms) != 1 {
		t.Fatalf("expected 1 form, got %d", len(forms))
	}
	if forms[0]["id"] != "form-1" || forms[0]["name"] != "Form principal" || forms[0]["status"] != "ACTIVE" {
		t.Fatalf("unexpected form payload: %#v", forms[0])
	}
	if forms[0]["leads_count"] != 7 {
		t.Fatalf("unexpected leads count: %#v", forms[0]["leads_count"])
	}
	questions, ok := forms[0]["questions"].([]map[string]any)
	if !ok || len(questions) != 1 || questions[0]["key"] != "full_name" {
		t.Fatalf("unexpected questions payload: %#v", forms[0]["questions"])
	}
}
