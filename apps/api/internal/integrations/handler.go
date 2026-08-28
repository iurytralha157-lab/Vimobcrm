package integrations

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/publicingress"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Handler struct {
	repo                   Repository
	publicClientIPResolver publicingress.ClientIPResolver
}

func NewHandler(repo Repository) Handler {
	return Handler{repo: repo}
}

func (handler Handler) WithPublicClientIPResolver(resolver publicingress.ClientIPResolver) Handler {
	handler.publicClientIPResolver = resolver
	return handler
}

func (handler Handler) InvokeFunction(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	body, err := readJSONBodyWithOrganization(r, tenantContext.OrganizationID)
	if err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	handler.invokeAuthorizedFunction(
		w,
		r,
		r.PathValue("name"),
		r.Header.Get("Authorization"),
		body,
	)
}

func (handler Handler) CreateSubscriptionCharge(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	body, err := readJSONBodyWithOrganization(r, tenantContext.OrganizationID)
	if err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	handler.invokeAuthorizedFunction(
		w,
		r,
		"asaas-create-charge",
		r.Header.Get("Authorization"),
		body,
	)
}

func (handler Handler) invokeAuthorizedFunction(
	w http.ResponseWriter,
	r *http.Request,
	name string,
	authorization string,
	body []byte,
) {
	response, err := handler.repo.InvokeFunctionRequest(
		r.Context(),
		name,
		http.MethodPost,
		authorization,
		body,
		nil,
		handler.publicClientIPResolver.Resolve(r),
	)
	if err != nil {
		writeIntegrationError(w, r, err)
		return
	}
	writeFunctionResponse(w, response)
}

func writeFunctionResponse(w http.ResponseWriter, response FunctionResponse) {
	contentType := response.ContentType
	if contentType == "" {
		contentType = "application/json"
	}
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(response.StatusCode)
	_, _ = w.Write(response.Body)
}

func (handler Handler) PublicCheckoutInfo(w http.ResponseWriter, r *http.Request) {
	handler.invokePublicFunction(w, r, "asaas-checkout-info", http.MethodGet)
}

func (handler Handler) PublicPaymentStatus(w http.ResponseWriter, r *http.Request) {
	handler.invokePublicFunction(w, r, "asaas-payment-status", http.MethodGet)
}

func (handler Handler) PublicCreateCharge(w http.ResponseWriter, r *http.Request) {
	handler.invokePublicFunction(w, r, "asaas-create-charge", http.MethodPost)
}

func (handler Handler) PublicCancelPayment(w http.ResponseWriter, r *http.Request) {
	handler.invokePublicFunction(w, r, "asaas-cancel-payment", http.MethodPost)
}

func (handler Handler) invokePublicFunction(w http.ResponseWriter, r *http.Request, name string, method string) {
	// Public billing capabilities may return masked customer data, payment
	// state and short-lived payment artifacts. Keep every response out of
	// browser/proxy caches even if an upstream function forgets the header.
	w.Header().Set("Cache-Control", "private, no-store, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Vary", "Authorization")

	body := []byte{}
	if method != http.MethodGet {
		defer r.Body.Close()
		var err error
		body, err = io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_body", "Request body is invalid.")
			return
		}
		if len(bytes.TrimSpace(body)) == 0 {
			body = []byte("{}")
		}
	}

	response, err := handler.repo.InvokeFunctionRequest(
		r.Context(),
		name,
		method,
		r.Header.Get("Authorization"),
		body,
		r.URL.Query(),
		handler.publicClientIPResolver.Resolve(r),
	)
	if err != nil {
		writeIntegrationError(w, r, err)
		return
	}
	contentType := response.ContentType
	if contentType == "" {
		contentType = "application/json"
	}
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(response.StatusCode)
	_, _ = w.Write(response.Body)
}

