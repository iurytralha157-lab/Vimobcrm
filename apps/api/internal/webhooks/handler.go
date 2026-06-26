package webhooks

import (
	"encoding/json"
	"errors"
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

func NewHandler(repo Repository, publishers ...realtime.Publisher) Handler {
	publisher := realtime.Publisher(realtime.NoopPublisher{})
	if len(publishers) > 0 && publishers[0] != nil {
		publisher = publishers[0]
	}
	return Handler{repo: repo, publisher: publisher}
}

func (handler Handler) List(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.List(r.Context(), tenantContext)
	if err != nil {
		writeWebhookError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) Create(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	var request WebhookRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	item, err := handler.repo.Create(r.Context(), tenantContext, request)
	if err != nil {
		writeWebhookError(w, r, err)
		return
	}
	handler.publishWebhookEvent(tenantContext, "webhook.created", map[string]any{
		"webhook": item,
	})
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[map[string]any]{Data: item})
}

func (handler Handler) Update(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	var request WebhookRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	item, err := handler.repo.Update(r.Context(), tenantContext, r.PathValue("id"), request)
	if err != nil {
		writeWebhookError(w, r, err)
		return
	}
	handler.publishWebhookEvent(tenantContext, "webhook.updated", map[string]any{
		"webhookId": r.PathValue("id"),
		"webhook":   item,
	})
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	if err := handler.repo.Delete(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeWebhookError(w, r, err)
		return
	}
	handler.publishWebhookEvent(tenantContext, "webhook.deleted", map[string]any{
		"webhookId": r.PathValue("id"),
	})
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) RegenerateToken(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.RegenerateToken(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeWebhookError(w, r, err)
		return
	}
	handler.publishWebhookEvent(tenantContext, "webhook.token_regenerated", map[string]any{
		"webhookId": r.PathValue("id"),
		"webhook":   item,
	})
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) ReceiveLead(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	token := webhookToken(r)
	var payload map[string]any
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20))
	if err := decoder.Decode(&payload); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}
	if payload == nil {
		payload = map[string]any{}
	}

	result, err := handler.repo.ReceiveLead(r.Context(), token, payload)
	if err != nil {
		writeWebhookError(w, r, err)
		return
	}
	handler.publisher.Publish(realtime.NewEvent("lead.webhook_received", result.OrganizationID, "", map[string]any{
		"leadId":  result.LeadID,
		"reentry": result.Reentry,
	}))
	httpserver.WriteJSON(w, http.StatusOK, result)
}

func (handler Handler) publishWebhookEvent(tenantContext tenant.Context, eventType string, data map[string]any) {
	handler.publisher.Publish(realtime.NewEvent(eventType, tenantContext.OrganizationID, tenantContext.UserID, data))
}

func organizationContext(w http.ResponseWriter, r *http.Request) (tenant.Context, bool) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return tenant.Context{}, false
	}
	return tenantContext, true
}

func webhookToken(r *http.Request) string {
	for _, candidate := range []string{
		bearerToken(r.Header.Get("Authorization")),
		r.Header.Get("X-Webhook-Token"),
		r.URL.Query().Get("token"),
	} {
		if candidate != "" {
			return candidate
		}
	}
	return ""
}

func bearerToken(header string) string {
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(header, prefix))
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

func writeWebhookError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_webhook_input", "Webhook input is invalid.")
	case errors.Is(err, ErrInvalidToken):
		httpserver.WriteError(w, r, http.StatusUnauthorized, "invalid_webhook_token", "Webhook token is invalid or inactive.")
	case errors.Is(err, ErrWebhookNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "webhook_not_found", "Webhook was not found.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "webhook_operation_failed", "Unable to complete webhook operation.")
	}
}
