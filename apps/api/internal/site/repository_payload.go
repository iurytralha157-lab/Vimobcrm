package site

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strings"
)

var (
	googleAnalyticsIDPattern               = regexp.MustCompile(`^(G-[A-Z0-9]{4,32}|UA-[0-9]+-[0-9]+)$`)
	googleTagManagerIDPattern              = regexp.MustCompile(`^GTM-[A-Z0-9]{4,32}$`)
	googleSearchConsoleVerificationPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{10,255}$`)
)

var siteFieldOrder = []string{
	"is_active",
	"maintenance_mode",
	"maintenance_message",
	"subdomain",
	"custom_domain",
	"site_title",
	"site_description",
	"logo_url",
	"footer_logo_url",
	"favicon_url",
	"primary_color",
	"secondary_color",
	"accent_color",
	"whatsapp",
	"phone",
	"email",
	"address",
	"city",
	"state",
	"instagram",
	"facebook",
	"youtube",
	"linkedin",
	"about_title",
	"about_text",
	"about_image_url",
	"seo_title",
	"seo_description",
	"seo_keywords",
	"google_analytics_id",
	"google_search_console_verification",
	"hero_image_url",
	"hero_title",
	"hero_subtitle",
	"page_banner_url",
	"logo_width",
	"logo_height",
	"watermark_enabled",
	"watermark_opacity",
	"watermark_logo_url",
	"watermark_size",
	"watermark_position",
	"site_theme",
	"background_color",
	"text_color",
	"card_color",
	"show_about_on_home",
	"about_subtitle",
	"about_stats",
	"about_checkmarks",
	"about_features",
	"gtm_id",
	"meta_pixel_id",
	"google_ads_id",
	"head_scripts",
	"body_scripts",
}

var siteFieldKinds = map[string]string{
	"is_active":                          "bool",
	"maintenance_mode":                   "bool",
	"maintenance_message":                "text_500",
	"subdomain":                          "slug",
	"custom_domain":                      "domain",
	"site_title":                         "text",
	"site_description":                   "text",
	"logo_url":                           "text",
	"footer_logo_url":                    "text",
	"favicon_url":                        "text",
	"primary_color":                      "text",
	"secondary_color":                    "text",
	"accent_color":                       "text",
	"whatsapp":                           "text",
	"phone":                              "text",
	"email":                              "text",
	"address":                            "text",
	"city":                               "text",
	"state":                              "text",
	"instagram":                          "text",
	"facebook":                           "text",
	"youtube":                            "text",
	"linkedin":                           "text",
	"about_title":                        "text",
	"about_text":                         "text",
	"about_image_url":                    "text",
	"seo_title":                          "text",
	"seo_description":                    "text",
	"seo_keywords":                       "text",
	"google_analytics_id":                "google_analytics_id",
	"google_search_console_verification": "search_console_token",
	"hero_image_url":                     "text",
	"hero_title":                         "text",
	"hero_subtitle":                      "text",
	"page_banner_url":                    "text",
	"logo_width":                         "int",
	"logo_height":                        "int",
	"watermark_enabled":                  "bool",
	"watermark_opacity":                  "int",
	"watermark_logo_url":                 "text",
	"watermark_size":                     "int",
	"watermark_position":                 "text",
	"site_theme":                         "text_required",
	"background_color":                   "text_required",
	"text_color":                         "text_required",
	"card_color":                         "text_required",
	"show_about_on_home":                 "bool",
	"about_subtitle":                     "text",
	"about_stats":                        "json",
	"about_checkmarks":                   "json",
	"about_features":                     "json",
	"gtm_id":                             "google_tag_manager_id",
	"meta_pixel_id":                      "text",
	"google_ads_id":                      "text",
	"head_scripts":                       "text",
	"body_scripts":                       "text",
}

func sanitizeSitePayload(payload map[string]any) (map[string]any, error) {
	out := map[string]any{}
	for _, field := range siteFieldOrder {
		value, ok := payload[field]
		if !ok {
			continue
		}
		cleaned, err := sanitizeFieldValue(siteFieldKinds[field], value)
		if err != nil {
			return nil, err
		}
		out[field] = cleaned
	}
	return out, nil
}

func sanitizeFieldValue(kind string, value any) (any, error) {
	if value == nil {
		return nil, nil
	}

	switch kind {
	case "text":
		text, ok := value.(string)
		if !ok {
			return nil, ErrInvalidInput
		}
		text = strings.TrimSpace(text)
		if text == "" {
			return nil, nil
		}
		return text, nil
	case "text_500":
		text, ok := value.(string)
		if !ok {
			return nil, ErrInvalidInput
		}
		text = strings.TrimSpace(text)
		if text == "" {
			return nil, nil
		}
		if len([]rune(text)) > 500 {
			return nil, ErrInvalidInput
		}
		return text, nil
	case "slug":
		text, ok := value.(string)
		if !ok {
			return nil, ErrInvalidInput
		}
		text = strings.ToLower(strings.TrimSpace(text))
		if text == "" {
			return nil, nil
		}
		if len(text) < 3 || len(text) > 63 || !domainLabelPattern.MatchString(text) {
			return nil, ErrInvalidInput
		}
		return text, nil
	case "domain":
		text, ok := value.(string)
		if !ok {
			return nil, ErrInvalidInput
		}
		text = strings.ToLower(strings.TrimSpace(text))
		if text == "" {
			return nil, nil
		}
		if !isValidPublicDomain(text) {
			return nil, ErrInvalidInput
		}
		return text, nil
	case "search_console_token":
		text, ok := value.(string)
		if !ok {
			return nil, ErrInvalidInput
		}
		text = strings.TrimSpace(text)
		if text == "" {
			return nil, nil
		}
		if !googleSearchConsoleVerificationPattern.MatchString(text) {
			return nil, ErrInvalidInput
		}
		return text, nil
	case "google_analytics_id":
		text, ok := value.(string)
		if !ok {
			return nil, ErrInvalidInput
		}
		text = strings.ToUpper(strings.TrimSpace(text))
		if text == "" {
			return nil, nil
		}
		if !googleAnalyticsIDPattern.MatchString(text) {
			return nil, ErrInvalidInput
		}
		return text, nil
	case "google_tag_manager_id":
		text, ok := value.(string)
		if !ok {
			return nil, ErrInvalidInput
		}
		text = strings.ToUpper(strings.TrimSpace(text))
		if text == "" {
			return nil, nil
		}
		if !googleTagManagerIDPattern.MatchString(text) {
			return nil, ErrInvalidInput
		}
		return text, nil
	case "text_required":
		text, ok := value.(string)
		if !ok {
			return nil, ErrInvalidInput
		}
		text = strings.TrimSpace(text)
		if text == "" {
			return nil, ErrInvalidInput
		}
		return text, nil
	case "bool":
		value, ok := value.(bool)
		if !ok {
			return nil, ErrInvalidInput
		}
		return value, nil
	case "int":
		switch typed := value.(type) {
		case float64:
			if typed < math.MinInt32 || typed > math.MaxInt32 {
				return nil, ErrInvalidInput
			}
			return int(typed), nil
		case int:
			return typed, nil
		default:
			return nil, ErrInvalidInput
		}
	case "json":
		encoded, err := json.Marshal(value)
		if err != nil {
			return nil, ErrInvalidInput
		}
		return string(encoded), nil
	default:
		return nil, ErrInvalidInput
	}
}

func sitePlaceholder(field string, index int) string {
	if siteFieldKinds[field] == "json" {
		return fmt.Sprintf("$%d::jsonb", index)
	}
	if field == "domain_verified_at" {
		return fmt.Sprintf("$%d::timestamptz", index)
	}
	return fmt.Sprintf("$%d", index)
}

func siteSelectSQL() string {
	return "select " + siteReturningColumns()
}

func siteSelectSQLWithoutGoogleSearchConsoleVerification() string {
	return "select " + strings.Replace(
		siteReturningColumns(),
		"\n\t\tgoogle_search_console_verification,",
		"\n\t\tnull::text as google_search_console_verification,",
		1,
	)
}

func siteReturningColumns() string {
	return `
		id::text,
		organization_id::text,
		is_active,
		maintenance_mode,
		maintenance_message,
		subdomain,
		custom_domain,
		domain_verified,
		domain_verified_at::text,
		domain_verification_token::text,
		site_title,
		site_description,
		logo_url,
		footer_logo_url,
		favicon_url,
		primary_color,
		secondary_color,
		accent_color,
		whatsapp,
		phone,
		email,
		address,
		city,
		state,
		instagram,
		facebook,
		youtube,
		linkedin,
		about_title,
		about_text,
		about_image_url,
		seo_title,
		seo_description,
		seo_keywords,
		google_analytics_id,
		google_search_console_verification,
		hero_image_url,
		hero_title,
		hero_subtitle,
		page_banner_url,
		logo_width,
		logo_height,
		watermark_enabled,
		watermark_opacity,
		watermark_logo_url,
		watermark_size,
		watermark_position,
		site_theme,
		background_color,
		text_color,
		card_color,
		show_about_on_home,
		about_subtitle,
		about_stats,
		about_checkmarks,
		about_features,
		gtm_id,
		meta_pixel_id,
		google_ads_id,
		head_scripts,
		body_scripts,
		created_at::text,
		updated_at::text`
}
