package meta

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

var pinnedLegacyOAuthScopes = []string{
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

var pinnedBusinessLoginOAuthScopes = []string{
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

func TestOAuthGraphExchangesAndValidatesUnifiedPortfolio(t *testing.T) {
	const (
		appID      = "123456789"
		appSecret  = "test-app-secret-value"
		shortToken = "short-token-1234567890"
		longToken  = "long-token-123456789012"
		pageToken  = "page-token-123456789012"
	)
	var mutex sync.Mutex
	requests := make([]string, 0)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mutex.Lock()
		requests = append(requests, r.Method+" "+r.URL.Path)
		mutex.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v25.0/oauth/access_token":
			if r.URL.Query().Get("client_id") != appID || r.URL.Query().Get("client_secret") != appSecret {
				t.Errorf("token exchange missing app credentials: %s", r.URL.RawQuery)
			}
			if r.URL.Query().Get("grant_type") == "fb_exchange_token" {
				if r.URL.Query().Get("fb_exchange_token") != shortToken {
					t.Errorf("long-lived exchange token = %q", r.URL.Query().Get("fb_exchange_token"))
				}
				writeOAuthTestJSON(w, map[string]any{"access_token": longToken, "expires_in": 3600})
				return
			}
			if r.URL.Query().Get("code") != "provider-code" {
				t.Errorf("authorization code = %q", r.URL.Query().Get("code"))
			}
			writeOAuthTestJSON(w, map[string]any{"access_token": shortToken})
		case "/v25.0/debug_token":
			if r.Header.Get("Authorization") != "Bearer "+appID+"|"+appSecret {
				t.Errorf("debug authorization = %q", r.Header.Get("Authorization"))
			}
			writeOAuthTestJSON(w, map[string]any{"data": map[string]any{
				"is_valid":   true,
				"app_id":     appID,
				"user_id":    "9001",
				"expires_at": time.Now().Add(time.Hour).Unix(),
				"scopes":     OAuthScopes(),
			}})
		case "/v25.0/me":
			assertOAuthBearerAndProof(t, r, longToken, appSecret)
			writeOAuthTestJSON(w, map[string]any{"id": "9001", "name": "Andre"})
		case "/v25.0/me/accounts":
			assertOAuthBearerAndProof(t, r, longToken, appSecret)
			writeOAuthTestJSON(w, map[string]any{"data": []any{map[string]any{
				"id":           "7001",
				"name":         "Vimob Page",
				"access_token": pageToken,
				"picture":      map[string]any{"data": map[string]any{"url": "https://images.example/page.png"}},
				"instagram_business_account": map[string]any{
					"id": "8001", "username": "vimob",
				},
			}}})
		case "/v25.0/me/adaccounts":
			assertOAuthBearerAndProof(t, r, longToken, appSecret)
			if r.URL.Query().Get("fields") != "id,account_id,name,account_status,currency,timezone_name,business{id,name}" {
				t.Errorf("legacy ad account fields = %q", r.URL.Query().Get("fields"))
			}
			writeOAuthTestJSON(w, map[string]any{"data": []any{map[string]any{
				"id": "act_6001", "account_id": "6001", "name": "Vimob Ads",
				"account_status": 1, "currency": "BRL", "timezone_name": "America/Sao_Paulo",
			}}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	graph := newOAuthTestGraph(t, server.URL, appID, appSecret)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	userToken, expiresAt, err := graph.exchangeAuthorizationCode(ctx, "provider-code")
	if err != nil {
		t.Fatalf("exchangeAuthorizationCode() error = %v", err)
	}
	if userToken != longToken || expiresAt == nil {
		t.Fatalf("exchange result = (%q, %v)", userToken, expiresAt)
	}
	debug, err := graph.debugUserToken(ctx, userToken)
	if err != nil || debug.UserID != "9001" {
		t.Fatalf("debug result = %#v, %v", debug, err)
	}
	identity, err := graph.fetchIdentity(ctx, userToken)
	if err != nil || identity.ID != debug.UserID {
		t.Fatalf("identity result = %#v, %v", identity, err)
	}
	pages, err := graph.fetchManagedPages(ctx, userToken)
	if err != nil || len(pages) != 1 || pages[0].AccessToken != pageToken || pages[0].InstagramBusinessAccountID == nil {
		t.Fatalf("pages result = %#v, %v", pages, err)
	}
	accounts, err := graph.fetchAdAccounts(ctx, userToken)
	if err != nil || len(accounts) != 1 || accounts[0].ID != "act_6001" {
		t.Fatalf("accounts result = %#v, %v", accounts, err)
	}
	mutex.Lock()
	defer mutex.Unlock()
	if len(requests) != 6 {
		t.Fatalf("provider requests = %#v", requests)
	}
}

func TestOAuthGraphBusinessLoginOmitsUnusedAdAccountBusinessField(t *testing.T) {
	const (
		appSecret  = "test-app-secret-value"
		userToken  = "long-token-123456789012"
		wantFields = "id,account_id,name,account_status,currency,timezone_name"
	)
	var actualFields string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v25.0/me/adaccounts" {
			http.NotFound(w, r)
			return
		}
		assertOAuthBearerAndProof(t, r, userToken, appSecret)
		actualFields = r.URL.Query().Get("fields")
		writeOAuthTestJSON(w, map[string]any{"data": []any{map[string]any{
			"id": "act_6001", "account_id": "6001", "name": "Vimob Ads",
			"account_status": 1, "currency": "BRL", "timezone_name": "America/Sao_Paulo",
		}}})
	}))
	defer server.Close()

	graph := newOAuthTestGraph(t, server.URL, "123456789", appSecret)
	graph.loginConfigID = "987654321098765"
	accounts, err := graph.fetchAdAccounts(context.Background(), userToken)
	if err != nil {
		t.Fatal(err)
	}
	if actualFields != wantFields || strings.Contains(actualFields, "business") {
		t.Fatalf("Business Login ad account fields = %q", actualFields)
	}
	if len(accounts) != 1 || accounts[0].ID != "act_6001" || accounts[0].AccountID != "6001" {
		t.Fatalf("mapped ad accounts = %#v", accounts)
	}
}

