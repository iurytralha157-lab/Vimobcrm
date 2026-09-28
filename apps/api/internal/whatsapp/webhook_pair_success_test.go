package whatsapp

import (
	"encoding/json"
	"testing"
)

func pairSuccessFixture(t *testing.T, withSnapshot bool) map[string]any {
	t.Helper()
	payload := map[string]any{
		"event": "PairSuccess", "instanceId": "instance", "instanceName": "instance",
		"data": map[string]any{
			"BusinessName": "Business", "ID": "instance", "jid": "5511999999999@s.whatsapp.net",
			"LID": "opaque", "Platform": "android", "status": "open",
		},
	}
	if withSnapshot {
		payload["__vimob_ingress"] = map[string]any{
			"routing_key": "phone:5511999999999",
			"routing_snapshot": map[string]any{
				"version": float64(1),
				"messages": []any{map[string]any{
					"binding_eligible": false, "state": "unlinked", "context_kind": "organic",
					"event_lead_id": nil, "current_lead_id": nil,
					"conversation_id": nil, "active_binding_id": nil,
				}},
			},
		}
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeNativeEvolutionPayload(encoded)
	if err != nil {
		t.Fatal(err)
	}
	return decoded
}

func TestExactPairSuccessControl(t *testing.T) {
	for _, withSnapshot := range []bool{false, true} {
		payload := pairSuccessFixture(t, withSnapshot)
		if !exactPairSuccessControl(payload, "pairsuccess") {
			t.Fatalf("expected exact PairSuccess control withSnapshot=%v", withSnapshot)
		}
	}

	mutate := func(change func(map[string]any)) map[string]any {
		payload := pairSuccessFixture(t, true)
		change(payload)
		return payload
	}
	for name, payload := range map[string]map[string]any{
		"unexpected message": mutate(func(p map[string]any) { p["message"] = map[string]any{"conversation": "lead text"} }),
		"unexpected data":    mutate(func(p map[string]any) { p["data"].(map[string]any)["text"] = "lead text" }),
		"bound lead": mutate(func(p map[string]any) {
			p["__vimob_ingress"].(map[string]any)["routing_snapshot"].(map[string]any)["messages"].([]any)[0].(map[string]any)["binding_eligible"] = true
		}),
		"unexpected state": mutate(func(p map[string]any) {
			p["__vimob_ingress"].(map[string]any)["routing_snapshot"].(map[string]any)["messages"].([]any)[0].(map[string]any)["state"] = "bound"
		}),
		"different event":  mutate(func(p map[string]any) { p["event"] = "Message" }),
		"different status": mutate(func(p map[string]any) { p["data"].(map[string]any)["status"] = "closed" }),
		"bad jid":          mutate(func(p map[string]any) { p["data"].(map[string]any)["jid"] = "opaque@lid" }),
	} {
		t.Run(name, func(t *testing.T) {
			if exactPairSuccessControl(payload, "pairsuccess") {
				t.Fatal("unexpected PairSuccess control classification")
			}
		})
	}
}
