package whatsapp

import (
	"regexp"
	"strings"
)

const (
	deliveryErrorRecipientNotRegistered = "recipient_not_registered"
	deliveryErrorOutcomeUnknown         = "outcome_unknown"
	deliveryErrorSendFailed             = "send_failed"
)

// Evolution Go has returned this explicit rejection inside an HTTP 500. Only
// this exact recipient result is definitive; other 5xx responses remain unsafe
// to retry automatically because the provider may already have sent the stanza.
var evolutionRecipientNotRegistered = regexp.MustCompile(`(?i)\bnumber\s+\+?[0-9]{7,18}@s\.whatsapp\.net\s+is not registered on whatsapp\b`)

func isEvolutionRecipientNotRegistered(message string) bool {
	return evolutionRecipientNotRegistered.MatchString(message)
}

func messageDeliveryErrorCode(lastError string) string {
	if strings.Contains(lastError, ErrRecipientNotRegistered.Error()) || isEvolutionRecipientNotRegistered(lastError) {
		return deliveryErrorRecipientNotRegistered
	}
	if strings.TrimSpace(lastError) == whatsappOutboxProviderUnknownMarker ||
		strings.Contains(lastError, ErrProviderOutcomeUnknown.Error()) {
		return deliveryErrorOutcomeUnknown
	}
	return deliveryErrorSendFailed
}
