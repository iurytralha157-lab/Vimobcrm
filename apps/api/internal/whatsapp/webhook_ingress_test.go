package whatsapp

import (
	"errors"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestEvolutionWebhookSchemaCompatibilityRequiresLiveLaneContract(t *testing.T) {
	query := strings.ToLower(strings.Join(strings.Fields(evolutionWebhookSchemaCompatibilityQuery), " "))
	for _, required := range []string{
		"to_regclass('public.whatsapp_webhook_inbox') is not null",
		"attname = 'processing_lane'",
		"attname = 'provider_occurred_at'",
		"to_regclass('public.whatsapp_webhook_inbox_lane_session_due_head_idx')",
		"to_regclass('public.whatsapp_webhook_inbox_session_processing_idx')",
		"indisready and indisvalid",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("schema compatibility query is missing %q", required)
		}
	}
}

func TestAcceptEvolutionWebhookBatchUsesAtomicOriginalKeyFence(t *testing.T) {
	source := readWhatsAppSourceFunction(t, "webhook_ingress.go", `func (repo Repository) AcceptEvolutionWebhook`)
	normalized := strings.ToLower(strings.Join(strings.Fields(source), " "))
	for _, required := range []string{
		"tx, err := repo.db.pool().begin(ctx)",
		"first := parts[0]",
		"on conflict (event_key) do nothing",
		"clock_timestamp()",
		"if receipt.duplicate",
		"jsonb_to_recordset($4::jsonb)",
		"part.ordinal::double precision * interval '1 microsecond'",
		"order by part.ordinal",
		"if err := tx.commit(ctx)",
	} {
		if !strings.Contains(normalized, required) {
			t.Fatalf("batch persistence is missing %q\n%s", required, source)
		}
	}
	duplicateFence := strings.Index(normalized, "if receipt.duplicate")
	derivedInsert := strings.Index(normalized, "jsonb_to_recordset($4::jsonb)")
	if duplicateFence < 0 || derivedInsert < 0 || duplicateFence > derivedInsert {
		t.Fatalf("the original event key must fence derived inserts during rolling deploys\n%s", source)
	}
}

func TestReconnectMakesDurableOutboxRetriesImmediatelyEligible(t *testing.T) {
	query := strings.ToLower(strings.Join(strings.Fields(releaseWhatsAppOutboxRetriesAfterReconnectQuery), " "))
	for _, required := range []string{
		"update public.whatsapp_outbox",
		"set next_attempt_at = now()",
		"where organization_id = $1::uuid",
		"and session_id = $2::uuid",
		"and status = 'retry'",
		"and attempts < max_attempts",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("reconnect retry release is missing %q", required)
		}
	}
}

func TestReconnectReleasesOnlyCausallyOlderDefinitiveMediaQuarantine(t *testing.T) {
	source := readWhatsAppSourceFunction(t, "webhook_ingress.go", `func (repo Repository) applyEvolutionWebhookSessionState`)
	normalized := strings.ToLower(strings.Join(strings.Fields(source), " "))
	for _, required := range []string{
		`reconnected := state.status == "connected" && result.rowsaffected() > 0`,
		"delete from private.whatsapp_media_session_quarantine",
		"reason = 'media_provider_disconnected'",
		"updated_at <= $2::timestamptz",
		"state.occurredat.utc()",
		"wakewhatsappmediaworker()",
	} {
		if !strings.Contains(normalized, required) {
			t.Fatalf("causal media quarantine release is missing %q\n%s", required, source)
		}
	}
	if strings.Contains(normalized, "reason = 'media_provider_outcome_unknown'") {
		t.Fatal("generic reconnect can erase an outcome-unknown media cooldown")
	}

	processor := readWhatsAppSourceFunction(t, "webhook_native_processor.go", `func (repo Repository) processEvolutionWebhookNative`)
	if strings.Contains(strings.ToLower(processor), "delete from private.whatsapp_media_session_quarantine") {
		t.Fatal("backlogged native processing can bypass the webhook tuple/time fence")
	}
}

