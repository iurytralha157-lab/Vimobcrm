package meta

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

var oauthActionKeys = map[string]map[string]struct{}{
	"get_auth_url": oauthKeySet(
		"action", "organization_id", "organizationId", "return_url", "include_instagram",
	),
	"connect_page": oauthKeySet(
		"action", "organization_id", "organizationId", "flow_id", "page_id",
		"pipeline_id", "stage_id", "default_status", "ad_account_id",
		"selected_ad_accounts",
	),
	"update_page": oauthKeySet(
		"action", "organization_id", "organizationId", "page_id", "pipeline_id",
		"stage_id", "default_status", "selected_ad_accounts",
	),
	"disconnect_page": oauthKeySet(
		"action", "organization_id", "organizationId", "page_id",
	),
	"toggle_page": oauthKeySet(
		"action", "organization_id", "organizationId", "page_id", "is_active",
	),
	"update_ad_accounts": oauthKeySet(
		"action", "organization_id", "organizationId", "page_id", "selected_ad_accounts",
	),
	"list_ad_accounts": oauthKeySet(
		"action", "organization_id", "organizationId", "page_id",
	),
}

// OAuthHandler owns the native backend flow. Action is mounted behind the
// authenticated tenant/permission middleware; Callback is a public GET route
// registered in the Meta application. ServeHTTP is available when both methods
// share one path.
type OAuthHandler struct {
	service         *oauthService
	allowedOrigins  map[string]struct{}
	actionTimeout   time.Duration
	callbackTimeout time.Duration
}

func NewOAuthHandler(database *dbpkg.Postgres, config OAuthConfig) (*OAuthHandler, error) {
	if database == nil {
		return nil, newOAuthFailure("meta_oauth_not_configured", http.StatusServiceUnavailable)
	}
	graph, err := newOAuthGraphClient(config)
	if err != nil {
		return nil, err
	}
	service, err := newOAuthService(oauthPostgresStore{db: database}, graph, config)
	if err != nil {
		return nil, err
	}
	actionTimeout := config.ActionTimeout
	if actionTimeout <= 0 || actionTimeout > 60*time.Second {
		actionTimeout = 45 * time.Second
	}
	callbackTimeout := config.CallbackTimeout
	if callbackTimeout <= 0 || callbackTimeout > 60*time.Second {
		callbackTimeout = 55 * time.Second
	}
	return &OAuthHandler{
		service:         service,
		allowedOrigins:  service.allowedOrigins,
		actionTimeout:   actionTimeout,
		callbackTimeout: callbackTimeout,
	}, nil
}

func (handler *OAuthHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		handler.Callback(w, r)
	case http.MethodPost:
		handler.Action(w, r)
	case http.MethodOptions:
		handler.Preflight(w, r)
	default:
		w.Header().Set("Allow", "GET, POST, OPTIONS")
		handler.writeError(w, r, newOAuthFailure("method_not_allowed", http.StatusMethodNotAllowed))
	}
}

