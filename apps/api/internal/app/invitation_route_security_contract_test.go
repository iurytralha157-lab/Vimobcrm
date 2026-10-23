package app

import (
	"os"
	"strings"
	"testing"
)

func TestInvitationRoutesProtectTokensAndAllowIdentityBootstrap(t *testing.T) {
	source, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatalf("read app routes: %v", err)
	}
	text := string(source)

	if !strings.Contains(text, `withActivePermission := func(permission string, handler http.Handler) http.Handler {`) ||
		!strings.Contains(text, `return withActiveAuthTenant(tenant.RequireOrganization(tenant.RequirePermission(permission, handler)))`) ||
		!strings.Contains(text, `mux.Handle("GET /v1/invitations", withActivePermission(permissions.UsersManage`) {
		t.Fatal("invitation listing must require a live session and users_manage because pending invitations grant account bootstrap access")
	}
	if !strings.Contains(text, `withActiveAuth := func(handler http.Handler) http.Handler {`) ||
		!strings.Contains(text, `return withAuth(httpserver.RequireActiveSession(activeSessionChecker, handler))`) ||
		!strings.Contains(text, `mux.Handle("POST /v1/invitations/{token}/accept", withActiveAuth(`) ||
		!strings.Contains(text, `mux.Handle("GET /v1/me/account-status", withActiveAuth(`) ||
		!strings.Contains(text, `mux.Handle("GET /v1/user-organizations", withActiveAuth(`) {
		t.Fatal("authenticated acceptance must verify a live session without requiring tenant membership")
	}
}
