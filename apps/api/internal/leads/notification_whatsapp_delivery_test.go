package leads

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestNotificationWhatsAppMessageIDIsStableAndTenantScoped(t *testing.T) {
	t.Parallel()

	firstKey := notificationWhatsAppIdempotencyKey(
		"11111111-1111-4111-8111-111111111111",
		"billing_payment_receipt",
		"receipt:22222222-2222-4222-8222-222222222222",
	)
	secondKey := notificationWhatsAppIdempotencyKey(
		"33333333-3333-4333-8333-333333333333",
		"billing_payment_receipt",
		"receipt:22222222-2222-4222-8222-222222222222",
	)
	firstID := deterministicNotificationWhatsAppMessageID(firstKey)

	if firstID != deterministicNotificationWhatsAppMessageID(firstKey) {
		t.Fatal("the same notification idempotency key must always produce the same stanza ID")
	}
	if firstID == deterministicNotificationWhatsAppMessageID(secondKey) {
		t.Fatal("the same dedupe key in different organizations must not share a provider stanza ID")
	}
	if len(firstID) != 32 || firstID != strings.ToUpper(firstID) {
		t.Fatalf("provider stanza ID = %q, want 32 uppercase hexadecimal characters", firstID)
	}
}

func TestTransactionalWhatsAppClaimPersistsExactReceiptCorrelationBeforeHTTP(t *testing.T) {
	t.Parallel()
	notification := pendingNotification{
		ID:             "20ff58b1-6f5b-4290-9c52-835a3d2e0c2b",
		OrganizationID: "f46ce055-0b0a-480a-b956-8eaa2c16a5cd",
		Metadata: map[string]any{
			"event_key":          "billing_due_today",
			"dedupe_key":         "billing:billing_due_today:payment-id",
			"recipient_whatsapp": "+55 (11) 99999-1111",
			"dispatch": map[string]any{
				"whatsapp": map[string]any{"required": true, "status": "pending"},
			},
		},
	}
	claimed := setNotificationChannelProcessing(notification.Metadata, "whatsapp", "claim-token")
	prepared := prepareTransactionalWhatsAppReceiptCorrelation(claimed, notification)
	dispatch := mapFromAny(mapFromAny(prepared["dispatch"])["whatsapp"])
	idempotencyKey := notificationWhatsAppIdempotencyKey(
		notification.OrganizationID,
		"billing_due_today",
		"billing:billing_due_today:payment-id",
	)
	if dispatch["status"] != "processing" || dispatch["claim_token"] != "claim-token" {
		t.Fatalf("claim state was not preserved: %#v", dispatch)
	}
	if dispatch["notification_id"] != notification.ID || dispatch["organization_id"] != notification.OrganizationID {
		t.Fatalf("receipt correlation is not bound to the exact notification tuple: %#v", dispatch)
	}
	if dispatch["idempotency_key"] != idempotencyKey || dispatch["expected_message_id"] != deterministicNotificationWhatsAppMessageID(idempotencyKey) {
		t.Fatalf("deterministic provider identity was not persisted before HTTP: %#v", dispatch)
	}
	if dispatch["recipient"] != "5511999991111" || dispatch["provider"] != "evolution_go" || dispatch["prepared_at"] == "" {
		t.Fatalf("prepared delivery snapshot is incomplete: %#v", dispatch)
	}
}

func TestTransactionalDispatchPersistsTheRecipientActuallyUsed(t *testing.T) {
	t.Parallel()

	metadata := map[string]any{
		"dispatch": map[string]any{
			"whatsapp": map[string]any{
				"required":  true,
				"status":    "processing",
				"recipient": "5511999990000",
			},
		},
	}
	metadata = setNotificationChannelDispatch(metadata, "whatsapp", DispatchChannelResult{
		Enabled:   true,
		Attempted: true,
		OK:        true,
		Provider:  "evolution_go",
		Recipient: "5511888881111",
		MessageID: "MESSAGE-ID",
	})
	dispatch := mapFromAny(mapFromAny(metadata["dispatch"])["whatsapp"])
	if dispatch["recipient"] != "5511888881111" {
		t.Fatalf("persisted recipient = %#v, want the current contact used by the provider", dispatch["recipient"])
	}

	metadata = setNotificationChannelDispatch(metadata, "whatsapp", DispatchChannelResult{
		Enabled: true,
		Error:   "preflight_failed",
	})
	dispatch = mapFromAny(mapFromAny(metadata["dispatch"])["whatsapp"])
	if dispatch["recipient"] != "5511888881111" {
		t.Fatalf("a pre-provider failure erased the last known delivery recipient: %#v", dispatch)
	}
}

