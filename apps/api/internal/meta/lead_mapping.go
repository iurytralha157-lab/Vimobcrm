package meta

import (
	"slices"
	"strings"
)

func mapLeadData(details map[string]any, change leadgenChange, integration metaIntegration, formConfig metaFormConfig) leadData {
	fields := extractFieldData(details)
	if len(fields) == 0 {
		fields = extractFieldData(change.Raw)
	}

	lead := leadData{
		Name:      "Lead Meta",
		Custom:    map[string]any{},
		RawFields: map[string]any{},
		Meta: map[string]any{
			"leadgen_id":             change.LeadgenID,
			"form_id":                change.FormID,
			"page_id":                change.PageID,
			"campaign_id":            metaText(details, change.Raw, "campaign_id"),
			"campaign_name":          metaText(details, change.Raw, "campaign_name"),
			"adset_id":               metaText(details, change.Raw, "adset_id"),
			"adset_name":             metaText(details, change.Raw, "adset_name"),
			"ad_id":                  metaText(details, change.Raw, "ad_id"),
			"ad_name":                metaText(details, change.Raw, "ad_name"),
			"creative_id":            metaText(details, change.Raw, "creative_id"),
			"creative_name":          metaText(details, change.Raw, "creative_name"),
			"creative_type":          metaText(details, change.Raw, "creative_type"),
			"creative_url":           metaText(details, change.Raw, "creative_url"),
			"creative_video_url":     metaText(details, change.Raw, "creative_video_url"),
			"creative_instagram_url": metaText(details, change.Raw, "creative_instagram_url"),
			"creative_permalink_url": metaText(details, change.Raw, "creative_permalink_url"),
		},
	}

	mapping := map[string]string{}
	for key, value := range integration.FieldMapping {
		mapping[strings.ToLower(strings.TrimSpace(key))] = strings.ToLower(strings.TrimSpace(value))
	}
	for key, value := range formConfig.FieldMapping {
		mapping[strings.ToLower(strings.TrimSpace(key))] = strings.ToLower(strings.TrimSpace(value))
	}

	customFields := map[string]struct{}{}
	for _, field := range formConfig.CustomFieldsConfig {
		customFields[strings.ToLower(strings.TrimSpace(field))] = struct{}{}
	}

	for _, field := range fields {
		if len(field.Values) == 0 {
			continue
		}
		value := strings.TrimSpace(field.Values[0])
		if value == "" {
			continue
		}
		key := strings.TrimSpace(field.Name)
		lowerKey := strings.ToLower(key)
		lead.RawFields[key] = field.Values

		target, explicitlyMapped := mapping[lowerKey]
		if !explicitlyMapped {
			target = guessLeadTarget(lowerKey)
		}
		if _, isCustom := customFields[lowerKey]; isCustom && !explicitlyMapped && target == "" {
			target = "custom"
		}
		if explicitlyMapped && target == "" {
			target = "_ignore"
		}

		switch target {
		case "_ignore":
			continue
		case "name":
			lead.Name = value
			lead.NameFromProvider = true
		case "email":
			lead.Email = &value
		case "phone":
			if canonical, err := canonicalizeMetaPhoneContact(value); err == nil && canonical != "" {
				lead.Phone = &canonical
			}
		case "message":
			lead.Message = &value
		case "cargo":
			lead.Cargo = &value
		case "empresa":
			lead.Empresa = &value
		case "cidade":
			lead.Cidade = &value
		case "bairro":
			lead.Bairro = &value
		case "custom":
			lead.Custom[key] = value
		default:
			if target == "" {
				lead.Custom[key] = value
			}
		}
	}

	if name := cleanAnyString(formConfig.DefaultValues["name"]); name != nil && lead.Name == "Lead Meta" {
		lead.Name = *name
	}
	return lead
}

type metaLeadIntakeDisposition uint8

const (
	metaLeadIntakeReady metaLeadIntakeDisposition = iota
	metaLeadIntakeIgnoreTest
	metaLeadIntakeWaitForIdentity
)

func classifyMetaLeadIntake(details map[string]any, raw map[string]any, lead leadData) metaLeadIntakeDisposition {
	detailFields := extractFieldData(details)
	rawFields := extractFieldData(raw)
	if isMetaTestLead(detailFields) || isMetaTestLead(rawFields) {
		return metaLeadIntakeIgnoreTest
	}
	if len(detailFields) == 0 && len(rawFields) == 0 {
		return metaLeadIntakeWaitForIdentity
	}
	if !hasProviderMappedLeadName(lead) {
		return metaLeadIntakeWaitForIdentity
	}
	return metaLeadIntakeReady
}

func isMetaTestLead(fields []fieldData) bool {
	for _, field := range fields {
		for _, value := range field.Values {
			normalized := strings.ToLower(strings.TrimSpace(value))
			if strings.HasPrefix(normalized, "<test lead: dummy data") ||
				strings.HasPrefix(normalized, "test lead: dummy data") {
				return true
			}
		}
	}
	return false
}

func hasProviderMappedLeadName(lead leadData) bool {
	return lead.NameFromProvider && strings.TrimSpace(lead.Name) != ""
}

func setMetaLeadDetailsState(metadata map[string]any, detailsError string) {
	if metadata == nil {
		return
	}
	detailsError = strings.TrimSpace(detailsError)
	if detailsError == "" {
		metadata["meta_details_status"] = "complete"
		delete(metadata, "meta_details_error")
		return
	}
	metadata["meta_details_status"] = "pending"
	metadata["meta_details_error"] = truncateMetaLeadText(detailsError, 1000)
}

func truncateMetaLeadText(value string, maximum int) string {
	value = strings.TrimSpace(value)
	if maximum <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= maximum {
		return value
	}
	return string(runes[:maximum])
}

