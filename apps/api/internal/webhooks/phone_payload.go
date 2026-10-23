package webhooks

import (
	"math"
	"strconv"
	"strings"
)

func mappedPayloadPhone(webhook incomingWebhook, payload map[string]any) (*string, error) {
	keys := []string{"phone", "telefone", "whatsapp"}
	if mappedKey := strings.TrimSpace(webhook.FieldMapping["phone"]); mappedKey != "" {
		keys = append([]string{mappedKey}, keys...)
	}
	for _, key := range keys {
		value := payload[key]
		if number, ok := value.(float64); ok {
			// JSON objects decode numbers as float64. The accepted 15-digit phone
			// range is exactly representable; reject anything outside it rather
			// than rounding or letting an exponent become part of the identity.
			if math.IsNaN(number) || math.IsInf(number, 0) || number <= 0 ||
				number > 999999999999999 || math.Trunc(number) != number {
				return nil, ErrInvalidInput
			}
			phone := strconv.FormatFloat(number, 'f', -1, 64)
			return &phone, nil
		}
		if phone := payloadText(value); phone != nil {
			return phone, nil
		}
	}
	return nil, nil
}
