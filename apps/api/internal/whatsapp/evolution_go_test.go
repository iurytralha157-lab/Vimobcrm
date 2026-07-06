package whatsapp

import "testing"

func TestEvolutionSendMediaBodyKeepsURLAndBase64Separate(t *testing.T) {
	body := evolutionSendMediaBody(map[string]any{
		"number":       "5511999999999",
		"type":         "image",
		"url":          "https://example.com/image.png?token=abc",
		"mimetype":     "image/png",
		"filename":     "image.png",
		"caption":      "Teste",
		"mentionedJid": []string{},
	}, "")

	if body["url"] != "https://example.com/image.png?token=abc" {
		t.Fatalf("expected URL media to stay in url field, got %#v", body["url"])
	}
	if _, exists := body["base64"]; exists {
		t.Fatalf("expected URL media to not populate base64 field, got %#v", body["base64"])
	}
}

func TestEvolutionSendMediaBodyDoesNotTreatBase64AsURL(t *testing.T) {
	body := evolutionSendMediaBody(map[string]any{
		"number":   "5511999999999",
		"type":     "audio",
		"base64":   "UklGRiQAAABXQVZFZm10IBAAAAABAAEA",
		"mimetype": "audio/webm",
		"filename": "audio.webm",
	}, "")

	if body["base64"] != "UklGRiQAAABXQVZFZm10IBAAAAABAAEA" {
		t.Fatalf("expected base64 media to stay in base64 field, got %#v", body["base64"])
	}
	if _, exists := body["url"]; exists {
		t.Fatalf("expected base64 media to not populate url field, got %#v", body["url"])
	}
}
