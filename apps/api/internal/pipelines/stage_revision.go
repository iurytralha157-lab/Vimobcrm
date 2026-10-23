package pipelines

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// Parent pipeline and stage are already locked in their established order.
// Compare before qualification changes or archive checks can have side effects.
func lockStageUpdateRevision(ctx context.Context, tx pgx.Tx, organizationID, stageID string, expected *time.Time) error {
	if expected == nil || expected.IsZero() {
		return ErrStagesChanged
	}
	var current time.Time
	err := tx.QueryRow(ctx, `select updated_at from public.stages
	  where organization_id = $1::uuid and id = $2::uuid for update`, organizationID, stageID).Scan(&current)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrStageNotFound
	}
	if err != nil {
		return err
	}
	if !current.Equal(*expected) {
		return ErrStagesChanged
	}
	return nil
}
