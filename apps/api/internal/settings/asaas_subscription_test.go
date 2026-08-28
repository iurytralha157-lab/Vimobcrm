package settings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestAsaasSubscriptionPlanChangeUpdatesExistingSubscriptionWithoutPendingPayments(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPut || request.URL.Path != "/subscriptions/sub-existing" {
			t.Fatalf("request = %s %s", request.Method, request.URL.Path)
		}
		if request.Header.Get("access_token") != "secret" {
			t.Fatal("missing Asaas access_token")
		}

		var payload struct {
			Value                 float64 `json:"value"`
			Cycle                 string  `json:"cycle"`
			UpdatePendingPayments *bool   `json:"updatePendingPayments"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if payload.Value != 1782 || payload.Cycle != "SEMIANNUALLY" {
			t.Fatalf("unexpected update payload: %#v", payload)
		}
		if payload.UpdatePendingPayments == nil || *payload.UpdatePendingPayments {
			t.Fatal("updatePendingPayments must be explicitly false")
		}

		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"id":"sub-existing","value":1782,"cycle":"SEMIANNUALLY","nextDueDate":"2026-09-05","status":"ACTIVE"}`)
	}))
	defer server.Close()

	client := newAsaasSubscriptionClient(ExternalConfig{
		AsaasURL:            server.URL,
		AsaasAPIKey:         "secret",
		AsaasRequestTimeout: time.Second,
	})
	snapshot, err := client.schedulePlanChange(context.Background(), "sub-existing", asaasPlanChangeInput{
		Amount:      1782,
		Cycle:       "SEMIANNUALLY",
		Description: "Vimob CRM - Plano Pro - 6 mes(es)",
	})
	if err != nil {
		t.Fatalf("schedule plan change: %v", err)
	}
	if snapshot.NextDueDate != "2026-09-05" {
		t.Fatalf("nextDueDate = %q", snapshot.NextDueDate)
	}
}

func TestAsaasSubscriptionPlanChangeRecoversAmbiguousPutByReadingProvider(t *testing.T) {
	t.Parallel()

	var puts atomic.Int32
	var gets atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		switch request.Method {
		case http.MethodPut:
			puts.Add(1)
			http.Error(w, "upstream timeout", http.StatusGatewayTimeout)
		case http.MethodGet:
			gets.Add(1)
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"id":"sub-existing","value":297,"cycle":"MONTHLY","nextDueDate":"2026-09-05","status":"ACTIVE"}`)
		default:
			t.Fatalf("unexpected method %s", request.Method)
		}
	}))
	defer server.Close()

	client := newAsaasSubscriptionClient(ExternalConfig{
		AsaasURL:            server.URL,
		AsaasAPIKey:         "secret",
		AsaasRequestTimeout: time.Second,
	})
	_, err := client.schedulePlanChange(context.Background(), "sub-existing", asaasPlanChangeInput{
		Amount: 297,
		Cycle:  "MONTHLY",
	})
	if err != nil {
		t.Fatalf("recover plan change: %v", err)
	}
	if puts.Load() != 1 || gets.Load() != 1 {
		t.Fatalf("requests = %d PUT, %d GET; want 1/1", puts.Load(), gets.Load())
	}
}

func TestAsaasSubscriptionPlanChangeRetryReadsBeforeRepeatingAcceptedPut(t *testing.T) {
	t.Parallel()

	var puts atomic.Int32
	var gets atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		switch request.Method {
		case http.MethodGet:
			gets.Add(1)
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"id":"sub-existing","value":297,"cycle":"MONTHLY","nextDueDate":"2026-09-05","status":"ACTIVE"}`)
		case http.MethodPut:
			puts.Add(1)
			t.Error("an already accepted plan change must not repeat PUT during recovery")
			http.Error(w, "unexpected PUT", http.StatusInternalServerError)
		default:
			t.Errorf("unexpected method %s", request.Method)
			http.Error(w, "unexpected method", http.StatusMethodNotAllowed)
		}
	}))
	defer server.Close()

	client := newAsaasSubscriptionClient(ExternalConfig{
		AsaasURL:            server.URL,
		AsaasAPIKey:         "secret",
		AsaasRequestTimeout: time.Second,
	})
	_, err := client.recoverPlanChange(context.Background(), "sub-existing", asaasPlanChangeInput{
		Amount: 297,
		Cycle:  "MONTHLY",
	})
	if err != nil {
		t.Fatalf("recover persisted provider update: %v", err)
	}
	if puts.Load() != 0 || gets.Load() != 1 {
		t.Fatalf("requests = %d PUT, %d GET; want 0/1", puts.Load(), gets.Load())
	}
}

