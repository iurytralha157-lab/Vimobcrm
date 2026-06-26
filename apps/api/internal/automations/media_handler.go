package automations

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
)

const maxAutomationMediaUploadBytes = 10 << 20

func (handler Handler) ListMedia(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	items, err := handler.repo.ListMedia(r.Context(), tenantContext, getAutomationMediaType(r))
	if err != nil {
		writeAutomationError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]AutomationMediaFile]{Data: items})
}

func (handler Handler) UploadMedia(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxAutomationMediaUploadBytes+(1<<20))
	if err := r.ParseMultipartForm(maxAutomationMediaUploadBytes + (1 << 20)); err != nil {
		writeAutomationError(w, r, fmt.Errorf("%w: invalid multipart form", ErrInvalidInput))
		return
	}
	defer r.MultipartForm.RemoveAll()

	mediaType := getAutomationMediaType(r)
	if _, ok := normalizeAutomationMediaType(mediaType); !ok {
		writeAutomationError(w, r, ErrInvalidInput)
		return
	}

	file, fileHeader, err := r.FormFile("file")
	if err != nil {
		writeAutomationError(w, r, fmt.Errorf("%w: file is required", ErrInvalidInput))
		return
	}
	defer file.Close()

	if fileHeader.Size <= 0 {
		writeAutomationError(w, r, fmt.Errorf("%w: file is empty", ErrInvalidInput))
		return
	}
	if fileHeader.Size > maxAutomationMediaUploadBytes {
		writeAutomationError(w, r, fmt.Errorf("%w: file exceeds 10MB", ErrInvalidInput))
		return
	}

	buffer := make([]byte, 512)
	readBytes, err := file.Read(buffer)
	if err != nil && !errors.Is(err, io.EOF) {
		writeAutomationError(w, r, fmt.Errorf("%w: could not read file", ErrInvalidInput))
		return
	}
	buffer = buffer[:readBytes]

	contentType, err := normalizeUploadContentType(
		mediaType,
		http.DetectContentType(buffer),
		fileHeader.Header.Get("Content-Type"),
	)
	if err != nil {
		writeAutomationError(w, r, err)
		return
	}

	uploaded, err := handler.repo.UploadMedia(r.Context(), tenantContext, AutomationMediaUploadInput{
		MediaType:        mediaType,
		OriginalFileName: fileHeader.Filename,
		ContentType:      contentType,
		Size:             fileHeader.Size,
	}, io.MultiReader(bytes.NewReader(buffer), file))
	if err != nil {
		writeAutomationError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, Envelope[AutomationMediaUpload]{Data: uploaded})
}

func (handler Handler) DeleteMedia(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	if err := handler.repo.DeleteMedia(
		r.Context(),
		tenantContext,
		getAutomationMediaType(r),
		strings.TrimSpace(r.URL.Query().Get("fileName")),
	); err != nil {
		writeAutomationError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func getAutomationMediaType(r *http.Request) string {
	if value := strings.TrimSpace(r.FormValue("mediaType")); value != "" {
		return value
	}

	return strings.TrimSpace(r.URL.Query().Get("mediaType"))
}

func normalizeUploadContentType(mediaType string, detected string, declared string) (string, error) {
	mediaType, ok := normalizeAutomationMediaType(mediaType)
	if !ok {
		return "", ErrInvalidInput
	}

	detected = cleanAutomationContentType(detected)
	declared = cleanAutomationContentType(declared)

	if isAllowedAutomationMediaContentType(mediaType, detected) {
		return detected, nil
	}
	if isAllowedAutomationMediaContentType(mediaType, declared) {
		return declared, nil
	}

	return "", ErrInvalidInput
}
