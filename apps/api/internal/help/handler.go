package help

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Handler struct {
	store Store
}

func NewHandler(store Store) Handler {
	return Handler{store: store}
}

func (handler Handler) ListArticles(w http.ResponseWriter, r *http.Request) {
	if !hasAuthenticatedHelpContext(w, r) {
		return
	}
	handler.listArticles(w, r, AudienceAuthenticated)
}

func (handler Handler) ShowArticle(w http.ResponseWriter, r *http.Request) {
	if !hasAuthenticatedHelpContext(w, r) {
		return
	}
	handler.showArticle(w, r, AudienceAuthenticated)
}

func (handler Handler) SearchArticles(w http.ResponseWriter, r *http.Request) {
	if !hasAuthenticatedHelpContext(w, r) {
		return
	}

	var request SearchRequest
	if !decodeHelpJSON(w, r, &request) {
		return
	}
	query, limit, err := request.normalized()
	if err != nil {
		writeHelpError(w, r, err)
		return
	}

	articles, err := handler.store.SearchArticles(
		r.Context(),
		AudienceAuthenticated,
		query,
		limit,
	)
	if err != nil {
		writeHelpError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]ArticleSummary]{Data: articles})
}

func (handler Handler) ListPublicArticles(w http.ResponseWriter, r *http.Request) {
	handler.listArticles(w, r, AudiencePublic)
}

func (handler Handler) ShowPublicArticle(w http.ResponseWriter, r *http.Request) {
	handler.showArticle(w, r, AudiencePublic)
}

func (handler Handler) listArticles(w http.ResponseWriter, r *http.Request, audience Audience) {
	articles, err := handler.store.ListArticles(r.Context(), audience)
	if err != nil {
		writeHelpError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]ArticleSummary]{Data: articles})
}

func (handler Handler) showArticle(w http.ResponseWriter, r *http.Request, audience Audience) {
	slug, ok := normalizeSlug(r.PathValue("slug"))
	if !ok {
		writeHelpError(w, r, ErrInvalidInput)
		return
	}

	article, err := handler.store.ShowArticle(r.Context(), audience, slug)
	if err != nil {
		writeHelpError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[ArticleDetail]{Data: article})
}

func hasAuthenticatedHelpContext(w http.ResponseWriter, r *http.Request) bool {
	context, ok := tenant.FromContext(r.Context())
	if !ok || strings.TrimSpace(context.UserID) == "" {
		httpserver.WriteError(
			w,
			r,
			http.StatusUnauthorized,
			"unauthorized",
			"Missing authenticated user.",
		)
		return false
	}
	return true
}

func decodeHelpJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	defer r.Body.Close()
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		httpserver.WriteError(
			w,
			r,
			http.StatusBadRequest,
			"invalid_json",
			"Request body must contain one JSON object.",
		)
		return false
	}
	return true
}

func writeHelpError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(
			w,
			r,
			http.StatusBadRequest,
			"invalid_help_input",
			"Help request input is invalid.",
		)
	case errors.Is(err, ErrNotFound):
		httpserver.WriteError(
			w,
			r,
			http.StatusNotFound,
			"help_article_not_found",
			"Help article was not found.",
		)
	default:
		httpserver.WriteError(
			w,
			r,
			http.StatusInternalServerError,
			"help_operation_failed",
			"Unable to load help content.",
		)
	}
}
