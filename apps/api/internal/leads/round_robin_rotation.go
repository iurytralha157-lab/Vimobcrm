package leads

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// The database owns the per-lead rotation and locks the lead before its state.
// A preview never consumes the next recipient: only a committed assignment does.
func (repo Repository) selectRoundRobinMemberForRedistribution(
	ctx context.Context,
	queryer leadTeamQueryer,
	organizationID, leadID, roundRobinID, excludedUserID, requiredTeamID string,
) (roundRobinSelection, string, error) {
	selection := roundRobinSelection{RoundRobinID: roundRobinID}
	err := queryer.QueryRow(ctx, `
		select candidate.member_id::text, candidate.user_id::text
		from private.preview_round_robin_redistribution_candidate(
			$1::uuid, $2::uuid, $3::uuid,
			nullif($4, '')::uuid, nullif($5, '')::uuid
		) candidate
	`, organizationID, leadID, roundRobinID, excludedUserID, requiredTeamID).Scan(&selection.MemberID, &selection.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return roundRobinSelection{}, "no_next_member", nil
	}
	if err != nil {
		return roundRobinSelection{}, "", err
	}
	return selection, "", nil
}

// Prefer the lead's most recent confirmed queue, then its immutable intake
// queue. A known inactive/empty queue must not silently route to another queue.
// The caller already holds the lead lock; no queue lock is needed to balance
// redistribution, which no longer consumes the initial weighted ticket.
func (repo Repository) selectRoundRobinMember(
	ctx context.Context,
	queryer leadTeamQueryer,
	organizationID string,
	current leadSnapshot,
) (roundRobinSelection, string, error) {
	originQueueID, _ := normalizeUUID(stringFromMap(current.Data, "origin_round_robin_id"))
	var roundRobinID string
	err := queryer.QueryRow(ctx, `
		with latest_assignment_queue as (
			select log.round_robin_id
			from public.round_robin_logs log
			where log.organization_id = $1::uuid
			  and log.lead_id = $2::uuid
			  and log.assigned_user_id is not null
			  and log.round_robin_id is not null
			  and private.is_round_robin_rotation_assignment_reason(log.reason)
			order by log.created_at desc, log.id desc
			limit 1
		), known_queue as (
			select round_robin_id from latest_assignment_queue
			union all
			select nullif($4, '')::uuid
			where nullif($4, '') is not null
			  and not exists (select 1 from latest_assignment_queue)
		)
		select queue.id::text
		from public.round_robins queue
		where queue.organization_id = $1::uuid
		  and queue.is_active = true
		  and case when exists (select 1 from known_queue)
		    then queue.id = (select round_robin_id from known_queue)
		    else (queue.pipeline_id is null or queue.pipeline_id = $3::uuid)
		  end
		order by queue.pipeline_id is null, queue.created_at asc, queue.id
		limit 1
	`, organizationID, current.ID, nullableString(current.PipelineID), originQueueID).Scan(&roundRobinID)
	if errors.Is(err, pgx.ErrNoRows) {
		return roundRobinSelection{}, "no_queue", nil
	}
	if err != nil {
		return roundRobinSelection{}, "", err
	}
	selection, reason, err := repo.selectRoundRobinMemberForRedistribution(
		ctx, queryer, organizationID, current.ID, roundRobinID, current.AssignedUserID, current.TeamID,
	)
	if reason == "no_next_member" {
		reason = "no_member"
	}
	return selection, reason, err
}
