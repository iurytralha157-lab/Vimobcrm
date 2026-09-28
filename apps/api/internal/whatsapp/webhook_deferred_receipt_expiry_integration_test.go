package whatsapp

import (
	"context"
	"os"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// The SQL fixture runs within BEGIN/ROLLBACK. It proves that only a deferred
// receipt ID without a canonical target can expire after seven days, while
// preserving its original raw payload and hash indefinitely.
func TestExpireUnmatchedPartialLiveReceiptIDs(t *testing.T) {
	databaseURL := os.Getenv("WHATSAPP_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL: databaseURL, HealthTimeout: 3 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer postgres.Close()

	connection, err := postgres.Pool().Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Release()
	defer func() {
		rollbackCtx, rollbackCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer rollbackCancel()
		_, _ = connection.Conn().PgConn().Exec(rollbackCtx, "ROLLBACK").ReadAll()
	}()

	var beforeInbox, beforeAudit int
	if err := connection.QueryRow(ctx, `
        select (select count(*)::integer from public.whatsapp_webhook_inbox
                  where event_key like 'ttl-canary-%'),
               (select count(*)::integer from private.whatsapp_v1_partial_live_receipt_audit
                  where event_key like 'ttl-canary-%')
    `).Scan(&beforeInbox, &beforeAudit); err != nil {
		t.Fatal(err)
	}

	script, err := os.ReadFile("testdata/partial_live_receipt_expiry.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := connection.Conn().PgConn().Exec(ctx, string(script)).ReadAll(); err != nil {
		t.Fatal(err)
	}

	var afterInbox, afterAudit int
	if err := connection.QueryRow(ctx, `
        select (select count(*)::integer from public.whatsapp_webhook_inbox
                  where event_key like 'ttl-canary-%'),
               (select count(*)::integer from private.whatsapp_v1_partial_live_receipt_audit
                  where event_key like 'ttl-canary-%')
    `).Scan(&afterInbox, &afterAudit); err != nil {
		t.Fatal(err)
	}
	if afterInbox != beforeInbox || afterAudit != beforeAudit {
		t.Fatalf("rollback left TTL canary fixtures: inbox %d->%d audit %d->%d",
			beforeInbox, afterInbox, beforeAudit, afterAudit)
	}
}
