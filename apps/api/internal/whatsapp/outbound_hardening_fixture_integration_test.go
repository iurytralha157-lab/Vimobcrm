package whatsapp

import (
	"context"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func outboundHardeningFixture(t *testing.T, ctx context.Context, db *dbpkg.Postgres, repo Repository, label string) sessionConversationLockFixture {
	t.Helper()
	fixture := createSessionConversationLockFixture(t, ctx, db.Pool(), label)
	t.Cleanup(func() { cleanupSessionConversationLockFixture(t, db.Pool(), fixture) })
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		for _, table := range []string{"public.whatsapp_inbound_logs", "private.whatsapp_unlinked_media_gc", "private.whatsapp_unlinked_history_links", "private.realtime_events", "public.notifications", "public.whatsapp_attendance_marker_confirmations", "public.lead_timeline_events", "public.whatsapp_outbox", "public.whatsapp_messages", "public.whatsapp_attendance_entries"} {
			if _, err := db.Pool().Exec(cleanupCtx, "delete from "+table+" where organization_id=$1::uuid", fixture.organizationID); err != nil {
				t.Errorf("cleanup synthetic %s: %v", table, err)
			}
		}
	})
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_sessions set phone_number='5511888877777' where id=$1::uuid`, fixture.sessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.JoinConversationAttendance(ctx, fixture.tenant, fixture.conversationID, attendanceInput{ExpectedLeadID: fixture.leadID, SendSessionID: fixture.sessionID}); err != nil {
		t.Fatal(err)
	}
	return fixture
}

func queueHardeningMessage(t *testing.T, ctx context.Context, repo Repository, fixture sessionConversationLockFixture, input sendMessageInput) SendMessageResponse {
	t.Helper()
	input.ExpectedLeadID = fixture.leadID
	input.SendSessionID = fixture.sessionID
	result, err := repo.SendMessage(ctx, fixture.tenant, fixture.conversationID, input)
	if err != nil || result.Message == nil || result.Status != "queued" {
		t.Fatalf("queue synthetic intent: %+v %v", result, err)
	}
	return result
}
