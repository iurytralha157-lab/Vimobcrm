package marketing

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const testOrganizationID = "11111111-1111-4111-8111-111111111111"

type fakeStore struct {
	flow    Flow
	saved   []SaveConnectionInput
	deleted []string
	used    bool
	target  SyncTarget
	marked  string
}

func (store *fakeStore) CreateFlow(_ context.Context, flow Flow) (string, error) {
	flow.ID = "22222222-2222-4222-8222-222222222222"
	store.flow = flow
	return flow.ID, nil
}

func (store *fakeStore) ConsumeFlow(_ context.Context, flowID string, nonceHash string) (Flow, error) {
	if store.used || flowID != store.flow.ID || nonceHash != store.flow.NonceHash {
		return Flow{}, newFailure("invalid_oauth_state", http.StatusBadRequest)
	}
	store.used = true
	return store.flow, nil
}

func (store *fakeStore) SaveConnection(_ context.Context, input SaveConnectionInput) (string, error) {
	store.saved = append(store.saved, input)
	return "connection-1", nil
}

func (store *fakeStore) ListConnections(context.Context, string) ([]Connection, error) {
	return []Connection{{ID: "connection-1", Provider: ProviderMeta, GrantedScopes: []string{"ads_read"}, Assets: []Asset{}}}, nil
}

func (store *fakeStore) UpdateSelection(context.Context, string, string, []string) error { return nil }

func (store *fakeStore) LoadSyncTarget(context.Context, string, string) (SyncTarget, error) {
	return store.target, nil
}

func (store *fakeStore) MarkSyncResult(_ context.Context, _ string, _ string, status string, lastError string) error {
	store.marked = status + "|" + lastError
	return nil
}

func (store *fakeStore) DeleteConnection(_ context.Context, _ string, connectionID string) error {
	store.deleted = append(store.deleted, connectionID)
	return nil
}

type recordedGraph struct {
	*httptest.Server
	methods []string
	paths   []string
	bodies  map[string]string
}

func newGraph(t *testing.T) *recordedGraph {
	t.Helper()
	graph := &recordedGraph{bodies: map[string]string{
		"/v25.0/oauth/access_token": `{"access_token":"token-value","expires_in":5184000}`,
		"/v25.0/me":                 `{"id":"900","name":"Pessoa Teste"}`,
		"/v25.0/me/permissions":     `{"data":[{"permission":"ads_read","status":"granted"},{"permission":"read_insights","status":"declined"}]}`,
		"/v25.0/me/adaccounts":      `{"data":[{"account_id":"1404","name":"Conta","currency":"BRL"}]}`,
		"/v25.0/me/accounts":        `{"data":[{"id":"503","name":"Pagina","instagram_business_account":{"id":"178","username":"perfil"}}]}`,
	}}
	graph.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		graph.methods = append(graph.methods, r.Method)
		graph.paths = append(graph.paths, r.URL.Path)
		body, ok := graph.bodies[r.URL.Path]
		if !ok {
			t.Errorf("unexpected Graph call %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(graph.Close)
	return graph
}

func newTestService(store Store, graphURL string, organizations ...string) *Service {
	return newTestServiceWithSyncer(store, nil, graphURL, organizations...)
}

func newTestServiceWithSyncer(store Store, syncer Syncer, graphURL string, organizations ...string) *Service {
	return NewService(Config{
		EnabledOrganizations: organizations,
		AllowedOrigins:       []string{"https://crm.example.com"},
		Meta: MetaConfig{
			AppID: "123", AppSecret: "secret-value", GraphVersion: "v25.0", GraphBaseURL: graphURL,
			CallbackURL: "https://api.example.com/v1/public/marketing/oauth/meta/callback",
		},
	}, store, syncer)
}

func startFlow(t *testing.T, service *Service) string {
	t.Helper()
	authURL, err := service.StartMeta(context.Background(), testOrganizationID, "user-1", "https://crm.example.com/settings")
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	parsed, err := url.Parse(authURL)
	if err != nil {
		t.Fatal(err)
	}
	return parsed.Query().Get("state")
}

func TestCompleteOnlyUsesGetAndStoresReadOnlyLogin(t *testing.T) {
	graph, store := newGraph(t), &fakeStore{}
	service := newTestService(store, graph.URL, testOrganizationID)
	returnURL, err := service.CompleteMeta(context.Background(), startFlow(t, service), "code-1", "")
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if returnURL != "https://crm.example.com/settings" {
		t.Fatalf("return url = %q", returnURL)
	}
	for index, method := range graph.methods {
		if method != http.MethodGet {
			t.Errorf("%s %s: Marketing must only send GET", method, graph.paths[index])
		}
		if strings.Contains(graph.paths[index], "subscribed_apps") {
			t.Errorf("called %s", graph.paths[index])
		}
	}
	if len(store.saved) != 1 {
		t.Fatalf("saved = %d", len(store.saved))
	}
	saved := store.saved[0]
	if saved.AccessToken != "token-value" || saved.ExternalUserID != "900" || saved.TokenExpiresAt == nil {
		t.Errorf("saved = %+v", saved)
	}
	if len(saved.GrantedScopes) != 1 || saved.GrantedScopes[0] != "ads_read" {
		t.Errorf("scopes = %v", saved.GrantedScopes)
	}
	if len(saved.Assets) != 3 {
		t.Errorf("assets = %+v", saved.Assets)
	}
}

func TestAssetDiscoveryNeverAsksForPageToken(t *testing.T) {
	var query string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v25.0/me/accounts" {
			query = r.URL.Query().Get("fields")
		}
		_, _ = io.WriteString(w, `{"data":[]}`)
	}))
	defer server.Close()
	client := newMetaClient(MetaConfig{AppSecret: "s", GraphVersion: "v25.0", GraphBaseURL: server.URL}, nil)
	if _, err := client.fetchAssets(context.Background(), "token"); err != nil {
		t.Fatal(err)
	}
	if query == "" || strings.Contains(query, "access_token") {
		t.Fatalf("fields = %q", query)
	}
}