func TestAsaasSubscriptionPlanChangeLeavesAmbiguousOutcomeRetryable(t *testing.T) {
	t.Parallel()

	var puts atomic.Int32
	var gets atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		switch request.Method {
		case http.MethodPut:
			puts.Add(1)
			http.Error(w, "upstream timeout", http.StatusGatewayTimeout)
			return
		case http.MethodGet:
			gets.Add(1)
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"id":"sub-existing","value":197,"cycle":"MONTHLY","nextDueDate":"2026-09-05","status":"ACTIVE"}`)
		default:
			t.Errorf("unexpected method %s", request.Method)
			http.Error(w, "unexpected method", http.StatusMethodNotAllowed)
		}
	}))
	defer server.Close()

	client := newAsaasSubscriptionClient(ExternalConfig{
		AsaasURL:            server.URL,
		AsaasAPIKey:         "secret",
		AsaasRequestTimeout: time.Second,
	})
	_, err := client.schedulePlanChange(context.Background(), "sub-existing", asaasPlanChangeInput{
		Amount: 297,
		Cycle:  "MONTHLY",
	})
	if !errors.Is(err, ErrAsaasAmbiguous) {
		t.Fatalf("error = %v, want ErrAsaasAmbiguous", err)
	}
	if puts.Load() != 2 || gets.Load() != 2 {
		t.Fatalf("requests = %d PUT, %d GET; want 2/2", puts.Load(), gets.Load())
	}
}

func TestAsaasSubscriptionPlanChangeDoesNotRetryDefinitiveRejection(t *testing.T) {
	t.Parallel()

	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		http.Error(w, "invalid subscription", http.StatusUnprocessableEntity)
	}))
	defer server.Close()

	client := newAsaasSubscriptionClient(ExternalConfig{
		AsaasURL:            server.URL,
		AsaasAPIKey:         "secret",
		AsaasRequestTimeout: time.Second,
	})
	_, err := client.schedulePlanChange(context.Background(), "sub-existing", asaasPlanChangeInput{
		Amount: 297,
		Cycle:  "MONTHLY",
	})
	if !errors.Is(err, ErrAsaasOperation) {
		t.Fatalf("error = %v, want ErrAsaasOperation", err)
	}
	if requests.Load() != 1 {
		t.Fatalf("requests = %d, want 1", requests.Load())
	}
}

func TestAsaasSubscriptionPlanChangeKeepsRateLimitRetryable(t *testing.T) {
	t.Parallel()

	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		http.Error(w, "rate limited", http.StatusTooManyRequests)
	}))
	defer server.Close()

	client := newAsaasSubscriptionClient(ExternalConfig{
		AsaasURL:            server.URL,
		AsaasAPIKey:         "secret",
		AsaasRequestTimeout: time.Second,
	})
	_, err := client.schedulePlanChange(context.Background(), "sub-existing", asaasPlanChangeInput{
		Amount: 297,
		Cycle:  "MONTHLY",
	})
	if !errors.Is(err, ErrAsaasAmbiguous) {
		t.Fatalf("error = %v, want retryable ErrAsaasAmbiguous", err)
	}
	if requests.Load() != 4 {
		t.Fatalf("requests = %d, want two PUTs and two recovery GETs", requests.Load())
	}
}
