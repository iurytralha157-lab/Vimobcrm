package marketing

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	metaMaxResponseBytes = 4 << 20
	metaMaxPages         = 20
)

// metaClient only ever sends GET requests: the Graph calls that could disturb
// the lead intake (subscribed_apps, DELETE /me/permissions) all need another
// method, so they are unreachable from here.
type metaClient struct {
	config MetaConfig
	http   *http.Client
}

type metaIdentity struct {
	ID   string
	Name string
}

func newMetaClient(config MetaConfig, transport http.RoundTripper) *metaClient {
	if config.GraphBaseURL == "" {
		config.GraphBaseURL = "https://graph.facebook.com"
	}
	if config.DialogBaseURL == "" {
		config.DialogBaseURL = "https://www.facebook.com"
	}
	config.GraphBaseURL = strings.TrimRight(config.GraphBaseURL, "/")
	config.DialogBaseURL = strings.TrimRight(config.DialogBaseURL, "/")
	return &metaClient{
		config: config,
		http: &http.Client{
			Timeout:   20 * time.Second,
			Transport: transport,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

func (client *metaClient) authorizationURL(state string) string {
	query := url.Values{}
	query.Set("client_id", client.config.AppID)
	query.Set("redirect_uri", client.config.CallbackURL)
	query.Set("state", state)
	query.Set("response_type", "code")
	if client.config.LoginConfigID != "" {
		query.Set("config_id", client.config.LoginConfigID)
	} else {
		query.Set("scope", strings.Join(metaLoginScopes, ","))
	}
	return client.config.DialogBaseURL + "/" + client.config.GraphVersion + "/dialog/oauth?" + query.Encode()
}

func (client *metaClient) exchangeCode(ctx context.Context, code string) (string, *time.Time, error) {
	short, err := client.tokenRequest(ctx, url.Values{
		"client_id":     {client.config.AppID},
		"client_secret": {client.config.AppSecret},
		"redirect_uri":  {client.config.CallbackURL},
		"code":          {code},
	})
	if err != nil {
		return "", nil, err
	}
	shortToken, _ := short["access_token"].(string)
	if shortToken == "" {
		return "", nil, newFailure("meta_code_exchange_failed", http.StatusBadGateway)
	}
	long, err := client.tokenRequest(ctx, url.Values{
		"grant_type":        {"fb_exchange_token"},
		"client_id":         {client.config.AppID},
		"client_secret":     {client.config.AppSecret},
		"fb_exchange_token": {shortToken},
	})
	if err != nil {
		return "", nil, err
	}
	token, _ := long["access_token"].(string)
	if token == "" {
		return "", nil, newFailure("meta_code_exchange_failed", http.StatusBadGateway)
	}
	var expiresAt *time.Time
	if seconds, ok := long["expires_in"].(float64); ok && seconds > 0 {
		value := time.Now().UTC().Add(time.Duration(seconds) * time.Second)
		expiresAt = &value
	}
	return token, expiresAt, nil
}

func (client *metaClient) tokenRequest(ctx context.Context, query url.Values) (map[string]any, error) {
	target := client.config.GraphBaseURL + "/" + client.config.GraphVersion + "/oauth/access_token?" + query.Encode()
	payload, status, err := client.get(ctx, target, "")
	if err != nil {
		return nil, newFailure("meta_request_failed", http.StatusBadGateway)
	}
	if status != http.StatusOK {
		return nil, newFailure("meta_code_exchange_failed", http.StatusBadGateway)
	}
	return payload, nil
}

func (client *metaClient) fetchIdentity(ctx context.Context, token string) (metaIdentity, error) {
	payload, err := client.graphGet(ctx, "me", token, url.Values{"fields": {"id,name"}})
	if err != nil {
		return metaIdentity{}, err
	}
	identity := metaIdentity{ID: stringValue(payload["id"]), Name: stringValue(payload["name"])}
	if identity.ID == "" {
		return metaIdentity{}, newFailure("meta_identity_missing", http.StatusBadGateway)
	}
	return identity, nil
}

func (client *metaClient) fetchGrantedScopes(ctx context.Context, token string) ([]string, error) {
	items, err := client.collection(ctx, "me/permissions", token, url.Values{})
	if err != nil {
		return nil, err
	}
	scopes := make([]string, 0, len(items))
	for _, item := range items {
		if stringValue(item["status"]) == "granted" && stringValue(item["permission"]) != "" {
			scopes = append(scopes, stringValue(item["permission"]))
		}
	}
	return scopes, nil
}

// fetchAssets lists what the login can see. It never requests a Page
// access_token, so no Page token can be stored by this package.
func (client *metaClient) fetchAssets(ctx context.Context, token string) ([]DiscoveredAsset, error) {
	accounts, err := client.collection(ctx, "me/adaccounts", token, url.Values{
		"fields": {"account_id,name,account_status,currency,timezone_name"},
	})
	if err != nil {
		return nil, err
	}
	pages, err := client.collection(ctx, "me/accounts", token, url.Values{
		"fields": {"id,name,instagram_business_account{id,username}"},
	})
	if err != nil {
		return nil, err
	}
	assets := make([]DiscoveredAsset, 0, len(accounts)+len(pages)*2)
	for _, item := range accounts {
		if id := stringValue(item["account_id"]); id != "" {
			assets = append(assets, DiscoveredAsset{
				Type: AssetAdAccount, ExternalID: id, Name: stringValue(item["name"]),
				Metadata: map[string]any{
					"account_status": item["account_status"],
					"currency":       stringValue(item["currency"]),
					"timezone_name":  stringValue(item["timezone_name"]),
				},
			})
		}
	}
	for _, item := range pages {
		pageID := stringValue(item["id"])
		if pageID == "" {
			continue
		}
		assets = append(assets, DiscoveredAsset{
			Type: AssetPage, ExternalID: pageID, Name: stringValue(item["name"]), Metadata: map[string]any{},
		})
		instagram, _ := item["instagram_business_account"].(map[string]any)
		if instagramID := stringValue(instagram["id"]); instagramID != "" {
			assets = append(assets, DiscoveredAsset{
				Type: AssetInstagram, ExternalID: instagramID, Name: stringValue(instagram["username"]),
				Metadata: map[string]any{"page_id": pageID},
			})
		}
	}
	return assets, nil
}

func (client *metaClient) collection(ctx context.Context, path string, token string, query url.Values) ([]map[string]any, error) {
	query.Set("limit", "100")
	items := []map[string]any{}
	after := ""
	for page := 0; page < metaMaxPages; page++ {
		if after != "" {
			query.Set("after", after)
		}
		payload, err := client.graphGet(ctx, path, token, query)
		if err != nil {
			return nil, err
		}
		data, _ := payload["data"].([]any)
		for _, raw := range data {
			if item, ok := raw.(map[string]any); ok {
				items = append(items, item)
			}
		}
		paging, _ := payload["paging"].(map[string]any)
		cursors, _ := paging["cursors"].(map[string]any)
		after = stringValue(cursors["after"])
		if after == "" || stringValue(paging["next"]) == "" {
			return items, nil
		}
	}
	return items, nil
}

func (client *metaClient) graphGet(ctx context.Context, path string, token string, query url.Values) (map[string]any, error) {
	query.Set("appsecret_proof", client.secretProof(token))
	target := client.config.GraphBaseURL + "/" + client.config.GraphVersion + "/" + path + "?" + query.Encode()
	payload, status, err := client.get(ctx, target, token)
	if err != nil {
		return nil, newFailure("meta_request_failed", http.StatusBadGateway)
	}
	if status == http.StatusOK {
		return payload, nil
	}
	providerError, _ := payload["error"].(map[string]any)
	code, _ := providerError["code"].(float64)
	switch {
	case status == http.StatusUnauthorized || code == 190:
		return nil, newFailure("meta_access_token_invalid", http.StatusUnauthorized)
	case code == 10 || (code >= 200 && code <= 299):
		return nil, newFailure("meta_permission_denied", http.StatusForbidden)
	case code == 4 || code == 17 || code == 32 || code == 613:
		return nil, newFailure("meta_rate_limited", http.StatusTooManyRequests)
	}
	return nil, newFailure("meta_request_failed", http.StatusBadGateway)
}

// get is the only network call of this client, and it is always a GET. Errors
// are dropped by its callers because transport errors can quote the URL, which
// holds the app secret during the token exchange.
func (client *metaClient) get(ctx context.Context, target string, token string) (map[string]any, int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, 0, err
	}
	request.Header.Set("Accept", "application/json")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := client.http.Do(request)
	if err != nil {
		return nil, 0, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, metaMaxResponseBytes))
	if err != nil {
		return nil, 0, err
	}
	payload := map[string]any{}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &payload)
	}
	return payload, response.StatusCode, nil
}

func (client *metaClient) secretProof(token string) string {
	mac := hmac.New(sha256.New, []byte(client.config.AppSecret))
	mac.Write([]byte(token))
	return hex.EncodeToString(mac.Sum(nil))
}

func stringValue(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}
