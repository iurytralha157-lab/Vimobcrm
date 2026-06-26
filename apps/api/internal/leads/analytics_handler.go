package leads

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const maxLeadAttachmentUploadBytes = 25 << 20

func (handler Handler) ListLeadTimeline(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	events, err := handler.repo.ListLeadTimeline(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string][]map[string]any{"data": events})
}

func (handler Handler) ListLeadJourney(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	events, err := handler.repo.ListLeadJourney(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string][]map[string]any{"data": events})
}

func (handler Handler) ShowLeadHistoryRaw(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	history, err := handler.repo.LeadHistoryRaw(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]map[string]any{"data": history})
}

func (handler Handler) ShowFirstResponseMetrics(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	filter, err := ParseFirstResponseFilter(r.URL.Query())
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	metrics, err := handler.repo.FirstResponseMetrics(r.Context(), tenantContext, filter)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]map[string]any{"data": metrics})
}

func (handler Handler) ListFirstResponseRanking(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	filter, err := ParseFirstResponseFilter(r.URL.Query())
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	ranking, err := handler.repo.FirstResponseRanking(r.Context(), tenantContext, filter)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string][]map[string]any{"data": ranking})
}

func (handler Handler) RecordFirstResponse(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	request, ok := decodeJSON[RecordFirstResponseRequest](w, r, 1<<16)
	if !ok {
		return
	}
	if request.LeadID == "" {
		request.LeadID = r.PathValue("id")
	}
	input, err := request.Validate(tenantContext.UserID)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	result, err := handler.repo.RecordFirstResponse(r.Context(), tenantContext, input)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]map[string]any{"data": result})
}

func (handler Handler) UploadLeadAttachment(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	fileName, contentType, size, body, cleanup, err := parseLeadAttachmentUpload(w, r)
	if cleanup != nil {
		defer cleanup()
	}
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	attachment, err := handler.repo.UploadLeadAttachment(r.Context(), tenantContext, r.PathValue("id"), fileName, contentType, size, body)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, map[string]LeadAttachment{"data": attachment})
}

func parseLeadAttachmentUpload(w http.ResponseWriter, r *http.Request) (string, string, int64, io.Reader, func(), error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxLeadAttachmentUploadBytes+(1<<20))
	if err := r.ParseMultipartForm(maxLeadAttachmentUploadBytes + (1 << 20)); err != nil {
		return "", "", 0, nil, nil, fmtInvalidInput("invalid multipart form")
	}

	cleanup := func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}

	file, fileHeader, err := r.FormFile("file")
	if err != nil {
		cleanup()
		return "", "", 0, nil, nil, fmtInvalidInput("file is required")
	}

	if fileHeader.Size <= 0 {
		file.Close()
		cleanup()
		return "", "", 0, nil, nil, fmtInvalidInput("file is empty")
	}
	if fileHeader.Size > maxLeadAttachmentUploadBytes {
		file.Close()
		cleanup()
		return "", "", 0, nil, nil, fmtInvalidInput("file exceeds 25MB")
	}

	buffer := make([]byte, 512)
	readBytes, err := file.Read(buffer)
	if err != nil && !errors.Is(err, io.EOF) {
		file.Close()
		cleanup()
		return "", "", 0, nil, nil, fmtInvalidInput("could not read file")
	}
	buffer = buffer[:readBytes]

	contentType := cleanUploadContentType(fileHeader.Header.Get("Content-Type"))
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = cleanUploadContentType(http.DetectContentType(buffer))
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	return fileHeader.Filename, contentType, fileHeader.Size, io.MultiReader(bytes.NewReader(buffer), file), func() {
		file.Close()
		cleanup()
	}, nil
}

func cleanUploadContentType(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if before, _, ok := strings.Cut(value, ";"); ok {
		return strings.TrimSpace(before)
	}
	return value
}

func fmtInvalidInput(message string) error {
	return fmt.Errorf("%w: %s", ErrInvalidInput, message)
}