func TestEvolutionWebhookSessionStateCannotUndoExplicitLogout(t *testing.T) {
	source := readWhatsAppSourceFunction(t, "webhook_ingress.go", `func (repo Repository) applyEvolutionWebhookSessionState`)
	normalized := strings.ToLower(strings.Join(strings.Fields(source), " "))
	logoutGuard := "lower(coalesce(advanced_settings->>'auto_reconnect_enabled', 'true')) = 'false' and lower(coalesce(advanced_settings->>'auto_reconnect_blocked_reason', '')) = 'user_logged_out'"
	if got := strings.Count(normalized, logoutGuard); got != 2 {
		t.Fatalf("webhook session-state logout guard count = %d, want QR and connection guards\n%s", got, source)
	}
	if !strings.Contains(normalized, "$3 not in ('connected', 'qr_ready') or not (") {
		t.Fatalf("connection webhook guard must preserve disconnected events while rejecting connected/qr_ready after logout\n%s", source)
	}
}

func TestExplicitSessionCreationClearsLogoutMarkerBeforeConvergence(t *testing.T) {
	clear := readWhatsAppSourceFunction(t, "session_operations.go", `func clearSessionLifecycleSettings`)
	if !strings.Contains(clear, `"auto_reconnect_blocked_reason"`) {
		t.Fatalf("lifecycle cleanup must remove the terminal logout marker\n%s", clear)
	}

	for _, signature := range []string{
		`func (repo Repository) CreateSession`,
		`func (repo Repository) RecreateSession`,
	} {
		source := readWhatsAppSourceFunction(t, "session_operations.go", signature)
		enableAt := strings.LastIndex(source, `settings["auto_reconnect_enabled"] = true`)
		clearAt := strings.LastIndex(source, "clearSessionLifecycleSettings(settings)")
		if enableAt < 0 || clearAt < enableAt {
			t.Fatalf("%s must explicitly enable reconnect and clear the logout marker after provider connect\n%s", signature, source)
		}
	}
}

func TestParseEvolutionWebhookEnvelopeUsesScopedSessionAndHeaderToken(t *testing.T) {
	query := url.Values{
		"session_id":  []string{"45c7cc1f-6dad-4cf4-8df3-561858de4725"},
		"instance_id": []string{"instance-1"},
	}
	headers := http.Header{"X-Webhook-Token": []string{"secret-token"}}
	body := []byte(`{"event":"MESSAGE","instanceToken":"provider-secret","data":{"instanceId":"instance-1"}}`)

	envelope, err := parseEvolutionWebhookEnvelope(query, headers, body)
	if err != nil {
		t.Fatalf("parseEvolutionWebhookEnvelope() returned error: %v", err)
	}
	if envelope.SessionID != query.Get("session_id") {
		t.Fatalf("SessionID = %q, want %q", envelope.SessionID, query.Get("session_id"))
	}
	if envelope.InstanceID != "instance-1" {
		t.Fatalf("InstanceID = %q, want instance-1", envelope.InstanceID)
	}
	if envelope.RouteInstanceID != "instance-1" {
		t.Fatalf("RouteInstanceID = %q, want instance-1", envelope.RouteInstanceID)
	}
	if envelope.EventType != "message" {
		t.Fatalf("EventType = %q, want message", envelope.EventType)
	}
	if envelope.InstanceToken != "provider-secret" {
		t.Fatal("instanceToken was not read from the provider payload")
	}
	if len(envelope.WebhookHeaderTokens) != 1 || envelope.WebhookHeaderTokens[0] != "secret-token" {
		t.Fatal("webhook token was not read from the protected header")
	}
}

