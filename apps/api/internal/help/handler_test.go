package help

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type fakeStore struct {
	listAudience   Audience
	showAudience   Audience
	showSlug       string
	searchAudience Audience
	searchQuery    string
	searchLimit    int
	listResult     []ArticleSummary
	showResult     ArticleDetail
	searchResult   []ArticleSummary
	listErr        error
	showErr        error
	searchErr      error
}

func (store *fakeStore) ListArticles(_ context.Context, audience Audience) ([]ArticleSummary, error) {
	store.listAudience = audience
	return store.listResult, store.listErr
}

func (store *fakeStore) ShowArticle(
	_ context.Context,
	audience Audience,
	slug string,
) (ArticleDetail, error) {
	store.showAudience = audience
	store.showSlug = slug
	return store.showResult, store.showErr
}

func (store *fakeStore) SearchArticles(
	_ context.Context,
	audience Audience,
	query string,
	limit int,
) ([]ArticleSummary, error) {
	store.searchAudience = audience
	store.searchQuery = query
	store.searchLimit = limit
	return store.searchResult, store.searchErr
}

func TestAuthenticatedHelpHandlersRequireTenantUser(t *testing.T) {
	store := &fakeStore{}
	handler := NewHandler(store)

	for name, invoke := range map[string]func(http.ResponseWriter, *http.Request){
		"list":   handler.ListArticles,
		"show":   handler.ShowArticle,
		"search": handler.SearchArticles,
	} {
		t.Run(name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/v1/help/articles", nil)
			response := httptest.NewRecorder()
			invoke(response, request)
			if response.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
			}
		})
	}
}

