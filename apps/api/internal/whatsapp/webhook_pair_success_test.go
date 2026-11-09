package whatsapp

import (
	"context"
	"testing"
)

func TestNativeEvolutionPairSuccessIsTechnicalWithoutMarkingConnected(t *testing.T) {
	for _, item := range []pendingEvolutionWebhook{
		{EventType: "pair_success", Payload: []byte(`{"event":"PairSuccess","data":{"ID":"5511999990001@s.whatsapp.net","LID":"1000000001@lid","BusinessName":"Synthetic","Platform":"android","status":"open","jid":"5511999990001:1@s.whatsapp.net","pushName":"Synthetic"},"instanceId":"synthetic","instanceName":"synthetic","date_time":"2026-11-09T18:52:10Z"}`)},
		{EventType: "pair_success", Payload: []byte(`{"event":"pair_success","data":{"status":"open"},"__vimob_ingress":{"routing_key":"__session__","routing_snapshot":{"version":1,"messages":[]}}}`)},
		{EventType: "pair_success", Payload: []byte(`{"event":"pair_success","data":{"status":"open"},"__vimob_ingress":{"routing_snapshot":{"messages":[{"binding_eligible":false}]}}}`)},
	} {
		item.OrganizationID, item.SessionID = "synthetic-org", "synthetic-session"
		if reason := nativeEvolutionTechnicalIgnoreReason(item); reason != "pair_success_control" {
			t.Fatalf("PairSuccess technical reason = %q", reason)
		}
		// No DB is configured. Claim completion may record this typed control,
		// but the native processor must not write a connection state or message.
		if handled, err := (Repository{}).processEvolutionWebhookNative(context.Background(), item); err != nil || !handled {
			t.Fatalf("PairSuccess native handling = %t / %v", handled, err)
		}
		state, err := evolutionWebhookInlineSessionState(evolutionWebhookEnvelope{EventType: item.EventType, Payload: item.Payload})
		if err != nil || state.Handled || state.Status != "" {
			t.Fatalf("PairSuccess was treated as inline connection state: %+v / %v", state, err)
		}
		payload, err := decodeNativeEvolutionPayload(item.Payload)
		if err != nil {
			t.Fatal(err)
		}
		if state, recognized := deferredEvolutionWebhookSessionState(item, payload); recognized || state.Status != "" {
			t.Fatalf("PairSuccess was treated as deferred connection state: %+v", state)
		}
	}
}

func TestNativeEvolutionPairSuccessPreservesUnexpectedPayloadAndRoutingProof(t *testing.T) {
	for _, raw := range []string{
		`{"event":"pair_success","data":{"status":"open","Message":{"conversation":"synthetic body"}}}`,
		`{"event":"pair_success","data":{"status":"open","opaqueReply":"synthetic answer"}}`,
		`{"event":"pair_success","data":{"status":{"message":"synthetic body"}}}`,
		`{"event":"pair_success","type":"message","data":{"status":"open"}}`,
		`{"event":"pair_success","data":{"status":"open"},"__vimob_ingress":{"routing_snapshot":{"messages":[{"binding_eligible":true}]}}}`,
	} {
		item := pendingEvolutionWebhook{EventType: "pair_success", Payload: []byte(raw)}
		if reason := nativeEvolutionTechnicalIgnoreReason(item); reason != "" {
			t.Fatalf("ambiguous PairSuccess was classified as technical: %q", reason)
		}
		state, err := evolutionWebhookInlineSessionState(evolutionWebhookEnvelope{EventType: item.EventType, Payload: item.Payload})
		if err != nil || state.Handled || state.Status != "" {
			t.Fatalf("ambiguous PairSuccess changed session state: %+v / %v", state, err)
		}
	}
}