func TestOAuthGraphWebhookFallsBackToLeadgenAndDisconnects(t *testing.T) {
	const pageToken = "page-token-123456789012"
	var subscriptions []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/v25.0/7001/subscribed_apps" {
			http.NotFound(w, r)
			return
		}
		switch r.Method {
		case http.MethodPost:
			_ = r.ParseForm()
			subscriptions = append(subscriptions, r.Form.Get("subscribed_fields"))
			if len(subscriptions) == 1 {
				w.WriteHeader(http.StatusForbidden)
				writeOAuthTestJSON(w, map[string]any{"error": map[string]any{"code": 200}})
				return
			}
			writeOAuthTestJSON(w, map[string]any{"success": true})
		case http.MethodDelete:
			writeOAuthTestJSON(w, map[string]any{"success": true})
		}
	}))
	defer server.Close()

	graph := newOAuthTestGraph(t, server.URL, "123456789", "test-app-secret-value")
	page := oauthPage{ID: "7001", Name: "Vimob", AccessToken: pageToken}
	messengerActive, err := graph.subscribePageWebhook(context.Background(), page, true)
	if err != nil {
		t.Fatal(err)
	}
	if messengerActive || strings.Join(subscriptions, "|") != "leadgen,messages,messaging_postbacks|leadgen" {
		t.Fatalf("messenger = %v, subscriptions = %#v", messengerActive, subscriptions)
	}
	if !graph.unsubscribePageWebhook(context.Background(), page.ID, pageToken) {
		t.Fatal("webhook unsubscribe should succeed")
	}
}

func TestOAuthGraphSubscribesOnlyLeadgenWithoutMarketingModule(t *testing.T) {
	const pageToken = "page-token-123456789012"
	var subscriptions []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = r.ParseForm()
		subscriptions = append(subscriptions, r.Form.Get("subscribed_fields"))
		writeOAuthTestJSON(w, map[string]any{"success": true})
	}))
	defer server.Close()

	graph := newOAuthTestGraph(t, server.URL, "123456789", "test-app-secret-value")
	messengerActive, err := graph.subscribePageWebhook(context.Background(), oauthPage{
		ID: "7001", Name: "Vimob", AccessToken: pageToken,
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	if messengerActive || len(subscriptions) != 1 || subscriptions[0] != "leadgen" {
		t.Fatalf("messenger = %v, subscriptions = %#v", messengerActive, subscriptions)
	}
}

func TestOAuthGraphMapsTokenFailuresAndRejectsOversizedResponses(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v25.0/me" {
			w.WriteHeader(http.StatusUnauthorized)
			writeOAuthTestJSON(w, map[string]any{"error": map[string]any{"code": 190, "message": "raw provider secret detail"}})
			return
		}
		w.Header().Set("Content-Length", "3000000")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	graph := newOAuthTestGraph(t, server.URL, "123456789", "test-app-secret-value")
	_, err := graph.fetchIdentity(context.Background(), "long-token-123456789012")
	if oauthErrorCode(err) != "meta_access_token_invalid" || strings.Contains(err.Error(), "provider") {
		t.Fatalf("safe token error = %v", err)
	}
	_, err = graph.fetchManagedPages(context.Background(), "long-token-123456789012")
	if oauthErrorCode(err) != "meta_response_too_large" {
		t.Fatalf("oversized response error = %v", err)
	}
}

