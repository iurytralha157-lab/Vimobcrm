package properties

import (
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const propertyLocationBodyLimit = 1 << 20

type cityRequest struct {
	Name string `json:"name"`
	UF   string `json:"uf"`
}

type cityUpdateRequest = CityUpdateInput

type neighborhoodRequest struct {
	Name   string `json:"name"`
	CityID string `json:"city_id"`
}

type neighborhoodUpdateRequest = NeighborhoodUpdateInput

type condominiumRequest struct {
	Name                  string   `json:"name"`
	CityID                string   `json:"city_id"`
	NeighborhoodID        string   `json:"neighborhood_id"`
	Address               string   `json:"address"`
	PhotoURL              string   `json:"photo_url"`
	CEP                   string   `json:"cep"`
	Number                string   `json:"number"`
	Complement            string   `json:"complement"`
	DefaultCondominiumFee *float64 `json:"default_condominium_fee"`
	HasConcierge          bool     `json:"has_concierge"`
	ConciergeType         string   `json:"concierge_type"`
	Notes                 string   `json:"notes"`
	Latitude              *float64 `json:"latitude"`
	Longitude             *float64 `json:"longitude"`
}

type condominiumUpdateRequest = CondominiumUpdateInput

func (handler Handler) ListCities(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	items, err := handler.repo.ListCities(r.Context(), tenantContext)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]Location{"data": items})
}

func (handler Handler) CreateCity(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	var request cityRequest
	if err := httpserver.DecodeJSON(w, r, &request, propertyLocationBodyLimit); err != nil {
		return
	}

	item, err := handler.repo.CreateCity(r.Context(), tenantContext, CityInput{Name: request.Name, UF: request.UF})
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, map[string]Location{"data": item})
}

func (handler Handler) DeleteCity(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	var request catalogVersionRequest
	if err := httpserver.DecodeJSON(w, r, &request, propertyLocationBodyLimit); err != nil {
		return
	}
	if err := handler.repo.DeleteCity(r.Context(), tenantContext, r.PathValue("id"), request.ExpectedUpdatedAt); err != nil {
		writePropertyError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) UpdateCity(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}
	var request cityUpdateRequest
	if err := httpserver.DecodeJSON(w, r, &request, propertyLocationBodyLimit); err != nil {
		return
	}
	item, err := handler.repo.UpdateCity(r.Context(), tenantContext, r.PathValue("id"), CityUpdateInput{
		Name:              request.Name,
		UF:                request.UF,
		ExpectedUpdatedAt: request.ExpectedUpdatedAt,
	})
	if err != nil {
		writePropertyError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]Location{"data": item})
}

func (handler Handler) ListNeighborhoods(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	items, err := handler.repo.ListNeighborhoods(r.Context(), tenantContext, r.URL.Query().Get("cityId"))
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]Location{"data": items})
}

func (handler Handler) CreateNeighborhood(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	var request neighborhoodRequest
	if err := httpserver.DecodeJSON(w, r, &request, propertyLocationBodyLimit); err != nil {
		return
	}

	item, err := handler.repo.CreateNeighborhood(r.Context(), tenantContext, NeighborhoodInput{Name: request.Name, CityID: request.CityID})
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, map[string]Location{"data": item})
}

func (handler Handler) DeleteNeighborhood(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	var request catalogVersionRequest
	if err := httpserver.DecodeJSON(w, r, &request, propertyLocationBodyLimit); err != nil {
		return
	}
	if err := handler.repo.DeleteNeighborhood(r.Context(), tenantContext, r.PathValue("id"), request.ExpectedUpdatedAt); err != nil {
		writePropertyError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) UpdateNeighborhood(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}
	var request neighborhoodUpdateRequest
	if err := httpserver.DecodeJSON(w, r, &request, propertyLocationBodyLimit); err != nil {
		return
	}
	item, err := handler.repo.UpdateNeighborhood(r.Context(), tenantContext, r.PathValue("id"), NeighborhoodUpdateInput{
		Name:              request.Name,
		CityID:            request.CityID,
		ExpectedUpdatedAt: request.ExpectedUpdatedAt,
	})
	if err != nil {
		writePropertyError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]Location{"data": item})
}

func (handler Handler) ListCondominiums(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	items, err := handler.repo.ListCondominiums(r.Context(), tenantContext, r.URL.Query().Get("neighborhoodId"))
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]Location{"data": items})
}

func (handler Handler) CreateCondominium(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	var request condominiumRequest
	if err := httpserver.DecodeJSON(w, r, &request, propertyLocationBodyLimit); err != nil {
		return
	}

	item, err := handler.repo.CreateCondominium(r.Context(), tenantContext, CondominiumInput{
		Name:                  request.Name,
		CityID:                request.CityID,
		NeighborhoodID:        request.NeighborhoodID,
		Address:               request.Address,
		PhotoURL:              request.PhotoURL,
		CEP:                   request.CEP,
		Number:                request.Number,
		Complement:            request.Complement,
		DefaultCondominiumFee: request.DefaultCondominiumFee,
		HasConcierge:          request.HasConcierge,
		ConciergeType:         request.ConciergeType,
		Notes:                 request.Notes,
		Latitude:              request.Latitude,
		Longitude:             request.Longitude,
	})
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, map[string]Location{"data": item})
}

func (handler Handler) DeleteCondominium(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	var request catalogVersionRequest
	if err := httpserver.DecodeJSON(w, r, &request, propertyLocationBodyLimit); err != nil {
		return
	}
	if err := handler.repo.DeleteCondominium(r.Context(), tenantContext, r.PathValue("id"), request.ExpectedUpdatedAt); err != nil {
		writePropertyError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) UpdateCondominium(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}
	var request condominiumUpdateRequest
	if err := httpserver.DecodeJSON(w, r, &request, propertyLocationBodyLimit); err != nil {
		return
	}
	item, err := handler.repo.UpdateCondominium(r.Context(), tenantContext, r.PathValue("id"), CondominiumUpdateInput{
		Name:                  request.Name,
		CityID:                request.CityID,
		NeighborhoodID:        request.NeighborhoodID,
		Address:               request.Address,
		PhotoURL:              request.PhotoURL,
		CEP:                   request.CEP,
		Number:                request.Number,
		Complement:            request.Complement,
		DefaultCondominiumFee: request.DefaultCondominiumFee,
		HasConcierge:          request.HasConcierge,
		ConciergeType:         request.ConciergeType,
		Notes:                 request.Notes,
		Latitude:              request.Latitude,
		Longitude:             request.Longitude,
		ExpectedUpdatedAt:     request.ExpectedUpdatedAt,
	})
	if err != nil {
		writePropertyError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]Location{"data": item})
}
