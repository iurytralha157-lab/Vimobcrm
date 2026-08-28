package integrations

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
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

func TestMetaOAuthFlowProjectionIncludesSafeInstagramAssetOnly(t *testing.T) {
	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) GetMetaOAuthFlow")
	if start < 0 {
		t.Fatal("Meta OAuth flow projection section was not found")
	}
	end := strings.Index(source[start:], "func (repo Repository) ClaimMetaOAuthConnectPayload")
	if end < 0 {
		t.Fatal("Meta OAuth flow projection section was not found")
	}
	projection := source[start : start+end]
	for _, required := range []string{
		"'instagram_business_account'",
		"'{instagram_business_account,id}'",
		"'{instagram_business_account,username}'",
	} {
		if !strings.Contains(projection, required) {
			t.Fatalf("safe Instagram projection is missing %q", required)
		}
	}
	for _, forbidden := range []string{"access_token", "user_token", "secret_ref", "decrypted_secret"} {
		if strings.Contains(projection, forbidden) {
			t.Fatalf("browser OAuth projection exposes credential field %q", forbidden)
		}
	}
}

func TestMetaMarketingCapabilityRequiresTokenAndGrantedScopes(t *testing.T) {
	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) ListMetaIntegrations")
	if start < 0 {
		t.Fatal("Meta integration projection section was not found")
	}
	end := strings.Index(source[start:], "func (repo Repository) ListMetaPageForms")
	if end < 0 {
		t.Fatal("Meta integration projection section was not found")
	}
	projection := source[start : start+end]
	for _, required := range []string{
		"user_access_token_secret_ref",
		"credentials.granted_scopes",
		"'ads_read'",
		"'read_insights'",
		"'instagram_basic'",
		"'instagram_manage_insights'",
		"'marketing_token_available', false",
	} {
		if !strings.Contains(projection, required) {
			t.Fatalf("marketing capability projection is missing %q", required)
		}
	}
}

func TestMetaMarketingCapabilitySchemaFallbackIsNarrowAndFailClosed(t *testing.T) {
	for _, databaseError := range []error{
		&pgconn.PgError{Code: "42703", Message: `column credentials.granted_scopes does not exist`},
		&pgconn.PgError{Code: "42703", ColumnName: "user_access_token_secret_ref"},
		fmt.Errorf("wrapped: %w", &pgconn.PgError{Code: "42703", Message: `column credentials.user_access_token_secret_ref does not exist`}),
	} {
		if !isMetaMarketingCapabilitySchemaMissing(databaseError) {
			t.Fatalf("expected legacy fallback for %v", databaseError)
		}
	}
	for _, databaseError := range []*pgconn.PgError{
		{Code: "42501"},
		{Code: "42P01"},
		{Code: "23505"},
		{Code: "42703", Message: `column mi.created_at does not exist`},
	} {
		if isMetaMarketingCapabilitySchemaMissing(databaseError) {
			t.Fatalf("unexpected fallback for PostgreSQL error %s", databaseError.Code)
		}
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
		if r.URL.Query().Has("access_token") {
			t.Fatal("Page token must not be present in the URL")
		}
		if got := r.Header.Get("Authorization"); got != "Bearer page-token" {
			t.Fatalf("unexpected authorization header: %s", got)
		}
		if got := r.URL.Query().Get("appsecret_proof"); got != metaAppSecretProof("app-secret", "page-token") {
			t.Fatalf("unexpected appsecret_proof: %s", got)
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
		MetaAppSecret:    "app-secret",
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
