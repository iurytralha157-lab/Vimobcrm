package app

import (
	"os"
	"strings"
	"testing"
)

func TestPropertyUpdateRouteDefersFineGrainedPolicyToRepository(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatalf("read routes.go: %v", err)
	}
	source := string(raw)

	updateRoute := `mux.Handle("PATCH /v1/properties/{id}", withModuleAnyPermission("properties", []string{permissions.PropertyView, permissions.PropertyManage}, http.HandlerFunc(propertiesHandler.Update)))`
	if !strings.Contains(source, updateRoute) {
		t.Fatal("property update route must admit property_view or property_manage before repository policy checks")
	}

	for _, guardedRoute := range []string{
		`mux.Handle("POST /v1/properties", withModulePermission("properties", permissions.PropertyManage`,
		`mux.Handle("DELETE /v1/properties/{id}", withModulePermission("properties", permissions.PropertyManage`,
		`mux.Handle("POST /v1/property-images", withModulePermission("properties", permissions.PropertyManage`,
		`mux.Handle("POST /v1/properties/{id}/assets", withModulePermission("properties", permissions.PropertyManage`,
		`mux.Handle("POST /v1/properties/{id}/publications/site/unpublish", withModulePermission("properties", permissions.PropertyManage`,
		`mux.Handle("POST /v1/properties/{id}/ownerships", withModulePermission("properties", permissions.PropertyManage`,
	} {
		if !strings.Contains(source, guardedRoute) {
			t.Fatalf("sensitive property operation lost property_manage guard: %s", guardedRoute)
		}
	}
}
