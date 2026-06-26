package settings

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Handler struct {
	repo Repository
}

const maxSettingsImageUploadBytes = 10 << 20

func NewHandler(repo Repository) Handler {
	return Handler{repo: repo}
}

func (handler Handler) PublicSystemSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := handler.repo.PublicSystemSettings(r.Context())
	if err != nil {
		writeSettingsError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: settings})
}

func (handler Handler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.UserID == "" {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}

	defer r.Body.Close()
	var request UpdateProfileRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	if err := handler.repo.UpdateProfile(r.Context(), tenantContext, request); err != nil {
		writeSettingsError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) UploadProfileAvatar(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.UserID == "" {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}

	contentType, size, body, cleanup, err := parseImageUpload(w, r)
	if cleanup != nil {
		defer cleanup()
	}
	if err != nil {
		writeSettingsError(w, r, err)
		return
	}

	uploaded, err := handler.repo.UploadProfileAvatar(r.Context(), tenantContext, contentType, size, body)
	if err != nil {
		writeSettingsError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, Envelope[AssetUpload]{Data: uploaded})
}

func (handler Handler) UpdateOrganization(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	defer r.Body.Close()
	var request UpdateOrganizationRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	if err := handler.repo.UpdateOrganization(r.Context(), tenantContext, request); err != nil {
		writeSettingsError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) UploadOrganizationLogo(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	contentType, size, body, cleanup, err := parseImageUpload(w, r)
	if cleanup != nil {
		defer cleanup()
	}
	if err != nil {
		writeSettingsError(w, r, err)
		return
	}

	uploaded, err := handler.repo.UploadOrganizationLogo(r.Context(), tenantContext, contentType, size, body)
	if err != nil {
		writeSettingsError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, Envelope[AssetUpload]{Data: uploaded})
}

func (handler Handler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.UserID == "" {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}

	defer r.Body.Close()
	var request ChangePasswordRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	result, err := handler.repo.ChangePassword(r.Context(), tenantContext, request)
	if err != nil {
		writeSettingsError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, result)
}

func (handler Handler) PasswordStatus(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.UserID == "" {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}

	status, err := handler.repo.PasswordStatus(r.Context(), tenantContext)
	if err != nil {
		writeSettingsError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[PasswordStatus]{Data: status})
}

func (handler Handler) ListAPIKeys(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	items, err := handler.repo.ListAPIKeys(r.Context(), tenantContext)
	if err != nil {
		writeSettingsError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]APIKey]{Data: items})
}

func (handler Handler) ListOrganizationModules(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	items, err := handler.repo.ListOrganizationModules(r.Context(), tenantContext)
	if err != nil {
		writeSettingsError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]OrganizationModule]{Data: items})
}

func (handler Handler) ShowSetupGuideProgress(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.UserID == "" {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}

	progress, err := handler.repo.GetSetupGuideProgress(r.Context(), tenantContext)
	if err != nil {
		writeSettingsError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[SetupGuideProgress]{Data: progress})
}

func (handler Handler) UpdateSetupGuideProgress(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.UserID == "" {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}

	defer r.Body.Close()
	var request UpdateSetupGuideProgressRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}

	progress, err := handler.repo.UpdateSetupGuideProgress(r.Context(), tenantContext, request)
	if err != nil {
		writeSettingsError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[SetupGuideProgress]{Data: progress})
}

func (handler Handler) SavePushToken(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	defer r.Body.Close()
	var request PushTokenRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	if err := handler.repo.SavePushToken(r.Context(), tenantContext, request); err != nil {
		writeSettingsError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) DeactivatePushToken(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.UserID == "" {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}

	defer r.Body.Close()
	var request DeactivatePushTokenRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	if err := handler.repo.DeactivatePushToken(r.Context(), tenantContext, request); err != nil {
		writeSettingsError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) CreateAPIKey(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	defer r.Body.Close()
	var request CreateAPIKeyRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}

	result, err := handler.repo.CreateAPIKey(r.Context(), tenantContext, CreateAPIKeyInput{
		Name: strings.TrimSpace(request.Name),
	})
	if err != nil {
		writeSettingsError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, Envelope[CreateAPIKeyResult]{Data: result})
}

func (handler Handler) DeleteAPIKey(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	if err := handler.repo.DeleteAPIKey(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeSettingsError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) ShowSubscription(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	overview, err := handler.repo.GetSubscriptionOverview(r.Context(), tenantContext)
	if err != nil {
		writeSettingsError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[SubscriptionOverview]{Data: overview})
}

func (handler Handler) UpdateSubscriptionBilling(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	defer r.Body.Close()
	var request UpdateBillingRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}

	overview, err := handler.repo.UpdateSubscriptionBilling(r.Context(), tenantContext, request)
	if err != nil {
		writeSettingsError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[SubscriptionOverview]{Data: overview})
}

func (handler Handler) SelectSubscriptionPlan(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	defer r.Body.Close()
	var request SelectSubscriptionPlanRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}

	overview, err := handler.repo.SelectSubscriptionPlan(r.Context(), tenantContext, request.PlanID)
	if err != nil {
		writeSettingsError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[SubscriptionOverview]{Data: overview})
}

