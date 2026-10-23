package schedule

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/leadscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// A creation retry may confirm only the pristine submitted event. Its linked
// entities are live rows: independently enforce their CURRENT read scopes in
// this query, even if a preflight validation had authorized them earlier.
func loadScheduleCreateReplayEvent(ctx context.Context, queryer queryRower, actor tenant.Context, eventID string) (Event, error) {
	args := scheduleEventsQueryArgs(actor, true)
	args = append(args, eventID, leadscope.CanRead(actor))
	leadJoin := `left join public.leads l
		on l.id = v.lead_id and l.organization_id = v.organization_id
		and $12::boolean
		and ` + leadVisibilitySQL("$4", "$5", "$6", actor.HasPermission(permissions.LeadViewOwn))
	query := scheduleEventsQueryWithLeadJoin("se.organization_id = $1::uuid and se.id = $11::uuid", leadJoin)
	event, err := scanEvent(queryer.QueryRow(ctx, query, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return Event{}, ErrScheduleConflict
	}
	return event, err
}
