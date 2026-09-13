package leads

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptrace"
	"strings"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type notificationWhatsAppConfig struct {
	Enabled        bool              `json:"enabled"`
	Mode           string            `json:"mode"`
	WebhookURL     string            `json:"webhook_url"`
	URL            string            `json:"url"`
	Method         string            `json:"method"`
	Headers        map[string]string `json:"headers"`
	TimeoutSeconds int               `json:"timeout_seconds"`
	SessionID      string            `json:"session_id"`
	InstanceName   string            `json:"instance_name"`
	InstanceID     string            `json:"instance_id"`
	Token          string            `json:"token"`
	PhoneNumber    string            `json:"phone_number"`
}

type notificationWhatsAppSession struct {
	ID          string
	InstanceID  string
	InstanceKey string
	Token       string
}

func (repo Repository) dispatchWhatsAppNotification(ctx context.Context, tenantContext tenant.Context, request DispatchNotificationRequest, recipient notificationRecipient, title string, content string, eventKey string, dedupeKey string) (DispatchWhatsAppResult, error) {
	config, err := repo.getNotificationWhatsAppConfig(ctx)
	if err != nil {
		return DispatchWhatsAppResult{}, err
	}
	result := DispatchWhatsAppResult{Enabled: config.Enabled}
	if !config.Enabled {
		result.Error = "notification_whatsapp_disabled"
		return result, nil
	}

	to := strings.TrimSpace(recipient.WhatsApp)
	if strings.TrimSpace(to) == "" {
		result.Attempted = false
		result.Error = "recipient_whatsapp_missing"
		return result, nil
	}
	if rendered, found, err := repo.renderNotificationTemplateContent(ctx, tenantContext.OrganizationID, eventKey, "whatsapp", request.Variables); err != nil {
		return result, err
	} else if found {
		title = firstNotificationText(rendered.Title, title)
		content = firstNotificationText(rendered.Message, content)
		if rendered.Message != "" {
			if request.Variables == nil {
				request.Variables = map[string]any{}
			}
			request.Variables["__rendered_whatsapp_message"] = rendered.Message
		}
	}
	messageText := buildWhatsAppNotificationText(eventKey, title, content, request.Variables)
	idempotencyKey := notificationWhatsAppIdempotencyKey(tenantContext.OrganizationID, eventKey, dedupeKey)

	if !isPlatformTransactionalNotificationEvent(eventKey) {
		if session, found, err := repo.findNotificationWhatsAppSession(ctx, tenantContext.OrganizationID); err != nil {
			return result, err
		} else if found {
			// Sender selection is complete before the provider call. Once an
			// organization sender is selected, this attempt never switches phone
			// numbers; the durable worker may retry only after a definitive result.
			return repo.dispatchWhatsAppViaEvolutionGo(ctx, session, to, messageText, "evolution_go_org_session", idempotencyKey)
		}
	}

	if notificationConfigUsesDirectInstance(config) {
		globalResult, err := repo.dispatchWhatsAppViaEvolutionGo(ctx, notificationWhatsAppSession{
			InstanceID:  strings.TrimSpace(config.InstanceID),
			InstanceKey: firstNotificationText(config.InstanceName, config.InstanceID),
			Token:       strings.TrimSpace(config.Token),
		}, to, messageText, "evolution_go_global_instance", idempotencyKey)
		if err == nil && globalResult.OK {
			return globalResult, nil
		}
		return globalResult, err
	}

	result.Error = "notification_whatsapp_sender_missing"
	return result, nil
}

func shouldFallbackToGlobalNotificationWhatsAppSender(organizationResult DispatchWhatsAppResult) bool {
	// Once the request was written, a transport timeout has an ambiguous
	// outcome: the organization sender may already have accepted the message.
	// Trying the global sender here can create an immediate duplicate. Permanent
	// provider failures also remain bound to the selected sender/recipient.
	return !organizationResult.Attempted && !organizationResult.OutcomeUnknown && !organizationResult.Permanent
}

func notificationConfigUsesDirectInstance(config notificationWhatsAppConfig) bool {
	mode := strings.ToLower(strings.TrimSpace(config.Mode))
	if mode == "evolution_go_instance" || mode == "instance" || mode == "direct_instance" {
		return true
	}
	return strings.TrimSpace(firstNotificationText(config.InstanceName, config.InstanceID)) != ""
}

