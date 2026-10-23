package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// This opt-in regression uses only a disposable loopback database and a fake
// provider. It keeps the existing send path, durable outbox, and signed echo
// together in one synthetic organization.
func TestLocalWhatsAppSendRegression(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_EPOCH1_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_EPOCH1_TEST_DATABASE_URL is not set")
	}
	target, err := url.Parse(databaseURL)
	if err != nil || target.Hostname() != "127.0.0.1" || (target.Port() != "57722" && target.Port() != "57922") {
		t.Fatal("send regression requires the disposable loopback PostgreSQL clone")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	var postgres *dbpkg.Postgres
	if target.Port() == "57922" {
		postgres = openLocalOutboundDatabase(t, ctx)
	} else {
		// Preserve the original opt-in 57722 fixture. The newer clone has its
		// own stricter database-name, marker and wrapper admission above.
		postgres, err = dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(postgres.Close)
	}

	fixture := createSessionConversationLockFixture(t, ctx, postgres.Pool(), "send-regression")
	t.Cleanup(func() { cleanupSessionConversationLockFixture(t, postgres.Pool(), fixture) })
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		for _, statement := range []string{
			`delete from public.whatsapp_attendance_marker_confirmations where organization_id = $1::uuid`,
			`delete from public.lead_timeline_events where organization_id = $1::uuid`,
			`delete from public.whatsapp_outbox where organization_id = $1::uuid`,
			`delete from public.whatsapp_messages where organization_id = $1::uuid`,
			`delete from public.whatsapp_attendance_entries where organization_id = $1::uuid`,
		} {
			if _, cleanupErr := postgres.Pool().Exec(cleanupCtx, statement, fixture.organizationID); cleanupErr != nil {
				t.Errorf("clean synthetic send rows: %v", cleanupErr)
			}
		}
	})

	var providerCalls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/send/text" {
			http.NotFound(w, r)
			return
		}
		providerCalls.Add(1)
		var body struct {
			ID     string `json:"id"`
			Number string `json:"number"`
			Text   string `json:"text"`
		}
		if decodeErr := json.NewDecoder(r.Body).Decode(&body); decodeErr != nil ||
			body.ID == "" || body.Number != fixture.phone || body.Text != "synthetic outbound" ||
			r.Header.Get("instanceId") != fixture.suffix {
			t.Errorf("fake provider received unexpected send: %+v, error=%v", body, decodeErr)
			http.Error(w, "invalid synthetic send", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"messageId": body.ID})
	}))
	defer provider.Close()
	repo := NewRepository(postgres, nil, StorageConfig{
		ProjectURL: provider.URL,
		APIKey:     "synthetic-service-key",
		EvolutionGo: EvolutionGoConfig{
			APIURL: provider.URL,
			APIKey: "synthetic-provider-key",
		},
	})

	// A card is required even when the session and contact are valid.
	unlinkedPhone := fmt.Sprintf("55119%08d", (time.Now().UnixNano()+1)%100_000_000)
	var unlinkedID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, remote_jid, contact_phone,
			contact_name, assigned_user_id
		) values ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
		returning id::text
	`, fixture.organizationID, fixture.sessionID, unlinkedPhone+"@s.whatsapp.net",
		unlinkedPhone, fixture.suffix+"-unlinked", fixture.userID).Scan(&unlinkedID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SendMessage(ctx, fixture.tenant, unlinkedID, sendMessageInput{
		Text: "must not send", ClientMessageID: fixture.suffix + "-unlinked", ExpectedLeadID: fixture.leadID,
	}); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("unlinked send error = %v, want ErrConversationNotFound", err)
	}
	if _, err := repo.SendMessage(ctx, fixture.tenant, fixture.conversationID, sendMessageInput{
		Text: "must not send", ClientMessageID: fixture.suffix + "-unattended", ExpectedLeadID: fixture.leadID,
	}); !errors.Is(err, ErrAttendanceRequired) {
		t.Fatalf("unattended send error = %v, want ErrAttendanceRequired", err)
	}

	assertCounts := func(wantMessages, wantOutbox int) {
		t.Helper()
		var messages, outbox int
		if err := postgres.Pool().QueryRow(ctx, `
			select
				(select count(*)::integer from public.whatsapp_messages where organization_id = $1::uuid),
				(select count(*)::integer from public.whatsapp_outbox where organization_id = $1::uuid)
		`, fixture.organizationID).Scan(&messages, &outbox); err != nil {
			t.Fatal(err)
		}
		if messages != wantMessages || outbox != wantOutbox {
			t.Fatalf("synthetic send rows = messages:%d outbox:%d, want %d/%d", messages, outbox, wantMessages, wantOutbox)
		}
	}
	assertCounts(0, 0)
	if providerCalls.Load() != 0 {
		t.Fatal("a blocked send reached the fake provider")
	}

	if _, err := repo.JoinConversationAttendance(ctx, fixture.tenant, fixture.conversationID, attendanceInput{
		ExpectedLeadID: fixture.leadID, SendSessionID: fixture.sessionID,
	}); err != nil {
		t.Fatal(err)
	}
	clientID := fixture.suffix + "-accepted"
	input := sendMessageInput{Text: "synthetic outbound", ClientMessageID: clientID, ExpectedLeadID: fixture.leadID}
	first, err := repo.SendMessage(ctx, fixture.tenant, fixture.conversationID, input)
	if err != nil || first.Message == nil || first.Status != "queued" {
		t.Fatalf("first send = %+v, error=%v", first, err)
	}
	second, err := repo.SendMessage(ctx, fixture.tenant, fixture.conversationID, input)
	if err != nil || second.Message == nil || second.Message.ID != first.Message.ID {
		t.Fatalf("idempotent send = %+v, error=%v", second, err)
	}
	assertCounts(1, 1)
	if providerCalls.Load() != 0 {
		t.Fatal("send called the provider before the durable outbox was leased")
	}

	// Lease only this fixture's exact outbox row. The shared disposable clone may
	// contain unrelated pending fixtures, so a global worker claim is unsafe.
	leaseToken := "synthetic-send-regression-" + clientID
	var item pendingWhatsAppOutbox
	var rawPayload string
	if err := postgres.Pool().QueryRow(ctx, `
		update public.whatsapp_outbox
		set status = 'processing', locked_at = now(), locked_by = $3, updated_at = now()
		where organization_id = $1::uuid and client_message_id = $2 and status = 'pending'
		returning id::text, organization_id::text, session_id::text,
			conversation_id::text, message_id::text, client_message_id,
			coalesce(provider_message_id, ''), payload::text, attempts,
			max_attempts, locked_by, coalesce(last_error, ''), created_at
	`, fixture.organizationID, clientID, leaseToken).Scan(
		&item.ID, &item.OrganizationID, &item.SessionID, &item.ConversationID,
		&item.MessageRowID, &item.ClientMessageID, &item.ProviderMessageID,
		&rawPayload, &item.Attempts, &item.MaxAttempts, &item.LeaseToken,
		&item.LastError, &item.CreatedAt,
	); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(rawPayload), &item.Payload); err != nil {
		t.Fatal(err)
	}
	if err := repo.processClaimedWhatsAppOutbox(ctx, item, whatsappOutboxLaneFast); err != nil {
		t.Fatal(err)
	}
	if providerCalls.Load() != 1 {
		t.Fatalf("fake provider received %d sends, want 1", providerCalls.Load())
	}
	var messageStatus, outboxStatus, providerID string
	if err := postgres.Pool().QueryRow(ctx, `
		select message.status, outbox.status, coalesce(message.provider_message_id, '')
		from public.whatsapp_messages message
		join public.whatsapp_outbox outbox on outbox.message_id = message.id
		where message.organization_id = $1::uuid and message.client_message_id = $2
	`, fixture.organizationID, clientID).Scan(&messageStatus, &outboxStatus, &providerID); err != nil {
		t.Fatal(err)
	}
	if messageStatus != "sent" || outboxStatus != "sent" || providerID != deterministicProviderMessageID(clientID) {
		t.Fatalf("delivered state = message:%s outbox:%s provider:%s", messageStatus, outboxStatus, providerID)
	}

	// The signed provider echo has the same stanza ID. Its processing may update
	// delivery metadata, but it must not insert another message or outbox row.
	for attempt := 0; attempt < 2; attempt++ {
		err := repo.processNativeEvolutionMessages(ctx, pendingEvolutionWebhook{
			OrganizationID: fixture.organizationID,
			SessionID:      fixture.sessionID,
			EventType:      "messages.upsert",
			Payload:        []byte(`{}`),
		}, []nativeEvolutionMessage{{
			ProviderMessageID: providerID,
			RemoteJID:         fixture.remoteJID,
			ContactPhone:      fixture.phone,
			ContactName:       fixture.suffix,
			SenderJID:         "5511888877777@s.whatsapp.net",
			FromMe:            true,
			MessageType:       "text",
			Content:           "synthetic outbound",
			SentAt:            time.Now().UTC(),
		}})
		if err != nil {
			t.Fatalf("provider echo attempt %d: %v", attempt+1, err)
		}
	}
	assertCounts(1, 1)
	if providerCalls.Load() != 1 {
		t.Fatalf("echo triggered %d fake provider sends, want 1", providerCalls.Load())
	}
}
