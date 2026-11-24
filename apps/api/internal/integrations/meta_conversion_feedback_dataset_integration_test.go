package integrations

import (
	"context"
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestMetaConversionFeedbackDatasetOwnershipAgainstPostgres(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("META_CRM_DATASET_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set META_CRM_DATASET_TEST_DATABASE_URL for the disposable Dataset ownership test")
	}
	target, err := url.Parse(databaseURL)
	if err != nil || !isOutboundMessagingLoopbackHost(target.Hostname()) || target.Path != "/meta_crm_dataset_guard_fixture" {
		t.Fatal("Dataset ownership test requires a disposable loopback database named meta_crm_dataset_guard_fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	if _, err := pool.Exec(ctx, `
		create table public.meta_integrations (organization_id uuid not null, crm_dataset_id text);
		create table public.meta_crm_event_outbox (organization_id uuid not null, dataset_id text not null);
	`); err != nil {
		t.Fatalf("create disposable Dataset tables: %v", err)
	}
	defer func() {
		cleanup, cancelCleanup := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelCleanup()
		if _, err := pool.Exec(cleanup, "drop table public.meta_integrations, public.meta_crm_event_outbox"); err != nil {
			t.Errorf("remove disposable Dataset tables: %v", err)
		}
	}()

	const firstOrg = "10000000-0000-4000-8000-000000000001"
	const secondOrg = "10000000-0000-4000-8000-000000000002"
	const datasetID = "1234567890"
	const datasetAlias = "0001234567890"

	holder, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Rollback(ctx)
	if err := guardMetaCRMDatasetOrganization(ctx, holder, firstOrg, datasetID); err != nil {
		t.Fatalf("first bind: %v", err)
	}
	if _, err := holder.Exec(ctx, `insert into public.meta_integrations values ($1::uuid, $2)`, firstOrg, datasetID); err != nil {
		t.Fatal(err)
	}

	waiter, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		t.Fatal(err)
	}
	defer waiter.Rollback(ctx)
	if _, err := waiter.Exec(ctx, `set local lock_timeout = '250ms'`); err != nil {
		t.Fatal(err)
	}
	var lockError *pgconn.PgError
	err = guardMetaCRMDatasetOrganization(ctx, waiter, secondOrg, datasetAlias)
	if !errors.As(err, &lockError) || lockError.Code != "55P03" {
		t.Fatalf("concurrent bind for the same Dataset must wait, got %v", err)
	}
	if err := waiter.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if err := holder.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	checked, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		t.Fatal(err)
	}
	defer checked.Rollback(ctx)
	if err := guardMetaCRMDatasetOrganization(ctx, checked, firstOrg, datasetAlias); err != nil {
		t.Fatalf("same organization may reuse a Dataset on another page: %v", err)
	}
	if err := guardMetaCRMDatasetOrganization(ctx, checked, secondOrg, datasetAlias); !errors.Is(err, ErrMetaCRMDatasetUnavailable) {
		t.Fatalf("different organization must be rejected: %v", err)
	}

	if _, err := checked.Exec(ctx, `delete from public.meta_integrations; insert into public.meta_crm_event_outbox values ('10000000-0000-4000-8000-000000000001', '1234567890')`); err != nil {
		t.Fatal(err)
	}
	if err := guardMetaCRMDatasetOrganization(ctx, checked, secondOrg, datasetAlias); !errors.Is(err, ErrMetaCRMDatasetUnavailable) {
		t.Fatalf("historical destination must be rejected for another organization: %v", err)
	}
}
