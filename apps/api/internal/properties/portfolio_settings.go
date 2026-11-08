package properties

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
)

// ErrPropertySettingsConflict means the caller edited an older revision.
var ErrPropertySettingsConflict = errors.New("property settings revision is stale")

const (
	portfolioSettingsMaxListItems  = 30
	portfolioSettingsMaxListString = 80
	portfolioSettingsBodyLimit     = 64 << 10
)

type portfolioSettingKind int

const (
	portfolioSettingBool portfolioSettingKind = iota
	portfolioSettingInt
	portfolioSettingNumber
	portfolioSettingEnum
	portfolioSettingStringList
)

type portfolioSettingSpec struct {
	kind     portfolioSettingKind
	minimum  float64
	maximum  float64
	options  []string
	fallback any
}

func settingBool(fallback bool) portfolioSettingSpec {
	return portfolioSettingSpec{kind: portfolioSettingBool, fallback: fallback}
}

func settingInt(minimum, maximum, fallback int64) portfolioSettingSpec {
	return portfolioSettingSpec{kind: portfolioSettingInt, minimum: float64(minimum), maximum: float64(maximum), fallback: fallback}
}

func settingPercent(fallback float64) portfolioSettingSpec {
	return portfolioSettingSpec{kind: portfolioSettingNumber, minimum: 0, maximum: 100, fallback: fallback}
}

func settingEnum(fallback string, options ...string) portfolioSettingSpec {
	return portfolioSettingSpec{kind: portfolioSettingEnum, options: options, fallback: fallback}
}

func settingList(fallback ...string) portfolioSettingSpec {
	if fallback == nil {
		fallback = []string{}
	}
	return portfolioSettingSpec{kind: portfolioSettingStringList, fallback: fallback}
}

// portfolioSettingsSchema is the only source of accepted keys, types, ranges and
// defaults. These settings are stored only: nothing reads them to change
// publication or edit behaviour yet, and the defaults reflect the current
// behaviour of the product (nothing required, nothing automatic).
var portfolioSettingsSchema = map[string]map[string]portfolioSettingSpec{
	"general": {
		"auto_code":            settingBool(true),
		"required_fields":      settingInt(0, 100, 0),
		"duplicate_warning":    settingBool(true),
		"min_completeness_pct": settingInt(0, 100, 0),
		"min_photos":           settingInt(0, propertyAssetMaxPhotos, 0),
		"price_review_days":    settingInt(0, 3650, 90),
	},
	"ready": {
		"require_authorization":       settingBool(false),
		"authorization_warning_days":  settingInt(0, 3650, 30),
		"exclusivity_days":            settingInt(0, 3650, 90),
		"default_sale_commission_pct": settingPercent(6),
	},
	"launches": {
		"commission_pct":       settingPercent(4),
		"table_warning_days":   settingInt(0, 3650, 30),
		"reservation_hours":    settingInt(1, 8760, 48),
		"reservation_approver": settingEnum("manager", "manager", "admin"),
		"broker_sees_sold":     settingBool(true),
	},
	"rentals": {
		"adjustment_index":      settingEnum("IPCA", "IPCA", "IGP-M", "INPC"),
		"guarantees":            settingList(),
		"admin_fee_pct":         settingPercent(10),
		"first_rent_fee_pct":    settingPercent(100),
		"require_inspection":    settingBool(true),
		"contract_warning_days": settingInt(0, 3650, 60),
	},
	"third_party": {
		"default_split_pct":       settingPercent(50),
		"require_authorization":   settingBool(true),
		"partnership_days":        settingInt(0, 3650, 180),
		"publish_on_site":         settingBool(false),
		"show_partner_to_brokers": settingBool(false),
	},
	"condominiums": {
		"brokers_can_create": settingBool(false),
		"apply_default_fee":  settingBool(false),
	},
	"locations": {
		"brokers_can_create_neighborhood": settingBool(false),
		"default_address_visibility":      settingEnum("full", "full", "partial", "neighborhood"),
	},
	"owners": {
		"email_notices":  settingBool(false),
		"monthly_report": settingBool(false),
	},
	"keys": {
		"return_hours":   settingInt(1, 8760, 24),
		"late_alert":     settingBool(true),
		"require_reason": settingBool(false),
		"locations":      settingList(),
	},
	"publication": {
		"auto_publish":     settingBool(false),
		"default_channels": settingList(),
		"watermark":        settingBool(false),
		"manager_approval": settingBool(false),
	},
}

type PortfolioSettings map[string]map[string]any

type UpdatePortfolioSettingsInput struct {
	Settings map[string]any `json:"settings"`
	Revision *int64         `json:"revision"`
}

type PortfolioSettingsResponse struct {
	Settings  PortfolioSettings `json:"settings"`
	Revision  int64             `json:"revision"`
	UpdatedAt *string           `json:"updated_at"`
	UpdatedBy *string           `json:"updated_by"`
}

