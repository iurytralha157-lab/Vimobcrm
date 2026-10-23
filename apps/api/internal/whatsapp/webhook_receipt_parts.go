package whatsapp

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
)

const evolutionWebhookReceiptEffectKey = "receipt_effect"

var errEvolutionMixedReceiptContent = errors.New("WhatsApp receipt contains unclassified message content")

// Run this before either executor. A status-named callback cannot acknowledge
// a customer's content just because the delivery parser recognized one field.
func evolutionWebhookMixedReceiptError(item pendingEvolutionWebhook) error {
	payload, err := decodeNativeEvolutionPayload(item.Payload)
	if err != nil || !nativeIsStatusEvent(nativeEvolutionEventName(payload, item.EventType)) {
		return nil // The normal decoder/message path owns these events.
	}
	if nativeEvolutionAuxiliaryHasMessages(payload) ||
		nativePayloadHasPotentialCustomerContent(payload, 0) {
		return errEvolutionMixedReceiptContent
	}
	return nil
}

// The inbox itself is the durable receipt-effect ledger. This classifier is
// deliberately narrower than the legacy parser: unknown or mixed envelopes
// keep their original fence instead of losing an unclassified side effect.
func splitEvolutionWebhookReceiptEffects(envelope evolutionWebhookEnvelope) ([][]byte, bool, error) {
	payload, err := decodeNativeEvolutionPayload(envelope.Payload)
	if err != nil {
		return nil, false, nil
	}
	delete(payload, evolutionWebhookRoutingMetaKey) // Never trust provider hints.
	if !receiptUniqueKeys(payload) {
		return nil, false, nil
	}
	event := nativeEvolutionEventName(payload, envelope.EventType)
	if strings.TrimSpace(envelope.EventType) != "" && compactEvolutionWebhookControlName(envelope.EventType) != compactEvolutionWebhookControlName(event) {
		return nil, false, nil
	}
	switch compactEvolutionWebhookControlName(event) {
	case "receipt", "receipts", "ack", "messageack", "messagesack", "status", "messagestatus", "messagesstatus", "messagesupdate":
	default:
		return nil, false, nil
	}
	for key, value := range payload {
		switch compactEvolutionWebhookControlName(key) {
		case "data":
		case "event", "state", "status", "type", "instance", "instanceid", "instancename", "sessionid":
			if !receiptTransportScalar(value) {
				return nil, false, nil
			}
		default:
			return nil, false, nil
		}
	}
	if _, first := payload["data"]; first {
		if _, second := payload["Data"]; second {
			return nil, false, nil
		}
	}
	entries, ok := strictEvolutionReceiptEntries(nativeFirstValue(payload, "data", "Data"))
	if !ok || len(entries) == 0 || len(entries) > evolutionWebhookMaxSplitMessages {
		return nil, false, nil
	}
	effects := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		if !strictEvolutionReceiptEntry(entry) || !receiptStatusAliasesAgree(entry) || !receiptStatusAliasesAgree(payload) {
			return nil, false, nil
		}
		ids := nativeStringList(nativeFirstValue(entry, "MessageIDs", "messageIds", "message_ids"))
		ids = uniqueStrings(append(ids, firstString(entry, "messageId", "message_id", "id", "ID", "key.id", "Key.ID"))...)
		status := nativeProviderStatus(firstNonEmpty(
			firstString(entry, "status", "Status", "state", "State", "ack", "Ack", "type", "Type"),
			firstString(payload, "state", "State", "status", "Status"),
		))
		if len(ids) == 0 || status == "" {
			return nil, false, nil
		}
		for _, id := range ids {
			if len(id) > 200 || strings.TrimSpace(id) != id || strings.ContainsAny(id, "\x00\r\n") {
				return nil, false, nil
			}
			effect := map[string]any{"messageId": id, "status": status}
			if timestamp := nativeFirstValue(entry, "timestamp", "Timestamp", "time", "date"); timestamp != nil {
				if nativeTimestamp(timestamp).IsZero() {
					return nil, false, nil
				}
				effect["timestamp"] = timestamp
			}
			if reason := firstString(entry, "error", "reason"); reason != "" {
				effect["error"] = reason
			}
			effects = append(effects, effect)
			if len(effects) > evolutionWebhookMaxSplitMessages {
				return nil, false, nil
			}
		}
	}
	parts := make([][]byte, 0, len(effects))
	for index, effect := range effects {
		clone := cloneEvolutionWebhookMap(payload)
		delete(clone, "Data")
		delete(clone, "Event")
		// Legacy Edge selects its receipt handler by event name; messages.update
		// alone would otherwise enter its message path. The inbox event type and
		// original event key remain unchanged for retention/replay provenance.
		clone["event"] = "receipt"
		clone["data"] = map[string]any{"receipts": []any{effect}}
		metadata := map[string]any{
			"routing_key":   evolutionReceiptTargetRoute(effect["messageId"].(string)),
			"epoch_capable": true,
			evolutionWebhookReceiptEffectKey: map[string]any{
				"version": 1, "parent_event_key": envelope.EventKey,
				"ordinal": index, "total": len(effects),
				"target_hash":  receiptIdentityHash(effect["messageId"].(string)),
				"source_event": event, "source_payload_hash": receiptIdentityHash(string(envelope.Payload)),
			},
		}
		clone[evolutionWebhookRoutingMetaKey] = metadata
		encoded, err := json.Marshal(clone)
		if err != nil {
			return nil, false, err
		}
		parts = append(parts, encoded)
	}
	return parts, true, nil
}

