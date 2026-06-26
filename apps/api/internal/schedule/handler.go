package schedule

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

func (handler Handler) ListEvents(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	filter, err := ParseListFilter(r.URL.Query())
	if err != nil {
		writeScheduleError(w, r, err)
		return
	}

	events, err := handler.repo.List(r.Context(), tenantContext, filter)
	if err != nil {
		writeScheduleError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]Event]{Data: events})
}

func (handler Handler) CreateEvent(w http.ResponseWriter, r *http.Request) {
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

	input, err := request.Validate(tenantContext.UserID)
	if err != nil {
		writeScheduleError(w, r, err)
		return
	}

	event, err := handler.repo.Create(r.Context(), tenantContext, input)
	if err != nil {
		writeScheduleError(w, r, err)
		return
	}

	handler.publishScheduleEvent(tenantContext, "schedule.event.created", event.ID, event.LeadID, map[string]any{
		"eventId": event.ID,
		"leadId":  event.LeadID,
		"userId":  event.UserID,
		"status":  event.Status,
	})
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[Event]{Data: event})
}

func (handler Handler) UpdateEvent(w http.ResponseWriter, r *http.Request) {
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
		writeScheduleError(w, r, err)
		return
	}

	event, err := handler.repo.Update(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeScheduleError(w, r, err)
		return
	}

	handler.publishScheduleEvent(tenantContext, "schedule.event.updated", event.ID, event.LeadID, map[string]any{
		"eventId": event.ID,
		"leadId":  event.LeadID,
		"userId":  event.UserID,
		"status":  event.Status,
	})
	httpserver.WriteJSON(w, http.StatusOK, Envelope[Event]{Data: event})
}

func (handler Handler) CompleteEvent(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request CompleteRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	event, err := handler.repo.Complete(r.Context(), tenantContext, r.PathValue("id"), request.Status)
	if err != nil {
		writeScheduleError(w, r, err)
		return
	}

	handler.publishScheduleEvent(tenantContext, "schedule.event.completed", event.ID, event.LeadID, map[string]any{
		"eventId": event.ID,
		"leadId":  event.LeadID,
		"userId":  event.UserID,
		"status":  event.Status,
	})
	httpserver.WriteJSON(w, http.StatusOK, Envelope[Event]{Data: event})
}

func (handler Handler) DeleteEvent(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	event, err := handler.repo.Delete(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeScheduleError(w, r, err)
		return
	}

	handler.publishScheduleEvent(tenantContext, "schedule.event.deleted", event.ID, event.LeadID, map[string]any{
		"eventId": event.ID,
		"leadId":  event.LeadID,
		"userId":  event.UserID,
	})
	httpserver.WriteJSON(w, http.StatusOK, Envelope[Event]{Data: event})
}

func (handler Handler) ListComments(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	comments, err := handler.repo.ListComments(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeScheduleError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]Comment]{Data: comments})
}

func (handler Handler) AddComment(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request AddCommentRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	content, err := request.Validate()
	if err != nil {
		writeScheduleError(w, r, err)
		return
	}

	comment, err := handler.repo.AddComment(r.Context(), tenantContext, r.PathValue("id"), content)
	if err != nil {
		writeScheduleError(w, r, err)
		return
	}

	handler.publishScheduleEvent(tenantContext, "schedule.comment.created", comment.EventID, nil, map[string]any{
		"eventId":   comment.EventID,
		"commentId": comment.ID,
	})
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[Comment]{Data: comment})
}

func (handler Handler) ListAssignees(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	assignees, err := handler.repo.ListAssignees(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeScheduleError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]AssigneeUser]{Data: assignees})
}

func (handler Handler) AddAssignee(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request AddAssigneeRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	userID, err := request.Validate()
	if err != nil {
		writeScheduleError(w, r, err)
		return
	}

	assignees, err := handler.repo.AddAssignee(r.Context(), tenantContext, r.PathValue("id"), userID)
	if err != nil {
		writeScheduleError(w, r, err)
		return
	}

	handler.publishScheduleEvent(tenantContext, "schedule.assignee.added", r.PathValue("id"), nil, map[string]any{
		"eventId": r.PathValue("id"),
		"userId":  userID,
	})
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[[]AssigneeUser]{Data: assignees})
}

func (handler Handler) RemoveAssignee(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	assignees, err := handler.repo.RemoveAssignee(r.Context(), tenantContext, r.PathValue("id"), r.PathValue("userId"))
	if err != nil {
		writeScheduleError(w, r, err)
		return
	}

	handler.publishScheduleEvent(tenantContext, "schedule.assignee.removed", r.PathValue("id"), nil, map[string]any{
		"eventId": r.PathValue("id"),
		"userId":  r.PathValue("userId"),
	})
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]AssigneeUser]{Data: assignees})
}

func (handler Handler) publishScheduleEvent(tenantContext tenant.Context, eventType string, eventID string, leadID *string, data map[string]any) {
	if data == nil {
		data = map[string]any{}
	}
	data["eventId"] = eventID
	if leadID != nil {
		data["leadId"] = *leadID
	}
	handler.publisher.Publish(realtime.NewEvent(eventType, tenantContext.OrganizationID, tenantContext.UserID, data))
}

func (handler Handler) ShowCapabilities(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	capabilities, err := handler.repo.Capabilities(r.Context(), tenantContext)
	if err != nil {
		writeScheduleError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[Capabilities]{Data: capabilities})
}

func writeScheduleError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput), errors.Is(err, ErrNoScheduleChanges):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_schedule_input", err.Error())
	case errors.Is(err, ErrInvalidReference):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_schedule_reference", "One or more schedule references do not belong to this organization.")
	case errors.Is(err, ErrEventNotFound), errors.Is(err, ErrCommentNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "schedule_not_found", "Schedule resource was not found.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "schedule_operation_failed", "Unable to complete schedule operation.")
	}
}
