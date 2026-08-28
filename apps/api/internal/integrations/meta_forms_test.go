package integrations

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestFetchMetaLeadFormsKeepsTokenOutOfURLAndRebuildsPaging(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestNumber := requests.Add(1)
		if request.URL.Path != "/v25.0/12345/leadgen_forms" {
			t.Fatalf("path = %q", request.URL.Path)
		}
		if request.URL.Query().Has("access_token") {
			t.Fatal("Page token must never appear in the Graph URL")
		}
		if got := request.Header.Get("Authorization"); got != "Bearer page-token" {
			t.Fatalf("Authorization = %q", got)
		}
		if got := request.URL.Query().Get("appsecret_proof"); got != metaAppSecretProof("app-secret", "page-token") {
			t.Fatalf("appsecret_proof = %q", got)
		}
		writer.Header().Set("Content-Type", "application/json")
		if requestNumber == 1 {
			if after := request.URL.Query().Get("after"); after != "" {
				t.Fatalf("first after = %q", after)
			}
			_, _ = writer.Write([]byte(`{
				"data":[{"id":"form-1","name":"Form 1","status":"ACTIVE"}],
				"paging":{"cursors":{"after":"cursor-2"},"next":"https://attacker.invalid/steal?access_token=page-token"}
			}`))
			return
		}
		if after := request.URL.Query().Get("after"); after != "cursor-2" {
			t.Fatalf("second after = %q", after)
		}
		_, _ = writer.Write([]byte(`{
			"data":[{"id":"form-2","name":"Form 2","status":"ACTIVE"}],
			"paging":{"cursors":{}}
		}`))
	}))
	defer server.Close()

	repository := NewRepository(nil, ExternalConfig{
		MetaAppSecret:    "app-secret",
		MetaGraphVersion: "v25.0",
		MetaGraphBaseURL: server.URL,
	})
	repository.client = server.Client()
	forms, err := repository.fetchMetaLeadForms(context.Background(), "12345", "page-token")
	if err != nil {
		t.Fatalf("fetchMetaLeadForms() error = %v", err)
	}
	if requests.Load() != 2 {
		t.Fatalf("requests = %d, want 2", requests.Load())
	}
	if len(forms) != 2 || forms[0]["id"] != "form-1" || forms[1]["id"] != "form-2" {
		t.Fatalf("forms = %#v", forms)
	}
}

func TestIntegrationsHTTPClientRejectsProviderRedirects(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("redirect target must not receive a provider credential")
	}))
	defer target.Close()

	source := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Location", target.URL)
		writer.WriteHeader(http.StatusFound)
	}))
	defer source.Close()

	repository := NewRepository(nil, ExternalConfig{
		MetaGraphVersion: "v25.0",
		MetaGraphBaseURL: source.URL,
	})
	_, err := repository.fetchMetaLeadForms(context.Background(), "12345", "page-token")
	if err == nil {
		t.Fatal("redirect response must fail closed")
	}
}
