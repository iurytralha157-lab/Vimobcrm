package app

import (
	"os"
	"strings"
	"testing"
)

func TestPropertyPortfolioRoutesKeepTheirGuards(t *testing.T) {
	raw, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, required := range []string{
		`mux.Handle("GET /v1/properties/settings/portfolio", withModuleAnyPermission("properties", []string{permissions.PropertyView, permissions.PropertyManage}, http.HandlerFunc(propertiesHandler.ShowPortfolioSettings)))`,
		`mux.Handle("PUT /v1/properties/settings/portfolio", withPermission(permissions.SettingsOrganization, http.HandlerFunc(propertiesHandler.UpdatePortfolioSettings)))`,
		`mux.Handle("GET /v1/properties/{id}/keys/movements", withModulePermission("properties", permissions.PropertyView, http.HandlerFunc(propertiesHandler.ListKeyMovements)))`,
	} {
		if !strings.Contains(source, required) {
			t.Errorf("route guard is missing: %s", required)
		}
	}
}
