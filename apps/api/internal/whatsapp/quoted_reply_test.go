package whatsapp

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestNativeQuotedReplyCurrentPayloadKinds(t *testing.T) {
	for _, kind := range []string{"extendedTextMessage", "ExtendedTextMessage", "imageMessage", "ImageMessage", "audioMessage", "AudioMessage", "documentMessage", "DocumentMessage", "contactMessage", "ContactMessage", "contactsArrayMessage", "ContactsArrayMessage", "locationMessage", "LocationMessage", "liveLocationMessage", "LiveLocationMessage", "interactiveMessage", "InteractiveMessage", "interactiveResponseMessage", "InteractiveResponseMessage", "buttonsResponseMessage", "ButtonsResponseMessage", "templateButtonReplyMessage", "TemplateButtonReplyMessage", "albumMessage", "AlbumMessage", "templateMessage", "TemplateMessage"} {
		t.Run(kind, func(t *testing.T) {
			raw := map[string]any{
				"key":  map[string]any{"id": "synthetic-reply", "remoteJid": "5511999990001@s.whatsapp.net", "fromMe": false},
				"Info": map[string]any{"Timestamp": float64(1791856800)},
				"message": map[string]any{kind: map[string]any{
					"text": "Synthetic reply", "caption": "Synthetic caption", "url": "https://media.invalid/a", "mimetype": "audio/ogg",
					"contextInfo": map[string]any{"stanzaId": "synthetic-parent", "participant": "forged-participant", "quotedMessage": map[string]any{"conversation": "never expose inline private content"}},
				}},
			}
			message, ok := normalizeNativeEvolutionMessage(raw)
			if !ok || message.QuotedMessageID != "synthetic-parent" {
				t.Fatalf("current %s reply lost its parent: ok=%v quote=%q", kind, ok, message.QuotedMessageID)
			}
			metadata := map[string]any{}
			appendNativePresentationMetadata(metadata, message)
			encoded, _ := json.Marshal(metadata)
			if strings.Contains(string(encoded), "never expose") || strings.Contains(string(encoded), "forged-participant") {
				t.Fatalf("reply copied untrusted inline context: %s", encoded)
			}
		})
	}
}

func TestNativeQuotedReplySnakeContextAndNestedHistory(t *testing.T) {
	parsed := parseNativeMessagePresentation(map[string]any{"conversation": "Reply"}, map[string]any{"context_info": map[string]any{"StanzaID": "snake-parent"}}, nil)
	if parsed.quoteRef != "snake-parent" {
		t.Fatalf("current snake context lost reference: %q", parsed.quoteRef)
	}
	for _, node := range []map[string]any{
		{"extendedTextMessage": map[string]any{"contextInfo": map[string]any{"quotedMessage": map[string]any{"extendedTextMessage": map[string]any{"contextInfo": map[string]any{"stanzaId": "historical-nested-parent"}}}}}},
		{"extendedTextMessage": map[string]any{"contextInfo": map[string]any{"stanzaId": "bad\x00-parent"}}},
	} {
		if parsed := parseNativeMessagePresentation(node, nil, nil); parsed.quoteRef != "" {
			t.Fatalf("untrusted quote became a current parent: %q", parsed.quoteRef)
		}
	}
}

func TestNativeQuotedReplyWhatsmeowWireStanzaID(t *testing.T) {
	// ContextInfo.StanzaID's actual protobuf JSON tag is stanzaID.
	for _, kind := range []string{"extendedTextMessage", "imageMessage", "audioMessage"} {
		t.Run(kind, func(t *testing.T) {
			message, ok := normalizeNativeEvolutionMessage(map[string]any{
				"key":     map[string]any{"id": "wire-reply", "remoteJid": "5511999990001@s.whatsapp.net", "fromMe": false},
				"Info":    map[string]any{"Timestamp": float64(1791856800)},
				"message": map[string]any{kind: map[string]any{"text": "Reply", "url": "https://media.invalid/a", "contextInfo": map[string]any{"stanzaID": "wire-parent"}}},
			})
			if !ok || message.QuotedMessageID != "wire-parent" {
				t.Fatalf("protobuf wire reply lost parent: ok=%v quote=%q", ok, message.QuotedMessageID)
			}
		})
	}
}

