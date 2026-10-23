package roundrobin

import "context"

// Structural capacity deliberately ignores clocks: availability at the exact
// instant of distribution is handled by the canonical picker. Count each user
// once, including participants the current editor may only preserve/read.
func (repo Repository) queueEligibleUserCount(ctx context.Context, q queryer, organizationID, queueID string) (int, error) {
	var count int
	err := q.QueryRow(ctx, `
		with entries as (
			select rrm.organization_id, rrm.user_id, rrm.team_id, rrm.membership_generation
			from public.round_robin_members rrm
			where rrm.organization_id = $1::uuid
			  and rrm.round_robin_id = $2::uuid
			  and coalesce(rrm.is_active, true) = true
		), candidates as (
			select e.organization_id, e.user_id, e.membership_generation
			from entries e
			where e.user_id is not null
			  and (e.team_id is null or exists (
			    select 1 from public.teams t
			    join public.team_members tm
			      on tm.team_id = t.id and tm.organization_id = e.organization_id
			     and tm.user_id = e.user_id
			     and tm.membership_generation = e.membership_generation
			     and coalesce(tm.is_active, true) = true
			    where t.id = e.team_id and t.organization_id = e.organization_id
			      and coalesce(t.is_active, true) = true
			  ))
			union all
			select e.organization_id, tm.user_id, tm.membership_generation
			from entries e
			join public.teams t
			  on t.id = e.team_id and t.organization_id = e.organization_id
			 and coalesce(t.is_active, true) = true
			join public.team_members tm
			  on tm.team_id = e.team_id and tm.organization_id = e.organization_id
			 and coalesce(tm.is_active, true) = true
			where e.user_id is null and e.team_id is not null
		)
		select count(distinct c.user_id)::int
		from candidates c
		join public.organization_members om
		  on om.organization_id = c.organization_id and om.user_id = c.user_id
		 and om.membership_generation = c.membership_generation
		 and om.is_active = true and om.deleted_at is null
		join public.users u on u.id = c.user_id and u.is_active is true
	`, organizationID, queueID).Scan(&count)
	return count, err
}
