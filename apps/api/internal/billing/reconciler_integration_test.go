package billing

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestReconcilerAgainstDatabase(t *testing.T) {
	databaseURL := os.Getenv("BILLING_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("BILLING_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		HealthTimeout: 3 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)

	suffix := fmt.Sprintf("billing-reconcile-%d", time.Now().UnixNano())
	var organizationID string
	err = postgres.Pool().QueryRow(ctx, `
		insert into public.organizations (
		  name,
		  slug,
		  subscription_type,
		  subscription_status,
		  asaas_customer_id,
		  asaas_subscription_id
		)
		values ($1, $1, 'paid', 'pending_payment', $2, $3)
		returning id::text
	`, suffix, "cus_"+suffix, "sub_"+suffix).Scan(&organizationID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.subscriptions (
		  organization_id, status, provider, provider_customer_id, provider_subscription_id
		)
		values ($1::uuid, 'pending_payment', 'asaas', $2, $3)
	`, organizationID, "cus_"+suffix, "sub_"+suffix); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = postgres.Pool().Exec(
			cleanupCtx,
			`delete from public.organizations where id = $1::uuid`,
			organizationID,
		)
	})

	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Header.Get("access_token") != "integration-key" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("content-type", "application/json")
		switch request.URL.Path {
		case "/customers/cus_" + suffix:
			if request.Method != http.MethodPut {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			_, _ = fmt.Fprintf(
				w,
				`{"id":%q,"notificationDisabled":true}`,
				"cus_"+suffix,
			)
		case "/subscriptions/sub_" + suffix:
			_, _ = fmt.Fprintf(
				w,
				`{"id":%q,"customer":%q,"status":"ACTIVE","nextDueDate":"2026-08-28"}`,
				"sub_"+suffix,
				"cus_"+suffix,
			)
		case "/subscriptions/sub_" + suffix + "/payments":
			_, _ = fmt.Fprintf(
				w,
				`{"data":[{"id":%q,"customer":%q,"subscription":%q,"status":"CONFIRMED","value":299.90,"dueDate":"2026-07-28"}]}`,
				"pay_"+suffix,
				"cus_"+suffix,
				"sub_"+suffix,
			)
		default:
			http.NotFound(w, request)
		}
	}))
	defer provider.Close()

	reconciler := NewReconciler(postgres, Config{
		Enabled:        true,
		BaseURL:        provider.URL,
		APIKey:         "integration-key",
		Interval:       5 * time.Minute,
		BatchSize:      1,
		RequestTimeout: 2 * time.Second,
	})
	processed, err := reconciler.ProcessBatch(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 1 {
		t.Fatalf("processed = %d, want 1", processed)
	}

	var status string
	var graceCleared, blockCleared, reconciled bool
	err = postgres.Pool().QueryRow(ctx, `
		select
		  subscription_status,
		  billing_grace_until is null,
		  billing_blocked_at is null,
		  billing_last_reconciled_at is not null
		from public.organizations
		where id = $1::uuid
	`, organizationID).Scan(&status, &graceCleared, &blockCleared, &reconciled)
	if err != nil {
		t.Fatal(err)
	}
	if status != "active" || !graceCleared || !blockCleared || !reconciled {
		t.Fatalf(
			"billing state = status:%s graceCleared:%v blockCleared:%v reconciled:%v",
			status,
			graceCleared,
			blockCleared,
			reconciled,
		)
	}

	var jobStatus string
	var attempts int
	err = postgres.Pool().QueryRow(ctx, `
		select status, attempts
		from private.asaas_reconciliation_jobs
		where organization_id = $1::uuid
	`, organizationID).Scan(&jobStatus, &attempts)
	if err != nil {
		t.Fatal(err)
	}
	if jobStatus != "pending" || attempts != 0 {
		t.Fatalf("job state = %s attempts=%d, want pending/0", jobStatus, attempts)
	}
}
