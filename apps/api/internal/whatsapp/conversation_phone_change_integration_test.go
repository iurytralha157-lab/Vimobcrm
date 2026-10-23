package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestLocalWhatsAppConfirmedPhoneChangePreservesHistory(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	var providerCalls atomic.Int32
	storage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/storage/v1/object/sign/") {
			providerCalls.Add(1)
			http.Error(w, "never send", 500)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"signedURL": "https://synthetic.example.invalid/history-media"})
	}))
	t.Cleanup(storage.Close)
	repo := NewRepository(db, nil, StorageConfig{ProjectURL: storage.URL, APIKey: "synthetic-key", EvolutionGo: EvolutionGoConfig{APIURL: storage.URL, APIKey: "synthetic-provider-key"}})
	f := outboundHardeningFixture(t, ctx, db, repo, "confirmed-phone-change")
	mediaPath := "orgs/" + f.organizationID + "/sessions/" + f.sessionID + "/synthetic-history.pdf"
	oldMedia := promotePhoneHistoryFixture(t, ctx, db.Pool(), repo, f, mediaPath)
	logPromotedPhoneMedia(t, ctx, db.Pool(), oldMedia, "before")
	enablePhoneNativeFixture(t, ctx, db.Pool(), &repo, f)
	processPhoneNativeText(t, ctx, db.Pool(), repo, f, "-before-phone-change")
	queued := queueHardeningMessage(t, ctx, repo, f, sendMessageInput{Text: "Synthetic old pending intent", ClientMessageID: f.suffix + "-old-intent"})
	newPhone := "5511333399999"
	if _, err := db.Pool().Exec(ctx, `update public.leads set phone=$2 where id=$1::uuid`, f.leadID, newPhone); err != nil {
		t.Fatal(err)
	}
	request := StartConversationRequest{Phone: newPhone, SessionID: f.sessionID, LeadID: f.leadID, ExpectedPreviousLeadID: f.leadID}
	_, err := repo.StartConversation(ctx, f.tenant, request)
	var confirmation *phoneChangeConfirmationError
	if !errors.As(err, &confirmation) || confirmation.ConversationID != f.conversationID || confirmation.LeadID != f.leadID || confirmation.SessionID != f.sessionID {
		t.Fatalf("explicit phone confirmation snapshot missing: %v", err)
	}
	request.ConfirmPhoneChange = true
	request.ExpectedPreviousConversationID = "00000000-0000-4000-8000-000000000099"
	if _, err := repo.StartConversation(ctx, f.tenant, request); !errors.Is(err, ErrConversationBindingChanged) {
		t.Fatalf("stale phone-change CAS accepted: %v", err)
	}
	request.ExpectedPreviousConversationID = f.conversationID
	opened, err := repo.StartConversation(ctx, f.tenant, request)
	if err != nil || opened.ID == f.conversationID || opened.RemoteJID != newPhone+"@s.whatsapp.net" || pointerValue(opened.LeadID) != f.leadID {
		t.Fatalf("confirmed new physical route: %+v %v", opened, err)
	}
	var retired, oldBindingClosed bool
	var oldJID, queuedStatus string
	var newAttendance int
	if err := db.Pool().QueryRow(ctx, `select retired_at is not null,remote_jid,
		 not exists(select 1 from public.whatsapp_conversation_lead_bindings binding where binding.conversation_id=old.id and active_to is null),
		 (select status from public.whatsapp_messages where id=$2::uuid),
		 (select count(*)::int from public.whatsapp_attendance_entries where conversation_id=$3::uuid)
		from public.whatsapp_conversations old where id=$1::uuid`, f.conversationID, queued.Message.ID, opened.ID).Scan(&retired, &oldJID, &oldBindingClosed, &queuedStatus, &newAttendance); err != nil {
		t.Fatal(err)
	}
	if !retired || oldJID != f.remoteJID || !oldBindingClosed || queuedStatus != "failed" || newAttendance != 0 {
		t.Fatalf("phone change mutated history or inherited attendance: retired=%t sameJID=%t closed=%t pending=%s newAttendance=%d", retired, oldJID == f.remoteJID, oldBindingClosed, queuedStatus, newAttendance)
	}
	history, err := repo.GetHistoryAccess(ctx, f.tenant, HistoryAccessFilter{LeadID: f.leadID, ConversationID: f.conversationID, MessageFilter: MessageFilter{Limit: 20, OrderingVersion: 2}})
	if err != nil || history.Conversation == nil || !history.Conversation.HistoricalLeadView || len(history.Messages) != 3 {
		t.Fatalf("retired immutable lead history disappeared: %+v %v", history, err)
	}
	if media, err := repo.GetMessageMediaURL(ctx, f.tenant, oldMedia); err != nil || media.MessageID != oldMedia || media.URL == "" {
		t.Fatalf("retired lead media authorization disappeared: %+v %v", media, err)
	}
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_conversations set created_at=clock_timestamp()-interval '8 days' where id=$1::uuid;
		select private.scrub_expired_whatsapp_unlinked_conversations(500)`, f.conversationID); err != nil {
		t.Fatal(err)
	}
	var promotedHistorySurvives bool
	logPromotedPhoneMedia(t, ctx, db.Pool(), oldMedia, "after")
	if err := db.Pool().QueryRow(ctx, `select lead_id=$2::uuid and capture_state='promoted_unlinked' and content is not null
		and media_storage_path=$3 and unlinked_retention_scrubbed_at is null from public.whatsapp_messages where id=$1::uuid`, oldMedia, f.leadID, mediaPath).Scan(&promotedHistorySurvives); err != nil || !promotedHistorySurvives {
		t.Fatalf("retirement scrubbed promoted immutable history/media: %t %v", promotedHistorySurvives, err)
	}
	if _, err := repo.SendMessage(ctx, f.tenant, opened.ID, sendMessageInput{Text: "Synthetic new intent", ClientMessageID: f.suffix + "-new-intent", ExpectedLeadID: f.leadID}); !errors.Is(err, ErrAttendanceRequired) {
		t.Fatalf("new phone inherited old attendance: %v", err)
	}
	// A later callback for the retired PN must remain unlinked; it cannot
	// borrow the old binding/attendance to attach to this lead's new number.
	providerID := processPhoneNativeText(t, ctx, db.Pool(), repo, f, "-after-phone-change")
	var futureLead *string
	var futureConversation, capture string
	if err := db.Pool().QueryRow(ctx, `select lead_id::text,conversation_id::text,capture_state from public.whatsapp_messages
		where organization_id=$1::uuid and session_id=$2::uuid and provider_message_id=$3`, f.organizationID, f.sessionID, providerID).Scan(&futureLead, &futureConversation, &capture); err != nil {
		t.Fatal(err)
	}
	if futureLead != nil || futureConversation == f.conversationID || futureConversation == opened.ID || capture != "unlinked_ephemeral" {
		t.Fatalf("retired PN borrowed lead/attendance: lead=%v sameOld=%t sameNew=%t capture=%s", futureLead, futureConversation == f.conversationID, futureConversation == opened.ID, capture)
	}
	if providerCalls.Load() != 0 {
		t.Fatal("phone change invoked external send")
	}
}

func TestLocalWhatsAppPhoneChangeBlocksUnfinishedProviderIntent(t *testing.T) {
	for _, state := range []string{"processing", "accepted_retry"} {
		t.Run(state, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			db := openLocalOutboundDatabase(t, ctx)
			repo := NewRepository(db, nil, StorageConfig{})
			f := outboundHardeningFixture(t, ctx, db, repo, "phone-inflight-"+state)
			clientID := f.suffix + "-intent"
			queueHardeningMessage(t, ctx, repo, f, sendMessageInput{Text: "Synthetic unfinished intent", ClientMessageID: clientID})
			item := leaseLocalOutbound(t, ctx, db.Pool(), f.organizationID, clientID)
			if state == "accepted_retry" {
				if _, err := repo.startWhatsAppOutboxProviderAttempt(ctx, item); err != nil {
					t.Fatal(err)
				}
				if _, err := repo.markWhatsAppOutboxProviderAccepted(ctx, item, deterministicProviderMessageID(clientID)); err != nil {
					t.Fatal(err)
				}
				if err := repo.deferWhatsAppOutboxFinalization(ctx, item, errors.New("synthetic failure")); !errors.Is(err, errWhatsAppOutboxFinalizationPending) {
					t.Fatal(err)
				}
			}
			if _, err := db.Pool().Exec(ctx, `update public.leads set phone='5511222299999' where id=$1::uuid`, f.leadID); err != nil {
				t.Fatal(err)
			}
			_, err := repo.StartConversation(ctx, f.tenant, StartConversationRequest{Phone: "5511222299999", LeadID: f.leadID, SessionID: f.sessionID, ExpectedPreviousLeadID: f.leadID, ConfirmPhoneChange: true, ExpectedPreviousConversationID: f.conversationID})
			if !errors.Is(err, ErrConversationSendInFlight) {
				t.Fatalf("unfinished provider intent did not block phone CAS: %v", err)
			}
			var intact bool
			if err := db.Pool().QueryRow(ctx, `select retired_at is null and remote_jid=$2 from public.whatsapp_conversations where id=$1::uuid`, f.conversationID, f.remoteJID).Scan(&intact); err != nil || !intact {
				t.Fatalf("failed CAS changed old route: %t %v", intact, err)
			}
		})
	}
}
