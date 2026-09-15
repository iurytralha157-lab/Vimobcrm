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

func TestMetaMarketingCapabilitySeparatesPaidAndInstagramScopes(t *testing.T) {
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
		"credentials.token_expires_at > now() + interval '5 minutes'",
		"'ads_read'",
		"'instagram_insights_available'",
		"nullif(btrim(mi.instagram_business_account_id), '') is not null",
		"'instagram_basic'",
		"'instagram_manage_insights'",
		"'pages_read_engagement'",
		"'marketing_token_available', false",
		"'instagram_insights_available', false",
	} {
		if !strings.Contains(projection, required) {
			t.Fatalf("marketing capability projection is missing %q", required)
		}
	}
	if strings.Contains(projection, "'read_insights'") {
		t.Fatal("marketing capability projection requires the obsolete read_insights scope")
	}
	paidStart := strings.Index(projection, "'marketing_token_available'")
	organicStart := strings.Index(projection, "'instagram_insights_available'")
	if paidStart < 0 || organicStart <= paidStart {
		t.Fatal("paid and Instagram capability projections are not independently ordered")
	}
	paidProjection := projection[paidStart:organicStart]
	for _, forbidden := range []string{
		"instagram_business_account_id",
		"'instagram_basic'",
		"'instagram_manage_insights'",
		"'pages_read_engagement'",
	} {
		if strings.Contains(paidProjection, forbidden) {
			t.Fatalf("paid Marketing capability is incorrectly coupled to %q", forbidden)
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

func TestCanonicalMetaFormPropertyIDRejectsHiddenReferenceBypassShapes(t *testing.T) {
	first := "11111111-1111-4111-8111-111111111111"
	second := "22222222-2222-4222-8222-222222222222"

	resolved, err := canonicalMetaFormPropertyID(MetaFormConfigRequest{
		DefaultValues: map[string]any{"interest_property_id": first},
	})
	if err != nil || resolved == nil || *resolved != first {
		t.Fatalf("default interest property resolution = %v, %v", resolved, err)
	}

	if _, err := canonicalMetaFormPropertyID(MetaFormConfigRequest{
		PropertyID:    &first,
		DefaultValues: map[string]any{"property_id": second},
	}); err != ErrInvalidInput {
		t.Fatalf("conflicting property references error = %v, want ErrInvalidInput", err)
	}

	if _, err := canonicalMetaFormPropertyID(MetaFormConfigRequest{
		DefaultValues: map[string]any{"property_id": "not-a-uuid"},
	}); err != ErrInvalidInput {
		t.Fatalf("malformed default property error = %v, want ErrInvalidInput", err)
	}
}

func TestCanonicalMetaFormPropertyIDAllowsFormWithoutProperty(t *testing.T) {
	resolved, err := canonicalMetaFormPropertyID(MetaFormConfigRequest{
		DefaultValues: map[string]any{
			"purpose":   "Venda",
			"auto_tags": []string{"meta"},
		},
	})
	if err != nil {
		t.Fatalf("canonicalMetaFormPropertyID() error = %v", err)
	}
	if resolved != nil {
		t.Fatalf("canonicalMetaFormPropertyID() = %v, want nil", *resolved)
	}
}

func TestCleanStringOrEmptyKeepsOptionalMetaFormReferencesComparable(t *testing.T) {
	blank := "   "
	queueID := " 11111111-1111-4111-8111-111111111111 "

	if got := cleanStringOrEmpty(nil); got != "" {
		t.Fatalf("cleanStringOrEmpty(nil) = %q, want empty string", got)
	}
	if got := cleanStringOrEmpty(&blank); got != "" {
		t.Fatalf("cleanStringOrEmpty(blank) = %q, want empty string", got)
	}
	if got := cleanStringOrEmpty(&queueID); got != "11111111-1111-4111-8111-111111111111" {
		t.Fatalf("cleanStringOrEmpty(queueID) = %q", got)
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
