package billing

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSelectRelevantPaymentPrefersLatestDueInvoice(t *testing.T) {
	now := time.Date(2026, time.July, 28, 15, 0, 0, 0, time.UTC)
	payment := selectRelevantPayment([]providerPayment{
		{ID: "future", Status: "PENDING", DueDate: "2026-08-28"},
		{ID: "old", Status: "CONFIRMED", DueDate: "2026-06-28"},
		{ID: "current", Status: "OVERDUE", DueDate: "2026-07-28"},
	}, now)

	if payment == nil || payment.ID != "current" {
		t.Fatalf("payment = %#v, want current due invoice", payment)
	}
}

func TestSelectRelevantPaymentUsesNearestFutureInvoice(t *testing.T) {
	now := time.Date(2026, time.July, 28, 15, 0, 0, 0, time.UTC)
	payment := selectRelevantPayment([]providerPayment{
		{ID: "later", Status: "PENDING", DueDate: "2026-09-28"},
		{ID: "next", Status: "PENDING", DueDate: "2026-08-28"},
	}, now)

	if payment == nil || payment.ID != "next" {
		t.Fatalf("payment = %#v, want nearest future invoice", payment)
	}
}

func TestSelectRelevantPaymentNeverHidesOlderDebtBehindCurrentInvoice(t *testing.T) {
	now := time.Date(2026, time.July, 28, 15, 0, 0, 0, time.UTC)
	for _, currentStatus := range []string{"PENDING", "CONFIRMED"} {
		t.Run(currentStatus, func(t *testing.T) {
			payment := selectRelevantPayment([]providerPayment{
				{ID: "old-debt", Status: "OVERDUE", DueDate: "2026-06-28"},
				{ID: "current", Status: currentStatus, DueDate: "2026-07-28"},
			}, now)

			if payment == nil || payment.ID != "old-debt" {
				t.Fatalf("payment = %#v, want older overdue invoice", payment)
			}
		})
	}
}

func TestSelectRelevantPaymentPrioritizesEveryBlockingProviderStatus(t *testing.T) {
	now := time.Date(2026, time.July, 28, 15, 0, 0, 0, time.UTC)
	statuses := []string{
		"DUNNING_REQUESTED",
		"DUNNING_RECEIVED",
		"CREDIT_CARD_CAPTURE_REFUSED",
		"REPROVED_BY_RISK_ANALYSIS",
		"REFUNDED",
		"REFUND_REQUESTED",
		"REFUND_IN_PROGRESS",
		"PARTIALLY_REFUNDED",
		"RECEIVED_IN_CASH_UNDONE",
		"CHARGEBACK",
		"CHARGEBACK_REQUESTED",
		"CHARGEBACK_DISPUTE",
		"AWAITING_CHARGEBACK_REVERSAL",
	}
	for _, status := range statuses {
		t.Run(status, func(t *testing.T) {
			payment := selectRelevantPayment([]providerPayment{
				{ID: "adverse", Status: status, DueDate: "2026-06-28"},
				{ID: "current", Status: "CONFIRMED", DueDate: "2026-07-28"},
			}, now)

			if payment == nil || payment.ID != "adverse" {
				t.Fatalf("payment = %#v, want adverse invoice", payment)
			}
		})
	}
}

func TestSelectRelevantPaymentNeverHidesReversalBehindNewerDelinquency(t *testing.T) {
	now := time.Date(2026, time.July, 28, 15, 0, 0, 0, time.UTC)
	for _, reversalStatus := range []string{
		"REFUNDED",
		"REFUND_IN_PROGRESS",
		"PARTIALLY_REFUNDED",
		"CHARGEBACK",
		"CHARGEBACK_REQUESTED",
		"CHARGEBACK_DISPUTE",
	} {
		t.Run(reversalStatus, func(t *testing.T) {
			payment := selectRelevantPayment([]providerPayment{
				{ID: "older-reversal", Status: reversalStatus, DueDate: "2026-06-28"},
				{ID: "newer-overdue", Status: "OVERDUE", DueDate: "2026-07-28"},
			}, now)

			if payment == nil || payment.ID != "older-reversal" {
				t.Fatalf("payment = %#v, want reversal to outrank delinquency", payment)
			}
		})
	}
}

func TestRefundDeniedIsSettledAndDoesNotBlockANewerInvoice(t *testing.T) {
	if isPaymentReversalStatus("REFUND_DENIED") {
		t.Fatal("REFUND_DENIED is not an effective payment reversal")
	}
	if isAdversePaymentStatus("REFUND_DENIED") {
		t.Fatal("REFUND_DENIED is settled and must not outrank a later renewal")
	}
	payment := selectRelevantPayment([]providerPayment{
		{ID: "refund-denied", Status: "REFUND_DENIED", DueDate: "2026-06-28"},
		{ID: "current-renewal", Status: "PENDING", DueDate: "2026-07-28"},
	}, time.Date(2026, time.July, 28, 15, 0, 0, 0, time.UTC))
	if payment == nil || payment.ID != "current-renewal" {
		t.Fatalf("payment = %#v, want newer renewal", payment)
	}
}

