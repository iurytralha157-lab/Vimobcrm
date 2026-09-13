package whatsapp

import (
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
)

func (handler Handler) ListSessionStatuses(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")

	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	result, err := handler.repo.ListSessionStatuses(r.Context(), tenantContext)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]SessionStatus]{
		Data: result.Statuses,
		Meta: result.Meta,
	})
}
