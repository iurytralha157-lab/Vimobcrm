package whatsapp

import (
	"encoding/json"
	"strings"
	"testing"
)

func structuredMessageFixture(node map[string]any) map[string]any {
	return map[string]any{
		"Info":    map[string]any{"ID": "structured-fixture", "Chat": "5511999991234@s.whatsapp.net", "Sender": "5511999991234@s.whatsapp.net", "Timestamp": "2026-10-11T12:00:00Z"},
		"Message": node,
	}
}

func encryptedEditFixture() map[string]any {
	return structuredMessageFixture(map[string]any{
		"messageContextInfo": map[string]any{"messageSecret": "synthetic-context"},
		"secretEncryptedMessage": map[string]any{
			"secretEncType": 2, "encPayload": "c3ludGhldGlj", "encIV": "Zml4dHVyZQ==",
			"targetMessageKey": map[string]any{"ID": "original-fixture", "remoteJid": "5511999991234@s.whatsapp.net"},
		},
	})
}

func TestNativeStructuredCustomerMessagesKeepIdentityAndReadableContent(t *testing.T) {
	cases := []struct {
		name string
		node map[string]any
		want string
	}{
		{"contact", map[string]any{"contactMessage": map[string]any{"displayName": "Contato da visita", "vcard": "BEGIN:VCARD\nTEL:5511888888888"}}, "Contato compartilhado: Contato da visita"},
		{"contact no name", map[string]any{"contactMessage": map[string]any{"vcard": "BEGIN:VCARD"}}, "Contato compartilhado"},
		{"contacts", map[string]any{"contactsArrayMessage": map[string]any{"contacts": []any{map[string]any{"vcard": "private"}}}}, "Contatos compartilhados"},
		{"album header", map[string]any{"albumMessage": map[string]any{"expectedImageCount": 2}}, "Álbum de fotos ou vídeos"},
		{"live location", map[string]any{"liveLocationMessage": map[string]any{"degreesLatitude": -23.0}}, "Localização em tempo real compartilhada"},
		{"location caption", map[string]any{"LiveLocationMessage": map[string]any{"Caption": "Ponto da visita"}}, "Ponto da visita"},
		{"location", map[string]any{"locationMessage": map[string]any{"name": "Portaria", "degreesLongitude": -46.0}}, "Portaria"},
		{"interactive", map[string]any{"interactiveMessage": map[string]any{"body": map[string]any{"text": "Escolha o horário"}, "nativeFlowMessage": map[string]any{"buttons": []any{}}}}, "Escolha o horário"},
		{"interactive no body", map[string]any{"interactiveMessage": map[string]any{"nativeFlowMessage": map[string]any{"buttons": []any{}}}}, "Mensagem interativa recebida. Abra o WhatsApp para interagir."},
		{"template", map[string]any{"templateMessage": map[string]any{"hydratedTemplate": map[string]any{"hydratedContentText": "Visita confirmada"}}}, "Visita confirmada"},
		{"template alternate", map[string]any{"TemplateMessage": map[string]any{"HydratedFourRowTemplate": map[string]any{"HydratedContentText": "Confirmação"}}}, "Confirmação"},
		{"button response", map[string]any{"buttonsResponseMessage": map[string]any{"selectedDisplayText": "Amanhã"}}, "Amanhã"},
		{"template response", map[string]any{"templateButtonReplyMessage": map[string]any{"selectedID": "horario-2"}}, "horario-2"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			message, ok := normalizeNativeEvolutionMessage(structuredMessageFixture(test.node))
			if !ok || message.Content != test.want || message.MessageType != "text" {
				t.Fatalf("readable representation missing: %+v, ok=%v", message, ok)
			}
			if message.ContactPhone != "5511999991234" || message.ProviderMessageID != "structured-fixture" || message.MediaURL != "" || message.MediaBase64 != "" || message.IsReaction || message.UnsupportedMessage {
				t.Fatalf("structured content changed identity or introduced media/control: %+v", message)
			}
		})
	}
	for _, node := range []map[string]any{{"unknownFutureMessage": map[string]any{"body": "unknown"}}, {"contactMessage": map[string]any{}}, {"secretEncryptedMessage": map[string]any{"encPayload": "ciphertext"}}} {
		if content := nativeStructuredMessageContent(node); content != "" {
			t.Fatalf("unknown/empty/encrypted content must remain unsupported: %q", content)
		}
	}
}

