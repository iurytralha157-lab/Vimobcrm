package leads

import (
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

func TestParseNotificationRetryAfterSupportsDeltaAndHTTPDate(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.September, 5, 12, 0, 0, 0, time.UTC)
	if got := parseNotificationRetryAfter("120", now); got != 2*time.Minute {
		t.Fatalf("delta Retry-After = %s, want 2m", got)
	}
	retryAt := now.Add(3 * time.Minute).Format(http.TimeFormat)
	if got := parseNotificationRetryAfter(retryAt, now); got != 3*time.Minute {
		t.Fatalf("date Retry-After = %s, want 3m", got)
	}
	for _, value := range []string{"", "invalid", "-1", now.Add(-time.Minute).Format(http.TimeFormat)} {
		if got := parseNotificationRetryAfter(value, now); got != 0 {
			t.Fatalf("invalid Retry-After %q = %s, want zero", value, got)
		}
	}
}

func TestNormalizedNotificationRetryDelayUsesBoundedJitterAndRetryAfter(t *testing.T) {
	t.Parallel()

	first := normalizedNotificationRetryDelay("delivery-one", 1, 0)
	if first < 15*time.Second || first > 30*time.Second {
		t.Fatalf("first retry delay = %s, want equal jitter inside [15s, 30s]", first)
	}
	capped := normalizedNotificationRetryDelay("delivery-one", 30, 0)
	if capped < 30*time.Minute || capped > time.Hour {
		t.Fatalf("capped retry delay = %s, want equal jitter inside [30m, 1h]", capped)
	}
	if repeated := normalizedNotificationRetryDelay("delivery-one", 1, 0); repeated != first {
		t.Fatalf("delivery-scoped jitter changed from %s to %s", first, repeated)
	}
	if honored := normalizedNotificationRetryDelay("delivery-one", 1, 10*time.Minute); honored != 10*time.Minute {
		t.Fatalf("Retry-After delay = %s, want 10m", honored)
	}
}

func TestNormalizedNotificationDeliveryOutcomeContract(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.September, 5, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name       string
		channel    string
		attempt    int
		maxAttempt int
		result     DispatchChannelResult
		want       string
	}{
		{name: "WhatsApp accepted", channel: "whatsapp", attempt: 1, maxAttempt: 24, result: DispatchChannelResult{OK: true}, want: notificationDeliveryStatusAccepted},
		{name: "email accepted", channel: "email", attempt: 1, maxAttempt: 24, result: DispatchChannelResult{OK: true}, want: notificationDeliveryStatusAccepted},
		{name: "push delivered", channel: "push", attempt: 1, maxAttempt: 24, result: DispatchChannelResult{OK: true}, want: notificationDeliveryStatusDelivered},
		{name: "ambiguous WhatsApp accepted", channel: "whatsapp", attempt: 1, maxAttempt: 24, result: DispatchChannelResult{OutcomeUnknown: true, ExpectedMessageID: "EXPECTED"}, want: notificationDeliveryStatusAccepted},
		{name: "ambiguous email accepted", channel: "email", attempt: 1, maxAttempt: 24, result: DispatchChannelResult{OutcomeUnknown: true}, want: notificationDeliveryStatusAccepted},
		{name: "ambiguous push accepted", channel: "push", attempt: 1, maxAttempt: 24, result: DispatchChannelResult{OutcomeUnknown: true}, want: notificationDeliveryStatusAccepted},
		{name: "permanent failure", channel: "email", attempt: 1, maxAttempt: 24, result: DispatchChannelResult{Permanent: true}, want: notificationDeliveryStatusPermanentFailed},
		{name: "explicit permanent beats dependency marker", channel: "push", attempt: 1, maxAttempt: 24, result: DispatchChannelResult{Permanent: true, Error: "native_push_token_missing"}, want: notificationDeliveryStatusPermanentFailed},
		{name: "provider credential block", channel: "email", attempt: 1, maxAttempt: 24, result: DispatchChannelResult{Status: http.StatusUnauthorized}, want: notificationDeliveryStatusBlockedDependency},
		{name: "retry", channel: "email", attempt: 1, maxAttempt: 24, result: DispatchChannelResult{Status: http.StatusServiceUnavailable}, want: notificationDeliveryStatusRetryWait},
		{name: "attempt budget exhausted", channel: "email", attempt: 24, maxAttempt: 24, result: DispatchChannelResult{Status: http.StatusServiceUnavailable}, want: notificationDeliveryStatusDeadLetter},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			decision := decideNormalizedNotificationDelivery(test.channel, "delivery-id", test.attempt, test.maxAttempt, test.result, now)
			if decision.Status != test.want {
				t.Fatalf("decision = %#v, want status %s", decision, test.want)
			}
			if decision.Status == notificationDeliveryStatusRetryWait && (decision.NextAttemptAt == nil || !decision.NextAttemptAt.After(now)) {
				t.Fatalf("retry decision lacks a future attempt: %#v", decision)
			}
		})
	}
}