func TestEvolutionWebhookRouteAllowsMissingLegacyTokenButRejectsWrongOrConflictingToken(t *testing.T) {
	session := evolutionWebhookSession{
		InstanceID:   "instance-1",
		InstanceName: "office",
		WebhookToken: "legacy-secret",
		Status:       "connected",
		Active:       true,
	}

	if err := authorizeEvolutionWebhookRouteSession(session, evolutionWebhookEnvelope{RouteInstanceID: "instance-1"}); err != nil {
		t.Fatalf("token-free backend route was rejected: %v", err)
	}
	if err := authorizeEvolutionWebhookRouteSession(session, evolutionWebhookEnvelope{
		RouteInstanceID:     "instance-1",
		WebhookHeaderTokens: []string{"wrong-secret"},
	}); !errors.Is(err, errWebhookUnauthorized) {
		t.Fatalf("wrong legacy token error = %v, want unauthorized", err)
	}
	if err := authorizeEvolutionWebhookRouteSession(session, evolutionWebhookEnvelope{
		RouteInstanceID:     "instance-1",
		WebhookHeaderTokens: []string{"legacy-secret", "wrong-secret"},
	}); !errors.Is(err, errWebhookUnauthorized) {
		t.Fatalf("conflicting legacy tokens error = %v, want unauthorized", err)
	}
}

func TestEvolutionWebhookSessionInactiveRejectsDisabledStatus(t *testing.T) {
	if !evolutionWebhookSessionInactive(evolutionWebhookSession{Active: true, Status: " DISABLED "}) {
		t.Fatal("disabled WhatsApp sessions must reject webhook processing")
	}
	if evolutionWebhookSessionInactive(evolutionWebhookSession{Active: true, Status: "connected"}) {
		t.Fatal("an active connected WhatsApp session must remain eligible")
	}
}

func TestEvolutionWebhookRejectsEveryQueryCredential(t *testing.T) {
	for _, credential := range []string{"webhook_token", "apikey", "token", "Webhook_Token", "APIKEY", "ToKeN"} {
		t.Run(credential, func(t *testing.T) {
			query := url.Values{
				"session_id":  []string{"45c7cc1f-6dad-4cf4-8df3-561858de4725"},
				"instance_id": []string{"instance-1"},
				credential:    []string{"secret-must-not-be-in-a-url"},
			}
			_, err := parseEvolutionWebhookEnvelope(query, http.Header{}, []byte(`{"event":"MESSAGE"}`))
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("query credential error = %v, want ErrInvalidInput", err)
			}
		})
	}
}

func TestParseEvolutionWebhookEnvelopeRemovesCredentialsBeforePersistence(t *testing.T) {
	body := []byte(`{"event":"MESSAGE","instanceToken":"provider-secret","data":{"instance_token":"nested-secret","message":{"conversation":"hello"}},"webhook_token":"legacy-secret","__vimob_ingress":{"routing_key":"attacker-controlled"}}`)
	envelope, err := parseEvolutionWebhookEnvelope(
		url.Values{
			"session_id":  []string{"45c7cc1f-6dad-4cf4-8df3-561858de4725"},
			"instance_id": []string{"instance-1"},
		},
		http.Header{},
		body,
	)
	if err != nil {
		t.Fatalf("parseEvolutionWebhookEnvelope() returned error: %v", err)
	}
	if envelope.InstanceToken != "provider-secret" {
		t.Fatalf("InstanceToken = %q, want provider-secret for request authentication", envelope.InstanceToken)
	}
	if want := evolutionWebhookEventKey(envelope.SessionID, body); envelope.EventKey != want {
		t.Fatalf("EventKey = %q, want existing raw-payload deduplication key %q", envelope.EventKey, want)
	}
	stored := string(envelope.Payload)
	for _, secret := range []string{"provider-secret", "nested-secret", "legacy-secret", "instanceToken", "instance_token", "webhook_token", "attacker-controlled", evolutionWebhookRoutingMetaKey} {
		if strings.Contains(stored, secret) {
			t.Fatalf("sanitized inbox payload still contains %q: %s", secret, stored)
		}
	}
	if !strings.Contains(stored, `"conversation":"hello"`) {
		t.Fatalf("sanitized inbox payload lost message content: %s", stored)
	}
}

