package leads

import (
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

type notificationRoundTripFunc func(*http.Request) (*http.Response, error)

func (function notificationRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

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
		"billing_due_today",
		"billing_payment_confirmed",
		"billing_payment_receipt",
		"onboarding_welcome",
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

func TestTransactionalEmailCapturesResendIdentityAndIdempotency(t *testing.T) {
	t.Parallel()

	client := newNotificationEmailClient(EmailConfig{
		ResendAPIKey: "test-key",
		FromEmail:    "Vimob <naoresponde@vimobcrm.com.br>",
		AppURL:       "https://app.vimobcrm.com.br",
	})
	client.httpClient = &http.Client{Transport: notificationRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if got := request.Header.Get("Idempotency-Key"); got != "vimob:billing_payment_receipt:notification-id:v1" {
			t.Fatalf("unexpected idempotency header %q", got)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"id":"resend-message-id"}`)),
			Request:    request,
		}, nil
	})}

	result := client.sendBilling(context.Background(), billingEmailPayload{
		RecipientEmail:   "financeiro@example.com",
		Title:            "Comprovante de pagamento Vimob",
		EventKey:         "billing_payment_receipt",
		ReceiptNumber:    "VIMOB-202608-ABC123",
		Organization:     "Imobiliaria Exemplo",
		PayerName:        "Imobiliaria Exemplo Ltda",
		PayerTaxID:       "12345678000195",
		PlanName:         "Pro",
		BillingPeriod:    "mensal",
		BillingType:      "PIX",
		Amount:           "R$ 297,00",
		PaidAt:           "03/08/2026 17:30",
		VerificationPath: "/comprovantes/22222222-2222-4222-8222-222222222222",
		IdempotencyKey:   "vimob:billing_payment_receipt:notification-id:v1",
	})

	if !result.OK || result.MessageID != "resend-message-id" {
		t.Fatalf("expected accepted Resend message, got %#v", result)
	}
	if result.Recipient != "financeiro@example.com" {
		t.Fatalf("expected normalized recipient, got %q", result.Recipient)
	}
}

func TestPaymentReceiptHTMLMasksTaxDocumentAndUsesVimobVerification(t *testing.T) {
	t.Parallel()

	client := newNotificationEmailClient(EmailConfig{AppURL: "https://app.vimobcrm.com.br"})
	html := client.paymentReceiptHTML(billingEmailPayload{
		ReceiptNumber:     "VIMOB-202608-ABC123",
		Organization:      "Imobiliaria Exemplo",
		PayerName:         "Imobiliaria Exemplo Ltda",
		PayerTaxID:        "12345678000195",
		PlanName:          "Pro",
		BillingPeriod:     "mensal",
		BillingType:       "PIX",
		Amount:            "R$ 297,00",
		PaidAt:            "03/08/2026 17:30",
		VerificationPath:  "/comprovantes/22222222-2222-4222-8222-222222222222",
		ProviderReference: "pay_123",
	})

	for _, expected := range []string{
		"VIMOB-202608-ABC123",
		"••••••••••0195",
		"https://app.vimobcrm.com.br/comprovantes/22222222-2222-4222-8222-222222222222",
		"não substitui nota fiscal",
	} {
		if !strings.Contains(html, expected) {
			t.Fatalf("expected receipt HTML to contain %q", expected)
		}
	}
	if strings.Contains(html, "12345678000195") {
		t.Fatal("receipt email must not expose the complete tax document")
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

func TestBillingNotificationChannelsAndWhatsAppTemplate(t *testing.T) {
	t.Parallel()

	if !shouldDispatchEmailNotification("billing_due_today") {
		t.Fatal("billing events must support email delivery")
	}
	if notificationTypeForEvent("billing_payment_confirmed") != "billing" {
		t.Fatal("billing events must keep their own in-app category")
	}

	text := buildWhatsAppNotificationText(
		"billing_due_today",
		"Sua assinatura vence hoje",
		"Consulte a cobranca dentro da sua conta Vimob.",
		map[string]any{
			"amount":      "R$ 297,00",
			"due_date":    "31/07/2026",
			"billing_url": "https://app.vimobcrm.com.br/settings?tab=subscription&billing=payments&payment=abc",
		},
	)

	for _, expected := range []string{
		"SUA ASSINATURA VENCE HOJE",
		"Valor: R$ 297,00",
		"Vencimento: 31/07/2026",
		"https://app.vimobcrm.com.br/settings?tab=subscription",
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("expected billing WhatsApp message to contain %q, got %q", expected, text)
		}
	}
}

func TestReceiptAndWelcomeWhatsAppTemplates(t *testing.T) {
	t.Parallel()

	receipt := buildWhatsAppNotificationText(
		"billing_payment_receipt",
		"Comprovante de pagamento Vimob",
		"Pagamento confirmado.",
		map[string]any{
			"receipt_number":   "VIMOB-202608-ABC123",
			"amount":           "R$ 297,00",
			"billing_type":     "PIX",
			"paid_at":          "03/08/2026 17:30",
			"verification_url": "https://app.vimobcrm.com.br/comprovantes/token",
		},
	)
	for _, expected := range []string{"VIMOB-202608-ABC123", "Pagamento: PIX", "Pago em: 03/08/2026 17:30", "https://app.vimobcrm.com.br/comprovantes/token"} {
		if !strings.Contains(receipt, expected) {
			t.Fatalf("expected receipt WhatsApp to contain %q, got %q", expected, receipt)
		}
	}

	welcome := buildWhatsAppNotificationText(
		"onboarding_welcome",
		"Bem-vindo ao Vimob",
		"Cadastro concluido.",
		map[string]any{
			"organization_name": "Imobiliaria Exemplo",
			"plan_name":         "Pro",
			"checkout_url":      "https://app.vimobcrm.com.br/checkout/token",
		},
	)
	for _, expected := range []string{"BEM-VINDO AO VIMOB", "Imobiliaria Exemplo", "Plano: Pro", "https://app.vimobcrm.com.br/checkout/token"} {
		if !strings.Contains(welcome, expected) {
			t.Fatalf("expected welcome WhatsApp to contain %q, got %q", expected, welcome)
		}
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

func TestTransientDeliveryFailureUsesDurableBackoff(t *testing.T) {
	t.Parallel()

	metadata := setNotificationChannelDispatch(map[string]any{}, "email", DispatchChannelResult{
		Enabled:   true,
		Attempted: true,
		Provider:  "resend",
		Status:    http.StatusServiceUnavailable,
		Error:     "temporary provider failure",
	})
	emailDispatch := mapFromAny(mapFromAny(metadata["dispatch"])["email"])
	if emailDispatch["status"] != "failed" {
		t.Fatalf("transient failure must remain retryable, got %#v", emailDispatch["status"])
	}
	if stringFromMap(emailDispatch, "next_attempt_at") == "" {
		t.Fatal("transient failure must schedule a future attempt")
	}
	if emailDispatch["status"] == "skipped" {
		t.Fatal("missing configuration or temporary failures must not be terminally skipped")
	}
}

func TestProviderAcceptanceAndSignedWebhookOutcomesAreNotAutomaticallyRetried(t *testing.T) {
	t.Parallel()

	for _, channel := range []string{"email", "whatsapp"} {
		metadata := setNotificationChannelDispatch(map[string]any{}, channel, DispatchChannelResult{
			Enabled:   true,
			Attempted: true,
			OK:        true,
			Provider:  "provider",
			Status:    http.StatusAccepted,
			MessageID: "provider-message-id",
		})
		dispatch := mapFromAny(mapFromAny(metadata["dispatch"])[channel])
		if dispatch["status"] != "accepted" {
			t.Fatalf("%s 2xx must mean accepted, not delivered: %#v", channel, dispatch)
		}
		if shouldAttemptNotificationChannel(metadata, channel, nil) {
			t.Fatalf("%s accepted request must not be duplicated automatically", channel)
		}
	}

	for _, terminalStatus := range []string{"delivered", "delivery_failed"} {
		metadata := map[string]any{
			"dispatch": map[string]any{
				"email": map[string]any{"required": true, "status": terminalStatus},
			},
		}
		if shouldAttemptNotificationChannel(metadata, "email", nil) {
			t.Fatalf("signed webhook status %s must require assisted/manual handling, not an automatic resend", terminalStatus)
		}
	}
}

func TestNotificationClaimTokenPreventsAnExpiredWorkerFromFinalizingAReclaimedChannel(t *testing.T) {
	t.Parallel()

	firstClaim := setNotificationChannelProcessing(map[string]any{}, "email", "claim-one")
	secondClaim := setNotificationChannelProcessing(map[string]any{}, "email", "claim-two")
	if !notificationClaimsMatch(firstClaim, firstClaim, nil) {
		t.Fatal("the active claim must match its persisted token")
	}
	if notificationClaimsMatch(firstClaim, secondClaim, nil) {
		t.Fatal("an expired worker must not finalize after another worker reclaimed the channel")
	}
	if notificationDispatchBatchLimit < 1 || notificationDispatchBatchLimit > 5 {
		t.Fatalf("delivery worker batch limit = %d; want a small bounded provider fan-out", notificationDispatchBatchLimit)
	}
	if notificationDispatchConcurrency < 1 || notificationDispatchConcurrency > 8 {
		t.Fatalf("delivery concurrency = %d; want a bounded worker pool", notificationDispatchConcurrency)
	}
	if notificationDispatchDrainLimit < notificationDispatchConcurrency || notificationDispatchDrainLimit > 100 {
		t.Fatalf("delivery drain limit = %d; want at least one job per worker and no unbounded drain", notificationDispatchDrainLimit)
	}
	if notificationDispatchClaimTimeout < 15*time.Minute {
		t.Fatalf("delivery claim timeout = %s; want at least 15 minutes", notificationDispatchClaimTimeout)
	}
}

func TestNotificationDrainUsesRowSkipLockedInsteadOfAGlobalClaimLock(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile("notification_dispatch_worker.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	if !strings.Contains(source, "for update skip locked") {
		t.Fatal("parallel claimers need row-level SKIP LOCKED")
	}
	if strings.Contains(source, "notificationDispatchLockKey") {
		t.Fatal("a global advisory lock disables the bounded three-worker drain")
	}
}

func TestCadenceNotificationDeliveryIsSuppressedWithoutTouchingOtherAttentionEvents(t *testing.T) {
	t.Parallel()

	for _, metadata := range []map[string]any{
		{"policy_type": "cadence_task", "event_key": "lead_attention_warning"},
		{"policy_type": " CADENCE_TASK ", "event_key": "lead_attention_overdue"},
		{"event_key": "cadence_task_reminder"},
		{"event_key": "LEAD_CADENCE_TASK"},
	} {
		if !isCadenceNotificationDeliverySuppressed(metadata) {
			t.Fatalf("cadence delivery was not suppressed for %#v", metadata)
		}
	}

	for _, metadata := range []map[string]any{
		nil,
		{},
		{"policy_type": "first_contact", "event_key": "lead_attention_warning"},
		{"event_key": "schedule_reminder"},
		{"event_key": "billing_payment_receipt"},
	} {
		if isCadenceNotificationDeliverySuppressed(metadata) {
			t.Fatalf("legitimate delivery was suppressed for %#v", metadata)
		}
	}
}

func TestPendingDeliveryQueryExcludesCadenceBeforeClaimLimit(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("notification_dispatch_worker.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	policyFilter := strings.Index(source, "metadata->>'policy_type'")
	eventFilter := strings.Index(source, "metadata->>'event_key'")
	claimLimit := strings.Index(source, "limit $2")
	if policyFilter < 0 || eventFilter < 0 || claimLimit < 0 {
		t.Fatal("pending-delivery query must contain cadence filters and its bounded limit")
	}
	if policyFilter > claimLimit || eventFilter > claimLimit {
		t.Fatal("cadence rows must be excluded before ORDER/LIMIT so they cannot block legitimate work")
	}
}

func TestCadenceDispatchGuardDoesNotPersistOrCallProviders(t *testing.T) {
	t.Parallel()

	delivery := (Repository{}).dispatchPendingNotification(
		context.Background(),
		pendingNotification{
			Metadata: map[string]any{
				"policy_type": "cadence_task",
				"dispatch": map[string]any{
					"push": map[string]any{"required": true, "status": "pending"},
				},
			},
		},
		nil,
	)

	if delivery.Error != "cadence_notification_delivery_disabled" {
		t.Fatalf("unexpected cadence guard result: %#v", delivery)
	}
	if !delivery.SkipPersistence {
		t.Fatal("retired cadence backlog must remain untouched instead of being claimed or rewritten")
	}
	if delivery.Push.Attempted || delivery.WhatsApp.Attempted || delivery.Email.Attempted {
		t.Fatal("retired cadence backlog must never reach a provider")
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
