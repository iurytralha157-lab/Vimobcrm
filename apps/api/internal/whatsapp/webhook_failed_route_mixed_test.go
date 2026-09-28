package whatsapp

import (
	"encoding/json"
	"testing"
	"time"
)

func TestFailedRouteMixedNoGoDetectsUnsplitCrossContactEnvelope(t *testing.T) {
	payload := []byte(`{
		"event":"messages.upsert",
		"messages":[{"Info":{"ID":"blocked","Chat":"5511999991111@s.whatsapp.net","Timestamp":1788966000},"Message":{"albumMessage":{"expectedImageCount":2}}}],
		"data":{"messages":[{"Info":{"ID":"peer","Chat":"5511999992222@s.whatsapp.net","Timestamp":1788966001},"Message":{"conversation":"dois"}}]}
	}`)
	if _, split, err := splitEvolutionWebhookMessageBatch(payload); err != nil || split {
		t.Fatalf("fixture must remain unsplit: split=%v err=%v", split, err)
	}
	parts, err := prepareEvolutionWebhookDurableParts(evolutionWebhookEnvelope{
		EventKey: "fixture:mixed", EventType: "message", Payload: payload,
		ReceivedAt: time.Unix(1788966002, 0).UTC(),
	})
	if err != nil || len(parts) != 1 {
		t.Fatalf("durable parts: %d, %v", len(parts), err)
	}
	if !failedRouteHasUnsplitMultipleDirectMessages(parts) {
		t.Fatal("unsplittable cross-contact callback must be isolated before capture")
	}
	var decoded map[string]any
	if err := json.Unmarshal(parts[0].Payload, &decoded); err != nil {
		t.Fatal(err)
	}
	metadata := decoded[evolutionWebhookRoutingMetaKey].(map[string]any)
	metadata["routing_snapshot"] = map[string]any{
		"version": 1,
		"messages": []any{
			map[string]any{"provider_message_id": "blocked", "routing_key": "phone:5511999991111", "quarantine_reason": failedRouteUnprovenReason, "binding_eligible": false},
			map[string]any{"provider_message_id": "peer", "routing_key": "phone:5511999992222", "state": "bound", "binding_eligible": true},
		},
	}
	parts[0].Payload, err = json.Marshal(decoded)
	if err != nil {
		t.Fatal(err)
	}
	if !failedRouteHasUnsplitMixedNoGo(parts) {
		t.Fatal("an unsplit blocked contact must isolate the whole callback before any member ledger commits")
	}
	metadata["routing_snapshot"] = map[string]any{
		"version": 1, "messages": []any{map[string]any{"quarantine_reason": failedRouteUnprovenReason}},
	}
	parts[0].Payload, _ = json.Marshal(decoded)
	if failedRouteHasUnsplitMixedNoGo(parts) {
		t.Fatal("a single blocked member is auditable in its own inbox")
	}
	metadata["routing_snapshot"] = map[string]any{
		"version": 1,
		"messages": []any{
			map[string]any{"provider_message_id": "blocked", "routing_key": "phone:5511999991111", "state": "bound"},
			map[string]any{"provider_message_id": "peer", "routing_key": "phone:5511999992222", "state": "bound"},
		},
	}
	parts[0].Payload, _ = json.Marshal(decoded)
	for _, mode := range []string{webhookProcessorNative, webhookProcessorNativeFallback} {
		if got := failedRouteMixedIsolationReason(parts, mode); got != failedRouteMixedUnsupportedReason {
			t.Fatalf("mode %q isolation = %q, want unsupported mixed raw", mode, got)
		}
	}
	if got := failedRouteMixedIsolationReason(parts, webhookProcessorEdge); got != failedRouteMixedUnsplitReason {
		t.Fatalf("Edge mode must isolate unsplit peers before public inbox, got %q", got)
	}
}

func TestEvolutionWebhookCaptureOrderSortsSplitRoutesWithoutChangingOrdinals(t *testing.T) {
	parts := []evolutionWebhookDurablePart{
		{EventKey: "original", Ordinal: 0, Payload: []byte(`{"data":{"Info":{"ID":"b","Chat":"5511999992222@s.whatsapp.net"},"Message":{"conversation":"b"}}}`)},
		{EventKey: "derived", Ordinal: 1, Payload: []byte(`{"data":{"Info":{"ID":"a","Chat":"5511999991111@s.whatsapp.net"},"Message":{"conversation":"a"}}}`)},
	}
	order := evolutionWebhookCaptureOrder(parts)
	if len(order) != 2 || order[0] != 1 || order[1] != 0 {
		t.Fatalf("route lock order = %v, want original indices [1 0]", order)
	}
	if parts[0].EventKey != "original" || parts[1].EventKey != "derived" {
		t.Fatal("capture order changed provider ordinals or event keys")
	}
}
