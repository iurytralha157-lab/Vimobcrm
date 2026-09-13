package properties

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Handler struct {
	repo Repository
}

func NewHandler(repo Repository) Handler {
	return Handler{repo: repo}
}

func (handler Handler) List(w http.ResponseWriter, r *http.Request) {
	setPropertyWorkspacePrivateHeaders(w)
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	filter, err := ParseListFilter(r.URL.Query())
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	response, err := handler.repo.List(r.Context(), tenantContext, filter)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, response)
}

func (handler Handler) Stats(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	filter, err := ParseListFilter(r.URL.Query())
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	response, err := handler.repo.Stats(r.Context(), tenantContext, filter)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, response)
}

func (handler Handler) Show(w http.ResponseWriter, r *http.Request) {
	setPropertyWorkspacePrivateHeaders(w)
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	property, err := handler.repo.Get(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]Property{"data": property})
}

func (handler Handler) History(w http.ResponseWriter, r *http.Request) {
	setPropertyWorkspacePrivateHeaders(w)
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	events, err := handler.repo.ListHistory(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writePropertyError(w, r, err)
		return
	}
	canViewContacts, err := handler.repo.canViewPropertyOwnerContacts(r.Context(), tenantContext)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}
	for index := range events {
		if !canManageProperties(tenantContext) {
			redactPropertyHistoryInternalValues(&events[index])
		}
		if !canViewContacts {
			redactPropertyOwnerContactValues(events[index].Metadata)
		}
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]HistoryEvent{"data": events})
}

func (handler Handler) Create(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request propertyRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20))
	decoder.UseNumber()
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.ValidateCreate()
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	property, err := handler.repo.Create(r.Context(), tenantContext, input)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, map[string]Property{"data": property})
}

func (handler Handler) Update(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request propertyRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20))
	decoder.UseNumber()
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.ValidateUpdate()
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	property, err := handler.repo.Update(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]Property{"data": property})
}

func (handler Handler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var input DeletePropertyInput
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}
	if err := input.Validate(); err != nil {
		writePropertyError(w, r, err)
		return
	}

	if err := handler.repo.Delete(r.Context(), tenantContext, r.PathValue("id"), input); err != nil {
		writePropertyError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func writePropertyError(w http.ResponseWriter, r *http.Request, err error) {
	err = normalizeWorkspaceDatabaseError(err)
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_property_input", err.Error())
	case errors.Is(err, ErrNoChanges):
		httpserver.WriteError(w, r, http.StatusBadRequest, "no_property_changes", "No property changes were provided.")
	case errors.Is(err, ErrPropertyNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "property_not_found", "Property was not found.")
	case errors.Is(err, ErrPropertyHasLinkedLeads):
		httpserver.WriteError(w, r, http.StatusConflict, "property_has_linked_leads", "N\u00e3o \u00e9 poss\u00edvel excluir este im\u00f3vel porque h\u00e1 leads vinculados a ele. Desvincule o im\u00f3vel desses leads e tente novamente.")
	case errors.Is(err, ErrPropertyHasDependencies):
		httpserver.WriteError(w, r, http.StatusConflict, "property_has_dependencies", "N\u00e3o \u00e9 poss\u00edvel excluir este im\u00f3vel porque existem registros vinculados. Remova os v\u00ednculos e tente novamente.")
	case errors.Is(err, ErrPropertyLocationInUse):
		httpserver.WriteError(w, r, http.StatusConflict, "property_location_in_use", "Esta localidade est\u00e1 vinculada a im\u00f3veis ou a outros cadastros. Corrija os v\u00ednculos antes de desativ\u00e1-la.")
	case errors.Is(err, ErrPropertyLocationIdentityConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "property_location_identity_conflict", "J\u00e1 existe uma cidade, bairro ou condom\u00ednio com os mesmos dados, possivelmente desativado. Reative o cadastro existente ou use dados diferentes.")
	case errors.Is(err, ErrPropertyManagedByDevelopmentUnit):
		httpserver.WriteError(w, r, http.StatusConflict, "property_managed_by_development_unit", "Esta ficha est\u00e1 vinculada a uma unidade de empreendimento. Altere modalidade, status, pre\u00e7o e publica\u00e7\u00e3o pelo espelho do empreendimento.")
	case errors.Is(err, ErrPropertyOwnerNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "property_owner_not_found", "Property owner was not found.")
	case errors.Is(err, ErrPropertyOwnerInUse):
		httpserver.WriteError(w, r, http.StatusConflict, "property_owner_in_use", "O propriet\u00e1rio possui im\u00f3veis ativos vinculados. Encerre ou transfira os v\u00ednculos antes de desativ\u00e1-lo.")
	case errors.Is(err, ErrPropertyOwnerAssignmentInvalid):
		httpserver.WriteError(w, r, http.StatusConflict, "property_owner_assignment_invalid", "A associa\u00e7\u00e3o do propriet\u00e1rio n\u00e3o \u00e9 v\u00e1lida. Selecione um propriet\u00e1rio ativo desta organiza\u00e7\u00e3o e resolva eventuais nomes legados duplicados.")
	case errors.Is(err, ErrPropertyOwnerIdentityConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "property_owner_identity_conflict", "J\u00e1 existe um propriet\u00e1rio com a mesma identidade e dados diferentes. Selecione ou atualize o cadastro expl\u00edcito antes de vincul\u00e1-lo ao im\u00f3vel.")
	case errors.Is(err, ErrPropertyOwnershipConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "property_ownership_conflict", "Este im\u00f3vel possui copropriedade ou participa\u00e7\u00f5es personalizadas. Altere os propriet\u00e1rios pela ficha detalhada.")
	case errors.Is(err, ErrPropertyOwnershipNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "property_ownership_not_found", "Property ownership was not found.")
	case errors.Is(err, ErrPropertyAssetNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "property_asset_not_found", "Property asset was not found.")
	case errors.Is(err, ErrPropertyAssetPublished):
		httpserver.WriteError(w, r, http.StatusConflict, "property_asset_published", "A mídia integra uma versão publicada. Despublique os canais antes de alterar sua visibilidade, conteúdo ou excluí-la.")
	case errors.Is(err, ErrPropertyWorkspaceConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "property_workspace_conflict", "O imóvel foi alterado por outra pessoa. Atualize a página e tente novamente.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	case errors.Is(err, ErrStorageNotConfigured):
		httpserver.WriteError(w, r, http.StatusInternalServerError, "storage_not_configured", "Storage is not configured.")
	case errors.Is(err, ErrStorageOperation):
		httpserver.WriteError(w, r, http.StatusBadGateway, "storage_operation_failed", "Storage is temporarily unavailable.")
	default:
		slog.Error("property operation failed", "error", err)
		httpserver.WriteError(w, r, http.StatusInternalServerError, "property_operation_failed", "Unable to complete property operation.")
	}
}
