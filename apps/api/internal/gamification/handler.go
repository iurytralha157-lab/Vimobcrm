package gamification

import (
	"encoding/json"
	"errors"
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
	tenantContext, ok := gamificationOrganizationContext(w, r)
	if !ok {
		return
	}

	overview, err := handler.repo.Overview(r.Context(), tenantContext)
	if err != nil {
		writeGamificationError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[Overview]{Data: overview})
}

func (handler Handler) AdminSnapshot(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := gamificationOrganizationContext(w, r)
	if !ok {
		return
	}
	snapshot, err := handler.repo.AdminSnapshot(r.Context(), tenantContext)
	if err != nil {
		writeGamificationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[AdminSnapshot]{Data: snapshot})
}

func (handler Handler) UpsertRule(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := gamificationOrganizationContext(w, r)
	if !ok {
		return
	}
	var request RuleRequest
	if !decodeGamificationJSON(w, r, &request) {
		return
	}
	rule, err := handler.repo.UpsertRule(r.Context(), tenantContext, r.PathValue("actionType"), request)
	if err != nil {
		writeGamificationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[Rule]{Data: rule})
}

func (handler Handler) SetParticipant(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := gamificationOrganizationContext(w, r)
	if !ok {
		return
	}
	var request ParticipantRequest
	if !decodeGamificationJSON(w, r, &request) {
		return
	}
	participant, err := handler.repo.SetParticipant(r.Context(), tenantContext, r.PathValue("userId"), request)
	if err != nil {
		writeGamificationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[Participant]{Data: participant})
}

func (handler Handler) CreateMission(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := gamificationOrganizationContext(w, r)
	if !ok {
		return
	}
	var request MissionRequest
	if !decodeGamificationJSON(w, r, &request) {
		return
	}
	mission, err := handler.repo.CreateMission(r.Context(), tenantContext, request)
	if err != nil {
		writeGamificationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[Mission]{Data: mission})
}

func (handler Handler) UpdateMission(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := gamificationOrganizationContext(w, r)
	if !ok {
		return
	}
	var request MissionRequest
	if !decodeGamificationJSON(w, r, &request) {
		return
	}
	mission, err := handler.repo.UpdateMission(r.Context(), tenantContext, r.PathValue("id"), request)
	if err != nil {
		writeGamificationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[Mission]{Data: mission})
}

func (handler Handler) DeleteMission(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := gamificationOrganizationContext(w, r)
	if !ok {
		return
	}
	if err := handler.repo.DeleteMission(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeGamificationError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) CreateManualEntry(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := gamificationOrganizationContext(w, r)
	if !ok {
		return
	}
	var request ManualEntryRequest
	if !decodeGamificationJSON(w, r, &request) {
		return
	}
	entry, err := handler.repo.CreateManualEntry(r.Context(), tenantContext, request)
	if err != nil {
		writeGamificationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[ManualEntry]{Data: entry})
}

func (handler Handler) DecideManualEntry(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := gamificationOrganizationContext(w, r)
	if !ok {
		return
	}
	var request ManualEntryDecisionRequest
	if !decodeGamificationJSON(w, r, &request) {
		return
	}
	entry, err := handler.repo.DecideManualEntry(r.Context(), tenantContext, r.PathValue("id"), request)
	if err != nil {
		writeGamificationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[ManualEntry]{Data: entry})
}

func (handler Handler) ResetSeason(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := gamificationOrganizationContext(w, r)
	if !ok {
		return
	}
	var request SeasonRequest
	if !decodeGamificationJSON(w, r, &request) {
		return
	}
	season, err := handler.repo.ResetSeason(r.Context(), tenantContext, request)
	if err != nil {
		writeGamificationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[Season]{Data: season})
}

func gamificationOrganizationContext(w http.ResponseWriter, r *http.Request) (tenant.Context, bool) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return tenant.Context{}, false
	}
	return tenantContext, true
}

func decodeGamificationJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	defer r.Body.Close()
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return false
	}
	return true
}

func writeGamificationError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_gamification_input", "Gamification input is invalid.")
	case errors.Is(err, ErrNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "gamification_not_found", "Gamification resource was not found.")
	case errors.Is(err, ErrNotReady):
		httpserver.WriteError(w, r, http.StatusConflict, "gamification_schema_not_ready", "Gamification admin schema is not ready.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "gamification_operation_failed", "Unable to complete gamification operation.")
	}
}
