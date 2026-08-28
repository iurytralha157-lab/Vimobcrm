package supabasehttp

import (
	"net/http"
	"testing"
)

func TestSetServiceAuthUsesAPIKeyOnlyForOpaqueSecret(t *testing.T) {
	request, err := http.NewRequest(http.MethodGet, "https://project.supabase.co/auth/v1/admin/users", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer stale")

	SetServiceAuth(request, "sb_secret_example")

	if request.Header.Get("apikey") != "sb_secret_example" {
		t.Fatalf("apikey = %q", request.Header.Get("apikey"))
	}
	if authorization := request.Header.Get("Authorization"); authorization != "" {
		t.Fatalf("opaque secret leaked into Authorization: %q", authorization)
	}
}

func TestSetServiceAuthKeepsLegacyServiceRoleJWTCompatibility(t *testing.T) {
	request, err := http.NewRequest(http.MethodGet, "https://project.supabase.co/auth/v1/admin/users", nil)
	if err != nil {
		t.Fatal(err)
	}

	SetServiceAuth(request, "header.payload.signature")

	if request.Header.Get("apikey") != "header.payload.signature" {
		t.Fatalf("apikey = %q", request.Header.Get("apikey"))
	}
	if request.Header.Get("Authorization") != "Bearer header.payload.signature" {
		t.Fatalf("Authorization = %q", request.Header.Get("Authorization"))
	}
}
