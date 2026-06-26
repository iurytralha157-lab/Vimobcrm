package whatsapp

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"mime"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"
)

var (
	mentionPattern      = regexp.MustCompile(`@(\d{7,})`)
	filenameLikePattern = regexp.MustCompile(`(?i)^\S+\.(png|jpg|jpeg|gif|webp|mp4|mp3|ogg|pdf|doc|docx|webm)$`)
)

func jsonb(value any) []byte {
	raw, _ := json.Marshal(value)
	if len(raw) == 0 {
		return []byte("{}")
	}

	return raw
}

func randomHex(bytesLen int) string {
	buffer := make([]byte, bytesLen)
	if _, err := rand.Read(buffer); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}

	return hex.EncodeToString(buffer)
}

func createSecretToken() string {
	return randomHex(16)
}

func createClientMessageID() string {
	return randomHex(16)
}

func createInstanceName(displayName string, organizationID string) string {
	sanitized := strings.Builder{}
	for _, r := range strings.ToLower(displayName) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			sanitized.WriteRune(r)
		}
	}

	prefix := sanitized.String()
	if prefix == "" {
		prefix = "whatsapp"
	}
	if len(prefix) > 20 {
		prefix = prefix[:20]
	}

	orgPrefix := strings.ReplaceAll(organizationID, "-", "")
	if len(orgPrefix) > 5 {
		orgPrefix = orgPrefix[:5]
	}

	return fmt.Sprintf("%s_%s_%s", prefix, orgPrefix, randomHex(2))
}

func firstString(value any, paths ...string) string {
	for _, path := range paths {
		current := value
		for _, key := range strings.Split(path, ".") {
			if object, ok := current.(map[string]any); ok {
				current = object[key]
			} else {
				current = nil
				break
			}
		}
		switch typed := current.(type) {
		case string:
			if strings.TrimSpace(typed) != "" {
				return typed
			}
		case float64:
			return fmt.Sprintf("%.0f", typed)
		case int:
			return fmt.Sprintf("%d", typed)
		}
	}

	return ""
}

func firstMap(value any, paths ...string) map[string]any {
	for _, path := range paths {
		current := value
		for _, key := range strings.Split(path, ".") {
			if object, ok := current.(map[string]any); ok {
				current = object[key]
			} else {
				current = nil
				break
			}
		}
		if object, ok := current.(map[string]any); ok {
			return object
		}
	}

	return map[string]any{}
}

func providerResultOK(result map[string]any) bool {
	if result == nil {
		return false
	}
	if okValue, exists := result["ok"]; exists {
		if ok, okType := okValue.(bool); okType {
			return ok
		}
	}
	if successValue, exists := result["success"]; exists {
		if success, okType := successValue.(bool); okType {
			return success
		}
	}

	return true
}

func providerErrorMessage(result map[string]any, fallback string) string {
	message := firstString(result, "error", "message", "msg", "data.error", "data.message", "data.msg")
	if message == "" {
		errorObject := firstMap(result, "data.error")
		message = firstString(errorObject, "message", "error")
	}
	if message == "" {
		return fallback
	}

	return message
}

func evolutionInstanceID(result map[string]any) string {
	return firstString(result,
		"data.data.id",
		"data.instance.id",
		"data.id",
		"data.instance.uuid",
		"data.uuid",
		"instance.id",
		"id",
	)
}

func providerMessageID(result map[string]any) string {
	paths := []string{
		"sentMessageId", "messageId", "messageID", "MessageID", "id", "ID", "Id",
		"key.id", "key.ID", "Key.ID", "Info.ID", "Info.Id", "info.ID", "info.id",
		"data.sentMessageId", "data.messageId", "data.messageID", "data.MessageID",
		"data.id", "data.ID", "data.key.id", "data.Key.ID", "data.Info.ID",
		"data.Info.Id", "data.info.ID", "data.info.id", "Data.messageId",
		"Data.MessageID", "Data.id", "Data.ID", "Data.Info.ID", "Data.Info.Id",
		"message.key.id", "message.Key.ID", "data.message.key.id",
		"data.message.Key.ID", "response.key.id", "response.Key.ID",
	}

	return firstString(result, paths...)
}

func normalizeDigits(value string) string {
	var builder strings.Builder
	for _, r := range value {
		if unicode.IsDigit(r) {
			builder.WriteRune(r)
		}
	}

	return builder.String()
}