func (repo Repository) findNotificationWhatsAppSession(ctx context.Context, organizationID string) (notificationWhatsAppSession, bool, error) {
	var session notificationWhatsAppSession
	err := repo.db.Pool().QueryRow(ctx, `
		select
			ws.id::text,
			coalesce(nullif(ws.instance_id, ''), ''),
			coalesce(
				nullif(ws.advanced_settings->>'evolution_go_resolved_instance_key', ''),
				nullif(ws.instance_id, ''),
				nullif(ws.instance_name, '')
			),
			coalesce(nullif(ws.advanced_settings->>'token', ''), '')
		from public.whatsapp_sessions ws
		where ws.organization_id = $1::uuid
		  and ws.provider = 'evolution_go'
		  and coalesce(ws.is_active, true) = true
		  and coalesce(ws.status, '') = 'connected'
		  and coalesce(ws.is_notification_session, false) = true
		  and (
		    exists (
		      select 1
		      from public.organization_members selector
		      join public.users selector_user on selector_user.id = selector.user_id
		      where selector.organization_id = ws.organization_id
		        and selector.user_id::text = coalesce(
		          nullif(ws.advanced_settings->>'notification_sender_selected_by_user_id', ''),
		          ws.owner_user_id::text
		        )
		        and coalesce(selector.is_active, false) = true
		        and selector.deleted_at is null
		        and lower(coalesce(selector.role, '')) in ('owner', 'admin')
		        and coalesce(selector_user.is_active, false) = true
		    )
		    or exists (
		      select 1
		      from public.users selector_super_admin
		      where selector_super_admin.id::text = coalesce(
		        nullif(ws.advanced_settings->>'notification_sender_selected_by_user_id', ''),
		        ws.owner_user_id::text
		      )
		        and coalesce(selector_super_admin.is_active, false) = true
		        and lower(coalesce(selector_super_admin.role, '')) = 'super_admin'
		    )
		  )
		order by ws.last_connected_at desc nulls last, ws.created_at desc
		limit 1
	`, organizationID).Scan(&session.ID, &session.InstanceID, &session.InstanceKey, &session.Token)
	if errors.Is(err, pgx.ErrNoRows) {
		return notificationWhatsAppSession{}, false, nil
	}
	if err != nil {
		return notificationWhatsAppSession{}, false, err
	}
	return session, true, nil
}

func (repo Repository) dispatchWhatsAppViaEvolutionGo(ctx context.Context, session notificationWhatsAppSession, to string, text string, provider string, idempotencyKey string) (DispatchWhatsAppResult, error) {
	return repo.dispatchWhatsAppViaEvolutionGoWithClient(
		ctx,
		session,
		to,
		text,
		provider,
		idempotencyKey,
		&http.Client{Timeout: 15 * time.Second},
	)
}

