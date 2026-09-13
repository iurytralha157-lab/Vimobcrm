package portals

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"
)

func payloadHash(payload []byte) string {
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func decodePortalJSONUseNumber(payload []byte) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()
	var decoded any
	if err := decoder.Decode(&decoded); err != nil {
		return nil, err
	}
	return decoded, nil
}

const maxGrupoOLXProviderIDRunes = 512

func normalizeGrupoOLXLeadEventKey(value string, payload []byte) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "sha256:" + payloadHash(payload)
	}
	if utf8.RuneCountInString(value) > maxGrupoOLXProviderIDRunes {
		return "sha256:" + payloadHash(payload)
	}
	return value
}

func firstText(source map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := source[key]; ok {
			switch typed := value.(type) {
			case string:
				if text := strings.TrimSpace(typed); text != "" {
					return text
				}
			case float64:
				return fmt.Sprintf("%.0f", typed)
			case json.Number:
				return typed.String()
			}
		}
	}
	return ""
}

func firstValue(source map[string]any, keys ...string) any {
	for _, key := range keys {
		if value, ok := source[key]; ok && value != nil {
			return value
		}
	}
	return nil
}

func objectValue(value any) map[string]any {
	if object, ok := value.(map[string]any); ok {
		return object
	}
	return map[string]any{}
}

func numericValue(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		parsed, _ := typed.Float64()
		return parsed
	case string:
		var parsed float64
		_, _ = fmt.Sscanf(strings.TrimSpace(typed), "%f", &parsed)
		return parsed
	default:
		return 0
	}
}
