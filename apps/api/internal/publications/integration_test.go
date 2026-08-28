package publications

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestPublicationQueriesCompileAgainstDatabase(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DB_TESTS") != "1" {
		t.Skip("set VIMOB_RUN_DB_TESTS=1 to run database integration tests")
	}
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		t.Fatal("DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL: databaseURL, MaxConns: 2, HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect database: %v", err)
	}
	t.Cleanup(postgres.Close)
	repo := NewRepository(postgres, Config{Worker: WorkerConfig{BatchSize: 5, Lease: time.Minute, MaxAttempts: 3}})
	var nonterminalJobs int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)
		from public.property_channel_publication_jobs
		where status in ('pending', 'processing', 'retry')
	`).Scan(&nonterminalJobs); err != nil {
		t.Fatalf("count publication jobs: %v", err)
	}
	if nonterminalJobs == 0 {
		jobs, err := repo.claimJobs(ctx, "publication-query-contract")
		if err != nil {
			t.Fatalf("claim query on an empty queue: %v", err)
		}
		if len(jobs) != 0 {
			t.Fatalf("empty queue unexpectedly returned %d jobs", len(jobs))
		}
	}

	var providerListingIndexUnique bool
	var providerListingIndexDefinition string
	if err := postgres.Pool().QueryRow(ctx, `
		select index_definition.indisunique,
		       pg_get_indexdef(index_definition.indexrelid)
		from pg_catalog.pg_index index_definition
		where index_definition.indexrelid =
		      'public.property_channel_publications_provider_uidx'::regclass
	`).Scan(&providerListingIndexUnique, &providerListingIndexDefinition); err != nil {
		t.Fatalf("inspect provider listing uniqueness: %v", err)
	}
	if !providerListingIndexUnique {
		t.Fatal("provider listing index must be unique")
	}
	for _, expected := range []string{
		"organization_id", "channel", "channel_account_key", "provider_listing_id",
		"WHERE (provider_listing_id IS NOT NULL)",
	} {
		if !strings.Contains(providerListingIndexDefinition, expected) {
			t.Fatalf("provider listing index is missing %q: %s", expected, providerListingIndexDefinition)
		}
	}

	_, err = repo.ResolvePublicMedia(ctx, testPublicationID, 1, testAssetID)
	if !errors.Is(err, ErrMediaNotFound) {
		t.Fatalf("media query error = %v, want not found", err)
	}
}
