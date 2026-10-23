package leads

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

const manualActivityOrigin = "manual_activity"

// Canonical producers write through their own domain commands. This contract
// belongs only to the generic manual-activity endpoint, including its tx entry.
func normalizeManualActivityInput(input activityCreateInput) (activityCreateInput, error) {
	invalid := func() (activityCreateInput, error) {
		return activityCreateInput{}, fmt.Errorf("%w: manual activity type, content or metadata is invalid", ErrInvalidInput)
	}
	leadID, ok := normalizeUUID(input.LeadID)
	activityType := strings.TrimSpace(input.Type)
	if !ok || !validEnum(activityType, "note", "call", "call_initiated", "email", "message") {
		return invalid()
	}
	result := activityCreateInput{LeadID: leadID, Type: activityType, Metadata: make(map[string]any, len(input.Metadata)+1)}
	if input.Content != nil {
		content, valid := normalizeManualActivityText(*input.Content, 2_000)
		if !valid {
			return invalid()
		}
		if content != "" {
			result.Content = &content
		}
	}
	for key, raw := range input.Metadata {
		value, isString := raw.(string)
		if !isString {
			return invalid()
		}
		limit := 80
		switch key {
		case "phone":
			if activityType != "call" && activityType != "call_initiated" {
				return invalid()
			}
		case "notes":
			if !validEnum(activityType, "call", "email", "message") {
				return invalid()
			}
			limit = 2_000
		case "channel", "outcome":
			// Enumerated after normalization below.
		default:
			return invalid()
		}
		value, valid := normalizeManualActivityText(value, limit)
		if !valid || key == "channel" && !manualActivityChannelAllowed(activityType, value) ||
			key == "outcome" && !manualActivityOutcomeAllowed(activityType, value) {
			return invalid()
		}
		result.Metadata[key] = value
	}
	return result, nil
}

func normalizeManualActivityText(value string, limit int) (string, bool) {
	if !utf8.ValidString(value) || strings.ContainsRune(value, 0) {
		return "", false
	}
	value = strings.TrimSpace(value)
	return value, utf8.RuneCountInString(value) <= limit
}

func manualActivityChannelAllowed(activityType, channel string) bool {
	switch activityType {
	case "call_initiated":
		return channel == "phone"
	case "call":
		return validEnum(channel, "call", "phone")
	case "email":
		return channel == "email"
	case "message":
		return validEnum(channel, "message", "whatsapp")
	default:
		return false
	}
}

func manualActivityOutcomeAllowed(activityType, outcome string) bool {
	switch activityType {
	case "call":
		return validEnum(outcome, "answered", "not_answered", "invalid_number", "busy", "scheduled")
	case "email":
		return validEnum(outcome, "replied", "not_replied", "bounced")
	case "message":
		return validEnum(outcome, "replied", "seen_no_reply", "not_seen", "no_whatsapp", "scheduled")
	default:
		return false
	}
}
