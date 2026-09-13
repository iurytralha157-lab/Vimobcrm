package app

import (
	"os"
	"strings"
	"testing"
)

func TestGoogleCalendarUsesSelfScopedProxyWithoutOpeningGenericFunctions(t *testing.T) {
	source, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatalf("read routes.go: %v", err)
	}

	routes := string(source)
	selfScoped := `mux.Handle("POST /v1/integrations/google-calendar/functions/{name}", withOrganization(http.HandlerFunc(integrationsHandler.InvokeGoogleCalendarFunction)))`
	if !strings.Contains(routes, selfScoped) {
		t.Fatalf("Google Calendar route must be authenticated and organization-scoped")
	}

	adminScoped := `mux.Handle("POST /v1/integrations/functions/{name}", withPermission(permissions.SettingsIntegrations, http.HandlerFunc(integrationsHandler.InvokeFunction)))`
	if !strings.Contains(routes, adminScoped) {
		t.Fatalf("generic integration function proxy must remain SettingsIntegrations-scoped")
	}
}
