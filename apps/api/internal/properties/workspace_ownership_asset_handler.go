package properties

import (
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (handler Handler) CreateOwnership(w http.ResponseWriter, r *http.Request) {
	setPropertyWorkspacePrivateHeaders(w)
	tenantContext, ok := propertyWorkspaceTenant(w, r)
	if !ok {
		return
	}
	var input CreatePropertyOwnershipInput
	if err := decodePropertyWorkspaceJSON(w, r, &input); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}
	item, err := handler.repo.CreatePropertyOwnership(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, map[string]map[string]any{"data": item})
}

func (handler Handler) UpdateOwnership(w http.ResponseWriter, r *http.Request) {
	setPropertyWorkspacePrivateHeaders(w)
	tenantContext, ok := propertyWorkspaceTenant(w, r)
	if !ok {
		return
	}
	var input UpdatePropertyOwnershipInput
	if err := decodePropertyWorkspaceJSON(w, r, &input); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}
	item, err := handler.repo.UpdatePropertyOwnership(
		r.Context(), tenantContext, r.PathValue("id"), r.PathValue("ownershipId"), input,
	)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]map[string]any{"data": item})
}

func (handler Handler) EndOwnership(w http.ResponseWriter, r *http.Request) {
	setPropertyWorkspacePrivateHeaders(w)
	tenantContext, ok := propertyWorkspaceTenant(w, r)
	if !ok {
		return
	}
	var input EndPropertyOwnershipInput
	if err := decodePropertyWorkspaceJSON(w, r, &input); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}
	item, err := handler.repo.EndPropertyOwnership(
		r.Context(), tenantContext, r.PathValue("id"), r.PathValue("ownershipId"), input,
	)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]map[string]any{"data": item})
}

func (handler Handler) CreateAsset(w http.ResponseWriter, r *http.Request) {
	setPropertyWorkspacePrivateHeaders(w)
	tenantContext, ok := propertyWorkspaceTenant(w, r)
	if !ok {
		return
	}
	var input CreatePropertyAssetInput
	if err := decodePropertyWorkspaceJSON(w, r, &input); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}
	item, err := handler.repo.CreatePropertyAsset(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, map[string]map[string]any{"data": item})
}

func (handler Handler) CreateAssetUploadIntent(w http.ResponseWriter, r *http.Request) {
	setPropertyWorkspacePrivateHeaders(w)
	tenantContext, ok := propertyWorkspaceTenant(w, r)
	if !ok {
		return
	}
	var input CreatePropertyAssetUploadIntentInput
	if err := decodePropertyWorkspaceJSON(w, r, &input); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}
	item, err := handler.repo.CreatePropertyAssetUploadIntent(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, map[string]PropertyAssetUploadIntent{"data": item})
}

func (handler Handler) UpdateAsset(w http.ResponseWriter, r *http.Request) {
	setPropertyWorkspacePrivateHeaders(w)
	tenantContext, ok := propertyWorkspaceTenant(w, r)
	if !ok {
		return
	}
	var input UpdatePropertyAssetInput
	if err := decodePropertyWorkspaceJSON(w, r, &input); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}
	item, err := handler.repo.UpdatePropertyAsset(
		r.Context(), tenantContext, r.PathValue("id"), r.PathValue("assetId"), input,
	)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]map[string]any{"data": item})
}

func (handler Handler) DeleteAsset(w http.ResponseWriter, r *http.Request) {
	setPropertyWorkspacePrivateHeaders(w)
	tenantContext, ok := propertyWorkspaceTenant(w, r)
	if !ok {
		return
	}
	var input DeletePropertyAssetInput
	if err := decodePropertyWorkspaceJSON(w, r, &input); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}
	item, err := handler.repo.DeletePropertyAsset(
		r.Context(), tenantContext, r.PathValue("id"), r.PathValue("assetId"), input,
	)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]map[string]string{"data": item})
}

func (handler Handler) ReorderAssets(w http.ResponseWriter, r *http.Request) {
	setPropertyWorkspacePrivateHeaders(w)
	tenantContext, ok := propertyWorkspaceTenant(w, r)
	if !ok {
		return
	}
	var input ReorderPropertyAssetsInput
	if err := decodePropertyWorkspaceJSON(w, r, &input); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}
	items, err := handler.repo.ReorderPropertyAssets(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string][]map[string]any{"data": items})
}

func (handler Handler) SetPrimaryAsset(w http.ResponseWriter, r *http.Request) {
	setPropertyWorkspacePrivateHeaders(w)
	tenantContext, ok := propertyWorkspaceTenant(w, r)
	if !ok {
		return
	}
	var input SetPrimaryPropertyAssetInput
	if err := decodePropertyWorkspaceJSON(w, r, &input); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}
	items, err := handler.repo.SetPrimaryPropertyAsset(
		r.Context(), tenantContext, r.PathValue("id"), r.PathValue("assetId"), input,
	)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string][]map[string]any{"data": items})
}

func propertyWorkspaceTenant(w http.ResponseWriter, r *http.Request) (tenant.Context, bool) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return tenant.Context{}, false
	}
	return tenantContext, true
}
