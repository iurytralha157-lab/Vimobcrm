package roundrobin

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

func (handler Handler) List(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	items, err := handler.repo.List(r.Context(), tenantContext)
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]RoundRobin{"data": items})
}

func (handler Handler) Create(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request CreateRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	item, err := handler.repo.Create(r.Context(), tenantContext, input)
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, map[string]RoundRobin{"data": item})
}

func (handler Handler) Update(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request UpdateRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	item, err := handler.repo.Update(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]RoundRobin{"data": item})
}

func (handler Handler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	if err := handler.repo.Delete(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) ListRules(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	var roundRobinID *string
	if value := r.PathValue("id"); value != "" {
		roundRobinID = &value
	} else if value := r.URL.Query().Get("roundRobinId"); value != "" {
		roundRobinID = &value
	}

	rules, err := handler.repo.ListRules(r.Context(), tenantContext, roundRobinID)
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]Rule{"data": rules})
}

func (handler Handler) CreateRule(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request RuleRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate(r.PathValue("id"))
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	rule, err := handler.repo.CreateRule(r.Context(), tenantContext, input)
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, map[string]Rule{"data": rule})
}

func (handler Handler) UpdateRule(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request UpdateRuleRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	rule, err := handler.repo.UpdateRule(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]Rule{"data": rule})
}

func (handler Handler) DeleteRule(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	if err := handler.repo.DeleteRule(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) AddMember(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request MemberRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	members, err := handler.repo.AddMember(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, map[string][]Member{"data": members})
}

func (handler Handler) UpdateMember(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request UpdateMemberRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	member, err := handler.repo.UpdateMember(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]Member{"data": member})
}

func (handler Handler) DeleteMember(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	if err := handler.repo.DeleteMember(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func writeRoundRobinError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_round_robin_input", err.Error())
	case errors.Is(err, ErrNoChanges):
		httpserver.WriteError(w, r, http.StatusBadRequest, "no_round_robin_changes", "No round-robin changes were provided.")
	case errors.Is(err, ErrInvalidReference):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_round_robin_reference", "One or more round-robin references do not belong to this organization.")
	case errors.Is(err, ErrConditionConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "round_robin_condition_conflict", err.Error())
	case errors.Is(err, ErrRoundRobinNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "round_robin_not_found", "Round-robin was not found.")
	case errors.Is(err, ErrRuleNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "round_robin_rule_not_found", "Round-robin rule was not found.")
	case errors.Is(err, ErrMemberNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "round_robin_member_not_found", "Round-robin member was not found.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "round_robin_operation_failed", "Unable to complete round-robin operation.")
	}
}
