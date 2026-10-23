package stageconfig

import (
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (handler Handler) CreateInactivityAutomation(w http.ResponseWriter, r *http.Request) {
	handler.saveInactivityAutomation(w, r, true)
}

func (handler Handler) UpdateInactivityAutomation(w http.ResponseWriter, r *http.Request) {
	handler.saveInactivityAutomation(w, r, false)
}

func (handler Handler) saveInactivityAutomation(w http.ResponseWriter, r *http.Request, create bool) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	var request StageInactivityRequest
	if err := httpserver.DecodeJSON(w, r, &request, 16<<10); err != nil {
		return
	}
	input, err := request.Validate(create)
	if err != nil {
		writeStageConfigError(w, r, err)
		return
	}
	automationID := r.PathValue("id")
	if create {
		automationID = ""
	}
	automation, err := handler.repo.SaveInactivityAutomation(r.Context(), tenantContext, automationID, input)
	if err != nil {
		writeStageConfigError(w, r, err)
		return
	}
	status := http.StatusOK
	if create {
		status = http.StatusCreated
	}
	httpserver.WriteJSON(w, status, Envelope[StageAutomation]{Data: automation})
}
