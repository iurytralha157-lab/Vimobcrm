package site

import (
	"encoding/json"
	"errors"
)

var (
	ErrInvalidInput         = errors.New("invalid site input")
	ErrSiteNotFound         = errors.New("site not found")
	ErrMenuItemNotFound     = errors.New("site menu item not found")
	ErrSearchFilterNotFound = errors.New("site search filter not found")
	ErrStorageNotConfigured = errors.New("site storage is not configured")
	ErrStorageOperation     = errors.New("site storage operation failed")
)

type Envelope[T any] struct {
	Data T `json:"data"`
}

type OrganizationSite struct {
	ID                string           `json:"id"`
	OrganizationID    string           `json:"organization_id"`
	IsActive          bool             `json:"is_active"`
	Subdomain         *string          `json:"subdomain"`
	CustomDomain      *string          `json:"custom_domain"`
	DomainVerified    bool             `json:"domain_verified"`
	DomainVerifiedAt  *string          `json:"domain_verified_at"`
	SiteTitle         *string          `json:"site_title"`
	SiteDescription   *string          `json:"site_description"`
	LogoURL           *string          `json:"logo_url"`
	FaviconURL        *string          `json:"favicon_url"`
	PrimaryColor      *string          `json:"primary_color"`
	SecondaryColor    *string          `json:"secondary_color"`
	AccentColor       *string          `json:"accent_color"`
	WhatsApp          *string          `json:"whatsapp"`
	Phone             *string          `json:"phone"`
	Email             *string          `json:"email"`
	Address           *string          `json:"address"`
	City              *string          `json:"city"`
	State             *string          `json:"state"`
	Instagram         *string          `json:"instagram"`
	Facebook          *string          `json:"facebook"`
	YouTube           *string          `json:"youtube"`
	LinkedIn          *string          `json:"linkedin"`
	AboutTitle        *string          `json:"about_title"`
	AboutText         *string          `json:"about_text"`
	AboutImageURL     *string          `json:"about_image_url"`
	SEOTitle          *string          `json:"seo_title"`
	SEODescription    *string          `json:"seo_description"`
	SEOKeywords       *string          `json:"seo_keywords"`
	GoogleAnalyticsID *string          `json:"google_analytics_id"`
	HeroImageURL      *string          `json:"hero_image_url"`
	HeroTitle         *string          `json:"hero_title"`
	HeroSubtitle      *string          `json:"hero_subtitle"`
	PageBannerURL     *string          `json:"page_banner_url"`
	LogoWidth         *int             `json:"logo_width"`
	LogoHeight        *int             `json:"logo_height"`
	WatermarkEnabled  *bool            `json:"watermark_enabled"`
	WatermarkOpacity  *int             `json:"watermark_opacity"`
	WatermarkLogoURL  *string          `json:"watermark_logo_url"`
	WatermarkSize     *int             `json:"watermark_size"`
	WatermarkPosition *string          `json:"watermark_position"`
	SiteTheme         string           `json:"site_theme"`
	BackgroundColor   string           `json:"background_color"`
	TextColor         string           `json:"text_color"`
	CardColor         string           `json:"card_color"`
	ShowAboutOnHome   *bool            `json:"show_about_on_home"`
	AboutSubtitle     *string          `json:"about_subtitle"`
	AboutStats        *json.RawMessage `json:"about_stats"`
	AboutCheckmarks   *json.RawMessage `json:"about_checkmarks"`
	AboutFeatures     *json.RawMessage `json:"about_features"`
	GTMID             *string          `json:"gtm_id"`
	MetaPixelID       *string          `json:"meta_pixel_id"`
	GoogleAdsID       *string          `json:"google_ads_id"`
	HeadScripts       *string          `json:"head_scripts"`
	BodyScripts       *string          `json:"body_scripts"`
	CreatedAt         string           `json:"created_at"`
	UpdatedAt         string           `json:"updated_at"`
}

type SiteMenuItem struct {
	ID             string  `json:"id"`
	OrganizationID string  `json:"organization_id"`
	Label          string  `json:"label"`
	LinkType       string  `json:"link_type"`
	Href           string  `json:"href"`
	Position       int     `json:"position"`
	OpenInNewTab   bool    `json:"open_in_new_tab"`
	IsActive       bool    `json:"is_active"`
	CreatedAt      *string `json:"created_at"`
}

type SiteSearchFilter struct {
	ID             string  `json:"id"`
	OrganizationID string  `json:"organization_id"`
	FilterKey      string  `json:"filter_key"`
	Label          string  `json:"label"`
	Position       int     `json:"position"`
	IsActive       bool    `json:"is_active"`
	CreatedAt      *string `json:"created_at"`
}

type MenuItemRequest struct {
	Label        *string `json:"label"`
	LinkType     *string `json:"link_type"`
	Href         *string `json:"href"`
	Position     *int    `json:"position"`
	OpenInNewTab *bool   `json:"open_in_new_tab"`
	IsActive     *bool   `json:"is_active"`
}

type SearchFilterRequest struct {
	FilterKey *string `json:"filter_key"`
	Label     *string `json:"label"`
	Position  *int    `json:"position"`
	IsActive  *bool   `json:"is_active"`
}

type ReorderRequest struct {
	Items []ReorderItem `json:"items"`
}

type ReorderItem struct {
	ID       string `json:"id"`
	Position int    `json:"position"`
}

type AssetUpload struct {
	URL         string `json:"url"`
	Path        string `json:"path"`
	Bucket      string `json:"bucket"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
}

type PublicContactRequest struct {
	OrganizationID string  `json:"organization_id"`
	Name           string  `json:"name"`
	Email          *string `json:"email"`
	Phone          string  `json:"phone"`
	Message        *string `json:"message"`
	PropertyID     *string `json:"property_id"`
	PropertyCode   *string `json:"property_code"`
	SessionID      *string `json:"session_id"`
}

type PublicTrackingRequest struct {
	OrganizationID string         `json:"organization_id"`
	EventType      string         `json:"event_type"`
	PagePath       string         `json:"page_path"`
	PageTitle      *string        `json:"page_title"`
	Referrer       *string        `json:"referrer"`
	SessionID      *string        `json:"session_id"`
	PropertyID     *string        `json:"property_id"`
	DeviceType     *string        `json:"device_type"`
	Browser        *string        `json:"browser"`
	ScreenWidth    *int           `json:"screen_width"`
	ScreenHeight   *int           `json:"screen_height"`
	UTMSource      *string        `json:"utm_source"`
	UTMMedium      *string        `json:"utm_medium"`
	UTMCampaign    *string        `json:"utm_campaign"`
	Metadata       map[string]any `json:"metadata"`
}
