package site

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Handler struct {
	repo      Repository
	publisher realtime.Publisher
}

const maxSiteAssetBytes = 10 << 20

func NewHandler(repo Repository, publishers ...realtime.Publisher) Handler {
	publisher := realtime.Publisher(realtime.NoopPublisher{})
	if len(publishers) > 0 && publishers[0] != nil {
		publisher = publishers[0]
	}
	return Handler{repo: repo, publisher: publisher}
}

func (handler Handler) ShowSite(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	site, err := handler.repo.GetSite(r.Context(), tenantContext)
	if err != nil {
		writeSiteError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[*OrganizationSite]{Data: site})
}

func (handler Handler) CreateSite(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	payload, ok := decodeMap(w, r)
	if !ok {
		return
	}
	site, err := handler.repo.CreateSite(r.Context(), tenantContext, payload)
	if err != nil {
		writeSiteError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[OrganizationSite]{Data: site})
}

func (handler Handler) UpdateSite(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	payload, ok := decodeMap(w, r)
	if !ok {
		return
	}
	site, err := handler.repo.UpdateSite(r.Context(), tenantContext, payload)
	if err != nil {
		writeSiteError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[OrganizationSite]{Data: site})
}

func (handler Handler) UploadAsset(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	assetType, contentType, size, fileName, body, cleanup, err := parseAssetUpload(w, r)
	if cleanup != nil {
		defer cleanup()
	}
	if err != nil {
		writeSiteError(w, r, err)
		return
	}

	uploaded, err := handler.repo.UploadAsset(r.Context(), tenantContext, assetType, contentType, size, fileName, body)
	if err != nil {
		writeSiteError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[AssetUpload]{Data: uploaded})
}

func (handler Handler) ListMenuItems(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListMenuItems(r.Context(), tenantContext)
	if err != nil {
		writeSiteError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]SiteMenuItem]{Data: items})
}

func (handler Handler) CreateMenuItem(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	var request MenuItemRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	item, err := handler.repo.CreateMenuItem(r.Context(), tenantContext, request)
	if err != nil {
		writeSiteError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[SiteMenuItem]{Data: item})
}

func (handler Handler) UpdateMenuItem(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	var request MenuItemRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	item, err := handler.repo.UpdateMenuItem(r.Context(), tenantContext, r.PathValue("id"), request)
	if err != nil {
		writeSiteError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[SiteMenuItem]{Data: item})
}

func (handler Handler) DeleteMenuItem(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	if err := handler.repo.DeleteMenuItem(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeSiteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) ReorderMenuItems(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	var request ReorderRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	if err := handler.repo.ReorderMenuItems(r.Context(), tenantContext, request.Items); err != nil {
		writeSiteError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) ListSearchFilters(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListSearchFilters(r.Context(), tenantContext)
	if err != nil {
		writeSiteError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]SiteSearchFilter]{Data: items})
}

func (handler Handler) CreateSearchFilter(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	var request SearchFilterRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	item, err := handler.repo.CreateSearchFilter(r.Context(), tenantContext, request)
	if err != nil {
		writeSiteError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[SiteSearchFilter]{Data: item})
}

func (handler Handler) UpdateSearchFilter(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	var request SearchFilterRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	item, err := handler.repo.UpdateSearchFilter(r.Context(), tenantContext, r.PathValue("id"), request)
	if err != nil {
		writeSiteError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[SiteSearchFilter]{Data: item})
}

func (handler Handler) DeleteSearchFilter(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	if err := handler.repo.DeleteSearchFilter(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeSiteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) ReorderSearchFilters(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	var request ReorderRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	if err := handler.repo.ReorderSearchFilters(r.Context(), tenantContext, request.Items); err != nil {
		writeSiteError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) ResolvePublicSite(w http.ResponseWriter, r *http.Request) {
	domain := strings.TrimSpace(r.URL.Query().Get("domain"))
	if domain == "" {
		domain = strings.TrimSpace(r.Host)
	}

	siteConfig, err := handler.repo.ResolvePublicSite(r.Context(), domain)
	if err != nil {
		writeSiteError(w, r, err)
		return
	}
	if siteConfig == nil {
		httpserver.WriteJSON(w, http.StatusOK, map[string]any{"found": false})
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]any{
		"found":       true,
		"site_config": siteConfig,
	})
}

func (handler Handler) PublicSiteData(w http.ResponseWriter, r *http.Request) {
	payload, err := handler.repo.PublicSiteData(
		r.Context(),
		r.URL.Query().Get("organization_id"),
		r.URL.Query().Get("endpoint"),
		r.URL.Query(),
	)
	if err != nil {
		writeSiteError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, payload)
}

func (handler Handler) ListPublicMenuItems(w http.ResponseWriter, r *http.Request) {
	items, err := handler.repo.ListPublicMenuItems(r.Context(), r.URL.Query().Get("organization_id"))
	if err != nil {
		writeSiteError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]SiteMenuItem]{Data: items})
}

func (handler Handler) ListPublicSearchFilters(w http.ResponseWriter, r *http.Request) {
	items, err := handler.repo.ListPublicSearchFilters(r.Context(), r.URL.Query().Get("organization_id"))
	if err != nil {
		writeSiteError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]SiteSearchFilter]{Data: items})
}

