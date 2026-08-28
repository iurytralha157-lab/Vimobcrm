package settings

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxAsaasSubscriptionResponseBody = 1 << 20

type asaasSubscriptionClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

type asaasPlanChangeInput struct {
	Amount      float64
	Cycle       string
	Description string
}

type asaasSubscriptionSnapshot struct {
	ID          string  `json:"id"`
	Value       float64 `json:"value"`
	Cycle       string  `json:"cycle"`
	Description string  `json:"description"`
	NextDueDate string  `json:"nextDueDate"`
	Status      string  `json:"status"`
	raw         json.RawMessage
}

type asaasHTTPError struct {
	statusCode int
	status     string
	payload    string
}

func (err *asaasHTTPError) Error() string {
	if strings.TrimSpace(err.payload) == "" {
		return fmt.Sprintf("Asaas returned %s", err.status)
	}
	return fmt.Sprintf("Asaas returned %s: %s", err.status, err.payload)
}

func newAsaasSubscriptionClient(config ExternalConfig) asaasSubscriptionClient {
	timeout := config.AsaasRequestTimeout
	if timeout <= 0 || timeout > time.Minute {
		timeout = 10 * time.Second
	}

	return asaasSubscriptionClient{
		baseURL:    strings.TrimRight(strings.TrimSpace(config.AsaasURL), "/"),
		apiKey:     strings.TrimSpace(config.AsaasAPIKey),
		httpClient: &http.Client{Timeout: timeout},
	}
}

func (client asaasSubscriptionClient) isConfigured() bool {
	return client.baseURL != "" && client.apiKey != "" && client.httpClient != nil
}

// schedulePlanChange updates the existing provider subscription. Ambiguous
// transport/5xx responses are recovered with a provider read and one
// idempotent retry of the exact same PUT payload.
func (client asaasSubscriptionClient) schedulePlanChange(
	ctx context.Context,
	subscriptionID string,
	input asaasPlanChangeInput,
) (asaasSubscriptionSnapshot, error) {
	subscriptionID = strings.TrimSpace(subscriptionID)
	input.Cycle = strings.ToUpper(strings.TrimSpace(input.Cycle))
	if !client.isConfigured() {
		return asaasSubscriptionSnapshot{}, ErrAsaasNotConfigured
	}
	if subscriptionID == "" || input.Amount <= 0 || input.Cycle == "" {
		return asaasSubscriptionSnapshot{}, ErrInvalidInput
	}

	snapshot, err := client.updateSubscription(ctx, subscriptionID, input)
	if err == nil && snapshot.matches(subscriptionID, input) {
		return snapshot, nil
	}
	if isDefinitiveAsaasError(err) {
		return asaasSubscriptionSnapshot{}, fmt.Errorf("%w: %v", ErrAsaasOperation, err)
	}

	if recovered, readErr := client.getSubscription(ctx, subscriptionID); readErr == nil && recovered.matches(subscriptionID, input) {
		return recovered, nil
	}

	snapshot, retryErr := client.updateSubscription(ctx, subscriptionID, input)
	if retryErr == nil && snapshot.matches(subscriptionID, input) {
		return snapshot, nil
	}
	if isDefinitiveAsaasError(retryErr) {
		return asaasSubscriptionSnapshot{}, fmt.Errorf("%w: %v", ErrAsaasOperation, retryErr)
	}

	if recovered, readErr := client.getSubscription(ctx, subscriptionID); readErr == nil && recovered.matches(subscriptionID, input) {
		return recovered, nil
	}

	return asaasSubscriptionSnapshot{}, ErrAsaasAmbiguous
}

