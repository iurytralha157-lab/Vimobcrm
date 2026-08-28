package meta

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type oauthGraphClient struct {
	appID           string
	appSecret       string
	loginConfigID   string
	graphVersion    string
	callbackURL     string
	graphBaseURL    *url.URL
	facebookBaseURL *url.URL
	httpClient      *http.Client
	requestTimeout  time.Duration
}

const (
	oauthLegacyAdAccountFields        = "id,account_id,name,account_status,currency,timezone_name,business{id,name}"
	oauthBusinessLoginAdAccountFields = "id,account_id,name,account_status,currency,timezone_name"
)

func newOAuthGraphClient(config OAuthConfig) (*oauthGraphClient, error) {
	appID := strings.TrimSpace(config.AppID)
	appSecret := strings.TrimSpace(config.AppSecret)
	if !oauthAppIDPattern.MatchString(appID) || len(appSecret) < 8 || len(appSecret) > 512 || containsOAuthControl(appSecret, true) {
		return nil, newOAuthFailure("meta_oauth_not_configured", http.StatusServiceUnavailable)
	}
	loginConfigID := strings.TrimSpace(config.LoginConfigID)
	if loginConfigID != "" && !oauthNumericIDPattern.MatchString(loginConfigID) {
		return nil, newOAuthFailure("meta_oauth_not_configured", http.StatusServiceUnavailable)
	}
	version := strings.TrimSpace(config.GraphVersion)
	if version == "" {
		version = oauthDefaultGraphVersion
	}
	if !oauthGraphVersionPattern.MatchString(version) {
		return nil, newOAuthFailure("meta_oauth_not_configured", http.StatusServiceUnavailable)
	}
	callbackURL, err := validateOAuthProviderURL(config.CallbackURL, false)
	if err != nil {
		return nil, newOAuthFailure("meta_oauth_not_configured", http.StatusServiceUnavailable, err)
	}
	graphRaw := strings.TrimSpace(config.GraphBaseURL)
	if graphRaw == "" {
		graphRaw = oauthDefaultGraphURL
	}
	graphBase, err := validateOAuthProviderURL(graphRaw, true)
	if err != nil {
		return nil, newOAuthFailure("meta_oauth_not_configured", http.StatusServiceUnavailable, err)
	}
	if !isOAuthLoopbackHost(graphBase.Hostname()) && !strings.EqualFold(graphBase.Hostname(), "graph.facebook.com") {
		return nil, newOAuthFailure("meta_oauth_not_configured", http.StatusServiceUnavailable)
	}
	facebookRaw := strings.TrimSpace(config.FacebookBaseURL)
	if facebookRaw == "" {
		facebookRaw = oauthDefaultFacebookURL
	}
	facebookBase, err := validateOAuthProviderURL(facebookRaw, true)
	if err != nil {
		return nil, newOAuthFailure("meta_oauth_not_configured", http.StatusServiceUnavailable, err)
	}
	if !isOAuthLoopbackHost(facebookBase.Hostname()) && !strings.EqualFold(facebookBase.Hostname(), "www.facebook.com") {
		return nil, newOAuthFailure("meta_oauth_not_configured", http.StatusServiceUnavailable)
	}

	requestTimeout := config.RequestTimeout
	if requestTimeout <= 0 || requestTimeout > 30*time.Second {
		requestTimeout = 12 * time.Second
	}
	client := &http.Client{Timeout: requestTimeout}
	if config.HTTPClient != nil {
		clone := *config.HTTPClient
		client = &clone
		if client.Timeout <= 0 || client.Timeout > 30*time.Second {
			client.Timeout = requestTimeout
		}
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}

	return &oauthGraphClient{
		appID:           appID,
		appSecret:       appSecret,
		loginConfigID:   loginConfigID,
		graphVersion:    version,
		callbackURL:     callbackURL.String(),
		graphBaseURL:    graphBase,
		facebookBaseURL: facebookBase,
		httpClient:      client,
		requestTimeout:  requestTimeout,
	}, nil
}