func TestQuotedReplyDTOCanonicalAuthorAndUnavailablePrivacy(t *testing.T) {
	const actor = "00000000-0000-4000-8000-000000000010"
	const target = "00000000-0000-4000-8000-000000000020"
	for _, available := range []bool{true, false} {
		var message Message
		payload, _ := json.Marshal(map[string]any{"quoted_message": map[string]any{
			"message_id": "parent-provider-id", "available": available, "id": target,
			"from_me": true, "sender_user_id": actor, "sender_name": "Canonical CRM sender", "content": "Canonical target body",
		}})
		applyMessagePresentation(&message, string(payload))
		encoded, err := json.Marshal(message.QuotedMessage)
		if err != nil {
			t.Fatal(err)
		}
		var fields map[string]any
		if err := json.Unmarshal(encoded, &fields); err != nil {
			t.Fatal(err)
		}
		if available {
			if fields["sender_name"] != "Canonical CRM sender" || strings.Contains(string(encoded), "sender_user_id") {
				t.Fatalf("canonical quote must keep its name and previous strict wire shape: %s", encoded)
			}
		} else if len(fields) != 2 || strings.Contains(string(encoded), actor) || strings.Contains(string(encoded), "Canonical") {
			t.Fatalf("unavailable parent leaked fields: %s", encoded)
		}
	}
	var external Message
	applyMessagePresentation(&external, `{"quoted_message":{"message_id":"external-parent","available":true,"id":"`+target+`","from_me":true,"sender_name":"WhatsApp device"}}`)
	encoded, _ := json.Marshal(external.QuotedMessage)
	if strings.Contains(string(encoded), "sender_user_id") {
		t.Fatalf("from_me inferred CRM authorship: %s", encoded)
	}
}

func TestEvolutionQuotedReplyWirePreservedForTextImageAudio(t *testing.T) {
	quote := map[string]any{"messageId": "authorized-provider-parent", "participant": "5511999990001@s.whatsapp.net"}
	base := map[string]any{"id": "durable-cid", "number": "5511999990001", "text": "Synthetic reply", "url": "https://media.invalid/a", "quoted": quote}
	for _, kind := range []string{"text", "image", "audio"} {
		body := evolutionSendTextBody(base)
		if kind != "text" {
			body = evolutionSendMediaBody(base, kind)
		}
		if body["id"] != "durable-cid" || !reflect.DeepEqual(body["quoted"], quote) {
			t.Fatalf("%s dropped durable quote contract: %#v", kind, body)
		}
	}
}

type quotedReplyMessageRow []any

func (row quotedReplyMessageRow) Scan(destinations ...any) error {
	if len(row) != len(destinations) {
		return fmt.Errorf("authorized message projection has %d fields; scanner requires %d", len(row), len(destinations))
	}
	for index, destination := range destinations {
		switch field := destination.(type) {
		case *string:
			*field = row[index].(string)
		case *bool:
			*field = row[index].(bool)
		case *int64:
			*field = row[index].(int64)
		case *time.Time:
			*field = row[index].(time.Time)
		case *pgtype.Text:
			if err := field.Scan(row[index]); err != nil {
				return err
			}
		case *pgtype.Int8:
			if err := field.Scan(row[index]); err != nil {
				return err
			}
		case *pgtype.Timestamptz:
			if err := field.Scan(row[index]); err != nil {
				return err
			}
		default:
			return fmt.Errorf("unsupported synthetic message destination %d: %T", index, destination)
		}
	}
	return nil
}

func TestMessageProjectionScansOnlyCanonicalCRMActor(t *testing.T) {
	const actor = "00000000-0000-4000-8000-000000000010"
	stamp := time.Date(2026, time.October, 13, 0, 0, 0, 0, time.UTC)
	for _, canonicalActor := range []any{actor, nil} {
		row := quotedReplyMessageRow{
			"00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003", "provider-id", nil,
			true, "Canonical body", "text", nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, "{}", "sent", nil,
			stamp, nil, nil, "5511999990001@s.whatsapp.net", "Canonical sender", canonicalActor, stamp, int64(0), "{}", true, true,
		}
		message, err := scanMessage(row)
		if err != nil {
			t.Fatal(err)
		}
		encoded, err := json.Marshal(message)
		if err != nil {
			t.Fatal(err)
		}
		var fields map[string]any
		if err := json.Unmarshal(encoded, &fields); err != nil {
			t.Fatal(err)
		}
		if fields["sender_user_id"] != canonicalActor {
			t.Fatalf("CRM actor must come only from canonical row: %s", encoded)
		}
		if message.SenderName == nil || *message.SenderName != "Canonical sender" || !message.OrderCreatedAt.Equal(stamp) || !message.CanQuote || !message.CanReact {
			t.Fatalf("adding sender_user_id shifted the authorized message scanner: %+v", message)
		}
	}
}

func TestQuotePresentationRejectsMalformedAuthorIdentity(t *testing.T) {
	var message Message
	applyMessagePresentation(&message, `{"quoted_message":{"message_id":"provider-id","available":true,"id":"00000000-0000-4000-8000-000000000020","from_me":true,"sender_user_id":"not-a-user-uuid"}}`)
	encoded, _ := json.Marshal(message.QuotedMessage)
	if message.QuotedMessage == nil || !message.QuotedMessage.Available || strings.Contains(string(encoded), "sender_user_id") {
		t.Fatalf("invalid author must be omitted without inventing a user: %s", encoded)
	}
}
