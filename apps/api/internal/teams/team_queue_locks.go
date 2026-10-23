package teams

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// The same advisory fence as queue editors must precede the team aggregate lock.
// It prevents a newly created queue from appearing between the initial parent
// locks and the later legacy sync, which could otherwise invert UUID lock order.
func lockTeamQueueDomain(ctx context.Context, tx pgx.Tx, organizationID string) error {
	_, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended('round_robin_conditions:' || $1::text, 0))`, organizationID)
	return err
}

// Queue editors lock organization queue parents in UUID order. Take this team's
// subset in that same order before roster dependencies or any child writes.
// The team's existing NO KEY UPDATE lock permits queue FK key-share locks.
func lockTeamQueueParents(ctx context.Context, tx pgx.Tx, organizationID, teamID string) error {
	rows, err := tx.Query(ctx, `
		select queue.id::text
		from public.round_robins queue
		where queue.organization_id = $1::uuid
		  and exists (
		    select 1 from public.round_robin_members member
		    where member.organization_id = $1::uuid
		      and member.round_robin_id = queue.id
		      and member.team_id = $2::uuid
		  )
		order by queue.id
		for update of queue
	`, organizationID, teamID)
	if err != nil {
		return err
	}
	_, err = collectTeamUUIDs(rows)
	return err
}