// recoverPlanChange is used when the durable row already existed before this
// request (for example, after a process crash between provider acceptance and
// the local scheduled update). It reads first, so an accepted PUT is not sent
// again unnecessarily.
func (client asaasSubscriptionClient) recoverPlanChange(
	ctx context.Context,
	subscriptionID string,
	input asaasPlanChangeInput,
) (asaasSubscriptionSnapshot, error) {
	if !client.isConfigured() {
		return asaasSubscriptionSnapshot{}, ErrAsaasNotConfigured
	}
	if recovered, err := client.getSubscription(ctx, subscriptionID); err == nil && recovered.matches(subscriptionID, input) {
		return recovered, nil
	}
	return client.schedulePlanChange(ctx, subscriptionID, input)
}

func (client asaasSubscriptionClient) updateSubscription(
	ctx context.Context,
	subscriptionID string,
	input asaasPlanChangeInput,
) (asaasSubscriptionSnapshot, error) {
	payload, err := json.Marshal(map[string]any{
		"value":                 input.Amount,
		"cycle":                 input.Cycle,
		"description":           strings.TrimSpace(input.Description),
		"updatePendingPayments": false,
	})
	if err != nil {
		return asaasSubscriptionSnapshot{}, err
	}

	return client.doSubscriptionRequest(
		ctx,
		http.MethodPut,
		subscriptionID,
		bytes.NewReader(payload),
	)
}

func (client asaasSubscriptionClient) getSubscription(
	ctx context.Context,
	subscriptionID string,
) (asaasSubscriptionSnapshot, error) {
	return client.doSubscriptionRequest(ctx, http.MethodGet, subscriptionID, nil)
}

func (client asaasSubscriptionClient) doSubscriptionRequest(
	ctx context.Context,
	method string,
	subscriptionID string,
	body io.Reader,
) (asaasSubscriptionSnapshot, error) {
	endpoint := fmt.Sprintf("%s/subscriptions/%s", client.baseURL, url.PathEscape(subscriptionID))
	request, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return asaasSubscriptionSnapshot{}, err
	}
	request.Header.Set("access_token", client.apiKey)
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "Vimob-CRM/1.0")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}

	response, err := client.httpClient.Do(request)
	if err != nil {
		return asaasSubscriptionSnapshot{}, err
	}
	defer response.Body.Close()

	payload, readErr := io.ReadAll(io.LimitReader(response.Body, maxAsaasSubscriptionResponseBody))
	if readErr != nil {
		return asaasSubscriptionSnapshot{}, readErr
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return asaasSubscriptionSnapshot{}, &asaasHTTPError{
			statusCode: response.StatusCode,
			status:     response.Status,
			payload:    strings.TrimSpace(string(payload)),
		}
	}

	var snapshot asaasSubscriptionSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		return asaasSubscriptionSnapshot{}, err
	}
	snapshot.raw = append(json.RawMessage(nil), payload...)
	return snapshot, nil
}

func (snapshot asaasSubscriptionSnapshot) matches(
	subscriptionID string,
	input asaasPlanChangeInput,
) bool {
	return strings.EqualFold(strings.TrimSpace(snapshot.ID), strings.TrimSpace(subscriptionID)) &&
		math.Abs(snapshot.Value-input.Amount) < 0.005 &&
		strings.EqualFold(strings.TrimSpace(snapshot.Cycle), strings.TrimSpace(input.Cycle))
}

func (snapshot asaasSubscriptionSnapshot) rawJSON() json.RawMessage {
	if len(snapshot.raw) > 0 && json.Valid(snapshot.raw) {
		return snapshot.raw
	}
	payload, _ := json.Marshal(snapshot)
	return payload
}

func isDefinitiveAsaasError(err error) bool {
	if err == nil {
		return false
	}
	var httpErr *asaasHTTPError
	if !errors.As(err, &httpErr) || httpErr.statusCode < 400 || httpErr.statusCode >= 500 {
		return false
	}
	switch httpErr.statusCode {
	case http.StatusRequestTimeout,
		http.StatusConflict,
		http.StatusTooEarly,
		http.StatusTooManyRequests:
		return false
	default:
		return true
	}
}
