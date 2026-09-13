package app

import (
	"os"
	"strings"
	"testing"
)

func TestPublicAPIManagementRoutesRequireTheAPIModule(t *testing.T) {
	sourceBytes, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatalf("read routes.go: %v", err)
	}
	source := string(sourceBytes)
	for _, route := range []string{
		`"GET /v1/settings/api-keys", withModulePermission("api", permissions.SettingsIntegrations`,
		`"POST /v1/settings/api-keys", withModulePermission("api", permissions.SettingsIntegrations`,
		`"DELETE /v1/settings/api-keys/{id}", withModulePermission("api", permissions.SettingsIntegrations`,
	} {
		if !strings.Contains(source, route) {
			t.Fatalf("API key management route is not module-gated: %s", route)
		}
	}
	if !strings.Contains(source, `"POST /v1/public/api/leads", http.HandlerFunc(publicAPIHandler.CreateLead)`) {
		t.Fatal("public lead API route is missing or accidentally authenticated as a CRM session route")
	}
}
