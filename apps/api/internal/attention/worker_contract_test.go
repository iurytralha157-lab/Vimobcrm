package attention

import (
	"os"
	"strings"
	"testing"
)

func TestWorkerSeparatesFirstAttemptFromFirstEffectiveContact(t *testing.T) {
	source, err := os.ReadFile("worker.go")
	if err != nil {
		t.Fatalf("read worker.go: %v", err)
	}
	worker := string(source)
	for _, required := range []string{
		"p.policy_type = 'first_contact'",
		"ac.first_human_outreach_at is null",
		"ac.first_human_outreach_at is not null",
		"p.policy_type = 'first_effective_contact'",
		"ac.first_effective_contact_at is null",
		"ac.first_effective_contact_at is not null",
		"first_effective_contact_completed",
	} {
		if !strings.Contains(worker, required) {
			t.Errorf("worker is missing %q", required)
		}
	}
	if !validPolicyType("first_contact") || !validPolicyType("first_effective_contact") {
		t.Fatal("contact policy types are not accepted")
	}
}

func TestCadenceTaskUsesItsOwnWarningWindow(t *testing.T) {
	source, err := os.ReadFile("worker.go")
	if err != nil {
		t.Fatalf("read worker.go: %v", err)
	}
	worker := string(source)
	for _, required := range []string{
		"nullif(lt.metadata->>'warning_minutes', '') ~ '^[0-9]+$'",
		"(lt.metadata->>'warning_minutes')::integer",
		"lt.due_at",
		"lt.due_at - make_interval(",
		"p.warning_minutes",
	} {
		if !strings.Contains(worker, required) {
			t.Errorf("cadence attention candidate is missing %q", required)
		}
	}
}

func TestCadenceTaskNeverEmitsAttentionNotification(t *testing.T) {
	t.Parallel()

	instance := workerInstance{
		PolicyType:           "  CADENCE_TASK ",
		PolicyStatus:         "active",
		EngineMode:           "enabled",
		NotificationsEnabled: true,
	}
	evaluation := Evaluation{Notify: true, Reminder: true}

	if shouldEmitAttentionNotification(instance, evaluation) {
		t.Fatal("cadence_task must not emit notifications or advance notification sent state")
	}
}

func TestAttentionNotificationEligibilityRemainsEnabledForOtherPolicies(t *testing.T) {
	t.Parallel()

	instance := workerInstance{
		PolicyType:           "first_contact",
		PolicyStatus:         "active",
		EngineMode:           "enabled",
		NotificationsEnabled: true,
	}

	if !shouldEmitAttentionNotification(instance, Evaluation{Notify: true}) {
		t.Fatal("eligible non-cadence attention notification was suppressed")
	}
	instance.PolicyStatus = "paused"
	if shouldEmitAttentionNotification(instance, Evaluation{Notify: true}) {
		t.Fatal("paused attention policy must remain suppressed")
	}
}
