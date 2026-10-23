package leads

import "context"

// The caller must already hold the lead's write lock. A separate statement is
// required: a STABLE pool lookup inside SELECT ... FOR UPDATE can retain the
// pre-wait snapshot even when PostgreSQL returns the newly updated lead row.
func queuePoolAccessAfterLeadLock(ctx context.Context, queryer leadTeamQueryer, organizationID, leadID string, actorID *string) (*bool, error) {
	var access *bool
	err := queryer.QueryRow(ctx, `select private.queue_pool_read_access($1::uuid,$2::uuid,$3::uuid)`,
		organizationID, leadID, actorID).Scan(&access)
	return access, err
}
