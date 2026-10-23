package whatsapp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// This opt-in fixture proves that an activated session remains on the native
// processor even when a replica is configured for Edge. It requires a
// disposable loopback Supabase clone and never calls a WhatsApp provider.
func TestLocalEpochOneNativeWithEdgeConfigured(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_EPOCH1_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_EPOCH1_TEST_DATABASE_URL is not set")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	host := net.ParseIP(target.Hostname())
	if target.Hostname() != "localhost" && (host == nil || !host.IsLoopback()) {
		t.Fatal("HTTP observed fixture requires a disposable loopback database")
	}
	nativeFixture := os.Getenv("VIMOB_LOCAL_WHATSAPP_CLONE_VERIFIED") == nativeOutboundMarker && databaseURL == localVerifiedOutboundCloneURL()
	if target.Port() != "57722" && !nativeFixture {
		t.Fatal("epoch-one fixture requires disposable PostgreSQL port 57722 or the verified native clone")
	}
	edgeURL := strings.TrimSpace(os.Getenv("WHATSAPP_EPOCH1_TEST_SUPABASE_URL"))
	serviceKey := strings.TrimSpace(os.Getenv("WHATSAPP_EPOCH1_TEST_SERVICE_ROLE_KEY"))
	if nativeFixture {
		// Epoch-one sessions must never dispatch to Edge, including on a replica
		// configured for it. A recording fail-closed local endpoint proves zero
		// fallback calls; this does not claim to run the Edge/Deno runtime.
		var edgeCalls atomic.Int32
		edgeProbe := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			edgeCalls.Add(1)
			http.Error(w, "unexpected Edge fallback", http.StatusInternalServerError)
		}))
		t.Cleanup(func() {
			edgeProbe.Close()
			if calls := edgeCalls.Load(); calls != 0 {
				t.Errorf("activated native session called Edge %d times", calls)
			}
		})
		edgeURL, serviceKey = edgeProbe.URL, "synthetic-native-no-edge-call"
	} else {
		edgeTarget, err := url.Parse(edgeURL)
		if err != nil || edgeTarget.Scheme != "http" || edgeTarget.Hostname() != "127.0.0.1" || edgeTarget.Port() != "57721" {
			t.Fatal("epoch-one fixture requires local Supabase URL http://127.0.0.1:57721")
		}
		if serviceKey == "" {
			t.Fatal("epoch-one fixture requires the disposable project's service key")
		}
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

	suffix := strings.TrimSpace(os.Getenv("WHATSAPP_EPOCH1_TEST_SLUG"))
	if suffix == "" {
		suffix = fmt.Sprintf("wa-epoch1-dual-%d", time.Now().UnixNano())
	}
	contactPhone := fmt.Sprintf("55119%08d", time.Now().UnixNano()%100_000_000)
	ownerPhone := "55118888" + fmt.Sprintf("%05d", time.Now().UnixNano()%100_000)
	var organizationID, ownerID, sessionID string
	preserveFixture := false
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.organizations (name, slug)
		values ($1, $1) returning id::text
	`, suffix).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if preserveFixture {
			t.Logf("preserving disposable synthetic fixture for diagnosis: slug=%s org=%s session=%s",
				suffix, organizationID, sessionID)
			return
		}
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		for _, statement := range []string{
			`delete from public.whatsapp_webhook_routing_snapshots where organization_id = $1::uuid`,
			`delete from public.whatsapp_webhook_inbox where organization_id = $1::uuid`,
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
	// Only the current two-argument RPC is the cutover contract.
	var cutoverAt time.Time
	if err := postgres.Pool().QueryRow(ctx, `
		select private.activate_whatsapp_webhook_session_cutover($1::uuid, $2::uuid)
	`, organizationID, sessionID).Scan(&cutoverAt); err != nil {
		t.Fatal(err)
	}
	var activeEpoch int
	if err := postgres.Pool().QueryRow(ctx, `
		select active_epoch from private.whatsapp_webhook_session_cutovers
		where session_id = $1::uuid
	`, sessionID).Scan(&activeEpoch); err != nil || activeEpoch != 1 {
		t.Fatalf("activation RPC: epoch=%d error=%v", activeEpoch, err)
	}

	repo := NewRepository(postgres, nil, StorageConfig{})
	repo.functions.webhookProcessorMode = webhookProcessorNative
	repo.functions.webhookRolloutSessionIDs = []string{sessionID}
	repo.functions.projectURL = edgeURL
	repo.functions.apiKey = serviceKey
	repo.functions.httpClient = &http.Client{Timeout: 25 * time.Second}
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
	makeWebhook := func(providerID, text string, fromMe bool) []byte {
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
		return body
	}
	postWebhook := func(providerID, text string, fromMe bool) (evolutionWebhookReceipt, time.Duration) {
		t.Helper()
		return postRawWebhook(makeWebhook(providerID, text, fromMe))
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
	assertEpoch := func(receipt evolutionWebhookReceipt, providerID string) {
		t.Helper()
		var inboxEpoch, snapshotEpoch int
		var embeddedEpoch, snapshotJSONEpoch, embeddedPolicy, snapshotPolicy, recordedSession string
		if err := postgres.Pool().QueryRow(ctx, `
			select i.processing_epoch,
			       coalesce(i.payload #>> '{__vimob_ingress,routing_snapshot,messages,0,processing_epoch}', ''),
			       coalesce(i.payload #>> '{__vimob_ingress,routing_snapshot,messages,0,unlinked_capture_policy}', ''),
			       s.processing_epoch, coalesce(s.snapshot->>'processing_epoch', ''),
			       coalesce(s.snapshot->>'unlinked_capture_policy', ''), i.session_id::text
			from public.whatsapp_webhook_inbox i
			join public.whatsapp_webhook_routing_snapshots s
			  on s.organization_id = i.organization_id
			 and s.session_id = i.session_id
			 and s.inbox_event_key = i.event_key
			where i.id = $1::uuid and s.provider_message_id = $2
		`, receipt.ID, providerID).Scan(&inboxEpoch, &embeddedEpoch, &embeddedPolicy,
			&snapshotEpoch, &snapshotJSONEpoch, &snapshotPolicy, &recordedSession); err != nil {
			t.Fatalf("epoch snapshot for %s: %v", providerID, err)
		}
		if inboxEpoch != 1 || snapshotEpoch != 1 || embeddedEpoch != "1" ||
			snapshotJSONEpoch != "1" || embeddedPolicy != "v1" ||
			snapshotPolicy != "v1" || recordedSession != sessionID {
			t.Fatalf("epoch snapshot for %s: inbox=%d embedded=%q/%q snapshot=%d/%q/%q session=%s",
				providerID, inboxEpoch, embeddedEpoch, embeddedPolicy,
				snapshotEpoch, snapshotJSONEpoch, snapshotPolicy, recordedSession)
		}
	}

	inboundID := suffix + "-inbound"
	inboundBody := makeWebhook(inboundID, "synthetic inbound", false)
	inboundReceipt, inboundACK := postRawWebhook(inboundBody)
	if inboundReceipt.Status != "pending" || inboundReceipt.Duplicate {
		t.Fatalf("inbound receipt = %#v", inboundReceipt)
	}
	assertEpoch(inboundReceipt, inboundID)
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

	// Misconfigure this replica as Edge. Epoch one must still use native while
	// keeping the external outbound message in the same unlinked conversation.
	repo.functions.webhookProcessorMode = webhookProcessorEdge
	outboundID := suffix + "-external-outbound"
	outboundReceipt, outboundACK := postWebhook(outboundID, "synthetic external outbound", true)
	if outboundReceipt.Status != "pending" || outboundReceipt.Duplicate {
		t.Fatalf("external outbound receipt = %#v", outboundReceipt)
	}
	assertEpoch(outboundReceipt, outboundID)
	var outboundSnapshotState, outboundTargetMode, outboundContextKind, frozenConversationID string
	if err := postgres.Pool().QueryRow(ctx, `
		select coalesce(snapshot->>'state', ''),
		       coalesce(snapshot->>'target_mode', ''),
		       coalesce(snapshot->>'context_kind', ''),
		       coalesce(snapshot->>'conversation_id', '')
		from public.whatsapp_webhook_routing_snapshots
		where organization_id = $1::uuid and session_id = $2::uuid
		  and provider_message_id = $3
	`, organizationID, sessionID, outboundID).Scan(
		&outboundSnapshotState, &outboundTargetMode,
		&outboundContextKind, &frozenConversationID,
	); err != nil {
		t.Fatal(err)
	}
	if outboundSnapshotState != "unlinked" || outboundTargetMode != "snapshot" ||
		outboundContextKind != "organic" || frozenConversationID != conversationID {
		t.Fatalf("outbound immutable route: state=%s target=%s context=%s conversation=%s",
			outboundSnapshotState, outboundTargetMode, outboundContextKind, frozenConversationID)
	}
	outboundProcess := processOne(outboundReceipt)
	var outboundConversationID, direction, outboundState string
	if err := postgres.Pool().QueryRow(ctx, `
		select conversation_id::text, direction, capture_state
		from public.whatsapp_messages
		where organization_id = $1::uuid and message_id = $2
	`, organizationID, outboundID).Scan(&outboundConversationID, &direction, &outboundState); err != nil {
		t.Fatal(err)
	}
	if outboundConversationID != conversationID || direction != "outbound" || outboundState != "unlinked_ephemeral" {
		t.Fatalf("outbound: conversation=%s direction=%s state=%s",
			outboundConversationID, direction, outboundState)
	}
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
	duplicate, _ := postRawWebhook(inboundBody)
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
	repo.functions.webhookProcessorMode = webhookProcessorNative
	leadReceipt, leadACK := postWebhook(leadMessageID, "synthetic lead inbound", false)
	if leadReceipt.Status != "pending" || leadReceipt.Duplicate {
		t.Fatalf("lead inbound receipt = %#v", leadReceipt)
	}
	assertEpoch(leadReceipt, leadMessageID)
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

	// The last message remains recent while only creation time crosses day 7.
	// Check day 6 first, so retention is tied to the conversation's creation.
	var recentLastMessage bool
	if err := postgres.Pool().QueryRow(ctx, `
		select last_message_at > clock_timestamp() - interval '1 hour'
		from public.whatsapp_conversations where id = $1::uuid
	`, conversationID).Scan(&recentLastMessage); err != nil || !recentLastMessage {
		t.Fatalf("old unlinked conversation lacks recent last message: %v", err)
	}
	var otherExpired int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*) from public.whatsapp_conversations
		where organization_id <> $1::uuid and unlinked_retention_v1 and lead_id is null
		  and created_at <= clock_timestamp() - interval '7 days'
		  and unlinked_retention_scrubbed_at is null
	`, organizationID).Scan(&otherExpired); err != nil || otherExpired != 0 {
		t.Fatalf("disposable clone has %d unrelated expired candidates: %v", otherExpired, err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_conversations
		set created_at = clock_timestamp() - interval '6 days'
		where id = $1::uuid and organization_id = $2::uuid
		  and unlinked_retention_v1 and lead_id is null
	`, conversationID, organizationID); err != nil {
		t.Fatal(err)
	}
	var beforeExpiry []byte
	if err := postgres.Pool().QueryRow(ctx,
		`select private.scrub_expired_whatsapp_unlinked_conversations(500)::text`,
	).Scan(&beforeExpiry); err != nil || !strings.Contains(string(beforeExpiry), `"status": "idle"`) {
		t.Fatalf("conversation expired before day 7: %s, error=%v", beforeExpiry, err)
	}
	// Advance only this synthetic old unlinked epoch to day 8. Its message
	// tombstones remain for replay, while contents and list entry disappear.
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_conversations
		set created_at = clock_timestamp() - interval '8 days'
		where id = $1::uuid and organization_id = $2::uuid
		  and unlinked_retention_v1 and lead_id is null
	`, conversationID, organizationID); err != nil {
		t.Fatal(err)
	}
	// Raw redaction must precede conversation scrubbing because the raw worker
	// needs the still-present phone and unscrubbed parent for exact proof.
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set created_at = clock_timestamp() - interval '7 days'
		where organization_id = $1::uuid
		  and id in ($2::uuid, $3::uuid)
	`, organizationID, inboundReceipt.ID, outboundReceipt.ID); err != nil {
		t.Fatal(err)
	}
	// Pin the session before the exact replay starts. Once it waits for the
	// ingress FOR KEY SHARE lock, its early tombstone probe has already seen the
	// intact inbox. Scrub on another connection, then release the lock: this
	// forces the redaction race without a hook or provider call in production.
	preserveFixture = true
	gate, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = gate.Rollback(context.Background()) }()
	var gatePID int
	if err := gate.QueryRow(ctx, `select pg_backend_pid()`).Scan(&gatePID); err != nil {
		t.Fatal(err)
	}
	var sessionLocked bool
	if err := gate.QueryRow(ctx, `
		select true from public.whatsapp_sessions
		where organization_id = $1::uuid and id = $2::uuid for update
	`, organizationID, sessionID).Scan(&sessionLocked); err != nil || !sessionLocked {
		t.Fatalf("hold synthetic session replay gate: %v", err)
	}
	type racingReplayResult struct {
		receipt evolutionWebhookReceipt
		status  int
		err     error
	}
	racingReplay := make(chan racingReplayResult, 1)
	go func() {
		endpoint := fmt.Sprintf("%s/webhook?session_id=%s&instance_id=%s",
			server.URL, url.QueryEscape(sessionID), url.QueryEscape(suffix))
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(inboundBody))
		if err != nil {
			racingReplay <- racingReplayResult{err: err}
			return
		}
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Webhook-Token", "synthetic-webhook-secret")
		response, err := (&http.Client{Timeout: 25 * time.Second}).Do(request)
		if err != nil {
			racingReplay <- racingReplayResult{err: err}
			return
		}
		defer response.Body.Close()
		var decoded struct {
			Receipt evolutionWebhookReceipt `json:"receipt"`
		}
		if err := json.NewDecoder(response.Body).Decode(&decoded); err != nil {
			racingReplay <- racingReplayResult{status: response.StatusCode, err: err}
			return
		}
		racingReplay <- racingReplayResult{receipt: decoded.Receipt, status: response.StatusCode}
	}()
	blocked := false
	for deadline := time.Now().Add(8 * time.Second); time.Now().Before(deadline); {
		if err := postgres.Pool().QueryRow(ctx, `
			select exists (
			  select 1 from pg_catalog.pg_stat_activity as activity
			  where activity.pid <> pg_catalog.pg_backend_pid()
			    and activity.wait_event_type = 'Lock'
			    and pg_catalog.array_position(pg_catalog.pg_blocking_pids(activity.pid), $1::integer) is not null
			    and pg_catalog.strpos(pg_catalog.lower(activity.query), 'for key share') > 0
			    and pg_catalog.strpos(pg_catalog.lower(activity.query), 'public.whatsapp_sessions') > 0
			)
		`, gatePID).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !blocked {
		t.Fatal("exact replay did not reach the session lock after the early probe")
	}
	var retentionResult []byte
	if err := gate.QueryRow(ctx,
		`select private.scrub_expired_whatsapp_unlinked_inbox(500)::text`,
	).Scan(&retentionResult); err != nil {
		t.Fatal(err)
	}
	for _, receiptID := range []string{inboundReceipt.ID, outboundReceipt.ID} {
		var retainedPayload string
		if err := gate.QueryRow(ctx, `
			select payload::text from public.whatsapp_webhook_inbox where id = $1::uuid
		`, receiptID).Scan(&retainedPayload); err != nil {
			t.Fatal(err)
		}
		if retainedPayload != `{"__vimob_retention": "expired_unlinked_v1"}` {
			t.Fatalf("old callback %s was not tombstoned: payload=%s stats=%s",
				receiptID, retainedPayload, retentionResult)
		}
	}
	var conversationScrub []byte
	if err := gate.QueryRow(ctx,
		`select private.scrub_expired_whatsapp_unlinked_conversations(500)::text`,
	).Scan(&conversationScrub); err != nil {
		t.Fatal(err)
	}
	var scrubbed struct {
		Status                 string `json:"status"`
		ConversationID         string `json:"conversation_id"`
		MessagesScrubbed       int    `json:"messages_scrubbed"`
		ConversationsCompleted int    `json:"conversations_completed"`
	}
	if err := json.Unmarshal(conversationScrub, &scrubbed); err != nil {
		t.Fatal(err)
	}
	if scrubbed.Status != "processed" || scrubbed.ConversationID != conversationID ||
		scrubbed.MessagesScrubbed != 2 || scrubbed.ConversationsCompleted != 1 {
		t.Fatalf("day-8 conversation scrub = %s", conversationScrub)
	}
	var redacted int
	if err := gate.QueryRow(ctx, `
		select count(*) from public.whatsapp_messages
		where organization_id = $1::uuid and conversation_id = $2::uuid
		  and capture_state = 'suppressed' and content is null
		  and unlinked_retention_scrubbed_at is not null
	`, organizationID, conversationID).Scan(&redacted); err != nil || redacted != 2 {
		t.Fatalf("day-8 message redaction = %d, error=%v", redacted, err)
	}
	if err := gate.Commit(ctx); err != nil {
		t.Fatalf("publish scrub and release synthetic replay gate: %v", err)
	}
	select {
	case result := <-racingReplay:
		if result.err != nil || result.status != http.StatusAccepted ||
			!result.receipt.Duplicate || result.receipt.ID != inboundReceipt.ID {
			t.Fatalf("replay across committed scrub: HTTP %d receipt=%#v error=%v",
				result.status, result.receipt, result.err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("replay remained pending after the retention gate was released")
	}
	get("/conversations?withoutLead=true", &list)
	if len(list.Data) != 0 {
		t.Fatalf("expired no-lead conversation remains visible: %#v", list.Data)
	}
	if err := postgres.Pool().QueryRow(ctx,
		`select count(*) from public.whatsapp_messages where organization_id = $1::uuid`, organizationID,
	).Scan(&messageRows); err != nil {
		t.Fatal(err)
	}
	preserveFixture = true
	retainedReplay, _ := postRawWebhook(inboundBody)
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
	// The early return requires the immutable v1 snapshot, even for the same
	// authenticated callback bytes. Remove it only inside a rolled-back query.
	func() {
		probe, err := postgres.Pool().Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = probe.Rollback(ctx) }()
		inboundEventKey := evolutionWebhookEventKey(sessionID, inboundBody)
		tag, err := probe.Exec(ctx, `
			delete from public.whatsapp_webhook_routing_snapshots
			where organization_id = $1::uuid and session_id = $2::uuid and inbox_event_key = $3
		`, organizationID, sessionID, inboundEventKey)
		if err != nil || tag.RowsAffected() != 1 {
			t.Fatalf("remove snapshot in rollback probe: rows=%d error=%v", tag.RowsAffected(), err)
		}
		_, found, err := lookupEvolutionWebhookRetainedTombstoneReplay(
			ctx, probe, evolutionWebhookSession{ID: sessionID, OrganizationID: organizationID},
			inboundEventKey, inboundReceipt.EventType,
		)
		if err != nil || found {
			t.Fatalf("tombstone without immutable snapshot: found=%t error=%v", found, err)
		}
	}()
	changedBody := makeWebhook(inboundID, "synthetic inbound changed", false)
	if evolutionWebhookEventKey(sessionID, changedBody) == evolutionWebhookEventKey(sessionID, inboundBody) {
		t.Fatal("changed callback unexpectedly retained the exact event key")
	}
	changedEndpoint := fmt.Sprintf("%s/webhook?session_id=%s&instance_id=%s",
		server.URL, url.QueryEscape(sessionID), url.QueryEscape(suffix))
	changedRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, changedEndpoint, bytes.NewReader(changedBody))
	if err != nil {
		t.Fatal(err)
	}
	changedRequest.Header.Set("Content-Type", "application/json")
	changedRequest.Header.Set("X-Webhook-Token", "synthetic-webhook-secret")
	changedResponse, err := client.Do(changedRequest)
	if err != nil {
		t.Fatal(err)
	}
	_ = changedResponse.Body.Close()
	if changedResponse.StatusCode != http.StatusInternalServerError {
		t.Fatalf("changed content with the same provider message ID returned HTTP %d, want collision failure",
			changedResponse.StatusCode)
	}
	changedEnvelope, err := parseEvolutionWebhookEnvelope(changedRequest.URL.Query(), changedRequest.Header, changedBody)
	if err != nil {
		t.Fatal(err)
	}
	_, collisionErr := repo.AcceptEvolutionWebhook(ctx, changedEnvelope)
	var providerCollision *pgconn.PgError
	if !errors.As(collisionErr, &providerCollision) || providerCollision.Code != "23505" ||
		providerCollision.Message != "managed_whatsapp_provider_message_collision" {
		t.Fatalf("changed content did not retain strict provider collision: %v", collisionErr)
	}
	var afterChangedInboxRows, afterChangedMessageRows int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*) from public.whatsapp_webhook_inbox where organization_id = $1::uuid
	`, organizationID).Scan(&afterChangedInboxRows); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*) from public.whatsapp_messages where organization_id = $1::uuid
	`, organizationID).Scan(&afterChangedMessageRows); err != nil {
		t.Fatal(err)
	}
	if afterChangedInboxRows != 3 || afterChangedMessageRows != messageRows {
		t.Fatalf("changed provider ID collision changed cardinalities: inbox=%d messages=%d",
			afterChangedInboxRows, afterChangedMessageRows)
	}
	get("/conversations/"+leadConversationID+"/messages?expectedLeadId="+leadID, &messages)
	if len(messages.Data.Messages) != 1 || messages.Data.Messages[0].MessageID != leadMessageID {
		t.Fatalf("lead history changed by old unlinked retention: %#v", messages.Data.Messages)
	}
	preserveFixture = false

	t.Logf("epoch-one native synthetic fixture: slug=%s org=%s session=%s cutover=%s; inbound ACK=%s worker=%s; external outbound ACK=%s worker=%s; lead ACK=%s worker=%s",
		suffix, organizationID, sessionID, cutoverAt.Format(time.RFC3339Nano),
		inboundACK, inboundProcess, outboundACK, outboundProcess, leadACK, leadProcess)
	if os.Getenv("WHATSAPP_EPOCH1_TEST_PAUSE_BEFORE_CLEANUP") == "1" {
		t.Log("inspection window: synthetic rows remain for 45 seconds")
		time.Sleep(45 * time.Second)
	}
}
