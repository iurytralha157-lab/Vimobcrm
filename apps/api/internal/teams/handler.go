package teams

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/managementintent"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Handler struct {
	repo      Repository
	publisher realtime.Publisher
}

const maxTeamLogoBytes = 5 << 20

func NewHandler(repo Repository, publishers ...realtime.Publisher) Handler {
	publisher := realtime.Publisher(realtime.NoopPublisher{})
	if len(publishers) > 0 && publishers[0] != nil {
		publisher = publishers[0]
	}
	return Handler{repo: repo, publisher: publisher}
}

func (handler Handler) List(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	includeInactive := r.URL.Query().Get("includeInactive") == "true"
	items, err := handler.repo.List(r.Context(), tenantContext, includeInactive)
	if err != nil {
		writeTeamError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]Team]{Data: items})
}

func (handler Handler) Get(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	team, err := handler.repo.Get(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeTeamError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[Team]{Data: team})
}

func (handler Handler) ListHistory(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	limit, err := parseTeamHistoryLimit(r.URL.Query().Get("limit"))
	if err != nil {
		writeTeamError(w, r, err)
		return
	}
	offset, err := parseTeamHistoryOffset(r.URL.Query().Get("offset"))
	if err != nil {
		writeTeamError(w, r, err)
		return
	}
	items, err := handler.repo.ListHistory(r.Context(), tenantContext, r.PathValue("id"), limit, offset)
	if err != nil {
		writeTeamError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]TeamHistoryEvent]{Data: items})
}

func (handler Handler) Create(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	var request CreateTeamRequest
	if err := httpserver.DecodeJSON(w, r, &request, 1<<20); err != nil {
		return
	}
	request.IdempotencyKey = strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	team, err := handler.repo.Create(r.Context(), tenantContext, request)
	if err != nil {
		writeTeamError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[Team]{Data: team})
}

func (handler Handler) Update(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	var request UpdateTeamRequest
	if err := httpserver.DecodeJSON(w, r, &request, 1<<20); err != nil {
		return
	}
	team, err := handler.repo.Update(r.Context(), tenantContext, r.PathValue("id"), request)
	if err != nil {
		writeTeamError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[Team]{Data: team})
}

func (handler Handler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	var request UpdateTeamStatusRequest
	if err := httpserver.DecodeJSON(w, r, &request, 1<<20); err != nil {
		return
	}
	if request.IsActive == nil {
		writeTeamError(w, r, ErrInvalidInput)
		return
	}
	team, err := handler.repo.UpdateStatus(r.Context(), tenantContext, r.PathValue("id"), *request.IsActive)
	if err != nil {
		writeTeamError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[Team]{Data: team})
}

func (handler Handler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	if err := handler.repo.Delete(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeTeamError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) UploadLogo(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	contentType, size, fileName, body, cleanup, err := parseLogoUpload(w, r)
	if cleanup != nil {
		defer cleanup()
	}
	if err != nil {
		writeTeamError(w, r, err)
		return
	}
	uploaded, err := handler.repo.UploadLogo(r.Context(), tenantContext, contentType, size, fileName, body)
	if err != nil {
		writeTeamError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[AssetUpload]{Data: uploaded})
}

func (handler Handler) ListTeamPipelines(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListTeamPipelines(r.Context(), tenantContext, r.URL.Query().Get("teamId"))
	if err != nil {
		writeTeamError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]TeamPipelineRelation]{Data: items})
}

func (handler Handler) AssignPipelineToTeam(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	var request AssignPipelineRequest
	if err := httpserver.DecodeJSON(w, r, &request, 1<<20); err != nil {
		return
	}
	item, changed, err := handler.repo.assignPipelineToTeam(r.Context(), tenantContext, request)
	if err != nil {
		writeTeamError(w, r, err)
		return
	}
	if changed {
		handler.publishPipelineChange("team.pipeline.linked", tenantContext, item.TeamID, item.PipelineID)
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[TeamPipelineRelation]{Data: item})
}

func (handler Handler) RemovePipelineFromTeam(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	request := AssignPipelineRequest{
		TeamID:     r.URL.Query().Get("teamId"),
		PipelineID: r.URL.Query().Get("pipelineId"),
	}
	changed, err := handler.repo.removePipelineFromTeam(r.Context(), tenantContext, request)
	if err != nil {
		writeTeamError(w, r, err)
		return
	}
	if changed {
		teamID, pipelineID, _ := normalizeTeamPipelineRequest(request)
		handler.publishPipelineChange("team.pipeline.unlinked", tenantContext, teamID, pipelineID)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) publishPipelineChange(eventType string, actor tenant.Context, teamID, pipelineID string) {
	if handler.publisher == nil {
		return
	}
	handler.publisher.Publish(realtime.NewEvent(eventType, actor.OrganizationID, actor.UserID, map[string]any{
		"teamId": teamID, "pipelineId": pipelineID,
	}))
}

func (handler Handler) SetTeamLeader(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	var request SetTeamLeaderRequest
	if err := httpserver.DecodeJSON(w, r, &request, 1<<20); err != nil {
		return
	}
	if err := handler.repo.SetTeamLeader(r.Context(), tenantContext, request); err != nil {
		writeTeamError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) ListMemberAvailability(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	ids := availabilityIDsFromQuery(r)
	items, err := handler.repo.ListAvailability(r.Context(), tenantContext, ids)
	if err != nil {
		writeTeamError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]MemberAvailability]{Data: items})
}

