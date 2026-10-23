package distribution

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestRoundRobinAvailabilityPredicateScheduleSemantics(t *testing.T) {
	t.Parallel()

	predicate := strings.ToLower(RoundRobinAvailabilityPredicateSQL)
	requireContains(t, predicate,
		"from public.team_members availability_member",
		"join public.teams availability_team",
		"availability_team.organization_id = availability_member.organization_id",
		"coalesce(availability_team.is_active, true) = true",
		"availability_member.organization_id = candidates.organization_id",
		"availability_member.user_id = candidates.user_id",
		"coalesce(availability_member.is_active, true) = true",
		"candidates.team_member_id is null",
		"availability_member.id = candidates.team_member_id",
		"availability.day_of_week = extract(dow from now() at time zone 'america/sao_paulo')::int",
		"availability.day_of_week = (extract(dow from now() at time zone 'america/sao_paulo')::int + 6) % 7",
		"coalesce(availability.is_active, true) = true",
		"availability.start_time > availability.end_time",
		"coalesce(availability.is_all_day, false) = false",
	)
	if strings.Count(predicate, "availability.day_of_week = extract(dow from now() at time zone 'america/sao_paulo')::int") != 2 {
		t.Fatal("current-day schedule matching must cover normal and overnight start-day windows")
	}

	if strings.Count(predicate, "candidates.team_member_id is null") != 1 {
		t.Fatal("direct queue members must have one unconditional eligibility branch")
	}
	flattenedPredicate := strings.Join(strings.Fields(predicate), " ")
	if !strings.Contains(flattenedPredicate, "candidates.team_member_id is null or not exists") {
		t.Fatal("a null team_member_id must bypass schedules inherited from unrelated teams")
	}
	if strings.Contains(flattenedPredicate, "candidates.team_member_id is null or availability_member.id") {
		t.Fatal("team schedule lookups must be restricted to the candidate's exact membership")
	}

	matchStart := strings.Index(predicate, "\tor exists (")
	if matchStart < 0 {
		t.Fatal("availability predicate must contain the current-window EXISTS branch")
	}
	configuredScheduleBranch := predicate[:matchStart]
	matchingScheduleBranch := predicate[matchStart:]
	if strings.Contains(configuredScheduleBranch, "availability_any.is_active") {
		t.Fatal("configured-schedule detection must count disabled rows and prevent fail-open")
	}
	if !strings.Contains(matchingScheduleBranch, "coalesce(availability.is_active, true) = true") {
		t.Fatal("current-window matching must require an active schedule row")
	}
}

func TestAllDayLegacyClocksCannotExtendAvailabilityPastMidnight(t *testing.T) {
	predicate := strings.Join(strings.Fields(strings.ToLower(RoundRobinAvailabilityPredicateSQL)), " ")
	// Keep the same-day all-day branch, while rejecting retained 22:00/06:00
	// clocks only in the separate overnight branch. A global all-day rejection
	// would incorrectly make real 24-hour shifts unavailable.
	requireContains(t, predicate,
		"and ( coalesce(availability.is_all_day, false) = true or (",
		"or ( coalesce(availability.is_all_day, false) = false and availability.start_time is not null and availability.end_time is not null and availability.start_time > availability.end_time",
	)
}

func TestAllLegacyRoundRobinSelectorsUseSharedAvailabilityContract(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		path     string
		function string
	}{
		{
			name:     "manual lead",
			path:     filepath.Join("..", "leads", "round_robin_rotation.go"),
			function: "selectRoundRobinMember",
		},
		{
			name:     "automatic redistribution",
			path:     filepath.Join("..", "leads", "round_robin_rotation.go"),
			function: "selectRoundRobinMemberForRedistribution",
		},
		{
			name:     "meta legacy fallback",
			path:     filepath.Join("..", "meta", "repository.go"),
			function: "selectRoundRobinMember",
		},
		{
			name:     "grupo olx legacy fallback",
			path:     filepath.Join("..", "portals", "repository.go"),
			function: "selectPortalRoundRobinMember",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			source := goFunctionSource(t, testCase.path, testCase.function)
			if testCase.name == "manual lead" {
				requireContains(t, source, "repo.selectRoundRobinMemberForRedistribution(", "current.AssignedUserID, current.TeamID")
				source = goFunctionSource(t, testCase.path, "selectRoundRobinMemberForRedistribution")
			}
			if testCase.name == "manual lead" || testCase.name == "automatic redistribution" {
				requireContains(t, source, "private.preview_round_robin_redistribution_candidate(", "organizationID, leadID, roundRobinID, excludedUserID, requiredTeamID")
				requireAbsent(t, source, "selectLegacyRedistributionCandidate", "RoundRobinAvailabilityPredicateSQL")
				requireDatabaseRotationAvailabilityContract(t)
				return
			}
			requireContains(t, source,
				"distribution.RoundRobinAvailabilityPredicateSQL",
				"left join public.teams direct_team",
				"direct_team.organization_id = entries.organization_id",
				"coalesce(direct_team.is_active, true)",
				"and (entries.team_id is null or (direct_team.id is not null and tm.id is not null))",
			)
			requireAbsent(t, source,
				"candidates.team_member_id is null\n",
				"from public.member_availability ma_any",
			)
		})
	}
}

