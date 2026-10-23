package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func webhookFailureRouteFixture(t *testing.T, id, route string) pendingEvolutionWebhook {
	t.Helper()
	row := nativeRoutingSnapshotTestRow(id, 1)
	row["routing_key"] = route
	row["processing_epoch"] = 1
	var messages []map[string]any
	if route != evolutionWebhookSessionRoute {
		messages = append(messages, row)
	} else {
		messages = []map[string]any{}
	}
	payload, err := json.Marshal(map[string]any{evolutionWebhookRoutingMetaKey: map[string]any{
		"routing_key": route, "routing_snapshot": map[string]any{"version": 1, "messages": messages},
	}})
	if err != nil {
		t.Fatal(err)
	}
	return pendingEvolutionWebhook{ID: id, OrganizationID: "11111111-1111-4111-8111-111111111111", SessionID: "22222222-2222-4222-8222-222222222222", ProcessingEpoch: 1, ProcessingLane: "live", Payload: payload}
}

func TestWebhookFailureRouteRequiresExactValidatedServerProvenance(t *testing.T) {
	const route = "jid:synthetic@s.whatsapp.net"
	valid := webhookFailureRouteFixture(t, "valid", route)
	if got := evolutionWebhookFailureRoute(valid); got != route {
		t.Fatalf("valid frozen route = %q", got)
	}
	for name, mutate := range map[string]func(map[string]any){
		"wrong version":          func(meta map[string]any) { mapFromAny(meta["routing_snapshot"])["version"] = 2 },
		"string version":         func(meta map[string]any) { mapFromAny(meta["routing_snapshot"])["version"] = "1" },
		"missing messages":       func(meta map[string]any) { delete(mapFromAny(meta["routing_snapshot"]), "messages") },
		"null messages":          func(meta map[string]any) { mapFromAny(meta["routing_snapshot"])["messages"] = nil },
		"non-map messages":       func(meta map[string]any) { mapFromAny(meta["routing_snapshot"])["messages"] = []any{"unknown"} },
		"empty message identity": func(meta map[string]any) { failureRouteRow(meta)["provider_message_id"] = "" },
		"foreign tenant": func(meta map[string]any) {
			failureRouteRow(meta)["organization_id"] = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
		},
		"foreign session": func(meta map[string]any) {
			failureRouteRow(meta)["session_id"] = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
		},
		"foreign epoch":         func(meta map[string]any) { failureRouteRow(meta)["processing_epoch"] = 0 },
		"different route":       func(meta map[string]any) { failureRouteRow(meta)["routing_key"] = "jid:other@s.whatsapp.net" },
		"unknown capture state": func(meta map[string]any) { failureRouteRow(meta)["state"] = "unknown" },
		"duplicate message": func(meta map[string]any) {
			row := failureRouteRow(meta)
			mapFromAny(meta["routing_snapshot"])["messages"] = []any{row, row}
		},
		"white space":         func(meta map[string]any) { meta["routing_key"] = " " + route },
		"control character":   func(meta map[string]any) { meta["routing_key"] = route + "\n" },
		"oversize route":      func(meta map[string]any) { meta["routing_key"] = "jid:" + strings.Repeat("a", 257) },
		"unknown route class": func(meta map[string]any) { meta["routing_key"] = "new-class:opaque" },
	} {
		t.Run(name, func(t *testing.T) {
			item := valid
			payload, _ := decodeNativeEvolutionPayload(item.Payload)
			mutate(mapFromAny(payload[evolutionWebhookRoutingMetaKey]))
			item.Payload, _ = json.Marshal(payload)
			if got := evolutionWebhookFailureRoute(item); got != evolutionWebhookSessionRoute {
				t.Fatalf("unproved metadata was narrowed to %q", got)
			}
		})
	}
	if got := evolutionWebhookFailureRoute(pendingEvolutionWebhook{Payload: []byte(`{"data":{"Chat":"synthetic@s.whatsapp.net"}}`)}); got != evolutionWebhookSessionRoute {
		t.Fatal("provider identity was used to guess a failure route")
	}
}

func failureRouteRow(metadata map[string]any) map[string]any {
	return mapFromAny(mapFromAny(metadata["routing_snapshot"])["messages"].([]any)[0])
}