func validateOAuthProviderURL(value string, allowOriginOnly bool) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || !parsed.IsAbs() || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" || parsed.RawQuery != "" {
		return nil, errors.New("invalid provider URL")
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && isOAuthLoopbackHost(parsed.Hostname())) {
		return nil, errors.New("provider URL must use HTTPS")
	}
	if allowOriginOnly && parsed.Path != "" && parsed.Path != "/" {
		return nil, errors.New("provider base URL must be an origin")
	}
	return parsed, nil
}

func (client *oauthGraphClient) authorizationURL(state string) string {
	target := *client.facebookBaseURL
	target.Path = "/" + client.graphVersion + "/dialog/oauth"
	query := target.Query()
	query.Set("client_id", client.appID)
	query.Set("redirect_uri", client.callbackURL)
	query.Set("response_type", "code")
	query.Set("state", state)
	query.Set("auth_type", "rerequest")
	query.Set("return_scopes", "true")
	if client.loginConfigID != "" {
		query.Set("config_id", client.loginConfigID)
		query.Set("override_default_response_type", "true")
	} else {
		query.Set("scope", strings.Join(oauthLegacyLoginScopes, ","))
	}
	target.RawQuery = query.Encode()
	return target.String()
}

func (client *oauthGraphClient) loginScopes() []string {
	if client != nil && client.loginConfigID != "" {
		return oauthBusinessLoginScopes
	}
	return oauthLegacyLoginScopes
}

func (client *oauthGraphClient) exchangeAuthorizationCode(ctx context.Context, code string) (string, *time.Time, error) {
	shortLived, err := client.oauthTokenRequest(ctx, map[string]string{
		"client_id":     client.appID,
		"client_secret": client.appSecret,
		"redirect_uri":  client.callbackURL,
		"code":          code,
	})
	if err != nil {
		return "", nil, err
	}
	shortToken, err := oauthRequiredUserToken(shortLived["access_token"])
	if err != nil {
		return "", nil, newOAuthFailure("oauth_code_exchange_failed", http.StatusBadRequest)
	}
	longLived, err := client.oauthTokenRequest(ctx, map[string]string{
		"grant_type":        "fb_exchange_token",
		"client_id":         client.appID,
		"client_secret":     client.appSecret,
		"fb_exchange_token": shortToken,
	})
	if err != nil {
		return "", nil, err
	}
	accessToken, err := oauthRequiredUserToken(longLived["access_token"])
	if err != nil {
		return "", nil, newOAuthFailure("oauth_code_exchange_failed", http.StatusBadRequest)
	}
	seconds := oauthNumber(longLived["expires_in"])
	var expiresAt *time.Time
	if seconds > 0 {
		value := time.Now().UTC().Add(time.Duration(seconds) * time.Second)
		expiresAt = &value
	}
	return accessToken, expiresAt, nil
}

func (client *oauthGraphClient) oauthTokenRequest(ctx context.Context, parameters map[string]string) (map[string]any, error) {
	target := *client.graphBaseURL
	target.Path = "/" + client.graphVersion + "/oauth/access_token"
	query := target.Query()
	for key, value := range parameters {
		query.Set(key, value)
	}
	target.RawQuery = query.Encode()
	response, payload, err := client.doJSON(ctx, http.MethodGet, &target, nil, "")
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 || oauthMap(payload["error"]) != nil {
		return nil, newOAuthFailure("oauth_code_exchange_failed", http.StatusBadRequest)
	}
	return payload, nil
}

