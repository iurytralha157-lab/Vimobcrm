package leads

import (
	"strings"
	"testing"
)

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

func TestBuildWhatsAppNotificationTextNewLeadTemplate(t *testing.T) {
	t.Parallel()

	text := buildWhatsAppNotificationText("new_lead_received", "Novo lead recebido", "Edinel foi atribuido a voce", map[string]any{
		"lead_name":     "Edinel",
		"source":        "Meta Ads",
		"campaign_name": "[LINCE] CHACARA-$870 MIL",
		"form_name":     "Formulario principal",
	})

	expected := []string{
		"🔔 *NOVO LEAD*",
		"👤 Nome: Edinel",
		"📲 Origem: Meta Ads",
		"🎯 Campanha: [LINCE] CHACARA-$870 MIL",
		"🧾 Formulário: Formulario principal",
		"✅ Ação: acesse o CRM para atender",
	}
	for _, item := range expected {
		if !strings.Contains(text, item) {
			t.Fatalf("expected WhatsApp template to contain %q, got %q", item, text)
		}
	}
}

func TestNotificationVariablesMergesLegacyMetadata(t *testing.T) {
	t.Parallel()

	variables := notificationVariables(map[string]any{
		"lead_name": "Lead legado",
		"source":    "Meta Ads",
		"variables": map[string]any{
			"campaign_name": "Campanha nova",
		},
		"dispatch": map[string]any{"whatsapp": map[string]any{"status": "pending"}},
	})

	if got := stringFromMap(variables, "lead_name"); got != "Lead legado" {
		t.Fatalf("expected legacy lead_name, got %q", got)
	}
	if got := stringFromMap(variables, "campaign_name"); got != "Campanha nova" {
		t.Fatalf("expected nested campaign_name, got %q", got)
	}
	if _, exists := variables["dispatch"]; exists {
		t.Fatal("dispatch metadata must not be exposed as template variable")
	}
}
