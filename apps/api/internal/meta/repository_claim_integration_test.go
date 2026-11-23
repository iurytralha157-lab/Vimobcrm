package meta

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func newMetaIntakeLocalPostgres(t *testing.T) (context.Context, *dbpkg.Postgres) {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("META_INTAKE_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set META_INTAKE_TEST_DATABASE_URL to run the Meta webhook claim contract")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse META_INTAKE_TEST_DATABASE_URL: %v", err)
	}
	switch strings.ToLower(target.Hostname()) {
	case "127.0.0.1", "localhost", "::1":
	default:
		t.Fatalf("META_INTAKE_TEST_DATABASE_URL must use a loopback host, got %q", target.Hostname())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	t.Cleanup(cancel)
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		MaxConns:      4,
		HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect local PostgreSQL: %v", err)
	}
	t.Cleanup(postgres.Close)

	return ctx, postgres
}

func TestMetaWebhookClaimDoesNotLetTenPermanentFailuresStarveReceived(t *testing.T) {
	ctx, postgres := newMetaIntakeLocalPostgres(t)
	pool := postgres.Pool()
	marker := "meta-claim-" + strings.ReplaceAll(time.Now().UTC().Format("20060102T150405.000000000"), ".", "")
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = pool.Exec(cleanupCtx, `delete from public.meta_webhook_events where page_id = $1`, marker)
	})

	rows, err := pool.Query(ctx, `
		insert into public.meta_webhook_events (
		  object, page_id, form_id, leadgen_id, raw_payload,
		  signature_valid, status, attempts, next_retry_at, error_message,
		  received_at, created_at
		)
		select
		  'page', $1, 'poison-form', 'poison-' || series::text, '{}'::jsonb,
		  true, 'failed', 1, null,
		  'Meta page access token is missing',
		  timestamptz '2000-01-01 00:00:00+00' + (series * interval '1 second'),
		  timestamptz '2000-01-01 00:00:00+00' + (series * interval '1 second')
		from generate_series(1, 10) as series
		returning id::text
	`, marker)
	if err != nil {
		t.Fatalf("insert permanent Meta failures: %v", err)
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			t.Fatalf("scan permanent Meta failure: %v", err)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		t.Fatalf("read permanent Meta failures: %v", err)
	}
	rows.Close()

	var receivedID string
	if err := pool.QueryRow(ctx, `
		insert into public.meta_webhook_events (
		  object, page_id, form_id, leadgen_id, raw_payload,
		  signature_valid, status, attempts, received_at, created_at
		) values (
		  'page', $1, 'received-form', 'received-lead', '{}'::jsonb,
		  true, 'received', 0,
		  timestamptz '2001-01-01 00:00:00+00',
		  timestamptz '2001-01-01 00:00:00+00'
		)
		returning id::text
	`, marker).Scan(&receivedID); err != nil {
		t.Fatalf("insert received Meta event: %v", err)
	}

	repository := NewRepository(postgres, Config{})
	claimed, err := repository.ClaimPendingWebhookEvent(ctx, 5*time.Minute)
	if err != nil {
		t.Fatalf("claim Meta webhook event: %v", err)
	}
	if claimed == nil || claimed.Claim.ID != receivedID {
		t.Fatalf("received Meta event %s was starved by ten permanent failures: %#v", receivedID, claimed)
	}
}