func TestListHandlersUseStrictVisibilityAudience(t *testing.T) {
	summary := validArticleSummary()
	store := &fakeStore{listResult: []ArticleSummary{summary}}
	handler := NewHandler(store)

	authRequest := authenticatedRequest(http.MethodGet, "/v1/help/articles", nil)
	authResponse := httptest.NewRecorder()
	handler.ListArticles(authResponse, authRequest)
	if authResponse.Code != http.StatusOK {
		t.Fatalf("authenticated list status = %d: %s", authResponse.Code, authResponse.Body.String())
	}
	if store.listAudience != AudienceAuthenticated {
		t.Fatalf("authenticated audience = %q", store.listAudience)
	}

	var payload struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.Unmarshal(authResponse.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	if len(payload.Data) != 1 {
		t.Fatalf("list payload = %#v", payload.Data)
	}
	if _, leaked := payload.Data[0]["content"]; leaked {
		t.Fatal("article summary leaked detail content")
	}

	publicRequest := httptest.NewRequest(
		http.MethodGet,
		"/v1/public/help/articles",
		nil,
	)
	publicResponse := httptest.NewRecorder()
	handler.ListPublicArticles(publicResponse, publicRequest)
	if publicResponse.Code != http.StatusOK {
		t.Fatalf("public list status = %d", publicResponse.Code)
	}
	if store.listAudience != AudiencePublic {
		t.Fatalf("public audience = %q", store.listAudience)
	}
}

func TestShowHandlersNormalizeSlugAndMapNotFound(t *testing.T) {
	detail := ArticleDetail{ArticleSummary: validArticleSummary(), Content: "Conteúdo"}
	store := &fakeStore{showResult: detail}
	handler := NewHandler(store)

	request := authenticatedRequest(http.MethodGet, "/v1/help/articles/CRIAR-UM-LEAD", nil)
	request.SetPathValue("slug", "CRIAR-UM-LEAD")
	response := httptest.NewRecorder()
	handler.ShowArticle(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("show status = %d: %s", response.Code, response.Body.String())
	}
	if store.showAudience != AudienceAuthenticated || store.showSlug != "criar-um-lead" {
		t.Fatalf("show call = audience %q, slug %q", store.showAudience, store.showSlug)
	}

	store.showErr = ErrNotFound
	publicRequest := httptest.NewRequest(
		http.MethodGet,
		"/v1/public/help/articles/privado",
		nil,
	)
	publicRequest.SetPathValue("slug", "privado")
	publicResponse := httptest.NewRecorder()
	handler.ShowPublicArticle(publicResponse, publicRequest)
	if publicResponse.Code != http.StatusNotFound {
		t.Fatalf("not-found status = %d", publicResponse.Code)
	}
	if store.showAudience != AudiencePublic {
		t.Fatalf("public detail audience = %q", store.showAudience)
	}
}

func TestSearchHandlerValidatesStrictBodyAndReturnsMultipleResults(t *testing.T) {
	store := &fakeStore{searchResult: []ArticleSummary{
		validArticleSummary(),
		{
			ID:               "20000000-0000-4000-8000-000000000002",
			Slug:             "mover-um-lead",
			Category:         "Leads",
			ModuleKey:        "pipeline",
			Title:            "Como mover um lead?",
			Summary:          "Mova o card entre etapas.",
			EstimatedMinutes: 2,
			DisplayOrder:     20,
			UpdatedAt:        time.Date(2026, time.July, 29, 12, 0, 0, 0, time.UTC),
		},
	}}
	handler := NewHandler(store)
	body := bytes.NewBufferString(`{"query":"  criar lead  ","limit":2}`)
	request := authenticatedRequest(http.MethodPost, "/v1/help/search", body)
	response := httptest.NewRecorder()
	handler.SearchArticles(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("search status = %d: %s", response.Code, response.Body.String())
	}
	if store.searchAudience != AudienceAuthenticated ||
		store.searchQuery != "criar lead" ||
		store.searchLimit != 2 {
		t.Fatalf(
			"search call = audience %q, query %q, limit %d",
			store.searchAudience,
			store.searchQuery,
			store.searchLimit,
		)
	}

	var payload struct {
		Data []ArticleSummary `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode search response: %v", err)
	}
	if len(payload.Data) != 2 {
		t.Fatalf("search results = %d", len(payload.Data))
	}

	for _, invalidBody := range []string{
		`{"query":"a","limit":2}`,
		`{"query":"lead","limit":0}`,
		`{"query":"lead","limit":13}`,
		`{"query":"lead","unknown":true}`,
		`{"query":"lead"} {"query":"agenda"}`,
	} {
		request := authenticatedRequest(
			http.MethodPost,
			"/v1/help/search",
			bytes.NewBufferString(invalidBody),
		)
		response := httptest.NewRecorder()
		handler.SearchArticles(response, request)
		if response.Code != http.StatusBadRequest {
			t.Errorf("body %s returned status %d", invalidBody, response.Code)
		}
	}
}

func TestHelpHandlerMapsRepositoryFailureWithoutLeakingDetails(t *testing.T) {
	store := &fakeStore{listErr: errors.New("database secret details")}
	handler := NewHandler(store)
	request := httptest.NewRequest(http.MethodGet, "/v1/public/help/articles", nil)
	response := httptest.NewRecorder()
	handler.ListPublicArticles(response, request)
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", response.Code)
	}
	if bytes.Contains(response.Body.Bytes(), []byte("database secret details")) {
		t.Fatal("internal repository error leaked to the response")
	}
}

func authenticatedRequest(method string, target string, body *bytes.Buffer) *http.Request {
	var request *http.Request
	if body == nil {
		request = httptest.NewRequest(method, target, nil)
	} else {
		request = httptest.NewRequest(method, target, body)
	}
	context := tenant.ContextWithTenant(request.Context(), tenant.Context{
		UserID:         "10000000-0000-4000-8000-000000000001",
		OrganizationID: "20000000-0000-4000-8000-000000000001",
	})
	return request.WithContext(context)
}

func validArticleSummary() ArticleSummary {
	return ArticleSummary{
		ID:               "10000000-0000-4000-8000-000000000001",
		Slug:             "criar-um-lead",
		Category:         "Leads",
		ModuleKey:        "pipeline",
		Title:            "Como criar um lead?",
		Summary:          "Cadastre uma oportunidade no Pipeline.",
		EstimatedMinutes: 3,
		DisplayOrder:     10,
		UpdatedAt:        time.Date(2026, time.July, 29, 12, 0, 0, 0, time.UTC),
	}
}
