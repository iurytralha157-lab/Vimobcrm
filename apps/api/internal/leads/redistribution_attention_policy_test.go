package leads

import (
	"context"
	"testing"
)

func TestRedistributionAttentionKeepsItsOwnDueTimeAndAttemptPolicy(t *testing.T) {
	for _, settings := range []string{
		`{"enable_redistribution":false}`,
		`{"enable_redistribution":true,"redistribution_timeout_minutes":20,"redistribution_warning_minutes":5,"redistribution_max_attempts":10}`,
		`{"enable_redistribution":true,"redistribution_timeout_minutes":"invalid"}`,
	} {
		t.Run(settings, func(t *testing.T) {
			tx := &policyRefreshTx{settings: []byte(settings)}
			job := redistributionJobLockFixture()
			job.Source = " lead_attention "
			job.AttemptCount, job.MaxAttempts = 0, 1
			job.TimeoutMinutes, job.WarningMinutes = 60, 0
			result, err := (Repository{}).reconcileLockedRedistributionPolicy(context.Background(), tx, job)
			if err != nil || !result.Usable || result.Changed || len(tx.executions) != 0 {
				t.Fatalf("attention policy/timer changed: result=%#v err=%v writes=%#v", result, err, tx.executions)
			}
		})
	}
}

func TestRedistributionAttentionUsesTheAttentionAttemptLimit(t *testing.T) {
	tx := &policyRefreshTx{settings: []byte(`{"enable_redistribution":true,"redistribution_max_attempts":10}`)}
	job := redistributionJobLockFixture()
	job.Source, job.AttemptCount, job.MaxAttempts = "lead_attention", 1, 1
	reason, err := (Repository{}).redistributionQueueStopReason(context.Background(), tx, job)
	if err != nil || reason != "max_attempts_reached" {
		t.Fatalf("attention attempt limit: reason=%q err=%v", reason, err)
	}
}

func TestRedistributionAttentionDoesNotChangeInactivityPolicyOwnership(t *testing.T) {
	for _, source := range []string{"", "whatsapp", "meta", "unknown"} {
		tx := &policyRefreshTx{settings: []byte(`{"enable_redistribution":false}`)}
		reason, err := (Repository{}).redistributionQueueStopReason(context.Background(), tx, redistributionJob{Source: source})
		if err != nil || reason != "redistribution_disabled" {
			t.Fatalf("source=%q reason=%q err=%v", source, reason, err)
		}
	}
}
