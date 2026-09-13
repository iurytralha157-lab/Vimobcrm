package publicapi

import (
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrInvalidCredentials = errors.New("invalid public API credentials")
	ErrAPIUnavailable     = errors.New("public API module is unavailable")
	ErrBillingRequired    = errors.New("public API billing access is required")
	ErrRateLimited        = errors.New("public API rate limit exceeded")
	ErrInvalidInput       = errors.New("invalid public API input")
)

type Principal struct {
	KeyID          string
	OrganizationID string
}

type LeadRequest struct {
	Name         string            `json:"name"`
	Phone        string            `json:"phone"`
	Email        *string           `json:"email"`
	Message      *string           `json:"message"`
	PropertyID   *string           `json:"property_id"`
	PropertyCode *string           `json:"property_code"`
	SourceDetail *string           `json:"source_detail"`
	CampaignID   *string           `json:"campaign_id"`
	CampaignName *string           `json:"campaign_name"`
	AdsetID      *string           `json:"adset_id"`
	AdsetName    *string           `json:"adset_name"`
	AdID         *string           `json:"ad_id"`
	AdName       *string           `json:"ad_name"`
	FormID       *string           `json:"form_id"`
	FormName     *string           `json:"form_name"`
	UTMSource    *string           `json:"utm_source"`
	UTMMedium    *string           `json:"utm_medium"`
	UTMCampaign  *string           `json:"utm_campaign"`
	UTMContent   *string           `json:"utm_content"`
	UTMTerm      *string           `json:"utm_term"`
	OccurredAt   *time.Time        `json:"occurred_at"`
	CustomFields map[string]string `json:"custom_fields"`
}

type LeadResult struct {
	ID         string `json:"id"`
	Reentry    bool   `json:"reentry"`
	Idempotent bool   `json:"idempotent"`
}

type Envelope[T any] struct {
	Data T `json:"data"`
}

func (request LeadRequest) Payload() (map[string]any, error) {
	name := strings.TrimSpace(request.Name)
	phone := strings.TrimSpace(request.Phone)
	if utf8.RuneCountInString(name) < 2 || utf8.RuneCountInString(name) > 180 {
		return nil, fmt.Errorf("%w: name", ErrInvalidInput)
	}
	if len(phone) > 32 {
		return nil, fmt.Errorf("%w: phone", ErrInvalidInput)
	}
	phoneDigits := digitsOnly(phone)
	if len(phoneDigits) < 10 || len(phoneDigits) > 15 {
		return nil, fmt.Errorf("%w: phone", ErrInvalidInput)
	}

	payload := map[string]any{
		"name":  name,
		"phone": phone,
	}
	optional := []struct {
		key       string
		value     *string
		maxLength int
	}{
		{"email", request.Email, 320},
		{"message", request.Message, 10_000},
		{"property_id", request.PropertyID, 36},
		{"property_code", request.PropertyCode, 120},
		{"source_detail", request.SourceDetail, 240},
		{"campaign_id", request.CampaignID, 240},
		{"campaign_name", request.CampaignName, 500},
		{"adset_id", request.AdsetID, 240},
		{"adset_name", request.AdsetName, 500},
		{"ad_id", request.AdID, 240},
		{"ad_name", request.AdName, 500},
		{"form_id", request.FormID, 240},
		{"form_name", request.FormName, 500},
		{"utm_source", request.UTMSource, 500},
		{"utm_medium", request.UTMMedium, 500},
		{"utm_campaign", request.UTMCampaign, 500},
		{"utm_content", request.UTMContent, 500},
		{"utm_term", request.UTMTerm, 500},
	}
	for _, field := range optional {
		if field.value == nil {
			continue
		}
		value := strings.TrimSpace(*field.value)
		if value == "" {
			continue
		}
		if utf8.RuneCountInString(value) > field.maxLength {
			return nil, fmt.Errorf("%w: %s", ErrInvalidInput, field.key)
		}
		payload[field.key] = value
	}

	if email, ok := payload["email"].(string); ok {
		address, err := mail.ParseAddress(email)
		if err != nil || !strings.EqualFold(address.Address, email) {
			return nil, fmt.Errorf("%w: email", ErrInvalidInput)
		}
	}
	if propertyID, ok := payload["property_id"].(string); ok && !isUUID(propertyID) {
		return nil, fmt.Errorf("%w: property_id", ErrInvalidInput)
	}
	if request.OccurredAt != nil {
		payload["occurred_at"] = request.OccurredAt.UTC().Format(time.RFC3339Nano)
	}
	if len(request.CustomFields) > 50 {
		return nil, fmt.Errorf("%w: custom_fields", ErrInvalidInput)
	}
	if len(request.CustomFields) > 0 {
		customFields := make(map[string]string, len(request.CustomFields))
		for key, rawValue := range request.CustomFields {
			key = strings.TrimSpace(key)
			value := strings.TrimSpace(rawValue)
			if key == "" || utf8.RuneCountInString(key) > 120 || utf8.RuneCountInString(value) > 1_000 {
				return nil, fmt.Errorf("%w: custom_fields", ErrInvalidInput)
			}
			customFields[key] = value
		}
		payload["custom_fields"] = customFields
	}
	return payload, nil
}

func digitsOnly(value string) string {
	var builder strings.Builder
	for _, character := range value {
		if character >= '0' && character <= '9' {
			builder.WriteRune(character)
		}
	}
	return builder.String()
}

func isUUID(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) != 36 {
		return false
	}
	for index, character := range value {
		switch index {
		case 8, 13, 18, 23:
			if character != '-' {
				return false
			}
		default:
			if !((character >= '0' && character <= '9') ||
				(character >= 'a' && character <= 'f') ||
				(character >= 'A' && character <= 'F')) {
				return false
			}
		}
	}
	return true
}
