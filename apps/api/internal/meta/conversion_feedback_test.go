package meta

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const (
	conversionFeedbackTestDatasetID = "123456789012345"
	conversionFeedbackTestLeadID    = "987654321098765"
	conversionFeedbackTestToken     = "dataset-token-SENSITIVE"
	conversionFeedbackTestSecret    = "app-secret-SENSITIVE"
)

func TestSendConversionFeedbackEventUsesNumericLeadIDAndServerSideCredentials(t *testing.T) {
	t.Parallel()

	eventTime := time.Date(2026, time.August, 1, 13, 45, 12, 0, time.UTC)
	eventID := "vimob:lead:qualified:550e8400-e29b-41d4-a716-446655440000"
	wantProof := oauthAppSecretProof(conversionFeedbackTestSecret, conversionFeedbackTestToken)

	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			t.Errorf("method = %s, want POST", request.Method)
		}
		if request.URL.Path != "/v25.0/"+conversionFeedbackTestDatasetID+"/events" {
			t.Errorf("path = %s", request.URL.Path)
		}
		if strings.Contains(request.URL.String(), conversionFeedbackTestToken) || request.URL.Query().Get("access_token") != "" {
			t.Errorf("access token leaked into request URL: %s", request.URL.Redacted())
		}
		if got := request.URL.Query().Get("appsecret_proof"); got != wantProof {
			t.Errorf("appsecret_proof = %q, want %q", got, wantProof)
		}
		if got := request.Header.Get("Authorization"); got != "Bearer "+conversionFeedbackTestToken {
			t.Errorf("Authorization = %q", got)
		}
		if got := request.Header.Get("Content-Type"); got != "application/json" {
			t.Errorf("Content-Type = %q", got)
		}

		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}
		if strings.Contains(string(body), conversionFeedbackTestToken) || strings.Contains(string(body), conversionFeedbackTestSecret) {
			t.Fatal("request body contains a credential")
		}

		var payload map[string]any
		decoder := json.NewDecoder(strings.NewReader(string(body)))
		decoder.UseNumber()
		if err := decoder.Decode(&payload); err != nil {
			t.Fatalf("decode request payload: %v", err)
		}
		if got := payload["test_event_code"]; got != "TEST-CRM-123" {
			t.Errorf("test_event_code = %#v", got)
		}
		if got := payload["partner_agent"]; got != "vimob_crm_test" {
			t.Errorf("partner_agent = %#v", got)
		}

		data, ok := payload["data"].([]any)
		if !ok || len(data) != 1 {
			t.Fatalf("data = %#v", payload["data"])
		}
		event, ok := data[0].(map[string]any)
		if !ok {
			t.Fatalf("event = %#v", data[0])
		}
		if event["event_name"] != "VimobQualifiedLead" || event["event_id"] != eventID {
			t.Errorf("event identity = %#v", event)
		}
		if event["event_time"] != json.Number("1785591912") {
			t.Errorf("event_time = %#v", event["event_time"])
		}
		if event["action_source"] != "system_generated" {
			t.Errorf("action_source = %#v", event["action_source"])
		}

		userData, ok := event["user_data"].(map[string]any)
		if !ok {
			t.Fatalf("user_data = %#v", event["user_data"])
		}
		leadID, ok := userData["lead_id"].(json.Number)
		if !ok {
			t.Fatalf("lead_id type = %T, want json.Number", userData["lead_id"])
		}
		if leadID.String() != conversionFeedbackTestLeadID {
			t.Errorf("lead_id = %s", leadID)
		}
		assertConversionFeedbackHash(t, userData, "em", "test@example.com")
		assertConversionFeedbackHash(t, userData, "ph", "5511987654321")

		customData, ok := event["custom_data"].(map[string]any)
		if !ok {
			t.Fatalf("custom_data = %#v", event["custom_data"])
		}
		if customData["lead_event_source"] != "Vimob CRM" || customData["event_source"] != "crm" {
			t.Errorf("custom_data = %#v", customData)
		}

		response.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(response, `{"events_received":1,"fbtrace_id":"trace-1"}`)
	}))
	defer server.Close()

	repo := Repository{
		config: Config{
			AppSecret:                               conversionFeedbackTestSecret,
			GraphVersion:                            "v25.0",
			GraphBaseURL:                            server.URL,
			ConversionFeedbackPartnerAgent:          "vimob_crm_test",
			ConversionFeedbackAppSecretProofEnabled: true,
		},
		client: server.Client(),
	}
	delivery := conversionFeedbackDelivery{
		Job: conversionFeedbackJob{
			DatasetID:     conversionFeedbackTestDatasetID,
			LeadgenID:     conversionFeedbackTestLeadID,
			EventName:     "VimobQualifiedLead",
			EventID:       eventID,
			EventTime:     eventTime,
			TestEventCode: "TEST-CRM-123",
		},
		AccessToken: conversionFeedbackTestToken,
		Email:       "  Test@Example.COM ",
		Phone:       "+55 (11) 98765-4321",
	}

	result, err := repo.sendConversionFeedbackEvent(context.Background(), delivery)
	if err != nil {
		t.Fatalf("sendConversionFeedbackEvent() error = %v", err)
	}
	if result.EventsReceived != 1 || result.TraceID != "trace-1" {
		t.Fatalf("result = %#v", result)
	}
}

