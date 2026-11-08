package stageconfig

import (
	"errors"
	"testing"
	"time"
)

func explicitInactivityFixture() (StageInactivityPolicy, inactivityLeadState) {
	entered := time.Date(2026, 10, 1, 12, 0, 0, 123456000, time.UTC)
	return StageInactivityPolicy{
			AutomationID: "11111111-1111-4111-8111-111111111111", OrganizationID: "22222222-2222-4222-8222-222222222222", StageID: "33333333-3333-4333-8333-333333333333", Epoch: "44444444-4444-4444-8444-444444444444",
			Revision: 1, Clock: InactivityClockLastInteraction, StartMode: InactivityStartAtActivation, ActivatedAt: entered.Add(72 * time.Hour), AutomationUpdatedAt: entered, InteractionCoverageFrom: &entered, Days: 7, Enabled: true,
		}, inactivityLeadState{
			OrganizationID: "22222222-2222-4222-8222-222222222222", LeadID: "55555555-5555-4555-8555-555555555555", StageID: "33333333-3333-4333-8333-333333333333", ScopeCycle: "66666666-6666-4666-8666-666666666666",
			StageEnteredAt: entered, ScopeStartedAt: entered, IsOpen: true,
		}
}

func TestStageInactivityRequiresExplicitChoicesAndEpoch(t *testing.T) {
	for _, mutate := range []func(*StageInactivityPolicy){
		func(p *StageInactivityPolicy) { p.Clock = "" }, func(p *StageInactivityPolicy) { p.StartMode = "" }, func(p *StageInactivityPolicy) { p.Epoch = "" }, func(p *StageInactivityPolicy) { p.Revision = 0 }, func(p *StageInactivityPolicy) { p.Days = 0 }, func(p *StageInactivityPolicy) { p.Days = 3651 }, func(p *StageInactivityPolicy) { p.ActivatedAt = time.Time{} }, func(p *StageInactivityPolicy) { p.AutomationUpdatedAt = time.Time{} },
		func(p *StageInactivityPolicy) { p.InteractionCoverageFrom = nil },
	} {
		policy, lead := explicitInactivityFixture()
		mutate(&policy)
		if _, _, err := evaluateInactivityEpisode(policy, lead); !errors.Is(err, ErrInactivityPolicyIncomplete) {
			t.Fatalf("incomplete policy was accepted: %v", err)
		}
	}
}

func TestStageInactivityCannotInferMissingHistoricalWork(t *testing.T) {
	policy, lead := explicitInactivityFixture()
	policy.StartMode = InactivityIncludeOverdue
	coverage := policy.ActivatedAt
	policy.InteractionCoverageFrom = &coverage
	episode, _, err := evaluateInactivityEpisode(policy, lead)
	if err != nil || !episode.Baseline.Equal(coverage) {
		t.Fatal("partially enrolled historical facts were treated as complete inactivity evidence")
	}
}

func TestStageInactivitySupportsBothActivationContracts(t *testing.T) {
	policy, lead := explicitInactivityFixture()
	episode, applicable, err := evaluateInactivityEpisode(policy, lead)
	if err != nil || !applicable || !episode.Baseline.Equal(policy.ActivatedAt) || !episode.DueAt.Equal(policy.ActivatedAt.Add(7*24*time.Hour)) {
		t.Fatalf("activation baseline = %#v, applicable=%v, err=%v", episode, applicable, err)
	}
	policy.StartMode = InactivityIncludeOverdue
	episode, _, err = evaluateInactivityEpisode(policy, lead)
	if err != nil || !episode.Baseline.Equal(lead.StageEnteredAt) {
		t.Fatalf("explicit backlog baseline = %#v, err=%v", episode, err)
	}
}

func TestStageInactivityNewStageEntriesRequireEntryAfterActivation(t *testing.T) {
	policy, lead := explicitInactivityFixture()
	policy.StartMode = InactivityNewStageEntries
	lead.ScopeStartedAt = policy.ActivatedAt.Add(time.Hour)
	if _, applicable, err := evaluateInactivityEpisode(policy, lead); err != nil || applicable {
		t.Fatalf("reopening a preexisting entry included it in the new-entry scope: applicable=%v err=%v", applicable, err)
	}
	lead.StageEnteredAt = lead.ScopeStartedAt
	interaction := lead.StageEnteredAt.Add(2 * time.Hour)
	lead.LastActionAt = &interaction
	episode, applicable, err := evaluateInactivityEpisode(policy, lead)
	if err != nil || !applicable || !episode.DueAt.Equal(interaction.Add(7*24*time.Hour)) {
		t.Fatalf("new entry did not count from its last interaction: %#v, applicable=%v, err=%v", episode, applicable, err)
	}
}