func TestEvolutionWebhookRouteRejectsMissingOrWrongInstanceBeforeReadingBody(t *testing.T) {
	session := evolutionWebhookSession{
		InstanceID: "instance-1",
		Status:     "connected",
		Active:     true,
	}
	for name, routeInstanceID := range map[string]string{
		"missing": "",
		"wrong":   "instance-2",
	} {
		t.Run(name, func(t *testing.T) {
			err := authorizeEvolutionWebhookRouteSession(session, evolutionWebhookEnvelope{RouteInstanceID: routeInstanceID})
			if !errors.Is(err, errWebhookSessionMismatch) {
				t.Fatalf("route error = %v, want session mismatch", err)
			}
		})
	}
}

func TestEvolutionWebhookBodyRequiresMatchingInstanceToken(t *testing.T) {
	session := evolutionWebhookSession{
		InstanceID:    "instance-1",
		InstanceToken: "provider-secret",
		WebhookToken:  "legacy-secret",
		Status:        "connected",
		Active:        true,
	}
	valid := evolutionWebhookEnvelope{
		RouteInstanceID: "instance-1",
		InstanceID:      "instance-1",
		InstanceToken:   "provider-secret",
	}
	if err := authorizeEvolutionWebhookEnvelopeSession(session, valid); err != nil {
		t.Fatalf("matching instanceToken was rejected: %v", err)
	}

	for name, instanceToken := range map[string]string{
		"missing": "",
		"wrong":   "wrong-provider-secret",
	} {
		t.Run(name, func(t *testing.T) {
			envelope := valid
			envelope.InstanceToken = instanceToken
			err := authorizeEvolutionWebhookEnvelopeSession(session, envelope)
			if !errors.Is(err, errWebhookUnauthorized) {
				t.Fatalf("body authentication error = %v, want unauthorized", err)
			}
			if err != nil && (strings.Contains(err.Error(), "provider-secret") || strings.Contains(err.Error(), "legacy-secret")) {
				t.Fatalf("authentication error leaked a token: %v", err)
			}
		})
	}
}

func TestParseEvolutionWebhookEnvelopeRejectsMissingSession(t *testing.T) {
	_, err := parseEvolutionWebhookEnvelope(url.Values{}, http.Header{}, []byte(`{"event":"MESSAGE"}`))
	if err == nil {
		t.Fatal("expected missing session_id to be rejected")
	}
}

func TestEvolutionWebhookEventKeyIsSessionScopedAndDeterministic(t *testing.T) {
	payload := []byte(`{"event":"MESSAGE","id":"abc"}`)
	first := evolutionWebhookEventKey("session-a", payload)
	second := evolutionWebhookEventKey("session-a", payload)
	otherSession := evolutionWebhookEventKey("session-b", payload)
	if first != second {
		t.Fatalf("event key is not deterministic: %q != %q", first, second)
	}
	if first == otherSession {
		t.Fatal("event key must be scoped by session")
	}
}

func TestEvolutionWebhookInlineSessionStateKeepsRealQRCodeOutOfInbox(t *testing.T) {
	envelope := evolutionWebhookEnvelope{
		EventType:  "qrcode.updated",
		EventKey:   "qr-event",
		Payload:    []byte(`{"event":"qrcode.updated","date_time":"2026-08-12T12:00:00Z","data":{"qrcode":"data:image/png;base64,qr-value"}}`),
		ReceivedAt: time.Date(2026, 8, 12, 12, 0, 1, 0, time.UTC),
	}
	state, err := evolutionWebhookInlineSessionState(envelope)
	if err != nil {
		t.Fatalf("evolutionWebhookInlineSessionState() returned error: %v", err)
	}
	if !state.Handled || state.QRCode != "data:image/png;base64,qr-value" || state.Status != "qr_ready" {
		t.Fatalf("inline QR state = %#v", state)
	}
	if !state.ProviderTimestamp || state.Rank != evolutionWebhookStateRankQRCode || state.EventKey != "qr-event" {
		t.Fatalf("inline QR version = %#v", state)
	}
}

