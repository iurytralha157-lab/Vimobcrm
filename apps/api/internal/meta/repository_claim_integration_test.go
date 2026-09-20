package meta

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestMetaWebhookClaimDoesNotLetTenPermanentFailuresStarveReceived(t *testing.T) {
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
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		MaxConns:      4,
		HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect local PostgreSQL: %v", err)
	}
	t.Cleanup(postgres.Close)

	pool := postgres.Pool()
	marker := "meta-claim-" + strings.ReplaceAll(time.Now().UTC().Format("20060102T150405.000000000"), ".", "")
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = pool.Exec(cleanupCtx, `delete from public.meta_webhook_events where page_id = $1`, marker)
	})

	poisonIDs := map[string]struct{}{}
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
		poisonIDs[id] = struct{}{}
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
	claimed, err := repository.ClaimPendingWebhookEvents(ctx, 10, 5*time.Minute)
	if err != nil {
		t.Fatalf("claim Meta webhook events: %v", err)
	}
	foundReceived := false
	for _, job := range claimed {
		if _, poison := poisonIDs[job.ID]; poison {
			t.Fatalf("permanent Meta failure %s was automatically reclaimed", job.ID)
		}
		foundReceived = foundReceived || job.ID == receivedID
	}
	if !foundReceived {
		t.Fatalf("received Meta event %s was starved by ten permanent failures", receivedID)
	}
}
