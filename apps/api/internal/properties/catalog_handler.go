package properties

import (
	"encoding/json"
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type catalogRequest struct {
	Name string  `json:"name"`
	Icon *string `json:"icon"`
}

type catalogSeedRequest struct {
	Names []string `json:"names"`
}

func (handler Handler) ListPropertyTypes(w http.ResponseWriter, r *http.Request) {
	handler.listCatalog(w, r, CatalogPropertyTypes)
}

func (handler Handler) CreatePropertyType(w http.ResponseWriter, r *http.Request) {
	handler.createCatalogItem(w, r, CatalogPropertyTypes)
}

func (handler Handler) ListPropertyFeatures(w http.ResponseWriter, r *http.Request) {
	handler.listCatalog(w, r, CatalogPropertyFeatures)
}

func (handler Handler) CreatePropertyFeature(w http.ResponseWriter, r *http.Request) {
	handler.createCatalogItem(w, r, CatalogPropertyFeatures)
}

func (handler Handler) SeedPropertyFeatures(w http.ResponseWriter, r *http.Request) {
	handler.seedCatalogItems(w, r, CatalogPropertyFeatures)
}

func (handler Handler) ListPropertyProximities(w http.ResponseWriter, r *http.Request) {
	handler.listCatalog(w, r, CatalogPropertyProximities)
}

func (handler Handler) CreatePropertyProximity(w http.ResponseWriter, r *http.Request) {
	handler.createCatalogItem(w, r, CatalogPropertyProximities)
}

func (handler Handler) SeedPropertyProximities(w http.ResponseWriter, r *http.Request) {
	handler.seedCatalogItems(w, r, CatalogPropertyProximities)
}

func (handler Handler) listCatalog(w http.ResponseWriter, r *http.Request, kind CatalogKind) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	items, err := handler.repo.ListCatalog(r.Context(), tenantContext, kind)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]CatalogItem{"data": items})
}

func (handler Handler) createCatalogItem(w http.ResponseWriter, r *http.Request, kind CatalogKind) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request catalogRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	item, err := handler.repo.CreateCatalogItem(r.Context(), tenantContext, kind, CatalogCreateInput{
		Name: request.Name,
		Icon: request.Icon,
	})
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, map[string]CatalogItem{"data": item})
}

func (handler Handler) seedCatalogItems(w http.ResponseWriter, r *http.Request, kind CatalogKind) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request catalogSeedRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	items, err := handler.repo.SeedCatalogItems(r.Context(), tenantContext, kind, request.Names)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, map[string][]CatalogItem{"data": items})
}