func TestStateIsSingleUseAndInvalidStateNeverCallsGraph(t *testing.T) {
	graph, store := newGraph(t), &fakeStore{}
	service := newTestService(store, graph.URL, testOrganizationID)
	state := startFlow(t, service)
	flowID, _, _ := strings.Cut(state, ".")
	returnURL, err := service.CompleteMeta(context.Background(), flowID+".wrong", "code", "")
	if err == nil || returnURL != "" {
		t.Fatalf("wrong nonce accepted: %q %v", returnURL, err)
	}
	if len(graph.paths) != 0 {
		t.Fatalf("Graph was called: %v", graph.paths)
	}
	if _, err := service.CompleteMeta(context.Background(), state, "code", ""); err != nil {
		t.Fatalf("first use: %v", err)
	}
	if _, err := service.CompleteMeta(context.Background(), state, "code", ""); err == nil {
		t.Fatal("replayed state was accepted")
	}
}

func TestCancelledLoginReturnsToCRMWithoutSaving(t *testing.T) {
	graph, store := newGraph(t), &fakeStore{}
	service := newTestService(store, graph.URL, testOrganizationID)
	returnURL, err := service.CompleteMeta(context.Background(), startFlow(t, service), "", "access_denied")
	if failureOf(err).Code != "meta_login_cancelled" || returnURL == "" {
		t.Fatalf("got %q %v", returnURL, err)
	}
	if len(store.saved) != 0 || len(graph.paths) != 0 {
		t.Fatalf("saved %d, calls %v", len(store.saved), graph.paths)
	}
}

func TestDisconnectNeverCallsProvider(t *testing.T) {
	graph, store := newGraph(t), &fakeStore{}
	service := newTestService(store, graph.URL, testOrganizationID)
	if err := service.Disconnect(context.Background(), testOrganizationID, "connection-1"); err != nil {
		t.Fatal(err)
	}
	if len(graph.paths) != 0 {
		t.Fatalf("provider called: %v", graph.paths)
	}
	if len(store.deleted) != 1 {
		t.Fatalf("deleted = %v", store.deleted)
	}
}

func TestFlagBlocksOtherOrganizations(t *testing.T) {
	service := newTestService(&fakeStore{}, "http://127.0.0.1:1", "33333333-3333-4333-8333-333333333333")
	_, err := service.StartMeta(context.Background(), testOrganizationID, "user-1", "https://crm.example.com/x")
	if failureOf(err).Code != "marketing_connections_disabled" {
		t.Fatalf("start: %v", err)
	}
	if err := service.Disconnect(context.Background(), testOrganizationID, "c"); failureOf(err).Code != "marketing_connections_disabled" {
		t.Fatalf("disconnect: %v", err)
	}
	connections, err := service.List(context.Background(), testOrganizationID)
	if err != nil || len(connections) != 0 {
		t.Fatalf("list: %v %v", connections, err)
	}
}

