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
	"sync"
	"sync/atomic"
	"testing"
	"time"

	automationspkg "github.com/vimob-crm/vimob-crm/apps/api/internal/automations"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestWhatsAppDurableIngressAndOutbox(t *testing.T) {
	databaseURL := os.Getenv("WHATSAPP_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)

	var sendCalls atomic.Int32
	var reactionCalls atomic.Int32
	var edgeCalls atomic.Int32
	var timeoutFirstRequest atomic.Bool
	var timeoutProviderID string
	var providerIDsMu sync.Mutex
	providerIDs := []string{}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/send/text":
			sendCalls.Add(1)
			if r.Header.Get("instanceId") == "" {
				t.Error("provider request is missing instanceId")
			}
			var requestBody map[string]any
			if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
				t.Errorf("invalid provider request body: %v", err)
			}
			requestID, _ := requestBody["id"].(string)
			if requestID == "" {
				t.Error("provider request is missing deterministic id")
			}
			providerIDsMu.Lock()
			providerIDs = append(providerIDs, requestID)
			providerIDsMu.Unlock()
			if requestID == timeoutProviderID && timeoutFirstRequest.CompareAndSwap(false, true) {
				time.Sleep(150 * time.Millisecond)
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"messageId": requestID})
		case "/message/react":
			reactionCalls.Add(1)
			var requestBody map[string]any
			if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
				t.Errorf("invalid reaction provider request body: %v", err)
			}
			if requestBody["number"] == "" || requestBody["id"] == "" || requestBody["reaction"] == nil {
				t.Errorf("reaction provider request is incomplete: %#v", requestBody)
			}
			if requestBody["id"] != requestBody["messageId"] || requestBody["reaction"] != requestBody["emoji"] {
				t.Errorf("official and transition reaction fields disagree: %#v", requestBody)
			}
			if _, ok := requestBody["fromMe"].(bool); !ok {
				t.Errorf("reaction provider request is missing target fromMe: %#v", requestBody)
			}
			w.Header().Set("Content-Type", "application/json")
			// Evolution implementations can acknowledge with the target ID. The
			// outbox must not overwrite the reaction event with that identity.
			_ = json.NewEncoder(w).Encode(map[string]any{"messageId": requestBody["id"]})
		case "/functions/v1/evolution-go-webhook":
			edgeCalls.Add(1)
			for _, credential := range []string{"webhook_token", "apikey", "token"} {
				if r.URL.Query().Has(credential) {
					t.Errorf("edge forwarding leaked %s in its URL", credential)
				}
			}
			if r.Header.Get("x-webhook-token") != "webhook-secret" {
				t.Error("edge forwarding did not use the scoped webhook token header")
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()

	suffix := fmt.Sprintf("wa-durable-%d", time.Now().UnixNano())
	var organizationID, foreignHistoryOrganizationID, userID, otherUserID, leadID, otherLeadID string
	var sessionID, legacySessionID, deletedSessionID, foreignHistorySessionID, conversationID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.organizations (name, slug)
		values ($1, $1)
		returning id::text
	`, suffix).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.organizations (name, slug)
		values ($1, $1)
		returning id::text
	`, suffix+"-foreign-history").Scan(&foreignHistoryOrganizationID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.organizations where id = any($1::uuid[])`, []string{organizationID, foreignHistoryOrganizationID})
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from auth.users where id = any($1::uuid[])`, []string{userID, otherUserID})
	})

	if _, err := postgres.Pool().Exec(ctx, `
		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values (
			$1::uuid, 'authenticated', 'authenticated', $2, '', now(),
			'{}'::jsonb, '{}'::jsonb, now(), now()
		)
	`, userID, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, $3, $4, 'user', true)
	`, userID, organizationID, suffix, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&otherUserID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values (
			$1::uuid, 'authenticated', 'authenticated', $2, '', now(),
			'{}'::jsonb, '{}'::jsonb, now(), now()
		)
	`, otherUserID, suffix+"-other-user@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, $3, $4, 'user', true)
	`, otherUserID, organizationID, suffix+" other user", suffix+"-other-user@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'user', true)
	`, organizationID, otherUserID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'user', true)
	`, organizationID, userID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.leads (organization_id, assigned_user_id, name, phone, source)
		values ($1::uuid, $2::uuid, $3, '5511999991111', 'meta_ads')
		returning id::text
	`, organizationID, userID, suffix).Scan(&leadID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.leads (organization_id, assigned_user_id, name, phone, source)
		values ($1::uuid, $2::uuid, $3, '5511888882222', 'meta_ads')
		returning id::text
	`, organizationID, userID, suffix+" other").Scan(&otherLeadID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_sessions (
			organization_id, instance_name, instance_id, owner_user_id,
			provider, status, is_active, phone_number, advanced_settings
		) values (
			$1::uuid, $2, $2, $3::uuid,
			'evolution_go', 'connected', true, '5511999991111', '{"webhook_token":"webhook-secret","token":"provider-secret"}'::jsonb
		)
		returning id::text
	`, organizationID, suffix, userID).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_sessions (
			organization_id, instance_name, instance_id, owner_user_id,
			provider, status, is_active, advanced_settings
		) values (
			$1::uuid, $2, $2, $3::uuid,
			'evolution_go', 'disconnected', true, '{"webhook_token":"legacy-webhook-secret","token":"legacy-provider-secret"}'::jsonb
		)
		returning id::text
	`, organizationID, suffix+"-legacy-session", userID).Scan(&legacySessionID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_sessions (
			organization_id, instance_name, instance_id, owner_user_id,
			provider, status, is_active, advanced_settings
		) values (
			$1::uuid, $2, $2, $3::uuid,
			'evolution_go', 'deleted', false, '{"webhook_token":"deleted-webhook-secret","token":"deleted-provider-secret"}'::jsonb
		)
		returning id::text
	`, organizationID, suffix+"-deleted-session", userID).Scan(&deletedSessionID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_sessions (
			organization_id, instance_name, instance_id, provider, status, is_active, advanced_settings
		) values (
			$1::uuid, $2, $2, 'evolution_go', 'connected', true, '{}'::jsonb
		)
		returning id::text
	`, foreignHistoryOrganizationID, suffix+"-foreign-history-session").Scan(&foreignHistorySessionID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, lead_id, assigned_user_id, remote_jid, contact_name
		) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, '5511999991111@s.whatsapp.net', $5)
		returning id::text
	`, organizationID, sessionID, leadID, userID, suffix).Scan(&conversationID); err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(postgres, nil, StorageConfig{
		ProjectURL: provider.URL,
		APIKey:     "service-key",
		EvolutionGo: EvolutionGoConfig{
			APIURL: provider.URL,
			APIKey: "global-provider-key",
		},
	})
	tenantContext := tenant.Context{OrganizationID: organizationID, UserID: userID, MemberRole: "user"}
	validationItem := pendingWhatsAppOutbox{OrganizationID: organizationID, SessionID: sessionID}
	if permanent, err := repo.validateWhatsAppOutboxSession(ctx, validationItem); err != nil || permanent {
		t.Fatalf("connected outbox session validation = permanent:%v error:%v", permanent, err)
	}
	if _, err := postgres.Pool().Exec(ctx, `update public.whatsapp_sessions set status = 'disconnected' where id = $1::uuid`, sessionID); err != nil {
		t.Fatal(err)
	}
	if permanent, err := repo.validateWhatsAppOutboxSession(ctx, validationItem); err == nil || permanent {
		t.Fatalf("disconnected outbox session validation = permanent:%v error:%v", permanent, err)
	}
	if _, err := postgres.Pool().Exec(ctx, `update public.whatsapp_sessions set is_active = false where id = $1::uuid`, sessionID); err != nil {
		t.Fatal(err)
	}
	if permanent, err := repo.validateWhatsAppOutboxSession(ctx, validationItem); err == nil || !permanent {
		t.Fatalf("inactive outbox session validation = permanent:%v error:%v", permanent, err)
	}
	if _, err := postgres.Pool().Exec(ctx, `update public.whatsapp_sessions set status = 'connected', is_active = true where id = $1::uuid`, sessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SendMessage(ctx, tenantContext, conversationID, sendMessageInput{
		Text:            "must not use fallback",
		SendSessionID:   legacySessionID,
		ClientMessageID: "explicit-disconnected-send",
	}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("explicit disconnected SendMessage() error = %v, want ErrInvalidInput", err)
	}
	if _, err := repo.StartConversation(ctx, tenantContext, StartConversationRequest{
		Phone:     "5511999991111",
		SessionID: legacySessionID,
		LeadID:    leadID,
	}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("explicit disconnected StartConversation() error = %v, want ErrInvalidInput", err)
	}
	foreignMediaURL := provider.URL + "/storage/v1/object/public/whatsapp-media/orgs/foreign-organization/sessions/foreign/outgoing/private.pdf"
	if _, err := repo.SendMessage(ctx, tenantContext, conversationID, sendMessageInput{
		MediaURL:        foreignMediaURL,
		MediaType:       "document",
		Mimetype:        "application/pdf",
		SendSessionID:   sessionID,
		ClientMessageID: "cross-organization-media",
	}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("cross-organization media error = %v, want ErrInvalidInput", err)
	}
	if _, err := repo.StartConversation(ctx, tenantContext, StartConversationRequest{
		Phone:     "5511999991111",
		SessionID: sessionID,
		LeadID:    otherLeadID,
	}); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("StartConversation() mismatched lead error = %v, want ErrInvalidReference", err)
	}
	if err := repo.LinkConversationToLead(ctx, tenantContext, conversationID, otherLeadID); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("LinkConversationToLead() mismatched lead error = %v, want ErrInvalidReference", err)
	}

	// Canary-shaped regression: an exact conversation is already quarantined on
	// the current session, while the same lead has a historical conversation on
	// another session. The abbreviated user input is useful only for matching;
	// the outbound identity must come from the lead's complete stored phone.
	var canaryLeadID, historicalConversationID, legacyConversationID, quarantineConversationID, inboundLogID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.leads (organization_id, assigned_user_id, name, phone, source)
		values ($1::uuid, $2::uuid, $3, '(22) 99992-2093', 'meta_ads')
		returning id::text
	`, organizationID, userID, suffix+" canary").Scan(&canaryLeadID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, lead_id, assigned_user_id,
			remote_jid, contact_phone, contact_name, last_message_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			'5522999922093@s.whatsapp.net', '5522999922093', $5, now() - interval '1 day'
		)
		returning id::text
	`, organizationID, deletedSessionID, canaryLeadID, userID, suffix+" historical").Scan(&historicalConversationID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, lead_id, assigned_user_id,
			remote_jid, contact_phone, contact_name, last_message_at
		) values (
			$1::uuid, null, null, null,
			'5522999922093@s.whatsapp.net', '5522999922093', $2, now() - interval '2 days'
		)
		returning id::text
	`, organizationID, suffix+" legacy sessionless").Scan(&legacyConversationID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, lead_id, assigned_user_id,
			remote_jid, contact_phone, contact_name, last_message_at
		) values (
			$1::uuid, $2::uuid, null, null,
			'5522999922093@s.whatsapp.net', '5522999922093', $3, now()
		)
		returning id::text
	`, organizationID, sessionID, suffix+" quarantine").Scan(&quarantineConversationID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.whatsapp_messages (
			organization_id, session_id, conversation_id, lead_id, message_id,
			from_me, direction, content, message_type, status, sent_at, remote_jid
		)
		select $1::uuid, $2::uuid, $3::uuid, $4::uuid,
		       $5 || '-historical-' || item::text,
		       (item % 2 = 0), case when item % 2 = 0 then 'outbound' else 'inbound' end,
		       'historical ' || item::text, 'text', 'sent', now() - interval '1 day',
		       '5522999922093@s.whatsapp.net'
		from generate_series(1, 11) item
	`, organizationID, deletedSessionID, historicalConversationID, canaryLeadID, suffix); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.whatsapp_messages (
			organization_id, session_id, conversation_id, lead_id, message_id,
			from_me, direction, content, message_type, status, sent_at, remote_jid
		)
		select $1::uuid, null, $2::uuid, $3::uuid,
		       $4 || '-legacy-sessionless-' || item::text,
		       false, 'inbound', 'legacy sessionless ' || item::text,
		       'text', 'received', now() - interval '2 days',
		       '5522999922093@s.whatsapp.net'
		from generate_series(1, 3) item
	`, organizationID, legacyConversationID, canaryLeadID, suffix); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.whatsapp_messages (
			organization_id, session_id, conversation_id, lead_id, message_id,
			from_me, direction, content, message_type, status, sent_at, remote_jid
		)
		select $1::uuid, $2::uuid, $3::uuid, null,
		       $4 || '-quarantine-' || item::text,
		       (item % 3 = 0), case when item % 3 = 0 then 'outbound' else 'inbound' end,
		       'quarantine ' || item::text, 'text', 'received', now(),
		       '5522999922093@s.whatsapp.net'
		from generate_series(1, 30) item
	`, organizationID, sessionID, quarantineConversationID, suffix); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.whatsapp_contact_identity_aliases (
			organization_id, session_id, alias_jid, canonical_jid,
			contact_phone, lead_id, is_group, metadata
		) values (
			$1::uuid, $2::uuid, '5522999922093@c.us', '5522999922093@s.whatsapp.net',
			'5522999922093', null, false, jsonb_build_object('conversation_id', $3::uuid)
		)
	`, organizationID, sessionID, quarantineConversationID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_inbound_logs (
			organization_id, session_id, conversation_id, lead_id, assigned_user_id, match_details
		) values ($1::uuid, $2::uuid, $3::uuid, null, null, '{}'::jsonb)
		returning id::text
	`, organizationID, sessionID, quarantineConversationID).Scan(&inboundLogID); err != nil {
		t.Fatal(err)
	}

	bolaContext := tenant.Context{OrganizationID: organizationID, UserID: otherUserID, MemberRole: "user"}
	if _, err := repo.StartConversation(ctx, bolaContext, StartConversationRequest{
		Phone: "2299922093", SessionID: sessionID, LeadID: canaryLeadID,
	}); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("quarantine claim BOLA error = %v, want ErrSessionNotFound", err)
	}
	if _, err := repo.StartConversation(ctx, tenantContext, StartConversationRequest{
		Phone: "2299922093", SessionID: sessionID, LeadID: otherLeadID,
	}); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("quarantine claim mismatched phone error = %v, want ErrInvalidReference", err)
	}

	claimedConversation, err := repo.StartConversation(ctx, tenantContext, StartConversationRequest{
		Phone: "2299922093", SessionID: sessionID, LeadID: canaryLeadID,
	})
	if err != nil {
		t.Fatalf("StartConversation() quarantine claim error = %v", err)
	}
	if claimedConversation.ID != quarantineConversationID || pointerValue(claimedConversation.LeadID) != canaryLeadID ||
		claimedConversation.RemoteJID != "5522999922093@s.whatsapp.net" {
		t.Fatalf("claimed conversation = %#v, want exact current-session lead identity", claimedConversation)
	}

	var currentLeadID, currentAssigneeID, historicalSessionAfter, historicalLeadAfter string
	var quarantineMessageCount, quarantineBackfilledCount, historicalMessageCount, exactConversationCount, wrongDestinationCount int
	var aliasLeadID, logLeadID, logAssigneeID string
	if err := postgres.Pool().QueryRow(ctx, `
		select coalesce(lead_id::text, ''), coalesce(assigned_user_id::text, '')
		from public.whatsapp_conversations where id = $1::uuid
	`, quarantineConversationID).Scan(&currentLeadID, &currentAssigneeID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select session_id::text, lead_id::text
		from public.whatsapp_conversations where id = $1::uuid
	`, historicalConversationID).Scan(&historicalSessionAfter, &historicalLeadAfter); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer, count(*) filter (where lead_id = $2::uuid)::integer
		from public.whatsapp_messages where conversation_id = $1::uuid
	`, quarantineConversationID, canaryLeadID).Scan(&quarantineMessageCount, &quarantineBackfilledCount); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `select count(*)::integer from public.whatsapp_messages where conversation_id = $1::uuid`, historicalConversationID).Scan(&historicalMessageCount); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer from public.whatsapp_conversations
		where organization_id = $1::uuid and remote_jid = '5522999922093@s.whatsapp.net'
	`, organizationID).Scan(&exactConversationCount); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer from public.whatsapp_conversations
		where organization_id = $1::uuid and remote_jid = '552299922093@s.whatsapp.net'
	`, organizationID).Scan(&wrongDestinationCount); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select coalesce(lead_id::text, '')
		from public.whatsapp_contact_identity_aliases
		where organization_id = $1::uuid and session_id = $2::uuid and alias_jid = '5522999922093@c.us'
	`, organizationID, sessionID).Scan(&aliasLeadID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select coalesce(lead_id::text, ''), coalesce(assigned_user_id::text, '')
		from public.whatsapp_inbound_logs where id = $1::uuid
	`, inboundLogID).Scan(&logLeadID, &logAssigneeID); err != nil {
		t.Fatal(err)
	}
	if currentLeadID != canaryLeadID || currentAssigneeID != userID ||
		historicalSessionAfter != deletedSessionID || historicalLeadAfter != canaryLeadID ||
		quarantineMessageCount != 30 || quarantineBackfilledCount != 30 || historicalMessageCount != 11 ||
		exactConversationCount != 3 || wrongDestinationCount != 0 || aliasLeadID != canaryLeadID ||
		logLeadID != canaryLeadID || logAssigneeID != userID {
		t.Fatalf("quarantine claim state current:%s/%s historical:%s/%s messages:%d/%d/%d conversations:%d wrong:%d alias:%s log:%s/%s",
			currentLeadID, currentAssigneeID, historicalSessionAfter, historicalLeadAfter,
			quarantineMessageCount, quarantineBackfilledCount, historicalMessageCount,
			exactConversationCount, wrongDestinationCount, aliasLeadID, logLeadID, logAssigneeID)
	}

	claimedAgain, err := repo.StartConversation(ctx, tenantContext, StartConversationRequest{
		Phone: "2299922093", SessionID: sessionID, LeadID: canaryLeadID,
	})
	if err != nil || claimedAgain.ID != quarantineConversationID {
		t.Fatalf("idempotent quarantine claim = %#v / %v", claimedAgain, err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer from public.whatsapp_conversations
		where organization_id = $1::uuid and remote_jid = '5522999922093@s.whatsapp.net'
	`, organizationID).Scan(&exactConversationCount); err != nil {
		t.Fatal(err)
	}
	if exactConversationCount != 3 {
		t.Fatalf("idempotent quarantine claim changed conversation count to %d", exactConversationCount)
	}

	history, err := repo.GetHistoryAccess(ctx, tenantContext, HistoryAccessFilter{
		LeadID: canaryLeadID,
		MessageFilter: MessageFilter{
			Limit: 100,
		},
	})
	if err != nil {
		t.Fatalf("lead history across deleted/current sessions error = %v", err)
	}
	conversationIDs := map[string]bool{}
	for _, item := range history.Conversations {
		conversationIDs[item.ID] = true
	}
	historyMessageCounts := map[string]int{}
	for _, item := range history.Messages {
		historyMessageCounts[item.ConversationID]++
	}
	if len(history.Conversations) != 3 || !conversationIDs[quarantineConversationID] || !conversationIDs[historicalConversationID] || !conversationIDs[legacyConversationID] ||
		len(history.Messages) != 44 || historyMessageCounts[quarantineConversationID] != 30 || historyMessageCounts[historicalConversationID] != 11 || historyMessageCounts[legacyConversationID] != 3 {
		t.Fatalf("lead history lost deleted-session evidence: conversations=%#v messageCounts=%#v total=%d",
			conversationIDs, historyMessageCounts, len(history.Messages))
	}
	if _, err := repo.GetHistoryAccess(ctx, bolaContext, HistoryAccessFilter{LeadID: canaryLeadID, MessageFilter: MessageFilter{Limit: 100}}); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("same-organization lead history BOLA error = %v, want ErrInvalidReference", err)
	}
	crossOrganizationContext := tenant.Context{
		OrganizationID: "00000000-0000-4000-8000-000000000099",
		UserID:         otherUserID,
		MemberRole:     "user",
	}
	if _, err := repo.GetHistoryAccess(ctx, crossOrganizationContext, HistoryAccessFilter{LeadID: canaryLeadID, MessageFilter: MessageFilter{Limit: 100}}); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("cross-organization lead history BOLA error = %v, want ErrInvalidReference", err)
	}
	if _, err := repo.SendMessage(ctx, tenantContext, quarantineConversationID, sendMessageInput{
		Text:            "must not send through deleted history session",
		SendSessionID:   deletedSessionID,
		ClientMessageID: "deleted-history-session-send",
	}); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("deleted historical session SendMessage() error = %v, want ErrSessionNotFound", err)
	}

	clientMessageID := "client-durable-1"
	response, err := repo.SendMessage(ctx, tenantContext, conversationID, sendMessageInput{
		Text:            "durable outbound",
		ClientMessageID: clientMessageID,
	})
	if err != nil {
		t.Fatalf("SendMessage() returned error: %v", err)
	}
	if response.Status != "queued" || response.Message == nil || response.Message.Status != "queued" {
		t.Fatalf("DB-first response = %#v, want canonical queued message", response)
	}
	if sendCalls.Load() != 0 {
		t.Fatal("provider was called before the transaction committed")
	}
	claimedOutbox, err := repo.claimWhatsAppOutbox(ctx)
	if err != nil {
		t.Fatalf("claimWhatsAppOutbox() returned error: %v", err)
	}
	if len(claimedOutbox) != 1 || claimedOutbox[0].ClientMessageID != clientMessageID {
		t.Fatalf("claimWhatsAppOutbox() = %#v, want the durable outbound row", claimedOutbox)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_outbox
		set locked_at = now() - interval '4 minutes'
		where id = $1::uuid
	`, claimedOutbox[0].ID); err != nil {
		t.Fatal(err)
	}
	outboxLeaseOwned, err := repo.renewWhatsAppOutboxLease(ctx, claimedOutbox[0].ID)
	if err != nil || !outboxLeaseOwned {
		t.Fatalf("renewWhatsAppOutboxLease() = %v, %v; want owned lease", outboxLeaseOwned, err)
	}
	var outboxLeaseFresh bool
	if err := postgres.Pool().QueryRow(ctx, `
		select locked_at > now() - interval '5 seconds'
		from public.whatsapp_outbox
		where id = $1::uuid
	`, claimedOutbox[0].ID).Scan(&outboxLeaseFresh); err != nil {
		t.Fatal(err)
	}
	if !outboxLeaseFresh {
		t.Fatal("outbox lease renewal did not refresh locked_at")
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_outbox
		set status = 'pending', attempts = 0, locked_at = null, locked_by = null
		where id = $1::uuid
	`, claimedOutbox[0].ID); err != nil {
		t.Fatal(err)
	}

	if err := repo.ProcessWhatsAppOutbox(ctx); err != nil {
		t.Fatalf("ProcessWhatsAppOutbox() returned error: %v", err)
	}
	if sendCalls.Load() != 1 {
		t.Fatalf("provider send calls = %d, want 1", sendCalls.Load())
	}
	var messageStatus, messageDirection, providerMessageID, outboxStatus string
	if err := postgres.Pool().QueryRow(ctx, `
		select wm.status, wm.direction, coalesce(wm.provider_message_id, ''), wo.status
		from public.whatsapp_messages wm
		join public.whatsapp_outbox wo on wo.message_id = wm.id
		where wm.organization_id = $1::uuid
		  and wm.session_id = $2::uuid
		  and wm.client_message_id = $3
	`, organizationID, sessionID, clientMessageID).Scan(&messageStatus, &messageDirection, &providerMessageID, &outboxStatus); err != nil {
		t.Fatal(err)
	}
	if messageStatus != "sent" || messageDirection != "outbound" || outboxStatus != "sent" || providerMessageID != deterministicProviderMessageID(clientMessageID) {
		t.Fatalf("delivery state = message:%s direction:%s outbox:%s provider:%s", messageStatus, messageDirection, outboxStatus, providerMessageID)
	}
	var lastContactRecorded, firstResponseRecorded bool
	var sentTimelineCount int
	if err := postgres.Pool().QueryRow(ctx, `
		select last_contact_at is not null, first_response_at is not null
		from public.leads where id = $1::uuid and organization_id = $2::uuid
	`, leadID, organizationID).Scan(&lastContactRecorded, &firstResponseRecorded); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer
		from public.lead_timeline_events
		where organization_id = $1::uuid and lead_id = $2::uuid
		  and event_type = 'whatsapp_message_sent'
		  and metadata->>'outbox_id' = $3
		  and metadata->>'delivery_status' = 'sent'
	`, organizationID, leadID, claimedOutbox[0].ID).Scan(&sentTimelineCount); err != nil {
		t.Fatal(err)
	}
	if !lastContactRecorded || !firstResponseRecorded || sentTimelineCount != 1 {
		t.Fatalf("provider acknowledgement facts = last_contact:%v first_response:%v timeline:%d", lastContactRecorded, firstResponseRecorded, sentTimelineCount)
	}

	if _, err := repo.SendMessage(ctx, tenantContext, conversationID, sendMessageInput{Text: "durable outbound", ClientMessageID: clientMessageID}); err != nil {
		t.Fatalf("idempotent SendMessage() returned error: %v", err)
	}
	if err := repo.ProcessWhatsAppOutbox(ctx); err != nil {
		t.Fatal(err)
	}
	if sendCalls.Load() != 1 {
		t.Fatalf("idempotent retry sent %d provider requests, want 1", sendCalls.Load())
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer
		from public.lead_timeline_events
		where organization_id = $1::uuid and lead_id = $2::uuid
		  and metadata->>'outbox_id' = $3
	`, organizationID, leadID, claimedOutbox[0].ID).Scan(&sentTimelineCount); err != nil {
		t.Fatal(err)
	}
	if sentTimelineCount != 1 {
		t.Fatalf("idempotent delivery created %d sent timeline rows", sentTimelineCount)
	}

	reactionClientID := "reaction-client-1"
	reactionResponse, err := repo.ReactToMessage(ctx, tenantContext, conversationID, response.Message.ID, reactToMessageInput{
		Emoji:            "👍",
		ClientReactionID: reactionClientID,
	})
	if err != nil {
		t.Fatalf("ReactToMessage() returned error: %v", err)
	}
	if reactionResponse.Status != "queued" || reactionResponse.Reaction == nil || reactionResponse.Reaction.MessageType != "reaction" {
		t.Fatalf("DB-first reaction response = %#v", reactionResponse)
	}
	if reactionCalls.Load() != 0 {
		t.Fatal("reaction provider was called before the transaction committed")
	}
	if _, err := repo.ReactToMessage(ctx, tenantContext, conversationID, response.Message.ID, reactToMessageInput{
		Emoji:            "👍",
		ClientReactionID: reactionClientID,
	}); err != nil {
		t.Fatalf("idempotent ReactToMessage() returned error: %v", err)
	}
	var reactionOutboxCount int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer
		from public.whatsapp_outbox
		where organization_id = $1::uuid and client_message_id = $2
	`, organizationID, reactionClientID).Scan(&reactionOutboxCount); err != nil {
		t.Fatal(err)
	}
	if reactionOutboxCount != 1 {
		t.Fatalf("idempotent reaction created %d outbox rows, want 1", reactionOutboxCount)
	}
	if _, err := repo.ReactToMessage(ctx, tenantContext, conversationID, response.Message.ID, reactToMessageInput{
		Emoji:            "❤️",
		ClientReactionID: reactionClientID,
	}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("reused reaction key error = %v, want ErrInvalidInput", err)
	}

	var otherConversationID, otherMessageID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, lead_id, assigned_user_id, remote_jid, contact_name
		) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, '5511888882222@s.whatsapp.net', $5)
		returning id::text
	`, organizationID, sessionID, otherLeadID, userID, suffix+" other").Scan(&otherConversationID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, session_id, conversation_id, lead_id, message_id,
			from_me, direction, content, message_type, status, sent_at, remote_jid
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid, 'other-conversation-target',
			false, 'inbound', 'other target', 'text', 'received', now(), '5511888882222@s.whatsapp.net'
		)
		returning id::text
	`, organizationID, sessionID, otherConversationID, otherLeadID).Scan(&otherMessageID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ReactToMessage(ctx, tenantContext, conversationID, otherMessageID, reactToMessageInput{
		Emoji:            "👍",
		ClientReactionID: "reaction-cross-conversation",
	}); !errors.Is(err, ErrMessageNotFound) {
		t.Fatalf("cross-conversation reaction error = %v, want ErrMessageNotFound", err)
	}

	if err := repo.ProcessWhatsAppOutbox(ctx); err != nil {
		t.Fatalf("reaction ProcessWhatsAppOutbox() returned error: %v", err)
	}
	if reactionCalls.Load() != 1 {
		t.Fatalf("reaction provider calls = %d, want 1", reactionCalls.Load())
	}
	var reactionState, reactionEmoji, reactionMessageStatus, reactionProviderID string
	if err := postgres.Pool().QueryRow(ctx, `
		select wr.status, coalesce(wr.emoji, ''), wm.status, coalesce(wm.provider_message_id, '')
		from public.whatsapp_message_reactions wr
		join public.whatsapp_messages wm
		  on wm.organization_id = wr.organization_id
		 and wm.client_message_id = $3
		where wr.organization_id = $1::uuid
		  and wr.target_message_id = $2::uuid
	`, organizationID, response.Message.ID, reactionClientID).Scan(
		&reactionState,
		&reactionEmoji,
		&reactionMessageStatus,
		&reactionProviderID,
	); err != nil {
		t.Fatal(err)
	}
	if reactionState != "active" || reactionEmoji != "👍" || reactionMessageStatus != "sent" || reactionProviderID != deterministicProviderMessageID(reactionClientID) {
		t.Fatalf("reaction state = %s/%s/%s/%s", reactionState, reactionEmoji, reactionMessageStatus, reactionProviderID)
	}

	removalClientID := "reaction-client-remove-1"
	if _, err := repo.ReactToMessage(ctx, tenantContext, conversationID, response.Message.ID, reactToMessageInput{
		Emoji:            "",
		ClientReactionID: removalClientID,
	}); err != nil {
		t.Fatalf("reaction removal error = %v", err)
	}
	if err := repo.ProcessWhatsAppOutbox(ctx); err != nil {
		t.Fatalf("reaction removal outbox error = %v", err)
	}
	if reactionCalls.Load() != 2 {
		t.Fatalf("reaction provider calls after removal = %d, want 2", reactionCalls.Load())
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select status, coalesce(emoji, '')
		from public.whatsapp_message_reactions
		where organization_id = $1::uuid and target_message_id = $2::uuid
	`, organizationID, response.Message.ID).Scan(&reactionState, &reactionEmoji); err != nil {
		t.Fatal(err)
	}
	if reactionState != "removed" || reactionEmoji != "" {
		t.Fatalf("reaction removal state = %s/%q", reactionState, reactionEmoji)
	}

	// Build an automation runtime fixture so terminal delivery outcomes are
	// observable, tenant-scoped and safely retryable only when definitively failed.
	if _, err := postgres.Pool().Exec(ctx, `
		update public.organization_members
		set role = 'admin'
		where organization_id = $1::uuid and user_id = $2::uuid
	`, organizationID, userID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.organization_modules (organization_id, module_name, is_enabled)
		values ($1::uuid, 'automations', true)
		on conflict (organization_id, module_name) do update set is_enabled = true
	`, organizationID); err != nil {
		t.Fatal(err)
	}
	var automationID, flowVersionID, executionID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.automations (organization_id, name, is_active, trigger_type, trigger_config, flow_definition)
		values ($1::uuid, $2, false, 'manual', '{}'::jsonb, '{}'::jsonb)
		returning id::text
	`, organizationID, suffix+" terminal delivery").Scan(&automationID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.automation_flow_versions (
		  automation_id, organization_id, version, trigger_type, trigger_config,
		  graph, graph_checksum, first_node_key, requires_review
		) values (
		  $1::uuid, $2::uuid, 1, 'manual', '{}'::jsonb,
		  '{"nodes":[{"id":"terminal","type":"action","action_type":"send_whatsapp","config":{}}],"connections":[],"settings":{}}'::jsonb,
		  $3, 'terminal', false
		) returning id::text
	`, automationID, organizationID, suffix+"-terminal-checksum").Scan(&flowVersionID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.automations set active_flow_version_id = $2::uuid, is_active = true where id = $1::uuid
	`, automationID, flowVersionID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.automation_executions (
		  automation_id, flow_version_id, organization_id, lead_id, conversation_id,
		  status, current_node_key, locked_by, locked_at, attempt_count
		) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'running', 'terminal', $6, now(), 1)
		returning id::text
	`, automationID, flowVersionID, organizationID, leadID, conversationID, suffix+"-terminal-lease").Scan(&executionID); err != nil {
		t.Fatal(err)
	}
	type automationEffectFixture struct {
		dispatchID string
		outboxID   string
		messageID  string
	}
	attachAutomationEffect := func(clientID, nodeKey string) automationEffectFixture {
		t.Helper()
		var fixture automationEffectFixture
		if err := postgres.Pool().QueryRow(ctx, `
			select id::text, message_id::text
			from public.whatsapp_outbox
			where organization_id = $1::uuid and client_message_id = $2
		`, organizationID, clientID).Scan(&fixture.outboxID, &fixture.messageID); err != nil {
			t.Fatal(err)
		}
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.automation_effect_dispatches (
			  organization_id, execution_id, node_key, effect_key, effect_type,
			  status, request, response, completed_at
			) values (
			  $1::uuid, $2::uuid, $3, $4, 'send_whatsapp', 'succeeded',
			  '{"delivery_contract":"canonical_whatsapp_outbox_v1"}'::jsonb,
			  jsonb_build_object('delivery', 'outbox', 'status', 'queued', 'outbox_id', $5::uuid, 'message_id', $6::uuid),
			  now()
			) returning id::text
		`, organizationID, executionID, nodeKey, clientID, fixture.outboxID, fixture.messageID).Scan(&fixture.dispatchID); err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.Pool().Exec(ctx, `
			insert into public.lead_timeline_events (
			  organization_id, lead_id, event_type, title, description, metadata, event_at
			) values (
			  $1::uuid, $2::uuid, 'whatsapp_message_queued', 'Mensagem WhatsApp enfileirada',
			  $3, jsonb_build_object('outbox_id', $4::uuid, 'delivery_status', 'queued'), now()
			)
		`, organizationID, leadID, nodeKey, fixture.outboxID); err != nil {
			t.Fatal(err)
		}
		return fixture
	}
	automationRepo := automationspkg.NewRepository(postgres, automationspkg.FunctionsConfig{}, automationspkg.StorageConfig{})
	automationManager := tenant.Context{
		OrganizationID: organizationID,
		UserID:         userID,
		MemberRole:     "admin",
		Permissions:    []string{"automations_view", "automations_edit"},
	}

	// Simulate the hardest outbound ambiguity: WhatsApp accepted the stable ID,
	// but the HTTP acknowledgement timed out. Without an official exactly-once
	// contract, the worker must preserve the stable ID and stop automatic resend.
	timeoutClientID := "client-timeout-" + suffix
	timeoutProviderID = deterministicProviderMessageID(timeoutClientID)
	repo.functions.httpClient.Timeout = 50 * time.Millisecond
	if _, err := repo.SendMessage(ctx, tenantContext, conversationID, sendMessageInput{Text: "ambiguous timeout", ClientMessageID: timeoutClientID}); err != nil {
		t.Fatalf("timeout fixture SendMessage() returned error: %v", err)
	}
	timeoutEffect := attachAutomationEffect(timeoutClientID, "timeout-terminal")
	if err := repo.ProcessWhatsAppOutbox(ctx); err != nil {
		t.Fatalf("first ambiguous ProcessWhatsAppOutbox() returned error: %v", err)
	}
	var timeoutStatus string
	if err := postgres.Pool().QueryRow(ctx, `
		select status from public.whatsapp_outbox
		where organization_id = $1::uuid and client_message_id = $2
	`, organizationID, timeoutClientID).Scan(&timeoutStatus); err != nil {
		t.Fatal(err)
	}
	if timeoutStatus != "dead" {
		t.Fatalf("ambiguous timeout status = %q, want dead/unknown without automatic resend", timeoutStatus)
	}
	var timeoutEffectStatus, timeoutNotificationBody string
	var timeoutCompletedAt time.Time
	if err := postgres.Pool().QueryRow(ctx, `
		select status, completed_at
		from public.automation_effect_dispatches
		where id = $1::uuid and organization_id = $2::uuid
	`, timeoutEffect.dispatchID, organizationID).Scan(&timeoutEffectStatus, &timeoutCompletedAt); err != nil {
		t.Fatal(err)
	}
	if timeoutEffectStatus != "unknown" {
		t.Fatalf("ambiguous automation effect status = %q, want unknown", timeoutEffectStatus)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select coalesce(content, '') from public.notifications
		where organization_id = $1::uuid
		  and metadata->>'outbox_id' = $2
		limit 1
	`, organizationID, timeoutEffect.outboxID).Scan(&timeoutNotificationBody); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(timeoutNotificationBody, "nao foi confirmada") {
		t.Fatalf("ambiguous notification = %q, want delivery-not-confirmed wording", timeoutNotificationBody)
	}
	timeoutIssues, err := automationRepo.ListRuntimeIssues(ctx, automationManager, 50, 0)
	if err != nil {
		t.Fatal(err)
	}
	timeoutIssueFound := false
	for _, issue := range timeoutIssues.Issues {
		if issue.ID == timeoutEffect.dispatchID {
			timeoutIssueFound = issue.Kind == "ambiguous_effect" && !issue.Retryable
		}
	}
	if !timeoutIssueFound {
		t.Fatalf("ambiguous delivery missing from non-retryable runtime issues: %#v", timeoutIssues.Issues)
	}
	if err := automationRepo.RetryRuntimeIssue(ctx, automationManager, "failed_effect", timeoutEffect.dispatchID); !errors.Is(err, automationspkg.ErrRuntimeIssueNotRetryable) {
		t.Fatalf("ambiguous effect retry error = %v, want not retryable", err)
	}
	repo.functions.httpClient.Timeout = time.Second
	if err := repo.ProcessWhatsAppOutbox(ctx); err != nil {
		t.Fatalf("terminal ambiguous ProcessWhatsAppOutbox() returned error: %v", err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select status from public.whatsapp_outbox
		where organization_id = $1::uuid and client_message_id = $2
	`, organizationID, timeoutClientID).Scan(&timeoutStatus); err != nil {
		t.Fatal(err)
	}
	if timeoutStatus != "dead" {
		t.Fatalf("ambiguous timeout was automatically retried: status = %q", timeoutStatus)
	}
	providerIDsMu.Lock()
	timeoutIDs := make([]string, 0, 2)
	for _, id := range providerIDs {
		if id == timeoutProviderID {
			timeoutIDs = append(timeoutIDs, id)
		}
	}
	providerIDsMu.Unlock()
	if len(timeoutIDs) != 1 || timeoutIDs[0] != timeoutProviderID {
		t.Fatalf("ambiguous provider IDs = %#v, want one deterministic attempt only", timeoutIDs)
	}
	if _, err := repo.claimWhatsAppOutbox(ctx); err != nil {
		t.Fatal(err)
	}
	var repeatedTimeoutCompletedAt time.Time
	var timeoutNotificationCount int
	if err := postgres.Pool().QueryRow(ctx, `
		select completed_at from public.automation_effect_dispatches where id = $1::uuid
	`, timeoutEffect.dispatchID).Scan(&repeatedTimeoutCompletedAt); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer from public.notifications
		where organization_id = $1::uuid and metadata->>'outbox_id' = $2
	`, organizationID, timeoutEffect.outboxID).Scan(&timeoutNotificationCount); err != nil {
		t.Fatal(err)
	}
	if !repeatedTimeoutCompletedAt.Equal(timeoutCompletedAt) || timeoutNotificationCount != 1 {
		t.Fatalf("ambiguous terminal sync was not idempotent: completed %v/%v notifications=%d", timeoutCompletedAt, repeatedTimeoutCompletedAt, timeoutNotificationCount)
	}
	lateAckAt := time.Now().UTC()
	lateAckTx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := reconcileNativeOutboundOutbox(ctx, lateAckTx, nativeEvolutionSession{
		ID: sessionID, OrganizationID: organizationID,
	}, nativeEvolutionMessage{
		ProviderMessageID: timeoutProviderID,
		FromMe:            true,
		SentAt:            lateAckAt,
	}, timeoutEffect.messageID); err != nil {
		_ = lateAckTx.Rollback(ctx)
		t.Fatal(err)
	}
	if err := lateAckTx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var timeoutMessageStatus string
	if err := postgres.Pool().QueryRow(ctx, `
		select outbox.status, message.status, dispatch.status
		from public.whatsapp_outbox outbox
		join public.whatsapp_messages message on message.id = outbox.message_id
		join public.automation_effect_dispatches dispatch on dispatch.id = $3::uuid
		where outbox.id = $1::uuid and outbox.organization_id = $2::uuid
	`, timeoutEffect.outboxID, organizationID, timeoutEffect.dispatchID).Scan(&timeoutStatus, &timeoutMessageStatus, &timeoutEffectStatus); err != nil {
		t.Fatal(err)
	}
	if timeoutStatus != "sent" || timeoutMessageStatus != "sent" || timeoutEffectStatus != "succeeded" {
		t.Fatalf("late signed acknowledgement did not heal ambiguous delivery: %s/%s/%s", timeoutStatus, timeoutMessageStatus, timeoutEffectStatus)
	}

	// A signed provider receipt that definitively rejects an already acknowledged
	// send must project the terminal state before its transaction commits. There
	// must be no window where the outbox is failed but the automation still looks
	// successful to operators.
	receiptFailureClientID := "automation-receipt-failure-" + suffix
	receiptFailureProviderID := deterministicProviderMessageID(receiptFailureClientID)
	if _, err := repo.SendMessage(ctx, tenantContext, conversationID, sendMessageInput{
		Text:            "provider receipt failure",
		ClientMessageID: receiptFailureClientID,
	}); err != nil {
		t.Fatal(err)
	}
	receiptFailureEffect := attachAutomationEffect(receiptFailureClientID, "receipt-failure-terminal")
	if err := repo.ProcessWhatsAppOutbox(ctx); err != nil {
		t.Fatal(err)
	}
	var receiptOutboxStatus, receiptMessageStatus, receiptEffectStatus, receiptTimelineType string
	if err := postgres.Pool().QueryRow(ctx, `
		select outbox.status, message.status, dispatch.status, timeline.event_type
		from public.whatsapp_outbox outbox
		join public.whatsapp_messages message on message.id = outbox.message_id
		join public.automation_effect_dispatches dispatch on dispatch.id = $3::uuid
		join public.lead_timeline_events timeline
		  on timeline.organization_id = outbox.organization_id
		 and timeline.metadata->>'outbox_id' = outbox.id::text
		where outbox.id = $1::uuid and outbox.organization_id = $2::uuid
	`, receiptFailureEffect.outboxID, organizationID, receiptFailureEffect.dispatchID).Scan(
		&receiptOutboxStatus, &receiptMessageStatus, &receiptEffectStatus, &receiptTimelineType,
	); err != nil {
		t.Fatal(err)
	}
	if receiptOutboxStatus != "sent" || receiptMessageStatus != "sent" || receiptEffectStatus != "succeeded" || receiptTimelineType != "whatsapp_message_sent" {
		t.Fatalf("provider receipt precondition = %s/%s/%s/%s", receiptOutboxStatus, receiptMessageStatus, receiptEffectStatus, receiptTimelineType)
	}
	receiptFailurePayload := []byte(fmt.Sprintf(`{
		"event":"messages.status",
		"data":{"statuses":[{
			"messageIds":[%q],
			"status":"failed",
			"error":"provider rejected the message",
			"timestamp":%d
		}]}
	}`, receiptFailureProviderID, time.Now().UTC().Unix()))
	handled, err := repo.processEvolutionWebhookNative(ctx, pendingEvolutionWebhook{
		OrganizationID: organizationID,
		SessionID:      sessionID,
		EventType:      "messages.status",
		Payload:        receiptFailurePayload,
	})
	if err != nil || !handled {
		t.Fatalf("native failed receipt = handled:%v error:%v", handled, err)
	}
	var receiptNotificationCount int
	if err := postgres.Pool().QueryRow(ctx, `
		select outbox.status, message.status, dispatch.status, timeline.event_type
		from public.whatsapp_outbox outbox
		join public.whatsapp_messages message on message.id = outbox.message_id
		join public.automation_effect_dispatches dispatch on dispatch.id = $3::uuid
		join public.lead_timeline_events timeline
		  on timeline.organization_id = outbox.organization_id
		 and timeline.metadata->>'outbox_id' = outbox.id::text
		where outbox.id = $1::uuid and outbox.organization_id = $2::uuid
	`, receiptFailureEffect.outboxID, organizationID, receiptFailureEffect.dispatchID).Scan(
		&receiptOutboxStatus, &receiptMessageStatus, &receiptEffectStatus, &receiptTimelineType,
	); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer
		from public.notifications
		where organization_id = $1::uuid
		  and metadata->>'outbox_id' = $2
	`, organizationID, receiptFailureEffect.outboxID).Scan(&receiptNotificationCount); err != nil {
		t.Fatal(err)
	}
	if receiptOutboxStatus != "failed" || receiptMessageStatus != "failed" || receiptEffectStatus != "failed" || receiptTimelineType != "whatsapp_message_failed" || receiptNotificationCount != 1 {
		t.Fatalf("atomic failed receipt projection = %s/%s/%s/%s notifications=%d", receiptOutboxStatus, receiptMessageStatus, receiptEffectStatus, receiptTimelineType, receiptNotificationCount)
	}

	// A definitive pre-provider failure may be safely requeued by an automation
	// manager, and every related state must move atomically with the outbox.
	knownFailureClientID := "automation-known-failure-" + suffix
	if _, err := repo.SendMessage(ctx, tenantContext, conversationID, sendMessageInput{Text: "known pre-provider failure", ClientMessageID: knownFailureClientID}); err != nil {
		t.Fatal(err)
	}
	knownFailureEffect := attachAutomationEffect(knownFailureClientID, "known-terminal")
	if _, err := postgres.Pool().Exec(ctx, `update public.whatsapp_sessions set is_active = false where id = $1::uuid`, sessionID); err != nil {
		t.Fatal(err)
	}
	if err := repo.ProcessWhatsAppOutbox(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `update public.whatsapp_sessions set is_active = true where id = $1::uuid`, sessionID); err != nil {
		t.Fatal(err)
	}
	var knownOutboxStatus, knownMessageStatus, knownEffectStatus, knownTimelineType string
	if err := postgres.Pool().QueryRow(ctx, `
		select outbox.status, message.status, dispatch.status, timeline.event_type
		from public.whatsapp_outbox outbox
		join public.whatsapp_messages message on message.id = outbox.message_id
		join public.automation_effect_dispatches dispatch on dispatch.id = $3::uuid
		join public.lead_timeline_events timeline
		  on timeline.organization_id = outbox.organization_id
		 and timeline.metadata->>'outbox_id' = outbox.id::text
		where outbox.id = $1::uuid and outbox.organization_id = $2::uuid
	`, knownFailureEffect.outboxID, organizationID, knownFailureEffect.dispatchID).Scan(
		&knownOutboxStatus, &knownMessageStatus, &knownEffectStatus, &knownTimelineType,
	); err != nil {
		t.Fatal(err)
	}
	if knownOutboxStatus != "failed" || knownMessageStatus != "failed" || knownEffectStatus != "failed" || knownTimelineType != "whatsapp_message_failed" {
		t.Fatalf("known terminal projection = %s/%s/%s/%s", knownOutboxStatus, knownMessageStatus, knownEffectStatus, knownTimelineType)
	}
	knownIssues, err := automationRepo.ListRuntimeIssues(ctx, automationManager, 50, 0)
	if err != nil {
		t.Fatal(err)
	}
	knownIssueRetryable := false
	for _, issue := range knownIssues.Issues {
		if issue.ID == knownFailureEffect.dispatchID {
			knownIssueRetryable = issue.Kind == "failed_effect" && issue.Retryable
		}
	}
	if !knownIssueRetryable {
		t.Fatalf("definitive delivery failure missing from retryable runtime issues: %#v", knownIssues.Issues)
	}
	if err := automationRepo.RetryRuntimeIssue(ctx, automationManager, "failed_effect", knownFailureEffect.dispatchID); err != nil {
		t.Fatalf("definitive failed effect retry: %v", err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select outbox.status, message.status, dispatch.status, timeline.event_type
		from public.whatsapp_outbox outbox
		join public.whatsapp_messages message on message.id = outbox.message_id
		join public.automation_effect_dispatches dispatch on dispatch.id = $3::uuid
		join public.lead_timeline_events timeline
		  on timeline.organization_id = outbox.organization_id
		 and timeline.metadata->>'outbox_id' = outbox.id::text
		where outbox.id = $1::uuid and outbox.organization_id = $2::uuid
	`, knownFailureEffect.outboxID, organizationID, knownFailureEffect.dispatchID).Scan(
		&knownOutboxStatus, &knownMessageStatus, &knownEffectStatus, &knownTimelineType,
	); err != nil {
		t.Fatal(err)
	}
	if knownOutboxStatus != "pending" || knownMessageStatus != "queued" || knownEffectStatus != "succeeded" || knownTimelineType != "whatsapp_message_queued" {
		t.Fatalf("known failure atomic retry state = %s/%s/%s/%s", knownOutboxStatus, knownMessageStatus, knownEffectStatus, knownTimelineType)
	}
	if err := repo.ProcessWhatsAppOutbox(ctx); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select outbox.status, message.status, dispatch.status
		from public.whatsapp_outbox outbox
		join public.whatsapp_messages message on message.id = outbox.message_id
		join public.automation_effect_dispatches dispatch on dispatch.id = $3::uuid
		where outbox.id = $1::uuid and outbox.organization_id = $2::uuid
	`, knownFailureEffect.outboxID, organizationID, knownFailureEffect.dispatchID).Scan(
		&knownOutboxStatus, &knownMessageStatus, &knownEffectStatus,
	); err != nil {
		t.Fatal(err)
	}
	if knownOutboxStatus != "sent" || knownMessageStatus != "sent" || knownEffectStatus != "succeeded" {
		t.Fatalf("known failure retry acknowledgement = %s/%s/%s", knownOutboxStatus, knownMessageStatus, knownEffectStatus)
	}

	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.whatsapp_messages (
			organization_id, session_id, conversation_id, lead_id, message_id,
			from_me, direction, content, message_type, status, sent_at
		) values (
			$1::uuid, null, $2::uuid, $3::uuid, 'legacy-null-session',
			false, 'inbound', 'legacy history fixture', 'text', 'received',
			'2100-01-01T00:00:00Z'::timestamptz
		)
	`, organizationID, conversationID, leadID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.whatsapp_messages (
			organization_id, session_id, conversation_id, lead_id, message_id,
			from_me, direction, content, message_type, status, sent_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid, 'legacy-mismatched-session',
			false, 'inbound', 'legacy mismatched history fixture', 'text', 'received',
			'2080-01-01T00:00:00Z'::timestamptz
		)
	`, organizationID, legacySessionID, conversationID, leadID); err != nil {
		t.Fatal(err)
	}
	legacyCrossOrgTx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := legacyCrossOrgTx.Exec(ctx, `set local session_replication_role = replica`); err != nil {
		_ = legacyCrossOrgTx.Rollback(ctx)
		t.Fatal(err)
	}
	if _, err := legacyCrossOrgTx.Exec(ctx, `
		insert into public.whatsapp_messages (
			organization_id, session_id, conversation_id, lead_id, message_id,
			from_me, direction, content, message_type, status, sent_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid, 'legacy-cross-org-session',
			false, 'inbound', 'legacy cross-organization session fixture', 'text', 'received',
			'2070-01-01T00:00:00Z'::timestamptz
		)
	`, organizationID, foreignHistorySessionID, conversationID, leadID); err != nil {
		_ = legacyCrossOrgTx.Rollback(ctx)
		t.Fatal(err)
	}
	if err := legacyCrossOrgTx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	legacyHistory, err := repo.ListMessages(ctx, tenantContext, conversationID, MessageFilter{Limit: 50})
	if err != nil {
		t.Fatalf("ListMessages() legacy compatibility error = %v", err)
	}
	legacySessionsRestored := map[string]bool{}
	for _, message := range legacyHistory.Messages {
		if message.MessageID == "legacy-null-session" || message.MessageID == "legacy-mismatched-session" || message.MessageID == "legacy-cross-org-session" {
			legacySessionsRestored[message.MessageID] = pointerValue(message.SessionID) == sessionID
		}
	}
	if !legacySessionsRestored["legacy-null-session"] || !legacySessionsRestored["legacy-mismatched-session"] || !legacySessionsRestored["legacy-cross-org-session"] {
		t.Fatalf("legacy history session normalization = %#v, want authorized conversation session %s", legacySessionsRestored, sessionID)
	}
	leadLegacyHistory, err := repo.GetHistoryAccess(ctx, tenantContext, HistoryAccessFilter{
		LeadID:        leadID,
		MessageFilter: MessageFilter{Limit: 50},
	})
	if err != nil {
		t.Fatalf("GetHistoryAccess() legacy compatibility error = %v", err)
	}
	leadLegacySessionsRestored := map[string]string{}
	for _, message := range leadLegacyHistory.Messages {
		if message.MessageID == "legacy-null-session" || message.MessageID == "legacy-mismatched-session" || message.MessageID == "legacy-cross-org-session" {
			leadLegacySessionsRestored[message.MessageID] = pointerValue(message.SessionID)
		}
	}
	if leadLegacySessionsRestored["legacy-null-session"] != "" ||
		leadLegacySessionsRestored["legacy-mismatched-session"] != legacySessionID ||
		leadLegacySessionsRestored["legacy-cross-org-session"] != "" {
		t.Fatalf("lead history session attribution = %#v, want unknown null session and immutable session %s", leadLegacySessionsRestored, legacySessionID)
	}

	// Cursor pagination must not skip messages that share the exact same
	// timestamp. The UUID tie-breaker is part of the opaque cursor.
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.whatsapp_messages (
			organization_id, session_id, conversation_id, lead_id, message_id,
			client_message_id, from_me, direction, content, message_type, status, sent_at
		)
		select $1::uuid, $2::uuid, $3::uuid, $4::uuid,
		       'pagination-' || fixture::text, 'pagination-client-' || fixture::text,
		       false, 'inbound', 'pagination fixture ' || fixture::text,
		       'text', 'received', '2099-01-01T00:00:00Z'::timestamptz
		from generate_series(1, 3) as fixture
	`, organizationID, sessionID, conversationID, leadID); err != nil {
		t.Fatal(err)
	}
	firstPage, err := repo.ListMessages(ctx, tenantContext, conversationID, MessageFilter{Limit: 2})
	if err != nil {
		t.Fatalf("ListMessages() first page error = %v", err)
	}
	if firstPage.NextCursor == nil {
		t.Fatal("ListMessages() first page is missing next cursor")
	}
	legacySessionRestored := false
	for _, message := range firstPage.Messages {
		if message.MessageID == "legacy-null-session" {
			legacySessionRestored = pointerValue(message.SessionID) == sessionID
		}
	}
	if !legacySessionRestored {
		t.Fatal("legacy message with null session did not inherit its authorized conversation session")
	}
	secondFilter, err := ParseMessageFilter(url.Values{
		"limit":  {"2"},
		"cursor": {*firstPage.NextCursor},
	})
	if err != nil {
		t.Fatalf("ParseMessageFilter(next cursor) error = %v", err)
	}
	secondPage, err := repo.ListMessages(ctx, tenantContext, conversationID, secondFilter)
	if err != nil {
		t.Fatalf("ListMessages() second page error = %v", err)
	}
	fixtureIDs := map[string]bool{}
	for _, message := range append(firstPage.Messages, secondPage.Messages...) {
		if len(message.MessageID) >= len("pagination-") && message.MessageID[:len("pagination-")] == "pagination-" {
			fixtureIDs[message.MessageID] = true
		}
	}
	if len(fixtureIDs) != 3 {
		t.Fatalf("cursor pagination returned fixture IDs %#v, want all 3", fixtureIDs)
	}

	// Lead history must cross the former 500-message ceiling without loading
	// the whole thread in a single response.
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.whatsapp_messages (
			organization_id, session_id, conversation_id, lead_id, message_id,
			from_me, direction, content, message_type, status, sent_at
		)
		select $1::uuid, $2::uuid, $3::uuid, $4::uuid,
		       'lead-history-page-' || fixture::text,
		       false, 'inbound', 'lead history page ' || fixture::text,
		       'text', 'received',
		       '2098-01-01T00:00:00Z'::timestamptz + fixture * interval '1 second'
		from generate_series(1, 520) as fixture
	`, organizationID, sessionID, conversationID, leadID); err != nil {
		t.Fatal(err)
	}

	historyMessageIDs := map[string]bool{}
	var historyCursor string
	for pageNumber := 0; pageNumber < 20; pageNumber++ {
		values := url.Values{
			"leadId": {leadID},
			"limit":  {"73"},
		}
		if historyCursor != "" {
			values.Set("cursor", historyCursor)
		}
		filter, err := ParseHistoryAccessFilter(values)
		if err != nil {
			t.Fatal(err)
		}
		page, err := repo.GetHistoryAccess(ctx, tenantContext, filter)
		if err != nil {
			t.Fatalf("GetHistoryAccess() page %d error = %v", pageNumber, err)
		}
		if len(page.Messages) > 73 {
			t.Fatalf("history page %d returned %d messages", pageNumber, len(page.Messages))
		}
		for _, message := range page.Messages {
			if strings.HasPrefix(message.MessageID, "lead-history-page-") {
				historyMessageIDs[message.MessageID] = true
			}
		}
		if page.NextCursor == nil {
			break
		}
		historyCursor = *page.NextCursor
	}
	if len(historyMessageIDs) != 520 {
		t.Fatalf("paginated lead history returned %d/520 fixtures", len(historyMessageIDs))
	}

	payload := []byte(`{"event":"MESSAGE","instanceToken":"provider-secret","data":{"instanceId":"` + suffix + `","message":{"id":"provider-inbound-1"}}}`)
	webhookRoute := url.Values{"session_id": []string{sessionID}, "instance_id": []string{suffix}}
	if err := repo.AuthorizeEvolutionWebhookRoute(ctx, webhookRoute, http.Header{}); err != nil {
		t.Fatalf("token-free backend route authorization error = %v", err)
	}
	if err := repo.AuthorizeEvolutionWebhookRoute(ctx, webhookRoute, http.Header{"X-Webhook-Token": []string{"wrong-secret"}}); !errors.Is(err, errWebhookUnauthorized) {
		t.Fatalf("wrong legacy route token error = %v, want unauthorized", err)
	}
	wrongInstanceRoute := url.Values{"session_id": []string{sessionID}, "instance_id": []string{"wrong-instance"}}
	if err := repo.AuthorizeEvolutionWebhookRoute(ctx, wrongInstanceRoute, http.Header{}); !errors.Is(err, errWebhookSessionMismatch) {
		t.Fatalf("wrong route instance error = %v, want mismatch", err)
	}
	wrongBodyEnvelope, err := parseEvolutionWebhookEnvelope(
		webhookRoute,
		http.Header{},
		[]byte(strings.Replace(string(payload), `"provider-secret"`, `"wrong-provider-secret"`, 1)),
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AcceptEvolutionWebhook(ctx, wrongBodyEnvelope); !errors.Is(err, errWebhookUnauthorized) {
		t.Fatalf("wrong body instanceToken error = %v, want unauthorized", err)
	}
	envelope, err := parseEvolutionWebhookEnvelope(
		webhookRoute,
		http.Header{"X-Webhook-Token": []string{"webhook-secret"}},
		payload,
	)
	if err != nil {
		t.Fatal(err)
	}
	firstReceipt, err := repo.AcceptEvolutionWebhook(ctx, envelope)
	if err != nil {
		t.Fatalf("AcceptEvolutionWebhook() returned error: %v", err)
	}
	secondReceipt, err := repo.AcceptEvolutionWebhook(ctx, envelope)
	if err != nil {
		t.Fatalf("duplicate AcceptEvolutionWebhook() returned error: %v", err)
	}
	if firstReceipt.ID != secondReceipt.ID || !secondReceipt.Duplicate {
		t.Fatalf("duplicate receipts = %#v / %#v", firstReceipt, secondReceipt)
	}
	claimedWebhooks, err := repo.claimEvolutionWebhooks(ctx)
	if err != nil {
		t.Fatalf("claimEvolutionWebhooks() returned error: %v", err)
	}
	if len(claimedWebhooks) != 1 || claimedWebhooks[0].ID != firstReceipt.ID {
		t.Fatalf("claimEvolutionWebhooks() = %#v, want receipt %s", claimedWebhooks, firstReceipt.ID)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set locked_at = now() - interval '4 minutes'
		where id = $1::uuid
	`, firstReceipt.ID); err != nil {
		t.Fatal(err)
	}
	webhookLeaseOwned, err := repo.renewEvolutionWebhookLease(ctx, firstReceipt.ID)
	if err != nil || !webhookLeaseOwned {
		t.Fatalf("renewEvolutionWebhookLease() = %v, %v; want owned lease", webhookLeaseOwned, err)
	}
	var webhookLeaseFresh bool
	if err := postgres.Pool().QueryRow(ctx, `
		select locked_at > now() - interval '5 seconds'
		from public.whatsapp_webhook_inbox
		where id = $1::uuid
	`, firstReceipt.ID).Scan(&webhookLeaseFresh); err != nil {
		t.Fatal(err)
	}
	if !webhookLeaseFresh {
		t.Fatal("webhook lease renewal did not refresh locked_at")
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set status = 'pending', attempts = 0, locked_at = null, locked_by = null
		where id = $1::uuid
	`, firstReceipt.ID); err != nil {
		t.Fatal(err)
	}
	if err := repo.ProcessWebhookInbox(ctx); err != nil {
		t.Fatalf("ProcessWebhookInbox() returned error: %v", err)
	}
	if edgeCalls.Load() != 1 {
		t.Fatalf("edge forward calls = %d, want 1", edgeCalls.Load())
	}
	var inboxStatus string
	if err := postgres.Pool().QueryRow(ctx, `select status from public.whatsapp_webhook_inbox where id = $1::uuid`, firstReceipt.ID).Scan(&inboxStatus); err != nil {
		t.Fatal(err)
	}
	if inboxStatus != "processed" {
		t.Fatalf("inbox status = %q, want processed", inboxStatus)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set expires_at = now() - interval '1 second'
		where id = $1::uuid
	`, firstReceipt.ID); err != nil {
		t.Fatal(err)
	}
	deletedInboxRows, err := repo.CleanupExpiredWebhookInbox(ctx, 100)
	if err != nil {
		t.Fatalf("CleanupExpiredWebhookInbox() returned error: %v", err)
	}
	if deletedInboxRows != 1 {
		t.Fatalf("CleanupExpiredWebhookInbox() deleted %d rows, want 1", deletedInboxRows)
	}
	var inboxStillExists bool
	if err := postgres.Pool().QueryRow(ctx, `
		select exists (
			select 1 from public.whatsapp_webhook_inbox where id = $1::uuid
		)
	`, firstReceipt.ID).Scan(&inboxStillExists); err != nil {
		t.Fatal(err)
	}
	if inboxStillExists {
		t.Fatal("expired processed webhook inbox row still exists after cleanup")
	}

	var deadMessageInboxID, deadReceiptInboxID, deadMessageStatusInboxID, deadMessageAckInboxID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_webhook_inbox (
			organization_id, session_id, event_key, event_type, payload,
			status, attempts, dead_lettered_at, expires_at
		) values (
			$1::uuid, $2::uuid, $3, 'message', '{}'::jsonb,
			'dead', 12, now() - interval '25 hours', now() - interval '1 second'
		)
		returning id::text
	`, organizationID, sessionID, "dead-message-"+suffix).Scan(&deadMessageInboxID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_webhook_inbox (
			organization_id, session_id, event_key, event_type, payload,
			status, attempts, dead_lettered_at, expires_at
		) values (
			$1::uuid, $2::uuid, $3, 'receipt', '{}'::jsonb,
			'dead', 12, now() - interval '25 hours', now() - interval '1 second'
		)
		returning id::text
	`, organizationID, sessionID, "dead-receipt-"+suffix).Scan(&deadReceiptInboxID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_webhook_inbox (
			organization_id, session_id, event_key, event_type, payload,
			status, attempts, dead_lettered_at, expires_at
		) values (
			$1::uuid, $2::uuid, $3, 'messages.status', '{}'::jsonb,
			'dead', 12, now() - interval '25 hours', now() - interval '1 second'
		)
		returning id::text
	`, organizationID, sessionID, "dead-message-status-"+suffix).Scan(&deadMessageStatusInboxID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_webhook_inbox (
			organization_id, session_id, event_key, event_type, payload,
			status, attempts, dead_lettered_at, expires_at
		) values (
			$1::uuid, $2::uuid, $3, 'message_ack', '{}'::jsonb,
			'dead', 12, now() - interval '25 hours', now() - interval '1 second'
		)
		returning id::text
	`, organizationID, sessionID, "dead-message-ack-"+suffix).Scan(&deadMessageAckInboxID); err != nil {
		t.Fatal(err)
	}
	deletedInboxRows, err = repo.CleanupExpiredWebhookInbox(ctx, 100)
	if err != nil {
		t.Fatalf("CleanupExpiredWebhookInbox() dead-letter error: %v", err)
	}
	if deletedInboxRows != 3 {
		t.Fatalf("CleanupExpiredWebhookInbox() deleted %d dead rows, want receipt/status/ack", deletedInboxRows)
	}
	var deadMessageExists, deadReceiptExists, deadMessageStatusExists, deadMessageAckExists bool
	if err := postgres.Pool().QueryRow(ctx, `
		select
			exists(select 1 from public.whatsapp_webhook_inbox where id = $1::uuid),
			exists(select 1 from public.whatsapp_webhook_inbox where id = $2::uuid),
			exists(select 1 from public.whatsapp_webhook_inbox where id = $3::uuid),
			exists(select 1 from public.whatsapp_webhook_inbox where id = $4::uuid)
	`, deadMessageInboxID, deadReceiptInboxID, deadMessageStatusInboxID, deadMessageAckInboxID).Scan(
		&deadMessageExists,
		&deadReceiptExists,
		&deadMessageStatusExists,
		&deadMessageAckExists,
	); err != nil {
		t.Fatal(err)
	}
	if !deadMessageExists || deadReceiptExists || deadMessageStatusExists || deadMessageAckExists {
		t.Fatalf(
			"dead cleanup preservation = message:%v receipt:%v message_status:%v message_ack:%v, want true/false/false/false",
			deadMessageExists,
			deadReceiptExists,
			deadMessageStatusExists,
			deadMessageAckExists,
		)
	}

	cleanupSuccessID := "cleanup-success-" + suffix
	cleanupFailureID := "cleanup-failure-" + suffix
	if _, err := postgres.Pool().Exec(ctx, `
		with cleanup_messages as (
			insert into public.whatsapp_messages (
				organization_id, session_id, conversation_id, lead_id, message_id,
				from_me, direction, content, message_type, status, sent_at, remote_jid
			) values
				($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, true, 'outbound', 'old success', 'text', 'sent', now() - interval '91 days', '5511999991111@s.whatsapp.net'),
				($1::uuid, $2::uuid, $3::uuid, $4::uuid, $6, true, 'outbound', 'old failure', 'text', 'failed', now() - interval '181 days', '5511999991111@s.whatsapp.net')
			returning id, message_id
		)
		insert into public.whatsapp_outbox (
			organization_id, session_id, conversation_id, message_id,
			client_message_id, recipient_jid, message_type, payload, status,
			failed_at, created_at, updated_at
		)
		select
			$1::uuid, $2::uuid, $3::uuid, cleanup_messages.id,
			cleanup_messages.message_id, '5511999991111@s.whatsapp.net', 'text', '{}'::jsonb,
			case when cleanup_messages.message_id = $5 then 'sent' else 'failed' end,
			case when cleanup_messages.message_id = $6 then now() - interval '181 days' else null end,
			case when cleanup_messages.message_id = $5 then now() - interval '91 days' else now() - interval '181 days' end,
			case when cleanup_messages.message_id = $5 then now() - interval '91 days' else now() - interval '181 days' end
		from cleanup_messages
	`, organizationID, sessionID, conversationID, leadID, cleanupSuccessID, cleanupFailureID); err != nil {
		t.Fatal(err)
	}
	deletedOutboxRows, err := repo.CleanupTerminalWhatsAppOutbox(ctx, 100)
	if err != nil {
		t.Fatalf("CleanupTerminalWhatsAppOutbox() returned error: %v", err)
	}
	if deletedOutboxRows != 2 {
		t.Fatalf("CleanupTerminalWhatsAppOutbox() deleted %d rows, want one old success and one old failure", deletedOutboxRows)
	}
	var retainedRecentOutbox, deletedOldSuccess, deletedOldFailure bool
	if err := postgres.Pool().QueryRow(ctx, `
		select
		  exists(select 1 from public.whatsapp_outbox where organization_id = $1::uuid and client_message_id = $2),
		  not exists(select 1 from public.whatsapp_outbox where organization_id = $1::uuid and client_message_id = $3),
		  not exists(select 1 from public.whatsapp_outbox where organization_id = $1::uuid and client_message_id = $4)
	`, organizationID, timeoutClientID, cleanupSuccessID, cleanupFailureID).Scan(
		&retainedRecentOutbox,
		&deletedOldSuccess,
		&deletedOldFailure,
	); err != nil {
		t.Fatal(err)
	}
	if !retainedRecentOutbox || !deletedOldSuccess || !deletedOldFailure {
		t.Fatalf("outbox retention result = recent:%v old-success:%v old-failure:%v", retainedRecentOutbox, deletedOldSuccess, deletedOldFailure)
	}
}