func normalizePhone(value string) string {
	digits := normalizeDigits(value)
	if strings.HasPrefix(digits, "55") && len(digits) > 11 {
		return digits[2:]
	}

	return digits
}

func formatPhoneForWhatsApp(value string) string {
	digits := normalizeDigits(value)
	if digits == "" {
		return ""
	}
	if strings.HasPrefix(digits, "55") {
		return digits
	}
	if len(digits) == 10 || len(digits) == 11 {
		return "55" + digits
	}

	return digits
}

func phoneVariants(value string) []string {
	cleaned := normalizeDigits(value)
	normalized := normalizePhone(value)
	candidates := []string{cleaned, normalized}
	if normalized != "" {
		candidates = append(candidates, "55"+normalized)
	}

	for _, candidate := range append([]string{}, candidates...) {
		local := normalizePhone(candidate)
		if len(local) == 11 && local[2] == '9' {
			withoutNinth := local[:2] + local[3:]
			candidates = append(candidates, withoutNinth, "55"+withoutNinth)
		}
		if len(local) == 10 {
			withNinth := local[:2] + "9" + local[2:]
			candidates = append(candidates, withNinth, "55"+withNinth)
		}
	}

	seen := map[string]struct{}{}
	out := []string{}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if _, exists := seen[candidate]; exists {
			continue
		}
		seen[candidate] = struct{}{}
		out = append(out, candidate)
	}

	return out
}

func isValidWhatsAppPhone(value string) bool {
	digits := normalizeDigits(value)
	return len(digits) >= 10
}

func outgoingLastMessage(messageType string, text string, senderName string, isGroup bool) string {
	if messageType == "" || messageType == "text" {
		return text
	}

	nouns := map[string][2]string{
		"image":    {"uma", "imagem"},
		"video":    {"um", "video"},
		"audio":    {"um", "audio"},
		"document": {"um", "documento"},
		"sticker":  {"uma", "figurinha"},
	}
	label := nouns[messageType]
	if label[0] == "" {
		label = [2]string{"uma", "midia"}
	}

	actor := "Voce"
	if isGroup && strings.TrimSpace(senderName) != "" {
		actor = senderName
	}

	return fmt.Sprintf("%s enviou %s %s", actor, label[0], label[1])
}

func textLooksLikeFilename(text string, filename string) bool {
	text = strings.TrimSpace(text)
	if text == "" {
		return false
	}
	if filename != "" && text == filename {
		return true
	}

	return filenameLikePattern.MatchString(text)
}

func mentionsFromText(text string) []string {
	matches := mentionPattern.FindAllStringSubmatch(text, -1)
	out := make([]string, 0, len(matches))
	for _, match := range matches {
		if len(match) > 1 {
			out = append(out, match[1])
		}
	}

	return out
}

func decodeBase64Media(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	if strings.Contains(value, ",") && strings.HasPrefix(value, "data:") {
		_, after, _ := strings.Cut(value, ",")
		value = after
	}

	return base64.StdEncoding.DecodeString(value)
}

func mediaExtension(mimetype string) string {
	baseType := strings.Split(strings.TrimSpace(mimetype), ";")[0]
	known := map[string]string{
		"image/jpeg":      "jpg",
		"image/png":       "png",
		"image/gif":       "gif",
		"image/webp":      "webp",
		"video/mp4":       "mp4",
		"audio/ogg":       "ogg",
		"audio/webm":      "webm",
		"audio/mpeg":      "mp3",
		"application/pdf": "pdf",
	}
	if ext := known[baseType]; ext != "" {
		return ext
	}

	extensions, err := mime.ExtensionsByType(baseType)
	if err == nil && len(extensions) > 0 {
		return strings.TrimPrefix(extensions[0], ".")
	}
	if ext := strings.TrimPrefix(filepath.Ext(baseType), "."); ext != "" {
		return ext
	}

	return "bin"
}

func storagePathFromPublicURL(value string) string {
	const marker = "/storage/v1/object/public/whatsapp-media/"
	index := strings.Index(value, marker)
	if index < 0 {
		return ""
	}

	path := value[index+len(marker):]
	path = strings.Split(path, "?")[0]
	return strings.Trim(path, "/")
}