// Action handles authenticated configuration operations. The method performs
// its own admin and organization checks as defense in depth even when the app
// route is protected by IntegrationsManage.
func (handler *OAuthHandler) Action(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		handler.writeError(w, r, newOAuthFailure("method_not_allowed", http.StatusMethodNotAllowed))
		return
	}
	if !handler.originAllowed(r.Header.Get("Origin")) {
		handler.writeError(w, r, newOAuthFailure("origin_not_allowed", http.StatusForbidden))
		return
	}
	// Meta can legitimately take longer than the API's short global write
	// timeout. Extend only this bounded route; the action context below remains
	// the authoritative 45s maximum.
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(handler.actionTimeout + 10*time.Second))
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok {
		handler.writeError(w, r, newOAuthFailure("authentication_required", http.StatusUnauthorized))
		return
	}
	auth, err := oauthAuthFromTenant(tenantContext)
	if err != nil {
		handler.writeError(w, r, err)
		return
	}
	body, err := parseOAuthActionBody(w, r)
	if err != nil {
		handler.writeError(w, r, err)
		return
	}
	action, err := validateOAuthAction(body)
	if err != nil {
		handler.writeError(w, r, err)
		return
	}
	if err := validateOAuthActionOrganization(body, auth.OrganizationID); err != nil {
		handler.writeError(w, r, err)
		return
	}
	if action == "get_auth_url" {
		if include, present := body["include_instagram"]; present {
			if _, ok := include.(bool); !ok {
				handler.writeError(w, r, newOAuthFailure("invalid_include_instagram", http.StatusBadRequest))
				return
			}
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), handler.actionTimeout)
	defer cancel()
	var result map[string]any
	switch action {
	case "get_auth_url":
		result, err = handler.service.createAuthURL(ctx, auth, body)
	case "connect_page":
		result, err = handler.service.connectPage(ctx, auth, body)
	case "update_page":
		result, err = handler.service.updatePage(ctx, auth, body)
	case "disconnect_page":
		result, err = handler.service.disconnectPage(ctx, auth, body)
	case "toggle_page":
		result, err = handler.service.togglePage(ctx, auth, body)
	case "update_ad_accounts":
		result, err = handler.service.updateAdAccounts(ctx, auth, body)
	case "list_ad_accounts":
		result, err = handler.service.listAdAccounts(ctx, auth, body)
	}
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			err = newOAuthFailure("meta_request_timeout", http.StatusGatewayTimeout)
		}
		handler.writeError(w, r, err)
		return
	}
	handler.writeJSON(w, r, http.StatusOK, result)
}

// Callback completes the public Meta redirect. It never emits provider tokens,
// authorization codes or state in the Location header.
func (handler *OAuthHandler) Callback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		handler.writeError(w, r, newOAuthFailure("method_not_allowed", http.StatusMethodNotAllowed))
		return
	}
	// Preserve the browser redirect even when Meta needs most of the callback
	// budget. This does not extend provider or database contexts.
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(handler.callbackTimeout + 10*time.Second))
	ctx, cancel := context.WithTimeout(r.Context(), handler.callbackTimeout)
	defer cancel()
	query := r.URL.Query()
	result, err := handler.service.completeCallback(
		ctx,
		query.Get("state"),
		query.Get("code"),
		query.Get("error"),
	)
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		err = newOAuthFailure("meta_request_timeout", http.StatusGatewayTimeout)
	}
	if result.ReturnURL != "" && result.FlowID != "" {
		status := "success"
		errorCode := ""
		if err != nil || result.Status == "error" {
			status = "error"
			errorCode = result.Error
			if errorCode == "" {
				errorCode = oauthErrorCode(err)
			}
		}
		location, redirectErr := BuildOAuthCallbackRedirect(result.ReturnURL, status, result.FlowID, errorCode)
		if redirectErr == nil {
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Referrer-Policy", "no-referrer")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("Location", location)
			w.WriteHeader(http.StatusFound)
			return
		}
		err = redirectErr
	}
	if err == nil {
		err = newOAuthFailure("meta_oauth_failed", http.StatusInternalServerError)
	}
	handler.writeError(w, r, err)
}

func (handler *OAuthHandler) Preflight(w http.ResponseWriter, r *http.Request) {
	if !handler.originAllowed(r.Header.Get("Origin")) {
		handler.writeError(w, r, newOAuthFailure("origin_not_allowed", http.StatusForbidden))
		return
	}
	if method := strings.ToUpper(strings.TrimSpace(r.Header.Get("Access-Control-Request-Method"))); method != "" && method != http.MethodPost {
		handler.writeError(w, r, newOAuthFailure("method_not_allowed", http.StatusMethodNotAllowed))
		return
	}
	allowedHeaders := map[string]struct{}{
		"authorization":     {},
		"content-type":      {},
		"x-client-info":     {},
		"x-organization-id": {},
		"x-request-id":      {},
	}
	for _, requested := range strings.Split(r.Header.Get("Access-Control-Request-Headers"), ",") {
		requested = strings.ToLower(strings.TrimSpace(requested))
		if requested == "" {
			continue
		}
		if _, ok := allowedHeaders[requested]; !ok {
			handler.writeError(w, r, newOAuthFailure("cors_header_not_allowed", http.StatusForbidden))
			return
		}
	}
	handler.responseHeaders(w, r)
	w.Header().Del("Content-Type")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "authorization, content-type, x-client-info, x-organization-id, x-request-id")
	w.Header().Set("Access-Control-Max-Age", "600")
	w.WriteHeader(http.StatusNoContent)
}

