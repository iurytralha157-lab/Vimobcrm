package publications

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/developments"
)

var errPublicationInventoryLock = errors.New("publication inventory lock failed")

// Property deletion locks property before cascading to its jobs. Follow the
// same order, including inventory parents, then recheck the current job lease.
// A reclaimed/deleted job never writes source or canonical state after waiting.
func lockPublicationJobSource(ctx context.Context, tx pgx.Tx, job pendingJob, workerID string, lease time.Duration) (bool, error) {
	if lease <= 0 {
		return false, fmt.Errorf("%w: invalid publication claim lease", errPublicationInventoryLock)
	}
	if err := developments.LockPropertyInventory(ctx, tx, job.OrganizationID, job.PropertyID); err != nil {
		return false, fmt.Errorf("%w: %w", errPublicationInventoryLock, err)
	}
	return jobFenceValid(ctx, tx, job, workerID, lease)
}