func newOAuthTestGraph(t *testing.T, providerURL string, appID string, appSecret string) *oauthGraphClient {
	t.Helper()
	graph, err := newOAuthGraphClient(OAuthConfig{
		AppID:           appID,
		AppSecret:       appSecret,
		GraphVersion:    "v25.0",
		CallbackURL:     providerURL + "/oauth/callback",
		GraphBaseURL:    providerURL,
		FacebookBaseURL: providerURL,
		RequestTimeout:  2 * time.Second,
		HTTPClient:      &http.Client{Timeout: 2 * time.Second},
	})
	if err != nil {
		t.Fatalf("newOAuthGraphClient() error = %v", err)
	}
	return graph
}

func assertOAuthBearerAndProof(t *testing.T, r *http.Request, token string, secret string) {
	t.Helper()
	if r.Header.Get("Authorization") != "Bearer "+token {
		t.Errorf("authorization = %q", r.Header.Get("Authorization"))
	}
	if r.URL.Query().Get("appsecret_proof") != oauthAppSecretProof(secret, token) {
		t.Errorf("invalid appsecret_proof: %s", r.URL.RawQuery)
	}
}

func writeOAuthTestJSON(w http.ResponseWriter, value any) {
	_ = json.NewEncoder(w).Encode(value)
}

func TestOAuthScopeProfilesArePinnedToReviewedLists(t *testing.T) {
	if actual := OAuthScopes(); !slices.Equal(actual, pinnedLegacyOAuthScopes) {
		t.Fatalf("legacy scopes = %#v", actual)
	}
	if actual := OAuthBusinessLoginScopes(); !slices.Equal(actual, pinnedBusinessLoginOAuthScopes) {
		t.Fatalf("business login scopes = %#v", actual)
	}
}

func TestOAuthAuthorizationURLUsesOneAppAndUnifiedScopes(t *testing.T) {
	graph := newOAuthTestGraph(t, "http://127.0.0.1:9999", "123456789", "test-app-secret-value")
	state := "11111111-1111-4111-8111-111111111111.abcdefghijklmnopqrstuvwxyzABCDEFGH123456789"
	legacyURL := legacyOAuthAuthorizationURL(graph, state)
	actualURL := graph.authorizationURL(state)
	if actualURL != legacyURL {
		t.Fatalf("empty login config changed the legacy OAuth URL:\nactual: %s\nlegacy: %s", actualURL, legacyURL)
	}
	target, err := url.Parse(actualURL)
	if err != nil {
		t.Fatal(err)
	}
	if target.Query().Get("scope") != strings.Join(pinnedLegacyOAuthScopes, ",") {
		t.Fatalf("scope = %q", target.Query().Get("scope"))
	}
	if target.Query().Get("client_id") != "123456789" || target.Query().Get("response_type") != "code" {
		t.Fatalf("authorization URL = %s", target)
	}
	if target.Query().Has("config_id") || target.Query().Has("override_default_response_type") {
		t.Fatalf("legacy authorization URL unexpectedly contains Business Login parameters: %s", target)
	}
}

