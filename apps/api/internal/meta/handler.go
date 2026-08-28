package meta

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
)

const (
	webhookEventStoreTimeout = 5 * time.Second
	webhookEventLease        = 5 * time.Minute
	webhookProcessTimeout    = 2 * time.Minute
	metaWebhookMaxBodyBytes  = int64(1 << 20)
)

type webhookRepository interface {
	InsertWebhookEvent(context.Context, webhookEventContext, map[string]any, bool) (string, error)
	FinishWebhookEvent(context.Context, string, string, string, string) error
	MarkWebhookEventProcessing(context.Context, string, time.Duration) error
	ClaimPendingWebhookEvents(context.Context, int, time.Duration) ([]webhookEventJob, error)
	ProcessWebhookPayload(context.Context, string, map[string]any) (WebhookResponse, error)
}

type Handler struct {
	repo      webhookRepository
	config    Config
	publisher realtime.Publisher
}

func NewHandler(repo Repository, publishers ...realtime.Publisher) Handler {
	publisher := realtime.Publisher(realtime.NoopPublisher{})
	if len(publishers) > 0 && publishers[0] != nil {
		publisher = publishers[0]
	}
	return Handler{repo: repo, config: repo.config, publisher: publisher}
}

func (handler Handler) Webhook(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		handler.verifyWebhook(w, r)
	case http.MethodPost:
		handler.receiveWebhook(w, r)
	default:
		httpserver.WriteError(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "Method is not allowed.")
	}
}

func (handler Handler) verifyWebhook(w http.ResponseWriter, r *http.Request) {
	if strings.TrimSpace(handler.config.WebhookVerifyToken) == "" {
		httpserver.WriteError(w, r, http.StatusInternalServerError, "meta_verify_token_missing", "Meta webhook verify token is not configured.")
		return
	}

	query := r.URL.Query()
	if query.Get("hub.mode") != "subscribe" || query.Get("hub.verify_token") != handler.config.WebhookVerifyToken {
		httpserver.WriteError(w, r, http.StatusForbidden, "meta_webhook_verification_failed", "Meta webhook verification failed.")
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(query.Get("hub.challenge")))
}

func (handler Handler) receiveWebhook(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	appSecret := strings.TrimSpace(handler.config.AppSecret)
	if appSecret == "" {
		httpserver.WriteError(w, r, http.StatusInternalServerError, "meta_app_secret_missing", "Meta app secret is not configured.")
		return
	}

	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, metaWebhookMaxBodyBytes))
	if err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			httpserver.WriteError(w, r, http.StatusRequestEntityTooLarge, "meta_webhook_body_too_large", "Webhook body is too large.")
			return
		}
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_meta_webhook_body", "Webhook body could not be read.")
		return
	}

	if !verifySignature(raw, r.Header.Get("X-Hub-Signature-256"), appSecret) {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "invalid_meta_webhook_signature", "Meta webhook signature is invalid.")
		return
	}

	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}
	if payload == nil {
		payload = map[string]any{}
	}

	eventContext := extractWebhookEventContext(payload)
	storeCtx, cancelStore := contextWithTimeout(r.Context(), webhookEventStoreTimeout)
	eventID, eventErr := handler.repo.InsertWebhookEvent(storeCtx, eventContext, payload, true)
	cancelStore()
	if eventErr != nil {
		httpserver.WriteError(w, r, http.StatusServiceUnavailable, "meta_webhook_event_failed", "Unable to register Meta webhook event.")
		return
	}

	claimCtx, cancelClaim := contextWithTimeout(r.Context(), 2*time.Second)
	claimErr := handler.repo.MarkWebhookEventProcessing(claimCtx, eventID, webhookEventLease)
	cancelClaim()
	warnings := []string{"queued"}
	if claimErr == nil {
		go handler.processWebhookPayloadAsync(eventID, payload)
	} else {
		warnings = append(warnings, "deferred_processing")
	}

	httpserver.WriteJSON(w, http.StatusOK, WebhookResponse{
		OK:       true,
		EventID:  eventID,
		Warnings: warnings,
	})
}

func (handler Handler) processWebhookPayloadAsync(eventID string, payload map[string]any) {
	ctx, cancel := context.WithTimeout(context.Background(), webhookProcessTimeout)
	defer cancel()

	response, err := handler.repo.ProcessWebhookPayload(ctx, eventID, payload)
	if err != nil {
		_ = handler.repo.FinishWebhookEvent(context.Background(), eventID, "", "failed", err.Error())
		return
	}
	handler.publishWebhookResults(response)
}

func (handler Handler) publishWebhookResults(response WebhookResponse) {
	for _, result := range response.Results {
		if result.Status != "processed" || result.OrganizationID == "" || result.LeadID == "" {
			continue
		}
		handler.publisher.Publish(realtime.NewEvent("lead.meta_webhook_received", result.OrganizationID, "", map[string]any{
			"leadId":    result.LeadID,
			"leadgenId": result.LeadgenID,
			"formId":    result.FormID,
			"pageId":    result.PageID,
			"reentry":   result.Reentry,
		}))
	}
	for _, result := range response.MessagingResults {
		if result.Status != "processed" || result.OrganizationID == "" || result.MessageID == "" {
			continue
		}
		handler.publisher.Publish(realtime.NewEvent("meta.message.received", result.OrganizationID, "", map[string]any{
			"conversationId":    result.ConversationID,
			"messageId":         result.MessageID,
			"externalMessageId": result.ExternalMessageID,
			"pageId":            result.PageID,
			"platform":          result.Platform,
		}))
	}
}

func contextWithTimeout(parent context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout <= 0 {
		return context.WithCancel(parent)
	}
	return context.WithTimeout(parent, timeout)
}

func verifySignature(raw []byte, signatureHeader string, appSecret string) bool {
	appSecret = strings.TrimSpace(appSecret)
	signatureHeader = strings.TrimSpace(signatureHeader)
	if appSecret == "" || signatureHeader == "" {
		return false
	}

	const prefix = "sha256="
	if !strings.HasPrefix(signatureHeader, prefix) {
		return false
	}

	provided, err := hex.DecodeString(strings.TrimPrefix(signatureHeader, prefix))
	if err != nil {
		return false
	}

	mac := hmac.New(sha256.New, []byte(appSecret))
	_, _ = mac.Write(raw)
	return hmac.Equal(provided, mac.Sum(nil))
}

func (context webhookEventContext) OrganizationID() string {
	return ""
}
