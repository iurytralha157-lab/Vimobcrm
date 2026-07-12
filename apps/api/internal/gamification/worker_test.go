package gamification

import (
	"testing"
	"time"
)

func TestAdvanceMissionProgressAwardsBonusOnce(t *testing.T) {
	t.Parallel()

	progress, award := advanceMissionProgress(8, 10, 2, false)
	if progress != 10 || !award {
		t.Fatalf("boundary completion = (%d, %v), want (10, true)", progress, award)
	}
	progress, award = advanceMissionProgress(progress, 10, 5, true)
	if progress != 10 || award {
		t.Fatalf("completed mission retry = (%d, %v), want (10, false)", progress, award)
	}
	progress, award = advanceMissionProgress(0, 10, 3, false)
	if progress != 3 || award {
		t.Fatalf("partial progress = (%d, %v), want (3, false)", progress, award)
	}
}

func TestMissionPeriodKeySeparatesCalendarAndSeasonBoundaries(t *testing.T) {
	t.Parallel()

	instant := time.Date(2026, time.July, 12, 14, 30, 0, 0, time.FixedZone("BRT", -3*60*60))
	if actual := missionPeriodKey("daily", instant, "season-a"); actual != "2026-07-12" {
		t.Fatalf("daily key = %q", actual)
	}
	if actual := missionPeriodKey("monthly", instant, "season-a"); actual != "2026-07" {
		t.Fatalf("monthly key = %q", actual)
	}
	if actual := missionPeriodKey("weekly", instant, "season-a"); actual != "2026-W28" {
		t.Fatalf("weekly key = %q", actual)
	}
	utcBoundary := time.Date(2026, time.July, 12, 1, 0, 0, 0, time.UTC)
	if actual := missionPeriodKey("daily", utcBoundary, "season-a"); actual != "2026-07-11" {
		t.Fatalf("Sao Paulo daily boundary = %q, want 2026-07-11", actual)
	}
	firstSeason := missionPeriodKey("season", instant, "season-a")
	secondSeason := missionPeriodKey("season", instant, "season-b")
	if firstSeason == secondSeason {
		t.Fatal("season-scoped progress must not cross a reset boundary")
	}
}

func TestDisabledRuleNeverFallsBackToDefault(t *testing.T) {
	t.Parallel()

	points, active := resolveRulePoints(true, false, 500, 10)
	if points != 0 || active {
		t.Fatalf("disabled configured rule = (%d, %v), want (0, false)", points, active)
	}
	points, active = resolveRulePoints(true, true, 0, 10)
	if points != 0 || !active {
		t.Fatalf("active zero rule = (%d, %v), want (0, true)", points, active)
	}
	points, active = resolveRulePoints(false, false, 0, 10)
	if points != 10 || !active {
		t.Fatalf("missing rule fallback = (%d, %v), want (10, true)", points, active)
	}
}

func TestEligibilitySkipsWithoutBlockingCore(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		module       bool
		member       bool
		participates bool
		season       bool
		reason       string
	}{
		{name: "module disabled", member: true, participates: true, season: true, reason: "module_disabled"},
		{name: "cross tenant", module: true, participates: true, season: true, reason: "inactive_or_cross_tenant_user"},
		{name: "participant disabled", module: true, member: true, season: true, reason: "participant_disabled"},
		{name: "season absent", module: true, member: true, participates: true, reason: "season_not_found"},
	}
	for _, item := range tests {
		item := item
		t.Run(item.name, func(t *testing.T) {
			t.Parallel()
			eligible, reason := evaluateEligibility(item.module, item.member, item.participates, item.season)
			if eligible || reason != item.reason {
				t.Fatalf("eligibility = (%v, %q), want (false, %q)", eligible, reason, item.reason)
			}
		})
	}
}

func TestBigintAwardRangeAndAccumulation(t *testing.T) {
	t.Parallel()

	perEvent, err := calculateAwardPoints(100_000, 100)
	if err != nil {
		t.Fatalf("max configured award rejected: %v", err)
	}
	if perEvent != 10_000_000 {
		t.Fatalf("max award = %d, want 10000000", perEvent)
	}
	accumulated := perEvent * 1_000
	if accumulated != 10_000_000_000 {
		t.Fatalf("bigint accumulation = %d", accumulated)
	}
	if _, err := calculateAwardPoints(100_001, 1); err == nil {
		t.Fatal("unit points above the canonical limit must be rejected")
	}
}

func TestStreakContractHandlesDelayedEvents(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 12, 15, 0, 0, 0, time.UTC)
	if actual := currentStreakFromDates([]string{"2026-07-12", "2026-07-10"}, now); actual != 1 {
		t.Fatalf("streak before delayed day = %d, want 1", actual)
	}
	if actual := currentStreakFromDates([]string{"2026-07-12", "2026-07-11", "2026-07-10"}, now); actual != 3 {
		t.Fatalf("streak after delayed day fills gap = %d, want 3", actual)
	}
	if actual := currentStreakFromDates([]string{"2026-07-10", "2026-07-09"}, now); actual != 0 {
		t.Fatalf("inactive streak = %d, want 0", actual)
	}
	if actual := currentStreakFromDates([]string{"invalid", "2026-07-11"}, now); actual != 0 {
		t.Fatalf("invalid newest ledger day = %d, want 0", actual)
	}
}

func TestClaimedBatchFitsInsideLeaseBudget(t *testing.T) {
	t.Parallel()

	if worstCase := time.Duration(gamificationWorkerBatchSize) * gamificationJobTimeout; worstCase >= gamificationWorkerLease {
		t.Fatalf("batch worst case %s must remain below lease %s", worstCase, gamificationWorkerLease)
	}
}

func TestWorkerDrainsFullBatchesWithoutRegularPollingDelay(t *testing.T) {
	t.Parallel()

	if delay := gamificationWorkerDelay(gamificationWorkerBatchSize); delay != gamificationWorkerDrainYield {
		t.Fatalf("full batch delay = %s, want drain yield %s", delay, gamificationWorkerDrainYield)
	}
	if delay := gamificationWorkerDelay(gamificationWorkerBatchSize - 1); delay != gamificationWorkerInterval {
		t.Fatalf("partial batch delay = %s, want polling interval %s", delay, gamificationWorkerInterval)
	}
}

func TestRetryDelayAndRanks(t *testing.T) {
	t.Parallel()

	if gamificationRetryDelay(1) != time.Minute || gamificationRetryDelay(2) != 5*time.Minute || gamificationRetryDelay(4) != time.Hour {
		t.Fatal("retry schedule changed unexpectedly")
	}
	for points, expected := range map[int64]string{
		0:      "Bronze",
		999:    "Bronze",
		1_000:  "Prata",
		5_000:  "Ouro",
		15_000: "Diamante",
	} {
		if actual := rankForPoints(points); actual != expected {
			t.Fatalf("rankForPoints(%d) = %q, want %q", points, actual, expected)
		}
	}
}
