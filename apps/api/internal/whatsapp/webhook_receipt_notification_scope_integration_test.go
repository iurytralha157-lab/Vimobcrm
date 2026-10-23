package whatsapp

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestReceiptKnownMessageWinsWithoutReconcilingSameIdentityForeignSessionNotification(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "receipt-known-notification-alias")
	repo := NewRepository(db, nil, StorageConfig{})
	if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID, attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}); err != nil {
		t.Fatal(err)
	}
	known := createConfirmedReceiptFixture(t, ctx, repo, f, f.suffix+"-known")
	notification := createReceiptNotificationFromAnotherSession(t, ctx, repo, f, known)
	if err := repo.processNativeEvolutionStatuses(ctx, pendingEvolutionWebhook{OrganizationID: f.organizationID, SessionID: f.sessionID, EventType: "receipt"},
		[]nativeEvolutionStatus{{MessageIDs: []string{known}, Status: "read", OccurredAt: time.Now().UTC()}}); err != nil {
		t.Fatalf("known session-scoped message was blocked by a notification in another sender session: %v", err)
	}
	assertReceiptFixtureState(t, ctx, repo, f, known, "read")
	assertForeignReceiptNotificationUnchanged(t, ctx, repo, notification)
}

func TestReceiptKnownSiblingProgressesWhileForeignSessionNotificationRemainsPending(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "receipt-sibling-notification-scope")
	repo := NewRepository(db, nil, StorageConfig{})
	if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID, attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}); err != nil {
		t.Fatal(err)
	}
	known := createConfirmedReceiptFixture(t, ctx, repo, f, f.suffix+"-known")
	foreign := f.suffix + "-foreign-notification-provider"
	notification := createReceiptNotificationFromAnotherSession(t, ctx, repo, f, foreign)
	configureReceiptEffectFixture(t, ctx, repo, f)
	payload, _ := json.Marshal(map[string]any{"event": "receipt", "data": map[string]any{
		"MessageIDs": []string{foreign, known}, "status": "read", "timestamp": time.Now().UTC().Format(time.RFC3339Nano)}})
	first, err := repo.AcceptEvolutionWebhook(ctx, receiptEffectFixtureEnvelope(f, payload))
	if err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 2; index++ {
		items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
		if err != nil || len(items) != 1 {
			t.Fatalf("isolated notification receipt claim %d=%d/%v", index, len(items), err)
		}
		if index == 0 && items[0].ID != first.ID {
			t.Fatal("the older foreign effect was not attempted before its known sibling")
		}
		if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
			t.Fatal(err)
		}
	}
	assertReceiptFixtureState(t, ctx, repo, f, known, "read")
	assertForeignReceiptNotificationUnchanged(t, ctx, repo, notification)
	var pending, processed, count int
	if err := db.Pool().QueryRow(ctx, `select count(*) filter(where status='retry')::int,
		count(*) filter(where status='processed')::int,count(*)::int
		from public.whatsapp_webhook_inbox where organization_id=$1::uuid and session_id=$2::uuid`, f.organizationID, f.sessionID).Scan(&pending, &processed, &count); err != nil {
		t.Fatal(err)
	}
	if count != 2 || pending != 1 || processed != 1 {
		t.Fatalf("a foreign notification blocked or acknowledged its known sibling: total=%d retry=%d processed=%d", count, pending, processed)
	}
}

func createReceiptNotificationFromAnotherSession(t *testing.T, ctx context.Context, repo Repository, f sessionConversationLockFixture, providerIdentity string) string {
	t.Helper()
	var otherSession, notification string
	if err := repo.db.Pool().QueryRow(ctx, `insert into public.whatsapp_sessions(organization_id,instance_name,owner_user_id,provider,status)
		values($1::uuid,$2,$3::uuid,'evolution_go','connected') returning id::text`, f.organizationID, f.suffix+"-sender", f.userID).Scan(&otherSession); err != nil {
		t.Fatal(err)
	}
	if err := repo.db.Pool().QueryRow(ctx, `insert into public.notifications(organization_id,user_id,title,metadata)
		values($1::uuid,$2::uuid,'Synthetic other-session receipt',jsonb_build_object('dispatch',jsonb_build_object('whatsapp',
		jsonb_build_object('status','sent','expected_message_id',$3::text,'session_id',$4::text)))) returning id::text`,
		f.organizationID, f.userID, providerIdentity, otherSession).Scan(&notification); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := repo.db.Pool().Exec(cleanup, `delete from public.notifications where id=$1::uuid`, notification); err != nil {
			t.Errorf("cleanup synthetic notification: %v", err)
		}
	})
	return notification
}

func assertForeignReceiptNotificationUnchanged(t *testing.T, ctx context.Context, repo Repository, notification string) {
	t.Helper()
	var status string
	if err := repo.db.Pool().QueryRow(ctx, `select metadata #>> '{dispatch,whatsapp,status}' from public.notifications where id=$1::uuid`, notification).Scan(&status); err != nil || status != "sent" {
		t.Fatalf("foreign sender's notification changed: %s/%v", status, err)
	}
}