func TestWebhookFailureRouteAcceptsOnlyExactIsolatedReceiptTarget(t *testing.T) {
	envelope := evolutionWebhookEnvelope{EventKey: "synthetic-parent", EventType: "receipt", Payload: []byte(`{"event":"receipt","data":{"messageId":"SYNTHETIC-TARGET","status":"read"}}`)}
	parts, err := prepareEvolutionWebhookDurableParts(envelope)
	if err != nil || len(parts) != 1 {
		t.Fatal(err)
	}
	payload, _ := decodeNativeEvolutionPayload(parts[0].Payload)
	metadata := mapFromAny(payload[evolutionWebhookRoutingMetaKey])
	metadata["routing_snapshot"] = map[string]any{"version": 1, "messages": []any{}}
	encoded, _ := json.Marshal(payload)
	item := pendingEvolutionWebhook{Payload: encoded}
	if got := evolutionWebhookFailureRoute(item); got != evolutionReceiptTargetRoute("SYNTHETIC-TARGET") {
		t.Fatalf("exact receipt effect route = %q", got)
	}
	mapFromAny(metadata[evolutionWebhookReceiptEffectKey])["target_hash"] = strings.Repeat("a", 64)
	item.Payload, _ = json.Marshal(payload)
	if got := evolutionWebhookFailureRoute(item); got != evolutionWebhookSessionRoute {
		t.Fatal("receipt target mismatch lost its conservative fence")
	}
}

func TestDrainEvolutionWebhookBatchContinuesIndependentRoutesAfterError(t *testing.T) {
	errA, errB := errors.New("synthetic route A failure"), errors.New("synthetic route B failure")
	items := []pendingEvolutionWebhook{
		webhookFailureRouteFixture(t, "a-1", "jid:a@s.whatsapp.net"), webhookFailureRouteFixture(t, "a-2", "jid:a@s.whatsapp.net"),
		webhookFailureRouteFixture(t, "b-1", "jid:b@s.whatsapp.net"), webhookFailureRouteFixture(t, "b-2", "jid:b@s.whatsapp.net"),
		webhookFailureRouteFixture(t, "c-1", "jid:c@s.whatsapp.net"),
	}
	processed := []string{}
	err := drainEvolutionWebhookBatch(context.Background(), items, 1, func(_ context.Context, item pendingEvolutionWebhook) error {
		processed = append(processed, item.ID)
		if item.ID == "a-1" {
			return errA
		}
		if item.ID == "b-1" {
			return errB
		}
		return nil
	})
	if !errors.Is(err, errA) || !errors.Is(err, errB) || !reflect.DeepEqual(processed, []string{"a-1", "b-1", "c-1"}) {
		t.Fatalf("failed routes suppressed independent claims or advanced successors: %v / %v", processed, err)
	}
}

func TestDrainEvolutionWebhookBatchKeepsSessionBarriersAfterRouteFailure(t *testing.T) {
	for _, invalid := range []bool{false, true} {
		barrier := webhookFailureRouteFixture(t, "session-barrier", evolutionWebhookSessionRoute)
		if invalid {
			barrier.Payload = []byte(`{"__vimob_ingress":{"routing_key":"jid:unproved@s.whatsapp.net"}}`)
		}
		items := []pendingEvolutionWebhook{webhookFailureRouteFixture(t, "failed", "jid:a@s.whatsapp.net"), barrier, webhookFailureRouteFixture(t, "neighbor", "jid:b@s.whatsapp.net")}
		processed := []string{}
		err := drainEvolutionWebhookBatch(context.Background(), items, 1, func(_ context.Context, item pendingEvolutionWebhook) error {
			processed = append(processed, item.ID)
			return errors.New("synthetic failure")
		})
		if err == nil || !reflect.DeepEqual(processed, []string{"failed"}) {
			t.Fatalf("unknown/session-wide work was crossed after failure: %v / %v", processed, err)
		}
	}
}

func TestDrainEvolutionWebhookBatchPanicRecoveryAllowsIndependentRoute(t *testing.T) {
	items := []pendingEvolutionWebhook{webhookFailureRouteFixture(t, "panics", "jid:a@s.whatsapp.net"), webhookFailureRouteFixture(t, "neighbor", "jid:b@s.whatsapp.net")}
	processed, releases := []string{}, 0
	err := drainEvolutionWebhookBatch(context.Background(), items, 1, func(ctx context.Context, item pendingEvolutionWebhook) error {
		return runEvolutionWebhookWithPanicRecovery(ctx, func() error {
			processed = append(processed, item.ID)
			if item.ID == "panics" {
				panic("synthetic secret payload")
			}
			return nil
		}, func(context.Context, error) error { releases++; return nil })
	})
	if !errors.Is(err, errEvolutionWebhookWorkerPanic) || releases != 1 || !reflect.DeepEqual(processed, []string{"panics", "neighbor"}) || strings.Contains(err.Error(), "secret") {
		t.Fatalf("panic stopped another known route or leaked payload: %v / %d / %v", processed, releases, err)
	}
}
