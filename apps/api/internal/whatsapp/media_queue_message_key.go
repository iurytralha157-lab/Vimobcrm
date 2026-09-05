package whatsapp

import (
	"encoding/json"
	"strings"
)

const (
	whatsappMediaQueueURLMaxBytes      = 8 << 10
	whatsappMediaQueueCryptoMaxBytes   = 4 << 10
	whatsappMediaQueueMIMETypeMaxBytes = 512
	whatsappMediaQueueNumericMaxBytes  = 64
)

type whatsappMediaQueueBlockSpec struct {
	kind      string
	canonical string
	aliases   []string
}

var whatsappMediaQueueBlockSpecs = []whatsappMediaQueueBlockSpec{
	{kind: "image", canonical: "imageMessage", aliases: []string{"imageMessage", "ImageMessage"}},
	{kind: "video", canonical: "videoMessage", aliases: []string{"videoMessage", "VideoMessage"}},
	{kind: "audio", canonical: "audioMessage", aliases: []string{"audioMessage", "AudioMessage"}},
	{kind: "document", canonical: "documentMessage", aliases: []string{"documentMessage", "DocumentMessage"}},
	{kind: "sticker", canonical: "stickerMessage", aliases: []string{"stickerMessage", "StickerMessage"}},
}

// minimalWhatsAppMediaMessageKey keeps only the fields required to recover the
// encrypted WhatsApp media. In particular, it never persists the webhook raw
// envelope, inline media bytes, previews, thumbnails, captions, or context.
func minimalWhatsAppMediaMessageKey(message nativeEvolutionMessage) map[string]any {
	blockName, block := minimalWhatsAppMediaProviderBlock(message)
	if len(block) > 0 {
		return map[string]any{
			"message": map[string]any{
				blockName: block,
			},
		}
	}

	if mediaURL := minimalWhatsAppMediaHTTPURL(message.MediaURL); mediaURL != "" {
		return map[string]any{"media_url": mediaURL}
	}
	return map[string]any{}
}

func minimalWhatsAppMediaProviderBlock(message nativeEvolutionMessage) (string, map[string]any) {
	node := nativeFirstMap(message.Raw, "message", "Message")
	if len(node) == 0 {
		node = message.Raw
	}

	specs := whatsappMediaQueueBlockSpecs
	if preferred, ok := whatsappMediaQueueBlockSpecForType(message.MessageType); ok {
		specs = append([]whatsappMediaQueueBlockSpec{preferred}, specs...)
	}

	seen := make(map[string]struct{}, len(specs))
	for _, spec := range specs {
		if _, ok := seen[spec.canonical]; ok {
			continue
		}
		seen[spec.canonical] = struct{}{}
		if rawBlock := nativeFirstMap(node, spec.aliases...); len(rawBlock) > 0 {
			if block := filterWhatsAppMediaProviderBlock(rawBlock); len(block) > 0 {
				return spec.canonical, block
			}
		}
	}

	if preferred, ok := whatsappMediaQueueBlockSpecForType(message.MessageType); ok {
		if block := filterWhatsAppMediaProviderBlock(node); len(block) > 0 {
			return preferred.canonical, block
		}
	}
	return "", nil
}

func whatsappMediaQueueBlockSpecForType(messageType string) (whatsappMediaQueueBlockSpec, bool) {
	normalized := strings.ToLower(strings.TrimSpace(messageType))
	normalized = strings.TrimSuffix(normalized, "message")
	for _, spec := range whatsappMediaQueueBlockSpecs {
		if normalized == spec.kind {
			return spec, true
		}
	}
	return whatsappMediaQueueBlockSpec{}, false
}

func filterWhatsAppMediaProviderBlock(raw map[string]any) map[string]any {
	filtered := make(map[string]any, 8)
	for key, value := range raw {
		canonical, maxBytes, ok := whatsappMediaQueueProviderField(key)
		if !ok {
			continue
		}
		clean, ok := minimalWhatsAppMediaProviderValue(canonical, value, maxBytes)
		if ok {
			filtered[canonical] = clean
		}
	}
	if filtered["url"] == nil && filtered["directPath"] == nil {
		return nil
	}
	return filtered
}

func whatsappMediaQueueProviderField(key string) (canonical string, maxBytes int, ok bool) {
	normalized := strings.ToLower(strings.NewReplacer("_", "", "-", "").Replace(strings.TrimSpace(key)))
	switch normalized {
	case "url":
		return "url", whatsappMediaQueueURLMaxBytes, true
	case "directpath":
		return "directPath", whatsappMediaQueueURLMaxBytes, true
	case "mediakey":
		return "mediaKey", whatsappMediaQueueCryptoMaxBytes, true
	case "filesha256":
		return "fileSha256", whatsappMediaQueueCryptoMaxBytes, true
	case "fileencsha256":
		return "fileEncSha256", whatsappMediaQueueCryptoMaxBytes, true
	case "filelength":
		return "fileLength", whatsappMediaQueueNumericMaxBytes, true
	case "mediakeytimestamp":
		return "mediaKeyTimestamp", whatsappMediaQueueNumericMaxBytes, true
	case "mimetype":
		return "mimetype", whatsappMediaQueueMIMETypeMaxBytes, true
	default:
		return "", 0, false
	}
}

func minimalWhatsAppMediaProviderValue(field string, value any, maxBytes int) (any, bool) {
	switch typed := value.(type) {
	case string:
		clean := strings.TrimSpace(stripNullBytes(typed))
		if clean == "" || len(clean) > maxBytes {
			return nil, false
		}
		switch field {
		case "url":
			if !looksLikeHTTPURL(clean) {
				return nil, false
			}
		case "directPath":
			if !strings.HasPrefix(clean, "/") {
				return nil, false
			}
		}
		return clean, true
	case json.Number:
		if field != "fileLength" && field != "mediaKeyTimestamp" {
			return nil, false
		}
		if raw := typed.String(); raw != "" && len(raw) <= maxBytes {
			return typed, true
		}
	case float64, float32, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		if field == "fileLength" || field == "mediaKeyTimestamp" {
			return typed, true
		}
	}
	return nil, false
}

func minimalWhatsAppMediaHTTPURL(value string) string {
	value = strings.TrimSpace(stripNullBytes(value))
	if value == "" || len(value) > whatsappMediaQueueURLMaxBytes || !looksLikeHTTPURL(value) {
		return ""
	}
	return value
}
