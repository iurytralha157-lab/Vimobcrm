package whatsapp

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestLocalWhatsAppFindCorrectedPhonePreservesPhysicalHistory(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	a := outboundHardeningFixture(t, ctx, db, repo, "phone-correction-a")
	b := outboundHardeningFixture(t, ctx, db, repo, "phone-correction-b")
	oldTarget := insertHardeningTarget(t, ctx, db.Pool(), a, "-old-message", "received", false)
	_ = oldTarget
	other := secondHardeningConversation(t, ctx, db, repo, a)
	find := func(phone string) (*Conversation, error) {
		return repo.FindConversation(ctx, a.tenant, FindConversationFilter{LeadID: a.leadID, SessionID: a.sessionID, Phone: phone})
	}
	if found, err := find(a.phone); err != nil || found == nil || found.ID != a.conversationID {
		t.Fatalf("original number read: %+v %v", found, err)
	}
	if _, err := db.Pool().Exec(ctx, `update public.leads set phone=null where id=$1::uuid;update public.leads set phone=$3 where id=$2::uuid`, other.leadID, a.leadID, other.phone); err != nil {
		t.Fatal(err)
	}
	if found, err := find(other.phone); err != nil || found != nil {
		t.Fatalf("corrected number returned old/other lead conversation: %+v %v", found, err)
	}
	if found, err := find(""); err != nil || found == nil || found.ID != a.conversationID {
		t.Fatalf("lead-only history changed: %+v %v", found, err)
	}
	if _, err := repo.StartConversation(ctx, a.tenant, StartConversationRequest{Phone: other.phone, LeadID: a.leadID, SessionID: a.sessionID, ExpectedPreviousLeadID: unlinkedConversationLeadSnapshot}); !errors.Is(err, ErrConversationBindingChanged) {
		t.Fatalf("start silently reused another lead's physical route: %v", err)
	}
	var physicalJID string
	if err := db.Pool().QueryRow(ctx, `select remote_jid from public.whatsapp_conversations where id=$1::uuid`, a.conversationID).Scan(&physicalJID); err != nil || physicalJID != a.remoteJID {
		t.Fatalf("correcting CRM phone moved provider identity: %s %v", physicalJID, err)
	}
	if found, err := repo.FindConversation(ctx, b.tenant, FindConversationFilter{LeadID: a.leadID, SessionID: a.sessionID, Phone: a.phone}); err == nil && found != nil {
		t.Fatalf("foreign org lookup leaked conversation: %+v", found)
	}
	// Rebinding must not let the historical summary's CRM ContactPhone stand in
	// for the immutable physical PN. The old lead's authorized history remains.
	var thirdLead string
	if err := db.Pool().QueryRow(ctx, `insert into public.leads(organization_id,assigned_user_id,name,phone,source) values($1::uuid,$2::uuid,'Synthetic rebind card','5511555500000','manual') returning id::text`, a.organizationID, a.userID).Scan(&thirdLead); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool().Exec(ctx, `select public.activate_whatsapp_conversation_lead_binding($1::uuid,$2::uuid,$3::uuid,null)`, a.organizationID, a.conversationID, thirdLead); err != nil {
		t.Fatal(err)
	}
	if found, err := find(""); err != nil || found == nil || !found.HistoricalLeadView {
		t.Fatalf("selected-session historical lookup disappeared: %+v %v", found, err)
	}
	if found, err := find(other.phone); err != nil || found != nil {
		t.Fatalf("historical ContactPhone authorized wrong physical PN: %+v %v", found, err)
	}
	if found, err := find(a.phone); err != nil || found == nil || found.ID != a.conversationID {
		t.Fatalf("historical physical PN unavailable: %+v %v", found, err)
	}
}
