package whatsapp

import (
	"errors"
	"strings"
)

var errPairSuccessAwaitingAuthoritativeConnection = errors.New("unsequenced PairSuccess awaits authoritative connection state")

// PairSuccess is a provider pairing control. Its scalar data.ID is the
// instance ID, but the generic message parser can mistake it for a message.
// Only the exact observed control shape may bypass message processing.
func exactPairSuccessControl(payload map[string]any, eventType string) bool {
	if strings.ToLower(strings.TrimSpace(eventType)) != "pairsuccess" ||
		payload["event"] != "PairSuccess" || len(payload) < 4 || len(payload) > 5 {
		return false
	}
	for key := range payload {
		switch key {
		case "event", "data", "instanceId", "instanceName", "__vimob_ingress":
		default:
			return false
		}
	}
	if _, ok := payload["instanceId"].(string); !ok {
		return false
	}
	if _, ok := payload["instanceName"].(string); !ok {
		return false
	}
	data, ok := payload["data"].(map[string]any)
	if !ok || len(data) != 6 || data["status"] != "open" {
		return false
	}
	for key, value := range data {
		switch key {
		case "BusinessName", "ID", "jid", "LID", "Platform", "status":
			if _, ok := value.(string); !ok {
				return false
			}
		default:
			return false
		}
	}
	jid, _ := data["jid"].(string)
	if !strings.HasSuffix(jid, "@s.whatsapp.net") || len(strings.Split(jid, "@")) != 2 {
		return false
	}
	phone := strings.SplitN(jid, "@", 2)[0]
	if len(phone) < 8 || len(phone) > 20 {
		return false
	}
	for _, digit := range phone {
		if digit < '0' || digit > '9' {
			return false
		}
	}
	if ingressValue, present := payload["__vimob_ingress"]; present {
		ingress, ok := ingressValue.(map[string]any)
		if !ok || len(ingress) != 2 {
			return false
		}
		if _, ok := ingress["routing_key"].(string); !ok {
			return false
		}
		snapshot, ok := ingress["routing_snapshot"].(map[string]any)
		if !ok || snapshot["version"] != float64(1) {
			return false
		}
		messages, ok := snapshot["messages"].([]any)
		if !ok || len(messages) > 1 {
			return false
		}
		for _, value := range messages {
			message, ok := value.(map[string]any)
			if !ok || message["binding_eligible"] != false ||
				message["state"] != "unlinked" ||
				message["context_kind"] != "organic" ||
				firstString(message, "event_lead_id", "current_lead_id", "conversation_id", "active_binding_id") != "" {
				return false
			}
		}
	}
	return true
}
