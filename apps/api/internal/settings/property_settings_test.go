package settings

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

const propertySettingsExpectedVersion = "2026-09-08T12:00:00.123456Z"

func propertySettingsString(value string) propertySettingsPatchString {
	return propertySettingsPatchString{Set: true, Value: &value}
}

func TestNormalizePropertySettingsRequestAcceptsCanonicalPartialUpdates(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		request    UpdatePropertySettingsRequest
		wantPolicy string
		wantOwner  string
	}{
		{
			name: "edit policy",
			request: UpdatePropertySettingsRequest{
				PropertyEditPolicy: propertySettingsString(" everyone "),
				ExpectedUpdatedAt:  propertySettingsExpectedVersion,
			},
			wantPolicy: "everyone",
		},
		{
			name: "owner visibility",
			request: UpdatePropertySettingsRequest{
				PropertyOwnerContactVisibility: propertySettingsString("hidden"),
				ExpectedUpdatedAt:              propertySettingsExpectedVersion,
			},
			wantOwner: "hidden",
		},
		{
			name: "both settings",
			request: UpdatePropertySettingsRequest{
				PropertyEditPolicy:             propertySettingsString("responsible_or_admin"),
				PropertyOwnerContactVisibility: propertySettingsString("visible"),
				ExpectedUpdatedAt:              propertySettingsExpectedVersion,
			},
			wantPolicy: "responsible_or_admin",
			wantOwner:  "visible",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			policy, owner, expectedUpdatedAt, err := normalizePropertySettingsRequest(tt.request)
			if err != nil {
				t.Fatalf("normalizePropertySettingsRequest() error = %v", err)
			}
			if got := stringPointerValue(policy); got != tt.wantPolicy {
				t.Fatalf("policy = %q, want %q", got, tt.wantPolicy)
			}
			if got := stringPointerValue(owner); got != tt.wantOwner {
				t.Fatalf("owner visibility = %q, want %q", got, tt.wantOwner)
			}
			if got := expectedUpdatedAt.Format("2006-01-02T15:04:05.999999999Z07:00"); got != propertySettingsExpectedVersion {
				t.Fatalf("expected updated at = %q, want %q", got, propertySettingsExpectedVersion)
			}
		})
	}
}

func TestNormalizePropertySettingsRequestRejectsEmptyAndInvalidValues(t *testing.T) {
	t.Parallel()

	for _, request := range []UpdatePropertySettingsRequest{
		{},
		{ExpectedUpdatedAt: propertySettingsExpectedVersion},
		{ExpectedUpdatedAt: "not-a-timestamp", PropertyEditPolicy: propertySettingsString("everyone")},
		{ExpectedUpdatedAt: propertySettingsExpectedVersion, PropertyEditPolicy: propertySettingsString(" ")},
		{ExpectedUpdatedAt: propertySettingsExpectedVersion, PropertyEditPolicy: propertySettingsString("custom")},
		{ExpectedUpdatedAt: propertySettingsExpectedVersion, PropertyOwnerContactVisibility: propertySettingsString("private")},
	} {
		if _, _, _, err := normalizePropertySettingsRequest(request); err != ErrInvalidInput {
			t.Fatalf("normalizePropertySettingsRequest(%+v) error = %v, want ErrInvalidInput", request, err)
		}
	}
}

func TestNormalizePropertySettingsRequestRejectsExplicitNull(t *testing.T) {
	t.Parallel()

	var request UpdatePropertySettingsRequest
	if err := json.Unmarshal([]byte(`{
		"property_edit_policy": null,
		"property_owner_contact_visibility": "hidden",
		"expected_updated_at": "2026-09-08T12:00:00Z"
	}`), &request); err != nil {
		t.Fatalf("decode property settings request: %v", err)
	}
	if _, _, _, err := normalizePropertySettingsRequest(request); err != ErrInvalidInput {
		t.Fatalf("normalizePropertySettingsRequest() error = %v, want ErrInvalidInput", err)
	}
}

func TestPropertySettingsEndpointIsStrictTenantScopedAndNarrow(t *testing.T) {
	t.Parallel()

	routesSource, err := os.ReadFile("../app/routes.go")
	if err != nil {
		t.Fatalf("read app routes: %v", err)
	}
	guardedRoute := `mux.Handle("PATCH /v1/settings/properties", withPermission(permissions.SettingsOrganization, http.HandlerFunc(settingsHandler.UpdatePropertySettings)))`
	if !strings.Contains(string(routesSource), guardedRoute) {
		t.Fatal("property settings route must require SettingsOrganization")
	}

	handlerSource, err := os.ReadFile("handler.go")
	if err != nil {
		t.Fatalf("read settings handler: %v", err)
	}
	handlerMethod := sourceMethod(t, string(handlerSource), "func (handler Handler) UpdatePropertySettings")
	for _, required := range []string{
		"tenant.RequireOrganizationContext",
		"var request UpdatePropertySettingsRequest",
		"httpserver.DecodeJSON",
		"handler.repo.UpdatePropertySettings",
		"httpserver.WriteJSON(w, http.StatusOK, result)",
	} {
		if !strings.Contains(handlerMethod, required) {
			t.Fatalf("property settings handler is missing %q", required)
		}
	}

	repositorySource, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read settings repository: %v", err)
	}
	repositoryMethod := sourceMethod(t, string(repositorySource), "func (repo Repository) UpdatePropertySettings")
	for _, required := range []string{
		"canManageSetting(tenantContext, permissions.SettingsOrganization)",
		"property_edit_policy = coalesce($2, property_edit_policy)",
		"property_owner_contact_visibility = coalesce($3, property_owner_contact_visibility)",
		"where id = $1::uuid",
		"and updated_at = $4::timestamptz",
		"returning updated_at",
		"ErrPropertySettingsConflict",
	} {
		if !strings.Contains(repositoryMethod, required) {
			t.Fatalf("property settings repository is missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"name = $",
		"cnpj =",
		"email =",
		"default_commission_percentage =",
	} {
		if strings.Contains(repositoryMethod, forbidden) {
			t.Fatalf("property settings repository must not update general field %q", forbidden)
		}
	}
}

func TestPropertySettingsConflictHasSpecificHTTPContract(t *testing.T) {
	t.Parallel()

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPatch, "/v1/settings/properties", nil)
	writeSettingsError(response, request, ErrPropertySettingsConflict)

	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusConflict)
	}
	if body := response.Body.String(); !strings.Contains(body, `"code":"property_settings_conflict"`) {
		t.Fatalf("body does not expose property settings conflict: %s", body)
	}
}

func stringPointerValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func sourceMethod(t *testing.T, source string, signature string) string {
	t.Helper()

	start := strings.Index(source, signature)
	if start < 0 {
		t.Fatalf("method %q was not found", signature)
	}
	tail := source[start:]
	if end := strings.Index(tail[1:], "\nfunc "); end >= 0 {
		return tail[:end+1]
	}
	return tail
}
