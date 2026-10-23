package whatsapp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestLocalWhatsAppAcceptedFinalizationBindingGuard(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	f := outboundHardeningFixture(t, ctx, db, repo, "accepted-binding")
	clientID := f.suffix + "-accepted"
	queueHardeningMessage(t, ctx, repo, f, sendMessageInput{Text: "Synthetic accepted intent", ClientMessageID: clientID})
	item := leaseLocalOutbound(t, ctx, db.Pool(), f.organizationID, clientID)
	if _, err := repo.startWhatsAppOutboxProviderAttempt(ctx, item); err != nil {
		t.Fatal(err)
	}
	// A synthetic persisted acknowledgement models local reconciliation state;
	// this test never invokes a vendor or assumes an outcome from a dead row.
	if _, err := repo.markWhatsAppOutboxProviderAccepted(ctx, item, deterministicProviderMessageID(clientID)); err != nil {
		t.Fatal(err)
	}
	if err := repo.deferWhatsAppOutboxFinalization(ctx, item, errors.New("synthetic local finalization failure")); !errors.Is(err, errWhatsAppOutboxFinalizationPending) {
		t.Fatal(err)
	}
	var nextLead string
	if err := db.Pool().QueryRow(ctx, `insert into public.leads(organization_id,assigned_user_id,name,phone,source)
		values($1::uuid,$2::uuid,'Synthetic rebind card','5511666600000','whatsapp') returning id::text`, f.organizationID, f.userID).Scan(&nextLead); err != nil {
		t.Fatal(err)
	}
	_, rebindErr := db.Pool().Exec(ctx, `select public.activate_whatsapp_conversation_lead_binding($1::uuid,$2::uuid,$3::uuid,null)`, f.organizationID, f.conversationID, nextLead)
	var status, marker, currentLead string
	if err := db.Pool().QueryRow(ctx, `select queued.status,coalesce(queued.last_error,''),conversation.lead_id::text
		from public.whatsapp_outbox queued join public.whatsapp_conversations conversation on conversation.id=queued.conversation_id
		where queued.id=$1::uuid`, item.ID).Scan(&status, &marker, &currentLead); err != nil {
		t.Fatal(err)
	}
	if rebindErr == nil || status != "retry" || marker != whatsappOutboxProviderAcceptedMarker || currentLead != f.leadID {
		t.Fatalf("accepted reconciliation lost at rebind: error=%v status=%s marker=%s originalLeadPreserved=%t", rebindErr, status, marker, currentLead == f.leadID)
	}
}

func TestLocalWhatsAppAcceptedFinalizationSurvivesUnavailableSession(t *testing.T) {
	for _, state := range []string{"inactive", "deleted"} {
		t.Run(state, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			db := openLocalOutboundDatabase(t, ctx)
			var sends atomic.Int32
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { sends.Add(1); http.Error(w, "never invoke", 500) }))
			t.Cleanup(provider.Close)
			repo := NewRepository(db, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: provider.URL, APIKey: "synthetic-provider-key"}})
			f := outboundHardeningFixture(t, ctx, db, repo, "accepted-"+state)
			clientID := f.suffix + "-accepted"
			queueHardeningMessage(t, ctx, repo, f, sendMessageInput{Text: "Synthetic accepted intent", ClientMessageID: clientID})
			item := leaseLocalOutbound(t, ctx, db.Pool(), f.organizationID, clientID)
			if _, err := repo.startWhatsAppOutboxProviderAttempt(ctx, item); err != nil {
				t.Fatal(err)
			}
			if _, err := repo.markWhatsAppOutboxProviderAccepted(ctx, item, deterministicProviderMessageID(clientID)); err != nil {
				t.Fatal(err)
			}
			if err := repo.deferWhatsAppOutboxFinalization(ctx, item, errors.New("synthetic finalization failure")); !errors.Is(err, errWhatsAppOutboxFinalizationPending) {
				t.Fatal(err)
			}
			if _, err := db.Pool().Exec(ctx, `update public.whatsapp_sessions set is_active=($2<>'inactive'),status=case when $2='deleted' then 'deleted' else status end where id=$1::uuid;
				update public.whatsapp_outbox set next_attempt_at=now() where id=$3::uuid`, f.sessionID, state, item.ID); err != nil {
				t.Fatal(err)
			}
			if err := repo.RecoverStaleWhatsAppOutbox(ctx); err != nil {
				t.Fatal(err)
			}
			claimed, err := repo.claimWhatsAppOutboxWithBatchAfterConversation(ctx, 1, "", whatsappOutboxLaneFast)
			if err != nil || len(claimed) != 1 || claimed[0].ID != item.ID {
				t.Fatalf("accepted row was canceled/unclaimable: %+v %v", claimed, err)
			}
			if err := repo.processClaimedWhatsAppOutbox(ctx, claimed[0], whatsappOutboxLaneFast); err != nil {
				t.Fatal(err)
			}
			assertLocalOutboundState(t, ctx, db.Pool(), claimed[0], "sent", 1)
			if sends.Load() != 0 {
				t.Fatal("accepted local reconciliation resent to provider")
			}
		})
	}
}