func (repo Repository) dispatchWhatsAppViaEvolutionGoWithClient(
	ctx context.Context,
	session notificationWhatsAppSession,
	to string,
	text string,
	provider string,
	idempotencyKey string,
	client *http.Client,
) (DispatchWhatsAppResult, error) {
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	expectedMessageID := deterministicNotificationWhatsAppMessageID(idempotencyKey)
	result := DispatchWhatsAppResult{
		Enabled:           true,
		Attempted:         true,
		Provider:          provider,
		SessionID:         session.ID,
		InstanceID:        firstNotificationText(session.InstanceID, session.InstanceKey),
		ExpectedMessageID: expectedMessageID,
		IdempotencyKey:    idempotencyKey,
		Recipient:         normalizeNotificationWhatsAppRecipient(to),
	}
	if idempotencyKey == "" {
		result.Attempted = false
		result.Permanent = true
		result.Error = "notification_whatsapp_idempotency_key_missing"
		return result, fmt.Errorf("%w: WhatsApp notification idempotency key is required", ErrInvalidInput)
	}
	if strings.TrimSpace(repo.evolutionGoAPIURL) == "" {
		result.Error = "evolution_go_api_url_missing"
		return result, fmt.Errorf("%w: Evolution Go API URL is not configured", ErrInvalidInput)
	}

	token := strings.TrimSpace(session.Token)
	if token == "" {
		token = strings.TrimSpace(repo.evolutionGoAPIKey)
	}
	if token == "" {
		result.Error = "evolution_go_token_missing"
		return result, fmt.Errorf("%w: Evolution Go token is not configured", ErrInvalidInput)
	}

	payload := map[string]any{
		"number": normalizeNotificationWhatsAppRecipient(to),
		"text":   text,
		"id":     expectedMessageID,
	}
	rawPayload, err := json.Marshal(payload)
	if err != nil {
		return result, err
	}

	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, repo.evolutionGoAPIURL+"/send/text", bytes.NewReader(rawPayload))
	if err != nil {
		return result, err
	}
	httpRequest.Header.Set("Accept", "application/json")
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("apikey", token)
	if strings.TrimSpace(session.InstanceKey) != "" {
		httpRequest.Header.Set("instanceId", strings.TrimSpace(session.InstanceKey))
	}

	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	var requestWriteObserved atomic.Bool
	trace := &httptrace.ClientTrace{
		WroteRequest: func(httptrace.WroteRequestInfo) {
			// Once any request write completes (or reports a write error), the
			// provider may have observed the deterministic stanza. Retrying blindly
			// can duplicate a transactional message; the webhook must reconcile the
			// exact expected_message_id instead.
			requestWriteObserved.Store(true)
		},
	}
	httpRequest = httpRequest.WithContext(httptrace.WithClientTrace(httpRequest.Context(), trace))
	response, err := client.Do(httpRequest)
	if err != nil {
		if requestWriteObserved.Load() {
			result = evolutionGoOutcomeUnknown(result, err)
		} else {
			// DNS, dial and TLS failures before WroteRequest are definitive: the
			// provider did not observe the mutation, so the durable outbox may retry.
			result.Error = err.Error()
		}
		return result, err
	}
	defer response.Body.Close()

	result.Status = response.StatusCode
	result.RetryAfter = parseNotificationRetryAfter(response.Header.Get("Retry-After"), time.Now())
	raw, readErr := io.ReadAll(io.LimitReader(response.Body, 64*1024+1))
	if readErr != nil {
		if response.StatusCode >= 200 && response.StatusCode < 300 {
			result = evolutionGoOutcomeUnknown(result, readErr)
		} else {
			result.Error = readErr.Error()
		}
		return result, readErr
	}
	if len(raw) > 64*1024 {
		responseErr := errors.New("Evolution Go response exceeds the allowed size")
		if response.StatusCode >= 200 && response.StatusCode < 300 {
			result = evolutionGoOutcomeUnknown(result, responseErr)
		} else {
			result.Error = "evolution_go_response_too_large"
		}
		return result, responseErr
	}

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		result.Error = trimMax(firstNotificationText(strings.TrimSpace(string(raw)), response.Status), 240)
		if notificationWhatsAppMutationHTTPOutcomeUnknown(response.StatusCode) {
			responseErr := fmt.Errorf("Evolution Go send returned ambiguous HTTP %d: %s", response.StatusCode, result.Error)
			result = evolutionGoOutcomeUnknown(result, responseErr)
			return result, responseErr
		}
		return result, nil
	}

	providerMessageID := ""
	if len(bytes.TrimSpace(raw)) > 0 {
		var providerResponse map[string]any
		if err := json.Unmarshal(raw, &providerResponse); err != nil {
			responseErr := fmt.Errorf("Evolution Go returned an invalid success response: %w", err)
			result = evolutionGoOutcomeUnknown(result, responseErr)
			return result, responseErr
		}
		providerMessageID = notificationEvolutionProviderMessageID(providerResponse)
	}
	if providerMessageID != "" && providerMessageID != expectedMessageID {
		result.MessageID = providerMessageID
		result.Permanent = true
		result.Error = "evolution_go_provider_message_id_mismatch"
		return result, fmt.Errorf(
			"Evolution Go provider message id mismatch (expected %s, received %s)",
			expectedMessageID,
			providerMessageID,
		)
	}
	result.MessageID = firstNotificationText(providerMessageID, expectedMessageID)
	result.OK = true
	result.Sent = 1
	return result, nil
}

