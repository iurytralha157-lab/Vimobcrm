package leads

import (
	"context"
	"os"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// TestProcessLeadRedistributionAgainstDatabase is an opt-in SQL contract smoke
// test. The caller owns fixture creation and cleanup; regular unit test runs do
// not require a database.
func TestProcessLeadRedistributionAgainstDatabase(t *testing.T) {
	databaseURL := os.Getenv("REDISTRIBUTION_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("REDISTRIBUTION_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		HealthTimeout: 3 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer postgres.Close()

	repository := NewRepository(postgres, nil)
	if err := repository.ProcessLeadRedistribution(ctx); err != nil {
		t.Fatal(err)
	}
}
