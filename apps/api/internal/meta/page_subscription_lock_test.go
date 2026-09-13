package meta

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestMetaPageSubscriptionPoolGateAlwaysReservesAStoreConnection(t *testing.T) {
	pool := newUnconnectedMetaLockTestPool(t, 2)
	defer pool.Close()
	defer metaPageSubscriptionLockGates.Delete(pool)

	release, err := acquireMetaPageSubscriptionPoolSlot(t.Context(), pool)
	if err != nil {
		t.Fatalf("first gate acquisition failed: %v", err)
	}

	blockedContext, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := acquireMetaPageSubscriptionPoolSlot(blockedContext, pool); !errors.Is(err, errMetaPageSubscriptionLock) {
		t.Fatalf("second gate acquisition error = %v, want bounded lock error", err)
	}

	release()
	releaseAfterFree, err := acquireMetaPageSubscriptionPoolSlot(t.Context(), pool)
	if err != nil {
		t.Fatalf("gate did not reopen after release: %v", err)
	}
	releaseAfterFree()
}

func TestMetaPageSubscriptionPoolGateRejectsASingleConnectionPool(t *testing.T) {
	pool := newUnconnectedMetaLockTestPool(t, 1)
	defer pool.Close()
	defer metaPageSubscriptionLockGates.Delete(pool)

	if _, err := acquireMetaPageSubscriptionPoolSlot(t.Context(), pool); !errors.Is(err, errMetaPageSubscriptionLock) {
		t.Fatalf("single-connection pool error = %v, want fail-fast lock error", err)
	}
}

func newUnconnectedMetaLockTestPool(t *testing.T, maxConnections int32) *pgxpool.Pool {
	t.Helper()
	config, err := pgxpool.ParseConfig("postgres://test:test@127.0.0.1:1/test?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	config.MaxConns = maxConnections
	config.MinConns = 0
	config.HealthCheckPeriod = time.Hour
	pool, err := pgxpool.NewWithConfig(t.Context(), config)
	if err != nil {
		t.Fatal(err)
	}
	return pool
}