func extractFieldData(payload map[string]any) []fieldData {
	raw := payload["field_data"]
	if raw == nil {
		if nested, ok := payload["lead_data"].(map[string]any); ok {
			raw = nested["field_data"]
		}
	}

	items, ok := raw.([]any)
	if !ok {
		return nil
	}

	out := []fieldData{}
	for _, itemValue := range items {
		item, ok := itemValue.(map[string]any)
		if !ok {
			continue
		}
		field := fieldData{Name: textFromAny(item["name"])}
		switch values := item["values"].(type) {
		case []any:
			for _, value := range values {
				if text := textFromAny(value); text != "" {
					field.Values = append(field.Values, text)
				}
			}
		case []string:
			field.Values = append(field.Values, values...)
		case string:
			if strings.TrimSpace(values) != "" {
				field.Values = append(field.Values, strings.TrimSpace(values))
			}
		}
		if len(field.Values) > 0 {
			out = append(out, field)
		}
	}
	return out
}

func buildLeadMetadata(webhookPayload map[string]any, details map[string]any, change leadgenChange, integration metaIntegration, formConfig metaFormConfig, lead leadData) map[string]any {
	return map[string]any{
		"source":                   "meta",
		"source_type":              "meta_lead_ads",
		"integration_id":           integration.ID,
		"form_config_id":           formConfig.ID,
		"page_id":                  change.PageID,
		"page_name":                nullablePointer(integration.PageName),
		"form_id":                  change.FormID,
		"form_name":                nullablePointer(formConfig.FormName),
		"leadgen_id":               change.LeadgenID,
		"created_time":             change.CreatedTime,
		"campaign_id":              metaText(details, change.Raw, "campaign_id"),
		"campaign_name":            metaText(details, change.Raw, "campaign_name"),
		"adset_id":                 metaText(details, change.Raw, "adset_id"),
		"adset_name":               metaText(details, change.Raw, "adset_name"),
		"ad_id":                    metaText(details, change.Raw, "ad_id"),
		"ad_name":                  metaText(details, change.Raw, "ad_name"),
		"creative_id":              metaText(details, change.Raw, "creative_id"),
		"creative_name":            metaText(details, change.Raw, "creative_name"),
		"creative_type":            metaText(details, change.Raw, "creative_type"),
		"creative_url":             metaText(details, change.Raw, "creative_url"),
		"creative_video_url":       metaText(details, change.Raw, "creative_video_url"),
		"creative_thumbnail_url":   metaText(details, change.Raw, "creative_thumbnail_url"),
		"creative_instagram_url":   metaText(details, change.Raw, "creative_instagram_url"),
		"creative_permalink_url":   metaText(details, change.Raw, "creative_permalink_url"),
		"creative_destination_url": metaText(details, change.Raw, "creative_destination_url"),
		"field_data":               lead.RawFields,
		"custom_fields":            lead.Custom,
		"webhook_payload":          webhookPayload,
	}
}

func sourceDetail(integration metaIntegration, formConfig metaFormConfig) string {
	for _, value := range []*string{
		formConfig.SourceDetails,
		formConfig.FormName,
		integration.PageName,
	} {
		if value != nil && strings.TrimSpace(*value) != "" {
			return strings.TrimSpace(*value)
		}
	}
	return "Meta Lead Ads"
}

func resolvePropertyID(formConfig metaFormConfig) *string {
	for _, value := range []*string{
		formConfig.PropertyID,
		uuidPointer(formConfig.DefaultValues["property_id"]),
		uuidPointer(formConfig.DefaultValues["interest_property_id"]),
	} {
		if value != nil {
			return value
		}
	}
	return nil
}

func interestValue(defaults map[string]any) *string {
	for _, key := range []string{"valor_interesse", "interest_value", "valor", "value"} {
		value := textFromAny(defaults[key])
		if value != "" {
			return &value
		}
	}
	return nil
}

func tagIDs(formConfig metaFormConfig) []string {
	ids := []string{}
	for _, tagID := range formConfig.AutoTags {
		if !slices.Contains(ids, tagID) {
			ids = append(ids, tagID)
		}
	}
	for _, tagID := range stringSlice(formConfig.DefaultValues["auto_tags"]) {
		if !slices.Contains(ids, tagID) {
			ids = append(ids, tagID)
		}
	}
	return ids
}

func metaText(primary map[string]any, fallback map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := textFromAny(primary[key]); value != "" {
			return value
		}
		if value := textFromAny(fallback[key]); value != "" {
			return value
		}
	}
	return ""
}

func hasFieldData(payload map[string]any) bool {
	// A present but empty field_data is not an identity snapshot. Fetch Graph
	// details instead of retrying the same empty webhook payload indefinitely.
	return len(extractFieldData(payload)) > 0
}

func guessLeadTarget(key string) string {
	switch {
	case strings.Contains(key, "nome") || strings.Contains(key, "name"):
		return "name"
	case strings.Contains(key, "email") || strings.Contains(key, "e-mail"):
		return "email"
	case strings.Contains(key, "phone") || strings.Contains(key, "fone") || strings.Contains(key, "telefone") || strings.Contains(key, "whatsapp"):
		return "phone"
	case strings.Contains(key, "mensagem") || strings.Contains(key, "message") || strings.Contains(key, "observ"):
		return "message"
	case strings.Contains(key, "cargo"):
		return "cargo"
	case strings.Contains(key, "empresa") || strings.Contains(key, "company"):
		return "empresa"
	case strings.Contains(key, "cidade") || strings.Contains(key, "city"):
		return "cidade"
	case strings.Contains(key, "bairro") || strings.Contains(key, "neighborhood"):
		return "bairro"
	default:
		return ""
	}
}
