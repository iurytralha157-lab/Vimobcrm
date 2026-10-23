package leads

import "testing"

func TestWhatsAppInboundPushEventCannotBeForgedThroughPublicDispatch(t *testing.T) {
	for _, event := range []string{whatsappInboundAttendantEvent, " WHATSAPP_INBOUND_ATTENDANT "} {
		if validatePublicNotificationEvent(event) == nil {
			t.Fatalf("backend-owned inbound event %q accepted publicly", event)
		}
	}
	if err := validatePublicNotificationEvent("lead_assigned"); err != nil {
		t.Fatalf("ordinary event incorrectly rejected: %v", err)
	}
}
