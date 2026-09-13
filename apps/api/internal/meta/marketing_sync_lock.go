package meta

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const marketingSyncOrganizationLockPrefix = "vimob:marketing-sync:organization:"
const marketingSyncOrganizationUnlockTimeout = 5 * time.Second

var errMarketingSyncOrganizationLock = errors.New("Marketing sync organization lock failed")

// acquireMarketingSyncOrganizationLock serializes one organization's complete
// Marketing import across API replicas. The advisory lock owns a dedicated
// database session, but no transaction remains open while Meta is called.
// PostgreSQL releases the lock if the process or connection dies.
func acquireMarketingSyncOrganizationLock(ctx context.Context, pool *pgxpool.Pool, organizationID string) (func(), bool, error) {
	organizationID = strings.TrimSpace(organizationID)
	if pool == nil || organizationID == "" {
		return nil, false, errMarketingSyncOrganizationLock
	}

	// Reuse the Meta session-lock gate so every long-lived Meta lock combined
	// still leaves at least one pooled connection available for normal stores.
	releasePoolSlot, err := acquireMetaPageSubscriptionPoolSlot(ctx, pool)
	if err != nil {
		return nil, false, errMarketingSyncOrganizationLock
	}
	connection, err := pool.Acquire(ctx)
	if err != nil {
		releasePoolSlot()
		return nil, false, errMarketingSyncOrganizationLock
	}

	lockKey := marketingSyncOrganizationLockPrefix + organizationID
	var acquired bool
	if err := connection.QueryRow(ctx, `
		select pg_try_advisory_lock(hashtextextended($1, 0))
	`, lockKey).Scan(&acquired); err != nil {
		// The server may have acquired the session lock before a cancellation or
		// network error became visible to the client. Never return that uncertain
		// physical connection to the pool.
		closeMarketingSyncLockConnection(connection)
		releasePoolSlot()
		return nil, false, errMarketingSyncOrganizationLock
	}
	if !acquired {
		connection.Release()
		releasePoolSlot()
		return nil, false, nil
	}

	var once sync.Once
	release := func() {
		once.Do(func() {
			defer releasePoolSlot()
			unlockContext, cancel := context.WithTimeout(context.Background(), marketingSyncOrganizationUnlockTimeout)
			defer cancel()
			var unlocked bool
			unlockErr := connection.QueryRow(unlockContext, `
				select pg_advisory_unlock(hashtextextended($1, 0))
			`, lockKey).Scan(&unlocked)
			if unlockErr == nil && unlocked {
				connection.Release()
				return
			}

			// A connection with unknown session state must not re-enter the pool.
			// Closing it also makes PostgreSQL release the advisory lock.
			closeMarketingSyncLockConnection(connection)
		})
	}
	return release, true, nil
}

func closeMarketingSyncLockConnection(connection *pgxpool.Conn) {
	if connection == nil {
		return
	}
	closeContext, cancel := context.WithTimeout(context.Background(), marketingSyncOrganizationUnlockTimeout)
	defer cancel()
	underlying := connection.Hijack()
	_ = underlying.Close(closeContext)
}

// tryAcquireLocalMarketingSync avoids waiting for a pool slot when the same
// API replica already owns the organization lock. PostgreSQL remains the
// authority for conflicts across replicas.
func (service *MarketingSyncService) tryAcquireLocalMarketingSync(organizationID string) (func(), bool) {
	organizationID = strings.TrimSpace(organizationID)
	if service == nil || organizationID == "" {
		return nil, false
	}
	if _, loaded := service.localOrganizationSyncs.LoadOrStore(organizationID, struct{}{}); loaded {
		return nil, false
	}

	var once sync.Once
	return func() {
		once.Do(func() {
			service.localOrganizationSyncs.Delete(organizationID)
		})
	}, true
}
