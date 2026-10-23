package schedule

import (
	"context"
	"fmt"
)

const maxScheduleAssignees = 100

// The caller must already hold the event row lock, serializing concurrent
// additions. An existing assignee remains an idempotent no-op at the limit.
func validateScheduleAssigneeAddition(ctx context.Context, queryer queryRower, organizationID, eventID, userID string) error {
	var count int
	var alreadyAssigned bool
	if err := queryer.QueryRow(ctx, `
		select count(*)::integer,
		       coalesce(bool_or(user_id = $3::uuid), false)
		from public.schedule_event_assignees
		where organization_id = $1::uuid and event_id = $2::uuid
	`, organizationID, eventID, userID).Scan(&count, &alreadyAssigned); err != nil {
		return err
	}
	if count >= maxScheduleAssignees && !alreadyAssigned {
		return fmt.Errorf("%w: assignee_ids exceeds limit", ErrInvalidInput)
	}
	return nil
}
