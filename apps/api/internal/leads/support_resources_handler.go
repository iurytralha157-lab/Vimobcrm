package leads

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (handler Handler) ListContacts(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	filter, err := ParseContactListFilter(r.URL.Query())
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	contacts, err := handler.repo.ListContacts(r.Context(), tenantContext, filter)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]Contact{"data": contacts})
}

func (handler Handler) ListTags(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	tags, err := handler.repo.ListTags(r.Context(), tenantContext)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]Tag{"data": tags})
}

func (handler Handler) CreateTag(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	request, ok := decodeJSON[TagMutationRequest](w, r, 1<<16)
	if !ok {
		return
	}
	input, err := request.Validate()
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	tag, err := handler.repo.CreateTag(r.Context(), tenantContext, input)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, map[string]Tag{"data": tag})
}

func (handler Handler) UpdateTag(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	request, ok := decodeJSON[TagMutationRequest](w, r, 1<<16)
	if !ok {
		return
	}
	input, err := request.Validate()
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	tag, err := handler.repo.UpdateTag(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]Tag{"data": tag})
}

func (handler Handler) DeleteTag(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	if err := handler.repo.DeleteTag(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeLeadError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) ListActivities(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	activities, err := handler.repo.ListActivities(r.Context(), tenantContext, r.URL.Query().Get("leadId"), limit)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string][]Activity{"data": activities})
}

func (handler Handler) CreateActivity(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	request, ok := decodeJSON[ActivityCreateRequest](w, r, 1<<18)
	if !ok {
		return
	}
	input, err := request.Validate()
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	activity, err := handler.repo.CreateActivity(r.Context(), tenantContext, input)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, map[string]Activity{"data": activity})
}

func (handler Handler) ShowLeadMeta(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	meta, err := handler.repo.GetLeadMeta(r.Context(), tenantContext, r.URL.Query().Get("leadId"))
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]*LeadMeta{"data": meta})
}

func (handler Handler) ListLeadAttachments(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	attachments, err := handler.repo.ListLeadAttachments(r.Context(), tenantContext, r.URL.Query().Get("leadId"))
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string][]LeadAttachment{"data": attachments})
}

func (handler Handler) CreateLeadAttachment(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	request, ok := decodeJSON[LeadAttachmentCreateRequest](w, r, 1<<20)
	if !ok {
		return
	}
	input, err := request.Validate()
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	attachment, err := handler.repo.CreateLeadAttachment(r.Context(), tenantContext, input)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, map[string]LeadAttachment{"data": attachment})
}

func (handler Handler) ListLeadTasks(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	tasks, err := handler.repo.ListLeadTasks(r.Context(), tenantContext, r.URL.Query().Get("leadId"))
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string][]LeadTask{"data": tasks})
}

func (handler Handler) CreateLeadTask(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	request, ok := decodeJSON[LeadTaskCreateRequest](w, r, 1<<18)
	if !ok {
		return
	}
	input, err := request.Validate()
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	task, err := handler.repo.CreateLeadTask(r.Context(), tenantContext, input)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, map[string]LeadTask{"data": task})
}

func (handler Handler) PatchLeadTask(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	request, ok := decodeJSON[LeadTaskPatchRequest](w, r, 1<<18)
	if !ok {
		return
	}
	task, err := handler.repo.PatchLeadTask(r.Context(), tenantContext, r.PathValue("id"), request)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]LeadTask{"data": task})
}

func (handler Handler) CompleteCadenceTask(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	request, ok := decodeJSON[CompleteCadenceTaskRequest](w, r, 1<<18)
	if !ok {
		return
	}
	input, err := request.Validate()
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	task, err := handler.repo.CompleteCadenceTask(r.Context(), tenantContext, input)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]LeadTask{"data": task})
}

func (handler Handler) ListNotifications(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit == 0 {
		limit = 50
	}
	notifications, err := handler.repo.ListNotifications(r.Context(), tenantContext, r.URL.Query().Get("userId"), limit)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string][]Notification{"data": notifications})
}

func (handler Handler) CountUnreadNotifications(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}
	count, err := handler.repo.CountUnreadNotifications(r.Context(), tenantContext, r.URL.Query().Get("userId"))
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]int64{"count": count})
}

func (handler Handler) MarkNotificationRead(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}
	if err := handler.repo.MarkNotificationRead(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) MarkAllNotificationsRead(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}
	if err := handler.repo.MarkAllNotificationsRead(r.Context(), tenantContext); err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) CreateNotification(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}
	request, ok := decodeJSON[CreateNotificationRequest](w, r, 1<<18)
	if !ok {
		return
	}
	notification, err := handler.repo.CreateNotification(r.Context(), tenantContext, request)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, map[string]Notification{"data": notification})
}

func (handler Handler) ShowLeadVisibility(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	visibility, err := handler.repo.GetLeadVisibility(r.Context(), tenantContext)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]LeadVisibility{"data": visibility})
}

func decodeJSON[T any](w http.ResponseWriter, r *http.Request, maxBytes int64) (T, bool) {
	defer r.Body.Close()
	var request T
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return request, false
	}
	return request, true
}
