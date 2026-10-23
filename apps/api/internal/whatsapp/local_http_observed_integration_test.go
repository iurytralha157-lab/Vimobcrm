package whatsapp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// This opt-in fixture exercises real HTTP handlers and the native durable
// worker against a disposable loopback database. It never calls a provider.
func TestLocalHTTPObservedWhatsAppDelivery(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}
	nativeFixture := os.Getenv("VIMOB_LOCAL_WHATSAPP_CLONE_VERIFIED") == nativeOutboundMarker && localVerifiedOutboundCloneURL() != ""
	if nativeFixture {
		databaseURL = localVerifiedOutboundCloneURL()
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	host := net.ParseIP(target.Hostname())
	if target.Hostname() != "localhost" && (host == nil || !host.IsLoopback()) {
		t.Fatal("HTTP observed fixture requires a disposable loopback database")
	}
	if target.Port() != "57325" && !nativeFixture {
		t.Fatal("HTTP observed fixture requires the disposable WhatsApp clone port")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)
	if nativeFixture {
		verifyNativeOutboundCluster(t, ctx, postgres.Pool())
	}

	suffix := fmt.Sprintf("wa-http-observed-%d", time.Now().UnixNano())
	contactPhone := fmt.Sprintf("55119%08d", time.Now().UnixNano()%100_000_000)
	ownerPhone := "55118888" + fmt.Sprintf("%05d", time.Now().UnixNano()%100_000)
	var organizationID, ownerID, sessionID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.organizations (name, slug)
		values ($1, $1) returning id::text
	`, suffix).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		for _, statement := range []string{
			`delete from public.whatsapp_messages where organization_id = $1::uuid`,
			`delete from public.whatsapp_conversations where organization_id = $1::uuid`,
			`delete from public.whatsapp_conversation_lead_bindings where organization_id = $1::uuid`,
			`delete from public.whatsapp_sessions where organization_id = $1::uuid`,
			`delete from public.leads where organization_id = $1::uuid`,
			`delete from public.organization_members where organization_id = $1::uuid`,
		} {
			if _, err := postgres.Pool().Exec(cleanupCtx, statement, organizationID); err != nil {
				t.Errorf("delete synthetic WhatsApp fixture: %v", err)
			}
		}
		if ownerID != "" {
			if _, err := postgres.Pool().Exec(cleanupCtx,
				`delete from public.users where id = $1::uuid`, ownerID); err != nil {
				t.Errorf("delete synthetic public user: %v", err)
			}
		}
		if _, err := postgres.Pool().Exec(cleanupCtx,
			`delete from public.organizations where id = $1::uuid`, organizationID); err != nil {
			t.Errorf("delete synthetic organization: %v", err)
		}
		if ownerID != "" {
			if _, err := postgres.Pool().Exec(cleanupCtx,
				`delete from auth.users where id = $1::uuid`, ownerID); err != nil {
				t.Errorf("delete synthetic auth user: %v", err)
			}
		}
	})
	if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&ownerID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into auth.users (
		  id, aud, role, email, encrypted_password, email_confirmed_at,
		  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values ($1::uuid, 'authenticated', 'authenticated', $2, '', now(),
		  '{}'::jsonb, '{}'::jsonb, now(), now())
	`, ownerID, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, $3, $4, 'admin', true)
		on conflict (id) do update set organization_id = excluded.organization_id,
		  name = excluded.name, email = excluded.email, role = excluded.role, is_active = excluded.is_active
	`, ownerID, organizationID, suffix, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'admin', true)
		on conflict (user_id, organization_id) do update
		set role = excluded.role, is_active = excluded.is_active
	`, organizationID, ownerID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_sessions (
		  organization_id, instance_name, instance_id, owner_user_id,
		  phone_number, provider, status, is_active, advanced_settings
		) values ($1::uuid, $2, $2, $3::uuid, $4, 'evolution_go',
		  'connected', true, '{"token":"synthetic-instance-secret","webhook_token":"synthetic-webhook-secret"}'::jsonb)
		returning id::text
	`, organizationID, suffix, ownerID, ownerPhone).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}
	// The disposable clone carries a preexisting private.cutoff_at NOT NULL
	// column that is absent from the repository migration. Insert the fixture
	// epoch explicitly; the activation function mismatch is reported separately.
	if _, err := postgres.Pool().Exec(ctx, `
		insert into private.whatsapp_webhook_session_cutovers
		  (session_id, cutoff_at, active_epoch, cutover_at, activated_at)
		values ($1::uuid, clock_timestamp(), 1, clock_timestamp(), clock_timestamp())
	`, sessionID); err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(postgres, nil, StorageConfig{})
	repo.functions.webhookProcessorMode = webhookProcessorNative
	repo.functions.webhookRolloutSessionIDs = []string{sessionID}
	handler := NewHandler(repo)
	actor := tenant.Context{
		OrganizationID: organizationID,
		UserID:         ownerID,
		UserRole:       "admin",
		MemberRole:     "admin",
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /webhook", handler.EvolutionGoWebhook)
	mux.HandleFunc("GET /conversations", func(w http.ResponseWriter, r *http.Request) {
		handler.ListConversations(w, r.WithContext(tenant.ContextWithTenant(r.Context(), actor)))
	})
	mux.HandleFunc("GET /unread", func(w http.ResponseWriter, r *http.Request) {
		handler.CountUnreadConversations(w, r.WithContext(tenant.ContextWithTenant(r.Context(), actor)))
	})
	mux.HandleFunc("GET /conversations/{id}/messages", func(w http.ResponseWriter, r *http.Request) {
		handler.ListMessages(w, r.WithContext(tenant.ContextWithTenant(r.Context(), actor)))
	})
	mux.HandleFunc("POST /conversations/{id}/send", func(w http.ResponseWriter, r *http.Request) {
		handler.SendMessage(w, r.WithContext(tenant.ContextWithTenant(r.Context(), actor)))
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	client := &http.Client{Timeout: 10 * time.Second}
	providerTimestamp := time.Now().Unix()

	postRawWebhook := func(body []byte) (evolutionWebhookReceipt, time.Duration) {
		t.Helper()
		endpoint := fmt.Sprintf("%s/webhook?session_id=%s&instance_id=%s",
			server.URL, url.QueryEscape(sessionID), url.QueryEscape(suffix))
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Webhook-Token", "synthetic-webhook-secret")
		started := time.Now()
		response, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		responseBody, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != http.StatusAccepted {
			envelope, parseErr := parseEvolutionWebhookEnvelope(request.URL.Query(), request.Header, body)
			if parseErr == nil {
				_, acceptErr := repo.AcceptEvolutionWebhook(ctx, envelope)
				t.Fatalf("webhook HTTP %d: %s; direct diagnostic: %v", response.StatusCode, responseBody, acceptErr)
			}
			t.Fatalf("webhook HTTP %d: %s; parse diagnostic: %v", response.StatusCode, responseBody, parseErr)
		}
		var receipt struct {
			Receipt evolutionWebhookReceipt `json:"receipt"`
		}
		if err := json.Unmarshal(responseBody, &receipt); err != nil {
			t.Fatal(err)
		}
		return receipt.Receipt, time.Since(started)
	}
	postWebhook := func(providerID, text string, fromMe bool) (evolutionWebhookReceipt, time.Duration) {
		t.Helper()
		info := map[string]any{
			"ID": providerID, "Chat": contactPhone + "@s.whatsapp.net",
			"IsFromMe": fromMe, "PushName": "Synthetic Contact",
			"Timestamp": providerTimestamp,
		}
		if fromMe {
			info["SenderPN"] = ownerPhone + "@s.whatsapp.net"
			info["RecipientPN"] = contactPhone + "@s.whatsapp.net"
		} else {
			info["SenderPN"] = contactPhone + "@s.whatsapp.net"
		}
		body, err := json.Marshal(map[string]any{
			"event":         "messages.upsert",
			"instanceId":    suffix,
			"instanceToken": "synthetic-instance-secret",
			"data": map[string]any{"messages": []any{map[string]any{
				"Info": info, "Message": map[string]any{"conversation": text},
			}}},
		})
		if err != nil {
			t.Fatal(err)
		}
		return postRawWebhook(body)
	}
	get := func(path string, target any) {
		t.Helper()
		response, err := client.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		body, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != http.StatusOK {
			t.Fatalf("GET %s HTTP %d: %s", path, response.StatusCode, body)
		}
		if err := json.Unmarshal(body, target); err != nil {
			t.Fatal(err)
		}
	}
	processOne := func(receipt evolutionWebhookReceipt) time.Duration {
		t.Helper()
		started := time.Now()
		stats, _, err := repo.processWebhookInboxLaneBatch(ctx, evolutionWebhookLaneLive, 1, 1, "")
		if err != nil {
			t.Fatal(err)
		}
		if stats.LiveClaimed != 1 {
			t.Fatalf("live worker claimed %d rows, want one", stats.LiveClaimed)
		}
		var state, lastError string
		if err := postgres.Pool().QueryRow(ctx,
			`select status, coalesce(last_error, '') from public.whatsapp_webhook_inbox where id = $1::uuid`, receipt.ID,
		).Scan(&state, &lastError); err != nil {
			t.Fatal(err)
		}
		if state != "processed" {
			t.Fatalf("durable inbox state = %q, want processed; failure = %q", state, lastError)
		}
		return time.Since(started)
	}

	inboundID := suffix + "-inbound"
	inboundReceipt, inboundACK := postWebhook(inboundID, "synthetic inbound", false)
	if inboundReceipt.Status != "pending" || inboundReceipt.Duplicate {
		t.Fatalf("inbound receipt = %#v", inboundReceipt)
	}
	var capturedPolicy string
	if err := postgres.Pool().QueryRow(ctx, `
		select coalesce(payload #>> '{__vimob_ingress,routing_snapshot,messages,0,unlinked_capture_policy}', '')
		from public.whatsapp_webhook_inbox where id = $1::uuid
	`, inboundReceipt.ID).Scan(&capturedPolicy); err != nil {
		t.Fatal(err)
	}
	if capturedPolicy != "v1" {
		t.Fatalf("ingress capture policy = %q, want v1", capturedPolicy)
	}
	inboundProcess := processOne(inboundReceipt)

	var conversationID, inboundState string
	var unread int
	if err := postgres.Pool().QueryRow(ctx, `
		select wc.id::text, wm.capture_state, wc.unread_count
		from public.whatsapp_messages wm
		join public.whatsapp_conversations wc on wc.id = wm.conversation_id
		where wm.organization_id = $1::uuid and wm.message_id = $2
	`, organizationID, inboundID).Scan(&conversationID, &inboundState, &unread); err != nil {
		t.Fatal(err)
	}
	if inboundState != "unlinked_ephemeral" || unread != 1 {
		t.Fatalf("inbound DB state = %q, unread %d", inboundState, unread)
	}
	var list Envelope[[]Conversation]
	get("/conversations?withoutLead=true", &list)
	if len(list.Data) != 1 || list.Data[0].ID != conversationID || list.Data[0].LeadID != nil {
		t.Fatalf("HTTP inbox = %#v", list.Data)
	}
	var count struct {
		Count int `json:"count"`
	}
	get("/unread?withoutLead=true", &count)
	if count.Count != 1 {
		t.Fatalf("HTTP unread count = %d", count.Count)
	}
	var messages Envelope[MessagePage]
	get("/conversations/"+conversationID+"/messages?expectedLeadId=unlinked", &messages)
	if len(messages.Data.Messages) != 1 || messages.Data.Messages[0].MessageID != inboundID {
		t.Fatalf("HTTP messages = %#v", messages.Data.Messages)
	}

	outboundID := suffix + "-external-outbound"
	outboundReceipt, outboundACK := postWebhook(outboundID, "synthetic external outbound", true)
	if outboundReceipt.Status != "pending" || outboundReceipt.Duplicate {
		t.Fatalf("external outbound receipt = %#v", outboundReceipt)
	}
	outboundProcess := processOne(outboundReceipt)
	get("/conversations/"+conversationID+"/messages?expectedLeadId=unlinked", &messages)
	outboundVisible := false
	for _, candidate := range messages.Data.Messages {
		if candidate.MessageID == outboundID && candidate.FromMe {
			outboundVisible = true
		}
	}
	if len(messages.Data.Messages) != 2 || !outboundVisible {
		t.Fatalf("HTTP history after external outbound = %#v", messages.Data.Messages)
	}
	get("/unread?withoutLead=true", &count)
	if count.Count != 1 {
		t.Fatalf("external outbound changed unread count to %d", count.Count)
	}

	// No CRM send is permitted for a conversation with no lead. The provider is
	// deliberately unconfigured; this call must be rejected before any outbox row.
	sendBody := []byte(`{"text":"must not send","expectedLeadId":"11111111-1111-4111-8111-111111111111"}`)
	sendRequest, err := http.NewRequestWithContext(ctx, http.MethodPost,
		server.URL+"/conversations/"+conversationID+"/send", bytes.NewReader(sendBody))
	if err != nil {
		t.Fatal(err)
	}
	sendRequest.Header.Set("Content-Type", "application/json")
	sendResponse, err := client.Do(sendRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer sendResponse.Body.Close()
	if sendResponse.StatusCode != http.StatusNotFound {
		body, _ := io.ReadAll(sendResponse.Body)
		t.Fatalf("unlinked CRM send HTTP %d, want 404: %s", sendResponse.StatusCode, body)
	}
	var outboxRows int
	if err := postgres.Pool().QueryRow(ctx,
		`select count(*) from public.whatsapp_outbox where organization_id = $1::uuid`, organizationID,
	).Scan(&outboxRows); err != nil {
		t.Fatal(err)
	}
	if outboxRows != 0 {
		t.Fatalf("unlinked CRM send queued %d outbox rows", outboxRows)
	}

	// Exact provider retry remains idempotent after the durable item completes.
	duplicate, _ := postWebhook(inboundID, "synthetic inbound", false)
	if !duplicate.Duplicate || duplicate.ID != inboundReceipt.ID {
		t.Fatalf("provider replay receipt = %#v", duplicate)
	}
	var messageRows int
	if err := postgres.Pool().QueryRow(ctx,
		`select count(*) from public.whatsapp_messages where organization_id = $1::uuid`, organizationID,
	).Scan(&messageRows); err != nil {
		t.Fatal(err)
	}
	if messageRows != 2 {
		t.Fatalf("provider replay left %d messages, want two", messageRows)
	}

	// A later lead intake starts a new conversation epoch. Its first inbound
	// message must be visible even before anyone joins attendance; the older
	// unlinked history stays separate until a person confirms a link.
	var leadID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.leads (organization_id, assigned_user_id, name, phone, source)
		values ($1::uuid, $2::uuid, $3, $4, 'manual') returning id::text
	`, organizationID, ownerID, suffix+"-lead", contactPhone).Scan(&leadID); err != nil {
		t.Fatal(err)
	}
	leadMessageID := suffix + "-lead-inbound"
	leadReceipt, leadACK := postWebhook(leadMessageID, "synthetic lead inbound", false)
	if leadReceipt.Status != "pending" || leadReceipt.Duplicate {
		t.Fatalf("lead inbound receipt = %#v", leadReceipt)
	}
	leadProcess := processOne(leadReceipt)
	var leadConversationID, leadState, attributedLeadID string
	if err := postgres.Pool().QueryRow(ctx, `
		select wm.conversation_id::text, wm.capture_state, wm.lead_id::text
		from public.whatsapp_messages wm
		where wm.organization_id = $1::uuid and wm.message_id = $2
	`, organizationID, leadMessageID).Scan(&leadConversationID, &leadState, &attributedLeadID); err != nil {
		t.Fatal(err)
	}
	if leadConversationID == conversationID || attributedLeadID != leadID || leadState != "observed_unattended" {
		t.Fatalf("lead intake epoch = conversation %s (old %s), lead %s, state %s",
			leadConversationID, conversationID, attributedLeadID, leadState)
	}
	var leadList Envelope[[]Conversation]
	get("/conversations?onlyLeads=true", &leadList)
	if len(leadList.Data) != 1 || leadList.Data[0].ID != leadConversationID ||
		leadList.Data[0].LeadID == nil || *leadList.Data[0].LeadID != leadID {
		t.Fatalf("HTTP lead inbox = %#v", leadList.Data)
	}
	get("/conversations/"+leadConversationID+"/messages?expectedLeadId="+leadID, &messages)
	if len(messages.Data.Messages) != 1 || messages.Data.Messages[0].MessageID != leadMessageID {
		t.Fatalf("HTTP lead history before attendance = %#v", messages.Data.Messages)
	}
	get("/conversations?withoutLead=true", &list)
	if len(list.Data) != 1 || list.Data[0].ID != conversationID {
		t.Fatalf("retained old unlinked history = %#v", list.Data)
	}
	leadSendBody, err := json.Marshal(map[string]any{
		"text": "must wait for attendance", "expectedLeadId": leadID,
		"sendSessionId": sessionID,
	})
	if err != nil {
		t.Fatal(err)
	}
	leadSendRequest, err := http.NewRequestWithContext(ctx, http.MethodPost,
		server.URL+"/conversations/"+leadConversationID+"/send", bytes.NewReader(leadSendBody))
	if err != nil {
		t.Fatal(err)
	}
	leadSendRequest.Header.Set("Content-Type", "application/json")
	leadSendResponse, err := client.Do(leadSendRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer leadSendResponse.Body.Close()
	if leadSendResponse.StatusCode != http.StatusConflict {
		body, _ := io.ReadAll(leadSendResponse.Body)
		t.Fatalf("lead send before attendance HTTP %d, want 409: %s", leadSendResponse.StatusCode, body)
	}
	if err := postgres.Pool().QueryRow(ctx,
		`select count(*) from public.whatsapp_outbox where organization_id = $1::uuid`, organizationID,
	).Scan(&outboxRows); err != nil {
		t.Fatal(err)
	}
	if outboxRows != 0 {
		t.Fatalf("lead send before attendance queued %d outbox rows", outboxRows)
	}

	// Advance only this synthetic old unlinked epoch. Retention must replace
	// its completed raw callback with a tombstone; the exact original provider
	// callback still receives a duplicate ACK without recreating content.
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_conversations
		set created_at = clock_timestamp() - interval '8 days'
		where id = $1::uuid and organization_id = $2::uuid
		  and unlinked_retention_v1 and lead_id is null
	`, conversationID, organizationID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set created_at = clock_timestamp() - interval '7 days'
		where organization_id = $1::uuid
		  and id in ($2::uuid, $3::uuid)
	`, organizationID, inboundReceipt.ID, outboundReceipt.ID); err != nil {
		t.Fatal(err)
	}
	var retentionResult []byte
	if err := postgres.Pool().QueryRow(ctx,
		`select private.scrub_expired_whatsapp_unlinked_inbox(500)::text`,
	).Scan(&retentionResult); err != nil {
		t.Fatal(err)
	}
	var retainedPayload string
	if err := postgres.Pool().QueryRow(ctx, `
		select payload::text from public.whatsapp_webhook_inbox
		where id = $1::uuid
	`, inboundReceipt.ID).Scan(&retainedPayload); err != nil {
		t.Fatal(err)
	}
	if retainedPayload != `{"__vimob_retention": "expired_unlinked_v1"}` {
		t.Fatalf("completed old inbound was not tombstoned after retention: %s; stats %s",
			retainedPayload, retentionResult)
	}
	if err := postgres.Pool().QueryRow(ctx,
		`select count(*) from public.whatsapp_messages where organization_id = $1::uuid`, organizationID,
	).Scan(&messageRows); err != nil {
		t.Fatal(err)
	}
	retainedReplay, _ := postWebhook(inboundID, "synthetic inbound", false)
	if !retainedReplay.Duplicate || retainedReplay.ID != inboundReceipt.ID {
		t.Fatalf("expired callback replay receipt = %#v", retainedReplay)
	}
	var afterReplayRows int
	if err := postgres.Pool().QueryRow(ctx,
		`select count(*) from public.whatsapp_messages where organization_id = $1::uuid`, organizationID,
	).Scan(&afterReplayRows); err != nil {
		t.Fatal(err)
	}
	if afterReplayRows != messageRows {
		t.Fatalf("expired callback replay changed message count %d -> %d", messageRows, afterReplayRows)
	}
	get("/conversations/"+leadConversationID+"/messages?expectedLeadId="+leadID, &messages)
	if len(messages.Data.Messages) != 1 || messages.Data.Messages[0].MessageID != leadMessageID {
		t.Fatalf("lead history changed by old unlinked retention: %#v", messages.Data.Messages)
	}

	// More than 128 members remain one durable batch. Expire only its
	// synthetic no-lead member, retain the lead members, then replay the exact
	// original callback (including instanceToken) after partial raw redaction.
	batchNoLeadPhone := "55118" + fmt.Sprintf("%08d", time.Now().UnixNano()%100_000_000)
	var batchNoLeadConversationID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations
		  (organization_id, session_id, assigned_user_id, remote_jid,
		   contact_phone, unlinked_retention_v1)
		values ($1::uuid, $2::uuid, $3::uuid, $4, $5, true)
		returning id::text
	`, organizationID, sessionID, ownerID,
		batchNoLeadPhone+"@s.whatsapp.net", batchNoLeadPhone,
	).Scan(&batchNoLeadConversationID); err != nil {
		t.Fatal(err)
	}
	batchNoLeadID := suffix + "-batch-unlinked"
	batchLeadID := suffix + "-batch-lead-000"
	batchMessages := make([]any, 0, 129)
	for index := 0; index < 129; index++ {
		phone := contactPhone
		providerID := fmt.Sprintf("%s-batch-lead-%03d", suffix, index-1)
		if index == 0 {
			phone, providerID = batchNoLeadPhone, batchNoLeadID
		}
		batchMessages = append(batchMessages, map[string]any{
			"Info": map[string]any{
				"ID": providerID, "Chat": phone + "@s.whatsapp.net",
				"SenderPN": phone + "@s.whatsapp.net", "IsFromMe": false,
				"PushName": "Synthetic Contact", "Timestamp": providerTimestamp,
			},
			"Message": map[string]any{"conversation": "synthetic batch member"},
		})
	}
	batchBody, err := json.Marshal(map[string]any{
		"event":         "messages.upsert",
		"instanceId":    suffix,
		"instanceToken": "synthetic-instance-secret",
		"data":          map[string]any{"messages": batchMessages},
	})
	if err != nil {
		t.Fatal(err)
	}
	batchReceipt, batchACK := postRawWebhook(batchBody)
	if batchReceipt.Status != "pending" || batchReceipt.Duplicate {
		t.Fatalf("mixed batch receipt = %#v", batchReceipt)
	}
	var originalBatchLength int
	if err := postgres.Pool().QueryRow(ctx, `
		select jsonb_array_length(payload #> '{data,messages}')
		from public.whatsapp_webhook_inbox where id = $1::uuid
	`, batchReceipt.ID).Scan(&originalBatchLength); err != nil {
		t.Fatal(err)
	}
	if originalBatchLength != 129 {
		t.Fatalf("mixed callback was split into %d raw members, want 129", originalBatchLength)
	}
	batchProcess := processOne(batchReceipt)
	var batchNoLeadState, batchNoLeadMessageConversationID string
	if err := postgres.Pool().QueryRow(ctx, `
		select capture_state, conversation_id::text
		from public.whatsapp_messages
		where organization_id = $1::uuid and message_id = $2
	`, organizationID, batchNoLeadID).Scan(
		&batchNoLeadState, &batchNoLeadMessageConversationID,
	); err != nil {
		t.Fatal(err)
	}
	if batchNoLeadState != "unlinked_ephemeral" ||
		batchNoLeadMessageConversationID != batchNoLeadConversationID {
		t.Fatalf("mixed batch no-lead member = %s in %s, want unlinked_ephemeral in %s",
			batchNoLeadState, batchNoLeadMessageConversationID, batchNoLeadConversationID)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_conversations
		set created_at = clock_timestamp() - interval '8 days'
		where id = $1::uuid and organization_id = $2::uuid
	`, batchNoLeadConversationID, organizationID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set created_at = clock_timestamp() - interval '7 days'
		where id = $1::uuid and organization_id = $2::uuid
	`, batchReceipt.ID, organizationID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx,
		`select private.scrub_expired_whatsapp_unlinked_inbox(500)::text`,
	).Scan(&retentionResult); err != nil {
		t.Fatal(err)
	}
	var partialMarker, partiallyRetainedRaw string
	var remainingBatchMembers int
	if err := postgres.Pool().QueryRow(ctx, `
		select payload #>> '{__vimob_retention,kind}',
		       jsonb_array_length(payload #> '{data,messages}'), payload::text
		from public.whatsapp_webhook_inbox where id = $1::uuid
	`, batchReceipt.ID).Scan(&partialMarker, &remainingBatchMembers, &partiallyRetainedRaw); err != nil {
		t.Fatal(err)
	}
	if partialMarker != "partial_expired_unlinked_v1" || remainingBatchMembers != 128 ||
		strings.Contains(partiallyRetainedRaw, batchNoLeadID) ||
		!strings.Contains(partiallyRetainedRaw, batchLeadID) {
		t.Fatalf("mixed retention marker=%q raw members=%d nolead present=%t lead present=%t stats=%s",
			partialMarker, remainingBatchMembers,
			strings.Contains(partiallyRetainedRaw, batchNoLeadID),
			strings.Contains(partiallyRetainedRaw, batchLeadID), retentionResult)
	}
	if err := postgres.Pool().QueryRow(ctx,
		`select count(*) from public.whatsapp_messages where organization_id = $1::uuid`, organizationID,
	).Scan(&messageRows); err != nil {
		t.Fatal(err)
	}
	partialReplay, _ := postRawWebhook(batchBody)
	if !partialReplay.Duplicate || partialReplay.ID != batchReceipt.ID {
		t.Fatalf("partially redacted callback replay = %#v", partialReplay)
	}
	if err := postgres.Pool().QueryRow(ctx,
		`select count(*) from public.whatsapp_messages where organization_id = $1::uuid`, organizationID,
	).Scan(&afterReplayRows); err != nil {
		t.Fatal(err)
	}
	if afterReplayRows != messageRows {
		t.Fatalf("partial callback replay changed message count %d -> %d", messageRows, afterReplayRows)
	}
	t.Logf("synthetic local HTTP: unlinked inbound ACK=%s worker=%s; external outbound ACK=%s worker=%s; lead before attendance ACK=%s worker=%s (single samples, not a mean)",
		inboundACK, inboundProcess, outboundACK, outboundProcess, leadACK, leadProcess)
	t.Logf("synthetic local HTTP 129-member mixed callback: ACK=%s worker=%s; one expired no-lead member redacted; exact callback replay acknowledged as duplicate", batchACK, batchProcess)
}