func TestImmutableTransactionalRecipientSnapshotsDoNotRequireActiveMembership(t *testing.T) {
	t.Parallel()

	notification := pendingNotification{
		ID:             "44444444-4444-4444-8444-444444444444",
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		Metadata: map[string]any{
			"recipient_name":     "Cliente no momento do evento",
			"recipient_email":    "financeiro@example.com",
			"recipient_whatsapp": "+55 (11) 99999-1111",
		},
	}
	// A zero-value repository has no database. Successful resolution therefore
	// proves these immutable snapshots are consumed before the active-membership
	// lookup that may no longer find the original recipient.
	var repo Repository
	emailRecipient, err := repo.resolveNotificationDeliveryRecipient(
		context.Background(),
		notification,
		"onboarding_welcome",
		"email",
	)
	if err != nil || emailRecipient.Email != "financeiro@example.com" || emailRecipient.ID != notification.UserID {
		t.Fatalf("onboarding snapshot recipient = %#v, %v", emailRecipient, err)
	}
	whatsAppRecipient, err := repo.resolveNotificationDeliveryRecipient(
		context.Background(),
		notification,
		"billing_payment_receipt",
		"whatsapp",
	)
	if err != nil || whatsAppRecipient.WhatsApp != "+55 (11) 99999-1111" || whatsAppRecipient.Name == "" {
		t.Fatalf("receipt snapshot recipient = %#v, %v", whatsAppRecipient, err)
	}
}

func TestOperationalNotificationRecipientSnapshotStillRequiresMembership(t *testing.T) {
	t.Parallel()

	notification := pendingNotification{
		UserID: "22222222-2222-4222-8222-222222222222",
		Metadata: map[string]any{
			"recipient_email":    "override@example.com",
			"recipient_whatsapp": "5511999991111",
		},
	}
	if _, bypassesMembership := immutableNotificationRecipientSnapshot(notification, "deal_won", "email"); bypassesMembership {
		t.Fatal("operational deal_won email must keep the active-membership lookup")
	}
	if _, bypassesMembership := immutableNotificationRecipientSnapshot(notification, "schedule_reminder", "whatsapp"); bypassesMembership {
		t.Fatal("operational schedule reminder must keep the active-membership lookup")
	}
	if _, bypassesMembership := immutableNotificationRecipientSnapshot(notification, "billing_due_today", "email"); bypassesMembership {
		t.Fatal("non-receipt billing email must re-resolve the currently authorized account contact")
	}
	if _, bypassesMembership := immutableNotificationRecipientSnapshot(notification, "billing_card_refused", "whatsapp"); bypassesMembership {
		t.Fatal("non-receipt billing WhatsApp must never use a stale recipient snapshot")
	}
	for _, eventKey := range []string{
		"billing_payment_created",
		"billing_due_today",
		"billing_card_refused",
		"billing_overdue_5_days",
	} {
		if !requiresCurrentBillingNotificationContact(eventKey) {
			t.Fatalf("%s must use the current account contact, not its enqueue-time snapshot", eventKey)
		}
	}
	for _, eventKey := range []string{"billing_payment_receipt", "onboarding_welcome", "deal_won"} {
		if requiresCurrentBillingNotificationContact(eventKey) {
			t.Fatalf("%s must preserve its existing recipient contract", eventKey)
		}
	}
}

