package portals

import (
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/jsonvalue"
)

func scanJSONRows(rows pgx.Rows) ([]map[string]any, error) {
	items := []map[string]any{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		item, err := jsonvalue.DecodeObjectAllowBlank(raw)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func optionalUUIDText(value OptionalString) string {
	if value.Value == nil {
		return ""
	}
	return strings.TrimSpace(*value.Value)
}

func optionalUUIDValue(value OptionalString) any {
	text := optionalUUIDText(value)
	if text == "" {
		return nil
	}
	return text
}

func nonNilMap(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	return value
}

func onlyDigits(value string) string {
	var builder strings.Builder
	for _, r := range value {
		if r >= '0' && r <= '9' {
			builder.WriteRune(r)
		}
	}
	return builder.String()
}

func nullableStringValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339)
}
