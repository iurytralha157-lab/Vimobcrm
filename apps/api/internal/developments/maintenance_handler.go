package developments

import (
	"encoding/json"
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
)

func (handler Handler) UpdateDevelopment(w http.ResponseWriter, r *http.Request) {
	handler.updateMaintenance(w, r, maintenanceDevelopment, r.PathValue("id"))
}
func (handler Handler) UpdatePhase(w http.ResponseWriter, r *http.Request) {
	handler.updateMaintenance(w, r, maintenancePhase, r.PathValue("entityId"))
}
func (handler Handler) UpdateBuilding(w http.ResponseWriter, r *http.Request) {
	handler.updateMaintenance(w, r, maintenanceBuilding, r.PathValue("entityId"))
}
func (handler Handler) UpdateFloorPlan(w http.ResponseWriter, r *http.Request) {
	handler.updateMaintenance(w, r, maintenanceFloorPlan, r.PathValue("entityId"))
}
func (handler Handler) updateMaintenance(w http.ResponseWriter, r *http.Request, kind maintenanceKind, entityID string) {
	actor, ok := developmentTenant(w, r)
	if !ok {
		return
	}
	var input MaintenanceInput
	if err := httpserver.DecodeJSON(w, r, &input, developmentBodyLimit); err != nil {
		return
	}
	updated, err := handler.repo.UpdateMaintenance(r.Context(), actor, r.PathValue("id"), entityID, kind, input)
	if err != nil {
		writeDevelopmentError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]json.RawMessage{"data": updated})
}
