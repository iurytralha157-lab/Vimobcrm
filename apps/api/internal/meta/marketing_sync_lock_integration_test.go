package meta

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestMarketingSyncOrganizationLockAcrossPostgresConnections(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("MARKETING_SYNC_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set MARKETING_SYNC_TEST_DATABASE_URL to run the PostgreSQL lock contract test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	firstPool := newMarketingSyncLockIntegrationPool(t, ctx, databaseURL)
	defer firstPool.Close()
	defer metaPageSubscriptionLockGates.Delete(firstPool)
	secondPool := newMarketingSyncLockIntegrationPool(t, ctx, databaseURL)
	defer secondPool.Close()
	defer metaPageSubscriptionLockGates.Delete(secondPool)

	organizationID := "11111111-1111-4111-8111-111111111111"
	releaseFirst, acquired, err := acquireMarketingSyncOrganizationLock(ctx, firstPool, organizationID)
	if err != nil || !acquired {
		t.Fatalf("first acquisition acquired=%v error=%v", acquired, err)
	}
	defer releaseFirst()

	if releaseConflict, conflictAcquired, conflictErr := acquireMarketingSyncOrganizationLock(ctx, secondPool, organizationID); conflictErr != nil || conflictAcquired || releaseConflict != nil {
		t.Fatalf("cross-pool conflict release=%v acquired=%v error=%v", releaseConflict != nil, conflictAcquired, conflictErr)
	}

	otherOrganizationID := "33333333-3333-4333-8333-333333333333"
	releaseOther, otherAcquired, otherErr := acquireMarketingSyncOrganizationLock(ctx, secondPool, otherOrganizationID)
	if otherErr != nil || !otherAcquired {
		t.Fatalf("other organization acquired=%v error=%v", otherAcquired, otherErr)
	}
	releaseOther()

	releaseFirst()
	releaseAfterUnlock, acquiredAfterUnlock, errAfterUnlock := acquireMarketingSyncOrganizationLock(ctx, secondPool, organizationID)
	if errAfterUnlock != nil || !acquiredAfterUnlock {
		t.Fatalf("reacquisition acquired=%v error=%v", acquiredAfterUnlock, errAfterUnlock)
	}
	releaseAfterUnlock()
}

func newMarketingSyncLockIntegrationPool(t *testing.T, ctx context.Context, databaseURL string) *pgxpool.Pool {
	t.Helper()
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatalf("parse PostgreSQL URL: %v", err)
	}
	config.MaxConns = 4
	config.MinConns = 0
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatalf("connect PostgreSQL: %v", err)
	}
	return pool
}
