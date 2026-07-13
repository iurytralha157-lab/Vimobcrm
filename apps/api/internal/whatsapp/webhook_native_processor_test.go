package whatsapp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
)

func TestNativeEvolutionFixtures(t *testing.T) {
	t.Run("text", func(t *testing.T) {
		payload := decodeNativeFixture(t, "message_text.json")
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 {
			t.Fatalf("messages = %d, want 1", len(messages))
		}
		message := messages[0]
		if message.ProviderMessageID != "provider-inbound-text-1" || message.RemoteJID != "5511999991111@s.whatsapp.net" || message.Content != "Mensagem recebida pelo backend" || message.FromMe {
			t.Fatalf("unexpected normalized text message: %#v", message)
		}
	})

	t.Run("media", func(t *testing.T) {
		payload := decodeNativeFixture(t, "message_media.json")
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 {
			t.Fatalf("messages = %d, want 1", len(messages))
		}
		message := messages[0]
		if message.MessageType != "image" || message.MediaMimeType != "image/png" || message.MediaBase64 == "" || message.Content != "Foto do imóvel" {
			t.Fatalf("unexpected normalized media message: %#v", message)
		}
	})

	t.Run("provider media keeps only official protobuf block", func(t *testing.T) {
		payload := decodeNativeFixture(t, "message_media_provider.json")
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 || messages[0].MediaBase64 != "" || messages[0].MediaURL != "" {
			t.Fatalf("provider media was not normalized: %#v", messages)
		}
		providerMessage, err := nativeEvolutionProviderMessage(messages[0])
		if err != nil {
			t.Fatal(err)
		}
		if len(providerMessage) != 1 || mapFromAny(providerMessage["imageMessage"])["directPath"] == nil {
			t.Fatalf("provider message was not minimized: %#v", providerMessage)
		}
	})

	t.Run("reaction", func(t *testing.T) {
		payload := decodeNativeFixture(t, "message_reaction.json")
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 {
			t.Fatalf("messages = %d, want 1", len(messages))
		}
		message := messages[0]
		if !message.IsReaction || message.ReactionTargetID != "provider-outbound-for-reaction" || message.ReactionEmoji != "❤️" {
			t.Fatalf("unexpected normalized reaction: %#v", message)
		}
	})

	t.Run("status", func(t *testing.T) {
		payload := decodeNativeFixture(t, "message_status.json")
		statuses := extractNativeEvolutionStatuses(payload)
		if len(statuses) != 1 || statuses[0].Status != "read" || len(statuses[0].MessageIDs) != 1 || statuses[0].MessageIDs[0] != "provider-outbound-status" {
			t.Fatalf("unexpected normalized statuses: %#v", statuses)
		}
	})

	t.Run("unverified campaign is detected", func(t *testing.T) {
		payload := decodeNativeFixture(t, "meta_referral.json")
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 || !messages[0].HasCampaignSignal {
			t.Fatalf("campaign signal was not detected: %#v", messages)
		}
	})

	t.Run("verified campaign fields", func(t *testing.T) {
		payload := decodeNativeFixture(t, "meta_referral_verified.json")
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 || messages[0].CampaignSourceType != "ad" || messages[0].CampaignSourceID != "123456789012345" || messages[0].CampaignPropertyCode != "PROP-META-1" {
			t.Fatalf("verified campaign fields were not normalized: %#v", messages)
		}
	})

	t.Run("LID quarantine identity", func(t *testing.T) {
		payload := decodeNativeFixture(t, "message_lid_quarantine.json")
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 || !messages[0].UnsupportedID || messages[0].ContactPhone != "" || messages[0].RemoteJID != "987654321012345@lid" {
			t.Fatalf("LID identity was not normalized for quarantine: %#v", messages)
		}
	})

	t.Run("LID promotion identity", func(t *testing.T) {
		payload := decodeNativeFixture(t, "message_lid_promote.json")
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 || messages[0].ContactPhone != "5511666665555" || messages[0].RemoteJID != "5511666665555@s.whatsapp.net" {
			t.Fatalf("LID promotion identity was not normalized: %#v", messages)
		}
		if !stringIn("987654321012345@lid", messages[0].RemoteAliases...) {
			t.Fatalf("LID alias was not preserved for promotion: %#v", messages[0].RemoteAliases)
		}
	})

	t.Run("delete protocol", func(t *testing.T) {
		payload := decodeNativeFixture(t, "message_delete.json")
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 || !messages[0].IsDeletion || messages[0].DeletionTargetID != "provider-delete-target" || messages[0].UnsupportedMessage {
			t.Fatalf("delete protocol was not normalized: %#v", messages)
		}
	})

	t.Run("session lifecycle", func(t *testing.T) {
		qrPayload := decodeNativeFixture(t, "qr.json")
		if qr := nativeEvolutionQRCode(qrPayload); qr != "data:image/png;base64,qr-native-fixture" {
			t.Fatalf("qr = %q", qr)
		}
		connectionPayload := decodeNativeFixture(t, "connection.json")
		status, recognized, connectionErr := nativeEvolutionConnectionStatus(connectionPayload, "connection.update")
		if !recognized || status != "connected" || connectionErr != "" {
			t.Fatalf("connection = %q, %v, %q", status, recognized, connectionErr)
		}
	})
}

