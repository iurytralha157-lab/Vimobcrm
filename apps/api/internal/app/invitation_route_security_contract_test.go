package app

import (
	"os"
	"strings"
	"testing"
)

func TestInvitationRoutesProtectTokensAndAllowIdentityBootstrap(t *testing.T) {
	source, err := os.ReadFile("app.go")
	if err != nil {
		t.Fatalf("read app routes: %v", err)
	}
	text := string(source)

	if !strings.Contains(text, `mux.Handle("GET /v1/invitations", withPermission(permissions.UsersManage`) {
		t.Fatal("invitation listing must require users_manage because pending tokens grant account bootstrap access")
	}
	if !strings.Contains(text, `mux.Handle("POST /v1/invitations/{token}/accept", httpserver.RequireAuth(authVerifier`) {
		t.Fatal("authenticated acceptance must not require an existing tenant membership")
	}
}
