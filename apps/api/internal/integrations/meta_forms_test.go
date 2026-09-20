package integrations

import (
	"context"
	"errors"
	"fmt"
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

func TestFetchMetaLeadFormsRejectsRepeatedPagingCursor(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestNumber := requests.Add(1)
		if requestNumber == 1 && request.URL.Query().Get("after") != "" {
			t.Fatalf("first after = %q", request.URL.Query().Get("after"))
		}
		if requestNumber == 2 && request.URL.Query().Get("after") != "repeated-cursor" {
			t.Fatalf("second after = %q", request.URL.Query().Get("after"))
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"data":[{"id":"form-1","name":"Form 1","status":"ACTIVE"}],
			"paging":{"cursors":{"after":"repeated-cursor"},"next":"https://graph.facebook.com/next"}
		}`))
	}))
	defer server.Close()

	repository := NewRepository(nil, ExternalConfig{
		MetaGraphVersion: "v25.0",
		MetaGraphBaseURL: server.URL,
	})
	repository.client = server.Client()
	forms, err := repository.fetchMetaLeadForms(context.Background(), "12345", "page-token")
	if !errors.Is(err, ErrMetaUpstream) {
		t.Fatalf("error = %v, want ErrMetaUpstream", err)
	}
	if forms != nil {
		t.Fatalf("forms = %#v, want nil on incomplete collection", forms)
	}
	if requests.Load() != 2 {
		t.Fatalf("requests = %d, want 2", requests.Load())
	}
}

func TestFetchMetaLeadFormsRejectsContinuationAfterPageLimit(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestNumber := requests.Add(1)
		wantAfter := ""
		if requestNumber > 1 {
			wantAfter = fmt.Sprintf("cursor-%d", requestNumber-1)
		}
		if got := request.URL.Query().Get("after"); got != wantAfter {
			t.Fatalf("request %d after = %q, want %q", requestNumber, got, wantAfter)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(writer, `{
			"data":[{"id":"form-%d","name":"Form %d","status":"ACTIVE"}],
			"paging":{"cursors":{"after":"cursor-%d"},"next":"https://graph.facebook.com/next"}
		}`, requestNumber, requestNumber, requestNumber)
	}))
	defer server.Close()

	repository := NewRepository(nil, ExternalConfig{
		MetaGraphVersion: "v25.0",
		MetaGraphBaseURL: server.URL,
	})
	repository.client = server.Client()
	forms, err := repository.fetchMetaLeadForms(context.Background(), "12345", "page-token")
	if !errors.Is(err, ErrMetaUpstream) {
		t.Fatalf("error = %v, want ErrMetaUpstream", err)
	}
	if forms != nil {
		t.Fatalf("forms = %#v, want nil on incomplete collection", forms)
	}
	if requests.Load() != 10 {
		t.Fatalf("requests = %d, want 10", requests.Load())
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
