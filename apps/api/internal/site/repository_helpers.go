package site

import (
	"encoding/json"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/numericinput"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/pgvalue"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	"strconv"
	"strings"
)

func canManageSite(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission(permissions.SettingsSite)
}

func cleanRequired(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func boolValue(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

func intValue(value *int, fallback int) int {
	if value == nil {
		return fallback
	}
	return *value
}

func textPointer(value pgtype.Text) *string {
	return pgvalue.TextPointer(value)
}

func intPointer(value pgtype.Int4) *int {
	if !value.Valid {
		return nil
	}
	out := int(value.Int32)
	return &out
}

func boolPointer(value pgtype.Bool) *bool {
	if !value.Valid {
		return nil
	}
	return &value.Bool
}

func jsonPointer(value []byte) *json.RawMessage {
	if len(value) == 0 || string(value) == "null" {
		return nil
	}
	raw := json.RawMessage(value)
	return &raw
}

func normalizeUUID(value string) (string, bool) {
	return pgvalue.NormalizeUUID(value)
}

func normalizePublicDomain(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.TrimPrefix(value, "https://")
	value = strings.TrimPrefix(value, "http://")
	if before, _, ok := strings.Cut(value, "/"); ok {
		value = before
	}
	if host, _, ok := strings.Cut(value, ":"); ok {
		value = host
	}
	return strings.Trim(value, ". ")
}

func optionalText(value *string) any {
	if value == nil {
		return nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil
	}
	return cleaned
}

func parsePublicPositiveInt(value string, fallback int, min int, max int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return fallback
	}
	if parsed < min {
		return min
	}
	if parsed > max {
		return max
	}
	return parsed
}

func parsePublicInt(value string) (int, bool) {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return 0, false
	}
	return parsed, true
}

func parsePublicDecimal(value string) (float64, bool) {
	return numericinput.ParseNonNegativeDecimal(value)
}

func parsePublicBool(value string) (bool, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "true", "1", "sim", "yes":
		return true, true
	case "false", "0", "nao", "não", "no":
		return false, true
	default:
		return false, false
	}
}

func isAllowedAssetType(value string) bool {
	switch value {
	case "logo", "favicon", "about", "hero", "banner", "watermark":
		return true
	default:
		return false
	}
}

func extensionForContentType(contentType string) string {
	if before, _, ok := strings.Cut(contentType, ";"); ok {
		contentType = before
	}
	switch strings.ToLower(strings.TrimSpace(contentType)) {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "image/svg+xml":
		return ".svg"
	case "image/x-icon", "image/vnd.microsoft.icon":
		return ".ico"
	default:
		if strings.HasPrefix(contentType, "image/") {
			return "." + strings.TrimPrefix(contentType, "image/")
		}
		return ""
	}
}