func receiptTransportScalar(value any) bool {
	switch typed := value.(type) {
	case string:
		return len(typed) <= 1024 && !strings.ContainsAny(typed, "\x00\r\n")
	case float64, bool:
		return true
	default:
		return false
	}
}

func strictEvolutionReceiptEntries(data any) ([]map[string]any, bool) {
	if values, ok := data.([]any); ok {
		entries := make([]map[string]any, 0, len(values))
		for _, value := range values {
			entry, ok := value.(map[string]any)
			if !ok {
				return nil, false
			}
			entries = append(entries, entry)
		}
		return entries, true
	}
	entry, ok := data.(map[string]any)
	if !ok || !receiptUniqueKeys(entry) {
		return nil, false
	}
	for key, value := range entry {
		name := compactEvolutionWebhookControlName(key)
		_, array := value.([]any)
		if name == "receipts" || name == "statuses" || (name == "status" && array) {
			if len(entry) != 1 {
				return nil, false
			}
			values, ok := value.([]any)
			if !ok {
				return nil, false
			}
			return strictEvolutionReceiptEntries(values)
		}
	}
	return []map[string]any{entry}, true
}

func strictEvolutionReceiptEntry(entry map[string]any) bool {
	if !receiptUniqueKeys(entry) {
		return false
	}
	identityFields, clockFields := 0, 0
	for key, value := range entry {
		switch compactEvolutionWebhookControlName(key) {
		case "messageids":
			identityFields++
			values, ok := value.([]any)
			if !ok || len(values) == 0 || len(values) > evolutionWebhookMaxSplitMessages {
				return false
			}
			for _, id := range values {
				if text, ok := id.(string); !ok || text == "" || len(text) > 200 || text != strings.TrimSpace(text) || strings.ContainsAny(text, "\x00\r\n") {
					return false
				}
			}
		case "key":
			object, ok := value.(map[string]any)
			if !ok || !receiptUniqueKeys(object) {
				return false
			}
			for field, content := range object {
				switch compactEvolutionWebhookControlName(field) {
				case "id":
					identityFields++
					if text, ok := content.(string); !ok || text == "" || len(text) > 200 || text != strings.TrimSpace(text) || strings.ContainsAny(text, "\x00\r\n") {
						return false
					}
				case "remotejid", "fromme":
					if !receiptTransportScalar(content) {
						return false
					}
				default:
					return false
				}
			}
		case "isgroup":
			if group, ok := value.(bool); !ok || group {
				return false
			}
		case "id", "messageid":
			identityFields++
			if text, ok := value.(string); !ok || text == "" || len(text) > 200 || text != strings.TrimSpace(text) || strings.ContainsAny(text, "\x00\r\n") {
				return false
			}
		case "timestamp", "time", "date":
			clockFields++
			if !receiptTransportScalar(value) {
				return false
			}
		case "status", "state", "ack", "type", "error", "reason", "chat", "chatid", "remotejid", "fromme", "isfromme":
			if !receiptTransportScalar(value) {
				return false
			}
		default:
			return false
		}
	}
	if identityFields != 1 || clockFields > 1 {
		return false
	}
	chat := firstNonEmpty(firstString(entry, "Chat", "chat", "chatId", "chat_id", "remoteJid", "RemoteJID", "remote_jid", "key.remoteJid", "Key.RemoteJID"))
	lower := strings.ToLower(chat)
	return !strings.Contains(lower, "@g.us") && !strings.Contains(lower, "@broadcast") && !strings.Contains(lower, "@newsletter")
}

func receiptUniqueKeys(object map[string]any) bool {
	seen := make(map[string]bool, len(object))
	for key := range object {
		name := compactEvolutionWebhookControlName(key)
		if seen[name] {
			return false
		}
		seen[name] = true
	}
	return true
}

func receiptStatusAliasesAgree(object map[string]any) bool {
	status := ""
	for key, value := range object {
		switch compactEvolutionWebhookControlName(key) {
		case "status", "state", "ack", "type":
			candidate := nativeProviderStatus(stringFromAny(value))
			if candidate == "" || (status != "" && status != candidate) {
				return false
			}
			status = candidate
		}
	}
	return true
}

func receiptIdentityHash(identity string) string {
	sum := sha256.Sum256([]byte(identity))
	return hex.EncodeToString(sum[:])
}

func evolutionReceiptTargetRoute(identity string) string {
	return "receipt-target:" + receiptIdentityHash(identity)
}
