package publications

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

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
	setPrivatePublicationHeaders(w)
	tenantContext, ok := publicationOrganizationContext(w, r)
	if !ok {
		return
	}
	response, err := handler.repo.GetOverview(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writePublicationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, response)
}

func (handler Handler) Publish(w http.ResponseWriter, r *http.Request) {
	setPrivatePublicationHeaders(w)
	tenantContext, ok := publicationOrganizationContext(w, r)
	if !ok {
		return
	}
	var input PublishInput
	if err := decodePublicationJSON(w, r, &input); err != nil {
		writePublicationError(w, r, err)
		return
	}
	result, err := handler.repo.Publish(r.Context(), tenantContext, r.PathValue("id"), input, r.Header.Get("Idempotency-Key"))
	if err != nil {
		writePublicationError(w, r, err)
		return
	}
	writeCommandResult(w, result)
}

func (handler Handler) Unpublish(w http.ResponseWriter, r *http.Request) {
	setPrivatePublicationHeaders(w)
	tenantContext, ok := publicationOrganizationContext(w, r)
	if !ok {
		return
	}
	var input PublicationRevisionInput
	if err := decodePublicationJSON(w, r, &input); err != nil {
		writePublicationError(w, r, err)
		return
	}
	result, err := handler.repo.Unpublish(r.Context(), tenantContext, r.PathValue("id"), input, r.Header.Get("Idempotency-Key"))
	if err != nil {
		writePublicationError(w, r, err)
		return
	}
	writeCommandResult(w, result)
}

func (handler Handler) Retry(w http.ResponseWriter, r *http.Request) {
	setPrivatePublicationHeaders(w)
	tenantContext, ok := publicationOrganizationContext(w, r)
	if !ok {
		return
	}
	var input PublicationRevisionInput
	if err := decodePublicationJSON(w, r, &input); err != nil {
		writePublicationError(w, r, err)
		return
	}
	result, err := handler.repo.Retry(r.Context(), tenantContext, r.PathValue("id"), input, r.Header.Get("Idempotency-Key"))
	if err != nil {
		writePublicationError(w, r, err)
		return
	}
	writeCommandResult(w, result)
}

func (handler Handler) PublishGrupoOLX(w http.ResponseWriter, r *http.Request) {
	setPrivatePublicationHeaders(w)
	tenantContext, ok := publicationOrganizationContext(w, r)
	if !ok {
		return
	}
	var input PublishInput
	if err := decodePublicationJSON(w, r, &input); err != nil {
		writePublicationError(w, r, err)
		return
	}
	result, err := handler.repo.PublishGrupoOLX(r.Context(), tenantContext, r.PathValue("id"), input, r.Header.Get("Idempotency-Key"))
	if err != nil {
		writePublicationError(w, r, err)
		return
	}
	writeCommandResult(w, result)
}

func (handler Handler) UnpublishGrupoOLX(w http.ResponseWriter, r *http.Request) {
	setPrivatePublicationHeaders(w)
	tenantContext, ok := publicationOrganizationContext(w, r)
	if !ok {
		return
	}
	var input PublicationRevisionInput
	if err := decodePublicationJSON(w, r, &input); err != nil {
		writePublicationError(w, r, err)
		return
	}
	result, err := handler.repo.UnpublishGrupoOLX(r.Context(), tenantContext, r.PathValue("id"), input, r.Header.Get("Idempotency-Key"))
	if err != nil {
		writePublicationError(w, r, err)
		return
	}
	writeCommandResult(w, result)
}

func (handler Handler) RetryGrupoOLX(w http.ResponseWriter, r *http.Request) {
	setPrivatePublicationHeaders(w)
	tenantContext, ok := publicationOrganizationContext(w, r)
	if !ok {
		return
	}
	var input PublicationRevisionInput
	if err := decodePublicationJSON(w, r, &input); err != nil {
		writePublicationError(w, r, err)
		return
	}
	result, err := handler.repo.RetryGrupoOLX(r.Context(), tenantContext, r.PathValue("id"), input, r.Header.Get("Idempotency-Key"))
	if err != nil {
		writePublicationError(w, r, err)
		return
	}
	writeCommandResult(w, result)
}

func (handler Handler) PublicMedia(w http.ResponseWriter, r *http.Request) {
	version, err := strconv.ParseInt(strings.TrimSpace(r.PathValue("version")), 10, 64)
	if err != nil || version < 1 {
		httpserver.WriteError(w, r, http.StatusNotFound, "publication_media_not_found", "Published media was not found.")
		return
	}
	target, err := handler.repo.ResolvePublicMedia(
		r.Context(),
		r.PathValue("publicationId"),
		version,
		r.PathValue("assetId"),
	)
	if err != nil {
		if !errors.Is(err, ErrMediaNotFound) {
			httpserver.WriteError(w, r, http.StatusInternalServerError, "publication_media_unavailable", "Published media is temporarily unavailable.")
			return
		}
		httpserver.WriteError(w, r, http.StatusNotFound, "publication_media_not_found", "Published media was not found.")
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=30, stale-while-revalidate=30")
	w.Header().Set("Referrer-Policy", "no-referrer")
	http.Redirect(w, r, target, http.StatusFound)
}

func publicationOrganizationContext(w http.ResponseWriter, r *http.Request) (tenant.Context, bool) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || strings.TrimSpace(tenantContext.OrganizationID) == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return tenant.Context{}, false
	}
	return tenantContext, true
}

func decodePublicationJSON(w http.ResponseWriter, r *http.Request, target any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("%w: request body is invalid", ErrInvalidInput)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("%w: request body must contain one JSON object", ErrInvalidInput)
	}
	return nil
}

func writeCommandResult(w http.ResponseWriter, result commandResult) {
	if result.Replay {
		w.Header().Set("Idempotent-Replay", "true")
	}
	httpserver.WriteJSON(w, http.StatusAccepted, result.Response)
}

func setPrivatePublicationHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Pragma", "no-cache")
}

func writePublicationError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrIdempotencyKeyMissing):
		httpserver.WriteError(w, r, http.StatusBadRequest, "idempotency_key_required", "Idempotency-Key header is required.")
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_publication_input", err.Error())
	case errors.Is(err, ErrPropertyNotFound), errors.Is(err, ErrPublicationNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "property_publication_not_found", "Property publication was not found.")
	case errors.Is(err, ErrPublicationConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "publication_revision_conflict", "The property publication changed. Refresh before retrying.")
	case errors.Is(err, ErrIdempotencyConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "idempotency_conflict", "Idempotency-Key was already used for a different publication request.")
	case errors.Is(err, ErrPublicationNotReady):
		httpserver.WriteError(w, r, http.StatusUnprocessableEntity, "publication_not_ready", err.Error())
	case errors.Is(err, ErrSiteUnavailable):
		httpserver.WriteError(w, r, http.StatusUnprocessableEntity, "site_unavailable", "The organization site is not active.")
	case errors.Is(err, ErrGrupoOLXUnavailable):
		httpserver.WriteError(w, r, http.StatusUnprocessableEntity, "grupo_olx_unavailable", "The Grupo OLX integration is not active and ready.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "forbidden", "You do not have access to this publication.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "publication_operation_failed", "Publication operation failed.")
	}
}
