package leads

import (
	"encoding/base64"
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

func TestShouldInsertTransferNotification(t *testing.T) {
	t.Parallel()

	if shouldInsertTransferNotification("auto_redistribution") {
		t.Fatal("automatic redistribution must rely on its specialized notifications")
	}
	if !shouldInsertTransferNotification("manual_transfer") {
		t.Fatal("manual transfers must keep the generic transfer notification")
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

	if !isPermanentPushDeliveryFailure(DispatchChannelResult{Provider: "web_push", Status: 410}) {
		t.Fatal("410 must deactivate an expired Web Push subscription")
	}
	if isPermanentPushDeliveryFailure(DispatchChannelResult{Error: "vapid_private_key_missing"}) {
		t.Fatal("missing server VAPID key must not deactivate user subscriptions")
	}
	if isPermanentPushDeliveryFailure(DispatchChannelResult{Provider: "fcm_v1", Status: 404, Error: "project not found"}) {
		t.Fatal("FCM project/configuration errors must not deactivate native tokens")
	}
	if isPermanentPushDeliveryFailure(DispatchChannelResult{Provider: "fcm_v1", Status: 404, Error: "Requested entity was not found."}) {
		t.Fatal("generic FCM 404 messages must not deactivate native tokens")
	}
	if !isPermanentPushDeliveryFailure(DispatchChannelResult{Provider: "fcm_v1", Status: 404, Error: "fcm_unregistered"}) {
		t.Fatal("explicit FCM unregistered errors must deactivate native tokens")
	}
	if !isPermanentPushDeliveryFailure(DispatchChannelResult{Error: "UNREGISTERED"}) {
		t.Fatal("unregistered FCM token must be treated as permanent")
	}
	if isPermanentPushDeliveryFailure(DispatchChannelResult{Provider: "web_push", Status: 401, Error: "401 Unauthorized"}) {
		t.Fatal("401 Web Push auth errors are VAPID/server credential failures and must not deactivate valid subscriptions")
	}
	if isPermanentPushDeliveryFailure(DispatchChannelResult{Provider: "fcm_v1", Status: 401, Error: "401 Unauthorized"}) {
		t.Fatal("401 FCM auth errors are server credential failures and must not deactivate native tokens")
	}
	if isPermanentPushDeliveryFailure(DispatchChannelResult{Provider: "web_push", Error: "the VAPID credentials in the authorization header do not correspond"}) {
		t.Fatal("VAPID mismatch must remain retryable because it can be caused by server configuration drift")
	}
	if !isPermanentPushDeliveryFailure(DispatchChannelResult{Error: "web_push_subscription_incomplete"}) {
		t.Fatal("incomplete legacy Web Push subscriptions must be deactivated")
	}
	if isPermanentPushDeliveryFailure(DispatchChannelResult{Status: 503, Error: "temporary provider failure"}) {
		t.Fatal("temporary provider failure must remain retryable")
	}
}

func TestPermanentPushFailureIsNotRetriedOrOverwritten(t *testing.T) {
	t.Parallel()

	metadata := setNotificationChannelDispatch(map[string]any{}, "push", DispatchChannelResult{
		Enabled:   true,
		Attempted: true,
		Permanent: true,
		Provider:  "web_push",
		Status:    401,
		Error:     "VAPID credentials do not correspond",
	})
	pushDispatch := mapFromAny(mapFromAny(metadata["dispatch"])["push"])

	if pushDispatch["status"] != "permanent_failed" {
		t.Fatalf("expected permanent_failed status, got %#v", pushDispatch["status"])
	}
	if pushDispatch["attempts"] != 1 {
		t.Fatalf("expected one dispatch attempt, got %#v", pushDispatch["attempts"])
	}
	if shouldAttemptNotificationChannel(metadata, "push", nil) {
		t.Fatal("permanent push failure must not be retried")
	}
	if pushDispatch["error"] != "VAPID credentials do not correspond" {
		t.Fatalf("expected provider error to be preserved, got %#v", pushDispatch["error"])
	}
}

func TestPushSubscriptionRoutingDoesNotTreatLegacyWebTokenAsNative(t *testing.T) {
	t.Parallel()

	legacyWeb := pushSubscription{
		Token:    "https://updates.push.services.mozilla.com/wpush/v2/example",
		Platform: "web",
	}
	if isNativePushSubscription(legacyWeb) {
		t.Fatal("legacy web push endpoints stored in token must not be sent through FCM")
	}

	nativeAndroid := pushSubscription{
		Token:    "fcm-token",
		Platform: "android",
	}
	if !isNativePushSubscription(nativeAndroid) {
		t.Fatal("android tokens must be sent through native FCM delivery")
	}

	nativeEndpoint := pushSubscription{
		Endpoint: "native:ios:apns-or-fcm-token",
		Platform: "web",
	}
	if !isNativePushSubscription(nativeEndpoint) {
		t.Fatal("native endpoint prefix must force native delivery")
	}
}

func TestPushClientRecognizesFCMV1Credentials(t *testing.T) {
	t.Parallel()

	client := newNotificationPushClient(PushConfig{
		FCMProjectID:          "vimob-test",
		FCMServiceAccountJSON: `{"project_id":"vimob-test","client_email":"firebase-adminsdk@example.iam.gserviceaccount.com","private_key":"-----BEGIN PRIVATE KEY-----\n-----END PRIVATE KEY-----\n"}`,
	})
	if !client.hasNativeFCMSender() {
		t.Fatal("FCM v1 service account must enable native push sender")
	}
	if !client.hasAnySender() {
		t.Fatal("FCM v1 service account must count as a push sender")
	}
	if !client.hasFCMV1CredentialSource() {
		t.Fatal("FCM v1 credential source must be detected")
	}
}

func TestNormalizeServiceAccountJSONAcceptsBase64URL(t *testing.T) {
	t.Parallel()

	raw := `{"project_id":"vimob-test"}`
	encoded := base64.RawURLEncoding.EncodeToString([]byte(raw))
	if string(normalizeServiceAccountJSON(encoded)) != raw {
		t.Fatal("base64url service account JSON must be decoded")
	}
}

func TestClassifyFCMV1ErrorRequiresExplicitUnregisteredCode(t *testing.T) {
	t.Parallel()

	unregistered := []byte(`{"error":{"code":404,"message":"Requested entity was not found.","status":"NOT_FOUND","details":[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError","errorCode":"UNREGISTERED"}]}}`)
	if got := classifyFCMV1Error(unregistered, "404"); got != "fcm_unregistered" {
		t.Fatalf("expected explicit unregistered marker, got %q", got)
	}

	projectMissing := []byte(`{"error":{"code":404,"message":"Requested entity was not found.","status":"NOT_FOUND"}}`)
	if got := classifyFCMV1Error(projectMissing, "404"); got == "fcm_unregistered" {
		t.Fatal("generic FCM NOT_FOUND must remain a configuration/provider error")
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

func TestBuildWhatsAppNotificationTextScheduleReminderIncludesLinkedDetails(t *testing.T) {
	t.Parallel()

	text := buildWhatsAppNotificationText("schedule_reminder", "Lembrete de agenda", "", map[string]any{
		"schedule_title":      "Visita com Maria",
		"schedule_event_type": "visit",
		"start_time":          "2026-07-17T18:30:00+00:00",
		"created_at":          "2026-07-10T10:00:00+00:00",
		"lead_name":           "Maria Silva",
		"property_title":      "Apartamento Centro",
		"property_code":       "AP-123",
	})

	expected := []string{
		"\u23f0 *LEMBRETE DE AGENDA*",
		"\U0001f4cc Atividade: Visita com Maria",
		"\U0001f9ed Tipo: Visita ao im\u00f3vel",
		"\U0001f4c5 Hor\u00e1rio: 17/07/2026 | 15:30",
		"\U0001f464 Lead: Maria Silva",
		"\U0001f3e0 Im\u00f3vel: Apartamento Centro (AP-123)",
		"\u2705 A\u00e7\u00e3o: acesse a agenda",
	}
	for _, item := range expected {
		if !strings.Contains(text, item) {
			t.Fatalf("expected schedule reminder template to contain %q, got %q", item, text)
		}
	}
	if strings.Contains(text, "2026-07-17T18:30:00+00:00") {
		t.Fatalf("schedule reminder must format start_time before rendering, got %q", text)
	}
}

func TestBuildWhatsAppNotificationTextScheduleReminderOmitsUnlinkedDetails(t *testing.T) {
	t.Parallel()

	text := buildWhatsAppNotificationText("schedule_reminder", "Lembrete de agenda", "", map[string]any{
		"schedule_title":      "Retorno com cliente",
		"schedule_event_type": "call",
		"start_time":          "2026-07-17T18:30:00+00:00",
	})

	expected := []string{
		"\U0001f4cc Atividade: Retorno com cliente",
		"\U0001f9ed Tipo: Liga\u00e7\u00e3o",
		"\U0001f4c5 Hor\u00e1rio: 17/07/2026 | 15:30",
	}
	for _, item := range expected {
		if !strings.Contains(text, item) {
			t.Fatalf("expected schedule reminder template to contain %q, got %q", item, text)
		}
	}
	if strings.Contains(text, "Lead:") || strings.Contains(text, "Im\u00f3vel:") {
		t.Fatalf("schedule reminder must omit unlinked lead/property fields, got %q", text)
	}
}

func TestRenderNotificationTemplateTextFormatsScheduleReminderPlaceholders(t *testing.T) {
	t.Parallel()

	text := renderNotificationTemplateText("Horario: {start_time}\nTipo: {schedule_event_type_label}\nImovel: {property_name}", map[string]any{
		"start_time":          "2026-07-17T18:30:00+00:00",
		"schedule_event_type": "meeting",
		"property_title":      "Casa Jardim",
		"property_code":       "CA-77",
	})

	expected := []string{
		"Horario: 17/07/2026 | 15:30",
		"Tipo: Reuni\u00e3o",
		"Imovel: Casa Jardim (CA-77)",
	}
	for _, item := range expected {
		if !strings.Contains(text, item) {
			t.Fatalf("expected rendered schedule reminder template to contain %q, got %q", item, text)
		}
	}
}