func TestStageInactivityClockAndSameTimestampFacts(t *testing.T) {
	policy, lead := explicitInactivityFixture()
	interaction := policy.ActivatedAt.Add(time.Hour)
	id := "77777777-7777-4777-8777-777777777777"
	lead.LastActionAt, lead.LastActionID = &interaction, &id
	first, _, _ := evaluateInactivityEpisode(policy, lead)
	id = "88888888-8888-4888-8888-888888888888"
	second, _, _ := evaluateInactivityEpisode(policy, lead)
	if !first.Baseline.Equal(interaction) || first.Key == second.Key {
		t.Fatal("interaction must reset the clock and durable fact identity must separate episodes")
	}
	policy.Clock = InactivityClockStageEntry
	entryClock, _, _ := evaluateInactivityEpisode(policy, lead)
	if !entryClock.Baseline.Equal(policy.ActivatedAt) {
		t.Fatal("stage-entry clock was reset by interaction")
	}
}

func TestStageInactivityIsolationClosureAndReopening(t *testing.T) {
	for _, mutate := range []func(*StageInactivityPolicy, *inactivityLeadState){
		func(p *StageInactivityPolicy, _ *inactivityLeadState) { p.Enabled = false }, func(_ *StageInactivityPolicy, l *inactivityLeadState) { l.IsOpen = false }, func(_ *StageInactivityPolicy, l *inactivityLeadState) {
			l.OrganizationID = "99999999-9999-4999-8999-999999999999"
		}, func(_ *StageInactivityPolicy, l *inactivityLeadState) {
			l.StageID = "99999999-9999-4999-8999-999999999999"
		},
	} {
		policy, lead := explicitInactivityFixture()
		mutate(&policy, &lead)
		if _, applicable, err := evaluateInactivityEpisode(policy, lead); err != nil || applicable {
			t.Fatalf("out-of-scope policy applied: applicable=%v err=%v", applicable, err)
		}
	}
	policy, lead := explicitInactivityFixture()
	first, _, _ := evaluateInactivityEpisode(policy, lead)
	lead.ScopeCycle = "99999999-9999-4999-8999-999999999999"
	lead.ScopeStartedAt = policy.ActivatedAt.Add(24 * time.Hour)
	reopened, _, _ := evaluateInactivityEpisode(policy, lead)
	if first.Key == reopened.Key || !reopened.Baseline.Equal(lead.ScopeStartedAt) {
		t.Fatal("reopening must start a distinct episode even in the same column")
	}
}

func TestStageInactivityEpochRevisionAndRecipientGeneration(t *testing.T) {
	policy, lead := explicitInactivityFixture()
	first, _, _ := evaluateInactivityEpisode(policy, lead)
	policy.Revision++
	revised, _, _ := evaluateInactivityEpisode(policy, lead)
	policy.Epoch = "99999999-9999-4999-8999-999999999999"
	reactivated, _, _ := evaluateInactivityEpisode(policy, lead)
	if first.Key != revised.Key || revised.Key == reactivated.Key {
		t.Fatal("ordinary edits must preserve episode identity; explicit reactivation must renew it")
	}
	if inactivityNotificationDedupeKey(first.Key, lead.LeadID, 1) == inactivityNotificationDedupeKey(first.Key, lead.LeadID, 2) {
		t.Fatal("a membership reincarnation must not reuse notification identity")
	}
}

func TestStageInactivityRetryIsBounded(t *testing.T) {
	now := time.Now().UTC()
	for attempt := 1; attempt <= inactivityMaximumAttempts+1; attempt++ {
		status, next := inactivityRetry(attempt, now)
		if attempt < inactivityMaximumAttempts && (status != "pending" || !next.After(now)) {
			t.Fatalf("attempt %d must retry", attempt)
		}
		if attempt >= inactivityMaximumAttempts && status != "dead" {
			t.Fatalf("attempt %d must enter the failure destination", attempt)
		}
	}
}
