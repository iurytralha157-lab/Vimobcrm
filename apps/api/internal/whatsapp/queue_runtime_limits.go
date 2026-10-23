package whatsapp

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	whatsappQueueItemTimeout       = 2 * time.Minute
	whatsappQueueDatabaseTimeout   = 20 * time.Second
	whatsappQueueHeartbeatTimeout  = 5 * time.Second
	whatsappQueueCompletionTimeout = 5 * time.Second
	whatsappQueueRollbackTimeout   = 2 * time.Second
)

func whatsappQueueCompletionContext(parent context.Context) (context.Context, context.CancelFunc) {
	// Reconcile only the owned durable lease after the operation stops. A server
	// shutdown or item deadline must not cancel this short database-only cleanup.
	return context.WithTimeout(context.WithoutCancel(parent), whatsappQueueCompletionTimeout)
}

func (repo Repository) beginWhatsAppQueueWorkerTx(parent context.Context) (context.Context, pgx.Tx, func(), error) {
	return beginWhatsAppQueueTransaction(parent, repo.db.Pool().Begin)
}

func beginWhatsAppQueueTransaction(parent context.Context, begin func(context.Context) (pgx.Tx, error)) (context.Context, pgx.Tx, func(), error) {
	ctx, cancel := context.WithTimeout(parent, whatsappQueueDatabaseTimeout)
	tx, err := begin(ctx)
	if err != nil {
		cancel()
		return nil, nil, nil, err
	}
	release := func() {
		rollbackWhatsAppQueueTx(tx)
		cancel()
	}
	if _, err := tx.Exec(ctx, `set local lock_timeout = '2s'; set local statement_timeout = '20s'`); err != nil {
		release()
		return nil, nil, nil, err
	}
	return ctx, tx, release, nil
}

func rollbackWhatsAppQueueTx(tx pgx.Tx) {
	// Capture this exact backend before Rollback can release the pooled handle.
	// Never cancel a reused live connection. Reserve half the cleanup budget for
	// the closed socket's cancellation packet if PostgreSQL is still in a wait.
	var connection *pgconn.PgConn
	if conn := tx.Conn(); conn != nil {
		connection = conn.PgConn()
	}
	ctx, cancel := context.WithTimeout(context.Background(), whatsappQueueRollbackTimeout)
	defer cancel()
	rollbackCtx, cancelRollback := context.WithTimeout(ctx, whatsappQueueRollbackTimeout/2)
	err := tx.Rollback(rollbackCtx)
	cancelRollback()
	if err != nil && !errors.Is(err, pgx.ErrTxClosed) && connection != nil && connection.IsClosed() {
		_ = connection.CancelRequest(ctx)
	}
}

func whatsappQueueOperationTimedOut(err error) bool {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var sqlError *pgconn.PgError
	return errors.As(err, &sqlError) && (sqlError.Code == "55P03" || sqlError.Code == "57014")
}
