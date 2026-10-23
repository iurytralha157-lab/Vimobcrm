package whatsapp

import (
	"errors"
	"testing"
	"time"
)

func TestLocalConversationListPreviewPairsReceiptWithVisibleMessage(t *testing.T) {
	ctx, postgres := webhookDependencyDatabase(t)
	fixture := newWebhookDependencyFixture(t, ctx, postgres, "list-preview")
	repo := NewRepository(postgres, nil, StorageConfig{})
	pool := postgres.Pool()
	if _, err := pool.Exec(ctx, `update public.whatsapp_conversations
		set last_message='Prévia legada',last_message_at=now() where id=$1::uuid`, fixture.conversationID); err != nil {
		t.Fatal(err)
	}
	read := func() Conversation {
		t.Helper()
		conversation, err := repo.GetConversationSnapshot(ctx, fixture.tenant, fixture.conversationID)
		if err != nil {
			t.Fatal(err)
		}
		return conversation
	}
	legacy := read()
	if legacy.LastMessageFromMe != nil || legacy.LastMessageStatus != nil {
		t.Fatal("legacy cache alone fabricated direction or a receipt")
	}
	if legacy.LastMessage != nil {
		t.Fatal("cache without an authorized message cannot prove preview attribution")
	}
	cacheTime := *legacy.LastMessageAt
	insert := func(provider, lead, content, status, capture string, fromMe bool, age time.Duration) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `insert into public.whatsapp_messages
			(organization_id,session_id,conversation_id,lead_id,provider_message_id,message_id,
			 content,message_type,from_me,direction,status,capture_state,sent_at)
			values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$5,$6,'text',$7,
			 case when $7 then 'outbound' else 'inbound' end,$8,$9,now()-$10*interval '1 second')
			returning id::text`, fixture.organizationID, fixture.sessionID, fixture.conversationID,
			lead, fixture.suffix+provider, content, fromMe, status, capture, age.Seconds()).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	outgoingID := insert("-out", fixture.leadID, "Minha mensagem", "pending", "captured", true, 10*time.Second)
	for _, status := range []string{"pending", "sent", "delivered", "read", "failed"} {
		t.Run(status, func(t *testing.T) {
			if _, err := pool.Exec(ctx, `update public.whatsapp_messages set status=$2 where id=$1::uuid`, outgoingID, status); err != nil {
				t.Fatal(err)
			}
			conversation := read()
			if conversation.LastMessage == nil || *conversation.LastMessage != "Minha mensagem" ||
				conversation.LastMessageFromMe == nil || !*conversation.LastMessageFromMe ||
				conversation.LastMessageStatus == nil || *conversation.LastMessageStatus != status {
				t.Fatalf("outgoing projection did not match its canonical message: %+v", conversation)
			}
			if !conversation.LastMessageAt.Equal(cacheTime) {
				t.Fatal("receipt projection changed the inbox cursor timestamp")
			}
		})
	}
	insert("-in", fixture.leadID, "Mensagem do cliente", "received", "captured", false, 5*time.Second)
	insert("-hidden", fixture.leadID, "Não pode aparecer", "read", "suppressed", true, 0)
	incoming := read()
	if incoming.LastMessage == nil || *incoming.LastMessage != "Mensagem do cliente" ||
		incoming.LastMessageFromMe == nil || *incoming.LastMessageFromMe ||
		incoming.LastMessageStatus == nil || *incoming.LastMessageStatus != "received" {
		t.Fatalf("incoming/suppressed projection = %+v", incoming)
	}
	if results, err := repo.ListConversations(ctx, fixture.tenant, ConversationListFilter{Search: "Mensagem do cliente", Limit: 10}); err != nil || len(results) != 1 {
		t.Fatalf("canonical preview search = %d: %v", len(results), err)
	}
	var nextLeadID string
	if err := pool.QueryRow(ctx, `insert into public.leads(organization_id,assigned_user_id,name,source)
		values($1::uuid,$2::uuid,'Outro lead','manual') returning id::text`, fixture.organizationID, fixture.userID).Scan(&nextLeadID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `select public.activate_whatsapp_conversation_lead_binding($1::uuid,$2::uuid,$3::uuid,null)`,
		fixture.organizationID, fixture.conversationID, nextLeadID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `update public.whatsapp_conversations
		set last_message='Texto secreto do lead anterior' where id=$1::uuid`, fixture.conversationID); err != nil {
		t.Fatal(err)
	}
	if rebound := read(); rebound.LastMessage != nil || rebound.LastMessageFromMe != nil || rebound.LastMessageStatus != nil {
		t.Fatalf("empty rebound head leaked previous lead's cached preview: %+v", rebound)
	}
	if results, err := repo.ListConversations(ctx, fixture.tenant, ConversationListFilter{Search: "Texto secreto do lead anterior", Limit: 10}); err != nil || len(results) != 0 {
		t.Fatalf("search leaked previous lead's cached preview: %d: %v", len(results), err)
	}
	insert("-next-hidden", nextLeadID, "Texto suprimido", "read", "suppressed", true, 0)
	if suppressed := read(); suppressed.LastMessage != nil || suppressed.LastMessageFromMe != nil || suppressed.LastMessageStatus != nil {
		t.Fatalf("suppressed-only head leaked cache or a receipt: %+v", suppressed)
	}
	insert("-next", nextLeadID, "Mensagem do outro lead", "read", "captured", true, time.Second)
	current := read()
	if current.LastMessage == nil || *current.LastMessage != "Mensagem do outro lead" || current.LastMessageFromMe == nil || !*current.LastMessageFromMe {
		t.Fatalf("current lead head = %+v", current)
	}
	if results, err := repo.ListConversations(ctx, fixture.tenant, ConversationListFilter{Search: "Mensagem do outro lead", Limit: 10}); err != nil || len(results) != 1 {
		t.Fatalf("current lead preview search = %d: %v", len(results), err)
	}
	history, err := repo.listLeadHistoryConversations(ctx, fixture.tenant, fixture.leadID, fixture.conversationID, 2)
	if err != nil || len(history) != 1 {
		t.Fatalf("historical read = %d: %v", len(history), err)
	}
	if history[0].LastMessage == nil || *history[0].LastMessage != "Mensagem do cliente" ||
		history[0].LastMessageFromMe == nil || *history[0].LastMessageFromMe ||
		history[0].LastMessageStatus == nil || *history[0].LastMessageStatus != "received" {
		t.Fatalf("historical head leaked current lead text/direction/receipt: %+v", history[0])
	}
	wrongTenant := fixture.tenant
	wrongTenant.OrganizationID = "00000000-0000-4000-8000-000000000000"
	if _, err := repo.GetConversationSnapshot(ctx, wrongTenant, fixture.conversationID); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("cross-tenant snapshot error = %v", err)
	}
}
