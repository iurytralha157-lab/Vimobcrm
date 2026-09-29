package whatsapp

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestCallRecordingProviderRequestDoesNotFollowTokenBearingRedirect(t *testing.T) {
	var redirected atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		redirected.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer destination.Close()
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("apikey") != "test-instance-token" {
			t.Error("provider did not receive its instance token")
		}
		http.Redirect(w, r, destination.URL, http.StatusFound)
	}))
	defer provider.Close()
	request, err := http.NewRequest(http.MethodGet, provider.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("apikey", "test-instance-token")
	client := callRecordingProviderHTTPClient(provider.Client())
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusFound || redirected.Load() != 0 {
		t.Fatalf("redirect status = %d, destination requests = %d", response.StatusCode, redirected.Load())
	}
}

func TestCallWebhookRetryKeepsSessionIdentityForEarlyRecording(t *testing.T) {
	item := pendingEvolutionWebhook{
		OrganizationID: "55f02ce7-4290-47f8-9ee3-61fc84619747",
		SessionID:      "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9",
		EventType:      "CallRecording",
	}
	session := evolutionWebhookSession{
		ID: item.SessionID, OrganizationID: item.OrganizationID,
		InstanceID: "instance-123", InstanceName: "canary",
	}
	retrySession, err := callWebhookRetrySession(item, session)
	if err != nil || !stringIn("instance-123", retrySession.InstanceID, retrySession.InstanceName) {
		t.Fatalf("retry lost instance identity: %+v, %v", retrySession, err)
	}
	for _, invalid := range []evolutionWebhookSession{
		{ID: item.SessionID, OrganizationID: item.OrganizationID},
		{ID: item.SessionID, OrganizationID: "other-org", InstanceID: session.InstanceID},
		{ID: "other-session", OrganizationID: item.OrganizationID, InstanceID: session.InstanceID},
	} {
		if _, err := callWebhookRetrySession(item, invalid); !errors.Is(err, errWebhookSessionMismatch) {
			t.Fatalf("mismatched retry session %+v was accepted: %v", invalid, err)
		}
	}
}

