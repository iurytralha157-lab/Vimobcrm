package leads

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Handler struct {
	repo      Repository
	publisher realtime.Publisher
}

func NewHandler(repo Repository, publishers ...realtime.Publisher) Handler {
	publisher := realtime.Publisher(realtime.NoopPublisher{})
	if len(publishers) > 0 && publishers[0] != nil {
		publisher = publishers[0]
	}
	return Handler{repo: repo, publisher: publisher}
}

func (handler Handler) List(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	filter, err := ParseListFilter(r.URL.Query())
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	response, err := handler.repo.List(r.Context(), tenantContext, filter)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, response)
}

func (handler Handler) Show(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	lead, err := handler.repo.Get(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]Lead{
		"data": lead,
	})
}

func (handler Handler) ShowConversationDetail(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	lead, err := handler.repo.GetConversationDetail(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]ConversationLeadDetail{
		"data": lead,
	})
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
		writeLeadError(w, r, err)
		return
	}

	result, err := handler.repo.Create(r.Context(), tenantContext, input)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	handler.publishLeadEvent(tenantContext, "lead.created", result.Lead.ID, map[string]any{
		"leadId":           result.Lead.ID,
		"pipelineId":       result.Lead.PipelineID,
		"stageId":          result.Lead.StageID,
		"assignedUserId":   result.Lead.AssignedUserID,
		"reentry":          result.Reentry,
		"assignedUserName": result.AssignedUserName,
	})
	httpserver.WriteJSON(w, http.StatusCreated, CreateResponse{
		Data:             result.Lead,
		Reentry:          result.Reentry,
		AssignedUserName: result.AssignedUserName,
	})
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
		writeLeadError(w, r, err)
		return
	}

	lead, err := handler.repo.Update(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	handler.publishLeadEvent(tenantContext, "lead.updated", lead.ID, map[string]any{
		"leadId":         lead.ID,
		"pipelineId":     lead.PipelineID,
		"stageId":        lead.StageID,
		"assignedUserId": lead.AssignedUserID,
	})
	httpserver.WriteJSON(w, http.StatusOK, map[string]Lead{
		"data": lead,
	})
}

func (handler Handler) MoveStage(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()

	var request MoveStageRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	lead, err := handler.repo.MoveStage(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	handler.publishLeadEvent(tenantContext, "lead.stage_moved", lead.ID, map[string]any{
		"leadId":     lead.ID,
		"pipelineId": lead.PipelineID,
		"stageId":    lead.StageID,
	})
	httpserver.WriteJSON(w, http.StatusOK, map[string]Lead{
		"data": lead,
	})
}

func (handler Handler) Assign(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()

	var request AssignRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	lead, err := handler.repo.Assign(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	handler.publishLeadEvent(tenantContext, "lead.assigned", lead.ID, map[string]any{
		"leadId":         lead.ID,
		"assignedUserId": lead.AssignedUserID,
	})
	httpserver.WriteJSON(w, http.StatusOK, map[string]Lead{
		"data": lead,
	})
}

func (handler Handler) RedistributeRoundRobin(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	result, err := handler.repo.RedistributeRoundRobin(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	handler.publishLeadEvent(tenantContext, "lead.redistributed", result.LeadID, map[string]any{
		"leadId":         result.LeadID,
		"pipelineId":     result.PipelineID,
		"stageId":        result.StageID,
		"assignedUserId": result.AssignedUserID,
		"roundRobinId":   result.RoundRobinID,
		"roundRobinUsed": result.RoundRobinUsed,
	})
	httpserver.WriteJSON(w, http.StatusOK, result)
}

func (handler Handler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	if err := handler.repo.Delete(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeLeadError(w, r, err)
		return
	}

	handler.publishLeadEvent(tenantContext, "lead.deleted", r.PathValue("id"), map[string]any{
		"leadId": r.PathValue("id"),
	})
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) AddTag(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()

	var request TagRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	if err := handler.repo.AddTag(r.Context(), tenantContext, r.PathValue("id"), input); err != nil {
		writeLeadError(w, r, err)
		return
	}

	handler.publishLeadEvent(tenantContext, "lead.tagged", r.PathValue("id"), map[string]any{
		"leadId": r.PathValue("id"),
		"tagId":  input.TagID,
	})
	httpserver.WriteJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

func (handler Handler) RemoveTag(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	input, err := (TagRequest{TagID: r.PathValue("tagId")}).Validate()
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	if err := handler.repo.RemoveTag(r.Context(), tenantContext, r.PathValue("id"), input); err != nil {
		writeLeadError(w, r, err)
		return
	}

	handler.publishLeadEvent(tenantContext, "lead.untagged", r.PathValue("id"), map[string]any{
		"leadId": r.PathValue("id"),
		"tagId":  input.TagID,
	})
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) publishLeadEvent(tenantContext tenant.Context, eventType string, leadID string, data map[string]any) {
	if data == nil {
		data = map[string]any{}
	}
	data["leadId"] = leadID
	handler.publisher.Publish(realtime.NewEvent(eventType, tenantContext.OrganizationID, tenantContext.UserID, data))
}

func writeLeadError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_lead_input", err.Error())
	case errors.Is(err, ErrNoLeadChanges):
		httpserver.WriteError(w, r, http.StatusBadRequest, "no_lead_changes", "No lead changes were provided.")
	case errors.Is(err, ErrTagAlreadyExists):
		httpserver.WriteError(w, r, http.StatusConflict, "tag_already_exists", "Tag is already attached to this lead.")
	case errors.Is(err, ErrInvalidReference):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_lead_reference", "One or more lead references do not belong to this organization.")
	case errors.Is(err, ErrLeadNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "lead_not_found", "Lead was not found.")
	case errors.Is(err, ErrStorageNotConfigured):
		httpserver.WriteError(w, r, http.StatusInternalServerError, "lead_storage_not_configured", "Lead storage is not configured.")
	case errors.Is(err, ErrStorageOperation):
		httpserver.WriteError(w, r, http.StatusBadGateway, "lead_storage_failed", "Lead storage operation failed.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "lead_operation_failed", "Unable to complete lead operation.")
	}
}
