package properties

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

var errPropertySavepointFailed = errors.New("property savepoint could not be recovered")

// PostgreSQL leaves a transaction aborted after a statement error. A nested
// pgx transaction is a SAVEPOINT, allowing optional work to fail safely without
// turning the primary property mutation into an unexplained commit failure.
func optionalPropertyTransaction(ctx context.Context, tx pgx.Tx, work func(pgx.Tx) error) error {
	optional, err := tx.Begin(ctx)
	if err != nil {
		return fmt.Errorf("%w: %v", errPropertySavepointFailed, err)
	}
	if err := work(optional); err != nil {
		if rollbackErr := optional.Rollback(ctx); rollbackErr != nil {
			return fmt.Errorf("%w: optional operation: %v; rollback: %v", errPropertySavepointFailed, err, rollbackErr)
		}
		return err
	}
	if err := optional.Commit(ctx); err != nil {
		return fmt.Errorf("%w: %v", errPropertySavepointFailed, err)
	}
	return nil
}