func TestSendConversionFeedbackEventRejectsLeadIDOutsideOfficialLength(t *testing.T) {
	t.Parallel()

	repo := Repository{}
	_, err := repo.sendConversionFeedbackEvent(context.Background(), conversionFeedbackDelivery{
		Job: conversionFeedbackJob{
			DatasetID: conversionFeedbackTestDatasetID,
			LeadgenID: "123456789012345678",
			EventName: "VimobQualifiedLead",
			EventID:   "vimob:test:invalid-lead-id",
			EventTime: time.Now().UTC(),
		},
		AccessToken: conversionFeedbackTestToken,
	})

	var feedbackErr *conversionFeedbackError
	if !errors.As(err, &feedbackErr) || feedbackErr.Code != "invalid_lead_id" || feedbackErr.Retryable {
		t.Fatalf("invalid lead ID error = %#v", err)
	}
}

func TestSendConversionFeedbackEventSupportsManualDatasetTokenWithoutAppSecretProof(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Query().Get("appsecret_proof") != "" {
			t.Fatal("manual CRM Dataset token must not receive proof from an unrelated app")
		}
		if got := request.Header.Get("Authorization"); got != "Bearer "+conversionFeedbackTestToken {
			t.Fatalf("Authorization = %q", got)
		}
		var payload map[string]any
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request payload: %v", err)
		}
		if _, exists := payload["test_event_code"]; exists {
			t.Fatalf("ordinary delivery inherited a test_event_code: %#v", payload["test_event_code"])
		}
		if _, exists := payload["partner_agent"]; exists {
			t.Fatalf("unapproved partner_agent must be omitted: %#v", payload["partner_agent"])
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(response, `{"events_received":1,"fbtrace_id":"manual-token-trace"}`)
	}))
	defer server.Close()

	repo := Repository{
		config: Config{
			GraphVersion: "v25.0",
			GraphBaseURL: server.URL,
		},
		client: server.Client(),
	}
	result, err := repo.sendConversionFeedbackEvent(context.Background(), validConversionFeedbackDelivery())
	if err != nil {
		t.Fatalf("sendConversionFeedbackEvent() error = %v", err)
	}
	if result.EventsReceived != 1 || result.TraceID != "manual-token-trace" {
		t.Fatalf("result = %#v", result)
	}
}