func TestNormalizedWhatsAppSessionDependencyContract(t *testing.T) {
	t.Parallel()

	tests := map[string]string{
		"connected":    "",
		"disconnected": "whatsapp_session_disconnected",
		"connecting":   "whatsapp_session_reconnecting",
		"qr_ready":     "whatsapp_qr_required",
		"error":        "whatsapp_session_unavailable",
		"disabled":     "whatsapp_session_unavailable",
	}
	for status, want := range tests {
		if got := normalizedWhatsAppSessionDependency(status); got != want {
			t.Fatalf("status %q dependency = %q, want %q", status, got, want)
		}
	}

	for _, test := range []struct {
		name    string
		channel string
		result  DispatchChannelResult
		want    string
	}{
		{name: "WhatsApp auth", channel: "whatsapp", result: DispatchChannelResult{Status: http.StatusUnauthorized}, want: "whatsapp_configuration_missing"},
		{name: "WhatsApp unavailable", channel: "whatsapp", result: DispatchChannelResult{Status: http.StatusNotFound, SessionID: "session-id"}, want: "whatsapp_session_unavailable"},
		{name: "email", channel: "email", result: DispatchChannelResult{}, want: "email_configuration_missing"},
		{name: "push", channel: "push", result: DispatchChannelResult{}, want: "push_configuration_missing"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := notificationDeliveryDependencyKey(test.channel, test.result); got != test.want {
				t.Fatalf("dependency key = %q, want %q", got, test.want)
			}
		})
	}
}

func TestNotificationDispatchStatsSnapshotIsThreadSafeAndComplete(t *testing.T) {
	t.Parallel()

	repo := Repository{notificationStats: &notificationDispatchCounters{}}
	repo.notificationStats.lastCycleUnixMillis.Store(time.Date(2026, time.September, 5, 15, 0, 0, 0, time.UTC).UnixMilli())
	repo.notificationStats.claimed.Add(8)
	repo.recordNormalizedNotificationDecision(notificationDeliveryStatusAccepted)
	repo.recordNormalizedNotificationDecision(notificationDeliveryStatusDelivered)
	repo.recordNormalizedNotificationDecision(notificationDeliveryStatusRetryWait)
	repo.recordNormalizedNotificationDecision(notificationDeliveryStatusBlockedDependency)
	repo.recordNormalizedNotificationDecision(notificationDeliveryStatusDeadLetter)
	repo.notificationStats.swept.Add(2)
	repo.notificationStats.errors.Add(3)

	got := repo.NotificationDispatchStats()
	if got.LastCycleAt.IsZero() || got.Claimed != 8 || got.Accepted != 1 || got.Delivered != 1 ||
		got.Retried != 1 || got.Blocked != 1 || got.DeadLetter != 1 || got.Swept != 2 || got.Errors != 3 {
		t.Fatalf("unexpected notification dispatch stats: %#v", got)
	}
}

