package homefocus

import (
	"errors"
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

func (handler Handler) List(w http.ResponseWriter, r *http.Request) {
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

	filter, err := normalizeFilter(r.URL.Query())
	if err != nil {
		writeHomeFocusError(w, r, err)
		return
	}
	items, err := handler.store.List(r.Context(), tenantContext, filter)
	if err != nil {
		writeHomeFocusError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]Item]{Data: items})
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

func writeHomeFocusError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_home_focus_input", "Home focus request input is invalid.")
	case errors.Is(err, ErrForbidden), errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to view this focus scope.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "home_focus_failed", "Unable to load operational focus.")
	}
}