func TestNativeMessageStatusIsMonotonic(t *testing.T) {
	tests := []struct {
		current  string
		incoming string
		want     string
	}{
		{"sent", "pending", "sent"},
		{"sent", "queued", "sent"},
		{"delivered", "pending", "delivered"},
		{"delivered", "queued", "delivered"},
		{"delivered", "sent", "delivered"},
		{"read", "sent", "read"},
		{"delivered", "failed", "delivered"},
		{"sent", "read", "read"},
	}
	for _, test := range tests {
		if got := nativeMonotonicStatus(test.current, test.incoming); got != test.want {
			t.Fatalf("nativeMonotonicStatus(%q, %q) = %q, want %q", test.current, test.incoming, got, test.want)
		}
	}
}

func TestNativeLIDPromotionFailsClosedOnLeadConflict(t *testing.T) {
	if _, err := safeNativeMergedLeadID("lead-a", "lead-b", "lead-a"); err == nil {
		t.Fatal("conflicting canonical and LID lead ownership was accepted")
	}
	if _, err := safeNativeMergedLeadID("", "lead-a", ""); err == nil {
		t.Fatal("an existing LID lead was promoted without phone verification")
	}
	if got, err := safeNativeMergedLeadID("lead-a", "lead-a", "lead-a"); err != nil || got != "lead-a" {
		t.Fatalf("verified identical lead ownership = %q, %v", got, err)
	}
}

func TestNativeInboundRuleUsesOnlyTheSelectedField(t *testing.T) {
	message := nativeEvolutionMessage{Content: "codigo 123456789012345 no texto"}
	rule := nativeInboundRule{
		MatchType:     "exact",
		MatchField:    "ad_id",
		MatchValue:    "123456789012345",
		CampaignLabel: "123456789012345",
	}
	if nativeInboundRuleMatches(rule, message) {
		t.Fatal("ad_id rule matched plain message content or its own output label")
	}
	message.CampaignSourceID = "123456789012345"
	if !nativeInboundRuleMatches(rule, message) {
		t.Fatal("ad_id rule did not match the normalized referral ad id")
	}
}

func TestNativeMessageAliasesNeverMergeGroupParticipantOrOwnDevice(t *testing.T) {
	group, ok := normalizeNativeEvolutionMessage(map[string]any{
		"Info": map[string]any{
			"ID":       "group-message",
			"Chat":     "120363000000000000@g.us",
			"SenderPN": "5511777776666@s.whatsapp.net",
			"IsGroup":  true,
		},
		"Message": map[string]any{"conversation": "Oi grupo"},
	})
	if !ok || !group.IsGroup {
		t.Fatalf("group message was not normalized: %#v", group)
	}
	for _, alias := range group.RemoteAliases {
		if alias == "5511777776666@s.whatsapp.net" {
			t.Fatalf("group participant leaked into group aliases: %#v", group.RemoteAliases)
		}
	}

	outbound, ok := normalizeNativeEvolutionMessage(map[string]any{
		"Info": map[string]any{
			"ID":          "outbound-message",
			"Chat":        "5511999991111@s.whatsapp.net",
			"RecipientPN": "5511999991111@s.whatsapp.net",
			"SenderPN":    "5511888887777@s.whatsapp.net",
			"IsFromMe":    true,
			"PushName":    "Minha instância",
		},
		"contactName": "Contato correto",
		"Message":     map[string]any{"conversation": "Oi contato"},
	})
	if !ok || outbound.RemoteJID != "5511999991111@s.whatsapp.net" || outbound.ContactName != "Contato correto" {
		t.Fatalf("outbound contact was not normalized: %#v", outbound)
	}
	for _, alias := range outbound.RemoteAliases {
		if alias == "5511888887777@s.whatsapp.net" {
			t.Fatalf("own device leaked into contact aliases: %#v", outbound.RemoteAliases)
		}
	}
}

func TestEvolutionWebhookProcessorModeDefaultsToEdge(t *testing.T) {
	if mode := normalizeEvolutionWebhookProcessorMode(""); mode != webhookProcessorEdge {
		t.Fatalf("default mode = %q, want edge", mode)
	}
	if mode := normalizeEvolutionWebhookProcessorMode("native_fallback"); mode != webhookProcessorNativeFallback {
		t.Fatalf("explicit mode = %q, want native_fallback", mode)
	}
}

