package app

import (
	"os"
	"strings"
	"testing"
)

func TestHomeFocusRouteUsesAttentionPermissionBoundary(t *testing.T) {
	source, err := os.ReadFile("app.go")
	if err != nil {
		t.Fatalf("read app.go: %v", err)
	}
	appSource := string(source)
	for _, required := range []string{
		`homefocus.NewHandler(homefocus.NewRepository(postgres))`,
		`mux.Handle("GET /v1/home/focus", withPermission(permissions.AttentionView`,
		`mux.Handle("GET /v1/home/notices", withOrganization(http.HandlerFunc(homeFocusHandler.Notices)))`,
	} {
		if !strings.Contains(appSource, required) {
			t.Errorf("app wiring is missing %q", required)
		}
	}
}
