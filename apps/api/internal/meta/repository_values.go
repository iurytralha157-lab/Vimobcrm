package meta

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/pgvalue"
)

func cloneObject(value map[string]any) map[string]any {
	out := map[string]any{}
	for key, item := range value {
		out[key] = item
	}
	return out
}

func objectMap(value any) map[string]any {
	switch typed := value.(type) {
	case nil:
		return map[string]any{}
	case map[string]any:
		return typed
	case string:
		var out map[string]any
		if err := json.Unmarshal([]byte(typed), &out); err == nil && out != nil {
			return out
		}
	case []byte:
		var out map[string]any
		if err := json.Unmarshal(typed, &out); err == nil && out != nil {
			return out
		}
	}
	return map[string]any{}
}

func stringMap(value any) map[string]string {
	out := map[string]string{}
	switch typed := value.(type) {
	case map[string]any:
		for key, item := range typed {
			out[key] = textFromAny(item)
		}
	case map[string]string:
		return typed
	case string:
		var parsed map[string]string
		if err := json.Unmarshal([]byte(typed), &parsed); err == nil && parsed != nil {
			return parsed
		}
	case []byte:
		var parsed map[string]string
		if err := json.Unmarshal(typed, &parsed); err == nil && parsed != nil {
			return parsed
		}
	}
	return out
}

func stringSlice(value any) []string {
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		out := []string{}
		for _, item := range typed {
			if text := textFromAny(item); text != "" {
				out = append(out, text)
			}
		}
		return out
	case string:
		var parsed []string
		if err := json.Unmarshal([]byte(typed), &parsed); err == nil && parsed != nil {
			return parsed
		}
	case []byte:
		var parsed []string
		if err := json.Unmarshal(typed, &parsed); err == nil && parsed != nil {
			return parsed
		}
	}
	return []string{}
}

func stringFromMap(item map[string]any, key string) string {
	return textFromAny(item[key])
}

func cleanAnyString(value any) *string {
	text := textFromAny(value)
	if text == "" {
		return nil
	}
	return &text
}

func textFromAny(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	case float64:
		if typed == float64(int64(typed)) {
			return fmt.Sprintf("%.0f", typed)
		}
		return strings.TrimSpace(fmt.Sprint(typed))
	case int:
		return fmt.Sprint(typed)
	case int64:
		return fmt.Sprint(typed)
	case bool:
		return fmt.Sprint(typed)
	default:
		return ""
	}
}

func boolSetting(settings map[string]any, key string) bool {
	value, ok := settings[key]
	if !ok {
		return false
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		text := strings.ToLower(strings.TrimSpace(typed))
		return text == "true" || text == "1" || text == "yes" || text == "sim"
	default:
		return false
	}
}

func intSetting(settings map[string]any, key string, fallback int) int {
	value, ok := settings[key]
	if !ok {
		return fallback
	}
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		parsed, err := typed.Int64()
		if err == nil {
			return int(parsed)
		}
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(typed))
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func uuidPointer(value any) *string {
	text := textFromAny(value)
	if text == "" {
		return nil
	}
	normalized, ok := normalizeUUID(text)
	if !ok {
		return nil
	}
	return &normalized
}

func firstUUID(values ...*string) *string {
	for _, value := range values {
		if value == nil {
			continue
		}
		normalized, ok := normalizeUUID(*value)
		if ok {
			return &normalized
		}
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func coalesceText(value *string, fallback string) string {
	if value != nil && strings.TrimSpace(*value) != "" {
		return strings.TrimSpace(*value)
	}
	return fallback
}

func nullableString(value string) any {
	return pgvalue.NullableTrimmedString(value)
}

func nullablePointer(value *string) any {
	return pgvalue.NullableTrimmedStringPointer(value)
}

func textPointer(value pgtype.Text) *string {
	return pgvalue.TextPointerTrimmed(value)
}

func jsonb(value any) string {
	payload, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(payload)
}

func normalizeUUID(value string) (string, bool) {
	return pgvalue.NormalizeUUID(value)
}

func digitsOnly(value *string) string {
	if value == nil {
		return ""
	}
	var builder strings.Builder
	for _, char := range *value {
		if char >= '0' && char <= '9' {
			builder.WriteRune(char)
		}
	}
	return builder.String()
}

func isUndefinedColumn(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "42703"
	}
	return strings.Contains(err.Error(), "does not exist")
}
