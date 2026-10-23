package leads

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (handler Handler) ClaimQueuePool(w http.ResponseWriter, r *http.Request) {
	actor, ok := tenant.FromContext(r.Context())
	if !ok || actor.OrganizationID == "" || actor.UserID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}
	defer r.Body.Close()
	var request ClaimQueuePoolRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body must contain one object.")
		return
	}
	input, err := request.validate(r.Header.Get("Idempotency-Key"))
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	lead, changed, err := handler.repo.ClaimQueuePool(r.Context(), actor, r.PathValue("id"), input)
	if err != nil {
		if errors.Is(err, ErrQueuePoolConflict) {
			httpserver.WriteError(w, r, http.StatusConflict, "queue_pool_changed", "Este lead saiu do bolsão ou mudou em outra sessão. Atualize a lista.")
			return
		}
		writeLeadError(w, r, err)
		return
	}
	if changed {
		handler.publishLeadEvent(actor, "lead.assigned", lead.ID, map[string]any{"assignedUserId": lead.AssignedUserID})
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]Lead{"data": lead})
}
