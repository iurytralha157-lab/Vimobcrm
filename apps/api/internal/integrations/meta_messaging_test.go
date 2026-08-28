package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestSendMetaGraphMessageUsesBackendCredentialAndDatabaseTarget(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", request.Method)
		}
		if request.URL.Path != "/v25.0/page-123/messages" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		if got := request.Header.Get("Authorization"); got != "Bearer server-page-token" {
			t.Fatalf("Authorization = %q", got)
		}
		if request.URL.Query().Has("access_token") {
			t.Fatal("Page token must not be present in the URL")
		}
		if got := request.URL.Query().Get("appsecret_proof"); got != metaAppSecretProof("app-secret", "server-page-token") {
			t.Fatalf("appsecret_proof = %q", got)
		}
		var payload map[string]any
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if payload["messaging_type"] != "RESPONSE" {
			t.Fatalf("messaging_type = %#v", payload["messaging_type"])
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"recipient_id":"contact-456","message_id":"mid.789"}`))
	}))
	defer server.Close()

	repository := NewRepository(nil, ExternalConfig{
		MetaGraphVersion: "v25.0",
		MetaGraphBaseURL: server.URL,
		MetaAppSecret:    "app-secret",
	})
	repository.client = server.Client()
	result, err := repository.sendMetaGraphMessage(context.Background(), metaMessageTarget{
		RecipientID: "contact-456",
		Platform:    "messenger",
		SenderID:    "page-123",
		AccessToken: "server-page-token",
	}, "Olá pelo Vimob")
	if err != nil {
		t.Fatalf("sendMetaGraphMessage() error = %v", err)
	}
	if result.MessageID != "mid.789" {
		t.Fatalf("MessageID = %q", result.MessageID)
	}
}

func TestSendMetaGraphMessageUsesInstagramSenderWithoutMessengerField(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v25.0/ig-123/messages" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		var payload map[string]any
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if _, exists := payload["messaging_type"]; exists {
			t.Fatal("Instagram request must not include Messenger messaging_type")
		}
		_, _ = writer.Write([]byte(`{"message_id":"ig-mid.1"}`))
	}))
	defer server.Close()

	repository := NewRepository(nil, ExternalConfig{
		MetaGraphVersion: "v25.0",
		MetaGraphBaseURL: server.URL,
	})
	repository.client = server.Client()
	_, err := repository.sendMetaGraphMessage(context.Background(), metaMessageTarget{
		RecipientID: "ig-contact",
		Platform:    "instagram",
		SenderID:    "ig-123",
		AccessToken: "server-page-token",
	}, "Olá")
	if err != nil {
		t.Fatalf("sendMetaGraphMessage() error = %v", err)
	}
}

func TestSendMetaGraphMessageMapsProviderFailureToSafeError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		http.Error(writer, `{"error":{"message":"provider secret detail"}}`, http.StatusBadRequest)
	}))
	defer server.Close()

	repository := NewRepository(nil, ExternalConfig{
		MetaGraphVersion: "v25.0",
		MetaGraphBaseURL: server.URL,
	})
	repository.client = server.Client()
	_, err := repository.sendMetaGraphMessage(context.Background(), metaMessageTarget{
		RecipientID: "contact-456",
		Platform:    "messenger",
		SenderID:    "page-123",
		AccessToken: "server-page-token",
	}, "Olá")
	if !errors.Is(err, ErrMetaUpstream) {
		t.Fatalf("error = %v, want ErrMetaUpstream", err)
	}
}

func TestSendMetaGraphMessageClassifiesAmbiguousProviderFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		http.Error(writer, `{"error":{"message":"temporary"}}`, http.StatusServiceUnavailable)
	}))
	defer server.Close()

	repository := NewRepository(nil, ExternalConfig{
		MetaGraphVersion: "v25.0",
		MetaGraphBaseURL: server.URL,
	})
	repository.client = server.Client()
	_, err := repository.sendMetaGraphMessage(context.Background(), metaMessageTarget{
		RecipientID: "contact-456",
		Platform:    "messenger",
		SenderID:    "page-123",
		AccessToken: "server-page-token",
	}, "OlÃ¡")
	if !errors.Is(err, ErrMetaUpstream) || !errors.Is(err, ErrMetaDeliveryUncertain) {
		t.Fatalf("error = %v, want upstream + uncertain classification", err)
	}
}

func TestSendMetaGraphMessageTreatsMalformedSuccessAsUncertain(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"recipient_id":"contact-456"}`))
	}))
	defer server.Close()

	repository := NewRepository(nil, ExternalConfig{
		MetaGraphVersion: "v25.0",
		MetaGraphBaseURL: server.URL,
	})
	repository.client = server.Client()
	_, err := repository.sendMetaGraphMessage(context.Background(), metaMessageTarget{
		RecipientID: "contact-456",
		Platform:    "messenger",
		SenderID:    "page-123",
		AccessToken: "server-page-token",
	}, "OlÃ¡")
	if !errors.Is(err, ErrMetaDeliveryUncertain) {
		t.Fatalf("error = %v, want uncertain classification", err)
	}
}

func TestSendMetaMessageRequiresUUIDIdempotencyKeyBeforeDatabaseAccess(t *testing.T) {
	repository := NewRepository(nil, ExternalConfig{})
	_, err := repository.SendMetaMessage(context.Background(), tenant.Context{
		OrganizationID: "00000000-0000-4000-8000-000000000001",
	}, "00000000-0000-4000-8000-000000000002", SendMetaMessageRequest{
		Text:           "OlÃ¡",
		IdempotencyKey: "not-a-uuid",
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("error = %v, want ErrInvalidInput", err)
	}
}

func TestMetaOutboundReservationSQLIsTenantScopedAndProviderSafe(t *testing.T) {
	reserve := strings.Join(strings.Fields(reserveMetaOutboundMessageQuery), " ")
	for _, fragment := range []string{
		"conversation.organization_id = $1::uuid",
		"client_request_id",
		"on conflict (conversation_id, client_request_id)",
		"do nothing",
		"status, sent_at",
	} {
		if !strings.Contains(reserve, fragment) {
			t.Fatalf("reservation query must contain %q; query = %q", fragment, reserve)
		}
	}
	for name, query := range map[string]string{
		"load":     loadMetaOutboundReservationQuery,
		"attempt":  markMetaOutboundAttemptQuery,
		"state":    markMetaOutboundStateQuery,
		"finalize": finalizeMetaOutboundMessageQuery,
	} {
		normalized := strings.Join(strings.Fields(query), " ")
		if !strings.Contains(normalized, "conversation.organization_id = $1::uuid") {
			t.Fatalf("%s query is not tenant-scoped: %q", name, normalized)
		}
		if !strings.Contains(normalized, "client_request_id") {
			t.Fatalf("%s query is not bound to the client request UUID: %q", name, normalized)
		}
	}
}
