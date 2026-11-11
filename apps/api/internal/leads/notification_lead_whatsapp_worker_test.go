package leads

import (
	"strings"
	"testing"
)

func TestLeadWhatsAppClaimLanesPreserveWorkerProtocols(t *testing.T) {
	t.Parallel()

	for _, check := range []struct {
		lane   notificationClaimLane
		suffix string
	}{
		{notificationClaimLegacy, "|push_device_v3|wa_push_v2"},
		{notificationClaimGeneral, "|lead_wa_general_v1|push_device_v3|wa_push_v2"},
		{notificationClaimLeadWA, "|lead_wa_fast_v1|push_device_v3|wa_push_v2"},
	} {
		got := normalizedNotificationWorkerIDForLane(check.lane)
		if !strings.HasPrefix(got, "vimob-api:") || !strings.HasSuffix(got, check.suffix) || len(got) > 255 {
			t.Fatalf("worker ID for lane %q does not match its claim protocol", check.lane)
		}
	}
}

func TestFastLeadWhatsAppWorkerRejectsWrongEventOrChannel(t *testing.T) {
	t.Parallel()

	for _, check := range []struct {
		channel, event string
		want           bool
	}{
		{"whatsapp", "new_lead_received", true},
		{"whatsapp", "lead_redistribution_warning", true},
		{"whatsapp", "lead_redistributed_received", true},
		{"whatsapp", "lead_redistributed_away", true},
		{"whatsapp", "queue_pool_available", false},
		{"whatsapp", "lead_duplicate_existing", false},
		{"whatsapp", "billing_payment_receipt", false},
		{"push", "new_lead_received", false},
		{"email", "new_lead_received", false},
	} {
		notification := pendingNotification{Metadata: map[string]any{"event_key": check.event}}
		if got := isFastLeadWhatsAppNotification(check.channel, notification); got != check.want {
			t.Fatalf("fast lane admitted=%v for %s/%s, want %v", got, check.channel, check.event, check.want)
		}
	}
}

func TestFastLeadWhatsAppClaimLeavesOldDatabaseDeliveryQueued(t *testing.T) {
	fixture := newQueueDeliveryFixture(t, false)

	var supported bool
	if err := fixture.repo.db.Pool().QueryRow(fixture.ctx, "select "+leadWhatsAppClaimCapability).Scan(&supported); err != nil {
		t.Fatal(err)
	}
	if supported {
		t.Skip("requires the pre-lane PostgreSQL schema")
	}
	fixture.notify(t, "new_lead_received")
	if _, found, err := fixture.repo.claimNormalizedNotificationDelivery(fixture.ctx, notificationClaimLeadWA); err != nil || found {
		t.Fatalf("unsupported fast lane found=%v, error=%v", found, err)
	}

	delivery, found, err := fixture.repo.claimNormalizedNotificationDelivery(fixture.ctx, notificationClaimLegacy)
	if err != nil || !found || delivery.NotificationID != fixture.notification || delivery.AttemptCount != 0 {
		t.Fatalf("legacy worker did not claim the untouched delivery: found=%v error=%v", found, err)
	}
}