func (handler Handler) ListTeamMemberAvailability(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	snapshot, err := handler.repo.GetAvailabilitySnapshot(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeTeamError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, snapshot)
}

func (handler Handler) UpsertAvailability(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	var request AvailabilityRequest
	if err := httpserver.DecodeJSON(w, r, &request, 1<<20); err != nil {
		return
	}
	result, err := handler.repo.UpsertAvailability(r.Context(), tenantContext, request)
	if err != nil {
		writeTeamError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, result)
}

func (handler Handler) ReplaceAvailability(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	var request BulkAvailabilityRequest
	if err := httpserver.DecodeJSON(w, r, &request, 1<<20); err != nil {
		return
	}
	snapshot, err := handler.repo.ReplaceAvailability(r.Context(), tenantContext, r.PathValue("id"), request.Availability, request.ExpectedRevision)
	if err != nil {
		writeTeamError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, snapshot)
}

func availabilityIDsFromQuery(r *http.Request) []string {
	ids := []string{}
	if value := r.URL.Query().Get("teamMemberId"); value != "" {
		ids = append(ids, value)
	}
	if value := r.URL.Query().Get("teamMemberIds"); value != "" {
		ids = append(ids, strings.Split(value, ",")...)
	}
	return ids
}

func parseLogoUpload(w http.ResponseWriter, r *http.Request) (string, int64, string, io.Reader, func(), error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxTeamLogoBytes+(1<<20))
	if err := r.ParseMultipartForm(maxTeamLogoBytes + (1 << 20)); err != nil {
		return "", 0, "", nil, nil, fmt.Errorf("%w: invalid multipart form", ErrInvalidInput)
	}
	cleanup := func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}
	file, fileHeader, err := r.FormFile("file")
	if err != nil {
		cleanup()
		return "", 0, "", nil, nil, fmt.Errorf("%w: file is required", ErrInvalidInput)
	}
	if fileHeader.Size <= 0 || fileHeader.Size > maxTeamLogoBytes {
		file.Close()
		cleanup()
		return "", 0, "", nil, nil, fmt.Errorf("%w: invalid file size", ErrInvalidInput)
	}
	buffer := make([]byte, 512)
	readBytes, err := file.Read(buffer)
	if err != nil && !errors.Is(err, io.EOF) {
		file.Close()
		cleanup()
		return "", 0, "", nil, nil, fmt.Errorf("%w: could not read file", ErrInvalidInput)
	}
	buffer = buffer[:readBytes]
	contentType, err := normalizeLogoContentType(http.DetectContentType(buffer))
	if err != nil {
		file.Close()
		cleanup()
		return "", 0, "", nil, nil, err
	}
	return contentType, fileHeader.Size, fileHeader.Filename, io.MultiReader(bytes.NewReader(buffer), file), func() {
		file.Close()
		cleanup()
	}, nil
}

func normalizeLogoContentType(detected string) (string, error) {
	detected = cleanContentType(detected)
	if isAllowedLogoContentType(detected) {
		return detected, nil
	}
	return "", ErrInvalidInput
}

func cleanContentType(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if before, _, ok := strings.Cut(value, ";"); ok {
		return strings.TrimSpace(before)
	}
	return value
}

func isAllowedLogoContentType(value string) bool {
	switch value {
	case "image/jpeg", "image/png", "image/webp", "image/gif":
		return true
	default:
		return false
	}
}

func writeTeamError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, managementintent.ErrInvalidKey):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_creation_key", "A valid Idempotency-Key is required.")
	case errors.Is(err, managementintent.ErrConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "creation_key_conflict", "This creation key is already bound to another request.")
	case errors.Is(err, managementintent.ErrResultUnavailable):
		httpserver.WriteError(w, r, http.StatusConflict, "create_result_unavailable", "The original creation result is no longer available.")
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_team_input", "Team input is invalid.")
	case errors.Is(err, ErrTeamInUse):
		httpserver.WriteError(w, r, http.StatusConflict, "team_in_use", "Team is used by a distribution queue.")
	case errors.Is(err, ErrTeamRevisionConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "team_revision_conflict", "Team changed since it was loaded. Reload before saving.")
	case errors.Is(err, ErrTeamQueueSyncBlocked):
		httpserver.WriteError(w, r, http.StatusConflict, "team_queue_sync_blocked", "A fila de distribuição vinculada atingiu o limite de participantes ou de posições. Reduza os participantes ou revise o vínculo da equipe antes de salvar.")
	case errors.Is(err, ErrTeamNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "team_not_found", "Team was not found.")
	case errors.Is(err, ErrTeamMemberNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "team_member_not_found", "Team member was not found.")
	case errors.Is(err, ErrStorageNotConfigured):
		httpserver.WriteError(w, r, http.StatusInternalServerError, "team_storage_not_configured", "Team storage is not configured.")
	case errors.Is(err, ErrStorageOperation):
		httpserver.WriteError(w, r, http.StatusBadGateway, "team_storage_failed", "Team storage operation failed.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	default:
		slog.Error("team operation failed",
			"error", err,
			"method", r.Method,
			"path", r.URL.Path,
			"request_id", httpserver.RequestIDFromContext(r.Context()),
		)
		httpserver.WriteError(w, r, http.StatusInternalServerError, "team_operation_failed", "Unable to complete team operation.")
	}
}
