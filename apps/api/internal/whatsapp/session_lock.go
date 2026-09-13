package whatsapp

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const whatsappSessionUnlockTimeout = 3 * time.Second
const whatsappSessionLockRetryInterval = 50 * time.Millisecond

// A lifecycle lock keeps one pool connection reserved while the operation uses
// the regular application pool. One mutation holder per process prevents a
// reconnect/delete burst from amplifying provider or database failures.
var whatsappSessionMutationPermit = make(chan struct{}, 1)

// Read-only status probes use a separate, deliberately small lane. They still
// take the same per-session advisory lock, so a probe can never race a mutation
// for that session, but one slow provider status request no longer blocks every
// unrelated logout/delete/recreate in the API process. Two holders plus the
// mutation holder leave headroom under the documented DATABASE_MAX_CONNS=8.
var whatsappSessionProbePermit = make(chan struct{}, 2)

// acquireWhatsAppSessionLock serializes provider lifecycle mutations for one
// session across API replicas. Explicit user actions wait; status/supervisor
// probes use acquireWhatsAppSessionProbeLock and still share this advisory key.
func (repo Repository) acquireWhatsAppSessionLock(ctx context.Context, sessionID string, wait bool) (func(), bool, error) {
	return repo.acquireWhatsAppAdvisoryLocksWithPermit(
		ctx,
		[]string{whatsappSessionAdvisoryLockKey(sessionID)},
		wait,
		whatsappSessionMutationPermit,
	)
}

func (repo Repository) acquireWhatsAppSessionProbeLock(ctx context.Context, sessionID string, wait bool) (func(), bool, error) {
	return repo.acquireWhatsAppAdvisoryLocksWithPermit(
		ctx,
		[]string{whatsappSessionAdvisoryLockKey(sessionID)},
		wait,
		whatsappSessionProbePermit,
	)
}

// acquireWhatsAppSessionCreateLock takes the organization create fence before
// the new session fence. The organization key serializes quota admission across
// API replicas, while the session key is exactly the key used by delete,
// recreate, logout and probes once the row is visible. Both are session-level
// PostgreSQL advisory locks; no database transaction is held during provider IO.
func (repo Repository) acquireWhatsAppSessionCreateLock(ctx context.Context, organizationID string, sessionID string, wait bool) (func(), bool, error) {
	return repo.acquireWhatsAppAdvisoryLocksWithPermit(
		ctx,
		whatsappSessionCreateAdvisoryLockKeys(organizationID, sessionID),
		wait,
		whatsappSessionMutationPermit,
	)
}

func whatsappSessionAdvisoryLockKey(sessionID string) string {
	return "vimob:whatsapp-session:" + canonicalWhatsAppLockID(sessionID)
}

func whatsappOrganizationCreateAdvisoryLockKey(organizationID string) string {
	return "vimob:whatsapp-session-create-org:" + canonicalWhatsAppLockID(organizationID)
}

func canonicalWhatsAppLockID(value string) string {
	if normalized, ok := normalizeUUID(value); ok {
		return normalized
	}
	return strings.ToLower(strings.TrimSpace(value))
}

func whatsappSessionCreateAdvisoryLockKeys(organizationID string, sessionID string) []string {
	return []string{
		whatsappOrganizationCreateAdvisoryLockKey(organizationID),
		whatsappSessionAdvisoryLockKey(sessionID),
	}
}

func (repo Repository) acquireWhatsAppAdvisoryLocksWithPermit(ctx context.Context, lockKeys []string, wait bool, permit chan struct{}) (func(), bool, error) {
	if wait {
		select {
		case permit <- struct{}{}:
		case <-ctx.Done():
			return nil, false, ctx.Err()
		}
	} else {
		select {
		case permit <- struct{}{}:
		default:
			return func() {}, false, nil
		}
	}
	releasePermit := func() { <-permit }

	var conn *pgxpool.Conn
	for {
		candidate, err := repo.db.Pool().Acquire(ctx)
		if err != nil {
			releasePermit()
			return nil, false, err
		}

		acquiredKeys := make([]string, 0, len(lockKeys))
		allLocked := true
		for _, lockKey := range lockKeys {
			var locked bool
			err = candidate.QueryRow(ctx, `select pg_try_advisory_lock(hashtextextended($1, 0))`, lockKey).Scan(&locked)
			if err != nil {
				releaseWhatsAppAdvisoryConnection(candidate, acquiredKeys)
				releasePermit()
				return nil, false, err
			}
			if !locked {
				allLocked = false
				break
			}
			acquiredKeys = append(acquiredKeys, lockKey)
		}
		if allLocked {
			conn = candidate
			break
		}
		releaseWhatsAppAdvisoryConnection(candidate, acquiredKeys)
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
			releaseWhatsAppAdvisoryConnection(conn, lockKeys)
		})
	}
	return unlock, true, nil
}

func releaseWhatsAppAdvisoryConnection(conn *pgxpool.Conn, lockKeys []string) {
	if conn == nil {
		return
	}
	if len(lockKeys) == 0 {
		conn.Release()
		return
	}

	unlockCtx, cancel := context.WithTimeout(context.Background(), whatsappSessionUnlockTimeout)
	defer cancel()
	for index := len(lockKeys) - 1; index >= 0; index-- {
		var released bool
		if err := conn.QueryRow(unlockCtx, `select pg_advisory_unlock(hashtextextended($1, 0))`, lockKeys[index]).Scan(&released); err != nil || !released {
			// Never return a physical connection with an unknown advisory-lock
			// state to the pool. Closing a hijacked connection makes PostgreSQL
			// release every session-level advisory lock owned by it.
			rawConn := conn.Hijack()
			closeCtx, closeCancel := context.WithTimeout(context.Background(), whatsappSessionUnlockTimeout)
			_ = rawConn.Close(closeCtx)
			closeCancel()
			return
		}
	}
	conn.Release()
}
