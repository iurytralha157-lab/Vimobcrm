package roundrobin

import (
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
)

func buildMetadata(strategy string, targetStageID *string, settings map[string]any, reentryBehavior string) map[string]any {
	metadata := map[string]any{
		"strategy":         strategy,
		"settings":         normalizeObject(settings),
		"reentry_behavior": reentryBehavior,
	}
	if targetStageID != nil {
		metadata["target_stage_id"] = *targetStageID
	}
	return metadata
}

func rulePayload(matchType string, matchValue string, match map[string]any) map[string]any {
	return map[string]any{
		"match_type":  matchType,
		"match_value": matchValue,
		"match":       normalizeObject(match),
	}
}

func parseObject(raw string) map[string]any {
	if strings.TrimSpace(raw) == "" {
		return map[string]any{}
	}
	out := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return map[string]any{}
	}
	return out
}

func cloneObject(value map[string]any) map[string]any {
	out := map[string]any{}
	for key, item := range value {
		out[key] = item
	}
	return out
}

func stringFromObject(value map[string]any, key string, fallback string) string {
	raw, ok := value[key].(string)
	if !ok || raw == "" {
		return fallback
	}
	return raw
}

func stringPointerFromMetadata(value map[string]any, key string) *string {
	raw := stringFromObject(value, key, "")
	if raw == "" {
		return nil
	}
	return &raw
}

func objectFromObject(value map[string]any, key string) map[string]any {
	raw, ok := value[key].(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return raw
}

func valueOrNil[T any](value *T) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullable(value *string) any {
	if value == nil || *value == "" {
		return nil
	}
	return *value
}

func textValue(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func jsonb(value any) string {
	payload, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(payload)
}
