package webhooks

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestExpiredFinalWebhookAttemptsNeedReconciliation(t *testing.T) {
	dsn := os.Getenv("WEBHOOK_DELIVERY_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set WEBHOOK_DELIVERY_TEST_DATABASE_URL to a disposable loopback database")
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil || config.Host != "127.0.0.1" || config.Database != "vimob_webhook_delivery_test" || len(config.Fallbacks) != 0 {
		t.Fatal("outgoing webhook test requires its disposable loopback database with sslmode=disable")
	}
	ctx := t.Context()
	db, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: dsn, MaxConns: 4, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	pool := db.Pool()
	if _, err := pool.Exec(ctx, `
		create schema private;
		create table public.webhooks_integrations (id uuid primary key, last_triggered_at timestamptz, updated_at timestamptz);
		create table private.webhook_delivery_outbox (
			id uuid primary key default gen_random_uuid(), webhook_id uuid, status text not null,
			attempts int not null, max_attempts int not null, lease_owner text, lease_until timestamptz,
			last_error text, response_status int, next_attempt_at timestamptz, delivered_at timestamptz, updated_at timestamptz
		);
		insert into private.webhook_delivery_outbox (status, attempts, max_attempts, lease_owner, lease_until, response_status)
		values ('delivering', 3, 3, 'previous-worker', now() - interval '1 second', 503),
		       ('delivering', 2, 3, 'previous-worker', now() - interval '1 second', null),
		       ('delivering', 3, 3, 'current-worker', now() + interval '5 minutes', null);
	`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := pool.Exec(cleanup, `drop table private.webhook_delivery_outbox;
			drop table public.webhooks_integrations;
			drop schema private;`); err != nil {
			t.Errorf("clean outgoing webhook test fixture: %v", err)
		}
	})
	repo := Repository{db: db}
	count, err := repo.expireFinalWebhookAttempts(ctx)
	if err != nil || count != 1 {
		t.Fatalf("closed %d final attempts, want 1, err: %v", count, err)
	}
	var id string
	if err := pool.QueryRow(ctx, `select id from private.webhook_delivery_outbox where status = 'dead'
		and attempts = 3 and last_error = 'delivery_outcome_unknown'
		and lease_owner is null and lease_until is null`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	late := webhookDelivery{ID: id, Attempts: 3, MaxAttempts: 3}
	if err := repo.finishWebhookDelivery(ctx, "previous-worker", late, 204, nil); err != nil {
		t.Fatal(err)
	}
	if err := repo.finishWebhookDelivery(ctx, "previous-worker", late, 503, os.ErrDeadlineExceeded); err != nil {
		t.Fatal(err)
	}
	var stillDelivering, stillUnknown int
	if err := pool.QueryRow(ctx, `select count(*) filter (where status = 'delivering'),
		count(*) filter (where status = 'dead' and last_error = 'delivery_outcome_unknown' and delivered_at is null and response_status is null)
		from private.webhook_delivery_outbox`).Scan(&stillDelivering, &stillUnknown); err != nil {
		t.Fatal(err)
	}
	if stillDelivering != 2 || stillUnknown != 1 {
		t.Fatalf("unexpected states after late result: %d delivering, %d unknown", stillDelivering, stillUnknown)
	}
	if count, err := repo.expireFinalWebhookAttempts(ctx); err != nil || count != 0 {
		t.Fatalf("closed %d more final attempts, want 0, err: %v", count, err)
	}
}
