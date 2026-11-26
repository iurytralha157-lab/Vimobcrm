package leads

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type contactRedistributionRecipient struct {
	MemberID         string
	UserID           string
	Position         int64
	CreatedAt        time.Time
	PreviousCursorAt time.Time
}

// Existing queue rules supply the audience. The cursor comes from the last
// confirmed manual handoff, so rejected requests and retries never consume a turn.
const contactRedistributionRecipientSQL = `
	with selected_queue as materialized (
		select queue.settings, $5::timestamptz as at
		from public.round_robins queue
		where queue.organization_id = $1::uuid and queue.id = $2::uuid
	), queue_clock as materialized (
		select settings, at, private.queue_window($1::uuid, $2::uuid, at) as window
		from selected_queue
	), eligible as (
		select candidate.member_id, candidate.user_id, candidate.position, candidate.candidate_created_at as member_created_at
		from queue_clock q
		cross join lateral private.round_robin_rotation_candidates(
			$1::uuid, $2::uuid, lower(coalesce(q.settings->>'ignore_availability', 'false')) in ('1', 'true', 'yes'),
			$6::integer, $7::time, nullif($3, '')::uuid
		) candidate
		where q.window->>'managed' = 'false' and q.window->>'open' = 'true'
		union all
		select candidate.member_id, candidate.user_id, candidate.position, coalesce(tm.created_at, entry.created_at)
		from queue_clock q cross join lateral private.queue_runtime_members($1::uuid, $2::uuid, q.at) candidate
		join public.round_robin_members entry on entry.organization_id = $1::uuid and entry.id = candidate.member_id
		left join public.team_members tm on tm.organization_id = $1::uuid and tm.id = candidate.team_member_id
		where q.window->>'managed' = 'true' and q.window->>'open' = 'true' and candidate.is_available
		  and (nullif($3, '') is null or exists (
			select 1 from public.team_members tm
			join public.teams team on team.id = tm.team_id and team.organization_id = tm.organization_id and coalesce(team.is_active, true)
			join public.organization_members om on om.organization_id = tm.organization_id and om.user_id = tm.user_id
				and om.is_active and om.deleted_at is null and om.membership_generation = tm.membership_generation
			where tm.organization_id = $1::uuid and tm.team_id = nullif($3, '')::uuid and tm.user_id = candidate.user_id
			  and coalesce(tm.is_active, true)
		  ))
	), last_assignment as (
		select event.candidate_position as position, (event.result->>'memberId')::uuid as member_id,
		       event.assigned_user_id as user_id, (event.result->>'candidateCreatedAt')::timestamptz as member_created_at,
		       event.created_at
		from private.lead_distribution_events event
		where event.organization_id = $1::uuid and event.round_robin_id = $2::uuid and event.source = $4
		order by event.created_at desc, event.id desc
		limit 1
	)
	select candidate.member_id::text, candidate.user_id::text, candidate.position, candidate.member_created_at,
	       coalesce(previous.created_at, 'epoch'::timestamptz)
	from eligible candidate
	left join last_assignment previous on true
	join public.organization_members membership on membership.organization_id = $1::uuid and membership.user_id = candidate.user_id
		and membership.is_active and membership.deleted_at is null
	join public.users profile on profile.id = candidate.user_id and profile.is_active
	order by coalesce((candidate.position, candidate.member_id, candidate.member_created_at, candidate.user_id)
		<= (previous.position, previous.member_id, previous.member_created_at, previous.user_id), false),
		candidate.position, candidate.member_id, candidate.member_created_at, candidate.user_id
	limit 1
	for share of membership, profile nowait
`

func selectContactRedistributionRecipient(ctx context.Context, tx pgx.Tx, organizationID, queueID, teamID string) (contactRedistributionRecipient, error) {
	var result contactRedistributionRecipient
	const fallback = "America/Sao_Paulo"
	var timezone string
	var at time.Time
	if err := tx.QueryRow(ctx, `select clock_timestamp(),
		coalesce(nullif(btrim(queue.settings->>'timezone'), ''), nullif(btrim(org.timezone), ''), $3)
		from public.round_robins queue
		left join public.organization_attention_settings org on org.organization_id = queue.organization_id
		where queue.organization_id = $1::uuid and queue.id = $2::uuid`, organizationID, queueID, fallback).
		Scan(&at, &timezone); err != nil {
		return result, err
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		location, err = time.LoadLocation(fallback)
		if err != nil {
			return result, err
		}
	}
	localTime := at.In(location)
	err = tx.QueryRow(ctx, contactRedistributionRecipientSQL, organizationID, queueID, teamID, manualQueueRedistribution,
		at, int(localTime.Weekday()), localTime.Format("15:04:05.999999")).
		Scan(&result.MemberID, &result.UserID, &result.Position, &result.CreatedAt, &result.PreviousCursorAt)
	return result, err
}

func isContactRedistributionContention(err error) bool {
	var postgresErr *pgconn.PgError
	return errors.Is(err, errRedistributionLeadBusy) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) ||
		(errors.As(err, &postgresErr) && (postgresErr.Code == "55P03" || postgresErr.Code == "40001" || postgresErr.Code == "40P01"))
}