func TestFetchSnapshotUsesCurrentSubscriptionAndAuthenticatedRequests(t *testing.T) {
	var requestCount int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		requestCount++
		if request.Header.Get("access_token") != "provider-secret" {
			t.Fatalf("access_token = %q", request.Header.Get("access_token"))
		}
		if request.Header.Get("User-Agent") != "VimobCRM/1.0 (Go API)" {
			t.Fatalf("User-Agent = %q", request.Header.Get("User-Agent"))
		}
		w.Header().Set("content-type", "application/json")
		switch request.URL.Path {
		case "/subscriptions/sub_current":
			_, _ = w.Write([]byte(`{
				"id":"sub_current",
				"customer":"cus_current",
				"status":"ACTIVE",
				"nextDueDate":"2026-08-28"
			}`))
		case "/subscriptions/sub_current/payments":
			if request.URL.Query().Get("limit") != "100" {
				t.Fatalf("limit = %q", request.URL.Query().Get("limit"))
			}
			_, _ = w.Write([]byte(`{
				"data":[
					{
						"id":"pay_current",
						"customer":"cus_current",
						"subscription":"sub_current",
						"status":"CONFIRMED",
						"value":299.90,
						"dueDate":"2026-07-28"
					}
				]
			}`))
		default:
			http.NotFound(w, request)
		}
	}))
	defer server.Close()

	reconciler := NewReconciler(nil, Config{
		Enabled:        true,
		BaseURL:        server.URL,
		APIKey:         "provider-secret",
		RequestTimeout: time.Second,
	})
	snapshot, err := reconciler.fetchSnapshot(context.Background(), "sub_current")
	if err != nil {
		t.Fatalf("fetchSnapshot: %v", err)
	}
	if requestCount != 2 {
		t.Fatalf("requests = %d, want 2", requestCount)
	}
	if snapshot.CustomerID != "cus_current" ||
		snapshot.SubscriptionID != "sub_current" ||
		snapshot.SubscriptionStatus != "ACTIVE" ||
		snapshot.PaymentID != "pay_current" ||
		snapshot.PaymentStatus != "CONFIRMED" ||
		snapshot.PaymentAmount == nil ||
		*snapshot.PaymentAmount != 299.90 ||
		snapshot.PaymentDueDate != "2026-07-28" ||
		snapshot.NextDueDate != "2026-08-28" {
		t.Fatalf("snapshot = %#v", snapshot)
	}
}

func TestFetchSnapshotRejectsCrossSubscriptionPayment(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		w.Header().Set("content-type", "application/json")
		if strings.HasSuffix(request.URL.Path, "/payments") {
			_, _ = w.Write([]byte(`{
				"data":[{
					"id":"pay_wrong",
					"subscription":"sub_other",
					"status":"CONFIRMED",
					"dueDate":"2026-07-28"
				}]
			}`))
			return
		}
		_, _ = w.Write([]byte(`{
			"id":"sub_current",
			"customer":"cus_current",
			"status":"ACTIVE"
		}`))
	}))
	defer server.Close()

	reconciler := NewReconciler(nil, Config{
		BaseURL:        server.URL,
		APIKey:         "provider-secret",
		RequestTimeout: time.Second,
	})
	_, err := reconciler.fetchSnapshot(context.Background(), "sub_current")
	if err == nil || !strings.Contains(err.Error(), "another subscription") {
		t.Fatalf("error = %v, want cross-subscription rejection", err)
	}
}

