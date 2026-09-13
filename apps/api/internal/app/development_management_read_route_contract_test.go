package app

import (
	"strings"
	"testing"
)

func TestDevelopmentManagementReadRoutesRequirePropertyManage(t *testing.T) {
	source := readAppWiringSource(t)

	for _, route := range []string{
		`mux.Handle("GET /v1/property-developments", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.List)))`,
		`mux.Handle("GET /v1/property-developments/{id}/workspace", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.ShowWorkspace)))`,
		`mux.Handle("GET /v1/property-developments/{id}/units", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.ListUnits)))`,
		`mux.Handle("GET /v1/property-developments/{id}/reservations", withModulePermission("properties", permissions.PropertyManage, http.HandlerFunc(developmentsHandler.ListReservations)))`,
	} {
		if !strings.Contains(source, route) {
			t.Fatalf("development management read route is not protected by property_manage: %s", route)
		}
	}

}