func validatePortfolioSettingValue(spec portfolioSettingSpec, value any) (any, error) {
	switch spec.kind {
	case portfolioSettingBool:
		typed, ok := value.(bool)
		if !ok {
			return nil, errors.New("must be true or false")
		}
		return typed, nil
	case portfolioSettingInt:
		number, err := portfolioSettingNumberValue(value)
		if err != nil || number != math.Trunc(number) {
			return nil, errors.New("must be a whole number")
		}
		if number < spec.minimum || number > spec.maximum {
			return nil, fmt.Errorf("must be between %d and %d", int64(spec.minimum), int64(spec.maximum))
		}
		return int64(number), nil
	case portfolioSettingNumber:
		number, err := portfolioSettingNumberValue(value)
		if err != nil {
			return nil, errors.New("must be a number")
		}
		if number < spec.minimum || number > spec.maximum {
			return nil, fmt.Errorf("must be between %g and %g", spec.minimum, spec.maximum)
		}
		return number, nil
	case portfolioSettingEnum:
		text, ok := value.(string)
		if ok {
			for _, option := range spec.options {
				if text == option {
					return text, nil
				}
			}
		}
		return nil, fmt.Errorf("must be one of %s", strings.Join(spec.options, ", "))
	case portfolioSettingStringList:
		return normalizePortfolioSettingList(value)
	default:
		return nil, errors.New("is not supported")
	}
}

func portfolioSettingNumberValue(value any) (float64, error) {
	switch typed := value.(type) {
	case json.Number:
		number, err := typed.Float64()
		if err != nil || math.IsNaN(number) || math.IsInf(number, 0) {
			return 0, errors.New("invalid number")
		}
		return number, nil
	case float64:
		return typed, nil
	case int64:
		return float64(typed), nil
	default:
		return 0, errors.New("invalid number")
	}
}

func normalizePortfolioSettingList(value any) ([]string, error) {
	items, ok := value.([]any)
	if !ok {
		if typed, isStrings := value.([]string); isStrings {
			items = make([]any, len(typed))
			for index, item := range typed {
				items[index] = item
			}
		} else {
			return nil, errors.New("must be a list of text values")
		}
	}
	if len(items) > portfolioSettingsMaxListItems {
		return nil, fmt.Errorf("must have at most %d items", portfolioSettingsMaxListItems)
	}
	seen := make(map[string]struct{}, len(items))
	normalized := make([]string, 0, len(items))
	for _, item := range items {
		text, ok := item.(string)
		if !ok {
			return nil, errors.New("must be a list of text values")
		}
		text = strings.TrimSpace(text)
		if text == "" || len([]rune(text)) > portfolioSettingsMaxListString {
			return nil, fmt.Errorf("items must have between 1 and %d characters", portfolioSettingsMaxListString)
		}
		key := strings.ToLower(text)
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		seen[key] = struct{}{}
		normalized = append(normalized, text)
	}
	return normalized, nil
}

// validatePortfolioSettingsPatch rejects any group or key outside the schema.
// The returned value holds only what the request supplied.
func validatePortfolioSettingsPatch(raw map[string]any) (PortfolioSettings, error) {
	patch := PortfolioSettings{}
	for _, group := range sortedAnyKeys(raw) {
		groupSpec, known := portfolioSettingsSchema[group]
		if !known {
			return nil, fmt.Errorf("%w: settings.%s is not supported", ErrInvalidInput, group)
		}
		values, isObject := raw[group].(map[string]any)
		if !isObject {
			return nil, fmt.Errorf("%w: settings.%s must be an object", ErrInvalidInput, group)
		}
		normalized := map[string]any{}
		for _, key := range sortedAnyKeys(values) {
			spec, known := groupSpec[key]
			if !known {
				return nil, fmt.Errorf("%w: settings.%s.%s is not supported", ErrInvalidInput, group, key)
			}
			value, err := validatePortfolioSettingValue(spec, values[key])
			if err != nil {
				return nil, fmt.Errorf("%w: settings.%s.%s %s", ErrInvalidInput, group, key, err.Error())
			}
			normalized[key] = value
		}
		patch[group] = normalized
	}
	return patch, nil
}

// decodeStoredPortfolioSettings ignores anything the current schema no longer
// accepts, so a removed key or a manual edit can never break the settings page.
func decodeStoredPortfolioSettings(raw string) PortfolioSettings {
	stored := PortfolioSettings{}
	decoded := map[string]any{}
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&decoded); err != nil {
		return stored
	}
	for group, groupSpec := range portfolioSettingsSchema {
		values, isObject := decoded[group].(map[string]any)
		if !isObject {
			continue
		}
		for key, spec := range groupSpec {
			current, exists := values[key]
			if !exists {
				continue
			}
			value, err := validatePortfolioSettingValue(spec, current)
			if err != nil {
				continue
			}
			if stored[group] == nil {
				stored[group] = map[string]any{}
			}
			stored[group][key] = value
		}
	}
	return stored
}

func mergePortfolioSettings(base PortfolioSettings, patch PortfolioSettings) PortfolioSettings {
	merged := PortfolioSettings{}
	for _, source := range []PortfolioSettings{base, patch} {
		for group, values := range source {
			if merged[group] == nil && len(values) > 0 {
				merged[group] = map[string]any{}
			}
			for key, value := range values {
				merged[group][key] = value
			}
		}
	}
	return merged
}

func portfolioSettingsWithDefaults(stored PortfolioSettings) PortfolioSettings {
	result := make(PortfolioSettings, len(portfolioSettingsSchema))
	for group, groupSpec := range portfolioSettingsSchema {
		result[group] = make(map[string]any, len(groupSpec))
		for key, spec := range groupSpec {
			result[group][key] = spec.fallback
			if value, exists := stored[group][key]; exists {
				result[group][key] = value
			}
		}
	}
	return result
}

func sortedAnyKeys(values map[string]any) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
