package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestReceiptEffectPartsKeepEachTargetDurableAndDeterministic(t *testing.T) {
	envelope := evolutionWebhookEnvelope{EventKey: "synthetic-original-key", EventType: "Receipt", ReceivedAt: time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC),
		Payload: []byte(`{"event":"Receipt","state":"Read","data":{"MessageIDs":["KNOWN","FUTURE","FOREIGN"],"Timestamp":1791979199}}`)}
	parts, err := prepareEvolutionWebhookDurableParts(envelope)
	if err != nil || len(parts) != 3 {
		t.Fatalf("parts=%d error=%v, want 3 durable effects", len(parts), err)
	}
	replay, err := prepareEvolutionWebhookDurableParts(envelope)
	if err != nil || !reflect.DeepEqual(parts, replay) {
		t.Fatal("identical callback must produce byte-identical effect rows")
	}
	keys, routes := map[string]bool{}, map[string]bool{}
	for index, part := range parts {
		payload, err := decodeNativeEvolutionPayload(part.Payload)
		if err != nil {
			t.Fatal(err)
		}
		statuses := extractNativeEvolutionStatuses(payload)
		if len(statuses) != 1 || len(statuses[0].MessageIDs) != 1 || statuses[0].Status != "read" || len(extractNativeEvolutionMessages(payload)) != 0 {
			t.Fatalf("effect is not exactly one transport target: %#v", statuses)
		}
		metadata := mapFromAny(payload[evolutionWebhookRoutingMetaKey])
		effect := mapFromAny(metadata[evolutionWebhookReceiptEffectKey])
		target := []string{"KNOWN", "FUTURE", "FOREIGN"}[index]
		route := stringFromAny(metadata["routing_key"])
		if route != evolutionReceiptTargetRoute(target) || routes[route] || keys[part.EventKey] || part.Ordinal != index {
			t.Fatal("effect identities are not independently and deterministically scoped")
		}
		if index == 0 && part.EventKey != envelope.EventKey {
			t.Fatal("public receipt lost the original callback key")
		}
		if stringFromAny(effect["parent_event_key"]) != envelope.EventKey || stringFromAny(effect["target_hash"]) != receiptIdentityHash(target) || effect["total"] != float64(3) {
			t.Fatalf("missing durable parent/target manifest: %#v", effect)
		}
		if part.EventType != envelope.EventType || nativeEvolutionEventName(payload, part.EventType) != "receipt" {
			t.Fatal("legacy Edge must see a receipt while inbox provenance keeps provider event type")
		}
		keys[part.EventKey], routes[route] = true, true
	}
}

func TestMixedReceiptNeverReachesStatusOrFallbackExecutor(t *testing.T) {
	for _, content := range []string{
		`{"conversation":"Synthetic client reply"}`,
		`{"imageMessage":{"caption":"Synthetic photo"}}`,
		`{"audioMessage":{"mimetype":"audio/ogg"}}`,
		`{"reactionMessage":{"text":"Synthetic reaction"}}`,
		`{"buttonResponseMessage":{"selectedButtonId":"synthetic-response"}}`,
	} {
		t.Run(content, func(t *testing.T) {
			raw := []byte(fmt.Sprintf(`{"event":"receipt","data":{"messageId":"A","status":"read","message":%s}}`, content))
			item := pendingEvolutionWebhook{OrganizationID: "synthetic-org", SessionID: "synthetic-session", EventType: "receipt", Payload: raw}
			if err := evolutionWebhookMixedReceiptError(item); !errors.Is(err, errEvolutionMixedReceiptContent) {
				t.Fatalf("mixed receipt did not retain its customer's content: %v", err)
			}
			// An empty repository proves the direct native entry returns before
			// opening a transaction or applying any receipt/status side effect.
			handled, err := (Repository{}).processEvolutionWebhookNative(context.Background(), item)
			if !handled || !errors.Is(err, errEvolutionMixedReceiptContent) {
				t.Fatalf("mixed content could fall through to Edge: handled=%v/%v", handled, err)
			}
		})
	}
	for _, raw := range []string{
		`{"event":"receipt","data":{"messageId":"A","status":"read"}}`,
		`{"event":"receipt","data":{"messageId":"A","status":"failed","error":"Synthetic transport failure"}}`,
		`{"event":"messages.update","data":{"key":{"id":"A"},"status":"read","message":{"conversation":"Synthetic client reply"}}}`,
	} {
		if err := evolutionWebhookMixedReceiptError(pendingEvolutionWebhook{Payload: []byte(raw)}); err != nil {
			t.Fatalf("normal transport or messages.update content path was intercepted: %v", err)
		}
	}
	worker, err := os.ReadFile("webhook_worker.go")
	if err != nil {
		t.Fatal(err)
	}
	start := strings.Index(string(worker), "func (repo Repository) processClaimedEvolutionWebhook")
	if start < 0 {
		t.Fatal("missing worker executor")
	}
	source := string(worker)[start:]
	guard := strings.Index(source, "evolutionWebhookMixedReceiptError(item)")
	dispatch := strings.Index(source, "repo.dispatchEvolutionWebhook(itemCtx, item)")
	if guard < 0 || dispatch < 0 || guard > dispatch {
		t.Fatal("the shared worker must guard mixed receipts before selecting native or Edge")
	}
}