// Redistribution now owns its rotation in PostgreSQL. Follow the complete
// Go -> locked preview -> eligible candidates chain instead of the retired
// Go selector, while retaining the same direct-member and exact-team fences.
func requireDatabaseRotationAvailabilityContract(t *testing.T) {
	t.Helper()
	migration := readSource(t, filepath.Join("..", "..", "..", "..", "supabase", "migrations", "20261016031913_reconcile_legacy_rotation_with_queue_runtime.sql"))
	candidatesStart := strings.Index(migration, "create or replace function private.round_robin_rotation_candidates(")
	if candidatesStart < 0 {
		t.Fatal("canonical database rotation candidates function not found")
	}
	candidatesEnd := strings.Index(migration[candidatesStart:], "$rotation_candidates$;")
	if candidatesEnd < 0 {
		t.Fatal("canonical database rotation candidates function not found")
	}
	candidates := strings.Join(strings.Fields(migration[candidatesStart:candidatesStart+candidatesEnd]), " ")
	requireContains(t, candidates,
		"account.is_active is true",
		"organization_member.organization_id = p_organization_id",
		"organization_member.is_active = true",
		"organization_member.deleted_at is null",
		"organization_member.membership_generation = member.membership_generation",
		"organization_member.membership_generation = team_member.membership_generation",
		"team.organization_id = p_organization_id",
		"coalesce(team.is_active, true) = true",
		"member.team_id is null or (team.id is not null and team_member.id is not null)",
		"or candidate.team_member_id is null or not exists",
		"availability_any.organization_id = p_organization_id",
		"availability_any.team_member_id = candidate.team_member_id",
		"availability.organization_id = p_organization_id",
		"availability.team_member_id = candidate.team_member_id",
		"coalesce(availability.is_active, true) = true",
		"availability.day_of_week = p_current_day",
		"availability.day_of_week = (p_current_day + 6) % 7",
		"coalesce(availability.is_all_day, false) = false",
		"availability.start_time > availability.end_time",
	)
	requireAbsent(t, candidates, "availability_any.is_active", "account.organization_id = p_organization_id")
	previewStart := strings.Index(migration, "create or replace function private.preview_round_robin_redistribution_candidate(")
	if previewStart < 0 {
		t.Fatal("canonical locked redistribution preview not found")
	}
	previewEnd := strings.Index(migration[previewStart:], "\n$$;")
	if previewEnd < 0 {
		t.Fatal("canonical locked redistribution preview body not found")
	}
	preview := strings.Join(strings.Fields(migration[previewStart:previewStart+previewEnd]), " ")
	requireContains(t, preview,
		"lead.organization_id=p_organization_id and lead.id=p_lead_id for no key update",
		"p_excluded_user_id is distinct from current_owner",
		"round_robin_rotation_stale_owner",
		"private.pick_round_robin_rotation_candidate( p_organization_id,p_lead_id,p_round_robin_id,current_owner,p_required_team_id,p_now)",
	)
	pickStart := strings.Index(migration, "create or replace function private.pick_round_robin_rotation_candidate(")
	if pickStart < 0 || pickStart >= previewStart {
		t.Fatal("canonical rotation picker must precede its locked preview")
	}
	picker := strings.Join(strings.Fields(migration[pickStart:previewStart]), " ")
	requireContains(t, picker,
		"from private.round_robin_rotation_candidates(p_organization_id,p_round_robin_id,",
		"extract(dow from local_now)::integer,local_now::time,p_required_team_id)",
		"c.user_id is distinct from p_current_user_id",
		"order by (c.user_id=any(s.visited_user_ids))",
	)
}
