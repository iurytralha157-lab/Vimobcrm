package properties

import (
	"encoding/json"
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type ownerRequest struct {
	Name             string `json:"name"`
	PhoneResidential string `json:"phone_residential"`
	PhoneCommercial  string `json:"phone_commercial"`
	Cellphone        string `json:"cellphone"`
	Email            string `json:"email"`
	MediaSource      string `json:"media_source"`
	NotifyEmail      bool   `json:"notify_email"`
	Notes            string `json:"notes"`
}

func (handler Handler) ListOwners(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	filter, err := parseOwnerListFilter(r.URL.Query())
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	page, err := handler.repo.ListOwnersPage(r.Context(), tenantContext, filter)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, struct {
		Data       []Owner `json:"data"`
		NextCursor *string `json:"next_cursor"`
		TotalCount int     `json:"total_count"`
	}{
		Data:       page.Items,
		NextCursor: page.NextCursor,
		TotalCount: page.TotalCount,
	})
}

func (handler Handler) CreateOwner(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request ownerRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	item, err := handler.repo.CreateOwner(r.Context(), tenantContext, OwnerInput{
		Name:             request.Name,
		PhoneResidential: request.PhoneResidential,
		PhoneCommercial:  request.PhoneCommercial,
		Cellphone:        request.Cellphone,
		Email:            request.Email,
		MediaSource:      request.MediaSource,
		NotifyEmail:      request.NotifyEmail,
		Notes:            request.Notes,
	})
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, map[string]Owner{"data": item})
}

func (handler Handler) UpdateOwner(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	ownerID := r.PathValue("id")
	defer r.Body.Close()
	var request ownerRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	item, err := handler.repo.UpdateOwner(r.Context(), tenantContext, ownerID, OwnerInput{
		Name:             request.Name,
		PhoneResidential: request.PhoneResidential,
		PhoneCommercial:  request.PhoneCommercial,
		Cellphone:        request.Cellphone,
		Email:            request.Email,
		MediaSource:      request.MediaSource,
		NotifyEmail:      request.NotifyEmail,
		Notes:            request.Notes,
	})
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]Owner{"data": item})
}
