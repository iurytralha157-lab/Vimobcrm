package leads

import "testing"

func TestShouldDispatchLeadWhatsAppNotification(t *testing.T) {
	t.Parallel()

	criticalEvents := []string{
		"new_lead_received",
		"lead_reentry",
		"lead_duplicate_existing",
		"lead_transferred",
		"lead_stage_changed",
		"deal_won",
		"lead_redistribution_warning",
		"lead_redistributed_received",
		"lead_redistributed_away",
		"whatsapp_disconnected",
		"schedule_reminder",
	}
	for _, eventKey := range criticalEvents {
		if !shouldDispatchLeadWhatsAppNotification(eventKey) {
			t.Fatalf("expected %s to require WhatsApp dispatch", eventKey)
		}
	}

	if shouldDispatchLeadWhatsAppNotification("gamification_update") {
		t.Fatal("gamification update must not trigger WhatsApp dispatch")
	}
}

func TestApplyNotificationDispatchMetadata(t *testing.T) {
	t.Parallel()

	metadata := applyNotificationDispatchMetadata(map[string]any{}, "deal_won", nil)
	dispatch := mapFromAny(metadata["dispatch"])

	if !truthyValue(mapFromAny(dispatch["whatsapp"])["required"]) {
		t.Fatal("deal_won must require WhatsApp dispatch")
	}
	if !truthyValue(mapFromAny(dispatch["push"])["required"]) {
		t.Fatal("deal_won must require push dispatch")
	}
	if !truthyValue(mapFromAny(dispatch["email"])["required"]) {
		t.Fatal("deal_won must require email dispatch")
	}
}