func TestNormalizedNotificationWorkerUsesCanonicalDeliveryLifecycle(t *testing.T) {
	t.Parallel()

	workerRaw, err := os.ReadFile("notification_dispatch_worker.go")
	if err != nil {
		t.Fatal(err)
	}
	worker := string(workerRaw)
	processStart := strings.Index(worker, "func (repo Repository) processNotificationDeliveries(")
	if processStart < 0 {
		t.Fatal("could not isolate notification worker loop")
	}
	processEnd := strings.Index(worker[processStart:], "func (repo Repository) processOneNotificationDelivery(")
	if processEnd < 0 {
		t.Fatal("could not isolate notification worker loop")
	}
	loop := worker[processStart : processStart+processEnd]
	for _, required := range []string{
		"sweepNormalizedNotificationDeliveries(ctx)",
		"processOneNormalizedNotificationDelivery(ctx, logger)",
	} {
		if !strings.Contains(loop, required) {
			t.Fatalf("normalized worker loop is missing %q", required)
		}
	}
	if strings.Contains(loop, "repo.processOneNotificationDelivery(ctx, logger)") {
		t.Fatal("main loop must not claim the legacy notification metadata outbox")
	}

	outboxRaw, err := os.ReadFile("notification_delivery_outbox.go")
	if err != nil {
		t.Fatal(err)
	}
	outbox := string(outboxRaw)
	for _, required := range []string{
		"private.claim_notification_deliveries(",
		"private.start_notification_delivery(",
		"private.complete_notification_delivery(",
		"private.reschedule_notification_delivery(",
		"private.block_notification_delivery(",
		"private.sweep_stale_notification_deliveries(",
		"token.id = $1::uuid",
		"delivery.PushTokenID",
		"whatsapp_session_disconnected",
		"whatsapp_session_reconnecting",
		"whatsapp_qr_required",
	} {
		if !strings.Contains(outbox, required) {
			t.Fatalf("normalized outbox contract is missing %q", required)
		}
	}

	oneStart := strings.Index(outbox, "func (repo Repository) processOneNormalizedNotificationDelivery(")
	if oneStart < 0 {
		t.Fatal("could not isolate one-delivery worker")
	}
	oneEnd := strings.Index(outbox[oneStart:], "func (repo Repository) prepareNormalizedNotificationDelivery(")
	if oneEnd < 0 {
		t.Fatal("could not isolate one-delivery worker")
	}
	one := outbox[oneStart : oneStart+oneEnd]
	startCall := strings.LastIndex(one, "repo.startNormalizedNotificationDelivery(ctx, delivery, preflight.Provider)")
	sendCall := strings.Index(one, "result := preflight.Send(ctx)")
	if startCall < 0 || sendCall < 0 || startCall > sendCall {
		t.Fatal("attempt start must be the final durable transition before the provider send")
	}
	between := one[startCall:sendCall]
	if strings.Contains(between, "prepareNormalized") || strings.Contains(between, "resolveNotification") {
		t.Fatal("provider preflight must finish before the attempt budget is consumed")
	}
}

func TestNormalizedWhatsAppFallbackIsChosenAndPersistedBeforeProviderSend(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("notification_delivery_outbox.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	prepareStart := strings.Index(source, "func (repo Repository) prepareNormalizedWhatsAppDelivery(")
	if prepareStart < 0 {
		t.Fatal("could not isolate normalized WhatsApp preflight")
	}
	prepareEnd := strings.Index(source[prepareStart:], "func normalizedWhatsAppSessionDependency(")
	if prepareEnd < 0 {
		t.Fatal("could not isolate normalized WhatsApp preflight")
	}
	preflight := source[prepareStart : prepareStart+prepareEnd]
	for _, required := range []string{
		`organizationFallbackDependency`,
		`provider = "evolution_go_global_instance_fallback"`,
		`normalizedNotificationBlockedPreflight`,
	} {
		if !strings.Contains(preflight, required) {
			t.Fatalf("normalized WhatsApp preflight is missing %q", required)
		}
	}

	processStart := strings.Index(source, "func (repo Repository) processOneNormalizedNotificationDelivery(")
	if processStart < 0 {
		t.Fatal("could not isolate normalized notification delivery")
	}
	processEnd := strings.Index(source[processStart:], "func (repo Repository) prepareNormalizedNotificationDelivery(")
	if processEnd < 0 {
		t.Fatal("could not isolate normalized notification delivery")
	}
	process := source[processStart : processStart+processEnd]
	startAttempt := strings.Index(process, "repo.startNormalizedNotificationDelivery(ctx, delivery, preflight.Provider)")
	send := strings.Index(process, "result := preflight.Send(ctx)")
	if startAttempt < 0 || send < 0 || startAttempt > send {
		t.Fatal("the selected fallback provider must be persisted before the provider send")
	}
}

func TestNotificationSenderConsumptionRevalidatesCurrentAdminRole(t *testing.T) {
	t.Parallel()

	for _, filename := range []string{"support_notification_whatsapp.go", "notification_delivery_outbox.go"} {
		raw, err := os.ReadFile(filename)
		if err != nil {
			t.Fatalf("read %s: %v", filename, err)
		}
		source := string(raw)
		for _, required := range []string{
			"notification_sender_selected_by_user_id",
			"owner_user_id::text",
			"organization_members selector",
			"in ('owner', 'admin')",
			"selector_super_admin",
			"coalesce(selector.is_active, false)",
			"coalesce(selector_user.is_active, false)",
		} {
			if !strings.Contains(source, required) {
				t.Fatalf("%s does not fail closed on stale notification sender authorization; missing %q", filename, required)
			}
		}
	}
}
