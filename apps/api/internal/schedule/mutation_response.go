package schedule

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func validateExpectedScheduleVersion(current eventSnapshot, expected *time.Time) error {
	if expected != nil && !expected.Equal(current.UpdatedAt) {
		return ErrScheduleConflict
	}
	return nil
}

// Only use inside a command transaction after authorization and validation.
// Returning the command's own persisted result does not grant future read
// access to an appointment the caller delegated privately to someone else.
// Load before commit: a projection failure must roll the command back rather
// than report a failed operation after its side effects have been committed.
func loadScheduleMutationEvent(ctx context.Context, queryer queryRower, actor tenant.Context, eventID string) (Event, error) {
	args := scheduleEventsQueryArgs(actor, true)
	args = append(args, eventID)
	where := "se.organization_id = $1::uuid and se.id = $11::uuid and " + scheduleEventListLeadVisibilitySQL("$3", "$2", "$4", "$5", "$6", actor.HasPermission(permissions.LeadViewOwn))
	event, err := scanEvent(queryer.QueryRow(ctx, scheduleEventsQuery(where, actor.HasPermission(permissions.LeadViewOwn)), args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return Event{}, ErrEventNotFound
	}
	return event, err
}
