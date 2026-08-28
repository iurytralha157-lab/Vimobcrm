package meta

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRepositoryMetaGraphGetKeepsCredentialOutOfURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Query().Has("access_token") {
			t.Fatal("Meta credential must not appear in URL")
		}
		if got := request.Header.Get("Authorization"); got != "Bearer page-token" {
			t.Fatalf("Authorization = %q", got)
		}
		if got := request.URL.Query().Get("appsecret_proof"); got != oauthAppSecretProof("app-secret", "page-token") {
			t.Fatalf("appsecret_proof = %q", got)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"id":"lead-1"}`))
	}))
	defer server.Close()

	repository := NewRepository(nil, Config{
		AppSecret:    "app-secret",
		GraphVersion: "v25.0",
		GraphBaseURL: server.URL,
	})
	repository.client = server.Client()
	result, err := repository.metaGraphGet(context.Background(), "lead-1", "page-token", "id")
	if err != nil {
		t.Fatalf("metaGraphGet() error = %v", err)
	}
	if result["id"] != "lead-1" {
		t.Fatalf("result = %#v", result)
	}
}

func TestRepositoryMetaGraphGetDoesNotFollowRedirect(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("redirect destination must not receive Meta authorization")
	}))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Location", target.URL)
		writer.WriteHeader(http.StatusFound)
	}))
	defer source.Close()

	repository := NewRepository(nil, Config{GraphVersion: "v25.0", GraphBaseURL: source.URL})
	_, err := repository.metaGraphGet(context.Background(), "lead-1", "page-token", "id")
	if err == nil {
		t.Fatal("redirect response must fail closed")
	}
}