func TestReturnURLMustBeAnAllowedOrigin(t *testing.T) {
	service := newTestService(&fakeStore{}, "http://127.0.0.1:1", testOrganizationID)
	for _, value := range []string{
		"https://evil.example.com/x", "javascript:alert(1)", "//crm.example.com/x",
		"https://crm.example.com@evil.example.com/", "",
	} {
		if _, err := service.StartMeta(context.Background(), testOrganizationID, "u", value); failureOf(err).Code != "invalid_return_url" {
			t.Errorf("%q: %v", value, err)
		}
	}
}

func TestAuthorizationURLUsesConfigIDWhenSet(t *testing.T) {
	client := newMetaClient(MetaConfig{AppID: "1", GraphVersion: "v25.0", LoginConfigID: "77", CallbackURL: "https://a.example/c"}, nil)
	parsed, err := url.Parse(client.authorizationURL("state"))
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Query().Get("config_id") != "77" || parsed.Query().Has("scope") {
		t.Fatalf("query = %v", parsed.Query())
	}
}

func TestGraphErrorsBecomeCodesWithoutSecrets(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"error":{"code":190,"message":"secret-value leaked"}}`)
	}))
	defer server.Close()
	client := newMetaClient(MetaConfig{AppSecret: "secret-value", GraphVersion: "v25.0", GraphBaseURL: server.URL}, nil)
	_, err := client.fetchIdentity(context.Background(), "token")
	if failureOf(err).Code != "meta_access_token_invalid" || strings.Contains(err.Error(), "secret-value") {
		t.Fatalf("err = %v", err)
	}
}

func TestHandlerListHasNoTokenField(t *testing.T) {
	service := newTestService(&fakeStore{}, "http://127.0.0.1:1", testOrganizationID)
	request := httptest.NewRequest(http.MethodGet, "/v1/marketing/connections", nil)
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{OrganizationID: testOrganizationID, UserID: "u"}))
	recorder := httptest.NewRecorder()
	NewHandler(service).List(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	body := recorder.Body.String()
	if strings.Contains(body, "token_secret") || strings.Contains(body, "access_token") {
		t.Fatalf("body = %s", body)
	}
	var payload struct {
		Enabled     bool `json:"enabled"`
		Connections []struct {
			MissingScopes []string `json:"missing_scopes"`
		} `json:"connections"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.Enabled || len(payload.Connections[0].MissingScopes) != len(metaLoginScopes)-1 {
		t.Fatalf("payload = %+v", payload)
	}
}

func TestCallbackRedirectCarriesOnlyStatusAndCode(t *testing.T) {
	location, err := callbackRedirect("https://crm.example.com/settings?tab=x", newFailure("meta_request_failed", 502, io.EOF))
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.Parse(location)
	query := parsed.Query()
	if query.Get("marketing_connection") != "error" || query.Get("marketing_error") != "meta_request_failed" || query.Get("tab") != "x" || len(query) != 3 {
		t.Fatalf("location = %s", location)
	}
}

type fakeSyncer struct {
	input  SyncInput
	result SyncResult
}

func (syncer *fakeSyncer) Sync(_ context.Context, input SyncInput) (SyncResult, error) {
	syncer.input = input
	return syncer.result, nil
}

func TestSyncRequiresChosenAssets(t *testing.T) {
	service := newTestServiceWithSyncer(&fakeStore{}, &fakeSyncer{}, "http://127.0.0.1:1", testOrganizationID)
	_, err := service.Sync(context.Background(), testOrganizationID, "u", "c", "2026-10-01", "2026-10-31")
	if failureOf(err).Code != "marketing_no_assets_selected" {
		t.Fatalf("err = %v", err)
	}
}

func TestSyncOnlyChangesThisConnectionHealth(t *testing.T) {
	store := &fakeStore{target: SyncTarget{AccessToken: "t", AdAccounts: []string{"1"}}}
	syncer := &fakeSyncer{result: SyncResult{Errors: []string{"act_1:meta_access_token_invalid"}}}
	service := newTestServiceWithSyncer(store, syncer, "http://127.0.0.1:1", testOrganizationID)
	if _, err := service.Sync(context.Background(), testOrganizationID, "u", "c", "2026-10-01", "2026-10-31"); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(store.marked, "expired|") {
		t.Fatalf("marked = %q", store.marked)
	}
	if syncer.input.OrganizationID != testOrganizationID || syncer.input.AccessToken != "t" {
		t.Fatalf("input = %+v", syncer.input)
	}
}