func TestSendConversionFeedbackEventClassifiesProviderFailures(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		status        int
		body          string
		retryAfter    string
		wantRetryable bool
		wantCode      string
		wantDelay     time.Duration
	}{
		{
			name:          "rate limit",
			status:        http.StatusTooManyRequests,
			body:          `{"error":{"message":"rate limited","code":4,"fbtrace_id":"rate-trace"}}`,
			wantRetryable: true,
			wantCode:      "4",
		},
		{
			name:          "graph rate limit over bad request",
			status:        http.StatusBadRequest,
			body:          `{"error":{"message":"application request limit reached","code":613,"fbtrace_id":"rate-trace"}}`,
			retryAfter:    "600",
			wantRetryable: true,
			wantCode:      "613",
			wantDelay:     10 * time.Minute,
		},
		{
			name:          "server error",
			status:        http.StatusBadGateway,
			body:          `{"error":{"message":"upstream unavailable","code":2,"fbtrace_id":"server-trace"}}`,
			wantRetryable: true,
			wantCode:      "2",
		},
		{
			name:          "invalid parameter",
			status:        http.StatusBadRequest,
			body:          `{"error":{"message":"invalid parameter","code":100,"error_subcode":2804019,"fbtrace_id":"bad-trace"}}`,
			wantRetryable: false,
			wantCode:      "100/2804019",
		},
		{
			name:          "provider marks transient",
			status:        http.StatusBadRequest,
			body:          `{"error":{"message":"temporary condition","code":1,"is_transient":true}}`,
			wantRetryable: true,
			wantCode:      "1",
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				if test.retryAfter != "" {
					response.Header().Set("Retry-After", test.retryAfter)
				}
				response.WriteHeader(test.status)
				_, _ = io.WriteString(response, test.body)
			}))
			defer server.Close()

			repo := Repository{
				config: Config{
					AppSecret:    conversionFeedbackTestSecret,
					GraphVersion: "v25.0",
					GraphBaseURL: server.URL,
				},
				client: server.Client(),
			}
			_, err := repo.sendConversionFeedbackEvent(context.Background(), validConversionFeedbackDelivery())
			if err == nil {
				t.Fatal("sendConversionFeedbackEvent() error = nil")
			}
			var providerErr *conversionFeedbackError
			if !errors.As(err, &providerErr) {
				t.Fatalf("error type = %T, want *conversionFeedbackError", err)
			}
			if providerErr.Retryable != test.wantRetryable || providerErr.Code != test.wantCode {
				t.Errorf("provider error = %#v", providerErr)
			}
			if providerErr.RetryAfter != test.wantDelay {
				t.Errorf("retry delay = %s, want %s", providerErr.RetryAfter, test.wantDelay)
			}
		})
	}
}

func TestSendConversionFeedbackEventRedactsNetworkFailure(t *testing.T) {
	t.Parallel()

	proof := oauthAppSecretProof(conversionFeedbackTestSecret, conversionFeedbackTestToken)
	repo := Repository{
		config: Config{
			AppSecret:                               conversionFeedbackTestSecret,
			GraphVersion:                            "v25.0",
			GraphBaseURL:                            "https://graph.invalid",
			ConversionFeedbackAppSecretProofEnabled: true,
		},
		client: &http.Client{Transport: conversionFeedbackRoundTripFunc(func(*http.Request) (*http.Response, error) {
			return nil, errors.New("dial failed with " + conversionFeedbackTestToken + " and " + proof)
		})},
	}

	_, err := repo.sendConversionFeedbackEvent(context.Background(), validConversionFeedbackDelivery())
	if err == nil {
		t.Fatal("sendConversionFeedbackEvent() error = nil")
	}
	var providerErr *conversionFeedbackError
	if !errors.As(err, &providerErr) || !providerErr.Retryable || providerErr.Code != "network_error" {
		t.Fatalf("provider error = %#v", providerErr)
	}
	if strings.Contains(err.Error(), conversionFeedbackTestToken) || strings.Contains(err.Error(), proof) {
		t.Fatalf("credential leaked into error: %v", err)
	}
}

func TestConversionFeedbackRetryDelayIsDeterministicAndBounded(t *testing.T) {
	t.Parallel()

	first := conversionFeedbackRetryDelay("event-123", 3)
	second := conversionFeedbackRetryDelay("event-123", 3)
	if first != second {
		t.Fatalf("retry delay is not deterministic: %s != %s", first, second)
	}
	if first < 20*time.Second || first > 24*time.Second {
		t.Fatalf("retry delay = %s, want [20s, 24s]", first)
	}
	if next := conversionFeedbackRetryDelay("event-123", 4); next < 40*time.Second || next > 48*time.Second {
		t.Fatalf("next retry delay = %s, want [40s, 48s]", next)
	}

	var horizon time.Duration
	for attempt := 1; attempt < 20; attempt++ {
		horizon += conversionFeedbackRetryDelay("event-123", attempt)
	}
	if horizon < 5*24*time.Hour || horizon >= 7*24*time.Hour {
		t.Fatalf("20-attempt retry horizon = %s, want [5d, 7d)", horizon)
	}
}