func TestOAuthAuthorizationURLAddsBusinessLoginCodeGrantParameters(t *testing.T) {
	graph, err := newOAuthGraphClient(OAuthConfig{
		AppID:           "123456789",
		AppSecret:       "test-app-secret-value",
		LoginConfigID:   " 987654321098765 ",
		GraphVersion:    "v25.0",
		CallbackURL:     "http://127.0.0.1:9999/oauth/callback",
		GraphBaseURL:    "http://127.0.0.1:9999",
		FacebookBaseURL: "http://127.0.0.1:9999",
	})
	if err != nil {
		t.Fatal(err)
	}
	state := "11111111-1111-4111-8111-111111111111.abcdefghijklmnopqrstuvwxyzABCDEFGH123456789"
	target, err := url.Parse(graph.authorizationURL(state))
	if err != nil {
		t.Fatal(err)
	}
	query := target.Query()
	if query.Get("config_id") != "987654321098765" {
		t.Fatalf("config_id = %q", query.Get("config_id"))
	}
	if query.Get("override_default_response_type") != "true" {
		t.Fatalf("override_default_response_type = %q", query.Get("override_default_response_type"))
	}
	if query.Has("scope") {
		t.Fatalf("Business Login URL must let config_id define permissions and omit scope: %s", target)
	}
	query.Del("config_id")
	query.Del("override_default_response_type")
	query.Set("scope", strings.Join(pinnedLegacyOAuthScopes, ","))
	target.RawQuery = query.Encode()
	if target.String() != legacyOAuthAuthorizationURL(graph, state) {
		t.Fatalf("business login configuration changed unrelated OAuth parameters: %s", target)
	}
}

func TestOAuthMissingScopesUsesActiveLoginProfile(t *testing.T) {
	businessClient := &oauthGraphClient{loginConfigID: "987654321098765"}
	if missing := oauthMissingScopes(pinnedBusinessLoginOAuthScopes, businessClient.loginScopes()); len(missing) != 0 {
		t.Fatalf("Business Login incorrectly reports missing permissions: %#v", missing)
	}

	legacyOnly := []string{"pages_read_user_content", "read_insights", "business_management"}
	legacyClient := &oauthGraphClient{}
	if missing := oauthMissingScopes(pinnedBusinessLoginOAuthScopes, legacyClient.loginScopes()); !slices.Equal(missing, legacyOnly) {
		t.Fatalf("legacy profile distinction = %#v, want %#v", missing, legacyOnly)
	}

	withoutManageAds := make([]string, 0, len(pinnedBusinessLoginOAuthScopes)-1)
	for _, scope := range pinnedBusinessLoginOAuthScopes {
		if scope != "pages_manage_ads" {
			withoutManageAds = append(withoutManageAds, scope)
		}
	}
	if missing := oauthMissingScopes(withoutManageAds, businessClient.loginScopes()); !slices.Equal(missing, []string{"pages_manage_ads"}) {
		t.Fatalf("Business Login missing permissions = %#v", missing)
	}
}

func TestOAuthGraphRejectsInvalidBusinessLoginConfigID(t *testing.T) {
	_, err := newOAuthGraphClient(OAuthConfig{
		AppID:           "123456789",
		AppSecret:       "test-app-secret-value",
		LoginConfigID:   "invalid-config-id",
		GraphVersion:    "v25.0",
		CallbackURL:     "https://api.vimob.test/v1/public/integrations/meta/oauth/callback",
		GraphBaseURL:    "https://graph.facebook.com",
		FacebookBaseURL: "https://www.facebook.com",
	})
	if oauthErrorCode(err) != "meta_oauth_not_configured" {
		t.Fatalf("invalid login config error = %v", err)
	}
}

func legacyOAuthAuthorizationURL(client *oauthGraphClient, state string) string {
	target := *client.facebookBaseURL
	target.Path = "/" + client.graphVersion + "/dialog/oauth"
	query := target.Query()
	query.Set("client_id", client.appID)
	query.Set("redirect_uri", client.callbackURL)
	query.Set("response_type", "code")
	query.Set("scope", strings.Join(pinnedLegacyOAuthScopes, ","))
	query.Set("state", state)
	query.Set("auth_type", "rerequest")
	query.Set("return_scopes", "true")
	target.RawQuery = query.Encode()
	return target.String()
}

func TestOAuthGraphRejectsCredentialExfiltrationBaseURL(t *testing.T) {
	_, err := newOAuthGraphClient(OAuthConfig{
		AppID:           "123456789",
		AppSecret:       "test-app-secret-value",
		CallbackURL:     "https://api.vimob.test/v1/public/integrations/meta/oauth/callback",
		GraphBaseURL:    "https://attacker.invalid",
		FacebookBaseURL: "https://www.facebook.com",
	})
	if oauthErrorCode(err) != "meta_oauth_not_configured" {
		t.Fatalf("untrusted provider base error = %v", err)
	}
}