func TestMetaWebhookLeaseExclusiveOnReceiptAndTakeover(t *testing.T) {
	ctx, postgres := newMetaIntakeLocalPostgres(t)
	pool := postgres.Pool()
	const appSecret = "meta-lease-test-secret"
	repository := NewRepository(postgres, Config{AppSecret: appSecret})
	handler := NewHandler(repository)
	raw := []byte(`{"object":"page","entry":[]}`)
	request := httptest.NewRequest(http.MethodPost, "/v1/public/integrations/meta/webhook", strings.NewReader(string(raw)))
	request.Header.Set("X-Hub-Signature-256", signMetaWebhook(raw, appSecret))
	response := httptest.NewRecorder()
	handler.Webhook(response, request)
	var ack WebhookResponse
	if err := json.Unmarshal(response.Body.Bytes(), &ack); err != nil || response.Code != http.StatusOK || !ack.OK || ack.EventID == "" {
		t.Fatalf("signed receipt acknowledgement = %d %#v, error = %v", response.Code, ack, err)
	}
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = pool.Exec(cleanupCtx, "delete from public.meta_webhook_events where id = $1::uuid", ack.EventID)
	})

	var status string
	if err := pool.QueryRow(ctx, "select status from public.meta_webhook_events where id = $1::uuid", ack.EventID).Scan(&status); err != nil || status != "received" {
		t.Fatalf("after HTTP acknowledgement status = %q, error = %v", status, err)
	}

	type claimResult struct {
		job *webhookEventJob
		err error
	}
	begin := make(chan struct{})
	claims := make(chan claimResult, 2)
	for i := 0; i < 2; i++ {
		go func() {
			<-begin
			job, err := repository.ClaimPendingWebhookEvent(ctx, time.Second)
			claims <- claimResult{job, err}
		}()
	}
	close(begin)
	var first *webhookEventJob
	for i := 0; i < 2; i++ {
		result := <-claims
		if result.err != nil {
			t.Fatal(result.err)
		}
		if result.job != nil {
			if first != nil || result.job.Claim.ID != ack.EventID {
				t.Fatalf("two workers obtained a claim or another receipt was selected: %#v", result.job)
			}
			first = result.job
		}
	}
	if first == nil {
		t.Fatal("neither worker obtained the queued receipt")
	}

	ownedCtx := context.WithValue(ctx, webhookEventClaimContextKey{}, first.Claim)
	tx, err := repository.beginWebhookMutation(ownedCtx)
	if err != nil {
		t.Fatalf("owner could not lock its receipt for a domain mutation: %v", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "select pg_sleep(1.05)"); err != nil {
		t.Fatal(err)
	}
	if stolen, err := repository.ClaimPendingWebhookEvent(ctx, webhookEventLease); err != nil || stolen != nil {
		t.Fatalf("takeover while the first mutation holds the expired row: %#v, %v", stolen, err)
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}

	second, err := repository.ClaimPendingWebhookEvent(ctx, webhookEventLease)
	if err != nil || second == nil || second.Claim.ID != first.Claim.ID || second.Claim.ExpiresAt.Equal(first.Claim.ExpiresAt) {
		t.Fatalf("expired lease was not replaced by a new claim: %#v, %v", second, err)
	}
	if _, err := repository.beginWebhookMutation(ownedCtx); !errors.Is(err, errWebhookClaimLost) {
		t.Fatalf("superseded mutation = %v, want lost lease", err)
	}
	if err := repository.FinishWebhookEvent(ctx, first.Claim, "", "failed", "stale attempt"); !errors.Is(err, errWebhookClaimLost) {
		t.Fatalf("superseded finish = %v, want lost lease", err)
	}
	result, err := repository.ProcessWebhookPayload(ctx, *second)
	if err != nil || result.EventID != ack.EventID {
		t.Fatalf("new owner did not settle the receipt: %#v, %v", result, err)
	}
	if err := repository.FinishWebhookEvent(ctx, first.Claim, "", "failed", "late stale attempt"); !errors.Is(err, errWebhookClaimLost) {
		t.Fatalf("late stale finish = %v, want lost lease", err)
	}

	var attempts int
	var retryScheduled bool
	if err := pool.QueryRow(ctx, `
		select status, attempts, next_retry_at is not null
		from public.meta_webhook_events
		where id = $1::uuid
	`, ack.EventID).Scan(&status, &attempts, &retryScheduled); err != nil ||
		status != "skipped" || attempts != 1 || retryScheduled {
		t.Fatalf("settled receipt status=%q attempts=%d retry=%t error=%v", status, attempts, retryScheduled, err)
	}
}