func (handler Handler) ListOrganizationRoles(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListOrganizationRoles(r.Context(), tenantContext)
	if err != nil {
		writeSettingsError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) ListAvailablePermissions(w http.ResponseWriter, r *http.Request) {
	items, err := handler.repo.ListAvailablePermissions(r.Context())
	if err != nil {
		writeSettingsError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) ListRolePermissions(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListRolePermissions(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeSettingsError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) ListUserOrganizationRoles(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListUserOrganizationRoles(r.Context(), tenantContext)
	if err != nil {
		writeSettingsError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) CreateRole(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	payload := map[string]any{}
	if err := decodeJSON(w, r, &payload); err != nil {
		return
	}
	item, err := handler.repo.CreateRole(r.Context(), tenantContext, payload)
	if err != nil {
		writeSettingsError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[map[string]any]{Data: item})
}

func (handler Handler) UpdateRole(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	payload := map[string]any{}
	if err := decodeJSON(w, r, &payload); err != nil {
		return
	}
	item, err := handler.repo.UpdateRole(r.Context(), tenantContext, r.PathValue("id"), payload)
	if err != nil {
		writeSettingsError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) DeleteRole(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	if err := handler.repo.DeleteRole(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeSettingsError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) ReplaceRolePermissions(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	payload := struct {
		Permissions []string `json:"permissions"`
	}{}
	if err := decodeJSON(w, r, &payload); err != nil {
		return
	}
	if err := handler.repo.ReplaceRolePermissions(r.Context(), tenantContext, r.PathValue("id"), payload.Permissions); err != nil {
		writeSettingsError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) AssignUserRole(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	payload := struct {
		UserID string  `json:"userId"`
		RoleID *string `json:"roleId"`
	}{}
	if err := decodeJSON(w, r, &payload); err != nil {
		return
	}
	roleID := ""
	if payload.RoleID != nil {
		roleID = *payload.RoleID
	}
	if err := handler.repo.AssignUserRole(r.Context(), tenantContext, payload.UserID, roleID); err != nil {
		writeSettingsError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) HasPermission(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.UserID == "" {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}
	allowed, err := handler.repo.HasPermission(r.Context(), tenantContext, r.URL.Query().Get("permissionKey"))
	if err != nil {
		writeSettingsError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[bool]{Data: allowed})
}

func organizationContext(w http.ResponseWriter, r *http.Request) (tenant.Context, bool) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return tenant.Context{}, false
	}

	return tenantContext, true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return err
	}

	return nil
}

func parseImageUpload(w http.ResponseWriter, r *http.Request) (string, int64, io.Reader, func(), error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxSettingsImageUploadBytes+(1<<20))
	if err := r.ParseMultipartForm(maxSettingsImageUploadBytes + (1 << 20)); err != nil {
		return "", 0, nil, nil, fmt.Errorf("%w: invalid multipart form", ErrInvalidInput)
	}
	cleanup := func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}

	file, fileHeader, err := r.FormFile("file")
	if err != nil {
		cleanup()
		return "", 0, nil, nil, fmt.Errorf("%w: file is required", ErrInvalidInput)
	}

	if fileHeader.Size <= 0 {
		file.Close()
		cleanup()
		return "", 0, nil, nil, fmt.Errorf("%w: file is empty", ErrInvalidInput)
	}
	if fileHeader.Size > maxSettingsImageUploadBytes {
		file.Close()
		cleanup()
		return "", 0, nil, nil, fmt.Errorf("%w: file exceeds 10MB", ErrInvalidInput)
	}

	buffer := make([]byte, 512)
	readBytes, err := file.Read(buffer)
	if err != nil && !errors.Is(err, io.EOF) {
		file.Close()
		cleanup()
		return "", 0, nil, nil, fmt.Errorf("%w: could not read file", ErrInvalidInput)
	}
	buffer = buffer[:readBytes]

	contentType, err := normalizeImageContentType(http.DetectContentType(buffer), fileHeader.Header.Get("Content-Type"))
	if err != nil {
		file.Close()
		cleanup()
		return "", 0, nil, nil, err
	}

	return contentType, fileHeader.Size, io.MultiReader(bytes.NewReader(buffer), file), func() {
		file.Close()
		cleanup()
	}, nil
}

func normalizeImageContentType(detected string, declared string) (string, error) {
	detected = cleanContentType(detected)
	declared = cleanContentType(declared)

	if isAllowedImageContentType(detected) {
		return detected, nil
	}
	if isAllowedImageContentType(declared) {
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

func isAllowedImageContentType(value string) bool {
	switch value {
	case "image/jpeg", "image/png", "image/webp", "image/gif":
		return true
	default:
		return false
	}
}

func writeSettingsError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_settings_input", "Settings input is invalid.")
	case errors.Is(err, ErrAPIKeyNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "api_key_not_found", "API key was not found.")
	case errors.Is(err, ErrStorageNotConfigured):
		httpserver.WriteError(w, r, http.StatusInternalServerError, "settings_storage_not_configured", "Settings storage is not configured.")
	case errors.Is(err, ErrStorageOperation):
		httpserver.WriteError(w, r, http.StatusBadGateway, "settings_storage_failed", "Settings storage operation failed.")
	case errors.Is(err, ErrAuthNotConfigured):
		httpserver.WriteError(w, r, http.StatusInternalServerError, "settings_auth_not_configured", "Settings auth admin is not configured.")
	case errors.Is(err, ErrAuthOperation):
		httpserver.WriteError(w, r, http.StatusBadGateway, "settings_auth_failed", "Settings auth operation failed.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "settings_operation_failed", "Unable to complete settings operation.")
	}
}