func parseOAuthActionBody(w http.ResponseWriter, r *http.Request) (map[string]any, error) {
	defer r.Body.Close()
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, oauthMaxRequestBodyBytes))
	decoder.UseNumber()
	var body map[string]any
	if err := decoder.Decode(&body); err != nil {
		var maximum *http.MaxBytesError
		if errors.As(err, &maximum) {
			return nil, newOAuthFailure("request_body_too_large", http.StatusRequestEntityTooLarge)
		}
		return nil, newOAuthFailure("invalid_json", http.StatusBadRequest)
	}
	if body == nil {
		return nil, newOAuthFailure("invalid_json", http.StatusBadRequest)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, newOAuthFailure("invalid_json", http.StatusBadRequest)
	}
	return body, nil
}

func validateOAuthAction(body map[string]any) (string, error) {
	action := oauthString(body["action"])
	allowed, ok := oauthActionKeys[action]
	if !ok {
		return "", newOAuthFailure("unknown_meta_oauth_action", http.StatusBadRequest)
	}
	for key := range body {
		if _, ok := allowed[key]; !ok {
			return "", newOAuthFailure("unknown_meta_oauth_input", http.StatusBadRequest)
		}
	}
	for _, credential := range []string{"code", "access_token", "accessToken", "user_token", "userToken", "page_token"} {
		if _, present := body[credential]; present {
			return "", newOAuthFailure("unknown_meta_oauth_input", http.StatusBadRequest)
		}
	}
	return action, nil
}

func validateOAuthActionOrganization(body map[string]any, tenantOrganizationID string) error {
	snake := oauthString(body["organization_id"])
	camel := oauthString(body["organizationId"])
	if snake != "" && camel != "" && !strings.EqualFold(snake, camel) {
		return newOAuthFailure("organization_mismatch", http.StatusBadRequest)
	}
	provided := snake
	if provided == "" {
		provided = camel
	}
	if provided == "" {
		return nil
	}
	normalized, err := oauthRequiredUUID(provided, "invalid_organization_id")
	if err != nil {
		return err
	}
	if !strings.EqualFold(normalized, tenantOrganizationID) {
		return newOAuthFailure("organization_mismatch", http.StatusForbidden)
	}
	return nil
}

func (handler *OAuthHandler) originAllowed(value string) bool {
	if strings.TrimSpace(value) == "" {
		return true
	}
	origin, ok := normalizeOAuthOrigin(value)
	if !ok {
		return false
	}
	_, ok = handler.allowedOrigins[origin]
	return ok
}

func (handler *OAuthHandler) responseHeaders(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	origin, ok := normalizeOAuthOrigin(r.Header.Get("Origin"))
	if ok {
		if _, allowed := handler.allowedOrigins[origin]; allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
		}
	}
}

func (handler *OAuthHandler) writeJSON(w http.ResponseWriter, r *http.Request, status int, payload map[string]any) {
	handler.responseHeaders(w, r)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func (handler *OAuthHandler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	handler.writeJSON(w, r, oauthErrorStatus(err), map[string]any{
		"success": false,
		"error":   oauthErrorCode(err),
	})
}

func oauthKeySet(values ...string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}

func decodeOAuthJSON(raw []byte) map[string]any {
	var value map[string]any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	_ = decoder.Decode(&value)
	return value
}
