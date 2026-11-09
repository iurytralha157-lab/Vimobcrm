package whatsapp

// PairSuccess confirms pairing, even when Evolution Go adds status=open. A
// separate Connected event or a provider status probe confirms the connection.
// Match only the provider's scalar pairing envelope so an ID and JID cannot
// be mistaken for a contentless customer message.
func nativeEvolutionPairSuccessControl(payload map[string]any, event string) bool {
	if compactEvolutionWebhookControlName(event) != "pairsuccess" {
		return false
	}
	for key, value := range payload {
		switch key {
		case "event", "Event", "type", "Type", "action":
			if compactEvolutionWebhookControlName(stringFromAny(value)) != "pairsuccess" {
				return false
			}
		case "instanceId", "instanceID", "instance_id", "instanceName", "instance_name", "instance",
			"sessionId", "session_id", "timestamp", "date_time", "dateTime":
			switch value.(type) {
			case nil, string, float64:
			default:
				return false
			}
		case "data", "Data":
			if value == nil {
				continue
			}
			data, ok := value.(map[string]any)
			if !ok {
				return false
			}
			for field, fieldValue := range data {
				switch compactEvolutionWebhookControlName(field) {
				case "id", "lid", "businessname", "platform", "status", "jid", "pushname":
					if _, ok := fieldValue.(string); fieldValue != nil && !ok {
						return false
					}
				default:
					return false
				}
			}
		case evolutionWebhookRoutingMetaKey:
			// A previous parser may have treated the pairing JID as a message.
			// Never publish a routing outcome for an unprocessed message.
			snapshots, ok := nativeValueAt(mapFromAny(value), "routing_snapshot.messages").([]any)
			if !ok {
				return false
			}
			for _, snapshot := range snapshots {
				eligible, known := nativeBool(mapFromAny(snapshot)["binding_eligible"])
				if !known || eligible {
					return false
				}
			}
		default:
			return false
		}
	}
	return true
}
