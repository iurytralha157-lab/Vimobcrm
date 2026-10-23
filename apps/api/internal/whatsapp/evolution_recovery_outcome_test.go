package whatsapp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEvolutionReconnectHTTPFailureRequiresDefinitiveStaleFallback(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusRequestTimeout, http.StatusTooEarly,
		http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost || r.URL.Path != "/instance/reconnect" {
					t.Errorf("unexpected provider request: %s %s", r.Method, r.URL.Path)
				}
				w.WriteHeader(status)
				_, _ = w.Write([]byte(`{"error":"client disconnected"}`))
			}))
			defer server.Close()
			client := functionsClient{evolutionGoAPIURL: server.URL, evolutionGoAPIKey: "synthetic-key", httpClient: server.Client()}
			_, err := client.invokeEvolution(context.Background(), "instance.reconnect", map[string]any{
				"instance_id": "8513bf79-f466-4ba4-a945-f794516d4e87", "token": "synthetic-token",
			})
			if !errors.Is(err, ErrProviderFailed) {
				t.Fatalf("provider rejection = %v, want ErrProviderFailed", err)
			}
			unknown := status != http.StatusBadRequest
			if errors.Is(err, ErrProviderOutcomeUnknown) != unknown {
				t.Fatalf("HTTP %d outcome uncertainty = %v, want %v", status, err, unknown)
			}
			// The supervisor uses this decision before issuing forceReconnect.
			if got := isProviderStaleClientError(err); got == unknown {
				t.Fatalf("HTTP %d stale fallback = %v, want %v; error: %v", status, got, !unknown, err)
			}
		})
	}
}

func TestEvolutionStaleFallbackRejectsWrappedUnknownOutcome(t *testing.T) {
	for _, cause := range []error{
		errors.Join(ErrProviderOutcomeUnknown, errors.New("client disconnected")),
		errors.Join(errors.New("provider wrapper"), errors.Join(ErrProviderOutcomeUnknown, errors.New("CLIENT DISCONNECTED"))),
	} {
		if isProviderStaleClientError(cause) {
			t.Fatalf("wrapped provider uncertainty must stop fallback: %v", cause)
		}
	}
}

func TestEvolutionQRCodeRecoveryPreservesHTTPOutcomeClassification(t *testing.T) {
	for _, test := range []struct {
		name      string
		status    int
		message   string
		unknown   bool
		qrAllowed bool
	}{
		{"definitive stale login", http.StatusBadRequest, "failed to login", false, true},
		{"definitive rejection", http.StatusBadRequest, "unauthorized", false, false},
		{"request timeout", http.StatusRequestTimeout, "client disconnected", true, false},
		{"too early", http.StatusTooEarly, "retry later", true, false},
		{"server error with stale login text", http.StatusInternalServerError, "failed to login", true, false},
		{"bad gateway", http.StatusBadGateway, "client disconnected", true, false},
		{"gateway timeout", http.StatusGatewayTimeout, "upstream timeout", true, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			const instanceKey = "9513bf79-f466-4ba4-a945-f794516d4e87"
			qrRequests, forceRequests := 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/instance/qr":
					qrRequests++
					if forceRequests > 0 {
						_, _ = w.Write([]byte(`{"qrcode":"data:image/png;base64,cXItY29kZQ=="}`))
						return
					}
					w.WriteHeader(http.StatusBadRequest)
					_, _ = w.Write([]byte(`{"error":"no QR code available"}`))
				case "/instance/status":
					w.WriteHeader(http.StatusBadRequest)
					_, _ = w.Write([]byte(`{"error":"client disconnected"}`))
				case "/instance/forcereconnect/" + instanceKey:
					forceRequests++
					w.WriteHeader(test.status)
					_, _ = w.Write([]byte(`{"error":"` + test.message + `"}`))
				default:
					t.Errorf("unexpected provider request: %s", r.URL.Path)
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			defer clearEvolutionQRCodeRecovery(server.URL + "|" + instanceKey)
			client := functionsClient{evolutionGoAPIURL: server.URL, evolutionGoAPIKey: "synthetic-key", httpClient: server.Client()}
			result, err := client.invokeEvolutionDirect(context.Background(), "instance.qr", map[string]any{
				"instance_id": instanceKey, "token": "synthetic-token",
			})
			if forceRequests != 1 {
				t.Fatalf("force reconnect requests = %d, want 1", forceRequests)
			}
			if test.qrAllowed {
				if err != nil || !providerResultOK(result) || firstString(result, "data.qrcode") == "" || qrRequests != 3 {
					t.Fatalf("definitive stale recovery result=%#v error=%v QR requests=%d, want successful final QR", result, err, qrRequests)
				}
				return
			}
			if !errors.Is(err, ErrProviderFailed) || errors.Is(err, ErrProviderOutcomeUnknown) != test.unknown {
				t.Fatalf("HTTP %d recovery error = %v, want failed with unknown=%v", test.status, err, test.unknown)
			}
			if qrRequests != 2 {
				t.Fatalf("QR requests = %d, want 2 without another read after rejected or ambiguous mutation", qrRequests)
			}
		})
	}
}