func TestEvolutionCallStateContractAndOrdering(t *testing.T) {
	makeEvent := func(state, peer string) []byte {
		t.Helper()
		value, err := json.Marshal(map[string]any{
			"event": "CallState",
			"data": map[string]any{
				"version": 1, "callId": "provider-123", "instanceId": "instance-123",
				"peerJid": peer, "direction": "incoming", "state": state,
				"occurredAt": time.Now().UTC().Add(-time.Minute).Format(time.RFC3339Nano),
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	event, err := parseEvolutionCallState(makeEvent("end_pending", "5511999999999@c.us"))
	if err != nil {
		t.Fatalf("parse canonical call: %v", err)
	}
	if event.PeerJID != "5511999999999@s.whatsapp.net" || event.InstanceID != "instance-123" {
		t.Fatalf("unexpected normalized call: %+v", event)
	}
	if _, err := parseEvolutionCallState(makeEvent("completed", "5511999999999@c.us")); err == nil {
		t.Fatal("unknown terminal state was accepted")
	}
	if _, err := parseEvolutionCallState(makeEvent("active", "120363@g.us")); err == nil {
		t.Fatal("group call was accepted")
	}
	if _, err := parseEvolutionCallState(makeEvent("active", "5511999999999@evil.invalid")); err == nil {
		t.Fatal("non-WhatsApp peer was accepted")
	}
	if !(callStateRank("active") < callStateRank("end_pending") &&
		callStateRank("end_pending") < callStateRank("outcome_unknown") &&
		callStateRank("outcome_unknown") < callStateRank("ended")) {
		t.Fatal("provisional states must precede confirmed terminal events")
	}
	now := time.Now()
	if got := nextCallState("end_pending", "ended", now, now.Add(-time.Second)); got != "ended" {
		t.Fatalf("confirmed terminal callback was lost to clock skew: %s", got)
	}
	if got := nextCallState("ended", "ringing", now, now.Add(time.Second)); got != "ended" {
		t.Fatalf("late ringing callback reopened a completed call: %s", got)
	}
	if got := nextCallState("outcome_unknown", "end_pending", now, now.Add(time.Second)); got != "outcome_unknown" {
		t.Fatalf("late end response erased uncertain outcome: %s", got)
	}
}

func TestEvolutionCallRecordingManifestRejectsUnsafeChannels(t *testing.T) {
	makeEvent := func(channels []map[string]any) []byte {
		t.Helper()
		value, err := json.Marshal(map[string]any{
			"event": "CallRecording",
			"data": map[string]any{
				"version": 1, "callId": "provider-123", "instanceId": "instance-123",
				"status": "complete", "occurredAt": time.Now().UTC().Format(time.RFC3339Nano),
				"channels": channels,
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	valid := map[string]any{"channel": "incoming", "sizeBytes": 44, "contentType": "audio/wav"}
	if _, err := parseEvolutionCallRecording(makeEvent([]map[string]any{valid})); err != nil {
		t.Fatalf("valid manifest rejected: %v", err)
	}
	if _, err := parseEvolutionCallRecording(makeEvent([]map[string]any{valid, valid})); err == nil {
		t.Fatal("duplicate recording channel was accepted")
	}
	if _, err := parseEvolutionCallRecording(makeEvent([]map[string]any{{"channel": "../incoming", "sizeBytes": 44, "contentType": "audio/wav"}})); err == nil {
		t.Fatal("path-like recording channel was accepted")
	}
}

func TestCallRecordingCompletionPreservesProviderPartial(t *testing.T) {
	incoming, outgoing := "incoming.wav", "outgoing.wav"
	for _, test := range []struct {
		name, provider, want string
		incoming, outgoing   *string
	}{
		{"complete with both channels", "complete", "ready", &incoming, &outgoing},
		{"provider partial despite both channels", "partial", "partial", &incoming, &outgoing},
		{"provider complete but one missing channel", "complete", "partial", &incoming, nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := callRecordingCompletionStatus(test.provider, test.incoming, test.outgoing); got != test.want {
				t.Fatalf("completion status = %q, want %q", got, test.want)
			}
		})
	}
}

func TestCallHistoryQueryRequiresStableCursorPair(t *testing.T) {
	const beforeID = "11111111-1111-4111-8111-111111111111"
	const beforeAt = "2026-09-27T12:34:56.123456Z"
	limit, at, id, err := parseCallHistoryQuery("", "", "")
	if err != nil || limit != 50 || at != nil || id != nil {
		t.Fatalf("default history query = %d, %v, %v, %v", limit, at, id, err)
	}
	limit, at, id, err = parseCallHistoryQuery("1000", beforeAt, beforeID)
	if err != nil || limit != 100 || at == nil || id == nil ||
		at.Format(time.RFC3339Nano) != beforeAt || *id != beforeID {
		t.Fatalf("cursor history query = %d, %v, %v, %v", limit, at, id, err)
	}
	for _, query := range [][3]string{
		{"0", "", ""}, {"junk", "", ""},
		{"", beforeAt, ""}, {"", "", beforeID},
		{"", "not-a-time", beforeID}, {"", beforeAt, "not-a-uuid"},
	} {
		if _, _, _, err := parseCallHistoryQuery(query[0], query[1], query[2]); err == nil {
			t.Fatalf("invalid history query %+v accepted", query)
		}
	}
}

func TestCallMediaTicketUsesExactHMACAndTrustedOrigin(t *testing.T) {
	secret := strings.Repeat("s", 32)
	claims := callMediaClaims{
		Version: 1, InstanceID: "instance-123", CallID: "provider-123",
		Subject: "user-123", Expires: time.Now().Add(30 * time.Second).Unix(),
		Nonce: "nonce-123",
	}
	ticket, err := signCallMediaClaims(claims, secret)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(ticket, ".")
	if len(parts) != 2 {
		t.Fatalf("ticket parts: %d", len(parts))
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(parts[0]))
	actual, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || !hmac.Equal(actual, mac.Sum(nil)) {
		t.Fatal("ticket signature does not match the Evo contract")
	}
	mediaURL, err := callMediaWebSocketURL("https://evogo.example.com", ticket)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(mediaURL)
	if err != nil || parsed.Scheme != "wss" || parsed.Host != "evogo.example.com" ||
		parsed.Path != "/call/media" || parsed.Query().Get("token") != ticket {
		t.Fatalf("unexpected media URL: %s, %v", mediaURL, err)
	}
	if _, err := callMediaWebSocketURL("https://user:pass@evogo.example.com", ticket); err == nil {
		t.Fatal("URL with userinfo was accepted")
	}
	if _, err := signCallMediaClaims(claims, "short"); err == nil {
		t.Fatal("weak or missing media secret was accepted")
	}
}
