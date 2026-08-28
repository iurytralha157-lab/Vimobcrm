package settings

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestAsaasPaymentReadUsesKnownProviderIdentity(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet || request.URL.Path != "/payments/pay_known" {
			t.Fatalf("request = %s %s", request.Method, request.URL.Path)
		}
		if request.Header.Get("access_token") != "secret" {
			t.Fatal("missing Asaas access_token")
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{
			"id":"pay_known",
			"customer":"cus_known",
			"subscription":"sub_known",
			"billingType":"PIX",
			"status":"RECEIVED",
			"value":297,
			"dueDate":"2026-08-15"
		}`)
	}))
	defer server.Close()

	client := newAsaasSubscriptionClient(ExternalConfig{
		AsaasURL:            server.URL,
		AsaasAPIKey:         "secret",
		AsaasRequestTimeout: time.Second,
	})
	snapshot, err := client.getPayment(context.Background(), "pay_known")
	if err != nil {
		t.Fatalf("get payment: %v", err)
	}
	if err := validateAsaasPaymentIdentity(snapshot, "pay_known", "cus_known", "sub_known"); err != nil {
		t.Fatalf("validate payment identity: %v", err)
	}
	if snapshot.normalizedStatus() != "RECEIVED" {
		t.Fatalf("status = %q", snapshot.normalizedStatus())
	}
	if snapshot.Value == nil || *snapshot.Value != 297 {
		t.Fatalf("value = %#v", snapshot.Value)
	}
}

func TestAsaasPaymentExplicitDeletionBecomesDeletedStatus(t *testing.T) {
	t.Parallel()

	snapshot := asaasPaymentSnapshot{
		ID:      "pay_deleted",
		Status:  "PENDING",
		Deleted: true,
	}
	if snapshot.normalizedStatus() != "DELETED" {
		t.Fatalf("status = %q, want DELETED", snapshot.normalizedStatus())
	}
	if err := validateAsaasPaymentIdentity(
		snapshot,
		"pay_deleted",
		"cus_known",
		"sub_known",
	); err != nil {
		t.Fatalf("explicit deletion may omit already-bound customer fields: %v", err)
	}
}

func TestAsaasPaymentReadClassifiesProviderNotFoundWithoutInventingCancellation(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"errors":[{"description":"Payment not found"}]}`, http.StatusNotFound)
	}))
	defer server.Close()

	client := newAsaasSubscriptionClient(ExternalConfig{
		AsaasURL:            server.URL,
		AsaasAPIKey:         "secret",
		AsaasRequestTimeout: time.Second,
	})
	_, err := client.getPayment(context.Background(), "pay_missing")
	if err == nil || !isAsaasPaymentNotFound(err) {
		t.Fatalf("error = %v, want provider not found", err)
	}
	if errors.Is(err, ErrPaymentProviderMismatch) {
		t.Fatalf("provider 404 must remain unavailable, not an invented terminal state: %v", err)
	}
}

func TestAsaasPaymentIdentityRejectsCrossTenantProviderObjects(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		snapshot asaasPaymentSnapshot
	}{
		{
			name: "payment",
			snapshot: asaasPaymentSnapshot{
				ID:             "pay_other",
				CustomerID:     "cus_known",
				SubscriptionID: "sub_known",
			},
		},
		{
			name: "customer",
			snapshot: asaasPaymentSnapshot{
				ID:             "pay_known",
				CustomerID:     "cus_other",
				SubscriptionID: "sub_known",
			},
		},
		{
			name: "subscription",
			snapshot: asaasPaymentSnapshot{
				ID:             "pay_known",
				CustomerID:     "cus_known",
				SubscriptionID: "sub_other",
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateAsaasPaymentIdentity(
				test.snapshot,
				"pay_known",
				"cus_known",
				"sub_known",
			)
			if !errors.Is(err, ErrPaymentProviderMismatch) {
				t.Fatalf("error = %v, want ErrPaymentProviderMismatch", err)
			}
		})
	}
}

func TestAsaasPaymentSnapshotRejectsCommercialDriftAndMissingFields(t *testing.T) {
	value := 297.0
	local := localPaymentIdentity{
		AsaasPaymentID:      "pay_known",
		AsaasCustomerID:     "cus_known",
		AsaasSubscriptionID: "sub_known",
		BillingType:         "CREDIT_CARD",
		Value:               value,
		DueDate:             "2026-08-15",
	}
	valid := asaasPaymentSnapshot{
		ID:             "pay_known",
		CustomerID:     "cus_known",
		SubscriptionID: "sub_known",
		BillingType:    "CREDIT_CARD",
		Status:         "RECEIVED",
		Value:          &value,
		DueDate:        "2026-08-15",
	}
	if err := validateAsaasPaymentSnapshot(valid, local); err != nil {
		t.Fatalf("exact snapshot rejected: %v", err)
	}

	tests := []struct {
		name     string
		mutate   func(*asaasPaymentSnapshot)
		mutateDB func(*localPaymentIdentity)
	}{
		{name: "missing value", mutate: func(item *asaasPaymentSnapshot) { item.Value = nil }},
		{name: "amount drift", mutate: func(item *asaasPaymentSnapshot) { changed := 397.0; item.Value = &changed }},
		{name: "missing due date", mutate: func(item *asaasPaymentSnapshot) { item.DueDate = "" }},
		{name: "due date drift", mutate: func(item *asaasPaymentSnapshot) { item.DueDate = "2026-08-16" }},
		{name: "billing type drift", mutate: func(item *asaasPaymentSnapshot) { item.BillingType = "PIX" }},
		{name: "missing local customer", mutateDB: func(item *localPaymentIdentity) { item.AsaasCustomerID = "" }},
		{name: "unexpected subscription", mutateDB: func(item *localPaymentIdentity) { item.AsaasSubscriptionID = "" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			snapshot := valid
			expected := local
			if test.mutate != nil {
				test.mutate(&snapshot)
			}
			if test.mutateDB != nil {
				test.mutateDB(&expected)
			}
			if err := validateAsaasPaymentSnapshot(snapshot, expected); !errors.Is(err, ErrPaymentProviderMismatch) {
				t.Fatalf("error = %v, want ErrPaymentProviderMismatch", err)
			}
		})
	}
}
