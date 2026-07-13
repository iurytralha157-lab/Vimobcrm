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
		"test_push",
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

func TestPermanentPushDeliveryFailure(t *testing.T) {
	t.Parallel()

	if !isPermanentPushDeliveryFailure(DispatchChannelResult{Status: 410}) {
		t.Fatal("410 must deactivate an expired Web Push subscription")
	}
	if !isPermanentPushDeliveryFailure(DispatchChannelResult{Error: "UNREGISTERED"}) {
		t.Fatal("unregistered FCM token must be treated as permanent")
	}
	if isPermanentPushDeliveryFailure(DispatchChannelResult{Status: 503, Error: "temporary provider failure"}) {
		t.Fatal("temporary provider failure must remain retryable")
	}
}

func TestBuildWhatsAppNotificationTextNewLeadTemplate(t *testing.T) {
	t.Parallel()

	text := buildWhatsAppNotificationText("new_lead_received", "Novo lead recebido", "Edinel foi atribuido a voce", map[string]any{
		"lead_name":     "Edinel",
		"source":        "Meta Ads",
		"campaign_name": "[LINCE] CHACARA-$870 MIL",
		"form_name":     "Formulario principal",
		"created_time":  "2026-07-10T01:06:42-03:00",
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
	if strings.Contains(text, "Data:") || strings.Contains(text, "2026-07-10T01:06:42-03:00") {
		t.Fatalf("new lead WhatsApp template must not contain date, got %q", text)
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

func TestRenderNotificationTemplateTextSupportsLegacyPlaceholders(t *testing.T) {
	t.Parallel()

	template := "🔔 NOVO LEAD\n👤 Nome: {lead_name}\n📱 Origem: {source}\n🎯 Campanha: {campaign_name}\n📅 Data: {lead_created_at}\nIgnorar: {unknown_value}"
	text := renderNotificationTemplateText(template, map[string]any{
		"lead_name":     "Maria Silva",
		"source":        "Meta Ads",
		"campaign_name": "",
		"created_time":  "1783850804",
	})

	expected := []string{
		"🔔 NOVO LEAD",
		"👤 Nome: Maria Silva",
		"📱 Origem: Meta Ads",
		"📅 Data: 12/07/2026 | 07:06",
	}
	for _, item := range expected {
		if !strings.Contains(text, item) {
			t.Fatalf("expected rendered template to contain %q, got %q", item, text)
		}
	}
	if strings.Contains(text, "Campanha:") || strings.Contains(text, "Ignorar:") || strings.Contains(text, "{") {
		t.Fatalf("rendered template must not expose empty or unresolved placeholders, got %q", text)
	}
}

func TestRenderNotificationTemplateTextKeepsDoubleBraceFormat(t *testing.T) {
	t.Parallel()

	text := renderNotificationTemplateText("Lead: {{ lead_name }}", map[string]any{"lead_name": "Joao"})
	if text != "Lead: Joao" {
		t.Fatalf("expected double-brace placeholder to remain supported, got %q", text)
	}
}
