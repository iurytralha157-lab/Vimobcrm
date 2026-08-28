package settings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strings"
)

// asaasPaymentSnapshot contains only the provider fields needed to reconcile
// an already-known payment. Hosted invoice URLs and settlement fees are not
// decoded because neither belongs in the customer-facing Settings API.
type asaasPaymentSnapshot struct {
	ID             string   `json:"id"`
	CustomerID     string   `json:"customer"`
	SubscriptionID string   `json:"subscription"`
	BillingType    string   `json:"billingType"`
	Status         string   `json:"status"`
	Value          *float64 `json:"value"`
	DueDate        string   `json:"dueDate"`
	PaymentDate    string   `json:"paymentDate"`
	Deleted        bool     `json:"deleted"`
}

func (client asaasSubscriptionClient) getPayment(
	ctx context.Context,
	paymentID string,
) (asaasPaymentSnapshot, error) {
	paymentID = strings.TrimSpace(paymentID)
	if !client.isConfigured() {
		return asaasPaymentSnapshot{}, ErrAsaasNotConfigured
	}
	if paymentID == "" {
		return asaasPaymentSnapshot{}, ErrInvalidInput
	}

	endpoint := fmt.Sprintf("%s/payments/%s", client.baseURL, url.PathEscape(paymentID))
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return asaasPaymentSnapshot{}, err
	}
	request.Header.Set("access_token", client.apiKey)
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "Vimob-CRM/1.0")

	response, err := client.httpClient.Do(request)
	if err != nil {
		return asaasPaymentSnapshot{}, err
	}
	defer response.Body.Close()

	payload, readErr := io.ReadAll(io.LimitReader(response.Body, maxAsaasSubscriptionResponseBody))
	if readErr != nil {
		return asaasPaymentSnapshot{}, readErr
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return asaasPaymentSnapshot{}, &asaasHTTPError{
			statusCode: response.StatusCode,
			status:     response.Status,
			payload:    strings.TrimSpace(string(payload)),
		}
	}

	var snapshot asaasPaymentSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		return asaasPaymentSnapshot{}, err
	}
	return snapshot, nil
}

func (snapshot asaasPaymentSnapshot) normalizedStatus() string {
	if snapshot.Deleted {
		return "DELETED"
	}
	return strings.ToUpper(strings.TrimSpace(snapshot.Status))
}

func isAsaasPaymentNotFound(err error) bool {
	var httpErr *asaasHTTPError
	return errors.As(err, &httpErr) && httpErr.statusCode == http.StatusNotFound
}

func validateAsaasPaymentIdentity(
	snapshot asaasPaymentSnapshot,
	paymentID string,
	customerID string,
	subscriptionID string,
) error {
	if strings.TrimSpace(snapshot.ID) == "" ||
		strings.TrimSpace(snapshot.ID) != strings.TrimSpace(paymentID) {
		return ErrPaymentProviderMismatch
	}

	if expected := strings.TrimSpace(customerID); expected != "" {
		actual := strings.TrimSpace(snapshot.CustomerID)
		if actual == "" && !snapshot.Deleted {
			return ErrPaymentProviderMismatch
		}
		if actual != "" && actual != expected {
			return ErrPaymentProviderMismatch
		}
	}

	if expected := strings.TrimSpace(subscriptionID); expected != "" {
		actual := strings.TrimSpace(snapshot.SubscriptionID)
		if actual == "" && !snapshot.Deleted {
			return ErrPaymentProviderMismatch
		}
		if actual != "" && actual != expected {
			return ErrPaymentProviderMismatch
		}
	}

	return nil
}

func validateAsaasPaymentSnapshot(snapshot asaasPaymentSnapshot, local localPaymentIdentity) error {
	if err := validateAsaasPaymentIdentity(
		snapshot,
		local.AsaasPaymentID,
		local.AsaasCustomerID,
		local.AsaasSubscriptionID,
	); err != nil {
		return err
	}
	if snapshot.Deleted {
		// Asaas may omit the immutable commercial fields from a deleted object.
		// The exact provider ID above is sufficient to record only the terminal
		// deletion; local amount/date/customer values are never replaced by blanks.
		return nil
	}

	if strings.TrimSpace(local.AsaasCustomerID) == "" ||
		strings.TrimSpace(snapshot.CustomerID) != strings.TrimSpace(local.AsaasCustomerID) ||
		strings.TrimSpace(snapshot.SubscriptionID) != strings.TrimSpace(local.AsaasSubscriptionID) ||
		strings.ToUpper(strings.TrimSpace(snapshot.BillingType)) != strings.ToUpper(strings.TrimSpace(local.BillingType)) ||
		snapshot.Value == nil ||
		math.Round(*snapshot.Value*100) != math.Round(local.Value*100) ||
		strings.TrimSpace(snapshot.DueDate) == "" ||
		strings.TrimSpace(snapshot.DueDate) != strings.TrimSpace(local.DueDate) {
		return ErrPaymentProviderMismatch
	}

	return nil
}