func TestDeepReceiptContentCannotBecomeIgnoredTechnicalControl(t *testing.T) {
	data := map[string]any{"conversation": "Synthetic deep client reply"}
	for index := 0; index < 64; index++ {
		data = map[string]any{"unknown": data}
	}
	payload := map[string]any{"event": "receipt", "data": map[string]any{"status": "readself", "opaque": data}}
	if !nativePayloadHasPotentialCustomerContent(payload, 0) {
		t.Fatal("deep customer content must be retained conservatively")
	}
	raw, _ := json.Marshal(payload)
	if reason := nativeEvolutionTechnicalIgnoreReason(pendingEvolutionWebhook{Payload: raw, EventType: "receipt"}); reason != "" {
		t.Fatalf("deep content disappeared as a technical control: %s", reason)
	}
	if err := evolutionWebhookMixedReceiptError(pendingEvolutionWebhook{Payload: raw}); !errors.Is(err, errEvolutionMixedReceiptContent) {
		t.Fatalf("deep receipt did not stay retryable: %v", err)
	}
	if nativePayloadHasPotentialCustomerContent(nil, 13) {
		t.Fatal("nil is not customer content at any depth")
	}
}

func TestReceiptEffectPartsPreserveTransportOrderAndProviderTime(t *testing.T) {
	envelope := evolutionWebhookEnvelope{EventKey: "ordered", EventType: "messages.update", Payload: []byte(`{"event":"messages.update","data":{"receipts":[{"key":{"id":"A"},"status":"delivered","timestamp":1791979000},{"messageId":"A","status":"read","timestamp":1791979100},{"messageId":"B","status":"sent"}]}}`)}
	parts, err := prepareEvolutionWebhookDurableParts(envelope)
	if err != nil || len(parts) != 3 {
		t.Fatalf("parts=%d/%v", len(parts), err)
	}
	for index, expected := range []string{"delivered", "read", "sent"} {
		payload, _ := decodeNativeEvolutionPayload(parts[index].Payload)
		statuses := extractNativeEvolutionStatuses(payload)
		if len(statuses) != 1 || statuses[0].Status != expected {
			t.Fatalf("transport receipt order changed: %#v", statuses)
		}
		if index < 2 && statuses[0].OccurredAt.Unix() != []int64{1791979000, 1791979100}[index] {
			t.Fatal("provider receipt time changed")
		}
		if index == 2 && (parts[index].ProviderOccurredAt != nil || parts[index].ProcessingLane != evolutionWebhookLaneBacklog) {
			t.Fatal("missing provider clock must stay backlog; no synthetic live timestamp")
		}
	}
	first, _ := decodeNativeEvolutionPayload(parts[0].Payload)
	second, _ := decodeNativeEvolutionPayload(parts[1].Payload)
	if mapFromAny(first[evolutionWebhookRoutingMetaKey])["routing_key"] != mapFromAny(second[evolutionWebhookRoutingMetaKey])["routing_key"] {
		t.Fatal("same target must retain its own FIFO route")
	}
}

