package meta

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"
)

var (
	oauthUUIDPattern         = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	oauthNumericIDPattern    = regexp.MustCompile(`^[0-9]{1,32}$`)
	oauthAppIDPattern        = oauthNumericIDPattern
	oauthGraphVersionPattern = regexp.MustCompile(`^v[0-9]+\.[0-9]+$`)
	oauthNoncePattern        = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
	oauthSafeErrorPattern    = regexp.MustCompile(`^[a-z0-9_]{1,80}$`)
)

func containsOAuthControl(value string, allowTab bool) bool {
	if !utf8.ValidString(value) {
		return true
	}
	for _, character := range value {
		if character == '\t' && allowTab {
			continue
		}
		if character < 0x20 || character == 0x7f {
			return true
		}
	}
	return false
}

func normalizeOAuthOrigin(value string) (string, bool) {
	if strings.Contains(value, `\`) || containsOAuthControl(value, false) {
		return "", false
	}
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil {
		return "", false
	}
	isLocalHTTP := parsed.Scheme == "http" && isOAuthLoopbackHost(parsed.Hostname())
	if parsed.Scheme != "https" && !isLocalHTTP {
		return "", false
	}
	return parsed.Scheme + "://" + parsed.Host, true
}

func isOAuthLoopbackHost(host string) bool {
	host = strings.Trim(strings.ToLower(strings.TrimSpace(host)), "[]")
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

// ParseOAuthAllowedOrigins normalizes APP_PUBLIC_URL plus a comma, semicolon or
// newline separated allowlist. Invalid and insecure origins are ignored.
func ParseOAuthAllowedOrigins(appPublicURL string, configured string) []string {
	candidates := append([]string{appPublicURL}, regexp.MustCompile(`[,;\r\n]+`).Split(configured, -1)...)
	unique := make(map[string]struct{}, len(candidates))
	result := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		origin, ok := normalizeOAuthOrigin(candidate)
		if !ok {
			continue
		}
		if _, exists := unique[origin]; exists {
			continue
		}
		unique[origin] = struct{}{}
		result = append(result, origin)
	}
	return result
}

func validateOAuthReturnURL(value string, allowedOrigins map[string]struct{}) (string, error) {
	if len(value) == 0 || len(value) > 2048 || strings.Contains(value, `\`) || containsOAuthControl(value, false) {
		return "", newOAuthFailure("return_url_not_allowed", http.StatusBadRequest)
	}
	parsed, err := url.Parse(value)
	if err != nil || !parsed.IsAbs() || parsed.User != nil {
		return "", newOAuthFailure("return_url_not_allowed", http.StatusBadRequest)
	}
	origin, ok := normalizeOAuthOrigin(parsed.Scheme + "://" + parsed.Host)
	if !ok {
		return "", newOAuthFailure("return_url_not_allowed", http.StatusBadRequest)
	}
	if _, allowed := allowedOrigins[origin]; !allowed {
		return "", newOAuthFailure("return_url_not_allowed", http.StatusBadRequest)
	}
	return parsed.String(), nil
}

func randomOAuthNonce() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", newOAuthFailure("oauth_random_failed", http.StatusInternalServerError, err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func hashOAuthNonce(nonce string) string {
	digest := sha256.Sum256([]byte(nonce))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

// EncodeOAuthState joins an opaque flow UUID and a cryptographically random
// nonce. Only the SHA-256 hash of the nonce is stored in Postgres.
func EncodeOAuthState(flowID string, nonce string) (string, error) {
	if !oauthUUIDPattern.MatchString(flowID) || !oauthNoncePattern.MatchString(nonce) {
		return "", newOAuthFailure("invalid_oauth_state", http.StatusBadRequest)
	}
	return strings.ToLower(flowID) + "." + nonce, nil
}

func DecodeOAuthState(state string) (flowID string, nonce string, err error) {
	separator := strings.IndexByte(state, '.')
	if separator < 0 || strings.LastIndexByte(state, '.') != separator {
		return "", "", newOAuthFailure("invalid_oauth_state", http.StatusBadRequest)
	}
	flowID = state[:separator]
	nonce = state[separator+1:]
	if !oauthUUIDPattern.MatchString(flowID) || !oauthNoncePattern.MatchString(nonce) {
		return "", "", newOAuthFailure("invalid_oauth_state", http.StatusBadRequest)
	}
	return strings.ToLower(flowID), nonce, nil
}

func NormalizeOAuthAdAccountID(value string) (string, bool) {
	numeric := regexp.MustCompile(`(?i)^act_`).ReplaceAllString(strings.TrimSpace(value), "")
	if !oauthNumericIDPattern.MatchString(numeric) {
		return "", false
	}
	return "act_" + numeric, true
}

func parseOAuthSelectedAccounts(value any, required bool) ([]string, bool, error) {
	if value == nil && !required {
		return nil, false, nil
	}
	items, ok := value.([]any)
	if !ok || len(items) > oauthMaxSelectedAccounts {
		return nil, false, newOAuthFailure("invalid_ad_account_selection", http.StatusBadRequest)
	}
	result := make([]string, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		var raw string
		switch typed := item.(type) {
		case string:
			raw = typed
		case fmt.Stringer:
			raw = typed.String()
		default:
			return nil, false, newOAuthFailure("invalid_ad_account_selection", http.StatusBadRequest)
		}
		normalized, valid := NormalizeOAuthAdAccountID(raw)
		if !valid {
			return nil, false, newOAuthFailure("invalid_ad_account_selection", http.StatusBadRequest)
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		result = append(result, normalized)
	}
	return result, true, nil
}

// BuildOAuthCallbackRedirect removes provider credentials and transient OAuth
// inputs before adding the tokenless completion marker consumed by the UI.
func BuildOAuthCallbackRedirect(returnURL string, status string, flowID string, errorCode string) (string, error) {
	parsed, err := url.Parse(returnURL)
	if err != nil {
		return "", newOAuthFailure("return_url_not_allowed", http.StatusBadRequest, err)
	}
	query := parsed.Query()
	for _, key := range []string{
		"access_token", "user_token", "page_token", "code", "state",
		"meta_oauth_data", "meta_oauth_status", "meta_oauth_flow_id", "meta_oauth_error",
	} {
		query.Del(key)
	}
	query.Set("meta_oauth_status", status)
	query.Set("meta_oauth_flow_id", flowID)
	if status == "error" {
		if !oauthSafeErrorPattern.MatchString(errorCode) {
			errorCode = "meta_oauth_failed"
		}
		query.Set("meta_oauth_error", errorCode)
	}
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

func oauthString(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	default:
		return ""
	}
}

func oauthOptionalString(value any, maximum int, code string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	text, ok := value.(string)
	if !ok {
		return nil, newOAuthFailure(code, http.StatusBadRequest)
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, nil
	}
	if len(text) > maximum || containsOAuthControl(text, true) {
		return nil, newOAuthFailure(code, http.StatusBadRequest)
	}
	return &text, nil
}

func oauthOptionalUUID(value any, code string) (*string, error) {
	text, err := oauthOptionalString(value, 64, code)
	if err != nil || text == nil {
		return text, err
	}
	if !oauthUUIDPattern.MatchString(*text) {
		return nil, newOAuthFailure(code, http.StatusBadRequest)
	}
	normalized := strings.ToLower(*text)
	return &normalized, nil
}

func oauthRequiredUUID(value any, code string) (string, error) {
	parsed, err := oauthOptionalUUID(value, code)
	if err != nil || parsed == nil {
		if err != nil {
			return "", err
		}
		return "", newOAuthFailure(code, http.StatusBadRequest)
	}
	return *parsed, nil
}

func oauthRequiredPageID(value any) (string, error) {
	text := oauthString(value)
	if !oauthNumericIDPattern.MatchString(text) {
		return "", newOAuthFailure("invalid_meta_page_id", http.StatusBadRequest)
	}
	return text, nil
}

func oauthMissingScopes(granted []string, requiredScopes []string) []string {
	missing := make([]string, 0)
	for _, required := range requiredScopes {
		if !slices.Contains(granted, required) {
			missing = append(missing, required)
		}
	}
	return missing
}
