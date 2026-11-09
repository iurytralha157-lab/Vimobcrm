package leads

import "testing"

func TestRedistributionPolicyUsesDefaultsOnlyForOmittedFields(t *testing.T) {
	policy, err := decodeRedistributionPolicy([]byte(`{"enable_redistribution":true}`))
	if err != nil || policy.TimeoutMinutes != 20 || policy.WarningMinutes != 5 || policy.MaxAttempts != 10 {
		t.Fatalf("defaults = %#v, %v", policy, err)
	}
	policy, err = decodeRedistributionPolicy([]byte(`{"enable_redistribution":true,"redistribution_timeout_minutes":30,"redistribution_warning_minutes":0,"redistribution_max_attempts":0}`))
	if err != nil || policy.TimeoutMinutes != 30 || policy.WarningMinutes != 0 || policy.MaxAttempts != 0 {
		t.Fatalf("explicit zero options = %#v, %v", policy, err)
	}
	policy, err = decodeRedistributionPolicy([]byte(`{"enable_redistribution":"true","redistribution_timeout_minutes":"30","redistribution_warning_minutes":"0","redistribution_max_attempts":"0"}`))
	if err != nil || !policy.Enabled || policy.TimeoutMinutes != 30 || policy.WarningMinutes != 0 || policy.MaxAttempts != 0 {
		t.Fatalf("legacy integer settings = %#v, %v", policy, err)
	}
}

func TestRedistributionPolicyRejectsMalformedEnabledPolicies(t *testing.T) {
	for _, payload := range []string{
		`{"enable_redistribution":true,"redistribution_timeout_minutes":1.5}`,
		`{"enable_redistribution":true,"redistribution_timeout_minutes":"20.5"}`,
		`{"enable_redistribution":true,"redistribution_timeout_minutes":0}`,
		`{"enable_redistribution":true,"redistribution_warning_minutes":20}`,
		`{"enable_redistribution":true,"redistribution_max_attempts":-1}`,
	} {
		if _, err := decodeRedistributionPolicy([]byte(payload)); err == nil {
			t.Fatalf("malformed policy was accepted: %s", payload)
		}
	}
}

func TestLegacyRedistributionPreservesValidShortWarnings(t *testing.T) {
	for _, test := range []struct {
		name, settings string
		wantWarning    int
	}{
		{"valid", `{"enable_redistribution":true,"redistribution_timeout_minutes":5,"redistribution_warning_minutes":2}`, 2},
		{"implicit", `{"enable_redistribution":true,"redistribution_timeout_minutes":5}`, 0},
		{"outside deadline", `{"enable_redistribution":true,"redistribution_timeout_minutes":5,"redistribution_warning_minutes":5}`, 0},
		{"disabled warning", `{"enable_redistribution":true,"redistribution_timeout_minutes":5,"redistribution_warning_minutes":0}`, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			policy, err := decodeRedistributionPolicy([]byte(test.settings))
			if err != nil || policy.TimeoutMinutes != 5 || policy.WarningMinutes != test.wantWarning {
				t.Fatalf("decoded short policy = %#v, %v", policy, err)
			}
			job := redistributionJob{TimeoutMinutes: policy.TimeoutMinutes, WarningMinutes: policy.WarningMinutes}
			if got := redistributionJobShouldReceiveWarning(job); got != (test.wantWarning > 0) {
				t.Fatalf("warning eligibility = %v, expected warning minutes %d", got, test.wantWarning)
			}
		})
	}
}
