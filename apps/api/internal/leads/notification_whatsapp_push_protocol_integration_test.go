package leads

import (
	"strings"
	"testing"
)

// With -overlay of the pre-edit Go files, the same assertion executes the
// actual old dispatcher. The current build also proves the v1 SQL contract
// directly; old binaries cannot consume this event even with an active token.
func TestWhatsAppInboundPushLegacyWorkerProtocolCannotConsumeNewEvent(t *testing.T) {
	for _, mode := range []string{"inactive_token", "active_token", "zero_initial_device"} {
		t.Run(mode, func(t *testing.T) {
			f := newWhatsAppPushDispatchFixture(t, mode == "zero_initial_device")
			if mode == "inactive_token" {
				f.exec(t, `update public.push_tokens set is_active=false where id=$1::uuid`, f.firstTokenID)
			}
			f.transfer(t)
			requests := f.fakeHTTP(t, "fake-next-"+f.nextTokenID, nil)
			claimed := 0
			if strings.HasSuffix(normalizedNotificationWorkerID(), "|wa_push_v2") {
				if err := f.repo.db.Pool().QueryRow(f.ctx, `select count(*)::int from private.claim_notification_deliveries('vimob-api:old-replica:1',1,interval '2 minutes',array['push'])`).Scan(&claimed); err != nil {
					t.Fatal(err)
				}
			} else if f.dispatch(t) {
				claimed = 1
			}
			if claimed != 0 || requests.Load() != 0 {
				t.Fatalf("v1 worker consumed v2 WhatsApp event: claim=%d HTTP=%d", claimed, requests.Load())
			}
			f.assertUnstarted(t)
			var redirected int
			if err := f.repo.db.Pool().QueryRow(f.ctx, `select count(*)::int from public.notifications where organization_id=$1::uuid and user_id=$2::uuid and metadata->>'event_key'='whatsapp_inbound_attendant'`, f.organizationID, f.nextID).Scan(&redirected); err != nil || redirected != 0 {
				t.Fatalf("v1 claim ran new waiting/reroute logic: %d %v", redirected, err)
			}
		})
	}
}

func TestWhatsAppInboundPushProtocolPreservesOrdinaryV1Push(t *testing.T) {
	f := newWhatsAppPushDispatchFixture(t)
	f.exec(t, `update public.notifications set metadata=metadata||jsonb_build_object('event_key','test_push') where id=$1::uuid`, f.notificationID)
	var claimed int
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select count(*)::int from private.claim_notification_deliveries('vimob-api:old-replica:1',1,interval '2 minutes',array['push'])`).Scan(&claimed); err != nil || claimed != 1 {
		t.Fatalf("ordinary v1 push blocked by WhatsApp capability: %d %v", claimed, err)
	}
	f.assertUnstarted(t)
}
