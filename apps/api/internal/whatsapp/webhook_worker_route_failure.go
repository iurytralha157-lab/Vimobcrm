package whatsapp

import (
	"encoding/hex"
	"strings"
)

// Only the server-authored route can isolate a failed claimed job. Opaque or
// malformed provenance remains a session fence rather than guessing a contact
// from provider payload, current bindings, names or phone numbers.
func evolutionWebhookFailureRoute(item pendingEvolutionWebhook) string {
	payload, err := decodeNativeEvolutionPayload(item.Payload)
	if err != nil {
		return evolutionWebhookSessionRoute
	}
	metadata := mapFromAny(payload[evolutionWebhookRoutingMetaKey])
	snapshot := mapFromAny(metadata["routing_snapshot"])
	version, ok := snapshot["version"].(float64)
	if !ok || version != 1 {
		return evolutionWebhookSessionRoute
	}
	messages, ok := snapshot["messages"].([]any)
	if !ok || len(messages) > evolutionWebhookMaxSplitMessages {
		return evolutionWebhookSessionRoute
	}
	route, ok := metadata["routing_key"].(string)
	if !ok || route != strings.TrimSpace(route) || len(route) > evolutionWebhookMaxRoutingBytes || strings.ContainsAny(route, "\x00\r\n") {
		return evolutionWebhookSessionRoute
	}
	if len(messages) > 0 {
		seen := map[string]bool{}
		for _, raw := range messages {
			row, ok := raw.(map[string]any)
			if !ok {
				return evolutionWebhookSessionRoute
			}
			providerID, ok := row["provider_message_id"].(string)
			if !ok || providerID == "" || seen[providerID] {
				return evolutionWebhookSessionRoute
			}
			seen[providerID] = true
			validated, err := nativeIngressRoutingSnapshotForMessage(item.Payload, nativeEvolutionSession{
				ID: item.SessionID, OrganizationID: item.OrganizationID,
			}, nativeEvolutionMessage{ProviderMessageID: providerID})
			if err != nil || validated == nil || validated.RoutingKey != route || validated.ProcessingEpoch != item.ProcessingEpoch {
				return evolutionWebhookSessionRoute
			}
		}
		for _, prefix := range []string{"jid:", "phone:"} {
			if strings.HasPrefix(route, prefix) && len(route) > len(prefix) {
				return route
			}
		}
		return evolutionWebhookSessionRoute
	}
	if strings.HasPrefix(route, "receipt-target:") {
		hash := strings.TrimPrefix(route, "receipt-target:")
		if len(hash) == 64 && hash == strings.ToLower(hash) {
			if _, err := hex.DecodeString(hash); err == nil {
				effect := mapFromAny(metadata[evolutionWebhookReceiptEffectKey])
				statuses := extractNativeEvolutionStatuses(payload)
				if effect["version"] == float64(1) && effect["target_hash"] == hash &&
					strings.TrimSpace(stringFromAny(effect["parent_event_key"])) != "" &&
					len(statuses) == 1 && len(statuses[0].MessageIDs) == 1 && receiptIdentityHash(statuses[0].MessageIDs[0]) == hash {
					return route
				}
			}
		}
	}
	return evolutionWebhookSessionRoute
}