func TestTransactionalWhatsAppDispatchSendsAndCapturesDeterministicProviderID(t *testing.T) {
	t.Parallel()

	idempotencyKey := notificationWhatsAppIdempotencyKey(
		"11111111-1111-4111-8111-111111111111",
		"onboarding_welcome",
		"onboarding:22222222-2222-4222-8222-222222222222",
	)
	expectedID := deterministicNotificationWhatsAppMessageID(idempotencyKey)
	var mu sync.Mutex
	requestIDs := []string{}
	provider := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/send/text" {
			t.Errorf("provider path = %q, want /send/text", request.URL.Path)
		}
		if request.Header.Get("apikey") != "provider-token" {
			t.Errorf("provider apikey = %q", request.Header.Get("apikey"))
		}
		if request.Header.Get("instanceId") != "platform-sender" {
			t.Errorf("provider instanceId = %q", request.Header.Get("instanceId"))
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Errorf("decode provider request: %v", err)
			response.WriteHeader(http.StatusBadRequest)
			return
		}
		requestID, _ := body["id"].(string)
		mu.Lock()
		requestIDs = append(requestIDs, requestID)
		mu.Unlock()
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(map[string]any{
			"data": map[string]any{"key": map[string]any{"id": requestID}},
		})
	}))
	defer provider.Close()

	repo := Repository{evolutionGoAPIURL: provider.URL, evolutionGoAPIKey: "global-token"}
	session := notificationWhatsAppSession{ID: "session-id", InstanceKey: "platform-sender", Token: "provider-token"}
	for attempt := 0; attempt < 2; attempt++ {
		result, err := repo.dispatchWhatsAppViaEvolutionGo(
			context.Background(),
			session,
			"+55 (11) 99999-1111",
			"Bem-vindo ao Vimob",
			"evolution_go_global_instance",
			idempotencyKey,
		)
		if err != nil {
			t.Fatalf("dispatch attempt %d returned error: %v", attempt+1, err)
		}
		if !result.OK || result.Permanent || result.MessageID != expectedID || result.ExpectedMessageID != expectedID {
			t.Fatalf("dispatch attempt %d result = %#v", attempt+1, result)
		}
		if result.IdempotencyKey != idempotencyKey || result.Recipient != "5511999991111" || result.Sent != 1 {
			t.Fatalf("dispatch attempt %d did not preserve delivery identity: %#v", attempt+1, result)
		}
	}

	mu.Lock()
	defer mu.Unlock()
	if len(requestIDs) != 2 || requestIDs[0] != expectedID || requestIDs[1] != expectedID {
		t.Fatalf("provider request IDs = %#v, want the same deterministic ID twice", requestIDs)
	}
}

func TestTransactionalWhatsAppProviderIDMismatchIsPermanent(t *testing.T) {
	t.Parallel()

	idempotencyKey := notificationWhatsAppIdempotencyKey(
		"11111111-1111-4111-8111-111111111111",
		"billing_payment_receipt",
		"receipt:22222222-2222-4222-8222-222222222222",
	)
	expectedID := deterministicNotificationWhatsAppMessageID(idempotencyKey)
	provider := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(map[string]any{"messageId": "DIFFERENT-PROVIDER-ID"})
	}))
	defer provider.Close()

	repo := Repository{evolutionGoAPIURL: provider.URL, evolutionGoAPIKey: "provider-token"}
	result, err := repo.dispatchWhatsAppViaEvolutionGo(
		context.Background(),
		notificationWhatsAppSession{InstanceKey: "platform-sender"},
		"5511999991111",
		"Pagamento confirmado",
		"evolution_go_global_instance",
		idempotencyKey,
	)
	if err == nil {
		t.Fatal("provider ID divergence must return an error")
	}
	if result.OK || !result.Permanent || result.MessageID != "DIFFERENT-PROVIDER-ID" || result.ExpectedMessageID != expectedID {
		t.Fatalf("mismatched provider result = %#v", result)
	}

	metadata := setNotificationChannelDispatch(map[string]any{}, "whatsapp", result)
	dispatch := mapFromAny(mapFromAny(metadata["dispatch"])["whatsapp"])
	if dispatch["status"] != "permanent_failed" || shouldAttemptNotificationChannel(metadata, "whatsapp", nil) {
		t.Fatalf("mismatched provider ID must not be retried: %#v", dispatch)
	}
	if dispatch["message_id"] != "DIFFERENT-PROVIDER-ID" || dispatch["expected_message_id"] != expectedID || dispatch["idempotency_key"] != idempotencyKey {
		t.Fatalf("provider identity was not persisted in dispatch metadata: %#v", dispatch)
	}
}

