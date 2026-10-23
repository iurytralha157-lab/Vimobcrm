package leads

import (
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// This contract identifies wire-format and revision support in this binary. It
// does not grant access to a lead: MoveStage still authorizes the locked record,
// checks its exact revision and validates destination/commercial rules.
const moveStageRevisionContract = "revision-v1"

func (handler Handler) ShowMoveStageCapabilities(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	if _, ok := tenant.RequireOrganizationContext(w, r); !ok {
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]any{
		"data": map[string]string{"contract": moveStageRevisionContract},
	})
}
