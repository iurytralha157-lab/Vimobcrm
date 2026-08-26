package whatsapp

import (
	"context"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const whatsappSessionUnlockTimeout = 3 * time.Second
const whatsappSessionLockRetryInterval = 50 * time.Millisecond

// A lifecycle lock keeps one pool connection reserved while the operation uses
// the regular application pool. One holder per process guarantees that a burst
// across different session IDs cannot consume every database connection.
var whatsappSessionLockPermit = make(chan struct{}, 1)

// acquireWhatsAppSessionLock serializes provider lifecycle operations for one
// session across API replicas. The supervisor uses a non-blocking acquisition;
// explicit user actions wait so logout/delete/recreate cannot race recovery.
func (repo Repository) acquireWhatsAppSessionLock(ctx context.Context, sessionID string, wait bool) (func(), bool, error) {
	if wait {
		select {
		case whatsappSessionLockPermit <- struct{}{}:
		case <-ctx.Done():
			return nil, false, ctx.Err()
		}
	} else {
		select {
		case whatsappSessionLockPermit <- struct{}{}:
		default:
			return func() {}, false, nil
		}
	}
	releasePermit := func() { <-whatsappSessionLockPermit }

	lockKey := "vimob:whatsapp-session:" + sessionID
	var conn *pgxpool.Conn
	for {
		candidate, err := repo.db.Pool().Acquire(ctx)
		if err != nil {
			releasePermit()
			return nil, false, err
		}

		var locked bool
		err = candidate.QueryRow(ctx, `select pg_try_advisory_lock(hashtextextended($1, 0))`, lockKey).Scan(&locked)
		if err != nil {
			candidate.Release()
			releasePermit()
			return nil, false, err
		}
		if locked {
			conn = candidate
			break
		}
		candidate.Release()
		if !wait {
			releasePermit()
			return func() {}, false, nil
		}

		// Waiting happens outside the database pool. A blocking advisory-lock
		// query would let enough concurrent UI polls occupy every connection and
		// starve the operation currently holding the lock.
		timer := time.NewTimer(whatsappSessionLockRetryInterval)
		select {
		case <-ctx.Done():
			timer.Stop()
			releasePermit()
			return nil, false, ctx.Err()
		case <-timer.C:
		}
	}

	var once sync.Once
	unlock := func() {
		once.Do(func() {
			defer releasePermit()
			unlockCtx, cancel := context.WithTimeout(context.Background(), whatsappSessionUnlockTimeout)
			var released bool
			unlockErr := conn.QueryRow(unlockCtx, `select pg_advisory_unlock(hashtextextended($1, 0))`, lockKey).Scan(&released)
			cancel()
			if unlockErr == nil && released {
				conn.Release()
				return
			}

			// Never return a physical connection with an unknown session-lock
			// state to the pool. Closing a hijacked connection makes PostgreSQL
			// release every session-level advisory lock owned by it.
			rawConn := conn.Hijack()
			closeCtx, closeCancel := context.WithTimeout(context.Background(), whatsappSessionUnlockTimeout)
			defer closeCancel()
			_ = rawConn.Close(closeCtx)
		})
	}
	return unlock, true, nil
}