func TestEvolutionWebhookInlineSessionStateDoesNotDropEmptyQRCodeEvent(t *testing.T) {
	envelope := evolutionWebhookEnvelope{
		EventType: "qrcode.updated",
		Payload:   []byte(`{"event":"qrcode.updated","data":{}}`),
	}
	state, err := evolutionWebhookInlineSessionState(envelope)
	if err != nil {
		t.Fatalf("evolutionWebhookInlineSessionState() returned error: %v", err)
	}
	if state.Handled || state.QRCode != "" || state.Status != "" {
		t.Fatalf("empty QR event must remain durable, got %#v", state)
	}
}

func TestEvolutionWebhookInlineSessionStateAcknowledgesQRTimeoutWithoutMutatingSession(t *testing.T) {
	envelope := evolutionWebhookEnvelope{
		EventType: "qrtimeout",
		EventKey:  "qr-timeout-event",
		Payload:   []byte(`{"event":"QR_TIMEOUT","data":{"attempts":1,"maxAttempts":5}}`),
	}
	state, err := evolutionWebhookInlineSessionState(envelope)
	if err != nil {
		t.Fatalf("evolutionWebhookInlineSessionState() returned error: %v", err)
	}
	if !state.Handled || state.QRCode != "" || state.Status != "" {
		t.Fatalf("QR timeout must be acknowledged without a session mutation, got %#v", state)
	}
}

func TestEvolutionWebhookInlineSessionStateAppliesTerminalConnectionStateImmediately(t *testing.T) {
	for _, fixture := range []struct {
		event      string
		payload    string
		wantStatus string
	}{
		{event: "connection.update", payload: `{"event":"connection.update","date_time":"2026-08-12T12:00:00Z","data":{"state":"connected"}}`, wantStatus: "connected"},
		{event: "connection.update", payload: `{"event":"connection.update","date_time":"2026-08-12T12:00:00Z","data":{"state":"disconnected"}}`, wantStatus: "disconnected"},
		{event: "connected", payload: `{"event":"connected","date_time":"2026-08-12T12:00:00Z","data":{}}`, wantStatus: "connected"},
		{event: "disconnected", payload: `{"event":"disconnected","date_time":"2026-08-12T12:00:00Z","data":{}}`, wantStatus: "disconnected"},
		{event: "loggedout", payload: `{"event":"loggedout","date_time":"2026-08-12T12:00:00Z","data":{}}`, wantStatus: "disconnected"},
		{event: "pairsuccess", payload: `{"event":"pairsuccess","date_time":"2026-08-12T12:00:00Z","data":{}}`, wantStatus: "connected"},
	} {
		t.Run(fixture.event+fixture.payload, func(t *testing.T) {
			envelope := evolutionWebhookEnvelope{
				EventType: fixture.event,
				Payload:   []byte(fixture.payload),
			}
			state, err := evolutionWebhookInlineSessionState(envelope)
			if err != nil {
				t.Fatalf("evolutionWebhookInlineSessionState() returned error: %v", err)
			}
			if !state.Handled || state.QRCode != "" || state.Status != fixture.wantStatus || state.Rank != evolutionWebhookStateRankTerminal {
				t.Fatalf("terminal connection state = %#v", state)
			}
		})
	}
}

func TestEvolutionWebhookInlineSessionStateKeepsUnversionedTerminalStateDurable(t *testing.T) {
	envelope := evolutionWebhookEnvelope{
		EventType:  "connection.update",
		EventKey:   "unversioned-connected",
		Payload:    []byte(`{"event":"connection.update","data":{"state":"connected"}}`),
		ReceivedAt: time.Date(2026, 8, 12, 12, 0, 1, 0, time.UTC),
	}
	state, err := evolutionWebhookInlineSessionState(envelope)
	if err != nil {
		t.Fatalf("evolutionWebhookInlineSessionState() returned error: %v", err)
	}
	if state.Handled || state.Status != "" || state.QRCode != "" {
		t.Fatalf("unversioned terminal event must remain durable, got %#v", state)
	}
}

