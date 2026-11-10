package whatsapp

import (
	"fmt"
	"testing"
	"time"
)

func TestLiveBoundDeadBacklogCaptureUsesPreparedProviderMessageTime(t *testing.T) {
	receivedAt := time.Date(2026, 11, 10, 14, 0, 0, 0, time.UTC)
	parts, err := prepareEvolutionWebhookDurableParts(evolutionWebhookEnvelope{
		EventKey: "synthetic-provider-event", EventType: "messages.upsert", ReceivedAt: receivedAt,
		Payload: []byte(fmt.Sprintf(`{"event":"messages.upsert","data":{"messages":[
			{"Info":{"ID":"historical","Chat":"5511999990001@s.whatsapp.net","Timestamp":%d},"Message":{"conversation":"old"}},
			{"Info":{"ID":"fresh","Chat":"5511999990001@s.whatsapp.net","Timestamp":%d},"Message":{"conversation":"current"}}
		]}}`, receivedAt.Add(-time.Hour).Unix(), receivedAt.Add(-time.Second).Unix())),
	})
	if err != nil || len(parts) != 2 {
		t.Fatalf("prepare provider parts: count=%d, err=%v", len(parts), err)
	}
	for index, part := range parts {
		payload, err := decodeNativeEvolutionPayload(part.Payload)
		if err != nil {
			t.Fatal(err)
		}
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 || len(extractNativeEvolutionStatuses(payload)) != 0 {
			t.Fatalf("part %d did not contain exactly one plain message", index)
		}
		schedulingKey := firstString(mapFromAny(payload[evolutionWebhookRoutingMetaKey]), "routing_key")
		bindingKey := evolutionWebhookMessageBindingRoutingKey(messages[0])
		got := liveBoundDeadBacklogCaptureEligible(part, messages[0], nativeInboundRule{}, schedulingKey, bindingKey)
		if want := index == 1; got != want {
			t.Fatalf("part %d qualified = %t, want %t", index, got, want)
		}
	}
}

func TestLiveBoundDeadBacklogCaptureRequiresExactFreshPlainInbound(t *testing.T) {
	const route = "phone:5511999990001"
	receivedAt := time.Date(2026, 11, 10, 14, 0, 0, 0, time.UTC)
	messageAt := receivedAt.Add(-time.Second)
	part := evolutionWebhookDurablePart{
		ProcessingLane: evolutionWebhookLaneLive, ReceivedAt: receivedAt, ProviderOccurredAt: &messageAt,
	}
	message := nativeEvolutionMessage{
		ProviderMessageID: "synthetic-valid-provider-id", RemoteJID: "5511999990001@s.whatsapp.net",
		MessageType: "text", Content: "Synthetic inbound text",
		Raw: map[string]any{"Info": map[string]any{"Timestamp": messageAt.Format(time.RFC3339)}},
	}
	if !liveBoundDeadBacklogCaptureEligible(part, message, nativeInboundRule{}, route, route) {
		t.Fatal("fresh text with exact route and stable provider evidence did not qualify")
	}
	for _, test := range []struct {
		name   string
		mutate func(*evolutionWebhookDurablePart, *nativeEvolutionMessage, *nativeInboundRule, *string)
	}{
		{"different scheduling route", func(_ *evolutionWebhookDurablePart, _ *nativeEvolutionMessage, _ *nativeInboundRule, key *string) {
			*key = evolutionWebhookSessionRoute
		}},
		{"history lane", func(p *evolutionWebhookDurablePart, _ *nativeEvolutionMessage, _ *nativeInboundRule, _ *string) {
			p.ProcessingLane = evolutionWebhookLaneBacklog
		}},
		{"old provider time", func(p *evolutionWebhookDurablePart, _ *nativeEvolutionMessage, _ *nativeInboundRule, _ *string) {
			p.ReceivedAt = receivedAt.Add(evolutionWebhookLiveWindow)
		}},
		{"part time from another member", func(p *evolutionWebhookDurablePart, _ *nativeEvolutionMessage, _ *nativeInboundRule, _ *string) {
			another := messageAt.Add(-time.Second)
			p.ProviderOccurredAt = &another
		}},
		{"missing provider time", func(_ *evolutionWebhookDurablePart, m *nativeEvolutionMessage, _ *nativeInboundRule, _ *string) {
			m.Raw = nil
		}},
		{"synthetic provider ID", func(_ *evolutionWebhookDurablePart, m *nativeEvolutionMessage, _ *nativeInboundRule, _ *string) {
			m.ProviderMessageIDSynthetic = true
		}},
		{"outbound echo", func(_ *evolutionWebhookDurablePart, m *nativeEvolutionMessage, _ *nativeInboundRule, _ *string) {
			m.FromMe = true
		}},
		{"campaign proof", func(_ *evolutionWebhookDurablePart, m *nativeEvolutionMessage, _ *nativeInboundRule, _ *string) {
			m.HasCampaignSignal = true
		}},
		{"managed intake", func(_ *evolutionWebhookDurablePart, _ *nativeEvolutionMessage, r *nativeInboundRule, _ *string) {
			r.ManagedProviderEventPending = true
		}},
		{"configured intake rule", func(_ *evolutionWebhookDurablePart, _ *nativeEvolutionMessage, r *nativeInboundRule, _ *string) {
			r.ID = "synthetic-intake-rule"
		}},
		{"media", func(_ *evolutionWebhookDurablePart, m *nativeEvolutionMessage, _ *nativeInboundRule, _ *string) {
			m.MessageType = "image"
		}},
		{"broadcast", func(_ *evolutionWebhookDurablePart, m *nativeEvolutionMessage, _ *nativeInboundRule, _ *string) {
			m.RemoteJID = "5511999990001@broadcast"
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			p, m, r, key := part, message, nativeInboundRule{}, route
			test.mutate(&p, &m, &r, &key)
			if liveBoundDeadBacklogCaptureEligible(p, m, r, key, route) {
				t.Fatal("ineligible provider evidence selected v3")
			}
		})
	}
}
