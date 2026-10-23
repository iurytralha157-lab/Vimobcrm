package roundrobin

import (
	"context"

	"github.com/jackc/pgx/v5/pgconn"
)

func updateReconciledMember(ctx context.Context, q queryer, organizationID, queueID string, mutation memberReconcileMutation) (pgconn.CommandTag, error) {
	// UPDATE OF is_active binds the current membership generation even when
	// its value remains true. Never mention that column in ordinary edits.
	activeAssignment, activePredicate := "", "$6::boolean"
	activeArgument := false
	if mutation.ActiveSet {
		activeAssignment, activePredicate = ", is_active = $6", "true"
		activeArgument = mutation.IsActive
	}
	return q.Exec(ctx, `
		update public.round_robin_members
		set weight = $4,
		    position = $5`+activeAssignment+`,
		    updated_at = now()
		where organization_id = $1::uuid
		  and round_robin_id = $2::uuid
		  and id = $3::uuid
		  and (
		    coalesce(weight, 1) is distinct from $4
		    or coalesce(position, 0) is distinct from $5
		    or `+activePredicate+`
		  )
	`, organizationID, queueID, mutation.ID, mutation.Weight, mutation.Position, activeArgument)
}