func TestEvolutionWebhookInlineSessionStateDoesNotTreatMessageStateAsConnection(t *testing.T) {
	envelope := evolutionWebhookEnvelope{
		EventType: "message",
		Payload:   []byte(`{"event":"message","data":{"state":"connected","message":{"conversation":"hello"}}}`),
	}
	state, err := evolutionWebhookInlineSessionState(envelope)
	if err != nil {
		t.Fatalf("evolutionWebhookInlineSessionState() returned error: %v", err)
	}
	if state.Handled || state.QRCode != "" || state.Status != "" {
		t.Fatalf("message state must remain durable and must not clear QR: %#v", state)
	}
}

func TestEvolutionWebhookSessionStateVersionRejectsOlderQRCode(t *testing.T) {
	qrState, err := evolutionWebhookInlineSessionState(evolutionWebhookEnvelope{
		EventType:  "qrcode.updated",
		EventKey:   "qr",
		Payload:    []byte(`{"event":"qrcode.updated","date_time":"2026-08-12T12:00:00Z","data":{"qrcode":"qr-value"}}`),
		ReceivedAt: time.Date(2026, 8, 12, 12, 0, 2, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("QR state returned error: %v", err)
	}
	connectedState, err := evolutionWebhookInlineSessionState(evolutionWebhookEnvelope{
		EventType:  "connection.update",
		EventKey:   "connected",
		Payload:    []byte(`{"event":"connection.update","date_time":"2026-08-12T12:00:01Z","data":{"state":"connected"}}`),
		ReceivedAt: time.Date(2026, 8, 12, 12, 0, 2, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("connected state returned error: %v", err)
	}
	if !evolutionWebhookSessionStateNewer(connectedState, qrState) {
		t.Fatal("newer terminal state must supersede QR")
	}
	if evolutionWebhookSessionStateNewer(qrState, connectedState) {
		t.Fatal("older QR must not supersede terminal state")
	}
}

func TestEvolutionWebhookSessionStateTerminalWinsTimestampTie(t *testing.T) {
	at := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	qrState := evolutionWebhookSessionState{OccurredAt: at, Rank: evolutionWebhookStateRankQRCode, EventKey: "z"}
	terminalState := evolutionWebhookSessionState{OccurredAt: at, Rank: evolutionWebhookStateRankTerminal, EventKey: "a"}
	if !evolutionWebhookSessionStateNewer(terminalState, qrState) {
		t.Fatal("terminal state must win a provider timestamp tie")
	}
}

func TestSecureWebhookTokenEqual(t *testing.T) {
	if !secureWebhookTokenEqual("secret", "secret") {
		t.Fatal("equal tokens must match")
	}
	if secureWebhookTokenEqual("secret", "other") {
		t.Fatal("different tokens must not match")
	}
}

func TestEvolutionWebhookInstanceMatches(t *testing.T) {
	session := evolutionWebhookSession{InstanceID: "instance-1", InstanceName: "office"}
	if !evolutionWebhookInstanceMatches(session, evolutionWebhookEnvelope{InstanceID: "instance-1"}) {
		t.Fatal("expected matching instance ID")
	}
	if evolutionWebhookInstanceMatches(session, evolutionWebhookEnvelope{InstanceID: "instance-2"}) {
		t.Fatal("expected mismatched instance ID to be rejected")
	}
	if evolutionWebhookInstanceMatches(session, evolutionWebhookEnvelope{
		RouteInstanceID: "instance-1",
		InstanceID:      "instance-2",
	}) {
		t.Fatal("matching route query must not hide a mismatched provider payload")
	}
	if evolutionWebhookInstanceMatches(session, evolutionWebhookEnvelope{RouteInstanceID: "instance-2"}) {
		t.Fatal("mismatched route instance must be rejected")
	}
	if !evolutionWebhookInstanceMatches(session, evolutionWebhookEnvelope{}) {
		t.Fatal("missing provider signal should remain compatible with a session-scoped URL")
	}
}