func TestTransactionalWhatsAppPreWriteFailureRemainsRetryable(t *testing.T) {
	t.Parallel()

	idempotencyKey := notificationWhatsAppIdempotencyKey(
		"11111111-1111-4111-8111-111111111111",
		"billing_due_today",
		"billing:due-today:22222222-2222-4222-8222-222222222222",
	)
	providerErr := errors.New("dial tcp: connection refused")
	client := &http.Client{Transport: notificationRoundTripFunc(func(*http.Request) (*http.Response, error) {
		// WroteRequest is intentionally not called: the mutation never reached
		// the provider transport.
		return nil, providerErr
	})}
	repo := Repository{evolutionGoAPIURL: "https://evolution.invalid", evolutionGoAPIKey: "provider-token"}
	result, err := repo.dispatchWhatsAppViaEvolutionGoWithClient(
		context.Background(),
		notificationWhatsAppSession{InstanceKey: "platform-sender"},
		"5511999991111",
		"Sua assinatura vence hoje",
		"evolution_go_global_instance",
		idempotencyKey,
		client,
	)
	if err == nil || !errors.Is(err, providerErr) {
		t.Fatalf("pre-write transport error = %v, want %v", err, providerErr)
	}
	if result.OK || result.Permanent || result.OutcomeUnknown {
		t.Fatalf("pre-write failure must remain retryable: %#v", result)
	}

	metadata := setNotificationChannelDispatch(map[string]any{}, "whatsapp", result)
	dispatch := mapFromAny(mapFromAny(metadata["dispatch"])["whatsapp"])
	if dispatch["status"] != "failed" || dispatch["outcome_unknown"] != false {
		t.Fatalf("pre-write failure dispatch = %#v", dispatch)
	}
	if !shouldAttemptNotificationChannel(metadata, "whatsapp", nil) {
		t.Fatal("pre-write failure must be eligible for a bounded retry")
	}
}

func TestTransactionalWhatsAppTimeoutIsOutcomeUnknownAndWebhookReconciled(t *testing.T) {
	t.Parallel()

	idempotencyKey := notificationWhatsAppIdempotencyKey(
		"11111111-1111-4111-8111-111111111111",
		"billing_payment_receipt",
		"receipt:22222222-2222-4222-8222-222222222222",
	)
	expectedID := deterministicNotificationWhatsAppMessageID(idempotencyKey)
	requestObserved := make(chan string, 1)
	provider := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(request.Body).Decode(&body)
		requestObserved <- stringFromMap(body, "id")
		time.Sleep(200 * time.Millisecond)
		_ = json.NewEncoder(response).Encode(map[string]any{"messageId": body["id"]})
	}))
	defer provider.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 75*time.Millisecond)
	defer cancel()
	repo := Repository{evolutionGoAPIURL: provider.URL, evolutionGoAPIKey: "provider-token"}
	result, err := repo.dispatchWhatsAppViaEvolutionGo(
		ctx,
		notificationWhatsAppSession{InstanceKey: "platform-sender"},
		"5511999991111",
		"Pagamento confirmado",
		"evolution_go_global_instance",
		idempotencyKey,
	)
	if err == nil {
		t.Fatal("provider timeout must return an error")
	}
	if result.OK || result.Permanent || !result.OutcomeUnknown || result.MessageID != expectedID || result.ExpectedMessageID != expectedID || result.IdempotencyKey != idempotencyKey {
		t.Fatalf("timeout result = %#v", result)
	}
	select {
	case observed := <-requestObserved:
		if observed != expectedID {
			t.Fatalf("timed out provider request ID = %q, want %q", observed, expectedID)
		}
	case <-time.After(time.Second):
		t.Fatal("provider did not observe the timed out request")
	}

	metadata := setNotificationChannelDispatch(map[string]any{}, "whatsapp", result)
	dispatch := mapFromAny(mapFromAny(metadata["dispatch"])["whatsapp"])
	if dispatch["status"] != "accepted" || dispatch["outcome_unknown"] != true || dispatch["expected_message_id"] != expectedID {
		t.Fatalf("ambiguous provider timeout must preserve webhook correlation: %#v", dispatch)
	}
	if shouldAttemptNotificationChannel(metadata, "whatsapp", nil) {
		t.Fatal("an ambiguous provider timeout must not trigger an automatic duplicate send")
	}
}