func (handler Handler) SubmitPublicContact(w http.ResponseWriter, r *http.Request) {
	var request PublicContactRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	result, err := handler.repo.CreatePublicContact(r.Context(), request)
	if err != nil {
		writeSiteError(w, r, err)
		return
	}
	leadID, _ := result["lead_id"].(string)
	handler.publishSiteEvent("lead.created", request.OrganizationID, map[string]any{
		"leadId":    leadID,
		"source":    "site",
		"sessionId": optionalStringValue(request.SessionID),
	})
	httpserver.WriteJSON(w, http.StatusCreated, result)
}

func (handler Handler) TrackPublicEvent(w http.ResponseWriter, r *http.Request) {
	var request PublicTrackingRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	if err := handler.repo.CreatePublicTrackingEvent(r.Context(), request); err != nil {
		writeSiteError(w, r, err)
		return
	}
	handler.publishSiteEvent("site.analytics_event.created", request.OrganizationID, map[string]any{
		"eventType":  request.EventType,
		"pagePath":   request.PagePath,
		"propertyId": optionalStringValue(request.PropertyID),
		"sessionId":  optionalStringValue(request.SessionID),
	})
	httpserver.WriteJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

func (handler Handler) publishSiteEvent(eventType string, organizationID string, data map[string]any) {
	organizationID = strings.TrimSpace(organizationID)
	if organizationID == "" {
		return
	}
	handler.publisher.Publish(realtime.NewEvent(eventType, organizationID, "", data))
}

func optionalStringValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func organizationContext(w http.ResponseWriter, r *http.Request) (tenant.Context, bool) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return tenant.Context{}, false
	}
	return tenantContext, true
}

func decodeMap(w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	defer r.Body.Close()
	var payload map[string]any
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20))
	if err := decoder.Decode(&payload); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return nil, false
	}
	if payload == nil {
		payload = map[string]any{}
	}
	return payload, true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	defer r.Body.Close()
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return false
	}
	return true
}

func parseAssetUpload(w http.ResponseWriter, r *http.Request) (string, string, int64, string, io.Reader, func(), error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxSiteAssetBytes+(1<<20))
	if err := r.ParseMultipartForm(maxSiteAssetBytes + (1 << 20)); err != nil {
		return "", "", 0, "", nil, nil, fmt.Errorf("%w: invalid multipart form", ErrInvalidInput)
	}
	cleanup := func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}

	assetType := strings.TrimSpace(r.FormValue("type"))
	file, fileHeader, err := r.FormFile("file")
	if err != nil {
		cleanup()
		return "", "", 0, "", nil, nil, fmt.Errorf("%w: file is required", ErrInvalidInput)
	}
	if fileHeader.Size <= 0 || fileHeader.Size > maxSiteAssetBytes {
		file.Close()
		cleanup()
		return "", "", 0, "", nil, nil, fmt.Errorf("%w: invalid file size", ErrInvalidInput)
	}

	buffer := make([]byte, 512)
	readBytes, err := file.Read(buffer)
	if err != nil && !errors.Is(err, io.EOF) {
		file.Close()
		cleanup()
		return "", "", 0, "", nil, nil, fmt.Errorf("%w: could not read file", ErrInvalidInput)
	}
	buffer = buffer[:readBytes]

	contentType, err := normalizeAssetContentType(http.DetectContentType(buffer), fileHeader.Header.Get("Content-Type"))
	if err != nil {
		file.Close()
		cleanup()
		return "", "", 0, "", nil, nil, err
	}

	return assetType, contentType, fileHeader.Size, fileHeader.Filename, io.MultiReader(bytes.NewReader(buffer), file), func() {
		file.Close()
		cleanup()
	}, nil
}

func normalizeAssetContentType(detected string, declared string) (string, error) {
	detected = cleanContentType(detected)
	declared = cleanContentType(declared)

	if isAllowedAssetContentType(detected) {
		return detected, nil
	}
	if isAllowedAssetContentType(declared) {
		return declared, nil
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

func isAllowedAssetContentType(value string) bool {
	switch value {
	case "image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml", "image/x-icon", "image/vnd.microsoft.icon":
		return true
	default:
		return false
	}
}

func writeSiteError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_site_input", "Site input is invalid.")
	case errors.Is(err, ErrSiteNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "site_not_found", "Site was not found.")
	case errors.Is(err, ErrMenuItemNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "site_menu_item_not_found", "Site menu item was not found.")
	case errors.Is(err, ErrSearchFilterNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "site_search_filter_not_found", "Site search filter was not found.")
	case errors.Is(err, ErrStorageNotConfigured):
		httpserver.WriteError(w, r, http.StatusInternalServerError, "site_storage_not_configured", "Site storage is not configured.")
	case errors.Is(err, ErrStorageOperation):
		httpserver.WriteError(w, r, http.StatusBadGateway, "site_storage_failed", "Site storage operation failed.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "site_operation_failed", "Unable to complete site operation.")
	}
}