func (handler Handler) GetVista(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.GetVista(r.Context(), tenantContext)
	if errors.Is(err, ErrIntegrationNotFound) {
		httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: nil})
		return
	}
	if err != nil {
		writeIntegrationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) SaveVista(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	var request VistaIntegrationRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	item, err := handler.repo.SaveVista(r.Context(), tenantContext, request)
	if err != nil {
		writeIntegrationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) DeleteVista(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	if err := handler.repo.DeleteVista(r.Context(), tenantContext); err != nil && !errors.Is(err, ErrIntegrationNotFound) {
		writeIntegrationError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) GetImoview(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.GetImoview(r.Context(), tenantContext)
	if errors.Is(err, ErrIntegrationNotFound) {
		httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: nil})
		return
	}
	if err != nil {
		writeIntegrationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) SaveImoview(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	var request ImoviewIntegrationRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	item, err := handler.repo.SaveImoview(r.Context(), tenantContext, request)
	if err != nil {
		writeIntegrationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) DeleteImoview(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	if err := handler.repo.DeleteImoview(r.Context(), tenantContext); err != nil && !errors.Is(err, ErrIntegrationNotFound) {
		writeIntegrationError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) ListMetaIntegrations(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListMetaIntegrations(r.Context(), tenantContext)
	if err != nil {
		writeIntegrationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) SaveMetaConversionFeedback(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	var request MetaConversionFeedbackRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	item, err := handler.repo.SaveMetaConversionFeedback(r.Context(), tenantContext, request)
	if err != nil {
		writeIntegrationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) ListMetaPageForms(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	items, err := handler.repo.ListMetaPageForms(r.Context(), tenantContext, r.PathValue("pageId"))
	if err != nil {
		writeIntegrationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]any{"forms": items})
}

func (handler Handler) ShowMetaOAuthFlow(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.GetMetaOAuthFlow(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeIntegrationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) ListMetaFormConfigs(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListMetaFormConfigs(r.Context(), tenantContext, r.URL.Query().Get("integrationId"))
	if err != nil {
		writeIntegrationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) SaveMetaFormConfig(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	var request MetaFormConfigRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	item, err := handler.repo.SaveMetaFormConfig(r.Context(), tenantContext, request)
	if err != nil {
		writeIntegrationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) ToggleMetaFormConfig(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	var request ToggleMetaFormConfigRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	if err := handler.repo.ToggleMetaFormConfig(r.Context(), tenantContext, request); err != nil {
		writeIntegrationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) DeleteMetaFormConfig(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	if err := handler.repo.DeleteMetaFormConfig(r.Context(), tenantContext, r.URL.Query().Get("integrationId"), r.URL.Query().Get("formId")); err != nil {
		writeIntegrationError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) MetaWebhookHealth(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.MetaWebhookHealth(r.Context(), tenantContext)
	if err != nil {
		writeIntegrationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) ListMetaConversations(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListMetaConversations(r.Context(), tenantContext, r.URL.Query().Get("pageId"))
	if err != nil {
		writeIntegrationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) ListMetaMessages(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListMetaMessages(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeIntegrationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) SendMetaMessage(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	var request SendMetaMessageRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	result, err := handler.repo.SendMetaMessage(r.Context(), tenantContext, r.PathValue("id"), request)
	if err != nil {
		writeIntegrationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, result.StatusCode, Envelope[map[string]any]{Data: result.Message})
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

func readJSONBodyWithOrganization(r *http.Request, organizationID string) ([]byte, error) {
	defer r.Body.Close()
	body, err := io.ReadAll(http.MaxBytesReader(nilResponseWriter{}, r.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	if len(bytes.TrimSpace(body)) == 0 {
		body = []byte("{}")
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	payload["organization_id"] = organizationID
	payload["organizationId"] = organizationID
	return json.Marshal(payload)
}

type nilResponseWriter struct{}

func (nilResponseWriter) Header() http.Header {
	return http.Header{}
}

func (nilResponseWriter) Write(bytes []byte) (int, error) {
	return len(bytes), nil
}

func (nilResponseWriter) WriteHeader(statusCode int) {}

func writeIntegrationError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrBillingCheckoutUnavailable):
		httpserver.WriteError(w, r, http.StatusServiceUnavailable, "billing_checkout_unavailable", "Billing checkout is temporarily unavailable.")
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_integration_input", "Integration input is invalid.")
	case errors.Is(err, ErrFunctionNotAllowed):
		httpserver.WriteError(w, r, http.StatusForbidden, "integration_function_not_allowed", "Integration function is not allowed.")
	case errors.Is(err, ErrIntegrationNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "integration_not_found", "Integration was not found.")
	case errors.Is(err, ErrMetaUpstream):
		httpserver.WriteError(w, r, http.StatusBadGateway, "meta_upstream_failed", "Meta could not complete the request.")
	case errors.Is(err, ErrIdempotencyConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "idempotency_conflict", "This request key is already bound to another message.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "integration_operation_failed", "Unable to complete integration operation.")
	}
}
