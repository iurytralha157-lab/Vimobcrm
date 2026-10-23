package whatsapp

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Real CRM HTTP, durable outbox and ingress against the externally verified
// disposable clone. Provider HTTP and the authenticated tenant context are
// synthetic; no WhatsApp socket or production authentication is exercised.
func TestLocalQuotedReplyHTTPRoundtrip(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	var wireID string
	requests := make(chan map[string]any, 4)
	var sends atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/send/text" {
			http.NotFound(w, r)
			return
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			http.Error(w, "invalid synthetic request", 400)
			return
		}
		wireID = strings.TrimSpace(stringFromAny(body["id"]))
		if wireID == "" {
			t.Error("local CRM request omitted its deterministic provider stanza ID")
			http.Error(w, "missing synthetic stanza ID", 400)
			return
		}
		sends.Add(1)
		requests <- body
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"message": "success", "data": map[string]any{
			"Info": map[string]any{"ID": wireID, "Timestamp": time.Now().UTC().Format(time.RFC3339Nano)},
		}})
	}))
	t.Cleanup(provider.Close)
	repo := NewRepository(db, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: provider.URL, APIKey: "synthetic-quoted-provider-key"}})
	f := outboundHardeningFixture(t, ctx, db, repo, "quoted-roundtrip")
	foreign := outboundHardeningFixture(t, ctx, db, repo, "quoted-roundtrip-foreign")
	targetID := insertHardeningTarget(t, ctx, db.Pool(), f, "-captured-target", "received", false)
	foreignID := insertHardeningTarget(t, ctx, db.Pool(), foreign, "-private-target", "received", false)
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_sessions
		set advanced_settings='{"token":"synthetic-quoted-instance","webhook_token":"synthetic-quoted-webhook"}'::jsonb
		where id=$1::uuid`, f.sessionID); err != nil {
		t.Fatal(err)
	}
	var cutover time.Time
	if err := db.Pool().QueryRow(ctx, `select private.activate_whatsapp_webhook_session_cutover($1::uuid,$2::uuid)`,
		f.organizationID, f.sessionID).Scan(&cutover); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		if _, err := db.Pool().Exec(cleanup, `delete from public.whatsapp_webhook_inbox where organization_id=$1::uuid`, f.organizationID); err != nil {
			t.Error(err)
		}
	})
	repo.functions.webhookProcessorMode = webhookProcessorNative
	repo.functions.webhookRolloutSessionIDs = []string{f.sessionID}
	handler := NewHandler(repo)
	mux := http.NewServeMux()
	mux.HandleFunc("POST /webhook", handler.EvolutionGoWebhook)
	mux.HandleFunc("POST /conversations/{id}/send", func(w http.ResponseWriter, r *http.Request) {
		handler.SendMessage(w, r.WithContext(tenant.ContextWithTenant(r.Context(), f.tenant)))
	})
	mux.HandleFunc("GET /conversations/{id}/messages", func(w http.ResponseWriter, r *http.Request) {
		handler.ListMessages(w, r.WithContext(tenant.ContextWithTenant(r.Context(), f.tenant)))
	})
	crm := httptest.NewServer(mux)
	t.Cleanup(crm.Close)
	client := &http.Client{Timeout: 12 * time.Second}
	call := func(method, path string, payload any, header string, status int, result any) {
		t.Helper()
		var body io.Reader
		if payload != nil {
			encoded, err := json.Marshal(payload)
			if err != nil {
				t.Fatal(err)
			}
			body = bytes.NewReader(encoded)
		}
		r, err := http.NewRequestWithContext(ctx, method, crm.URL+path, body)
		if err != nil {
			t.Fatal(err)
		}
		r.Header.Set("Content-Type", "application/json")
		if header != "" {
			r.Header.Set("X-Webhook-Token", header)
		}
		response, err := client.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		encoded, err := io.ReadAll(response.Body)
		if err != nil || response.StatusCode != status {
			t.Fatalf("local HTTP %s status=%d want=%d error=%v body=%s", path, response.StatusCode, status, err, encoded)
		}
		if result != nil {
			if err := json.Unmarshal(encoded, result); err != nil {
				t.Fatal(err)
			}
		}
	}
	list := func() MessagePage {
		t.Helper()
		var page Envelope[MessagePage]
		call(http.MethodGet, "/conversations/"+f.conversationID+"/messages?expectedLeadId="+f.leadID+"&limit=40&orderingVersion=2", nil, "", http.StatusOK, &page)
		return page.Data
	}
	find := func(page MessagePage, providerID string) Message {
		t.Helper()
		for _, message := range page.Messages {
			if message.MessageID == providerID || pointerValue(message.ClientMessageID) == providerID {
				return message
			}
		}
		var diagnostics string
		diagnosticErr := db.Pool().QueryRow(ctx, `select coalesce(jsonb_agg(jsonb_build_object('id',id,'conversation_id',conversation_id,
			'lead_id',lead_id,'message_id',message_id,'provider_message_id',provider_message_id,'capture_state',capture_state,
			'from_me',from_me)),'[]'::jsonb)::text from public.whatsapp_messages
			where organization_id=$1::uuid and session_id=$2::uuid`, f.organizationID, f.sessionID).Scan(&diagnostics)
		t.Logf("synthetic capture diagnostics: %s error=%v", diagnostics, diagnosticErr)
		t.Fatalf("canonical message %q not returned by local GET", providerID)
		return Message{}
	}
	clientID := f.suffix + "-crm-reply"
	rejectedID := f.suffix + "-foreign-quote-rejected"
	var rejected map[string]any
	call(http.MethodPost, "/conversations/"+f.conversationID+"/send", map[string]any{
		"text": "Resposta com referência indevida", "clientMessageId": rejectedID,
		"expectedLeadId": f.leadID, "sendSessionId": f.sessionID, "quotedMessageId": foreignID,
	}, "", http.StatusConflict, &rejected)
	if code := stringFromAny(mapFromAny(rejected["error"])["code"]); code != "whatsapp_quote_target_unavailable" {
		t.Fatalf("foreign HTTP quote was not denied by canonical authorization: %q", code)
	}
	var rejectedRows int
	if err := db.Pool().QueryRow(ctx, `select count(*) from public.whatsapp_outbox where organization_id=$1::uuid and client_message_id=$2`,
		f.organizationID, rejectedID).Scan(&rejectedRows); err != nil || rejectedRows != 0 || sends.Load() != 0 {
		t.Fatalf("denied HTTP quote reached outbox/provider: rows=%d sends=%d error=%v", rejectedRows, sends.Load(), err)
	}
	var queued SendMessageResponse
	call(http.MethodPost, "/conversations/"+f.conversationID+"/send", map[string]any{
		"text": "Resposta CRM sintética", "clientMessageId": clientID,
		"expectedLeadId": f.leadID, "sendSessionId": f.sessionID, "quotedMessageId": targetID,
	}, "", http.StatusOK, &queued)
	if queued.Message == nil || queued.Message.QuotedMessage == nil || !queued.Message.QuotedMessage.Available {
		t.Fatalf("queued HTTP response lost authorized preview: %+v", queued)
	}
	item := leaseLocalOutbound(t, ctx, db.Pool(), f.organizationID, clientID)
	if err := repo.processClaimedWhatsAppOutbox(ctx, item, whatsappOutboxLaneFast); err != nil {
		t.Fatal(err)
	}
	assertLocalOutboundState(t, ctx, db.Pool(), item, "sent", 1)
	var providerBody map[string]any
	select {
	case providerBody = <-requests:
	case <-ctx.Done():
		t.Fatal("fake provider did not receive local CRM reply")
	}
	if wireID != deterministicProviderMessageID(clientID) {
		t.Fatalf("provider did not honor the CRM stanza ID: %q", wireID)
	}
	quoted := mapFromAny(providerBody["quoted"])
	if len(quoted) != 2 || quoted["messageId"] != f.suffix+"-captured-target" || quoted["participant"] != f.remoteJID {
		t.Fatalf("provider contract is not the minimal captured reference: %#v", quoted)
	}
	webhook := func(id, reference, text, inline string, fromMe bool) map[string]any {
		sender := f.remoteJID
		if fromMe {
			sender = "5511888877777@s.whatsapp.net"
		}
		return map[string]any{"event": "messages.upsert", "instanceId": f.suffix, "instanceToken": "synthetic-quoted-instance",
			"data": map[string]any{"messages": []any{map[string]any{
				"Info": map[string]any{"ID": id, "Chat": f.remoteJID, "SenderPN": sender, "IsFromMe": fromMe,
					"PushName": "Contato sintético", "Timestamp": time.Now().UTC().Format(time.RFC3339Nano)},
				"Message": map[string]any{"extendedTextMessage": map[string]any{"text": text,
					"contextInfo": map[string]any{"stanzaID": reference, "participant": "forged-participant@s.whatsapp.net",
						"quotedMessage": map[string]any{"conversation": inline}}}},
			}}}}
	}
	postWebhook := func(payload any, drain bool) evolutionWebhookReceipt {
		t.Helper()
		if normalized := extractNativeEvolutionMessages(mapFromAny(payload)); len(normalized) != 1 {
			t.Fatalf("synthetic native payload must normalize exactly one message, got %d", len(normalized))
		}
		var response struct {
			Receipt evolutionWebhookReceipt `json:"receipt"`
		}
		call(http.MethodPost, "/webhook?session_id="+url.QueryEscape(f.sessionID)+"&instance_id="+url.QueryEscape(f.suffix),
			payload, "synthetic-quoted-webhook", http.StatusAccepted, &response)
		if drain {
			if _, _, err := repo.processWebhookInboxLaneBatch(ctx, evolutionWebhookLaneLive, 4, 1, ""); err != nil {
				t.Fatal(err)
			}
			var state, failure string
			if err := db.Pool().QueryRow(ctx, `select status,coalesce(last_error,'') from public.whatsapp_webhook_inbox where id=$1::uuid`, response.Receipt.ID).Scan(&state, &failure); err != nil || state != "processed" {
				t.Fatalf("quote ingress state=%s failure=%s error=%v", state, failure, err)
			}
		}
		return response.Receipt
	}
	// EvolutionGo's pinned source constructs an empty quoted Conversation.
	// This synthetic echo exercises that wire shape, not a native WhatsApp phone.
	postWebhook(webhook(wireID, f.suffix+"-captured-target", "Resposta CRM sintética", "", true), true)
	echo := find(list(), clientID)
	if echo.ID != queued.Message.ID || echo.QuotedMessage == nil || !echo.QuotedMessage.Available || pointerValue(echo.QuotedMessage.Content) != "synthetic quoted body" {
		t.Fatalf("empty quoted-body echo lost canonical row or captured preview: %+v", echo)
	}
	inboundID := f.suffix + "-contact-reply"
	input := webhook(inboundID, wireID, "Resposta recebida do contato", "forged inline preview must never render", false)
	firstReceipt := postWebhook(input, true)
	inbound := find(list(), inboundID)
	if inbound.QuotedMessage == nil || !inbound.QuotedMessage.Available || pointerValue(inbound.QuotedMessage.ID) != echo.ID || pointerValue(inbound.QuotedMessage.Content) != "Resposta CRM sintética" {
		t.Fatalf("incoming stanzaID did not resolve the captured CRM reply: %+v", inbound)
	}
	replayed := postWebhook(input, false)
	if !replayed.Duplicate || replayed.ID != firstReceipt.ID {
		t.Fatalf("replayed native quote created a second inbox intent: %+v", replayed)
	}
	if _, _, err := repo.processWebhookInboxLaneBatch(ctx, evolutionWebhookLaneLive, 4, 1, ""); err != nil {
		t.Fatal(err)
	}
	var receiptCount, canonicalCount, echoCount, pendingCount int
	if err := db.Pool().QueryRow(ctx, `select
		(select count(*) from public.whatsapp_webhook_inbox where organization_id=$1::uuid),
		(select count(*) from public.whatsapp_messages where organization_id=$1::uuid and session_id=$2::uuid and message_id=$3),
		(select count(*) from public.whatsapp_messages where organization_id=$1::uuid and session_id=$2::uuid
		 and (message_id=$4 or provider_message_id=$4 or client_message_id=$5)),
		(select count(*) from public.whatsapp_webhook_inbox where organization_id=$1::uuid and status in ('pending','retry','processing'))`,
		f.organizationID, f.sessionID, inboundID, wireID, clientID).Scan(&receiptCount, &canonicalCount, &echoCount, &pendingCount); err != nil || receiptCount != 2 || canonicalCount != 1 || echoCount != 1 || pendingCount != 0 {
		t.Fatalf("replay duplicated canonical capture or left work: receipts=%d messages=%d echo=%d pending=%d error=%v", receiptCount, canonicalCount, echoCount, pendingCount, err)
	}
	listedCount := 0
	for _, message := range list().Messages {
		if message.MessageID == inboundID {
			listedCount++
		}
	}
	if listedCount != 1 {
		t.Fatalf("replayed quote rendered %d API rows, want one", listedCount)
	}
	privateID := f.suffix + "-private-reference"
	postWebhook(webhook(privateID, foreign.suffix+"-private-target", "Referência indisponível", "forbidden foreign body", false), true)
	private := find(list(), privateID)
	if private.QuotedMessage == nil || private.QuotedMessage.Available {
		t.Fatalf("foreign quote resolved across capture scope: %+v", private.QuotedMessage)
	}
	serialized, err := json.Marshal([]Message{echo, inbound, private})
	if err != nil || strings.Contains(string(serialized), "forged inline preview") || strings.Contains(string(serialized), "forbidden foreign body") || strings.Contains(string(serialized), foreignID) {
		t.Fatalf("inline provider body/private target leaked into DTO: %s %v", serialized, err)
	}
	if sends.Load() != 1 {
		t.Fatalf("quote echo/replay triggered %d provider calls, want one", sends.Load())
	}
	if directory := strings.TrimSpace(os.Getenv("VIMOB_WHATSAPP_QUOTE_FRAMES_DIR")); directory != "" {
		allowed := filepath.FromSlash("D:/Vimob/tmp/whatsapp-quoted-roundtrip-local-20261013")
		absolute, err := filepath.Abs(directory)
		if err != nil || (!strings.EqualFold(absolute, allowed) && !strings.HasPrefix(strings.ToLower(absolute), strings.ToLower(allowed)+string(os.PathSeparator))) {
			t.Fatal("quote frames must stay inside the explicit local evidence directory")
		}
		frame := map[string]any{"schemaVersion": 1, "scope": "disposable-local-crm-with-fake-provider", "nativePhoneVerified": false,
			"evolutionGoAdapterExecuted": false, "tenantMiddlewareSynthetic": true, "actorId": f.userID,
			"organizationId": f.organizationID, "leadId": f.leadID, "providerRequest": providerBody,
			"outbound": echo, "incoming": inbound, "unavailable": private, "target": find(list(), f.suffix+"-captured-target"),
			"providerCalls": sends.Load(), "foreignQuoteHTTPRejected": true, "duplicateReceipt": replayed.Duplicate, "cutoverAt": cutover}
		encoded, err := json.MarshalIndent(frame, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(absolute, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(absolute, "roundtrip-frame.json"), encoded, 0600); err != nil {
			t.Fatal(err)
		}
	}
}
