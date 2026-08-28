package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestInvokeFunctionRequestForwardsOnlyValidatedClientIP(t *testing.T) {
	const signingSecret = "vimob-edge-client-ip-signing-secret-for-tests"
	tests := []struct {
		name     string
		clientIP string
		want     string
	}{
		{name: "valid IPv4", clientIP: "203.0.113.9", want: "203.0.113.9"},
		{name: "valid IPv6", clientIP: "2001:db8::9", want: "2001:db8::9"},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
				if got := request.Header.Get("X-Forwarded-For"); got != "" {
					t.Fatalf("raw X-Forwarded-For must not be forwarded, got %q", got)
				}
				if got := request.Header.Get("X-Vimob-Client-IP"); got != testCase.want {
					t.Fatalf("X-Vimob-Client-IP = %q, want %q", got, testCase.want)
				}
				if testCase.want != "" {
					timestamp := request.Header.Get("X-Vimob-Client-IP-Timestamp")
					signedAt := time.Unix(mustParseInt64(t, timestamp), 0).UTC()
					expectedTimestamp, expectedSignature, ok := signedEdgeClientIPHeaders(
						signingSecret,
						request.Method,
						request.URL.EscapedPath(),
						testCase.want,
						[]byte(`{}`),
						signedAt,
					)
					if !ok || timestamp != expectedTimestamp || request.Header.Get("X-Vimob-Client-IP-Signature") != expectedSignature {
						t.Fatal("signed client IP headers are invalid")
					}
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"success":true}`))
			}))
			defer server.Close()

			repository := NewRepository(nil, ExternalConfig{
				ProjectURL:            server.URL,
				ClientIPSigningSecret: signingSecret,
			})
			response, err := repository.InvokeFunctionRequest(
				context.Background(),
				"asaas-create-charge",
				http.MethodPost,
				"",
				[]byte(`{}`),
				nil,
				testCase.clientIP,
			)
			if err != nil {
				t.Fatalf("InvokeFunctionRequest() error = %v", err)
			}
			if response.StatusCode != http.StatusOK {
				t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusOK)
			}
		})
	}
}

func mustParseInt64(t *testing.T, value string) int64 {
	t.Helper()
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		t.Fatalf("invalid integer %q: %v", value, err)
	}
	return parsed
}

func TestCreateChargeRefusesUnsignedValidatedClientIP(t *testing.T) {
	repository := NewRepository(nil, ExternalConfig{ProjectURL: "https://project.test"})
	_, err := repository.InvokeFunctionRequest(
		context.Background(),
		"asaas-create-charge",
		http.MethodPost,
		"",
		[]byte(`{}`),
		nil,
		"203.0.113.9",
	)
	if !errors.Is(err, ErrBillingCheckoutUnavailable) {
		t.Fatalf("error = %v, want ErrBillingCheckoutUnavailable", err)
	}
}

func TestCreateChargeWithUnknownClientIPReturns503WithoutCallingEdge(t *testing.T) {
	edgeCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		edgeCalls++
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	handler := NewHandler(NewRepository(nil, ExternalConfig{
		ProjectURL:            server.URL,
		ClientIPSigningSecret: "vimob-edge-client-ip-signing-secret-for-tests",
	}))
	request := httptest.NewRequest(http.MethodPost, "/v1/public/billing/charge", strings.NewReader(`{}`))
	request.RemoteAddr = "unknown"
	response := httptest.NewRecorder()

	handler.PublicCreateCharge(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusServiceUnavailable, response.Body.String())
	}
	if edgeCalls != 0 {
		t.Fatalf("Edge calls = %d, want 0", edgeCalls)
	}
}

func TestReadJSONBodyAlwaysOverridesOrganization(t *testing.T) {
	request := httptest.NewRequest(
		"POST",
		"/v1/integrations/functions/asaas-create-charge",
		strings.NewReader(`{"organization_id":"00000000-0000-0000-0000-000000000099","organizationId":"00000000-0000-0000-0000-000000000099"}`),
	)

	body, err := readJSONBodyWithOrganization(request, "00000000-0000-0000-0000-000000000001")
	if err != nil {
		t.Fatalf("readJSONBodyWithOrganization() error = %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}

	for _, key := range []string{"organization_id", "organizationId"} {
		if got := payload[key]; got != "00000000-0000-0000-0000-000000000001" {
			t.Fatalf("payload[%q] = %v, want tenant organization", key, got)
		}
	}
}

func TestAllowedFunctionAllowsGoogleCalendar(t *testing.T) {
	for _, name := range []string{"google-calendar-oauth", "google-calendar-sync"} {
		if !allowedFunction(name) {
			t.Fatalf("allowedFunction(%q) = false, want true", name)
		}
	}
}

func TestAllowedFunctionRejectsRetiredMetaEdgeFunctions(t *testing.T) {
	for _, name := range []string{
		"meta-oauth",
		"instagram-oauth",
		"meta-campaign-insights",
		"meta-messenger-proxy",
		"meta-webhook",
		"meta-token-healthcheck",
		"meta-webhook-replay",
	} {
		if allowedFunction(name) {
			t.Fatalf("allowedFunction(%q) = true; Meta must use the native Go routes", name)
		}
	}
}

func TestPublicBillingProxyResponsesAreNeverCacheable(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true}`))
	}))
	defer upstream.Close()

	handler := NewHandler(NewRepository(nil, ExternalConfig{ProjectURL: upstream.URL}))
	tests := []struct {
		name   string
		method string
		invoke func(http.ResponseWriter, *http.Request)
	}{
		{name: "checkout info", method: http.MethodGet, invoke: handler.PublicCheckoutInfo},
		{name: "payment status", method: http.MethodGet, invoke: handler.PublicPaymentStatus},
		{name: "create charge", method: http.MethodPost, invoke: handler.PublicCreateCharge},
		{name: "cancel payment", method: http.MethodPost, invoke: handler.PublicCancelPayment},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			request := httptest.NewRequest(testCase.method, "/billing", strings.NewReader(`{}`))
			response := httptest.NewRecorder()
			testCase.invoke(response, request)

			if got := response.Header().Get("Cache-Control"); got != "private, no-store, max-age=0" {
				t.Fatalf("Cache-Control = %q", got)
			}
			if got := response.Header().Get("Pragma"); got != "no-cache" {
				t.Fatalf("Pragma = %q", got)
			}
			if got := response.Header().Get("Vary"); got != "Authorization" {
				t.Fatalf("Vary = %q", got)
			}
		})
	}
}
