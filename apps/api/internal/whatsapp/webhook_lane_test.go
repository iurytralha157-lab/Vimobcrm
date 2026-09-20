package whatsapp

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestEvolutionWebhookProcessingLaneSeparatesCurrentTrafficFromReplay(t *testing.T) {
	receivedAt := time.Date(2026, time.September, 9, 15, 0, 0, 0, time.UTC)
	payloadWithTimestamp := func(event string, body string, timestamp time.Time) []byte {
		return []byte(fmt.Sprintf(`{
			"event":%q,
			"data":{
				"Info":{"ID":"message-1","Chat":"5511999991111@s.whatsapp.net","Timestamp":%d},
				"Message":{"conversation":%q}
			}
		}`, event, timestamp.Unix(), body))
	}

	tests := []struct {
		name         string
		payload      []byte
		wantLane     string
		wantOccurred bool
	}{
		{
			name:         "current text is live",
			payload:      payloadWithTimestamp("messages.upsert", "mensagem atual", receivedAt.Add(-15*time.Second)),
			wantLane:     evolutionWebhookLaneLive,
			wantOccurred: true,
		},
		{
			name: "current outbound message is live",
			payload: []byte(fmt.Sprintf(`{
				"event":"messages.upsert",
				"data":{
					"Info":{
						"ID":"outbound-current",
						"Chat":"5511999991111@s.whatsapp.net",
						"IsFromMe":true,
						"Timestamp":%d
					},
					"Message":{"conversation":"mensagem enviada agora"}
				}
			}`, receivedAt.Add(-5*time.Second).Unix())),
			wantLane:     evolutionWebhookLaneLive,
			wantOccurred: true,
		},
		{
			name:         "old provider replay is backlog",
			payload:      payloadWithTimestamp("messages.upsert", "mensagem do dia 5", receivedAt.Add(-4*24*time.Hour)),
			wantLane:     evolutionWebhookLaneBacklog,
			wantOccurred: true,
		},
		{
			name: "valid text without provider timestamp is backlog",
			payload: []byte(`{
				"event":"messages.upsert",
				"data":{
					"Info":{"ID":"message-without-time","Chat":"5511999991111@s.whatsapp.net"},
					"Message":{"conversation":"mensagem atual sem relogio do provedor"}
				}
			}`),
			wantLane: evolutionWebhookLaneBacklog,
		},
		{
			name: "current direct receipt is live",
			payload: []byte(fmt.Sprintf(`{
				"event":"Receipt",
				"state":"Delivered",
				"data":{
					"Chat":"123456789012345@lid",
					"IsGroup":false,
					"MessageIDs":["outbound-1"],
					"Timestamp":%d
				}
			}`, receivedAt.Add(-5*time.Second).Unix())),
			wantLane:     evolutionWebhookLaneLive,
			wantOccurred: true,
		},
		{
			name: "current receipt without direct chat stays in backlog",
			payload: []byte(fmt.Sprintf(`{
				"event":"messages.update",
				"data":{"key":{"id":"outbound-1"},"status":"delivered","timestamp":%d}
			}`, receivedAt.Add(-5*time.Second).Unix())),
			wantLane:     evolutionWebhookLaneBacklog,
			wantOccurred: true,
		},
		{
			name: "current broadcast receipt stays in backlog",
			payload: []byte(fmt.Sprintf(`{
				"event":"Receipt",
				"state":"Read",
				"data":{
					"Chat":"status@broadcast",
					"IsGroup":true,
					"MessageIDs":["status-1"],
					"Timestamp":%d
				}
			}`, receivedAt.Add(-5*time.Second).Unix())),
			wantLane:     evolutionWebhookLaneBacklog,
			wantOccurred: true,
		},
		{
			name: "old receipt replay is backlog",
			payload: []byte(fmt.Sprintf(`{
				"event":"Receipt",
				"state":"Read",
				"data":{
					"Chat":"123456789012345@lid",
					"IsGroup":false,
					"MessageIDs":["outbound-old"],
					"Timestamp":%d
				}
			}`, receivedAt.Add(-24*time.Hour).Unix())),
			wantLane:     evolutionWebhookLaneBacklog,
			wantOccurred: true,
		},
		{
			name: "current image enters live as a placeholder",
			payload: []byte(fmt.Sprintf(`{
				"event":"messages.upsert",
				"data":{
					"Info":{"ID":"image-1","Chat":"5511999991111@s.whatsapp.net","Timestamp":%d},
					"Message":{"imageMessage":{"mimetype":"image/jpeg","caption":"foto"}}
				}
			}`, receivedAt.Add(-2*time.Second).Unix())),
			wantLane:     evolutionWebhookLaneLive,
			wantOccurred: true,
		},
		{
			name: "current video enters live as a placeholder",
			payload: []byte(fmt.Sprintf(`{
				"event":"messages.upsert",
				"data":{
					"Info":{"ID":"video-current","Chat":"5511999991111@s.whatsapp.net","Timestamp":%d},
					"Message":{"videoMessage":{"mimetype":"video/mp4","caption":"video atual","fileLength":1024}}
				}
			}`, receivedAt.Add(-2*time.Second).Unix())),
			wantLane:     evolutionWebhookLaneLive,
			wantOccurred: true,
		},
		{
			name: "old video replay stays in backlog",
			payload: []byte(fmt.Sprintf(`{
				"event":"messages.upsert",
				"data":{
					"Info":{"ID":"video-old","Chat":"5511999991111@s.whatsapp.net","Timestamp":%d},
					"Message":{"videoMessage":{"mimetype":"video/mp4","caption":"video antigo","fileLength":1024}}
				}
			}`, receivedAt.Add(-24*time.Hour).Unix())),
			wantLane:     evolutionWebhookLaneBacklog,
			wantOccurred: true,
		},
		{
			name: "history protocol never enters live lane",
			payload: []byte(`{
				"event":"messages.upsert",
				"data":{
					"Info":{"ID":"history-1","Chat":"5511999991111@s.whatsapp.net"},
					"Message":{"protocolMessage":{"type":"history_sync_notification"}}
				}
			}`),
			wantLane: evolutionWebhookLaneBacklog,
		},
		{
			name: "unsupported protocol stays out of live lane",
			payload: []byte(`{
				"event":"messages.upsert",
				"data":{
					"Info":{"ID":"protocol-1","Chat":"5511999991111@s.whatsapp.net"},
					"Message":{"protocolMessage":{"type":"APP_STATE_SYNC_KEY_SHARE"}}
				}
			}`),
			wantLane: evolutionWebhookLaneBacklog,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			lane, occurredAt := evolutionWebhookProcessingLane(evolutionWebhookEnvelope{
				EventType:  "messages.upsert",
				Payload:    test.payload,
				ReceivedAt: receivedAt,
			})
			if lane != test.wantLane {
				t.Fatalf("processing lane = %q, want %q", lane, test.wantLane)
			}
			if (occurredAt != nil) != test.wantOccurred {
				t.Fatalf("provider occurrence presence = %v, want %v", occurredAt != nil, test.wantOccurred)
			}
		})
	}
}

