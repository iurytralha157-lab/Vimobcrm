// Package marketing owns the read-only logins used to pull marketing data.
//
// It is isolated from the lead intake on purpose: it never reads or writes
// public.meta_integrations, never changes a Page webhook subscription and
// never revokes app permissions. contract_test.go enforces these rules.
package marketing

import (
	"errors"
	"net/http"
	"strings"
	"time"
)

const (
	ProviderMeta = "meta"

	AssetAdAccount = "ad_account"
	AssetPage      = "page"
	AssetInstagram = "instagram_account"

	flowLifetime = 10 * time.Minute
)

// metaLoginScopes is everything the Marketing login may ask for. It excludes
// every permission that the lead intake depends on or that can change data.
var metaLoginScopes = []string{
	"ads_read",
	"pages_show_list",
	"pages_read_engagement",
	"read_insights",
	"instagram_basic",
	"instagram_manage_insights",
}

// Config is independent from META_APP_ID on purpose. An environment can enable
// Marketing without enabling the lead OAuth flow, as homologation does.
type Config struct {
	EnabledOrganizations []string
	AllowedOrigins       []string
	Meta                 MetaConfig
}

type MetaConfig struct {
	AppID         string
	AppSecret     string
	LoginConfigID string
	GraphVersion  string
	GraphBaseURL  string
	DialogBaseURL string
	CallbackURL   string
}

func (config Config) organizationEnabled(organizationID string) bool {
	for _, item := range config.EnabledOrganizations {
		item = strings.TrimSpace(item)
		if item == "*" || (item != "" && strings.EqualFold(item, organizationID)) {
			return true
		}
	}
	return false
}

func (config MetaConfig) configured() bool {
	return strings.TrimSpace(config.AppID) != "" &&
		strings.TrimSpace(config.AppSecret) != "" &&
		strings.TrimSpace(config.CallbackURL) != ""
}

type Asset struct {
	ID         string         `json:"id"`
	Type       string         `json:"type"`
	ExternalID string         `json:"external_id"`
	Name       string         `json:"name"`
	Metadata   map[string]any `json:"metadata"`
	IsSelected bool           `json:"is_selected"`
}

// Connection is the only shape that leaves the API. It has no token field.
type Connection struct {
	ID               string     `json:"id"`
	Provider         string     `json:"provider"`
	ExternalUserName string     `json:"external_user_name"`
	Status           string     `json:"status"`
	GrantedScopes    []string   `json:"granted_scopes"`
	MissingScopes    []string   `json:"missing_scopes"`
	TokenExpiresAt   *time.Time `json:"token_expires_at"`
	LastValidatedAt  *time.Time `json:"last_validated_at"`
	LastError        string     `json:"last_error"`
	CreatedAt        time.Time  `json:"created_at"`
	Assets           []Asset    `json:"assets"`
}

type Flow struct {
	ID             string
	OrganizationID string
	UserID         string
	Provider       string
	NonceHash      string
	ReturnURL      string
	ExpiresAt      time.Time
}

type DiscoveredAsset struct {
	Type       string
	ExternalID string
	Name       string
	Metadata   map[string]any
}

type SaveConnectionInput struct {
	OrganizationID   string
	UserID           string
	Provider         string
	ExternalUserID   string
	ExternalUserName string
	GrantedScopes    []string
	AccessToken      string
	TokenExpiresAt   *time.Time
	Assets           []DiscoveredAsset
}

type Failure struct {
	Code   string
	Status int
	cause  error
}

func (failure *Failure) Error() string {
	if failure.cause != nil {
		return failure.Code + ": " + failure.cause.Error()
	}
	return failure.Code
}

func (failure *Failure) Unwrap() error { return failure.cause }

func newFailure(code string, status int, cause ...error) *Failure {
	failure := &Failure{Code: code, Status: status}
	if len(cause) > 0 {
		failure.cause = cause[0]
	}
	return failure
}

func failureOf(err error) *Failure {
	var failure *Failure
	if errors.As(err, &failure) {
		return failure
	}
	return newFailure("marketing_connection_failed", http.StatusInternalServerError, err)
}
