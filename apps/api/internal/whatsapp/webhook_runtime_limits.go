package whatsapp

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	nativeWebhookItemTimeout = 45 * time.Second
	webhookRecoveryTimeout   = 20 * time.Second
	webhookCompletionTimeout = 5 * time.Second
	webhookRollbackTimeout   = 2 * time.Second
)

func webhookCompletionContext(parent context.Context) (context.Context, context.CancelFunc) {
	// Cancellation must roll back the native transaction first, then release
	// its durable lease using a fresh bounded context, including during shutdown.
	return context.WithTimeout(context.WithoutCancel(parent), webhookCompletionTimeout)
}

func rollbackWebhookTx(tx pgx.Tx) {
	ctx, cancel := context.WithTimeout(context.Background(), webhookRollbackTimeout)
	defer cancel()
	connection := tx.Conn().PgConn()
	err := tx.Rollback(ctx)
	if err != nil && !errors.Is(err, pgx.ErrTxClosed) && connection.IsClosed() {
		// pgx cancellation may close the socket while PostgreSQL still waits on
		// a row lock. Cancel only that closed connection's backend, never a
		// reused live connection, so shutdown cannot leave its TX waiting for EOF.
		_ = connection.CancelRequest(ctx)
	}
}

func (repo Repository) beginNativeWebhookTx(ctx context.Context) (pgx.Tx, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `set local lock_timeout = '2s'; set local statement_timeout = '20s'`); err != nil {
		rollbackWebhookTx(tx)
		return nil, err
	}
	return tx, nil
}
