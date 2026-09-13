package financial

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/pgvalue"
)

func optionalText(value *string) any {
	if value == nil {
		return nil
	}
	text := strings.TrimSpace(*value)
	if text == "" {
		return nil
	}
	return text
}

func nullableString(value any) any {
	text := stringValue(value)
	if text == "" {
		return nil
	}
	return text
}

func nullableNumber(value any) any {
	if value == nil {
		return nil
	}
	return numberValue(value)
}

func positiveFiniteNumber(value any) (float64, bool) {
	number := numberValue(value)
	return number, number > 0 && !math.IsNaN(number) && !math.IsInf(number, 0)
}

func finiteNumberValue(value any) (float64, bool) {
	var number float64
	switch typed := value.(type) {
	case float64:
		number = typed
	case float32:
		number = float64(typed)
	case int:
		number = float64(typed)
	case int8:
		number = float64(typed)
	case int16:
		number = float64(typed)
	case int32:
		number = float64(typed)
	case int64:
		number = float64(typed)
	case uint:
		number = float64(typed)
	case uint8:
		number = float64(typed)
	case uint16:
		number = float64(typed)
	case uint32:
		number = float64(typed)
	case uint64:
		number = float64(typed)
	case json.Number:
		parsed, err := typed.Float64()
		if err != nil {
			return 0, false
		}
		number = parsed
	case string:
		text := strings.TrimSpace(typed)
		if text == "" {
			return 0, false
		}
		parsed, err := strconv.ParseFloat(text, 64)
		if err != nil {
			return 0, false
		}
		number = parsed
	default:
		return 0, false
	}
	return number, !math.IsNaN(number) && !math.IsInf(number, 0)
}

func integerValue(value any) (int, bool) {
	number, ok := finiteNumberValue(value)
	if !ok || math.Trunc(number) != number || number < float64(math.MinInt) || number > float64(math.MaxInt) {
		return 0, false
	}
	return int(number), true
}

func optionalIntegerField(payload map[string]any, key string, minimum int, maximum int) (int, bool, error) {
	raw, provided := payload[key]
	if !provided || isNilOrEmptyString(raw) {
		return 0, false, nil
	}
	value, ok := integerValue(raw)
	if !ok || value < minimum || value > maximum {
		return 0, false, ErrInvalidInput
	}
	payload[key] = value
	return value, true, nil
}

func isNilOrEmptyString(value any) bool {
	if value == nil {
		return true
	}
	text, ok := value.(string)
	return ok && strings.TrimSpace(text) == ""
}

func isFinancialCalendarDate(value string) bool {
	if len(value) != len("2006-01-02") {
		return false
	}
	parsed, err := time.Parse("2006-01-02", value)
	return err == nil && parsed.Format("2006-01-02") == value
}

func allowedString(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	default:
		return ""
	}
}

func numberValue(value any) float64 {
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
		parsed, _ := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(typed), ",", "."), 64)
		return parsed
	default:
		return 0
	}
}

func intFromAny(value any, fallback int) int {
	number := numberValue(value)
	if number <= 0 {
		return fallback
	}
	return int(number)
}

func normalizeUUID(value string) (string, bool) {
	return pgvalue.NormalizeUUID(value)
}
