package publications

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPublicationStorageUsesBearerOnlyForLegacyJWTKeys(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "https://project.supabase.co/storage/v1/object", nil)
	setPublicationStorageAuth(request, "header.payload.signature")
	if request.Header.Get("apikey") != "header.payload.signature" {
		t.Fatal("legacy service-role JWT is missing apikey header")
	}
	if request.Header.Get("Authorization") != "Bearer header.payload.signature" {
		t.Fatal("legacy service-role JWT is missing Bearer authorization")
	}

	setPublicationStorageAuth(request, "sb_secret_example")
	if request.Header.Get("apikey") != "sb_secret_example" {
		t.Fatal("opaque secret is missing apikey header")
	}
	if authorization := request.Header.Get("Authorization"); authorization != "" {
		t.Fatalf("opaque secret must not be sent as Bearer, got %q", authorization)
	}
}