func (client *oauthGraphClient) debugUserToken(ctx context.Context, userToken string) (oauthTokenDebug, error) {
	target := *client.graphBaseURL
	target.Path = "/" + client.graphVersion + "/debug_token"
	query := target.Query()
	query.Set("input_token", userToken)
	target.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return oauthTokenDebug{}, newOAuthFailure("meta_request_failed", http.StatusBadGateway, err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+client.appID+"|"+client.appSecret)
	response, payload, err := client.executeJSONWithRetry(request)
	if err != nil {
		return oauthTokenDebug{}, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 || oauthMap(payload["error"]) != nil {
		return oauthTokenDebug{}, newOAuthFailure("oauth_user_token_invalid", http.StatusUnauthorized)
	}
	data := oauthMap(payload["data"])
	userID := oauthString(data["user_id"])
	if data == nil || data["is_valid"] != true || oauthString(data["app_id"]) != client.appID || !oauthNumericIDPattern.MatchString(userID) {
		return oauthTokenDebug{}, newOAuthFailure("oauth_user_token_invalid", http.StatusUnauthorized)
	}
	var expiresAt *time.Time
	if seconds := oauthNumber(data["expires_at"]); seconds > 0 {
		value := time.Unix(seconds, 0).UTC()
		expiresAt = &value
	}
	scopes := oauthStringSlice(data["scopes"], 100)
	return oauthTokenDebug{UserID: userID, ExpiresAt: expiresAt, Scopes: scopes}, nil
}

func (client *oauthGraphClient) fetchIdentity(ctx context.Context, token string) (oauthIdentity, error) {
	payload, err := client.graphRequest(ctx, http.MethodGet, "me", token, map[string]string{"fields": "id,name"}, nil)
	if err != nil {
		return oauthIdentity{}, err
	}
	id := oauthString(payload["id"])
	if !oauthNumericIDPattern.MatchString(id) {
		return oauthIdentity{}, newOAuthFailure("meta_identity_invalid", http.StatusBadGateway)
	}
	return oauthIdentity{ID: id, Name: oauthStringPointer(payload["name"])}, nil
}

func (client *oauthGraphClient) fetchManagedPages(ctx context.Context, token string) ([]oauthPage, error) {
	items, err := client.graphCollection(ctx, "me/accounts", token, strings.Join([]string{
		"id", "name", "access_token", "picture.width(200).height(200){url}",
		"instagram_business_account{id,username,name,profile_picture_url}",
	}, ","))
	if err != nil {
		return nil, err
	}
	pages := make([]oauthPage, 0, len(items))
	for _, item := range items {
		id := oauthString(item["id"])
		pageToken, tokenErr := oauthRequiredUserToken(item["access_token"])
		if !oauthNumericIDPattern.MatchString(id) || tokenErr != nil {
			continue
		}
		name := oauthString(item["name"])
		if name == "" {
			name = "Pagina " + id
		}
		picture := oauthMap(oauthMap(item["picture"])["data"])
		instagram := oauthMap(item["instagram_business_account"])
		instagramID := oauthStringPointer(instagram["id"])
		if instagramID != nil && !oauthNumericIDPattern.MatchString(*instagramID) {
			instagramID = nil
		}
		pages = append(pages, oauthPage{
			ID:                         id,
			Name:                       name,
			AccessToken:                pageToken,
			PictureURL:                 oauthHTTPSURLPointer(picture["url"]),
			InstagramBusinessAccountID: instagramID,
			InstagramUsername:          oauthStringPointer(instagram["username"]),
		})
	}
	return pages, nil
}

func (client *oauthGraphClient) fetchAdAccounts(ctx context.Context, token string) ([]oauthAdAccount, error) {
	items, err := client.graphCollection(ctx, "me/adaccounts", token, client.adAccountFields())
	if err != nil {
		return nil, err
	}
	accounts := make([]oauthAdAccount, 0, len(items))
	for _, item := range items {
		id, ok := NormalizeOAuthAdAccountID(oauthString(firstOAuthValue(item["id"], item["account_id"])))
		if !ok {
			continue
		}
		var status *int
		if raw := oauthNumber(item["account_status"]); raw != 0 {
			value := int(raw)
			status = &value
		}
		accounts = append(accounts, oauthAdAccount{
			ID:            id,
			AccountID:     strings.TrimPrefix(id, "act_"),
			Name:          oauthStringPointer(item["name"]),
			AccountStatus: status,
			Currency:      oauthStringPointer(item["currency"]),
			TimezoneName:  oauthStringPointer(item["timezone_name"]),
		})
	}
	return accounts, nil
}

func (client *oauthGraphClient) adAccountFields() string {
	if client != nil && client.loginConfigID != "" {
		return oauthBusinessLoginAdAccountFields
	}
	return oauthLegacyAdAccountFields
}

func (client *oauthGraphClient) subscribePageWebhook(ctx context.Context, page oauthPage, includeMessaging bool) (bool, error) {
	if !includeMessaging {
		payload, err := client.graphRequest(ctx, http.MethodPost, page.ID+"/subscribed_apps", page.AccessToken, nil, url.Values{
			"subscribed_fields": []string{"leadgen"},
		})
		if err != nil || payload["success"] != true {
			return false, newOAuthFailure("meta_webhook_subscription_failed", http.StatusBadGateway, err)
		}
		return false, nil
	}
	payload, err := client.graphRequest(ctx, http.MethodPost, page.ID+"/subscribed_apps", page.AccessToken, nil, url.Values{
		"subscribed_fields": []string{"leadgen,messages,messaging_postbacks"},
	})
	if err == nil && payload["success"] == true {
		return true, nil
	}
	if err != nil && oauthErrorCode(err) != "meta_permission_denied" && oauthErrorCode(err) != "meta_request_rejected" {
		return false, err
	}
	payload, err = client.graphRequest(ctx, http.MethodPost, page.ID+"/subscribed_apps", page.AccessToken, nil, url.Values{
		"subscribed_fields": []string{"leadgen"},
	})
	if err != nil || payload["success"] != true {
		return false, newOAuthFailure("meta_webhook_subscription_failed", http.StatusBadGateway)
	}
	return false, nil
}

func (client *oauthGraphClient) unsubscribePageWebhook(ctx context.Context, pageID string, pageToken string) bool {
	payload, err := client.graphRequest(ctx, http.MethodDelete, pageID+"/subscribed_apps", pageToken, nil, nil)
	return err == nil && payload["success"] == true
}

func (client *oauthGraphClient) validateSelectedAccounts(ctx context.Context, token string, selected []string) error {
	for _, accountID := range selected {
		payload, err := client.graphRequest(ctx, http.MethodGet, accountID, token, map[string]string{
			"fields": "id,account_id,name,account_status",
		}, nil)
		if err != nil {
			return err
		}
		actual, ok := NormalizeOAuthAdAccountID(oauthString(firstOAuthValue(payload["id"], payload["account_id"])))
		if !ok || actual != accountID {
			return newOAuthFailure("ad_account_not_accessible", http.StatusForbidden)
		}
	}
	return nil
}

func (client *oauthGraphClient) graphCollection(ctx context.Context, path string, token string, fields string) ([]map[string]any, error) {
	items := make([]map[string]any, 0)
	seen := make(map[string]struct{})
	after := ""
	for page := 0; page < oauthMaxGraphPages; page++ {
		parameters := map[string]string{"fields": fields, "limit": "100"}
		if after != "" {
			parameters["after"] = after
		}
		payload, err := client.graphRequest(ctx, http.MethodGet, path, token, parameters, nil)
		if err != nil {
			return nil, err
		}
		for _, raw := range oauthAnySlice(payload["data"]) {
			if item := oauthMap(raw); item != nil {
				items = append(items, item)
				if len(items) >= oauthMaxGraphItems {
					return items, nil
				}
			}
		}
		paging := oauthMap(payload["paging"])
		cursors := oauthMap(paging["cursors"])
		next := oauthString(cursors["after"])
		if next == "" {
			return items, nil
		}
		if _, exists := seen[next]; exists {
			return nil, newOAuthFailure("meta_repeated_paging_cursor", http.StatusBadGateway)
		}
		seen[next] = struct{}{}
		after = next
	}
	return items, nil
}

func (client *oauthGraphClient) graphRequest(ctx context.Context, method string, path string, token string, parameters map[string]string, form url.Values) (map[string]any, error) {
	segments := strings.Split(path, "/")
	encoded := make([]string, 0, len(segments))
	for _, segment := range segments {
		if segment == "" || segment == "." || segment == ".." {
			return nil, newOAuthFailure("invalid_meta_graph_path", http.StatusInternalServerError)
		}
		encoded = append(encoded, url.PathEscape(segment))
	}
	target := *client.graphBaseURL
	target.Path = "/" + client.graphVersion + "/" + strings.Join(encoded, "/")
	query := target.Query()
	for key, value := range parameters {
		query.Set(key, value)
	}
	query.Set("appsecret_proof", oauthAppSecretProof(client.appSecret, token))
	target.RawQuery = query.Encode()

	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	request, err := http.NewRequestWithContext(ctx, method, target.String(), body)
	if err != nil {
		return nil, newOAuthFailure("meta_request_failed", http.StatusBadGateway, err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	if form != nil {
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	response, payload, err := client.executeJSONWithRetry(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 || oauthMap(payload["error"]) != nil {
		return nil, oauthGraphFailure(response.StatusCode, payload)
	}
	return payload, nil
}

func (client *oauthGraphClient) doJSON(ctx context.Context, method string, target *url.URL, body io.Reader, bearer string) (*http.Response, map[string]any, error) {
	request, err := http.NewRequestWithContext(ctx, method, target.String(), body)
	if err != nil {
		return nil, nil, err
	}
	request.Header.Set("Accept", "application/json")
	if bearer != "" {
		request.Header.Set("Authorization", "Bearer "+bearer)
	}
	return client.executeJSONWithRetry(request)
}

func (client *oauthGraphClient) executeJSONWithRetry(request *http.Request) (*http.Response, map[string]any, error) {
	for attempt := 0; attempt < 2; attempt++ {
		clone := request.Clone(request.Context())
		if request.Body != nil {
			if request.GetBody == nil {
				return nil, nil, newOAuthFailure("meta_request_failed", http.StatusBadGateway)
			}
			body, err := request.GetBody()
			if err != nil {
				return nil, nil, newOAuthFailure("meta_request_failed", http.StatusBadGateway, err)
			}
			clone.Body = body
		}
		response, payload, err := client.executeJSON(clone)
		if err != nil && attempt == 0 && request.Context().Err() == nil {
			code := oauthErrorCode(err)
			if code == "meta_request_failed" || code == "meta_request_timeout" {
				if retryErr := waitOAuthRetry(request.Context()); retryErr != nil {
					return nil, nil, retryErr
				}
				continue
			}
		}
		if err == nil && attempt == 0 && (response.StatusCode == http.StatusTooManyRequests || response.StatusCode >= 500) {
			if retryErr := waitOAuthRetry(request.Context()); retryErr != nil {
				return nil, nil, retryErr
			}
			continue
		}
		return response, payload, err
	}
	return nil, nil, newOAuthFailure("meta_request_failed", http.StatusBadGateway)
}

func waitOAuthRetry(ctx context.Context) error {
	timer := time.NewTimer(time.Second)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return newOAuthFailure("meta_request_timeout", http.StatusGatewayTimeout, ctx.Err())
	case <-timer.C:
		return nil
	}
}

func (client *oauthGraphClient) executeJSON(request *http.Request) (*http.Response, map[string]any, error) {
	response, err := client.httpClient.Do(request)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(request.Context().Err(), context.DeadlineExceeded) {
			return nil, nil, newOAuthFailure("meta_request_timeout", http.StatusGatewayTimeout, err)
		}
		return nil, nil, newOAuthFailure("meta_request_failed", http.StatusBadGateway, err)
	}
	payload, readErr := readOAuthJSONResponse(response)
	if readErr != nil {
		return response, nil, readErr
	}
	return response, payload, nil
}

func readOAuthJSONResponse(response *http.Response) (map[string]any, error) {
	defer response.Body.Close()
	if response.ContentLength > oauthMaxGraphResponseBytes {
		return nil, newOAuthFailure("meta_response_too_large", http.StatusBadGateway)
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, oauthMaxGraphResponseBytes+1))
	if err != nil {
		return nil, newOAuthFailure("meta_invalid_response", http.StatusBadGateway, err)
	}
	if int64(len(raw)) > oauthMaxGraphResponseBytes {
		return nil, newOAuthFailure("meta_response_too_large", http.StatusBadGateway)
	}
	if !utf8.Valid(raw) {
		return nil, newOAuthFailure("meta_invalid_response", http.StatusBadGateway)
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return map[string]any{}, nil
	}
	var payload map[string]any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil || payload == nil {
		return nil, newOAuthFailure("meta_invalid_response", http.StatusBadGateway, err)
	}
	return payload, nil
}

func oauthGraphFailure(status int, payload map[string]any) error {
	graphError := oauthMap(payload["error"])
	code := oauthNumber(graphError["code"])
	switch {
	case status == http.StatusTooManyRequests || code == 4 || code == 17 || code == 32 || code == 613:
		return newOAuthFailure("meta_rate_limited", http.StatusTooManyRequests)
	case status == http.StatusUnauthorized || code == 190:
		return newOAuthFailure("meta_access_token_invalid", http.StatusUnauthorized)
	case status == http.StatusForbidden || code == 10 || code == 200 || code == 294:
		return newOAuthFailure("meta_permission_denied", http.StatusForbidden)
	case status == http.StatusBadRequest || code == 100:
		return newOAuthFailure("meta_request_rejected", http.StatusUnprocessableEntity)
	case status >= 500:
		return newOAuthFailure("meta_temporarily_unavailable", http.StatusServiceUnavailable)
	default:
		return newOAuthFailure("meta_graph_request_failed", http.StatusBadGateway)
	}
}

func oauthAppSecretProof(secret string, token string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(token))
	return hex.EncodeToString(mac.Sum(nil))
}

func oauthRequiredUserToken(value any) (string, error) {
	token, ok := value.(string)
	if !ok {
		return "", newOAuthFailure("oauth_user_token_required", http.StatusBadRequest)
	}
	token = strings.TrimSpace(token)
	if len(token) < 16 || len(token) > 4096 || containsOAuthControl(token, true) {
		return "", newOAuthFailure("oauth_user_token_invalid", http.StatusBadRequest)
	}
	return token, nil
}

func oauthMap(value any) map[string]any {
	if typed, ok := value.(map[string]any); ok {
		return typed
	}
	return nil
}

func oauthAnySlice(value any) []any {
	if typed, ok := value.([]any); ok {
		return typed
	}
	return nil
}

func oauthStringSlice(value any, maximum int) []string {
	items := oauthAnySlice(value)
	if maximum > 0 && len(items) > maximum {
		items = items[:maximum]
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		if text := oauthString(item); text != "" {
			result = append(result, text)
		}
	}
	return result
}

func oauthNumber(value any) int64 {
	switch typed := value.(type) {
	case json.Number:
		parsed, _ := typed.Int64()
		return parsed
	case float64:
		return int64(typed)
	case int:
		return int64(typed)
	case int64:
		return typed
	case string:
		parsed, _ := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
		return parsed
	default:
		return 0
	}
}

func oauthStringPointer(value any) *string {
	text := oauthString(value)
	if text == "" {
		return nil
	}
	return &text
}

func oauthHTTPSURLPointer(value any) *string {
	text := oauthString(value)
	parsed, err := url.Parse(text)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return nil
	}
	return oauthStringPointer(parsed.String())
}

func firstOAuthValue(values ...any) any {
	for _, value := range values {
		if oauthString(value) != "" {
			return value
		}
	}
	return nil
}
