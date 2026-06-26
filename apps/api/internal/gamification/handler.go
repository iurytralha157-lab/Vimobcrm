package gamification

import (
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Handler struct {
	repo Repository
}

func NewHandler(repo Repository) Handler {
	return Handler{repo: repo}
}

func (handler Handler) Overview(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	overview, err := handler.repo.Overview(r.Context(), tenantContext)
	if err != nil {
		httpserver.WriteError(w, r, http.StatusInternalServerError, "gamification_overview_failed", "Unable to load gamification overview.")
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[Overview]{Data: overview})
}
