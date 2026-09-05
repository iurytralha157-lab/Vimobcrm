package whatsapp

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestWhatsAppMediaQueueEnqueuePathsUseMinimalMessageKey(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve current test file")
	}
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(currentFile), "media_queue.go"))
	if err != nil {
		t.Fatalf("read media queue implementation: %v", err)
	}
	source := string(raw)
	if got := strings.Count(source, "minimalWhatsAppMediaMessageKey("); got != 2 {
		t.Fatalf("minimal message-key enqueue calls = %d, want 2", got)
	}
	for _, forbidden := range []string{
		`"media_base64":        message.MediaBase64`,
		`"raw":                 message.Raw`,
		`"raw":                 raw`,
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("queue still persists forbidden message-key field: %s", forbidden)
		}
	}
}

func TestMinimalWhatsAppMediaMessageKeyDropsWebhookPayloadAndInlineMedia(t *testing.T) {
	message := nativeEvolutionMessage{
		ProviderMessageID: "provider-media-1",
		MessageType:       "image",
		MediaURL:          "https://provider.example/media/full?token=temporary",
		MediaBase64:       "data:image/jpeg;base64,full-file-bytes",
		Raw: map[string]any{
			"token": "webhook-secret",
			"message": map[string]any{
				"imageMessage": map[string]any{
					"url":                 "https://cdn.example/media/encrypted",
					"directPath":          "/v/t62.7118-24/media.enc",
					"mediaKey":            "small-media-key",
					"fileSha256":          "small-file-sha",
					"fileEncSha256":       "small-encrypted-sha",
					"fileLength":          float64(2048),
					"mediaKeyTimestamp":   float64(1_725_000_000),
					"mimetype":            "image/jpeg",
					"jpegThumbnail":       "thumbnail-bytes",
					"thumbnailDirectPath": "/thumbnail/path",
					"caption":             "private caption",
					"base64":              "full-file-bytes",
				},
			},
			"raw": map[string]any{"nested": "event"},
		},
	}

	key := minimalWhatsAppMediaMessageKey(message)
	encoded, err := json.Marshal(key)
	if err != nil {
		t.Fatalf("marshal minimal message key: %v", err)
	}
	serialized := string(encoded)
	for _, forbidden := range []string{
		"media_base64", "full-file-bytes", "jpegThumbnail", "thumbnail", "private caption", "webhook-secret", `\"raw\"`,
	} {
		if strings.Contains(serialized, forbidden) {
			t.Fatalf("minimal message key retained %q: %s", forbidden, serialized)
		}
	}
	if strings.Contains(serialized, "provider.example") {
		t.Fatalf("top-level media URL must not be duplicated when a provider block exists: %s", serialized)
	}

	providerMessage, err := nativeEvolutionProviderMessage(nativeEvolutionMessage{Raw: key})
	if err != nil {
		t.Fatalf("sanitized key is not recoverable by the provider adapter: %v", err)
	}
	block := mapFromAny(providerMessage["imageMessage"])
	for _, required := range []string{"directPath", "mediaKey", "fileSha256", "fileEncSha256", "fileLength", "mimetype"} {
		if block[required] == nil {
			t.Fatalf("sanitized provider block omitted %q: %#v", required, block)
		}
	}
	if len(block) != 8 {
		t.Fatalf("sanitized provider block fields = %d, want 8: %#v", len(block), block)
	}
}

func TestMinimalWhatsAppMediaMessageKeyUsesBoundedHTTPFallbackOnly(t *testing.T) {
	key := minimalWhatsAppMediaMessageKey(nativeEvolutionMessage{
		MessageType: "document",
		MediaURL:    " https://media.example/document.pdf ",
		Raw: map[string]any{
			"documentMessage": map[string]any{
				"jpegThumbnail": "preview-only",
				"mimetype":      "application/pdf",
			},
		},
	})
	if got := firstString(key, "media_url"); got != "https://media.example/document.pdf" {
		t.Fatalf("fallback media URL = %q", got)
	}
	if len(key) != 1 {
		t.Fatalf("fallback message key = %#v, want one field", key)
	}

	for _, unsafeURL := range []string{
		"data:application/pdf;base64,full-file-bytes",
		"file:///tmp/private.pdf",
		"javascript:alert(1)",
		"https://media.example/" + strings.Repeat("a", whatsappMediaQueueURLMaxBytes),
	} {
		unsafeKey := minimalWhatsAppMediaMessageKey(nativeEvolutionMessage{MediaURL: unsafeURL})
		if len(unsafeKey) != 0 {
			t.Fatalf("unsafe media URL %q was persisted as %#v", unsafeURL[:min(len(unsafeURL), 80)], unsafeKey)
		}
	}
}

func TestMinimalWhatsAppMediaMessageKeyRejectsOversizedCryptoField(t *testing.T) {
	key := minimalWhatsAppMediaMessageKey(nativeEvolutionMessage{
		MessageType: "audio",
		Raw: map[string]any{
			"message": map[string]any{
				"audioMessage": map[string]any{
					"directPath": "/media/audio.enc",
					"mediaKey":   strings.Repeat("k", whatsappMediaQueueCryptoMaxBytes+1),
					"waveform":   "preview-data",
				},
			},
		},
	})
	block := mapFromAny(mapFromAny(key["message"])["audioMessage"])
	if block["mediaKey"] != nil || block["waveform"] != nil {
		t.Fatalf("oversized or preview fields were persisted: %#v", block)
	}
	if block["directPath"] != "/media/audio.enc" {
		t.Fatalf("required directPath was not retained: %#v", block)
	}
}