func TestValidateConversionFeedbackEligibilityRechecksMutableState(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 1, 15, 0, 0, 0, time.UTC)
	job := validConversionFeedbackDelivery().Job
	job.IntegrationID = "integration-1"
	job.EventTime = now.Add(-time.Hour)

	tests := []struct {
		name             string
		campaignsEnabled bool
		integrationID    string
		connected        bool
		feedbackEnabled  bool
		feedbackStatus   string
		datasetID        string
		token            string
		wantCode         string
	}{
		{"module disabled", false, "integration-1", true, true, "active", job.DatasetID, "token", "campaigns_module_disabled"},
		{"integration changed", true, "integration-2", true, true, "active", job.DatasetID, "token", "integration_missing"},
		{"disconnected", true, "integration-1", false, true, "active", job.DatasetID, "token", "integration_disconnected"},
		{"feedback disabled", true, "integration-1", true, false, "active", job.DatasetID, "token", "feedback_disabled"},
		{"feedback paused", true, "integration-1", true, true, "paused", job.DatasetID, "token", "feedback_not_active"},
		{"dataset changed", true, "integration-1", true, true, "active", "111112222233333", "token", "dataset_changed"},
		{"token missing", true, "integration-1", true, true, "active", job.DatasetID, " ", "dataset_token_missing"},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			err := validateConversionFeedbackEligibility(
				job,
				test.campaignsEnabled,
				test.integrationID,
				test.connected,
				test.feedbackEnabled,
				test.feedbackStatus,
				test.datasetID,
				test.token,
				now,
			)
			var eligibilityErr *conversionFeedbackEligibilityError
			if !errors.As(err, &eligibilityErr) || eligibilityErr.Code != test.wantCode {
				t.Fatalf("error = %#v, want code %q", err, test.wantCode)
			}
		})
	}

	expired := job
	expired.EventTime = now.Add(-conversionFeedbackMaximumAge - time.Second)
	err := validateConversionFeedbackEligibility(expired, true, "integration-1", true, true, "active", job.DatasetID, "token", now)
	var eligibilityErr *conversionFeedbackEligibilityError
	if !errors.As(err, &eligibilityErr) || eligibilityErr.Code != "event_expired" {
		t.Fatalf("expired error = %#v", err)
	}
	if eligibilityErr.IntegrationStatus != "" {
		t.Fatalf("expired event must not disable the integration, got status %q", eligibilityErr.IntegrationStatus)
	}

	_, _, _, _, integrationStatus := conversionFeedbackFailure(
		permanentConversionFeedbackError("invalid_event", "one malformed event"),
	)
	if integrationStatus != "" {
		t.Fatalf("one permanent event failure must not disable the integration, got status %q", integrationStatus)
	}

	_, _, _, _, integrationStatus = conversionFeedbackFailure(
		&conversionFeedbackEligibilityError{
			Code:    "campaigns_module_disabled",
			Message: "Marketing module is no longer enabled",
		},
	)
	if integrationStatus != "" {
		t.Fatalf("module access must not pause a reusable integration, got status %q", integrationStatus)
	}
}

type conversionFeedbackRoundTripFunc func(*http.Request) (*http.Response, error)

func (roundTrip conversionFeedbackRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return roundTrip(request)
}

func validConversionFeedbackDelivery() conversionFeedbackDelivery {
	return conversionFeedbackDelivery{
		Job: conversionFeedbackJob{
			DatasetID: conversionFeedbackTestDatasetID,
			LeadgenID: conversionFeedbackTestLeadID,
			EventName: "VimobConvertedLead",
			EventID:   "vimob:lead:converted:test",
			EventTime: time.Now().UTC(),
		},
		AccessToken: conversionFeedbackTestToken,
	}
}

func assertConversionFeedbackHash(t *testing.T, userData map[string]any, field string, normalized string) {
	t.Helper()

	values, ok := userData[field].([]any)
	if !ok || len(values) != 1 {
		t.Fatalf("%s = %#v", field, userData[field])
	}
	digest := sha256.Sum256([]byte(normalized))
	want := hex.EncodeToString(digest[:])
	if values[0] != want {
		t.Errorf("%s hash = %#v, want %q", field, values[0], want)
	}
}