func TestNativeEncryptedEditControlRequiresExactSubtypeAndNoCustomerContent(t *testing.T) {
	base, _ := normalizeNativeEvolutionMessage(encryptedEditFixture())
	if !nativeEvolutionMessageIsEncryptedEditControl(base) || base.Content != "" {
		t.Fatal("exact undecrypted edit must be technical and must not invent a message")
	}
	cases := []struct {
		name   string
		mutate func(map[string]any, map[string]any)
	}{
		{"unknown subtype", func(raw, edit map[string]any) { edit["secretEncType"] = 0 }},
		{"fractional subtype", func(raw, edit map[string]any) { edit["secretEncType"] = 2.1 }},
		{"poll edit", func(raw, edit map[string]any) { edit["secretEncType"] = 4 }},
		{"missing ciphertext", func(raw, edit map[string]any) { delete(edit, "encPayload") }},
		{"missing IV", func(raw, edit map[string]any) { delete(edit, "encIV") }},
		{"non-string cipher", func(raw, edit map[string]any) { edit["encPayload"] = map[string]any{"text": "actual reply"} }},
		{"missing target", func(raw, edit map[string]any) { delete(edit, "targetMessageKey") }},
		{"foreign chat", func(raw, edit map[string]any) {
			edit["targetMessageKey"].(map[string]any)["remoteJid"] = "5511777777777@s.whatsapp.net"
		}},
		{"malformed target chat", func(raw, edit map[string]any) {
			edit["targetMessageKey"].(map[string]any)["remoteJid"] = map[string]any{"text": "unknown target"}
		}},
		{"mixed text", func(raw, edit map[string]any) { raw["Message"].(map[string]any)["conversation"] = "resposta real" }},
		{"mixed media", func(raw, edit map[string]any) {
			raw["Message"].(map[string]any)["imageMessage"] = map[string]any{"url": "synthetic"}
		}},
		{"synthetic ID", func(raw, edit map[string]any) { delete(raw["Info"].(map[string]any), "ID") }},
		{"campaign envelope", func(raw, edit map[string]any) { raw["referral"] = map[string]any{"source_type": "ad"} }},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			raw := encryptedEditFixture()
			test.mutate(raw, raw["Message"].(map[string]any)["secretEncryptedMessage"].(map[string]any))
			message, _ := normalizeNativeEvolutionMessage(raw)
			if nativeEvolutionMessageIsEncryptedEditControl(message) {
				t.Fatal("ambiguous envelope must retain the retry/recovery path")
			}
		})
	}

	plain, _ := normalizeNativeEvolutionMessage(structuredMessageFixture(map[string]any{"conversation": "Não descartar resposta"}))
	plain.ProviderMessageID = "real-reply"
	filtered := withoutNativeEvolutionEncryptedEditControls([]nativeEvolutionMessage{base, plain})
	if len(filtered) != 1 || filtered[0].Content != plain.Content {
		t.Fatal("mixed batch discarded a real customer message")
	}
}

