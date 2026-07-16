package attention

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestJSONValueIsValidTextForExplicitJSONBCasts(t *testing.T) {
	var encoded string = jsonValue(map[string]any{"enabled": true})
	if !json.Valid([]byte(encoded)) {
		t.Fatalf("jsonValue returned invalid JSON text: %q", encoded)
	}
}

func TestEvaluateTransitionsAndRecurringReminder(t *testing.T) {
	now := time.Date(2026, time.July, 12, 15, 0, 0, 0, time.UTC)
	due := now.Add(time.Hour)

	warning := Evaluate(EvaluationInput{
		Now:            now,
		CurrentStatus:  "monitoring",
		DueAt:          due,
		WarningMinutes: 90,
		RepeatMinutes:  1440,
	})
	if warning.Status != "warning" || !warning.Notify || warning.Level != "warning" {
		t.Fatalf("expected warning transition, got %+v", warning)
	}

	breached := Evaluate(EvaluationInput{
		Now:               now,
		CurrentStatus:     "warning",
		DueAt:             now.Add(-time.Minute),
		EscalationMinutes: 60,
		RepeatMinutes:     1440,
	})
	if breached.Status != "breached" || !breached.Notify {
		t.Fatalf("expected breach transition, got %+v", breached)
	}

	lastReminder := now.Add(-24 * time.Hour)
	reminder := Evaluate(EvaluationInput{
		Now:               now,
		CurrentStatus:     "escalated",
		DueAt:             now.Add(-48 * time.Hour),
		EscalationMinutes: 60,
		RepeatMinutes:     1440,
		LastReminderAt:    &lastReminder,
	})
	if reminder.Status != "escalated" || !reminder.Notify || !reminder.Reminder {
		t.Fatalf("expected recurring escalated reminder, got %+v", reminder)
	}
}

func TestEvaluateHonorsSnoozeAndAcknowledgement(t *testing.T) {
	now := time.Date(2026, time.July, 12, 15, 0, 0, 0, time.UTC)
	snoozedUntil := now.Add(2 * time.Hour)
	snoozed := Evaluate(EvaluationInput{
		Now:           now,
		CurrentStatus: "breached",
		DueAt:         now.Add(-time.Hour),
		SnoozedUntil:  &snoozedUntil,
	})
	if snoozed.Status != "breached" || !snoozed.NextAt.Equal(snoozedUntil) || snoozed.Notify {
		t.Fatalf("expected snooze to defer evaluation, got %+v", snoozed)
	}

	lastReminder := now.Add(-time.Hour)
	acknowledged := Evaluate(EvaluationInput{
		Now:              now,
		CurrentStatus:    "acknowledged",
		AcknowledgedFrom: "breached",
		DueAt:            now.Add(-time.Hour),
		RepeatMinutes:    1440,
		LastReminderAt:   &lastReminder,
	})
	if acknowledged.Status != "acknowledged" || acknowledged.Notify {
		t.Fatalf("expected acknowledgement to remain until reminder is due, got %+v", acknowledged)
	}
}

func TestEvaluateSupportsImmediateEscalation(t *testing.T) {
	now := time.Date(2026, time.July, 12, 15, 0, 0, 0, time.UTC)
	escalationAt := now.Add(-time.Minute)
	result := Evaluate(EvaluationInput{
		Now:           now,
		CurrentStatus: "monitoring",
		DueAt:         now.Add(-time.Minute),
		EscalationAt:  &escalationAt,
	})
	if result.Status != "escalated" || !result.Notify {
		t.Fatalf("expected immediate escalation, got %+v", result)
	}
}

func TestNotificationDedupeKeyIsCycleAndBucketScoped(t *testing.T) {
	location, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.July, 12, 3, 30, 0, 0, time.UTC)
	bucket := ReminderBucket(now, 1440, location)
	if bucket != "2026-07-12" {
		t.Fatalf("unexpected local date bucket: %s", bucket)
	}
	key := NotificationDedupeKey("policy", "lead", "cycle-2", "user", "breached", bucket)
	if key != "lead_attention:policy:lead:cycle-2:user:breached:2026-07-12" {
		t.Fatalf("unexpected dedupe key: %s", key)
	}
}

func TestPolicyAndItemPermissions(t *testing.T) {
	manager := tenant.Context{UserID: "manager", MemberRole: "manager"}
	if canManagePolicies(manager) || canViewOrganizationAttention(manager) {
		t.Fatal("manager role must not bypass the effective permission set")
	}
	manager.Permissions = []string{"pipeline_manage", "lead_view_all"}
	if !canManagePolicies(manager) || !canViewOrganizationAttention(manager) {
		t.Fatal("explicit permissions must allow policy management and organization attention")
	}
	leader := tenant.Context{
		UserID:       "leader",
		IsTeamLeader: true,
		LedUserIDs:   []string{"broker"},
		Permissions:  []string{"lead_view_team", "lead_operate"},
	}
	if canManagePolicies(leader) {
		t.Fatal("team leader without an explicit permission must not manage policies")
	}
	if !canActOnItem(leader, "broker") {
		t.Fatal("team leader must act on a led user's item")
	}
	broker := tenant.Context{UserID: "broker", MemberRole: "user", Permissions: []string{"lead_view_own", "lead_operate"}}
	if !canActOnItem(broker, "broker") || canActOnItem(broker, "another") {
		t.Fatal("broker must only act on their own item")
	}
}

func TestNormalizeCreatePolicyDefaultsAndValidates(t *testing.T) {
	name := "Primeiro contato"
	policyType := "first_contact"
	threshold := 60
	input, err := normalizeCreatePolicy(PolicyRequest{
		Name:             &name,
		PolicyType:       &policyType,
		ThresholdMinutes: &threshold,
	})
	if err != nil {
		t.Fatal(err)
	}
	if input.Status != "shadow" || !input.NotifyAssignee || !input.NotifyLeaders || !input.NotifyAdmins || !input.RedistributeBeforeContactOnly {
		t.Fatalf("unexpected safe defaults: %+v", input)
	}

	warning := 61
	_, err = normalizeCreatePolicy(PolicyRequest{
		Name:             &name,
		PolicyType:       &policyType,
		ThresholdMinutes: &threshold,
		WarningMinutes:   &warning,
	})
	if err == nil || !strings.Contains(err.Error(), "warningMinutes") {
		t.Fatalf("expected warning validation, got %v", err)
	}
}
