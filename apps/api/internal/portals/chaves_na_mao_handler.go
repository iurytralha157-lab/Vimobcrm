package portals

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (handler Handler) GetChavesNaMao(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.GetChavesNaMao(r.Context(), tenantContext)
	if errors.Is(err, ErrNotFound) {
		httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: nil})
		return
	}
	if err != nil {
		writePortalError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) SaveChavesNaMao(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	var request ChavesNaMaoSettingsRequest
	if err := httpserver.DecodeJSON(w, r, &request, maxPortalWebhookBody); err != nil {
		return
	}
	item, err := handler.repo.SaveChavesNaMao(r.Context(), tenantContext, request)
	if err != nil {
		writePortalError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) ActivateChavesNaMao(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.ActivateChavesNaMao(r.Context(), tenantContext)
	if err != nil {
		writePortalError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) PauseChavesNaMao(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.PauseChavesNaMao(r.Context(), tenantContext)
	if err != nil {
		writePortalError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) RegenerateChavesNaMaoFeedToken(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.RegenerateChavesNaMaoFeedToken(r.Context(), tenantContext)
	if err != nil {
		writePortalError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) ListChavesNaMaoPublications(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListChavesNaMaoPublications(r.Context(), tenantContext)
	if err != nil {
		writePortalError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) UpsertChavesNaMaoPublications(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	var request UpsertPublicationsRequest
	if err := httpserver.DecodeJSON(w, r, &request, maxPortalWebhookBody); err != nil {
		return
	}
	items, err := handler.repo.UpsertChavesNaMaoPublications(r.Context(), tenantContext, request)
	if err != nil {
		writePortalError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) ChavesNaMaoFeed(w http.ResponseWriter, r *http.Request) {
	token := cleanPathToken(r.PathValue("token"))
	body, err := handler.repo.BuildChavesNaMaoFeed(r.Context(), token)
	if err != nil {
		writePortalError(w, r, err)
		return
	}
	sum := sha256.Sum256(body)
	etag := fmt.Sprintf("\"%x\"", sum[:])
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, no-cache")
	if etagMatches(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}