func TestEvolutionWebhookProcessorModeIsSessionGated(t *testing.T) {
	const (
		canarySession = "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"
		otherSession  = "c15fe784-741b-4764-a60c-c60ffc50d606"
	)

	if mode := evolutionWebhookProcessorModeForSession(webhookProcessorNativeFallback, nil, canarySession); mode != webhookProcessorEdge {
		t.Fatalf("empty rollout mode = %q, want edge", mode)
	}
	if mode := evolutionWebhookProcessorModeForSession(webhookProcessorNativeFallback, []string{canarySession}, otherSession); mode != webhookProcessorEdge {
		t.Fatalf("non-canary mode = %q, want edge", mode)
	}
	if mode := evolutionWebhookProcessorModeForSession(webhookProcessorNativeFallback, []string{canarySession}, canarySession); mode != webhookProcessorNativeFallback {
		t.Fatalf("canary mode = %q, want native_fallback", mode)
	}
	if mode := evolutionWebhookProcessorModeForSession(webhookProcessorNative, []string{"*"}, otherSession); mode != webhookProcessorNative {
		t.Fatalf("wildcard mode = %q, want native", mode)
	}
}

func TestNativeFallbackNeverForwardsUnsupportedMessageOrCampaignToEdge(t *testing.T) {
	const sessionID = "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"
	var edgeCalls atomic.Int32
	edge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		edgeCalls.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer edge.Close()

	repo := Repository{functions: functionsClient{
		apiKey:                   "edge-api-key",
		evolutionWebhookURL:      edge.URL,
		webhookProcessorMode:     webhookProcessorNativeFallback,
		webhookRolloutSessionIDs: []string{sessionID},
		httpClient:               edge.Client(),
	}}
	tests := []struct {
		name      string
		eventType string
		payload   string
	}{
		{
			name:      "unsupported protocol message",
			eventType: "messages.upsert",
			payload: `{
				"event":"messages.upsert",
				"data":{
					"Info":{"ID":"unsupported-message-1","Chat":"5511999991111@s.whatsapp.net"},
					"Message":{"protocolMessage":{"type":"history_sync_notification"}}
				}
			}`,
		},
		{
			name:      "unsupported campaign referral",
			eventType: "campaign.referral",
			payload:   `{"event":"campaign.referral","data":{"referral":{"source_type":"unknown","source_id":"not-verified"}}}`,
		},
		{
			name:      "campaign hidden under unknown event",
			eventType: "unknown",
			payload:   `{"event":"unknown","data":{"ad":{"source_type":"ad","source_id":"123456789"}}}`,
		},
		{
			name:      "unrecognized generic status",
			eventType: "status",
			payload:   `{"event":"status","data":{"state":"unexpected"}}`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := repo.dispatchEvolutionWebhook(context.Background(), pendingEvolutionWebhook{
				OrganizationID: "55f02ce7-4290-47f8-9ee3-61fc84619747",
				SessionID:      sessionID,
				EventType:      test.eventType,
				WebhookToken:   "legacy-secret",
				Payload:        []byte(test.payload),
			})
			if !errors.Is(err, errNativeWebhookMessageLikeUnsupported) {
				t.Fatalf("dispatch error = %v, want fail-closed message-like error", err)
			}
		})
	}
	if got := edgeCalls.Load(); got != 0 {
		t.Fatalf("unsupported message-like events reached Edge %d times", got)
	}
}

func TestNativeFallbackStillForwardsNonMessageLifecycleEvent(t *testing.T) {
	const sessionID = "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"
	var edgeCalls atomic.Int32
	edge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		edgeCalls.Add(1)
		if got := r.Header.Get("x-webhook-token"); got != "legacy-secret" {
			t.Errorf("legacy fallback token = %q", got)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer edge.Close()

	repo := Repository{functions: functionsClient{
		apiKey:                   "edge-api-key",
		evolutionWebhookURL:      edge.URL,
		webhookProcessorMode:     webhookProcessorNativeFallback,
		webhookRolloutSessionIDs: []string{sessionID},
		httpClient:               edge.Client(),
	}}
	err := repo.dispatchEvolutionWebhook(context.Background(), pendingEvolutionWebhook{
		OrganizationID: "55f02ce7-4290-47f8-9ee3-61fc84619747",
		SessionID:      sessionID,
		EventType:      "presence.update",
		WebhookToken:   "legacy-secret",
		Payload:        []byte(`{"event":"presence.update","data":{"presence":"available"}}`),
	})
	if err != nil {
		t.Fatalf("non-message fallback failed: %v", err)
	}
	if got := edgeCalls.Load(); got != 1 {
		t.Fatalf("non-message lifecycle event reached Edge %d times, want 1", got)
	}
}

func decodeNativeFixture(t *testing.T, name string) map[string]any {
	t.Helper()
	raw := readNativeFixture(t, name)
	payload, err := decodeNativeEvolutionPayload(raw)
	if err != nil {
		t.Fatal(err)
	}
	return payload
}

func readNativeFixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "evolution_go", name))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