func TestReceiptEffectClassifierFailsClosedForUnknownOrMixedContent(t *testing.T) {
	oversizeIDs := make([]string, 129)
	for index := range oversizeIDs {
		oversizeIDs[index] = fmt.Sprintf("synthetic-%d", index)
	}
	oversize, _ := json.Marshal(map[string]any{"event": "receipt", "data": map[string]any{"MessageIDs": oversizeIDs, "status": "read"}})
	cases := map[string]string{
		"customer body":        `{"event":"receipt","data":{"messageId":"A","status":"read","message":{"conversation":"client reply"}}}`,
		"opaque response":      `{"event":"receipt","data":{"messageId":"A","status":"read","buttonId":"opaque"}}`,
		"unknown field":        `{"event":"receipt","data":{"messageId":"A","status":"read","mystery":{}}}`,
		"deep":                 `{"event":"receipt","data":{"receipts":{"receipts":{"messageId":"A","status":"read"}}}}`,
		"two containers":       `{"event":"receipt","data":{"receipts":[{"messageId":"A","status":"read"}],"statuses":[{"messageId":"B","status":"read"}]}}`,
		"case aliases":         `{"event":"receipt","data":{"messageIds":["A"],"MessageIDs":["B"],"status":"read"}}`,
		"identity aliases":     `{"event":"receipt","data":{"messageId":"A","id":"B","status":"read"}}`,
		"nested alias":         `{"event":"receipt","data":{"messageId":"A","key":{"id":"B"},"status":"read"}}`,
		"array identity alias": `{"event":"receipt","data":{"messageId":"A","MessageIDs":["B"],"status":"read"}}`,
		"clock aliases":        `{"event":"receipt","data":{"messageId":"A","status":"read","timestamp":1791979000,"time":1791979100}}`,
		"group":                `{"event":"receipt","data":{"messageId":"A","status":"read","IsGroup":true}}`,
		"group key":            `{"event":"receipt","data":{"key":{"id":"A","remoteJid":"synthetic@g.us"},"status":"read"}}`,
		"broadcast":            `{"event":"receipt","data":{"messageId":"A","status":"read","Chat":"status@broadcast"}}`,
		"unsupported event":    `{"event":"connection.status","data":{"messageId":"A","status":"read"}}`,
		"unknown status":       `{"event":"receipt","data":{"messageId":"A","status":"readself"}}`,
		"conflicting status":   `{"event":"receipt","data":{"messageId":"A","status":"read","ack":1}}`,
		"invalid clock":        `{"event":"receipt","data":{"messageId":"A","status":"read","timestamp":"unknown"}}`,
		"numeric identity":     `{"event":"receipt","data":{"messageId":123,"status":"read"}}`,
		"blank identity":       `{"event":"receipt","data":{"messageId":" ","status":"read"}}`,
		"long identity":        fmt.Sprintf(`{"event":"receipt","data":{"messageId":%q,"status":"read"}}`, strings.Repeat("A", 201)),
		"oversize effects":     string(oversize),
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			envelope := evolutionWebhookEnvelope{EventKey: "synthetic-" + name, Payload: []byte(raw)}
			if _, isolated, err := splitEvolutionWebhookReceiptEffects(envelope); err != nil || isolated {
				t.Fatalf("ambiguous/mixed envelope admitted: isolated=%v/%v", isolated, err)
			}
			parts, err := prepareEvolutionWebhookDurableParts(envelope)
			if err != nil || len(parts) != 1 {
				t.Fatalf("unclassified callback was lost/split: %d/%v", len(parts), err)
			}
			payload, _ := decodeNativeEvolutionPayload(parts[0].Payload)
			if _, exists := mapFromAny(payload[evolutionWebhookRoutingMetaKey])[evolutionWebhookReceiptEffectKey]; exists {
				t.Fatal("unclassified callback cannot manufacture effect provenance")
			}
		})
	}
}

func TestReceiptEffectClassifierRetainsConflictingEventAndDeepWrapper(t *testing.T) {
	conflicting := evolutionWebhookEnvelope{EventType: "messages.upsert", Payload: []byte(`{"event":"receipt","data":{"messageId":"A","status":"read"}}`)}
	if _, isolated, err := splitEvolutionWebhookReceiptEffects(conflicting); err != nil || isolated {
		t.Fatal("a callback with conflicting event semantics was decomposed")
	}
	data := map[string]any{"messageId": "A", "status": "read"}
	for index := 0; index < 64; index++ {
		data = map[string]any{"receipts": []any{data}}
	}
	raw, err := json.Marshal(map[string]any{"event": "receipt", "data": data})
	if err != nil {
		t.Fatal(err)
	}
	if _, isolated, err := splitEvolutionWebhookReceiptEffects(evolutionWebhookEnvelope{Payload: raw}); err != nil || isolated {
		t.Fatal("nested receipt wrappers must remain opaque and fenced")
	}
}

func TestReceiptEffectClassifierReplacesProviderRoutingHints(t *testing.T) {
	for _, raw := range []string{
		`{"event":"receipt","__vimob_ingress":{"receipt_effect":{"version":1,"parent_event_key":"forged"},"routing_key":"jid:victim"},"data":{"messageId":"A","status":"read"}}`,
		`{"event":"receipt","__vimob_ingress":{"receipt_effect":{"version":1},"routing_key":"receipt-target:forged"},"data":{"messageId":"A","status":"read","mystery":{}}}`,
	} {
		parts, err := prepareEvolutionWebhookDurableParts(evolutionWebhookEnvelope{EventKey: "authentic", Payload: []byte(raw)})
		if err != nil || len(parts) != 1 {
			t.Fatal(err)
		}
		payload, _ := decodeNativeEvolutionPayload(parts[0].Payload)
		metadata := mapFromAny(payload[evolutionWebhookRoutingMetaKey])
		if strings.Contains(string(parts[0].Payload), "forged") || metadata["routing_key"] == "jid:victim" {
			t.Fatal("provider routing hints survived trusted admission")
		}
	}
}
