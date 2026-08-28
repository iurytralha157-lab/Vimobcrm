package meta

import (
	"errors"
	"net/http"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	oauthDefaultGraphVersion = "v25.0"
	oauthDefaultGraphURL     = "https://graph.facebook.com"
	oauthDefaultFacebookURL  = "https://www.facebook.com"

	oauthMaxRequestBodyBytes   = int64(32 * 1024)
	oauthMaxGraphResponseBytes = int64(2 * 1024 * 1024)
	oauthMaxGraphPages         = 10
	oauthMaxGraphItems         = 250
	oauthMaxSelectedAccounts   = 25
)

var oauthLegacyLoginScopes = []string{
	"public_profile",
	"pages_show_list",
	"pages_read_engagement",
	"pages_read_user_content",
	"pages_manage_metadata",
	"pages_messaging",
	"leads_retrieval",
	"read_insights",
	"ads_read",
	"business_management",
	"instagram_basic",
	"instagram_manage_insights",
	"instagram_manage_messages",
}

var oauthBusinessLoginScopes = []string{
	"public_profile",
	"leads_retrieval",
	"pages_manage_ads",
	"pages_manage_metadata",
	"pages_show_list",
	"pages_read_engagement",
	"ads_read",
	"instagram_basic",
	"instagram_manage_insights",
	"instagram_manage_messages",
	"pages_messaging",
}

// OAuthConfig contains every server-side setting required by the native Meta
// OAuth flow. CallbackURL must be the public GET route handled by
// OAuthHandler.Callback. AllowedOrigins is also the allowlist for return URLs.
// Provider credentials must never be copied into browser-visible settings.
type OAuthConfig struct {
	AppID           string
	AppSecret       string
	LoginConfigID   string
	GraphVersion    string
	CallbackURL     string
	AllowedOrigins  []string
	GraphBaseURL    string
	FacebookBaseURL string

	RequestTimeout  time.Duration
	ActionTimeout   time.Duration
	CallbackTimeout time.Duration
	FlowTTL         time.Duration

	HTTPClient *http.Client
}

// OAuthScopes returns a defensive copy of the legacy OAuth scope profile. It
// remains stable for callers and existing integrations that do not use a
// Facebook Login for Business configuration.
func OAuthScopes() []string {
	return append([]string(nil), oauthLegacyLoginScopes...)
}

// OAuthBusinessLoginScopes returns the reviewed scope profile associated with
// META_LOGIN_CONFIG_ID. It intentionally excludes legacy-only permissions.
func OAuthBusinessLoginScopes() []string {
	return append([]string(nil), oauthBusinessLoginScopes...)
}

// OAuthFailure is intentionally code-only. Provider responses and credentials
// must never become client-visible errors.
type OAuthFailure struct {
	Code   string
	Status int
	Cause  error
}

func (failure *OAuthFailure) Error() string {
	if failure == nil || failure.Code == "" {
		return "meta_oauth_failed"
	}
	return failure.Code
}

func (failure *OAuthFailure) Unwrap() error {
	if failure == nil {
		return nil
	}
	return failure.Cause
}

func newOAuthFailure(code string, status int, cause ...error) *OAuthFailure {
	failure := &OAuthFailure{Code: code, Status: status}
	if len(cause) > 0 {
		failure.Cause = cause[0]
	}
	return failure
}

func oauthErrorCode(err error) string {
	var failure *OAuthFailure
	if errors.As(err, &failure) && oauthSafeErrorPattern.MatchString(failure.Code) {
		return failure.Code
	}
	return "meta_oauth_failed"
}

func oauthErrorStatus(err error) int {
	var failure *OAuthFailure
	if errors.As(err, &failure) && failure.Status >= 400 && failure.Status <= 599 {
		return failure.Status
	}
	return http.StatusInternalServerError
}

type oauthAuthContext struct {
	OrganizationID string
	UserID         string
}

func oauthAuthFromTenant(context tenant.Context) (oauthAuthContext, error) {
	if context.OrganizationID == "" || context.UserID == "" {
		return oauthAuthContext{}, newOAuthFailure("organization_required", http.StatusForbidden)
	}
	if !context.IsSuperAdmin && !context.HasRole("owner", "admin") {
		return oauthAuthContext{}, newOAuthFailure("organization_admin_required", http.StatusForbidden)
	}
	return oauthAuthContext{
		OrganizationID: context.OrganizationID,
		UserID:         context.UserID,
	}, nil
}

type oauthPage struct {
	ID                         string  `json:"id"`
	Name                       string  `json:"name"`
	AccessToken                string  `json:"-"`
	PictureURL                 *string `json:"-"`
	InstagramBusinessAccountID *string `json:"-"`
	InstagramUsername          *string `json:"-"`
}

type oauthAdAccount struct {
	ID            string  `json:"id"`
	AccountID     string  `json:"account_id"`
	Name          *string `json:"name"`
	AccountStatus *int    `json:"account_status"`
	Currency      *string `json:"currency"`
	TimezoneName  *string `json:"timezone_name"`
}

type oauthIdentity struct {
	ID   string
	Name *string
}

type oauthTokenDebug struct {
	UserID    string
	ExpiresAt *time.Time
	Scopes    []string
}

type oauthFlow struct {
	ID             string
	OrganizationID string
	UserID         string
	NonceHash      string
	ReturnURL      string
	Status         string
	ExpiresAt      time.Time
	ConsumedAt     *time.Time
}

type oauthFlowPayload struct {
	Success          bool             `json:"success"`
	UserToken        string           `json:"-"`
	TokenExpiresAt   *time.Time       `json:"token_expires_at,omitempty"`
	GrantedScopes    []string         `json:"granted_scopes"`
	FacebookUserID   string           `json:"facebook_user_id"`
	FacebookUserName *string          `json:"facebook_user_name,omitempty"`
	Pages            []map[string]any `json:"pages"`
	AdAccounts       []oauthAdAccount `json:"ad_accounts"`
	AdAccountID      *string          `json:"ad_account_id,omitempty"`
}

type oauthIntegration struct {
	ID                 string
	OrganizationID     string
	PageID             string
	PageName           *string
	Connected          bool
	SelectedAdAccounts []string
	AdAccountID        *string
	PageToken          string
	UserToken          string
}

type oauthConnectionOptions struct {
	PipelineID    *string
	StageID       *string
	DefaultStatus string
}
