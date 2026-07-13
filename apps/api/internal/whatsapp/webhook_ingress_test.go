package whatsapp

import (
	"errors"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

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
	if len(envelope.LegacyWebhookTokens) != 1 || envelope.LegacyWebhookTokens[0] != "secret-token" {
		t.Fatal("legacy webhook token was not read from the protected header")
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
		LegacyWebhookTokens: []string{"wrong-secret"},
	}); !errors.Is(err, errWebhookUnauthorized) {
		t.Fatalf("wrong legacy token error = %v, want unauthorized", err)
	}
	if err := authorizeEvolutionWebhookRouteSession(session, evolutionWebhookEnvelope{
		RouteInstanceID:     "instance-1",
		LegacyWebhookTokens: []string{"legacy-secret", "wrong-secret"},
	}); !errors.Is(err, errWebhookUnauthorized) {
		t.Fatalf("conflicting legacy tokens error = %v, want unauthorized", err)
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
