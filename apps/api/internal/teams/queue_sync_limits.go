package teams

import "context"

// Queue positions are stored as PostgreSQL int4, independently of Go's int size.
const maxQueueParticipantPosition = int64(1<<31 - 1)

func teamQueueParticipantCount(ctx context.Context, q queryRowExecutor, organizationID, queueID string) (int64, error) {
	var count int64
	err := q.QueryRow(ctx, `
		select count(*)
		from public.round_robin_members
		where organization_id = $1::uuid and round_robin_id = $2::uuid
	`, organizationID, queueID).Scan(&count)
	return count, err
}

func teamQueueUserExists(ctx context.Context, q queryRowExecutor, organizationID, queueID, userID string) (bool, error) {
	var exists bool
	err := q.QueryRow(ctx, `
		select exists (
			select 1 from public.round_robin_members
			where organization_id = $1::uuid and round_robin_id = $2::uuid and user_id = $3::uuid
		)
	`, organizationID, queueID, userID).Scan(&exists)
	return exists, err
}
