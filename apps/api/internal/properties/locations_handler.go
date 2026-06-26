package properties

import (
	"encoding/json"
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type cityRequest struct {
	Name string `json:"name"`
	UF   string `json:"uf"`
}

type neighborhoodRequest struct {
	Name   string `json:"name"`
	CityID string `json:"city_id"`
}

type condominiumRequest struct {
	Name           string   `json:"name"`
	CityID         string   `json:"city_id"`
	NeighborhoodID string   `json:"neighborhood_id"`
	Address        string   `json:"address"`
	Latitude       *float64 `json:"latitude"`
	Longitude      *float64 `json:"longitude"`
}

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

	defer r.Body.Close()
	var request cityRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
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

	if err := handler.repo.DeleteCity(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writePropertyError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
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

	defer r.Body.Close()
	var request neighborhoodRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
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

	if err := handler.repo.DeleteNeighborhood(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writePropertyError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
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

	defer r.Body.Close()
	var request condominiumRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	item, err := handler.repo.CreateCondominium(r.Context(), tenantContext, CondominiumInput{
		Name:           request.Name,
		CityID:         request.CityID,
		NeighborhoodID: request.NeighborhoodID,
		Address:        request.Address,
		Latitude:       request.Latitude,
		Longitude:      request.Longitude,
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

	if err := handler.repo.DeleteCondominium(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writePropertyError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
