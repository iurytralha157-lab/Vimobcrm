package properties

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

const maxPropertyImageUploadBytes = 10 << 20

func (handler Handler) UploadImage(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxPropertyImageUploadBytes+(1<<20))
	if err := r.ParseMultipartForm(maxPropertyImageUploadBytes + (1 << 20)); err != nil {
		writePropertyError(w, r, fmt.Errorf("%w: invalid multipart form", ErrInvalidInput))
		return
	}
	defer r.MultipartForm.RemoveAll()

	file, fileHeader, err := r.FormFile("file")
	if err != nil {
		writePropertyError(w, r, fmt.Errorf("%w: file is required", ErrInvalidInput))
		return
	}
	defer file.Close()

	if fileHeader.Size <= 0 {
		writePropertyError(w, r, fmt.Errorf("%w: file is empty", ErrInvalidInput))
		return
	}
	if fileHeader.Size > maxPropertyImageUploadBytes {
		writePropertyError(w, r, fmt.Errorf("%w: file exceeds 10MB", ErrInvalidInput))
		return
	}

	buffer := make([]byte, 512)
	readBytes, err := file.Read(buffer)
	if err != nil && !errors.Is(err, io.EOF) {
		writePropertyError(w, r, fmt.Errorf("%w: could not read file", ErrInvalidInput))
		return
	}
	buffer = buffer[:readBytes]

	contentType, err := normalizeAllowedImageContentType(
		http.DetectContentType(buffer),
		fileHeader.Header.Get("Content-Type"),
	)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	response, err := handler.repo.UploadImage(r.Context(), tenantContext, propertyImageUploadInput{
		PropertyID:       strings.TrimSpace(r.FormValue("propertyId")),
		OriginalFileName: fileHeader.Filename,
		ContentType:      contentType,
		Size:             fileHeader.Size,
		Body:             io.MultiReader(bytes.NewReader(buffer), file),
	})
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, response)
}

func normalizeAllowedImageContentType(detected string, declared string) (string, error) {
	detected = cleanContentType(detected)
	declared = cleanContentType(declared)

	if isAllowedImageContentType(detected) {
		return detected, nil
	}
	if detected == "application/octet-stream" && isAllowedImageContentType(declared) {
		return declared, nil
	}

	return "", fmt.Errorf("%w: image type is not allowed", ErrInvalidInput)
}

func cleanContentType(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if before, _, ok := strings.Cut(value, ";"); ok {
		return strings.TrimSpace(before)
	}

	return value
}

func isAllowedImageContentType(value string) bool {
	switch value {
	case "image/jpeg", "image/png", "image/webp", "image/gif":
		return true
	default:
		return false
	}
}
