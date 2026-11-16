package homenotices

import (
	"context"
	"net/http"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Store interface {
	ListNotices(context.Context, tenant.Context) ([]Notice, error)
}

type Handler struct {
	store Store
}

func NewHandler(store Store) Handler {
	return Handler{store: store}
}

func (handler Handler) Notices(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || strings.TrimSpace(tenantContext.OrganizationID) == "" {
		httpserver.WriteError(
			w,
			r,
			http.StatusForbidden,
			"organization_required",
			"Organization context is required.",
		)
		return
	}

	notices, err := handler.store.ListNotices(r.Context(), tenantContext)
	if err != nil {
		httpserver.WriteError(w, r, http.StatusInternalServerError, "home_notices_failed", "Unable to load home notices.")
		return
	}
	if notices == nil {
		notices = []Notice{}
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]Notice]{Data: notices})
}
