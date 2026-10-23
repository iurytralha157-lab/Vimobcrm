package whatsapp

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestLocalOwnSessionStartDeniesSharedBeforeEffectsAndKeepsDefault(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	fixture := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "personal-start")
	phone := "5511333377777"
	var leadID string
	if err := db.Pool().QueryRow(ctx, `insert into public.leads(organization_id,assigned_user_id,name,phone,source) values($1::uuid,$2::uuid,'Synthetic assigned shared lead',$3,'whatsapp') returning id::text`, fixture.organizationID, fixture.tenant.UserID, phone).Scan(&leadID); err != nil {
		t.Fatal(err)
	}
	request := StartConversationRequest{Phone: phone, LeadID: leadID, SessionID: fixture.sessionID, ExpectedPreviousLeadID: unlinkedConversationLeadSnapshot, OwnSessionOnly: true}
	if _, err := repo.StartConversation(ctx, fixture.tenant, request); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("personal start accepted shared session: %v", err)
	}
	var count int
	if err := db.Pool().QueryRow(ctx, `select count(*)::int from public.whatsapp_conversations where organization_id=$1::uuid and session_id=$2::uuid and lead_id=$3::uuid`, fixture.organizationID, fixture.sessionID, leadID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("denied personal start created %d conversation effects", count)
	}
	request.OwnSessionOnly = false
	opened, err := repo.StartConversation(ctx, fixture.tenant, request)
	if err != nil || opened.SessionID != fixture.sessionID || pointerValue(opened.LeadID) != leadID {
		t.Fatalf("default shared start regressed: %+v %v", opened, err)
	}
}

func TestLocalOwnSessionLinkDeniesSharedAndKeepsDefault(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	fixture := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "personal-link")
	if err := repo.LinkOwnedConversationToLead(ctx, fixture.tenant, fixture.conversationID, fixture.leadID, fixture.leadID); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("personal history link accepted shared session: %v", err)
	}
	if err := repo.LinkConversationToLead(ctx, fixture.tenant, fixture.conversationID, fixture.leadID, fixture.leadID); err != nil {
		t.Fatalf("default linked-lead scope regressed: %v", err)
	}
}
