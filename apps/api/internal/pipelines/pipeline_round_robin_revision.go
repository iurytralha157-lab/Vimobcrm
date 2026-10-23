package pipelines

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Queue deletion owns its queue rows before clearing pipeline fallbacks. Never
// wait for that queue while holding this pipeline: SKIP LOCKED makes the caller
// roll back and release its parent so the other configuration writer can finish.
// SHARE protects active/deleted flags through the subsequent FK write/commit.
func lockPipelineRoundRobinReference(ctx context.Context, tx pgx.Tx, organizationID, queueID string) error {
	var active bool
	var locked pgtype.Text
	err := tx.QueryRow(ctx, `select
		exists(select 1 from public.round_robins queue
		  where queue.organization_id=$1::uuid and queue.id=$2::uuid
		    and coalesce(queue.is_active,true) and queue.deleted_at is null),
		(select queue.id::text from public.round_robins queue
		  where queue.organization_id=$1::uuid and queue.id=$2::uuid
		    and coalesce(queue.is_active,true) and queue.deleted_at is null
		  for share skip locked)`, organizationID, queueID).Scan(&active, &locked)
	if err != nil {
		return err
	}
	if !active {
		return ErrInvalidReference
	}
	if !locked.Valid {
		return ErrRoundRobinBusy
	}
	return nil
}
