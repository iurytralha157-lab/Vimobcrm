package distribution

// RoundRobinAvailabilityPredicateSQL filters a `candidates` CTE that exposes
// organization_id, user_id and team_member_id. Team-backed candidates keep the
// schedule of their specific membership. Direct queue members have no
// team_member_id, so every active membership in the same active organization
// team becomes a possible schedule source.
//
// The first EXISTS intentionally has no availability.is_active predicate: once
// a schedule was configured, even an entirely disabled week is a real schedule
// and must not silently fall back to 24-hour distribution.
const RoundRobinAvailabilityPredicateSQL = `(
	not exists (
		select 1
		from public.team_members availability_member
		join public.teams availability_team
		  on availability_team.id = availability_member.team_id
		 and availability_team.organization_id = availability_member.organization_id
		 and coalesce(availability_team.is_active, true) = true
		join public.member_availability availability_any
		  on availability_any.organization_id = availability_member.organization_id
		 and availability_any.team_member_id = availability_member.id
		where availability_member.organization_id = candidates.organization_id
		  and availability_member.user_id = candidates.user_id
		  and coalesce(availability_member.is_active, true) = true
		  and (
			candidates.team_member_id is null
			or availability_member.id = candidates.team_member_id
		  )
	)
	or exists (
		select 1
		from public.team_members availability_member
		join public.teams availability_team
		  on availability_team.id = availability_member.team_id
		 and availability_team.organization_id = availability_member.organization_id
		 and coalesce(availability_team.is_active, true) = true
		join public.member_availability availability
		  on availability.organization_id = availability_member.organization_id
		 and availability.team_member_id = availability_member.id
		where availability_member.organization_id = candidates.organization_id
		  and availability_member.user_id = candidates.user_id
		  and coalesce(availability_member.is_active, true) = true
		  and (
			candidates.team_member_id is null
			or availability_member.id = candidates.team_member_id
		  )
		  and coalesce(availability.is_active, true) = true
		  and (
			(
				availability.day_of_week = extract(dow from now() at time zone 'America/Sao_Paulo')::int
				and (
					coalesce(availability.is_all_day, false) = true
					or (
						availability.start_time is not null
						and availability.end_time is not null
						and availability.start_time < availability.end_time
						and (now() at time zone 'America/Sao_Paulo')::time >= availability.start_time
						and (now() at time zone 'America/Sao_Paulo')::time <= availability.end_time
					)
				)
			)
			or (
				availability.start_time is not null
				and availability.end_time is not null
				and availability.start_time > availability.end_time
				and (
					(
						availability.day_of_week = extract(dow from now() at time zone 'America/Sao_Paulo')::int
						and (now() at time zone 'America/Sao_Paulo')::time >= availability.start_time
					)
					or (
						availability.day_of_week = (extract(dow from now() at time zone 'America/Sao_Paulo')::int + 6) % 7
						and (now() at time zone 'America/Sao_Paulo')::time <= availability.end_time
					)
				)
			)
		  )
	)
)`
