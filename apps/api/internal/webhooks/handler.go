package webhooks

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/publicingress"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Handler struct {
	repo                   Repository
	publisher              realtime.Publisher
	publicClientIPResolver publicingress.ClientIPResolver
}

func NewHandler(repo Repository, publishers ...realtime.Publisher) Handler {
	publisher := realtime.Publisher(realtime.NoopPublisher{})
	if len(publishers) > 0 && publishers[0] != nil {
		publisher = publishers[0]
	}
	return Handler{repo: repo, publisher: publisher}
}

func (handler Handler) WithPublicClientIPResolver(
	resolver publicingress.ClientIPResolver,
) Handler {
	handler.publicClientIPResolver = resolver
	return handler
}

func (handler Handler) List(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
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
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	var request WebhookRequest
	if err := httpserver.DecodeJSON(w, r, &request, 1<<20); err != nil {
		return
	}
	item, err := handler.repo.Create(r.Context(), tenantContext, request)
	if err != nil {
		writeWebhookError(w, r, err)
		return
	}
	handler.publishWebhookEvent(
		tenantContext,
		"webhook.created",
		webhookEventData(webhookIDFromItem(item)),
	)
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[map[string]any]{Data: item})
}

func (handler Handler) Update(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	var request WebhookRequest
	if err := httpserver.DecodeJSON(w, r, &request, 1<<20); err != nil {
		return
	}
	item, err := handler.repo.Update(r.Context(), tenantContext, r.PathValue("id"), request)
	if err != nil {
		writeWebhookError(w, r, err)
		return
	}
	handler.publishWebhookEvent(
		tenantContext,
		"webhook.updated",
		webhookEventData(r.PathValue("id")),
	)
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	if err := handler.repo.Delete(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeWebhookError(w, r, err)
		return
	}
	handler.publishWebhookEvent(
		tenantContext,
		"webhook.deleted",
		webhookEventData(r.PathValue("id")),
	)
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) RegenerateToken(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.RegenerateToken(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeWebhookError(w, r, err)
		return
	}
	handler.publishWebhookEvent(
		tenantContext,
		"webhook.token_regenerated",
		webhookEventData(r.PathValue("id")),
	)
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) ReceiveLead(w http.ResponseWriter, r *http.Request) {
	token := webhookToken(r)
	if err := handler.repo.AllowIncomingWebhook(
		r.Context(),
		handler.publicClientIPResolver.Resolve(r),
		token,
	); err != nil {
		writeWebhookError(w, r, err)
		return
	}
	payload, ok := httpserver.DecodeJSONMap(w, r, 2<<20)
	if !ok {
		return
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

func webhookEventData(webhookID string) map[string]any {
	return map[string]any{"webhookId": strings.TrimSpace(webhookID)}
}

func webhookIDFromItem(item map[string]any) string {
	id, _ := item["id"].(string)
	return id
}

func webhookToken(r *http.Request) string {
	if r == nil {
		return ""
	}
	authorization := strings.TrimSpace(r.Header.Get("Authorization"))
	bearer := bearerToken(authorization)
	headerToken := strings.TrimSpace(r.Header.Get("X-Webhook-Token"))
	if authorization != "" && bearer == "" {
		return ""
	}
	if bearer != "" && headerToken != "" && subtle.ConstantTimeCompare([]byte(bearer), []byte(headerToken)) != 1 {
		return ""
	}
	if bearer != "" {
		return bearer
	}
	return headerToken
}

func bearerToken(header string) string {
	scheme, token, ok := strings.Cut(strings.TrimSpace(header), " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return ""
	}
	return strings.TrimSpace(token)
}

func writeWebhookError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_webhook_input", "Webhook input is invalid.")
	case errors.Is(err, ErrInvalidToken):
		httpserver.WriteError(w, r, http.StatusUnauthorized, "invalid_webhook_token", "Webhook token is invalid or inactive.")
	case errors.Is(err, ErrWebhookNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "webhook_not_found", "Webhook was not found.")
	case errors.Is(err, ErrRateLimited):
		w.Header().Set("Retry-After", "60")
		httpserver.WriteError(w, r, http.StatusTooManyRequests, "webhook_rate_limited", "Webhook request rate limit exceeded.")
	case errors.Is(err, ErrIdempotencyConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "idempotency_conflict", "Webhook event id was already used with a different payload.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "webhook_operation_failed", "Unable to complete webhook operation.")
	}
}
