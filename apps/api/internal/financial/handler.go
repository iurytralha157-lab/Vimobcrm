package financial

import (
	"encoding/json"
	"errors"
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

func (handler Handler) ListCategories(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListCategories(r.Context(), tenantContext)
	writeData(w, r, items, err)
}

func (handler Handler) CreateCategory(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	payload, ok := decodeMap(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.CreateCategory(r.Context(), tenantContext, payload)
	writeCreated(w, r, item, err)
}

func (handler Handler) ListEntries(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListEntries(r.Context(), tenantContext, r.URL.Query())
	writeData(w, r, items, err)
}

func (handler Handler) CreateEntry(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	payload, ok := decodeMap(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.CreateEntry(r.Context(), tenantContext, payload)
	writeCreated(w, r, item, err)
}

func (handler Handler) UpdateEntry(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	payload, ok := decodeMap(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.UpdateEntry(r.Context(), tenantContext, r.PathValue("id"), payload)
	writeData(w, r, item, err)
}

func (handler Handler) DeleteEntry(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	err := handler.repo.DeleteEntry(r.Context(), tenantContext, r.PathValue("id"))
	writeOK(w, r, err)
}

func (handler Handler) MarkEntryPaid(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	payload, ok := decodeMap(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.MarkEntryPaid(r.Context(), tenantContext, r.PathValue("id"), payload)
	writeData(w, r, item, err)
}

func (handler Handler) Dashboard(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.Dashboard(r.Context(), tenantContext)
	writeData(w, r, item, err)
}

func (handler Handler) ListContracts(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListContracts(r.Context(), tenantContext, r.URL.Query())
	writeData(w, r, items, err)
}

func (handler Handler) ShowContract(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.ShowContract(r.Context(), tenantContext, r.PathValue("id"))
	writeData(w, r, item, err)
}

func (handler Handler) CreateContract(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	payload, ok := decodeMap(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.CreateContract(r.Context(), tenantContext, payload)
	writeCreated(w, r, item, err)
}

func (handler Handler) UpdateContract(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	payload, ok := decodeMap(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.UpdateContract(r.Context(), tenantContext, r.PathValue("id"), payload)
	writeData(w, r, item, err)
}

func (handler Handler) DeleteContract(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	err := handler.repo.DeleteContract(r.Context(), tenantContext, r.PathValue("id"))
	writeOK(w, r, err)
}

func (handler Handler) ActivateContract(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	var request ContractActivationRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	item, err := handler.repo.ActivateContract(r.Context(), tenantContext, r.PathValue("id"), request.SkipCommissions)
	writeData(w, r, item, err)
}

func (handler Handler) RegenerateCommissions(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.RegenerateCommissions(r.Context(), tenantContext, r.PathValue("id"))
	writeData(w, r, item, err)
}

func (handler Handler) ListContractDocuments(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListContractDocuments(r.Context(), tenantContext, r.PathValue("id"))
	writeData(w, r, items, err)
}

func (handler Handler) UploadContractDocument(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 26<<20)
	if err := r.ParseMultipartForm(26 << 20); err != nil {
		writeFinancialError(w, r, ErrInvalidInput)
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeFinancialError(w, r, ErrInvalidInput)
		return
	}
	defer file.Close()
	if header.Size <= 0 || header.Size > 25*1024*1024 {
		writeFinancialError(w, r, ErrInvalidInput)
		return
	}
	contentType := header.Header.Get("Content-Type")
	item, err := handler.repo.UploadContractDocument(r.Context(), tenantContext, r.PathValue("id"), header.Filename, header.Size, contentType, file)
	writeCreated(w, r, item, err)
}

func (handler Handler) DeleteContractDocument(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	var request ContractDocumentRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	err := handler.repo.DeleteContractDocument(r.Context(), tenantContext, r.PathValue("id"), request.Path)
	writeOK(w, r, err)
}

func (handler Handler) ContractDocumentSignedURL(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	var request ContractDocumentRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	item, err := handler.repo.ContractDocumentSignedURL(r.Context(), tenantContext, r.PathValue("id"), request.Path)
	writeData(w, r, item, err)
}

func (handler Handler) ListCommissionRules(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListCommissionRules(r.Context(), tenantContext)
	writeData(w, r, items, err)
}

func (handler Handler) CreateCommissionRule(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	payload, ok := decodeMap(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.CreateCommissionRule(r.Context(), tenantContext, payload)
	writeCreated(w, r, item, err)
}

func (handler Handler) UpdateCommissionRule(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	payload, ok := decodeMap(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.UpdateCommissionRule(r.Context(), tenantContext, r.PathValue("id"), payload)
	writeData(w, r, item, err)
}

func (handler Handler) DeleteCommissionRule(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	err := handler.repo.DeleteCommissionRule(r.Context(), tenantContext, r.PathValue("id"))
	writeOK(w, r, err)
}

func (handler Handler) ListCommissions(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListCommissions(r.Context(), tenantContext, r.URL.Query())
	writeData(w, r, items, err)
}

func (handler Handler) CommissionStatus(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	var request CommissionStatusRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	action := strings.TrimSpace(r.PathValue("action"))
	item, err := handler.repo.UpdateCommissionStatus(r.Context(), tenantContext, r.PathValue("id"), action, request)
	writeData(w, r, item, err)
}

func (handler Handler) CommissionsByBroker(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.CommissionsByBroker(r.Context(), tenantContext)
	writeData(w, r, items, err)
}

func (handler Handler) DREInput(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.DREInput(r.Context(), tenantContext, r.URL.Query())
	writeData(w, r, item, err)
}

func (handler Handler) DREGroups(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.DREGroups(r.Context(), tenantContext)
	writeData(w, r, items, err)
}

func (handler Handler) DREMappings(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.DREMappings(r.Context(), tenantContext)
	writeData(w, r, items, err)
}

func (handler Handler) CreateDREMapping(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	payload, ok := decodeMap(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.CreateDREMapping(r.Context(), tenantContext, payload)
	writeCreated(w, r, item, err)
}

func (handler Handler) DeleteDREMapping(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	err := handler.repo.DeleteDREMapping(r.Context(), tenantContext, r.PathValue("id"))
	writeOK(w, r, err)
}

func (handler Handler) InitializeDREGroups(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	err := handler.repo.InitializeDREGroups(r.Context(), tenantContext)
	writeOK(w, r, err)
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

func writeData[T any](w http.ResponseWriter, r *http.Request, data T, err error) {
	if err != nil {
		writeFinancialError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[T]{Data: data})
}

func writeCreated[T any](w http.ResponseWriter, r *http.Request, data T, err error) {
	if err != nil {
		writeFinancialError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[T]{Data: data})
}

func writeOK(w http.ResponseWriter, r *http.Request, err error) {
	if err != nil {
		writeFinancialError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func parsePositiveInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed < 1 {
		return fallback
	}
	return parsed
}

func writeFinancialError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_financial_input", "Financial input is invalid.")
	case errors.Is(err, ErrNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "financial_resource_not_found", "Financial resource was not found.")
	case errors.Is(err, ErrPermissionDenied), errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "financial_operation_failed", "Unable to complete financial operation.")
	}
}
