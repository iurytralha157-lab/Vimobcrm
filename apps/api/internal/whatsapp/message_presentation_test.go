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
