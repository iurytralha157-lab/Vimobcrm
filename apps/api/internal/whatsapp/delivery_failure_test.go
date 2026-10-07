package whatsapp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestEvolutionExplicitUnregisteredRecipientIsNotAmbiguous(t *testing.T) {
	const providerMessage = "number 5511999999999@s.whatsapp.net is not registered on WhatsApp"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/send/text" {
			t.Errorf("path = %q, want /send/text", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"` + providerMessage + `"}`))
	}))
	defer server.Close()

	client := functionsClient{evolutionGoAPIURL: server.URL, evolutionGoAPIKey: "test-key", httpClient: server.Client()}
	_, err := client.invokeEvolutionDirect(context.Background(), "send.text", map[string]any{
		"instance_id": "test-instance",
		"token":       "test-token",
		"body":        map[string]any{"number": "5511999999999", "text": "test"},
	})
	if !errors.Is(err, ErrRecipientNotRegistered) || !errors.Is(err, ErrProviderFailed) {
		t.Fatalf("send error = %v, want definitive recipient rejection", err)
	}
	if errors.Is(err, ErrProviderOutcomeUnknown) {
		t.Fatalf("explicit recipient rejection was marked outcome unknown: %v", err)
	}
	if strings.Contains(err.Error(), "5511999999999") {
		t.Fatalf("send error contains recipient number: %v", err)
	}

	if got := messageDeliveryErrorCode("Evolution Go operation send.text returned ambiguous HTTP 500: " + providerMessage); got != deliveryErrorRecipientNotRegistered {
		t.Fatalf("historical failure code = %q, want recipient_not_registered", got)
	}
	if got := messageDeliveryErrorCode(err.Error()); got != deliveryErrorRecipientNotRegistered {
		t.Fatalf("new failure code = %q, want recipient_not_registered", got)
	}
}

func TestEvolutionOtherSendHTTP500RemainsOutcomeUnknown(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "upstream unavailable", http.StatusInternalServerError)
	}))
	defer server.Close()

	client := functionsClient{evolutionGoAPIURL: server.URL, evolutionGoAPIKey: "test-key", httpClient: server.Client()}
	_, err := client.invokeEvolutionDirect(context.Background(), "send.text", map[string]any{
		"instance_id": "test-instance",
		"token":       "test-token",
		"body":        map[string]any{"number": "5511999999999", "text": "test"},
	})
	if !errors.Is(err, ErrProviderOutcomeUnknown) || errors.Is(err, ErrRecipientNotRegistered) {
		t.Fatalf("other HTTP 500 error = %v, want outcome unknown", err)
	}
	if got := messageDeliveryErrorCode(err.Error()); got != deliveryErrorOutcomeUnknown {
		t.Fatalf("ambiguous failure code = %q, want outcome_unknown", got)
	}
	if got := messageDeliveryErrorCode(whatsappOutboxProviderUnknownMarker); got != deliveryErrorOutcomeUnknown {
		t.Fatalf("canonical unknown marker code = %q, want outcome_unknown", got)
	}
	if got := messageDeliveryErrorCode("provider validation failed"); got != deliveryErrorSendFailed {
		t.Fatalf("other terminal failure code = %q, want send_failed", got)
	}
}

func TestHistoricalOutboxFailureClassificationKeepsDefinitiveAndUnknownApart(t *testing.T) {
	for _, testCase := range []struct {
		name      string
		lastError string
		want      string
	}{
		{
			name:      "old ambiguous provider HTTP 500",
			lastError: "whatsapp provider outcome is unknown: Evolution Go operation send.text returned ambiguous HTTP 500: upstream error",
			want:      deliveryErrorOutcomeUnknown,
		},
		{
			name:      "old explicit nonregistered number",
			lastError: "Evolution Go operation send.text returned ambiguous HTTP 500: number 5511999999999@s.whatsapp.net is not registered on WhatsApp",
			want:      deliveryErrorRecipientNotRegistered,
		},
		{
			name:      "unknown with recipient phrase remains definitive",
			lastError: "whatsapp provider outcome is unknown: number 5511999999999@s.whatsapp.net is not registered on WhatsApp",
			want:      deliveryErrorRecipientNotRegistered,
		},
		{
			name:      "canonical unknown marker",
			lastError: whatsappOutboxProviderUnknownMarker,
			want:      deliveryErrorOutcomeUnknown,
		},
		{
			name:      "other definitive failure",
			lastError: "WhatsApp session is not eligible for delivery",
			want:      deliveryErrorSendFailed,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if got := messageDeliveryErrorCode(testCase.lastError); got != testCase.want {
				t.Fatalf("delivery error code = %q, want %q", got, testCase.want)
			}
		})
	}
}
