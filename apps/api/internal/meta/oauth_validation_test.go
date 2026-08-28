package meta

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestOAuthStateRoundTripAndNonceHashing(t *testing.T) {
	flowID := "11111111-1111-4111-8111-111111111111"
	nonce, err := randomOAuthNonce()
	if err != nil {
		t.Fatalf("randomOAuthNonce() error = %v", err)
	}
	if len(nonce) != 43 || !oauthNoncePattern.MatchString(nonce) {
		t.Fatalf("nonce = %q, want 43 base64url characters", nonce)
	}
	state, err := EncodeOAuthState(flowID, nonce)
	if err != nil {
		t.Fatalf("EncodeOAuthState() error = %v", err)
	}
	gotFlowID, gotNonce, err := DecodeOAuthState(state)
	if err != nil {
		t.Fatalf("DecodeOAuthState() error = %v", err)
	}
	if gotFlowID != flowID || gotNonce != nonce {
		t.Fatalf("decoded state = (%q, %q), want (%q, %q)", gotFlowID, gotNonce, flowID, nonce)
	}
	if hashOAuthNonce(nonce) == nonce || len(hashOAuthNonce(nonce)) != 43 {
		t.Fatal("nonce must be stored only as a fixed-length SHA-256 base64url hash")
	}
	if _, _, err := DecodeOAuthState(state + ".replay"); oauthErrorCode(err) != "invalid_oauth_state" {
		t.Fatalf("malformed state error = %v", err)
	}
}

func TestOAuthReturnURLAllowlistAndSafeRedirect(t *testing.T) {
	origins := ParseOAuthAllowedOrigins(
		"https://app.vimob.com.br/path",
		"https://preview.vimob.com.br; http://localhost:3000\nhttp://evil.test",
	)
	allowed := make(map[string]struct{}, len(origins))
	for _, origin := range origins {
		allowed[origin] = struct{}{}
	}
	if _, ok := allowed["https://app.vimob.com.br"]; !ok {
		t.Fatalf("normalized origins = %#v", origins)
	}
	if _, ok := allowed["http://localhost:3000"]; !ok {
		t.Fatalf("loopback development origin missing: %#v", origins)
	}
	if _, ok := allowed["http://evil.test"]; ok {
		t.Fatalf("insecure non-loopback origin was accepted: %#v", origins)
	}

	returnURL := "https://app.vimob.com.br/integrations?code=provider-code&access_token=secret&safe=1#meta"
	validated, err := validateOAuthReturnURL(returnURL, allowed)
	if err != nil {
		t.Fatalf("validateOAuthReturnURL() error = %v", err)
	}
	redirect, err := BuildOAuthCallbackRedirect(validated, "success", "11111111-1111-4111-8111-111111111111", "")
	if err != nil {
		t.Fatalf("BuildOAuthCallbackRedirect() error = %v", err)
	}
	parsed, err := url.Parse(redirect)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"code", "access_token", "user_token", "page_token", "state"} {
		if parsed.Query().Has(forbidden) {
			t.Fatalf("redirect leaked transient provider parameter %q: %s", forbidden, redirect)
		}
	}
	if parsed.Query().Get("meta_oauth_status") != "success" || parsed.Query().Get("safe") != "1" {
		t.Fatalf("unexpected safe redirect: %s", redirect)
	}

	if _, err := validateOAuthReturnURL("https://attacker.invalid/callback", allowed); oauthErrorCode(err) != "return_url_not_allowed" {
		t.Fatalf("untrusted return URL error = %v", err)
	}
	if _, err := validateOAuthReturnURL(`https://app.vimob.com.br\@attacker.invalid/callback`, allowed); oauthErrorCode(err) != "return_url_not_allowed" {
		t.Fatalf("ambiguous backslash return URL error = %v", err)
	}
}

func TestOAuthActionsAcceptUnifiedInstagramFlagAndRejectBrowserCredentials(t *testing.T) {
	getURL := map[string]any{
		"action":            "get_auth_url",
		"organization_id":   "11111111-1111-4111-8111-111111111111",
		"return_url":        "https://app.vimob.test/integrations",
		"include_instagram": true,
	}
	if action, err := validateOAuthAction(getURL); err != nil || action != "get_auth_url" {
		t.Fatalf("unified Meta/Instagram action = %q, %v", action, err)
	}

	for _, credential := range []string{"code", "access_token", "user_token", "page_token"} {
		body := map[string]any{
			"action":   "connect_page",
			"flow_id":  "11111111-1111-4111-8111-111111111111",
			"page_id":  "123",
			credential: "browser-controlled-secret",
		}
		if _, err := validateOAuthAction(body); oauthErrorCode(err) != "unknown_meta_oauth_input" {
			t.Fatalf("credential %q error = %v", credential, err)
		}
	}
}

func TestOAuthHandlerUsesDirectSafeJSONAndTenantAdminContext(t *testing.T) {
	handler := &OAuthHandler{
		allowedOrigins: map[string]struct{}{"https://app.vimob.test": {}},
	}
	body := `{"action":"get_auth_url","return_url":"https://app.vimob.test/integrations"}`

	request := httptest.NewRequest(http.MethodPost, "/v1/integrations/meta/oauth/actions", strings.NewReader(body))
	request.Header.Set("Origin", "https://app.vimob.test")
	response := httptest.NewRecorder()
	handler.Action(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d, body = %s", response.Code, response.Body.String())
	}
	assertDirectOAuthError(t, response.Body.Bytes(), "authentication_required")

	request = httptest.NewRequest(http.MethodPost, "/v1/integrations/meta/oauth/actions", strings.NewReader(body))
	request.Header.Set("Origin", "https://app.vimob.test")
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		MemberRole:     "user",
	}))
	response = httptest.NewRecorder()
	handler.Action(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("non-admin status = %d, body = %s", response.Code, response.Body.String())
	}
	assertDirectOAuthError(t, response.Body.Bytes(), "organization_admin_required")
}

func TestOAuthSelectionIsNormalizedDeduplicatedAndBounded(t *testing.T) {
	selected, present, err := parseOAuthSelectedAccounts([]any{" 123 ", "act_123", json.Number("456")}, true)
	if err != nil {
		t.Fatal(err)
	}
	if !present || strings.Join(selected, ",") != "act_123,act_456" {
		t.Fatalf("selected = %#v, present = %v", selected, present)
	}
	tooMany := make([]any, oauthMaxSelectedAccounts+1)
	for index := range tooMany {
		tooMany[index] = "123"
	}
	if _, _, err := parseOAuthSelectedAccounts(tooMany, true); oauthErrorCode(err) != "invalid_ad_account_selection" {
		t.Fatalf("oversized selection error = %v", err)
	}
}

func assertDirectOAuthError(t *testing.T, raw []byte, code string) {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["success"] != false || payload["error"] != code {
		t.Fatalf("direct error payload = %#v", payload)
	}
	if _, wrapped := payload["data"]; wrapped {
		t.Fatalf("OAuth response must not use a data envelope: %#v", payload)
	}
}
