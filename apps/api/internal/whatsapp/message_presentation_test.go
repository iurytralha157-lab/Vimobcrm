package whatsapp

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func TestMessagePresentationWhitelistsStructuredContent(t *testing.T) {
	parsed := parseNativeMessagePresentation(map[string]any{
		"contactMessage":  map[string]any{"displayName": "Synthetic", "vcard": "BEGIN:VCARD\nFN:Synthetic\nTEL;TYPE=CELL:+55 (11) 99999-9999\nEMAIL:private@example.invalid\nNOTE:secret metadata\nEND:VCARD"},
		"locationMessage": map[string]any{"degreesLatitude": -23.5, "degreesLongitude": -46.6, "name": "Synthetic location", "url": "https://forged.invalid"},
		"documentMessage": map[string]any{"contextInfo": map[string]any{"stanzaId": "quoted-id", "quotedMessage": map[string]any{"conversation": "never copy inline quote"}}},
	}, nil, map[string]any{"fileName": `C:\private\Synthetic.pdf`})
	if parsed.filename != "Synthetic.pdf" || len(parsed.contacts) != 1 || len(parsed.contacts[0].Phones) != 1 || parsed.contacts[0].Phones[0] != "+5511999999999" || parsed.location == nil || parsed.quoteRef != "quoted-id" {
		t.Fatalf("structured presentation mismatch: %+v", parsed)
	}
	if parsed.location.Latitude != -23.5 || parsed.location.Longitude != -46.6 {
		t.Fatalf("provider coordinates were rounded: %+v", parsed.location)
	}
	metadata := map[string]any{}
	appendNativePresentationMetadata(metadata, nativeEvolutionMessage{MediaFilename: parsed.filename, Contacts: parsed.contacts, Location: parsed.location, QuotedMessageID: parsed.quoteRef})
	raw, err := json.Marshal(metadata)
	if err != nil {
		t.Fatal(err)
	}
	for _, private := range []string{"private@example", "secret metadata", "forged.invalid", "never copy inline quote", "vcard"} {
		if strings.Contains(string(raw), private) {
			t.Fatalf("structured metadata retained %q", private)
		}
	}
	if sanitizeMessageLocation(&MessageLocation{Latitude: math.NaN()}) != nil || sanitizeMessageLocation(&MessageLocation{Latitude: 91}) != nil {
		t.Fatal("invalid coordinates must not become a public location")
	}
	if got := safeMediaFilename("../" + strings.Repeat("á", 200) + "\x00.pdf"); len(got) > 255 || strings.Contains(got, "\x00") {
		t.Fatal("filename must be bounded UTF-8 and contain no controls")
	}
}

func TestUnavailableQuoteNeverSerializesBodyOrName(t *testing.T) {
	private := "private prior context"
	raw, err := json.Marshal(QuotedMessage{MessageID: "provider-ref", Content: &private, SenderName: &private, MediaFilename: &private})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), private) || string(raw) != `{"message_id":"provider-ref","available":false}` {
		t.Fatalf("unavailable quote leaked fields: %s", raw)
	}
}

func TestDeletedMessagePresentationDoesNotExposeRetainedMetadata(t *testing.T) {
	const payload = `{"media_filename":"Synthetic.pdf","location":{"latitude":1,"longitude":2,"name":"Synthetic location"},"contacts":[{"display_name":"Synthetic contact","phones":["5550100"]}],"quoted_message":{"message_id":"synthetic-parent","available":true,"id":"00000000-0000-4000-8000-000000000020","content":"Synthetic quote"}}`
	for _, kind := range []string{"deleted", "deleted_event", " DELETED ", "text"} {
		t.Run(kind, func(t *testing.T) {
			filename := "Synthetic cached filename"
			message := Message{
				MessageType:   kind,
				MediaFilename: &filename,
				Location:      &MessageLocation{Latitude: 1, Longitude: 2},
				Contacts:      []MessageContact{{DisplayName: "Synthetic cached contact"}},
				QuotedMessage: &QuotedMessage{MessageID: "synthetic-cached-parent"},
			}
			applyMessagePresentation(&message, payload)
			if kind == "text" {
				if message.MediaFilename == nil || message.Location == nil || len(message.Contacts) != 1 ||
					message.QuotedMessage == nil || !message.QuotedMessage.Available {
					t.Fatal("ordinary message lost its permitted presentation")
				}
				return
			}
			if message.MessageType != kind || message.MediaFilename != nil || message.Location != nil ||
				len(message.Contacts) != 0 || message.QuotedMessage != nil {
				t.Fatal("deleted message retained structured content or changed its tombstone")
			}
			// Invalid/stale presentation payloads must not restore cached fields.
			message.Contacts = []MessageContact{{DisplayName: "Synthetic cached contact"}}
			applyMessagePresentation(&message, "{")
			if len(message.Contacts) != 0 {
				t.Fatal("deleted message exposed cached presentation after decode failure")
			}
		})
	}
}
