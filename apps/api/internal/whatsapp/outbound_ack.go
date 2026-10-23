package whatsapp

import "strings"

// A successful HTTP transport is not proof that a send was accepted. Preserve
// only the adapter's existing canonical ID and explicit success contracts;
// contradictory, empty or malformed bodies remain unsafe to resend.
func evolutionSendAcknowledged(data any) bool {
	if evolutionSemanticFailure(data) || evolutionSendHasError(data) {
		return false
	}
	if strings.TrimSpace(evolutionSentMessageID(data)) != "" {
		return true
	}
	for _, path := range []string{"success", "ok", "data.success", "data.ok"} {
		if success, present := boolAtPath(data, path); present && success {
			return true
		}
	}
	return false
}

func evolutionSendHasError(data any) bool {
	root := mapFromAny(data)
	for _, node := range []map[string]any{root, mapFromAny(root["data"])} {
		value, exists := node["error"]
		if !exists || value == nil || value == false {
			continue
		}
		if message, ok := value.(string); ok && strings.TrimSpace(message) == "" {
			continue
		}
		return true
	}
	return false
}
