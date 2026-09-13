package leads

import (
	"strings"
	"testing"
	"time"
)

func TestScheduleReminderProducerHonorsCanonicalReminderSemantics(t *testing.T) {
	t.Parallel()

	if scheduleReminderMaximumMinutes != 120 {
		t.Fatalf("maximum reminder = %d, want 120", scheduleReminderMaximumMinutes)
	}
	if scheduleReminderDueLookAhead <= 0 || scheduleReminderDueLookAhead > 30*time.Second {
		t.Fatalf("zero-minute reminder look-ahead = %s, want a bounded polling allowance", scheduleReminderDueLookAhead)
	}

	for _, fragment := range []string{
		"coalesce(se.status, 'scheduled') = 'scheduled'",
		"join public.organization_modules agenda_module",
		"lower(btrim(agenda_module.module_name)) = 'agenda'",
		"coalesce(agenda_module.is_enabled, false) = true",
		"se.reminder_minutes between 0 and $2::integer",
		"se.start_time > statement_timestamp()",
		"se.reminder_minutes = 0",
		"se.reminder_minutes > 0",
		"make_interval(mins => se.reminder_minutes) <= statement_timestamp()",
		"floor(extract(epoch from recipients.start_time) * 1000)",
		"'appointment_reminder:'",
		"in ('schedule_reminder', 'appointment_reminder')",
		"notification.metadata#>>'{variables,start_time}'",
		"'/agenda?event=' || id::text",
		"'appointment_reminder'",
		"'push', jsonb_build_object('required', true, 'status', 'pending')",
		"'whatsapp', jsonb_build_object('required', true, 'status', 'pending')",
	} {
		if !strings.Contains(dueScheduleReminderNotificationsSQL, fragment) {
			t.Fatalf("schedule reminder producer missing %q", fragment)
		}
	}
	if strings.Contains(dueScheduleReminderNotificationsSQL, "coalesce(se.reminder_minutes") {
		t.Fatal("null reminder_minutes must disable the reminder instead of receiving a fallback")
	}
	if strings.Contains(dueScheduleReminderNotificationsSQL, "reminder_due_at >=") {
		t.Fatal("future events must not lose reminders after an arbitrary catch-up cutoff")
	}
	for _, forbidden := range []string{"public.properties", "property_id", "property_title", "property_code"} {
		if strings.Contains(dueScheduleReminderNotificationsSQL, forbidden) {
			t.Fatalf("reminder producer must not expose property data without recipient-scoped ACL: %s", forbidden)
		}
	}
}

func TestScheduleOutcomeProducerIsAppointmentOnlyAndTimeBounded(t *testing.T) {
	t.Parallel()

	if scheduleOutcomeMinimumDelay != 5*time.Minute {
		t.Fatalf("outcome minimum delay = %s, want 5m", scheduleOutcomeMinimumDelay)
	}
	if scheduleOutcomeCatchUpWindow != 24*time.Hour {
		t.Fatalf("outcome catch-up = %s, want 24h", scheduleOutcomeCatchUpWindow)
	}

	for _, fragment := range []string{
		"coalesce(se.status, 'scheduled') = 'scheduled'",
		"join public.organization_modules agenda_module",
		"lower(btrim(agenda_module.module_name)) = 'agenda'",
		"coalesce(agenda_module.is_enabled, false) = true",
		"se.event_type in ('visit', 'meeting')",
		"se.end_time <= statement_timestamp() - ($1::bigint * interval '1 second')",
		"se.end_time >= statement_timestamp() - ($2::bigint * interval '1 second')",
		"'appointment_outcome_pending:'",
		"'/agenda?event=' || id::text",
		"'appointment_outcome_pending'",
		"'expires_at', statement_timestamp() + interval '2 hours'",
		"'push', jsonb_build_object('required', true, 'status', 'pending')",
		"'whatsapp', jsonb_build_object('required', false, 'status', 'skipped')",
	} {
		if !strings.Contains(dueScheduleOutcomeNotificationsSQL, fragment) {
			t.Fatalf("schedule outcome producer missing %q", fragment)
		}
	}
	for _, forbidden := range []string{"public.properties", "property_id", "property_title", "property_code"} {
		if strings.Contains(dueScheduleOutcomeNotificationsSQL, forbidden) {
			t.Fatalf("outcome producer must not expose property data without recipient-scoped ACL: %s", forbidden)
		}
	}
}

func TestScheduleNotificationTargetUsesValidatedEventDeepLink(t *testing.T) {
	t.Parallel()

	eventID := "10000000-0000-4000-8000-000000000001"
	leadID := "20000000-0000-4000-8000-000000000001"
	for _, eventKey := range []string{"appointment_reminder", "appointment_outcome_pending", "schedule_reminder"} {
		notification := pendingNotification{
			Type:   "schedule",
			LeadID: &leadID,
			Metadata: map[string]any{
				"event_key": eventKey,
				"variables": map[string]any{"schedule_event_id": eventID},
			},
		}
		if target := notificationTargetURL(notification); target != "/agenda?event="+eventID {
			t.Fatalf("%s target = %q, want event deep link", eventKey, target)
		}
	}

	invalid := pendingNotification{
		Type: "schedule",
		Metadata: map[string]any{
			"event_key":         "appointment_reminder",
			"schedule_event_id": "../settings",
		},
	}
	if target := notificationTargetURL(invalid); target != "/agenda" {
		t.Fatalf("invalid event target = %q, want safe Agenda fallback", target)
	}
}
