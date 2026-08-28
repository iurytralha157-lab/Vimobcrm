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
		"or availability_member.id = candidates.team_member_id",
		"availability.day_of_week = extract(dow from now() at time zone 'america/sao_paulo')::int",
		"availability.day_of_week = (extract(dow from now() at time zone 'america/sao_paulo')::int + 6) % 7",
		"coalesce(availability.is_active, true) = true",
		"availability.start_time > availability.end_time",
	)
	if strings.Count(predicate, "availability.day_of_week = extract(dow from now() at time zone 'america/sao_paulo')::int") != 2 {
		t.Fatal("current-day schedule matching must cover normal and overnight start-day windows")
	}

	if strings.Count(predicate, "candidates.team_member_id is null") != 2 {
		t.Fatal("direct-member scope must be applied to both schedule detection and current-window matching")
	}
	flattenedPredicate := strings.Join(strings.Fields(predicate), " ")
	if strings.Contains(flattenedPredicate, "candidates.team_member_id is null or not exists") {
		t.Fatal("a null team_member_id must not be an unconditional 24-hour eligibility bypass")
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

func TestAllLegacyRoundRobinSelectorsUseSharedAvailabilityContract(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		path     string
		function string
	}{
		{
			name:     "manual lead",
			path:     filepath.Join("..", "leads", "repository.go"),
			function: "selectRoundRobinMember",
		},
		{
			name:     "automatic redistribution",
			path:     filepath.Join("..", "leads", "redistribution_worker.go"),
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
