package app

import (
	"os"
	"strings"
	"testing"
)

func TestChavesNaMaoPublicationRoutesRequireSettingsAndPropertyPermissions(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatalf("read routes.go: %v", err)
	}
	source := string(raw)

	getRoute := `mux.Handle("GET /v1/integrations/portals/chaves-na-mao/publications", withModulePermission("portals", permissions.SettingsIntegrations, tenant.RequireAnyPermission([]string{permissions.PropertyView, permissions.PropertyManage}, http.HandlerFunc(portalsHandler.ListChavesNaMaoPublications))))`
	if !strings.Contains(source, getRoute) {
		t.Fatal("Chaves na Mao publication reads must require settings_integrations plus property_view or property_manage")
	}

	putRoute := `mux.Handle("PUT /v1/integrations/portals/chaves-na-mao/publications", withModulePermission("portals", permissions.SettingsIntegrations, tenant.RequirePermission(permissions.PropertyManage, http.HandlerFunc(portalsHandler.UpsertChavesNaMaoPublications))))`
	if !strings.Contains(source, putRoute) {
		t.Fatal("Chaves na Mao publication writes must require settings_integrations plus property_manage")
	}
}
