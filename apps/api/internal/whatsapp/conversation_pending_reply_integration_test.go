package whatsapp

import (
	"context"
	"testing"
	"time"
)

func TestLocalWhatsAppPendingReplyUsesSuccessfulCurrentCard(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	fixture := outboundHardeningFixture(t, ctx, db, repo, "pending-reply")
	incoming := insertHardeningTarget(t, ctx, db.Pool(), fixture, "-incoming", "received", false)
	outgoing := queueHardeningMessage(t, ctx, repo, fixture, sendMessageInput{Text: "synthetic reply", ClientMessageID: fixture.suffix + "-outgoing"})
	assertPending := func(want bool) {
		t.Helper()
		filter := ConversationListFilter{SessionID: fixture.sessionID, PendingReply: true, Limit: 20}
		conversations, err := repo.ListConversations(ctx, fixture.tenant, filter)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, conversation := range conversations {
			found = found || conversation.ID == fixture.conversationID
		}
		if found != want {
			t.Fatalf("pending reply=%t, want %t", found, want)
		}
		count, err := repo.CountUnreadMessages(ctx, fixture.tenant, filter)
		if err != nil || (want && count != 1) || (!want && count != 0) {
			t.Fatalf("pending unread badge=%d wantPending=%t %v", count, want, err)
		}
	}
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_conversations set unread_count=1 where id=$1::uuid`, fixture.conversationID); err != nil {
		t.Fatal(err)
	}
	assertPending(true)
	for _, status := range []string{"failed", "queued", "sent", "delivered", "read", "played"} {
		if _, err := db.Pool().Exec(ctx, `update public.whatsapp_messages set status=$2 where id=$1::uuid`, outgoing.Message.ID, status); err != nil {
			t.Fatal(err)
		}
		assertPending(status == "failed" || status == "queued")
	}
	// A reaction cannot stand in for a reply, including a row without the
	// optional reaction_to field produced by an older compatible writer.
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_messages set status='failed' where id=$1::uuid`, outgoing.Message.ID); err != nil {
		t.Fatal(err)
	}
	reaction := insertHardeningTarget(t, ctx, db.Pool(), fixture, "-reaction", "sent", true)
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_messages set message_type='reaction' where id=$1::uuid`, reaction); err != nil {
		t.Fatal(err)
	}
	assertPending(true)
	var newLead string
	if err := db.Pool().QueryRow(ctx, `insert into public.leads(organization_id,assigned_user_id,name,phone,source)
		values($1::uuid,$2::uuid,'Synthetic replacement card','5511777700000','whatsapp') returning id::text`, fixture.organizationID, fixture.userID).Scan(&newLead); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool().Exec(ctx, `select public.activate_whatsapp_conversation_lead_binding($1::uuid,$2::uuid,$3::uuid,null)`, fixture.organizationID, fixture.conversationID, newLead); err != nil {
		t.Fatal(err)
	}
	fixture.leadID = newLead
	insertHardeningTarget(t, ctx, db.Pool(), fixture, "-new-card-sent", "sent", true)
	// The old incoming row is deliberately newest. Its immutable old card
	// cannot make the replacement card's successful reply become pending.
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_messages set sent_at=clock_timestamp()+interval '1 minute' where id=$1::uuid`, incoming); err != nil {
		t.Fatal(err)
	}
	assertPending(false)
}

func TestLocalWhatsAppPendingReplyCanonicalAdmissionTie(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	fixture := outboundHardeningFixture(t, ctx, db, repo, "pending-canonical-tie")
	if _, err := db.Pool().Exec(ctx, `insert into private.whatsapp_webhook_session_cutovers(session_id,active_epoch,cutover_at) values($1::uuid,1,now()-interval '10 minutes')`, fixture.sessionID); err != nil {
		t.Fatal(err)
	}
	providers := []string{fixture.suffix + "-first", fixture.suffix + "-second"}
	insertWebhookDependencyEvent(t, ctx, db, fixture, webhookDependencyEvent{
		key: fixture.suffix + "-envelope", route: "jid:" + fixture.remoteJID, lane: evolutionWebhookLaneLive, epoch: 1,
		snapshots: []map[string]any{{"provider_message_id": providers[0], "binding_eligible": true, "processing_epoch": 1}, {"provider_message_id": providers[1], "binding_eligible": true, "processing_epoch": 1}},
	})
	tx, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	for index, id := range []string{"00000000-0000-4000-8000-000000000009", "00000000-0000-4000-8000-000000000008"} {
		if _, err := tx.Exec(ctx, `insert into public.whatsapp_messages
			(id,organization_id,session_id,conversation_id,lead_id,provider_message_id,message_id,content,from_me,direction,status,capture_state,sent_at,created_at)
			values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$6,'Synthetic tie row',$7,case when $7 then 'outbound' else 'inbound' end,
			case when $7 then 'sent' else 'received' end,'captured',now(),now())`, id, fixture.organizationID, fixture.sessionID, fixture.conversationID, fixture.leadID, providers[index], index == 0); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	rows, err := repo.ListConversations(ctx, fixture.tenant, ConversationListFilter{SessionID: fixture.sessionID, PendingReply: true, Limit: 20})
	if err != nil || len(rows) != 1 {
		t.Fatalf("canonical admission tie ignored incoming second row: rows=%d %v", len(rows), err)
	}
	// The reader's exact tie is generated by committed admission plus synthetic
	// messages in one transaction; it is not a claim about Native fanout timing.
	page, err := repo.ListMessages(ctx, fixture.tenant, fixture.conversationID, MessageFilter{Limit: 20, OrderingVersion: 2, ExpectedLeadID: fixture.leadID})
	if err != nil || len(page.Messages) != 2 || page.Messages[1].FromMe {
		t.Fatalf("reader and pending filter disagree: %+v %v", page, err)
	}
}