func TestPutJSONDisablesProviderNotifications(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPut {
			t.Fatalf("method = %s, want PUT", request.Method)
		}
		if request.URL.Path != "/customers/cus_current" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		if request.Header.Get("access_token") != "provider-secret" {
			t.Fatalf("access_token = %q", request.Header.Get("access_token"))
		}
		if request.Header.Get("User-Agent") != "VimobCRM/1.0 (Go API)" {
			t.Fatalf("User-Agent = %q", request.Header.Get("User-Agent"))
		}
		body, _ := io.ReadAll(request.Body)
		if !strings.Contains(string(body), `"notificationDisabled":true`) {
			t.Fatalf("body = %s", string(body))
		}
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"id":"cus_current","notificationDisabled":true}`))
	}))
	defer server.Close()

	reconciler := NewReconciler(nil, Config{
		BaseURL:        server.URL,
		APIKey:         "provider-secret",
		RequestTimeout: time.Second,
	})
	var confirmation providerCustomerNotificationConfirmation
	if err := reconciler.putJSON(
		context.Background(),
		"/customers/cus_current",
		map[string]any{"notificationDisabled": true},
		&confirmation,
	); err != nil {
		t.Fatalf("putJSON: %v", err)
	}
	if !providerCustomerNotificationSuppressionConfirmed(confirmation, "cus_current") {
		t.Fatalf("confirmation = %+v", confirmation)
	}
}

func TestProviderCustomerNotificationSuppressionRequiresExactConfirmation(t *testing.T) {
	tests := []struct {
		name         string
		confirmation providerCustomerNotificationConfirmation
		expectedID   string
		want         bool
	}{
		{
			name: "confirmed",
			confirmation: providerCustomerNotificationConfirmation{
				ID:                   "cus_current",
				NotificationDisabled: true,
			},
			expectedID: "cus_current",
			want:       true,
		},
		{
			name: "missing flag",
			confirmation: providerCustomerNotificationConfirmation{
				ID: "cus_current",
			},
			expectedID: "cus_current",
		},
		{
			name: "wrong customer",
			confirmation: providerCustomerNotificationConfirmation{
				ID:                   "cus_other",
				NotificationDisabled: true,
			},
			expectedID: "cus_current",
		},
		{
			name: "empty expected customer",
			confirmation: providerCustomerNotificationConfirmation{
				ID:                   "cus_current",
				NotificationDisabled: true,
			},
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			if got := providerCustomerNotificationSuppressionConfirmed(
				testCase.confirmation,
				testCase.expectedID,
			); got != testCase.want {
				t.Fatalf("confirmed = %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestNotificationSuppressionConfirmationCacheIsShortLived(t *testing.T) {
	now := time.Date(2026, time.August, 4, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name  string
		value string
		want  bool
	}{
		{name: "fresh RFC3339", value: now.Add(-time.Minute).Format(time.RFC3339Nano), want: true},
		{name: "fresh legacy postgres", value: "2026-08-04 11:59:00+00", want: true},
		{name: "expired", value: now.Add(-notificationSuppressionConfirmationTTL).Format(time.RFC3339Nano)},
		{name: "far future", value: now.Add(2 * notificationSuppressionClockSkew).Format(time.RFC3339Nano)},
		{name: "invalid", value: "not-a-timestamp"},
		{name: "empty"},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			if got := notificationSuppressionConfirmationIsFresh(testCase.value, now); got != testCase.want {
				t.Fatalf("fresh = %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestReconciliationBackoffIsBounded(t *testing.T) {
	tests := []struct {
		attempt int
		want    time.Duration
	}{
		{attempt: 0, want: 5 * time.Minute},
		{attempt: 1, want: 5 * time.Minute},
		{attempt: 2, want: 10 * time.Minute},
		{attempt: 4, want: 40 * time.Minute},
		{attempt: 20, want: 5 * time.Minute * 64},
	}

	for _, test := range tests {
		if got := reconciliationBackoff(test.attempt); got != test.want {
			t.Fatalf("attempt %d backoff = %s, want %s", test.attempt, got, test.want)
		}
	}
}

func TestCardRecurrenceWorkerTriggerUsesPrivateServiceAuthentication(t *testing.T) {
	testCases := []struct {
		name           string
		apiKey         string
		expectedBearer string
	}{
		{name: "opaque secret", apiKey: "sb_secret_recurrence", expectedBearer: ""},
		{
			name:           "legacy service role JWT",
			apiKey:         "header.payload.signature",
			expectedBearer: "Bearer header.payload.signature",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
				if request.URL.Path != "/functions/v1/asaas-card-recurrence-worker" {
					t.Fatalf("path = %q", request.URL.Path)
				}
				if request.Header.Get("apikey") != testCase.apiKey ||
					request.Header.Get("authorization") != testCase.expectedBearer {
					t.Fatalf("unexpected private Edge worker authentication headers: %#v", request.Header)
				}
				body, err := io.ReadAll(request.Body)
				if err != nil {
					t.Fatal(err)
				}
				if strings.TrimSpace(string(body)) != `{"batch_size":7}` {
					t.Fatalf("body = %s", body)
				}
				// Longer than the normal reconciler timeout below. The private Edge
				// trigger has its own deadline because its bounded worker can perform
				// two provider calls before returning.
				time.Sleep(50 * time.Millisecond)
				w.Header().Set("content-type", "application/json")
				_, _ = w.Write([]byte(`{"claimed":3,"processed":2}`))
			}))
			defer server.Close()

			reconciler := NewReconciler(nil, Config{
				FunctionsURL:    server.URL,
				FunctionsAPIKey: testCase.apiKey,
				BatchSize:       7,
				RequestTimeout:  10 * time.Millisecond,
			})
			processed, err := reconciler.TriggerCardRecurrenceBatch(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if processed != 2 {
				t.Fatalf("processed = %d, want 2", processed)
			}
			if reconciler.client.Timeout != 10*time.Millisecond {
				t.Fatalf("normal provider timeout changed to %s", reconciler.client.Timeout)
			}
		})
	}
}
