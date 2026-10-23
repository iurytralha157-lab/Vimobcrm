package whatsapp

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestLocalWhatsAppPresentationImmutableQuoteAndRetention(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	fixture := outboundHardeningFixture(t, ctx, db, repo, "presentation-retention")
	oldTarget := insertHardeningTarget(t, ctx, db.Pool(), fixture, "-old-card-target", "received", false)
	var newLead string
	if err := db.Pool().QueryRow(ctx, `insert into public.leads(organization_id,assigned_user_id,name,phone,source)
		values($1::uuid,$2::uuid,'Synthetic next card','5511888800000','whatsapp') returning id::text`, fixture.organizationID, fixture.userID).Scan(&newLead); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool().Exec(ctx, `select public.activate_whatsapp_conversation_lead_binding($1::uuid,$2::uuid,$3::uuid,null)`,
		fixture.organizationID, fixture.conversationID, newLead); err != nil {
		t.Fatal(err)
	}
	current := fixture
	current.leadID = newLead
	row := insertHardeningTarget(t, ctx, db.Pool(), current, "-current-card", "received", false)
	metadata := map[string]any{
		"media_filename":    "../../synthetic-document.pdf",
		"message_location":  map[string]any{"latitude": -23.55052, "longitude": -46.633308, "name": "Synthetic place", "address": "Synthetic address", "secret": "never expose"},
		"message_contacts":  []map[string]any{{"display_name": "Synthetic contact", "phones": []string{"+5511999988888"}, "email": "private@example.invalid", "vcard": "private vcard"}},
		"quoted_message_id": fixture.suffix + "-old-card-target",
		"quoted_body":       "provider inline secret",
		"raw_provider":      map[string]any{"arbitrary": "never expose"},
	}
	encoded, err := json.Marshal(metadata)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_messages set metadata=$2::jsonb,content='Synthetic current-card body',sender_name='Current synthetic sender' where id=$1::uuid`, row, string(encoded)); err != nil {
		t.Fatal(err)
	}
	page, err := repo.ListMessages(ctx, fixture.tenant, fixture.conversationID, MessageFilter{Limit: 20, OrderingVersion: 2, ExpectedLeadID: newLead})
	if err != nil || len(page.Messages) != 1 {
		t.Fatalf("current-card read: %+v %v", page, err)
	}
	message := page.Messages[0]
	if message.ID != row || message.ID == oldTarget || pointerValue(message.MediaFilename) != "synthetic-document.pdf" ||
		message.Location == nil || message.Location.Latitude != -23.55052 || message.Location.Longitude != -46.633308 ||
		len(message.Contacts) != 1 || len(message.Contacts[0].Phones) != 1 {
		t.Fatalf("whitelisted presentation missing: %+v", message)
	}
	if message.QuotedMessage == nil || message.QuotedMessage.Available {
		t.Fatalf("old immutable card quote was resolved: %+v", message.QuotedMessage)
	}
	publicJSON, err := json.Marshal(message)
	if err != nil {
		t.Fatal(err)
	}
	for _, private := range []string{"synthetic quoted body", "Synthetic sender", "provider inline secret", "private@example.invalid", "vcard", "secret", "raw_provider", "ingress_sequence"} {
		if strings.Contains(string(publicJSON), private) {
			t.Fatalf("presentation leaked %s: %s", private, publicJSON)
		}
	}
	quoteJSON, err := json.Marshal(message.QuotedMessage)
	if err != nil {
		t.Fatal(err)
	}
	var quoteFields map[string]any
	if err := json.Unmarshal(quoteJSON, &quoteFields); err != nil {
		t.Fatal(err)
	}
	if len(quoteFields) != 2 || quoteFields["available"] != false {
		t.Fatalf("unavailable quote contains body/identity: %s", quoteJSON)
	}

	// Exercise the canonical SQL retention function with synthetic content. No
	// Storage object or external worker is needed to prove metadata is scrubbed.
	var competing int
	if err := db.Pool().QueryRow(ctx, `select count(*)::int from public.whatsapp_conversations
		where unlinked_retention_v1 and lead_id is null and created_at<=clock_timestamp()-interval '7 days'
		and unlinked_retention_scrubbed_at is null`).Scan(&competing); err != nil || competing != 0 {
		t.Fatalf("unexpected competing retention rows: %d %v", competing, err)
	}
	var expiredConversation, expiredMessage string
	if err := db.Pool().QueryRow(ctx, `insert into public.whatsapp_conversations
		(organization_id,session_id,remote_jid,contact_phone,contact_name,assigned_user_id)
		values($1::uuid,$2::uuid,'5511888899999@s.whatsapp.net','5511888899999','Synthetic expired contact',$3::uuid)
		returning id::text`, fixture.organizationID, fixture.sessionID, fixture.userID).Scan(&expiredConversation); err != nil {
		t.Fatal(err)
	}
	if err := db.Pool().QueryRow(ctx, `insert into public.whatsapp_messages
		(organization_id,session_id,conversation_id,message_id,provider_message_id,content,from_me,direction,capture_state,metadata)
		values($1::uuid,$2::uuid,$3::uuid,$4,$4,'Synthetic ephemeral private content',false,'inbound','unlinked_ephemeral',$5::jsonb)
		returning id::text`, fixture.organizationID, fixture.sessionID, expiredConversation, fixture.suffix+"-ephemeral", string(encoded)).Scan(&expiredMessage); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_conversations set created_at=clock_timestamp()-interval '8 days' where id=$1::uuid`, expiredConversation); err != nil {
		t.Fatal(err)
	}
	var scrubStatus string
	if err := db.Pool().QueryRow(ctx, `select private.scrub_expired_whatsapp_unlinked_conversations(500)->>'status'`).Scan(&scrubStatus); err != nil || scrubStatus != "processed" {
		t.Fatalf("retention: %s %v", scrubStatus, err)
	}
	var scrubbed bool
	if err := db.Pool().QueryRow(ctx, `select content is null and unlinked_retention_scrubbed_at is not null
		and not (metadata ?| array['media_filename','message_location','message_contacts','quoted_message_id','quoted_body','raw_provider'])
		from public.whatsapp_messages where id=$1::uuid`, expiredMessage).Scan(&scrubbed); err != nil || !scrubbed {
		t.Fatalf("retention left new presentation content: %t %v", scrubbed, err)
	}
	after, err := scanMessage(db.Pool().QueryRow(ctx, `select `+messageSelectFields()+` from public.whatsapp_messages wm where wm.id=$1::uuid`, expiredMessage))
	if err != nil || after.MediaFilename != nil || after.Location != nil || len(after.Contacts) != 0 || after.QuotedMessage != nil {
		t.Fatalf("scrubbed DTO recovered private fields: %+v %v", after, err)
	}
}
