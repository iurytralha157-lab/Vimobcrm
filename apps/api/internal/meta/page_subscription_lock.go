package meta

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

var errMetaPageSubscriptionLock = errors.New("Meta Page subscription lock failed")

type metaPageSubscriptionLockGate struct {
	slots chan struct{}
}

var metaPageSubscriptionLockGates sync.Map

// acquireMetaPageSubscriptionLock serializes provider subscription changes for
// one Page across every API replica and CRM organization. This is deliberately
// a session lock instead of a transaction lock: the critical section includes
// a provider HTTP request, and holding a database transaction open across that
// request would unnecessarily retain an MVCC snapshot. If explicit unlock ever
// fails, the underlying connection is closed instead of being returned to the
// pool with a leaked advisory lock.
func acquireMetaPageSubscriptionLock(ctx context.Context, database *dbpkg.Postgres, pageID string) (func(), error) {
	pageID = strings.TrimSpace(pageID)
	if database == nil || pageID == "" {
		return nil, errMetaPageSubscriptionLock
	}
	pool := database.Pool()
	releasePoolSlot, err := acquireMetaPageSubscriptionPoolSlot(ctx, pool)
	if err != nil {
		return nil, err
	}
	connection, err := pool.Acquire(ctx)
	if err != nil {
		releasePoolSlot()
		return nil, errMetaPageSubscriptionLock
	}
	if _, err := connection.Exec(ctx, `
		select pg_advisory_lock(
			hashtextextended('meta-page-subscription:' || $1, 0)
		)
	`, pageID); err != nil {
		// Cancellation can race with the server acquiring the session lock. Do
		// not return an uncertain connection to the pool.
		closeContext, closeCancel := context.WithTimeout(context.Background(), 5*time.Second)
		underlying := connection.Hijack()
		_ = underlying.Close(closeContext)
		closeCancel()
		releasePoolSlot()
		return nil, errMetaPageSubscriptionLock
	}

	var once sync.Once
	return func() {
		once.Do(func() {
			defer releasePoolSlot()
			releaseContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			var unlocked bool
			unlockErr := connection.QueryRow(releaseContext, `
				select pg_advisory_unlock(
					hashtextextended('meta-page-subscription:' || $1, 0)
				)
			`, pageID).Scan(&unlocked)
			if unlockErr != nil || !unlocked {
				closeContext, closeCancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer closeCancel()
				underlying := connection.Hijack()
				_ = underlying.Close(closeContext)
				return
			}
			connection.Release()
		})
	}, nil
}

// acquireMetaPageSubscriptionPoolSlot bounds lock-owning connections to one
// fewer than the pool maximum. Code inside the provider critical section still
// performs tenant-scoped database operations through the pool; reserving one
// connection prevents all goroutines from holding a lock connection while
// deadlocking on their next store call. A one-connection pool fails fast
// instead of entering that unsafe state.
func acquireMetaPageSubscriptionPoolSlot(ctx context.Context, pool *pgxpool.Pool) (func(), error) {
	if pool == nil {
		return nil, errMetaPageSubscriptionLock
	}
	capacity := int(pool.Config().MaxConns) - 1
	if capacity < 1 {
		return nil, errMetaPageSubscriptionLock
	}
	candidate := &metaPageSubscriptionLockGate{slots: make(chan struct{}, capacity)}
	loaded, _ := metaPageSubscriptionLockGates.LoadOrStore(pool, candidate)
	gate := loaded.(*metaPageSubscriptionLockGate)
	select {
	case gate.slots <- struct{}{}:
	case <-ctx.Done():
		return nil, errMetaPageSubscriptionLock
	}

	var once sync.Once
	return func() {
		once.Do(func() {
			<-gate.slots
		})
	}, nil
}