func evolutionGoOutcomeUnknown(result DispatchWhatsAppResult, err error) DispatchWhatsAppResult {
	result.OK = false
	result.Permanent = false
	result.OutcomeUnknown = true
	result.MessageID = firstNotificationText(result.MessageID, result.ExpectedMessageID)
	result.Error = "evolution_go_delivery_outcome_unknown"
	if err != nil && strings.TrimSpace(err.Error()) != "" {
		result.Error += ": " + trimMax(err.Error(), 200)
	}
	return result
}

func notificationWhatsAppMutationHTTPOutcomeUnknown(status int) bool {
	// Match the provider client contract: a mutation returning 408/425 or 5xx
	// may already have been accepted. 503 is deliberately terminal-ambiguous to
	// prevent duplicates; 429 remains a definitive, bounded retry signal and its
	// Retry-After value is preserved on the result.
	return status == http.StatusRequestTimeout || status == http.StatusTooEarly || status >= 500 && status <= 599
}

func notificationWhatsAppIdempotencyKey(organizationID string, eventKey string, dedupeKey string) string {
	dedupeKey = strings.TrimSpace(dedupeKey)
	if dedupeKey == "" {
		return ""
	}
	return "vimob:whatsapp:" + strings.TrimSpace(organizationID) + ":" + strings.TrimSpace(eventKey) + ":" + dedupeKey + ":v1"
}

// deterministicNotificationWhatsAppMessageID mirrors the canonical WhatsApp
// outbox contract: Evolution Go receives a stable, 128-bit uppercase stanza ID.
func deterministicNotificationWhatsAppMessageID(idempotencyKey string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(idempotencyKey)))
	return strings.ToUpper(hex.EncodeToString(digest[:16]))
}

func notificationEvolutionProviderMessageID(payload map[string]any) string {
	paths := []string{
		"sentMessageId", "messageId", "messageID", "MessageID", "id", "ID", "Id",
		"key.id", "key.ID", "Key.ID", "Info.ID", "Info.Id", "info.ID", "info.id",
		"data.sentMessageId", "data.messageId", "data.messageID", "data.MessageID",
		"data.id", "data.ID", "data.key.id", "data.Key.ID", "data.Info.ID",
		"data.Info.Id", "data.info.ID", "data.info.id", "Data.messageId",
		"Data.MessageID", "Data.id", "Data.ID", "Data.Info.ID", "Data.Info.Id",
		"message.key.id", "message.Key.ID", "data.message.key.id",
		"data.message.Key.ID", "response.key.id", "response.Key.ID",
	}
	for _, candidate := range paths {
		current := any(payload)
		for _, key := range strings.Split(candidate, ".") {
			object, ok := current.(map[string]any)
			if !ok {
				current = nil
				break
			}
			current = object[key]
		}
		if value, ok := current.(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func normalizeNotificationWhatsAppRecipient(value string) string {
	value = strings.TrimSpace(value)
	if strings.Contains(value, "@g.us") || strings.Contains(value, "@s.whatsapp.net") {
		return value
	}

	var builder strings.Builder
	for _, item := range value {
		if item >= '0' && item <= '9' {
			builder.WriteRune(item)
		}
	}
	return builder.String()
}

func (repo Repository) getNotificationWhatsAppConfig(ctx context.Context) (notificationWhatsAppConfig, error) {
	var raw string
	err := repo.db.Pool().QueryRow(ctx, `
		select coalesce(value->'notification_dispatch'->'whatsapp', '{}'::jsonb)::text
		from public.system_settings
		where key = 'notifications'
		order by updated_at desc nulls last, created_at desc nulls last
		limit 1
	`).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) || isUndefinedTableError(err) {
		return notificationWhatsAppConfig{}, nil
	}
	if err != nil {
		return notificationWhatsAppConfig{}, err
	}
	var config notificationWhatsAppConfig
	if strings.TrimSpace(raw) != "" {
		if err := json.Unmarshal([]byte(raw), &config); err != nil {
			return notificationWhatsAppConfig{}, err
		}
	}
	return config, nil
}