func TestEvolutionWebhookLiveLaneAcceptsSupportedDirectMessages(t *testing.T) {
	tests := []struct {
		name    string
		message nativeEvolutionMessage
		want    bool
	}{
		{
			name: "direct text",
			message: nativeEvolutionMessage{
				RemoteJID:   "5511999991111@s.whatsapp.net",
				MessageType: "text",
				Content:     "oi",
			},
			want: true,
		},
		{
			name: "group text",
			message: nativeEvolutionMessage{
				RemoteJID:   "120363000000000000@g.us",
				MessageType: "text",
				Content:     "oi grupo",
				IsGroup:     true,
			},
		},
		{
			name: "direct image",
			message: nativeEvolutionMessage{
				RemoteJID:   "5511999991111@s.whatsapp.net",
				MessageType: "image",
				Content:     "foto",
			},
			want: true,
		},
		{
			name: "direct video without caption",
			message: nativeEvolutionMessage{
				RemoteJID:   "5511999991111@s.whatsapp.net",
				MessageType: "VIDEO",
			},
			want: true,
		},
		{
			name: "empty direct text",
			message: nativeEvolutionMessage{
				RemoteJID:   "5511999991111@s.whatsapp.net",
				MessageType: "text",
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := nativeEvolutionMessageIsLatencyCritical(test.message); got != test.want {
				t.Fatalf("nativeEvolutionMessageIsLatencyCritical() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestEvolutionWebhookProcessingLaneKeepsCurrentTextAndVideoBatchLive(t *testing.T) {
	receivedAt := time.Date(2026, time.September, 9, 15, 0, 0, 0, time.UTC)
	payload := []byte(fmt.Sprintf(`{
		"event":"messages.upsert",
		"data":{"messages":[
			{
				"Info":{"ID":"current-text","Chat":"5511999991111@s.whatsapp.net","Timestamp":%d},
				"Message":{"conversation":"texto atual"}
			},
			{
				"Info":{"ID":"current-video","Chat":"5511999991111@s.whatsapp.net","Timestamp":%d},
				"Message":{"videoMessage":{"mimetype":"video/mp4","fileLength":1024}}
			}
		]}
	}`, receivedAt.Add(-2*time.Second).Unix(), receivedAt.Add(-time.Second).Unix()))

	lane, occurredAt := evolutionWebhookProcessingLane(evolutionWebhookEnvelope{
		EventType:  "messages.upsert",
		Payload:    payload,
		ReceivedAt: receivedAt,
	})
	if lane != evolutionWebhookLaneLive {
		t.Fatalf("current text+video batch lane = %q, want live", lane)
	}
	if occurredAt == nil || !occurredAt.Equal(receivedAt.Add(-2*time.Second)) {
		t.Fatalf("oldest provider occurrence = %v, want %v", occurredAt, receivedAt.Add(-2*time.Second))
	}
}

func TestEvolutionWebhookProcessingLaneLetsCurrentTextEscapeUnknownMixedBatch(t *testing.T) {
	receivedAt := time.Date(2026, time.September, 9, 15, 0, 0, 0, time.UTC)
	payload := []byte(fmt.Sprintf(`{
		"event":"messages.upsert",
		"data":{"messages":[
			{
				"Info":{"ID":"current","Chat":"5511999991111@s.whatsapp.net","Timestamp":%d},
				"Message":{"conversation":"atual"}
			},
			{
				"Info":{"ID":"old","Chat":"5511999992222@s.whatsapp.net","Timestamp":%d},
				"Message":{"conversation":"antiga"}
			}
		]}
	}`, receivedAt.Add(-time.Second).Unix(), receivedAt.Add(-24*time.Hour).Unix()))

	lane, occurredAt := evolutionWebhookProcessingLane(evolutionWebhookEnvelope{
		EventType:  "messages.upsert",
		Payload:    payload,
		ReceivedAt: receivedAt,
	})
	if lane != evolutionWebhookLaneLive {
		t.Fatalf("mixed-age batch lane = %q, want live", lane)
	}
	if occurredAt == nil || !occurredAt.Equal(receivedAt.Add(-24*time.Hour)) {
		t.Fatalf("oldest provider occurrence = %v, want %v", occurredAt, receivedAt.Add(-24*time.Hour))
	}
}

func TestPrepareEvolutionWebhookDurablePartsSplitsMixedAgeBatchAtomically(t *testing.T) {
	receivedAt := time.Date(2026, time.September, 9, 15, 0, 0, 0, time.UTC)
	payload := []byte(fmt.Sprintf(`{
		"event":"messages.upsert",
		"data":{"messages":[
			{
				"Info":{"ID":"old-video","Chat":"5511999991111@s.whatsapp.net","Timestamp":%d},
				"Message":{"videoMessage":{"mimetype":"video/mp4","fileLength":1024}}
			},
			{
				"Info":{"ID":"current-text","Chat":"5511999992222@s.whatsapp.net","Timestamp":%d},
				"Message":{"conversation":"texto atual"}
			}
		]}
	}`, receivedAt.Add(-24*time.Hour).Unix(), receivedAt.Add(-time.Second).Unix()))
	envelope := evolutionWebhookEnvelope{
		EventKey:   "evolution_go:original",
		EventType:  "messages.upsert",
		Payload:    payload,
		ReceivedAt: receivedAt,
	}

	parts, err := prepareEvolutionWebhookDurableParts(envelope)
	if err != nil {
		t.Fatalf("prepareEvolutionWebhookDurableParts() returned error: %v", err)
	}
	if len(parts) != 2 {
		t.Fatalf("durable parts = %d, want 2", len(parts))
	}
	if parts[0].EventKey != envelope.EventKey || parts[1].EventKey == envelope.EventKey || parts[1].EventKey == "" {
		t.Fatalf("event keys = %q, %q", parts[0].EventKey, parts[1].EventKey)
	}
	if parts[0].ProcessingLane != evolutionWebhookLaneBacklog || parts[1].ProcessingLane != evolutionWebhookLaneLive {
		t.Fatalf("part lanes = %q, %q, want backlog/live", parts[0].ProcessingLane, parts[1].ProcessingLane)
	}
	if parts[0].Ordinal != 0 || parts[1].Ordinal != 1 {
		t.Fatalf("part ordinals = %d then %d", parts[0].Ordinal, parts[1].Ordinal)
	}
	for index, part := range parts {
		decoded, err := decodeNativeEvolutionPayload(part.Payload)
		if err != nil {
			t.Fatalf("decode part %d: %v", index, err)
		}
		if messages := extractNativeEvolutionMessages(decoded); len(messages) != 1 {
			t.Fatalf("part %d messages = %d, want 1", index, len(messages))
		}
		metadata := mapFromAny(decoded[evolutionWebhookRoutingMetaKey])
		if route := firstString(metadata, "routing_key"); route == "" || route == evolutionWebhookSessionRoute {
			t.Fatalf("part %d route = %q, want a contact route", index, route)
		}
	}

	repeated, err := prepareEvolutionWebhookDurableParts(envelope)
	if err != nil {
		t.Fatalf("repeat prepareEvolutionWebhookDurableParts() returned error: %v", err)
	}
	if len(repeated) != 2 || repeated[1].EventKey != parts[1].EventKey {
		t.Fatalf("derived dedupe key changed: %#v then %#v", parts, repeated)
	}
}

func TestPrepareEvolutionWebhookDurablePartsKeepsMissingTimestampOutOfLiveLane(t *testing.T) {
	envelope := evolutionWebhookEnvelope{
		EventKey:  "evolution_go:no-timestamp",
		EventType: "messages.upsert",
		Payload: []byte(`{
			"event":"messages.upsert",
			"data":{"messages":[
				{"Info":{"ID":"unknown-time","Chat":"5511999991111@s.whatsapp.net"},"Message":{"conversation":"sem hora"}},
				{"Info":{"ID":"current","Chat":"5511999992222@s.whatsapp.net","Timestamp":1788966000},"Message":{"conversation":"atual"}}
			]}
		}`),
		ReceivedAt: time.Unix(1788966001, 0).UTC(),
	}
	parts, err := prepareEvolutionWebhookDurableParts(envelope)
	if err != nil {
		t.Fatalf("prepareEvolutionWebhookDurableParts() returned error: %v", err)
	}
	if len(parts) != 2 || parts[0].ProcessingLane != evolutionWebhookLaneBacklog || parts[1].ProcessingLane != evolutionWebhookLaneLive {
		t.Fatalf("missing/current timestamp lanes = %#v, want backlog/live", parts)
	}
}

func TestPrepareEvolutionWebhookDurablePartsIsolatesCurrentTextFromHistoryControl(t *testing.T) {
	receivedAt := time.Date(2026, time.September, 9, 15, 0, 0, 0, time.UTC)
	envelope := evolutionWebhookEnvelope{
		EventKey:  "evolution_go:text-and-history-control",
		EventType: "messages.upsert",
		Payload: []byte(fmt.Sprintf(`{
			"event":"messages.upsert",
			"data":{"messages":[
				{"Info":{"ID":"current","Chat":"5511999991111@s.whatsapp.net","Timestamp":%d},"Message":{"conversation":"atual"}},
				{"Info":{"ID":"history-control","Chat":"5511999991111@s.whatsapp.net"},"Message":{"protocolMessage":{"type":"history_sync_notification"}}}
			]}
		}`, receivedAt.Add(-time.Second).Unix())),
		ReceivedAt: receivedAt,
	}
	parts, err := prepareEvolutionWebhookDurableParts(envelope)
	if err != nil {
		t.Fatalf("prepareEvolutionWebhookDurableParts() returned error: %v", err)
	}
	if len(parts) != 2 || parts[0].ProcessingLane != evolutionWebhookLaneLive || parts[1].ProcessingLane != evolutionWebhookLaneBacklog {
		t.Fatalf("text/history parts = %#v, want live/backlog", parts)
	}
	if !evolutionWebhookIsHistorySyncControl(pendingEvolutionWebhook{EventType: envelope.EventType, Payload: parts[1].Payload}) {
		t.Fatal("isolated history-control part was not recognized by the worker")
	}
}

func TestSplitEvolutionWebhookMessageBatchSupportsProviderArrayShapes(t *testing.T) {
	messageOne := `{"Info":{"ID":"one","Chat":"5511999991111@s.whatsapp.net","Timestamp":1788966000},"Message":{"conversation":"um"}}`
	messageTwo := `{"Info":{"ID":"two","Chat":"5511999992222@s.whatsapp.net","Timestamp":1788966001},"Message":{"conversation":"dois"}}`
	for name, payload := range map[string]string{
		"top-level messages": `{"event":"messages.upsert","messages":[` + messageOne + `,` + messageTwo + `]}`,
		"nested messages":    `{"event":"messages.upsert","data":{"messages":[` + messageOne + `,` + messageTwo + `]}}`,
		"data array":         `{"event":"messages.upsert","data":[` + messageOne + `,` + messageTwo + `]}`,
		"message array":      `{"event":"messages.upsert","message":[` + messageOne + `,` + messageTwo + `]}`,
	} {
		t.Run(name, func(t *testing.T) {
			parts, split, err := splitEvolutionWebhookMessageBatch([]byte(payload))
			if err != nil {
				t.Fatal(err)
			}
			if !split || len(parts) != 2 {
				t.Fatalf("split = %v, parts = %d, want true/2", split, len(parts))
			}
			for index, part := range parts {
				decoded, err := decodeNativeEvolutionPayload(part)
				if err != nil || len(extractNativeEvolutionMessages(decoded)) != 1 {
					t.Fatalf("part %d is not one message: %s (%v)", index, part, err)
				}
			}
		})
	}
}

func TestSplitEvolutionWebhookMessageBatchBoundsWriteAmplification(t *testing.T) {
	var messages strings.Builder
	for index := 0; index < evolutionWebhookMaxSplitMessages+1; index++ {
		if index > 0 {
			messages.WriteByte(',')
		}
		phone := "5511999991111"
		if index%3 == 2 {
			phone = "5511999992222"
		}
		_, _ = fmt.Fprintf(&messages, `{"Info":{"ID":"message-%d","Chat":"%s@s.whatsapp.net","Timestamp":1788966000},"Message":{"conversation":"oi"}}`, index, phone)
	}
	payload := []byte(`{"event":"messages.upsert","data":{"messages":[` + messages.String() + `]}}`)
	parts, split, err := splitEvolutionWebhookMessageBatch(payload)
	if err != nil {
		t.Fatal(err)
	}
	if split || len(parts) != 0 {
		t.Fatalf("oversized provider batch split = %v with %d parts", split, len(parts))
	}
	durable, err := prepareEvolutionWebhookDurableParts(evolutionWebhookEnvelope{
		EventKey:   "evolution_go:bounded",
		EventType:  "messages.upsert",
		Payload:    payload,
		ReceivedAt: time.Unix(1788966001, 0).UTC(),
	})
	if err != nil || len(durable) != 1 {
		t.Fatalf("bounded durable parts = %d, error = %v, want one original row", len(durable), err)
	}
	decoded, err := decodeNativeEvolutionPayload(durable[0].Payload)
	if err != nil {
		t.Fatal(err)
	}
	metadata := mapFromAny(decoded[evolutionWebhookRoutingMetaKey])
	if got := firstString(metadata, "routing_key"); got != evolutionWebhookSessionRoute {
		t.Fatalf("mixed >128 scheduling route = %q, want session serialization", got)
	}
	extracted := extractNativeEvolutionMessages(decoded)
	if len(extracted) != evolutionWebhookMaxSplitMessages+1 {
		t.Fatalf("mixed >128 extracted messages = %d", len(extracted))
	}
	for index, want := range []string{"phone:5511999991111", "phone:5511999991111", "phone:5511999992222"} {
		if got := evolutionWebhookMessageBindingRoutingKey(extracted[index]); got != want {
			t.Fatalf("message %d binding route = %q, want %q", index, got, want)
		}
	}
}

func TestUnsplitMultiLocationKeepsReactionAndInboundContactRoutes(t *testing.T) {
	payload := []byte(`{
		"event":"messages.upsert",
		"messages":[{
			"Info":{"ID":"reaction-first","Chat":"5511999991111@s.whatsapp.net","Timestamp":1788966000},
			"Message":{"reactionMessage":{"key":{"id":"target"},"text":"ok"}}
		}],
		"data":{"messages":[{
			"Info":{"ID":"inbound-second","Chat":"5511999991111@s.whatsapp.net","Timestamp":1788966001},
			"Message":{"conversation":"oi"}
		}]}
	}`)
	parts, split, err := splitEvolutionWebhookMessageBatch(payload)
	if err != nil {
		t.Fatal(err)
	}
	if split || len(parts) != 0 {
		t.Fatalf("multi-location callback split = %v with %d parts, want one durable envelope", split, len(parts))
	}
	durable, err := prepareEvolutionWebhookDurableParts(evolutionWebhookEnvelope{
		EventKey: "evolution_go:multi-location", EventType: "messages.upsert",
		Payload: payload, ReceivedAt: time.Unix(1788966002, 0).UTC(),
	})
	if err != nil || len(durable) != 1 {
		t.Fatalf("multi-location durable parts = %d, error = %v", len(durable), err)
	}
	decoded, err := decodeNativeEvolutionPayload(durable[0].Payload)
	if err != nil {
		t.Fatal(err)
	}
	messages := extractNativeEvolutionMessages(decoded)
	if len(messages) != 2 || !messages[0].IsReaction || messages[1].IsReaction {
		t.Fatalf("multi-location message order/types = %#v", messages)
	}
	for index, message := range messages {
		if got := evolutionWebhookMessageBindingRoutingKey(message); got != "phone:5511999991111" {
			t.Fatalf("multi-location message %d binding route = %q", index, got)
		}
	}
}

func TestEvolutionWebhookProviderPayloadRemovesInternalOrderingMetadata(t *testing.T) {
	stored, err := annotateEvolutionWebhookRouting([]byte(`{
		"event":"messages.upsert",
		"data":{"Info":{"ID":"message-1","Chat":"5511999991111@s.whatsapp.net","Timestamp":1788966000},"Message":{"conversation":"oi"}}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(stored), evolutionWebhookRoutingMetaKey) {
		t.Fatalf("stored payload is missing routing metadata: %s", stored)
	}
	forwarded := evolutionWebhookProviderPayload(stored)
	if strings.Contains(string(forwarded), evolutionWebhookRoutingMetaKey) {
		t.Fatalf("provider payload leaked routing metadata: %s", forwarded)
	}
	decoded, err := decodeNativeEvolutionPayload(forwarded)
	if err != nil || len(extractNativeEvolutionMessages(decoded)) != 1 {
		t.Fatalf("provider payload lost its message: %s (%v)", forwarded, err)
	}
}

func TestEvolutionWebhookRoutingKeyUnifiesPhoneAndScopesOpaqueIdentity(t *testing.T) {
	routeFor := func(t *testing.T, payload string) string {
		t.Helper()
		decoded, err := decodeNativeEvolutionPayload([]byte(payload))
		if err != nil {
			t.Fatal(err)
		}
		return evolutionWebhookPayloadRoutingKey(decoded)
	}
	numericRoute := routeFor(t, `{
		"event":"messages.upsert",
		"data":{"Info":{"ID":"numeric","Chat":"5511999991111@s.whatsapp.net","Timestamp":1788966000},"Message":{"conversation":"oi"}}
	}`)
	lidWithPhoneRoute := routeFor(t, `{
		"event":"messages.upsert",
		"data":{"Info":{"ID":"lid","Chat":"123456789@lid","SenderPN":"5511999991111@s.whatsapp.net","Timestamp":1788966001},"Message":{"conversation":"oi"}}
	}`)
	if numericRoute == evolutionWebhookSessionRoute || lidWithPhoneRoute != "jid:123456789@lid" {
		t.Fatalf("phone route = %q, promoted LID route = %q", numericRoute, lidWithPhoneRoute)
	}
	internationalRoute := routeFor(t, `{
		"event":"messages.upsert",
		"data":{"Info":{"ID":"international","Chat":"14155551234@s.whatsapp.net","Timestamp":1788966001},"Message":{"conversation":"hello"}}
	}`)
	if internationalRoute != "phone:14155551234" {
		t.Fatalf("international route = %q, want provider digits without locale rewrite", internationalRoute)
	}
	opaqueRoute := routeFor(t, `{
		"event":"messages.upsert",
		"data":{"Info":{"ID":"opaque","Chat":"123456789@lid","Timestamp":1788966002},"Message":{"conversation":"oi"}}
	}`)
	if opaqueRoute != "jid:123456789@lid" {
		t.Fatalf("opaque route = %q, want stable session-scoped LID", opaqueRoute)
	}
	if opaqueRoute != lidWithPhoneRoute {
		t.Fatalf("LID route changed after SenderPN appeared: %q then %q", opaqueRoute, lidWithPhoneRoute)
	}
}
