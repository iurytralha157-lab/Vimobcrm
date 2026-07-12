package attention

import (
	"fmt"
	"strings"
	"time"
)

type EvaluationInput struct {
	Now               time.Time
	CurrentStatus     string
	AcknowledgedFrom  string
	DueAt             time.Time
	WarningMinutes    int
	EscalationMinutes int
	WarningAt         *time.Time
	EscalationAt      *time.Time
	RepeatMinutes     int
	LastReminderAt    *time.Time
	SnoozedUntil      *time.Time
}

type Evaluation struct {
	Status         string
	PreviousStatus string
	Level          string
	Notify         bool
	Reminder       bool
	WarningAt      *time.Time
	EscalatedAt    *time.Time
	NextAt         time.Time
}

func Evaluate(input EvaluationInput) Evaluation {
	now := input.Now.UTC()
	dueAt := input.DueAt.UTC()
	repeat := time.Duration(input.RepeatMinutes) * time.Minute
	if repeat <= 0 {
		repeat = 24 * time.Hour
	}

	previous := normalizeAttentionStatus(input.CurrentStatus)
	effectivePrevious := previous
	if previous == "acknowledged" && validSeverity(input.AcknowledgedFrom) {
		effectivePrevious = input.AcknowledgedFrom
	}

	if input.SnoozedUntil != nil && input.SnoozedUntil.After(now) {
		return Evaluation{
			Status:         previous,
			PreviousStatus: previous,
			NextAt:         input.SnoozedUntil.UTC(),
		}
	}

	warningAt := dueAt.Add(-time.Duration(input.WarningMinutes) * time.Minute)
	if input.WarningAt != nil {
		warningAt = input.WarningAt.UTC()
	}
	escalationAt := dueAt.Add(time.Duration(input.EscalationMinutes) * time.Minute)
	escalationEnabled := input.EscalationMinutes > 0 || input.EscalationAt != nil
	if input.EscalationAt != nil {
		escalationAt = input.EscalationAt.UTC()
	}
	desired := "monitoring"
	level := ""
	if !now.Before(dueAt) {
		desired = "breached"
		level = "breached"
		if escalationEnabled && !now.Before(escalationAt) {
			desired = "escalated"
			level = "escalated"
		}
	} else if input.WarningMinutes > 0 && !now.Before(warningAt) {
		desired = "warning"
		level = "warning"
	}

	result := Evaluation{
		Status:         desired,
		PreviousStatus: previous,
		Level:          level,
		NextAt:         dueAt,
	}
	if input.WarningMinutes > 0 {
		copy := warningAt
		result.WarningAt = &copy
	}
	if escalationEnabled {
		copy := escalationAt
		result.EscalatedAt = &copy
	}

	switch desired {
	case "monitoring":
		if input.WarningMinutes > 0 && warningAt.After(now) {
			result.NextAt = warningAt
		}
	case "warning":
		result.NextAt = dueAt
		result.Notify = effectivePrevious != "warning"
	case "breached":
		result.Notify = effectivePrevious != "breached"
		if escalationEnabled && escalationAt.After(now) {
			result.NextAt = escalationAt
		} else {
			result.NextAt = now.Add(repeat)
		}
	case "escalated":
		result.Notify = effectivePrevious != "escalated"
		result.NextAt = now.Add(repeat)
	}

	if desired == "breached" || desired == "escalated" {
		if input.LastReminderAt != nil {
			repeatAt := input.LastReminderAt.UTC().Add(repeat)
			if !result.Notify && !now.Before(repeatAt) {
				result.Notify = true
				result.Reminder = true
			}
			if repeatAt.After(now) && repeatAt.Before(result.NextAt) {
				result.NextAt = repeatAt
			}
		}
		if previous == "acknowledged" && effectivePrevious == desired && !result.Notify {
			result.Status = "acknowledged"
		}
	}

	if result.NextAt.Before(now) {
		result.NextAt = now.Add(time.Minute)
	}
	return result
}

func ReminderBucket(now time.Time, repeatMinutes int, location *time.Location) string {
	if location == nil {
		location = time.UTC
	}
	localized := now.In(location)
	if repeatMinutes <= 0 {
		repeatMinutes = 24 * 60
	}
	if repeatMinutes >= 24*60 {
		return localized.Format("2006-01-02")
	}
	seconds := int64(repeatMinutes) * 60
	return fmt.Sprintf("%d-%d", repeatMinutes, localized.Unix()/seconds)
}

func NotificationDedupeKey(policyID, leadID, cycleKey, recipientID, level, bucket string) string {
	parts := []string{"lead_attention", policyID, leadID, cycleKey, recipientID, level, bucket}
	for index := range parts {
		parts[index] = strings.TrimSpace(parts[index])
	}
	return strings.Join(parts, ":")
}

func normalizeAttentionStatus(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if !validItemStatus(value) {
		return "monitoring"
	}
	return value
}

func validSeverity(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "warning", "breached", "escalated":
		return true
	default:
		return false
	}
}