func TestNativeEncryptedEditOuterCustomerContentIsNotDiscarded(t *testing.T) {
	for _, fields := range []map[string]any{
		{"text": "resposta real fora do Message"},
		{"body": "resposta real fora do Message"},
		{"buttonId": "horario-2"},
		{"text": map[string]any{"unknownFormat": "resposta real"}},
		{"file": map[string]any{"unknownFormat": "synthetic-media"}},
		{"mediaType": "image", "mediaUrl": "https://synthetic.invalid/plain-image"},
		{"base64": "c3ludGhldGljLW1lZGlh"},
	} {
		raw := encryptedEditFixture()
		for key, value := range fields {
			raw[key] = value
		}
		message, ok := normalizeNativeEvolutionMessage(raw)
		if !ok || nativeEvolutionMessageIsEncryptedEditControl(message) {
			t.Fatalf("mixed parsed customer content must retain normal processing: %+v", fields)
		}
		encoded, _ := json.Marshal(map[string]any{"event": "message", "data": raw})
		if reason := nativeEvolutionTechnicalIgnoreReason(pendingEvolutionWebhook{Payload: encoded}); reason != "" {
			t.Fatalf("mixed customer response was acknowledged as ignored: %s", reason)
		}
	}
}

func TestNativeEncryptedEditFrozenRouteRequiresLiteralIneligibleBoolean(t *testing.T) {
	message, _ := normalizeNativeEvolutionMessage(encryptedEditFixture())
	for _, eligibility := range []any{true, nil, "false", 0, map[string]any{"unknown": true}} {
		payload := map[string]any{evolutionWebhookRoutingMetaKey: map[string]any{"routing_snapshot": map[string]any{
			"messages": []any{map[string]any{"provider_message_id": message.ProviderMessageID, "binding_eligible": eligibility}},
		}}}
		if !nativeEncryptedEditHasFrozenCaptureRoute(payload, message) {
			t.Fatalf("eligible/unknown retained route must require explicit recovery: %+v", eligibility)
		}
	}
	payload := map[string]any{evolutionWebhookRoutingMetaKey: map[string]any{"routing_snapshot": map[string]any{
		"messages": []any{map[string]any{"provider_message_id": message.ProviderMessageID, "binding_eligible": false}},
	}}}
	if nativeEncryptedEditHasFrozenCaptureRoute(payload, message) {
		t.Fatal("strict retained ineligible route must not invent a captured business effect")
	}
	metadata := payload[evolutionWebhookRoutingMetaKey].(map[string]any)["routing_snapshot"].(map[string]any)
	metadata["messages"] = append(metadata["messages"].([]any), map[string]any{
		"provider_message_id": message.ProviderMessageID, "binding_eligible": true,
	})
	if !nativeEncryptedEditHasFrozenCaptureRoute(payload, message) {
		t.Fatal("first ineligible duplicate cannot hide a later retained eligible route")
	}
}

func TestNativeEncryptedEditIngressReasonAndFrozenRouteRemainSeparate(t *testing.T) {
	payload := map[string]any{"event": "message", "data": encryptedEditFixture()}
	encoded, _ := json.Marshal(payload)
	if reason := nativeEvolutionTechnicalIgnoreReason(pendingEvolutionWebhook{Payload: encoded}); reason != "encrypted_message_edit_undecrypted" {
		t.Fatalf("new strict edit is missing durable ignore classification: %q", reason)
	}
	payload[evolutionWebhookRoutingMetaKey] = map[string]any{"routing_snapshot": map[string]any{"version": 1, "messages": []any{map[string]any{"provider_message_id": "structured-fixture", "binding_eligible": true}}}}
	encoded, _ = json.Marshal(payload)
	if reason := nativeEvolutionTechnicalIgnoreReason(pendingEvolutionWebhook{Payload: encoded}); reason != "" {
		t.Fatal("retained eligible route cannot bypass explicit recovery")
	}
	message, _ := normalizeNativeEvolutionMessage(encryptedEditFixture())
	if !nativeEncryptedEditHasFrozenCaptureRoute(payload, message) {
		t.Fatal("legacy frozen capture route must remain protected")
	}
	source := readWhatsAppSourceFunction(t, "webhook_ingress.go", "func (repo Repository) AcceptEvolutionWebhook")
	recorded := strings.Index(source, "insert into private.whatsapp_webhook_ignored_events")
	snapshot := strings.Index(source, "parts, err = attachEvolutionWebhookRoutingSnapshots")
	if recorded < 0 || snapshot < recorded {
		t.Fatal("a technical ACK must record its reason before snapshot/queue creation")
	}
}
