package app

import (
	"os"
	"strings"
	"testing"
)

func TestUserPresenceRouteRequiresDedicatedPermission(t *testing.T) {
	raw, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatalf("read app.go: %v", err)
	}
	source := string(raw)

	required := `mux.Handle("GET /v1/user-presence", withPermission(permissions.UsersPresenceView, http.HandlerFunc(presenceHandler.List)))`
	if !strings.Contains(source, required) {
		t.Fatalf("presence route must require users_presence_view through the tenant-aware permission guard")
	}
	for _, unsafe := range []string{
		`mux.Handle("GET /v1/user-presence", withAuth(`,
		`mux.Handle("GET /v1/user-presence", withOrganization(`,
	} {
		if strings.Contains(source, unsafe) {
			t.Fatalf("presence route uses an insufficient guard: %s", unsafe)
		}
	}
}
