package leads

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	notificationDeliveryStatusAccepted          = "accepted"
	notificationDeliveryStatusDelivered         = "delivered"
	notificationDeliveryStatusRetryWait         = "retry_wait"
	notificationDeliveryStatusBlockedDependency = "blocked_dependency"
	notificationDeliveryStatusDeadLetter        = "dead_letter"
	notificationDeliveryStatusPermanentFailed   = "permanent_failed"
)

type normalizedNotificationDeliveryDecision struct {
	Status          string
	DependencyKey   string
	Provider        string
	ProviderMessage string
	ProviderStatus  string
	ErrorCode       string
	ErrorMessage    string
	NextAttemptAt   *time.Time
	Metadata        map[string]any
}

type normalizedNotificationDelivery struct {
	ID             string
	NotificationID string
	OrganizationID string
	UserID         string
	Channel        string
	RecipientKey   string
	PushTokenID    string
	IdempotencyKey string
	AttemptCount   int
	MaxAttempts    int
	ExpiresAt      time.Time
	LeaseToken     string
	Metadata       map[string]any
}

type normalizedNotificationPreflight struct {
	Provider         string
	DependencyKey    string
	Failure          *DispatchChannelResult
	Send             func(context.Context) DispatchChannelResult
	PushSubscription *pushSubscription
}

type notificationDispatchCounters struct {
	lastCycleUnixMillis atomic.Int64
	claimed             atomic.Uint64
	accepted            atomic.Uint64
	delivered           atomic.Uint64
	retried             atomic.Uint64
	blocked             atomic.Uint64
	deadLettered        atomic.Uint64
	swept               atomic.Uint64
	errors              atomic.Uint64
}

// NotificationDispatchStats is an in-process health snapshot. Counters are
// cumulative since the API process started and are safe to read while workers
// update them.
type NotificationDispatchStats struct {
	LastCycleAt time.Time `json:"last_cycle_at"`
	Claimed     uint64    `json:"claimed"`
	Accepted    uint64    `json:"accepted"`
	Delivered   uint64    `json:"delivered"`
	Retried     uint64    `json:"retried"`
	Blocked     uint64    `json:"blocked"`
	DeadLetter  uint64    `json:"dead_letter"`
	Swept       uint64    `json:"swept"`
	Errors      uint64    `json:"errors"`
}

func (repo Repository) NotificationDispatchStats() NotificationDispatchStats {
	if repo.notificationStats == nil {
		return NotificationDispatchStats{}
	}
	lastCycleMillis := repo.notificationStats.lastCycleUnixMillis.Load()
	stats := NotificationDispatchStats{
		Claimed:    repo.notificationStats.claimed.Load(),
		Accepted:   repo.notificationStats.accepted.Load(),
		Delivered:  repo.notificationStats.delivered.Load(),
		Retried:    repo.notificationStats.retried.Load(),
		Blocked:    repo.notificationStats.blocked.Load(),
		DeadLetter: repo.notificationStats.deadLettered.Load(),
		Swept:      repo.notificationStats.swept.Load(),
		Errors:     repo.notificationStats.errors.Load(),
	}
	if lastCycleMillis > 0 {
		stats.LastCycleAt = time.UnixMilli(lastCycleMillis).UTC()
	}
	return stats
}

func (repo Repository) recordNormalizedNotificationDecision(status string) {
	if repo.notificationStats == nil {
		return
	}
	switch status {
	case notificationDeliveryStatusAccepted:
		repo.notificationStats.accepted.Add(1)
	case notificationDeliveryStatusDelivered:
		repo.notificationStats.delivered.Add(1)
	case notificationDeliveryStatusRetryWait:
		repo.notificationStats.retried.Add(1)
	case notificationDeliveryStatusBlockedDependency:
		repo.notificationStats.blocked.Add(1)
	case notificationDeliveryStatusDeadLetter:
		repo.notificationStats.deadLettered.Add(1)
	}
}

func (repo Repository) recordNotificationDispatchError() {
	if repo.notificationStats != nil {
		repo.notificationStats.errors.Add(1)
	}
}

func normalizedNotificationWorkerID() string {
	hostname, err := os.Hostname()
	if err != nil || strings.TrimSpace(hostname) == "" {
		hostname = "unknown-host"
	}
	return trimMax(fmt.Sprintf("vimob-api:%s:%d", hostname, os.Getpid()), 255)
}

func notificationPostgresInterval(value time.Duration) string {
	seconds := int64(value / time.Second)
	if seconds < 1 {
		seconds = 1
	}
	return fmt.Sprintf("%d seconds", seconds)
}

func (repo Repository) sweepNormalizedNotificationDeliveries(ctx context.Context) (int, error) {
	var changed int
	err := repo.db.Pool().QueryRow(ctx, `
		select private.sweep_stale_notification_deliveries($1::interval)
	`, "1 hour").Scan(&changed)
	return changed, err
}

func (repo Repository) claimNormalizedNotificationDelivery(ctx context.Context) (normalizedNotificationDelivery, bool, error) {
	var delivery normalizedNotificationDelivery
	var rawMetadata string
	err := repo.db.Pool().QueryRow(ctx, `
		select
		  claimed.id::text,
		  claimed.notification_id::text,
		  claimed.organization_id::text,
		  coalesce(claimed.user_id::text, ''),
		  claimed.channel,
		  claimed.recipient_key,
		  coalesce(claimed.push_token_id::text, ''),
		  claimed.idempotency_key,
		  claimed.attempt_count,
		  claimed.max_attempts,
		  claimed.expires_at,
		  claimed.lease_token::text,
		  claimed.metadata::text
		from private.claim_notification_deliveries(
		  $1,
		  $2,
		  $3::interval,
		  $4::text[]
		) as claimed
		limit 1
	`, normalizedNotificationWorkerID(), notificationDispatchBatchLimit,
		notificationPostgresInterval(normalizedNotificationLease),
		[]string{"whatsapp", "push", "email"}).Scan(
		&delivery.ID,
		&delivery.NotificationID,
		&delivery.OrganizationID,
		&delivery.UserID,
		&delivery.Channel,
		&delivery.RecipientKey,
		&delivery.PushTokenID,
		&delivery.IdempotencyKey,
		&delivery.AttemptCount,
		&delivery.MaxAttempts,
		&delivery.ExpiresAt,
		&delivery.LeaseToken,
		&rawMetadata,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return normalizedNotificationDelivery{}, false, nil
	}
	if err != nil {
		return normalizedNotificationDelivery{}, false, err
	}
	delivery.Metadata = map[string]any{}
	if strings.TrimSpace(rawMetadata) != "" {
		if err := json.Unmarshal([]byte(rawMetadata), &delivery.Metadata); err != nil {
			return normalizedNotificationDelivery{}, false, err
		}
	}
	return delivery, true, nil
}

func (repo Repository) loadNormalizedPendingNotification(ctx context.Context, delivery normalizedNotificationDelivery) (pendingNotification, error) {
	var notification pendingNotification
	var leadID string
	var rawMetadata string
	err := repo.db.Pool().QueryRow(ctx, `
		select
		  notification.id::text,
		  notification.organization_id::text,
		  coalesce(notification.user_id::text, ''),
		  coalesce(notification.lead_id::text, ''),
		  coalesce(notification.title, ''),
		  coalesce(notification.content, notification.body, ''),
		  coalesce(notification.type, 'info'),
		  coalesce(notification.target_url, ''),
		  coalesce(notification.metadata, '{}'::jsonb)::text
		from public.notifications as notification
		where notification.id = $1::uuid
		  and notification.organization_id = $2::uuid
		  and coalesce(notification.user_id::text, '') = $3
	`, delivery.NotificationID, delivery.OrganizationID, delivery.UserID).Scan(
		&notification.ID,
		&notification.OrganizationID,
		&notification.UserID,
		&leadID,
		&notification.Title,
		&notification.Content,
		&notification.Type,
		&notification.TargetURL,
		&rawMetadata,
	)
	if err != nil {
		return pendingNotification{}, err
	}
	if strings.TrimSpace(leadID) != "" {
		notification.LeadID = &leadID
	}
	notification.Metadata = map[string]any{}
	if strings.TrimSpace(rawMetadata) != "" {
		if err := json.Unmarshal([]byte(rawMetadata), &notification.Metadata); err != nil {
			return pendingNotification{}, err
		}
	}
	return notification, nil
}

func (repo Repository) startNormalizedNotificationDelivery(ctx context.Context, delivery normalizedNotificationDelivery, provider string) error {
	var started bool
	if err := repo.db.Pool().QueryRow(ctx, `
		select private.start_notification_delivery($1::uuid, $2::uuid, $3)
	`, delivery.ID, delivery.LeaseToken, strings.TrimSpace(provider)).Scan(&started); err != nil {
		return err
	}
	if !started {
		return errNotificationDeliveryClaimLost
	}
	return nil
}

func (repo Repository) completeNormalizedNotificationDelivery(
	ctx context.Context,
	delivery normalizedNotificationDelivery,
	decision normalizedNotificationDeliveryDecision,
) error {
	metadata := decision.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["error_code"] = decision.ErrorCode
	metadata["error_message"] = decision.ErrorMessage
	var completed bool
	if err := repo.db.Pool().QueryRow(ctx, `
		select private.complete_notification_delivery(
		  $1::uuid,
		  $2::uuid,
		  $3,
		  nullif($4, ''),
		  nullif($5, ''),
		  nullif($6, ''),
		  $7::jsonb,
		  $8::timestamptz
		)
	`, delivery.ID, delivery.LeaseToken, decision.Status, decision.Provider,
		decision.ProviderMessage, decision.ProviderStatus, jsonb(metadata), time.Now().UTC()).Scan(&completed); err != nil {
		return err
	}
	if !completed {
		return errNotificationDeliveryClaimLost
	}
	return nil
}

func (repo Repository) rescheduleNormalizedNotificationDelivery(
	ctx context.Context,
	delivery normalizedNotificationDelivery,
	decision normalizedNotificationDeliveryDecision,
) error {
	nextAttemptAt := time.Now().UTC()
	if decision.NextAttemptAt != nil {
		nextAttemptAt = decision.NextAttemptAt.UTC()
	}
	var rescheduled bool
	if err := repo.db.Pool().QueryRow(ctx, `
		select private.reschedule_notification_delivery(
		  $1::uuid,
		  $2::uuid,
		  $3::timestamptz,
		  nullif($4, ''),
		  nullif($5, ''),
		  nullif($6, ''),
		  $7::jsonb
		)
	`, delivery.ID, delivery.LeaseToken, nextAttemptAt, decision.ErrorCode,
		decision.ErrorMessage, decision.ProviderStatus, jsonb(decision.Metadata)).Scan(&rescheduled); err != nil {
		return err
	}
	if !rescheduled {
		return errNotificationDeliveryClaimLost
	}
	return nil
}

func (repo Repository) blockNormalizedNotificationDelivery(
	ctx context.Context,
	delivery normalizedNotificationDelivery,
	dependencyKey string,
	result DispatchChannelResult,
) error {
	var blocked bool
	if err := repo.db.Pool().QueryRow(ctx, `
		select private.block_notification_delivery(
		  $1::uuid,
		  $2::uuid,
		  $3,
		  nullif($4, ''),
		  nullif($5, '')
		)
	`, delivery.ID, delivery.LeaseToken, dependencyKey,
		notificationDeliveryErrorCode(result), trimMax(strings.TrimSpace(result.Error), 2_000)).Scan(&blocked); err != nil {
		return err
	}
	if !blocked {
		return errNotificationDeliveryClaimLost
	}
	return nil
}

func (repo Repository) persistNormalizedNotificationDecision(
	ctx context.Context,
	delivery normalizedNotificationDelivery,
	decision normalizedNotificationDeliveryDecision,
	result DispatchChannelResult,
) error {
	var err error
	switch decision.Status {
	case notificationDeliveryStatusBlockedDependency:
		err = repo.blockNormalizedNotificationDelivery(ctx, delivery, decision.DependencyKey, result)
	case notificationDeliveryStatusRetryWait:
		err = repo.rescheduleNormalizedNotificationDelivery(ctx, delivery, decision)
	case notificationDeliveryStatusAccepted,
		notificationDeliveryStatusDelivered,
		notificationDeliveryStatusPermanentFailed,
		notificationDeliveryStatusDeadLetter:
		err = repo.completeNormalizedNotificationDelivery(ctx, delivery, decision)
	default:
		return fmt.Errorf("unsupported normalized notification delivery status %q", decision.Status)
	}
	if err == nil {
		repo.recordNormalizedNotificationDecision(decision.Status)
	}
	return err
}

func (repo Repository) processOneNormalizedNotificationDelivery(ctx context.Context, logger *slog.Logger) (bool, error) {
	delivery, found, err := repo.claimNormalizedNotificationDelivery(ctx)
	if err != nil || !found {
		return false, err
	}
	if repo.notificationStats != nil {
		repo.notificationStats.claimed.Add(1)
	}

	notification, err := repo.loadNormalizedPendingNotification(ctx, delivery)
	if err != nil {
		result := DispatchChannelResult{
			Enabled:   true,
			Permanent: errors.Is(err, pgx.ErrNoRows),
			Provider:  "vimob",
			Error:     "notification_snapshot_load_failed: " + trimMax(err.Error(), 900),
		}
		if result.Permanent {
			if err := repo.startNormalizedNotificationDelivery(ctx, delivery, result.Provider); err != nil {
				return true, err
			}
			decision := decideNormalizedNotificationDelivery(delivery.Channel, delivery.ID,
				delivery.AttemptCount+1, delivery.MaxAttempts, result, time.Now().UTC())
			return true, repo.persistNormalizedNotificationDecision(ctx, delivery, decision, result)
		}
		decision := decideNormalizedNotificationDelivery(delivery.Channel, delivery.ID,
			delivery.AttemptCount+1, 0, result, time.Now().UTC())
		return true, repo.persistNormalizedNotificationDecision(ctx, delivery, decision, result)
	}

	preflight := repo.prepareNormalizedNotificationDelivery(ctx, delivery, notification)
	if preflight.DependencyKey != "" {
		result := DispatchChannelResult{Enabled: true, Provider: preflight.Provider, Error: "notification_delivery_dependency_unavailable"}
		if preflight.Failure != nil {
			result = *preflight.Failure
		}
		decision := normalizedNotificationDeliveryDecision{
			Status:        notificationDeliveryStatusBlockedDependency,
			DependencyKey: preflight.DependencyKey,
		}
		return true, repo.persistNormalizedNotificationDecision(ctx, delivery, decision, result)
	}
	if preflight.Failure != nil {
		result := *preflight.Failure
		if result.Permanent {
			if err := repo.startNormalizedNotificationDelivery(ctx, delivery, firstNotificationText(result.Provider, preflight.Provider)); err != nil {
				return true, err
			}
			decision := decideNormalizedNotificationDelivery(delivery.Channel, delivery.ID,
				delivery.AttemptCount+1, delivery.MaxAttempts, result, time.Now().UTC())
			return true, repo.persistNormalizedNotificationDecision(ctx, delivery, decision, result)
		}
		decision := decideNormalizedNotificationDelivery(delivery.Channel, delivery.ID,
			delivery.AttemptCount+1, 0, result, time.Now().UTC())
		return true, repo.persistNormalizedNotificationDecision(ctx, delivery, decision, result)
	}
	if preflight.Send == nil {
		return true, errors.New("normalized notification delivery preflight returned no sender")
	}

	// This is the only attempt-budget mutation and it sits immediately before
	// the provider call. Every configuration, recipient and connection check has
	// already completed while the row was merely leased.
	if err := repo.startNormalizedNotificationDelivery(ctx, delivery, preflight.Provider); err != nil {
		return true, err
	}
	result := preflight.Send(ctx)
	decision := decideNormalizedNotificationDelivery(delivery.Channel, delivery.ID,
		delivery.AttemptCount+1, delivery.MaxAttempts, result, time.Now().UTC())
	if err := repo.persistNormalizedNotificationDecision(ctx, delivery, decision, result); err != nil {
		return true, err
	}

	if delivery.Channel == "push" && preflight.PushSubscription != nil {
		permanent := decision.Status == notificationDeliveryStatusPermanentFailed
		if err := repo.recordPushDelivery(ctx, notification, *preflight.PushSubscription, result, permanent); err != nil && logger != nil {
			repo.recordNotificationDispatchError()
			logger.Warn("push delivery audit write failed", "delivery_id", delivery.ID, "error", err)
		}
		if permanent {
			if err := repo.deactivateDeadPushSubscription(ctx, notification.UserID, *preflight.PushSubscription); err != nil && logger != nil {
				repo.recordNotificationDispatchError()
				logger.Warn("push token deactivation failed", "delivery_id", delivery.ID, "error", err)
			}
		}
	}
	if delivery.Channel == "email" {
		if err := repo.recordNormalizedNotificationEmailDelivery(ctx, notification, result); err != nil && logger != nil {
			repo.recordNotificationDispatchError()
			logger.Warn("email delivery audit write failed", "delivery_id", delivery.ID, "error", err)
		}
	}
	if logger != nil && decision.Status != notificationDeliveryStatusAccepted && decision.Status != notificationDeliveryStatusDelivered {
		logger.Warn(
			"notification delivery did not complete",
			"delivery_id", delivery.ID,
			"notification_id", delivery.NotificationID,
			"organization_id", delivery.OrganizationID,
			"channel", delivery.Channel,
			"status", decision.Status,
			"error", decision.ErrorMessage,
		)
	}
	return true, nil
}

func (repo Repository) prepareNormalizedNotificationDelivery(
	ctx context.Context,
	delivery normalizedNotificationDelivery,
	notification pendingNotification,
) normalizedNotificationPreflight {
	if isCadenceNotificationDeliverySuppressed(notification.Metadata) {
		return normalizedNotificationPermanentPreflight("vimob", "cadence_notification_delivery_disabled")
	}

	if rejected := repo.preflightBillingNotificationChannel(ctx, notification); rejected != nil {
		if strings.HasPrefix(rejected.Error, "billing_dispatch_authorization_check_failed") {
			return normalizedNotificationTransientPreflight("vimob", rejected.Error)
		}
		return normalizedNotificationPreflight{Provider: "vimob", Failure: rejected}
	}
	if strings.EqualFold(stringFromMap(notification.Metadata, "event_key"), "billing_payment_receipt") {
		if result := repo.preflightNormalizedBillingReceipt(ctx, notification); result != nil {
			return normalizedNotificationPreflight{Provider: "vimob", Failure: result}
		}
	}

	switch strings.ToLower(strings.TrimSpace(delivery.Channel)) {
	case "whatsapp":
		return repo.prepareNormalizedWhatsAppDelivery(ctx, delivery, notification)
	case "push":
		return repo.prepareNormalizedPushDelivery(ctx, delivery, notification)
	case "email":
		return repo.prepareNormalizedEmailDelivery(ctx, delivery, notification)
	default:
		return normalizedNotificationPermanentPreflight("vimob", "notification_delivery_channel_unsupported")
	}
}

func normalizedNotificationPermanentPreflight(provider string, message string) normalizedNotificationPreflight {
	return normalizedNotificationPreflight{
		Provider: provider,
		Failure: &DispatchChannelResult{
			Enabled:   true,
			Permanent: true,
			Provider:  provider,
			Error:     message,
		},
	}
}

func normalizedNotificationTransientPreflight(provider string, message string) normalizedNotificationPreflight {
	return normalizedNotificationPreflight{
		Provider: provider,
		Failure: &DispatchChannelResult{
			Enabled:  true,
			Provider: provider,
			Error:    message,
		},
	}
}

func normalizedNotificationBlockedPreflight(provider string, dependencyKey string, message string) normalizedNotificationPreflight {
	return normalizedNotificationPreflight{
		Provider:      provider,
		DependencyKey: dependencyKey,
		Failure: &DispatchChannelResult{
			Enabled:  true,
			Provider: provider,
			Error:    message,
		},
	}
}

func (repo Repository) preflightNormalizedBillingReceipt(ctx context.Context, notification pendingNotification) *DispatchChannelResult {
	var paymentStatus string
	err := repo.db.Pool().QueryRow(ctx, `
		select upper(coalesce(payment.status, 'UNKNOWN'))
		from public.notifications as persisted_notification
		join public.asaas_payments as payment
		  on payment.id::text = persisted_notification.metadata ->> 'payment_id'
		 and payment.organization_id = persisted_notification.organization_id
		join public.billing_payment_receipts as receipt
		  on receipt.id::text = persisted_notification.metadata ->> 'receipt_id'
		 and receipt.payment_id = payment.id
		 and receipt.organization_id = persisted_notification.organization_id
		where persisted_notification.id = $1::uuid
		  and persisted_notification.organization_id = $2::uuid
		  and persisted_notification.metadata ->> 'event_key' = 'billing_payment_receipt'
	`, notification.ID, notification.OrganizationID).Scan(&paymentStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return &DispatchChannelResult{
			Enabled:   true,
			Permanent: true,
			Provider:  "vimob",
			Error:     "billing_receipt_payment_snapshot_missing",
		}
	}
	if err != nil {
		return &DispatchChannelResult{
			Enabled:  true,
			Provider: "vimob",
			Error:    "billing_receipt_payment_preflight_failed: " + trimMax(err.Error(), 900),
		}
	}
	if !isConfirmedBillingReceiptPaymentStatus(paymentStatus) {
		return &DispatchChannelResult{
			Enabled:   true,
			Permanent: true,
			Provider:  "vimob",
			Error:     "billing_receipt_payment_not_confirmed",
		}
	}
	return nil
}

func (repo Repository) prepareNormalizedWhatsAppDelivery(
	ctx context.Context,
	delivery normalizedNotificationDelivery,
	notification pendingNotification,
) normalizedNotificationPreflight {
	config, err := repo.getNotificationWhatsAppConfig(ctx)
	if err != nil {
		return normalizedNotificationTransientPreflight("evolution_go", "notification_whatsapp_config_load_failed: "+trimMax(err.Error(), 900))
	}
	if !config.Enabled || strings.TrimSpace(repo.evolutionGoAPIURL) == "" {
		return normalizedNotificationBlockedPreflight("evolution_go", "whatsapp_configuration_missing", "notification_whatsapp_configuration_missing")
	}
	expectedMessageID := deterministicNotificationWhatsAppMessageID(delivery.IdempotencyKey)
	if persistedExpectedMessageID := strings.TrimSpace(stringFromMap(delivery.Metadata, "expected_message_id")); persistedExpectedMessageID != "" && !strings.EqualFold(persistedExpectedMessageID, expectedMessageID) {
		return normalizedNotificationPermanentPreflight("evolution_go", "notification_whatsapp_expected_message_id_mismatch")
	}

	eventKey := firstNotificationText(stringFromMap(notification.Metadata, "event_key"), "notification")
	recipient, err := repo.resolveNotificationDeliveryRecipient(ctx, notification, eventKey, "whatsapp")
	if err != nil {
		if errors.Is(err, ErrInvalidReference) {
			return normalizedNotificationPermanentPreflight("evolution_go", "notification_whatsapp_recipient_unavailable")
		}
		return normalizedNotificationTransientPreflight("evolution_go", "notification_whatsapp_recipient_load_failed: "+trimMax(err.Error(), 900))
	}
	to := strings.TrimSpace(recipient.WhatsApp)
	if normalizeNotificationWhatsAppRecipient(to) == "" {
		return normalizedNotificationPermanentPreflight("evolution_go", "recipient_whatsapp_missing")
	}

	variables := notificationVariables(notification.Metadata)
	if path := stringFromMap(variables, "checkout_path"); strings.HasPrefix(path, "/") {
		variables["checkout_url"] = strings.TrimRight(repo.notificationEmail.appURL, "/") + path
	}
	if path := stringFromMap(variables, "verification_path"); strings.HasPrefix(path, "/") {
		variables["verification_url"] = strings.TrimRight(repo.notificationEmail.appURL, "/") + path
	}
	delete(variables, "email_confirmation_url")
	title := notification.Title
	content := notification.Content
	if rendered, found, err := repo.renderNotificationTemplateContent(ctx, notification.OrganizationID, eventKey, "whatsapp", variables); err != nil {
		return normalizedNotificationTransientPreflight("evolution_go", "notification_whatsapp_template_load_failed: "+trimMax(err.Error(), 900))
	} else if found {
		title = firstNotificationText(rendered.Title, title)
		content = firstNotificationText(rendered.Message, content)
		if rendered.Message != "" {
			variables["__rendered_whatsapp_message"] = rendered.Message
		}
	}
	messageText := buildWhatsAppNotificationText(eventKey, title, content, variables)

	var session notificationWhatsAppSession
	provider := "evolution_go_global_instance"
	organizationFallbackDependency := ""
	organizationFallbackStatus := ""
	if !isPlatformTransactionalNotificationEvent(eventKey) {
		candidate, status, found, err := repo.findAnyNotificationWhatsAppSession(ctx, notification.OrganizationID)
		if err != nil {
			return normalizedNotificationTransientPreflight("evolution_go_org_session", "notification_whatsapp_session_load_failed: "+trimMax(err.Error(), 900))
		}
		if found {
			dependencyKey := normalizedWhatsAppSessionDependency(status)
			if dependencyKey == "" && strings.TrimSpace(candidate.InstanceKey) != "" {
				session = candidate
				provider = "evolution_go_org_session"
			} else {
				organizationFallbackDependency = firstNotificationText(dependencyKey, "whatsapp_session_unavailable")
				organizationFallbackStatus = strings.ToLower(strings.TrimSpace(status))
			}
		}
	}
	if strings.TrimSpace(session.InstanceKey) == "" {
		if !notificationConfigUsesDirectInstance(config) {
			if organizationFallbackDependency != "" {
				return normalizedNotificationBlockedPreflight(
					"evolution_go_org_session",
					organizationFallbackDependency,
					"notification_whatsapp_session_"+firstNotificationText(organizationFallbackStatus, "unavailable"),
				)
			}
			return normalizedNotificationBlockedPreflight("evolution_go", "whatsapp_session_unavailable", "notification_whatsapp_sender_missing")
		}
		session = notificationWhatsAppSession{
			InstanceID:  strings.TrimSpace(config.InstanceID),
			InstanceKey: firstNotificationText(config.InstanceName, config.InstanceID),
			Token:       strings.TrimSpace(config.Token),
		}
		if organizationFallbackDependency != "" {
			// The durable start transition persists this provider route before
			// Send is invoked. An accepted or outcome-unknown attempt is terminal
			// and can therefore never switch senders after the provider call.
			provider = "evolution_go_global_instance_fallback"
		} else {
			provider = "evolution_go_global_instance"
		}
	}
	if strings.TrimSpace(session.InstanceKey) == "" || firstNotificationText(session.Token, repo.evolutionGoAPIKey) == "" {
		return normalizedNotificationBlockedPreflight(provider, "whatsapp_configuration_missing", "notification_whatsapp_credentials_missing")
	}

	return normalizedNotificationPreflight{
		Provider: provider,
		Send: func(sendContext context.Context) DispatchChannelResult {
			result, _ := repo.dispatchWhatsAppViaEvolutionGo(
				sendContext,
				session,
				to,
				messageText,
				provider,
				delivery.IdempotencyKey,
			)
			return result
		},
	}
}

func normalizedWhatsAppSessionDependency(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "connected":
		return ""
	case "disconnected":
		return "whatsapp_session_disconnected"
	case "connecting":
		return "whatsapp_session_reconnecting"
	case "qr_ready":
		return "whatsapp_qr_required"
	default:
		return "whatsapp_session_unavailable"
	}
}

func (repo Repository) findAnyNotificationWhatsAppSession(
	ctx context.Context,
	organizationID string,
) (notificationWhatsAppSession, string, bool, error) {
	var session notificationWhatsAppSession
	var status string
	err := repo.db.Pool().QueryRow(ctx, `
		select
		  session.id::text,
		  coalesce(nullif(session.instance_id, ''), ''),
		  coalesce(
		    nullif(session.advanced_settings ->> 'evolution_go_resolved_instance_key', ''),
		    nullif(session.instance_id, ''),
		    nullif(session.instance_name, ''),
		    ''
		  ),
		  coalesce(nullif(session.advanced_settings ->> 'token', ''), ''),
		  case
		    when coalesce(session.is_active, true) is not true then 'unavailable'
		    else lower(coalesce(nullif(session.status, ''), 'unavailable'))
		  end
		from public.whatsapp_sessions as session
		where session.organization_id = $1::uuid
		  and session.provider = 'evolution_go'
		  and coalesce(session.is_notification_session, false) is true
		  and (
		    exists (
		      select 1
		      from public.organization_members selector
		      join public.users selector_user on selector_user.id = selector.user_id
		      where selector.organization_id = session.organization_id
		        and selector.user_id::text = coalesce(
		          nullif(session.advanced_settings ->> 'notification_sender_selected_by_user_id', ''),
		          session.owner_user_id::text
		        )
		        and coalesce(selector.is_active, false) is true
		        and selector.deleted_at is null
		        and lower(coalesce(selector.role, '')) in ('owner', 'admin')
		        and coalesce(selector_user.is_active, false) is true
		    )
		    or exists (
		      select 1
		      from public.users selector_super_admin
		      where selector_super_admin.id::text = coalesce(
		        nullif(session.advanced_settings ->> 'notification_sender_selected_by_user_id', ''),
		        session.owner_user_id::text
		      )
		        and coalesce(selector_super_admin.is_active, false) is true
		        and lower(coalesce(selector_super_admin.role, '')) = 'super_admin'
		    )
		  )
		order by
		  (coalesce(session.is_active, true) is true and session.status = 'connected') desc,
		  session.last_connected_at desc nulls last,
		  session.created_at desc
		limit 1
	`, organizationID).Scan(&session.ID, &session.InstanceID, &session.InstanceKey, &session.Token, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return notificationWhatsAppSession{}, "", false, nil
	}
	if err != nil {
		return notificationWhatsAppSession{}, "", false, err
	}
	return session, status, true, nil
}

func (repo Repository) prepareNormalizedPushDelivery(
	ctx context.Context,
	delivery normalizedNotificationDelivery,
	notification pendingNotification,
) normalizedNotificationPreflight {
	if repo.notificationPush == nil {
		return normalizedNotificationBlockedPreflight("push", "push_configuration_missing", "push_sender_not_configured")
	}
	subscription, found, err := repo.findNormalizedPushSubscription(ctx, delivery)
	if err != nil {
		return normalizedNotificationTransientPreflight("push", "push_token_load_failed: "+trimMax(err.Error(), 900))
	}
	if !found {
		return normalizedNotificationPermanentPreflight("push", "push_token_inactive_or_missing")
	}

	provider := "web_push"
	if isNativePushSubscription(subscription) {
		provider = "fcm_legacy"
		if repo.notificationPush.hasFCMV1CredentialSource() {
			provider = "fcm_v1"
			account, err := repo.notificationPush.loadFirebaseServiceAccount()
			if err != nil {
				return normalizedNotificationBlockedPreflight(provider, "push_configuration_missing", trimMax(err.Error(), 900))
			}
			if firstNotificationText(repo.notificationPush.fcmProjectID, account.ProjectID) == "" || account.ClientEmail == "" || account.PrivateKey == "" {
				return normalizedNotificationBlockedPreflight(provider, "push_configuration_missing", "fcm_service_account_incomplete")
			}
			if _, err := parseServiceAccountPrivateKey(account.PrivateKey); err != nil {
				return normalizedNotificationBlockedPreflight(provider, "push_configuration_missing", trimMax(err.Error(), 900))
			}
		}
		if nativePushToken(subscription) == "" {
			return normalizedNotificationPermanentPreflight(provider, "native_push_token_missing")
		}
		if !repo.notificationPush.hasNativeFCMSender() {
			return normalizedNotificationBlockedPreflight(provider, "push_configuration_missing", "fcm_credentials_missing")
		}
	} else {
		if subscription.Endpoint == "" || subscription.P256DH == "" || subscription.Auth == "" {
			return normalizedNotificationPermanentPreflight(provider, "web_push_subscription_incomplete")
		}
		if repo.notificationPush.vapidPrivateKey == "" {
			return normalizedNotificationBlockedPreflight(provider, "push_configuration_missing", "vapid_private_key_missing")
		}
	}

	payload := pushPayload{
		Title:     notification.Title,
		Body:      notification.Content,
		Type:      notification.Type,
		LeadID:    notification.LeadID,
		TargetURL: firstNotificationText(notification.TargetURL, notificationTargetURL(notification)),
	}
	return normalizedNotificationPreflight{
		Provider:         provider,
		PushSubscription: &subscription,
		Send: func(sendContext context.Context) DispatchChannelResult {
			return repo.notificationPush.send(sendContext, subscription, payload)
		},
	}
}

func (repo Repository) findNormalizedPushSubscription(
	ctx context.Context,
	delivery normalizedNotificationDelivery,
) (pushSubscription, bool, error) {
	var subscription pushSubscription
	var rawDeviceInfo string
	err := repo.db.Pool().QueryRow(ctx, `
		select
		  token.id::text,
		  coalesce(token.endpoint, ''),
		  coalesce(token.p256dh, ''),
		  coalesce(token.auth, ''),
		  coalesce(token.token, ''),
		  coalesce(token.platform, ''),
		  coalesce(token.device_info, '{}'::jsonb)::text
		from public.push_tokens as token
		where token.id = $1::uuid
		  and token.organization_id = $2::uuid
		  and token.user_id = $3::uuid
		  and token.is_active is true
		limit 1
	`, delivery.PushTokenID, delivery.OrganizationID, delivery.UserID).Scan(
		&subscription.ID,
		&subscription.Endpoint,
		&subscription.P256DH,
		&subscription.Auth,
		&subscription.Token,
		&subscription.Platform,
		&rawDeviceInfo,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return pushSubscription{}, false, nil
	}
	if err != nil {
		return pushSubscription{}, false, err
	}
	deviceInfo := map[string]any{}
	_ = json.Unmarshal([]byte(rawDeviceInfo), &deviceInfo)
	subscription.Platform = strings.ToLower(firstNotificationText(subscription.Platform, stringFromMap(deviceInfo, "platform")))
	if subscription.Endpoint == "" && subscription.Token != "" && isNativePushSubscription(subscription) {
		subscription.Endpoint = "native:" + firstNotificationText(subscription.Platform, "unknown") + ":" + subscription.Token
	}
	if subscription.Endpoint == "" && subscription.Token != "" && subscription.Platform == "web" {
		subscription.Endpoint = subscription.Token
	}
	return subscription, true, nil
}

func (repo Repository) prepareNormalizedEmailDelivery(
	ctx context.Context,
	delivery normalizedNotificationDelivery,
	notification pendingNotification,
) normalizedNotificationPreflight {
	eventKey := firstNotificationText(stringFromMap(notification.Metadata, "event_key"), "notification")
	if eventKey != "deal_won" && eventKey != "onboarding_welcome" && eventKey != "onboarding_email_confirmation" && !isBillingNotificationEvent(eventKey) {
		return normalizedNotificationPermanentPreflight("resend", "email_event_not_supported")
	}
	if repo.notificationEmail.apiKey == "" {
		return normalizedNotificationBlockedPreflight("resend", "email_configuration_missing", "resend_api_key_missing")
	}
	if confirmationURL := stringFromMap(notificationVariables(notification.Metadata), "email_confirmation_url"); confirmationURL != "" && emailConfirmationCapabilityExpired(notification.Metadata, time.Now().UTC()) {
		return normalizedNotificationPermanentPreflight("resend", "onboarding_email_confirmation_capability_expired")
	}
	recipient, err := repo.resolveNotificationDeliveryRecipient(ctx, notification, eventKey, "email")
	if err != nil {
		if errors.Is(err, ErrInvalidReference) {
			return normalizedNotificationPermanentPreflight("resend", "notification_email_recipient_unavailable")
		}
		return normalizedNotificationTransientPreflight("resend", "notification_email_recipient_load_failed: "+trimMax(err.Error(), 900))
	}
	if strings.TrimSpace(recipient.Email) == "" {
		return normalizedNotificationPermanentPreflight("resend", "recipient_email_missing")
	}
	if err := repo.prepareNotificationEmailDelivery(
		ctx,
		notification,
		recipient.Email,
		transactionalEmailSubject(eventKey, notification.Title),
		eventKey,
		delivery.IdempotencyKey,
	); err != nil {
		return normalizedNotificationTransientPreflight("resend", "email_log_prepare_failed: "+trimMax(err.Error(), 900))
	}

	return normalizedNotificationPreflight{
		Provider: "resend",
		Send: func(sendContext context.Context) DispatchChannelResult {
			return repo.sendNormalizedNotificationEmail(sendContext, notification, recipient, eventKey, delivery.IdempotencyKey)
		},
	}
}

func (repo Repository) sendNormalizedNotificationEmail(
	ctx context.Context,
	notification pendingNotification,
	recipient notificationRecipient,
	eventKey string,
	idempotencyKey string,
) DispatchChannelResult {
	variables := notificationVariables(notification.Metadata)
	if eventKey == "onboarding_welcome" || eventKey == "onboarding_email_confirmation" {
		return repo.notificationEmail.sendOnboarding(ctx, onboardingEmailPayload{
			RecipientEmail:       recipient.Email,
			RecipientName:        recipient.Name,
			Organization:         stringFromMap(variables, "organization_name"),
			PlanName:             stringFromMap(variables, "plan_name"),
			SignupPath:           stringFromMap(variables, "signup_path"),
			TrialDays:            stringFromMap(variables, "trial_days"),
			TrialEndsAt:          stringFromMap(variables, "trial_ends_at"),
			CheckoutPath:         stringFromMap(variables, "checkout_path"),
			EmailConfirmationURL: stringFromMap(variables, "email_confirmation_url"),
			TermsVersion:         stringFromMap(variables, "terms_version"),
			PrivacyVersion:       stringFromMap(variables, "privacy_version"),
			IdempotencyKey:       idempotencyKey,
		})
	}
	if isBillingNotificationEvent(eventKey) {
		return repo.notificationEmail.sendBilling(ctx, billingEmailPayload{
			RecipientEmail:    recipient.Email,
			RecipientName:     recipient.Name,
			EventKey:          eventKey,
			Title:             notification.Title,
			Content:           notification.Content,
			Amount:            firstNotificationText(stringFromMap(notification.Metadata, "amount"), stringFromMap(variables, "amount")),
			DueDate:           firstNotificationText(stringFromMap(notification.Metadata, "due_date"), stringFromMap(variables, "due_date")),
			TargetURL:         firstNotificationText(notification.TargetURL, notificationTargetURL(notification)),
			ReceiptNumber:     stringFromMap(variables, "receipt_number"),
			Organization:      stringFromMap(variables, "organization_name"),
			PayerName:         stringFromMap(variables, "payer_name"),
			PayerTaxID:        stringFromMap(variables, "payer_tax_id"),
			PlanName:          stringFromMap(variables, "plan_name"),
			BillingPeriod:     billingPeriodLabel(stringFromMap(variables, "billing_period_months")),
			BillingType:       stringFromMap(variables, "billing_type"),
			PaidAt:            stringFromMap(variables, "paid_at"),
			ProviderReference: stringFromMap(variables, "provider_payment_reference"),
			VerificationPath:  stringFromMap(variables, "verification_path"),
			IssuerName:        stringFromMap(variables, "issuer_name"),
			IssuedAt:          stringFromMap(variables, "issued_at"),
			IdempotencyKey:    idempotencyKey,
		})
	}
	return repo.notificationEmail.sendDealWon(ctx, dealWonEmailPayload{
		RecipientEmail: recipient.Email,
		RecipientName:  recipient.Name,
		LeadName:       firstNotificationText(stringFromMap(notification.Metadata, "lead_name"), stringFromMap(variables, "lead_name")),
		ActorName:      firstNotificationText(stringFromMap(notification.Metadata, "actor_name"), stringFromMap(variables, "actor_name")),
		Organization:   firstNotificationText(stringFromMap(notification.Metadata, "organization_name"), stringFromMap(variables, "organization_name")),
		Value:          firstNotificationText(stringFromMap(notification.Metadata, "valor_interesse"), stringFromMap(variables, "valor_interesse")),
		LeadURL:        firstNotificationText(notification.TargetURL, notificationTargetURL(notification)),
		IdempotencyKey: idempotencyKey,
	})
}

func (repo Repository) recordNormalizedNotificationEmailDelivery(
	ctx context.Context,
	notification pendingNotification,
	result DispatchChannelResult,
) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := repo.recordNotificationEmailDelivery(ctx, tx, notification, result); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func parseNotificationRetryAfter(value string, now time.Time) time.Duration {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	if seconds, err := strconv.ParseInt(value, 10, 64); err == nil {
		if seconds <= 0 {
			return 0
		}
		return time.Duration(seconds) * time.Second
	}
	if retryAt, err := http.ParseTime(value); err == nil {
		delay := retryAt.Sub(now)
		if delay > 0 {
			return delay
		}
	}
	return 0
}

func normalizedNotificationRetryDelay(deliveryID string, attempt int, retryAfter time.Duration) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	base := 30 * time.Second * time.Duration(1<<minInt(attempt-1, 7))
	if base > time.Hour {
		base = time.Hour
	}

	// Equal jitter keeps the exponential envelope while preventing all jobs
	// released after the same outage from hammering the provider together.
	half := base / 2
	digest := sha256.Sum256([]byte(strings.TrimSpace(deliveryID) + ":" + strconv.Itoa(attempt)))
	jitterWindow := uint64(half/time.Millisecond) + 1
	jitter := time.Duration(binary.BigEndian.Uint64(digest[:8])%jitterWindow) * time.Millisecond
	delay := half + jitter
	if retryAfter > delay {
		delay = retryAfter
	}
	return delay
}

func decideNormalizedNotificationDelivery(
	channel string,
	deliveryID string,
	attempt int,
	maxAttempts int,
	result DispatchChannelResult,
	now time.Time,
) normalizedNotificationDeliveryDecision {
	channel = strings.ToLower(strings.TrimSpace(channel))
	decision := normalizedNotificationDeliveryDecision{
		Provider:        strings.TrimSpace(result.Provider),
		ProviderMessage: strings.TrimSpace(result.MessageID),
		ProviderStatus:  notificationProviderStatus(result.Status),
		ErrorCode:       notificationDeliveryErrorCode(result),
		ErrorMessage:    trimMax(strings.TrimSpace(result.Error), 2_000),
		Metadata: map[string]any{
			"outcome_unknown": result.OutcomeUnknown,
			"retry_after_ms":  result.RetryAfter.Milliseconds(),
		},
	}

	switch {
	case result.OK && channel == "push":
		decision.Status = notificationDeliveryStatusDelivered
		decision.ErrorCode = ""
		decision.ErrorMessage = ""
	case result.OK:
		decision.Status = notificationDeliveryStatusAccepted
		decision.ErrorCode = ""
		decision.ErrorMessage = ""
	case result.OutcomeUnknown:
		decision.Status = notificationDeliveryStatusAccepted
		decision.ProviderMessage = firstNotificationText(result.MessageID, result.ExpectedMessageID)
		decision.ErrorCode = "notification_delivery_outcome_unknown"
	case result.Permanent || notificationDeliveryPermanentFailure(channel, result):
		decision.Status = notificationDeliveryStatusPermanentFailed
	case notificationDeliveryDependencyFailure(channel, result):
		decision.Status = notificationDeliveryStatusBlockedDependency
		decision.DependencyKey = notificationDeliveryDependencyKey(channel, result)
	case maxAttempts > 0 && attempt >= maxAttempts:
		decision.Status = notificationDeliveryStatusDeadLetter
	default:
		decision.Status = notificationDeliveryStatusRetryWait
		nextAttemptAt := now.Add(normalizedNotificationRetryDelay(deliveryID, attempt, result.RetryAfter))
		decision.NextAttemptAt = &nextAttemptAt
	}
	return decision
}

func notificationProviderStatus(status int) string {
	if status <= 0 {
		return ""
	}
	return strconv.Itoa(status)
}

func notificationDeliveryErrorCode(result DispatchChannelResult) string {
	errorText := strings.ToLower(strings.TrimSpace(result.Error))
	if errorText != "" {
		candidate := errorText
		if separator := strings.IndexAny(candidate, ": "); separator >= 0 {
			candidate = candidate[:separator]
		}
		candidate = strings.Trim(candidate, "_-")
		valid := candidate != ""
		for _, character := range candidate {
			if (character < 'a' || character > 'z') &&
				(character < '0' || character > '9') &&
				character != '_' && character != '-' {
				valid = false
				break
			}
		}
		if valid {
			return trimMax(candidate, 120)
		}
	}
	if result.Status > 0 {
		return fmt.Sprintf("provider_http_%d", result.Status)
	}
	return "provider_transport_error"
}

func notificationDeliveryDependencyFailure(channel string, result DispatchChannelResult) bool {
	if result.Status == http.StatusUnauthorized || result.Status == http.StatusForbidden {
		return true
	}
	errorText := strings.ToLower(strings.TrimSpace(result.Error))
	for _, marker := range []string{
		"api_key_missing",
		"credentials_missing",
		"private_key_missing",
		"private_key_invalid",
		"private_key_parse",
		"service_account",
		"project_id_missing",
		"vapid_",
		"sender_missing",
		"token_missing",
		"not_connected",
		"disconnected",
	} {
		if strings.Contains(errorText, marker) {
			return true
		}
	}
	return channel == "whatsapp" && result.Status == http.StatusNotFound
}

func notificationDeliveryDependencyKey(channel string, result DispatchChannelResult) string {
	channel = strings.ToLower(strings.TrimSpace(channel))
	errorText := strings.ToLower(strings.TrimSpace(result.Error))
	switch channel {
	case "whatsapp":
		switch {
		case strings.Contains(errorText, "qr_required"), strings.Contains(errorText, "qr_ready"):
			return "whatsapp_qr_required"
		case strings.Contains(errorText, "reconnecting"), strings.Contains(errorText, "connecting"):
			return "whatsapp_session_reconnecting"
		case strings.Contains(errorText, "disconnected"):
			return "whatsapp_session_disconnected"
		case result.Status == http.StatusUnauthorized,
			result.Status == http.StatusForbidden,
			strings.Contains(errorText, "token_missing"),
			strings.Contains(errorText, "api_url_missing"),
			strings.Contains(errorText, "credentials_missing"):
			return "whatsapp_configuration_missing"
		default:
			return "whatsapp_session_unavailable"
		}
	case "email":
		return "email_configuration_missing"
	case "push":
		return "push_configuration_missing"
	default:
		return "notification_provider_unavailable"
	}
}

func notificationDeliveryPermanentFailure(channel string, result DispatchChannelResult) bool {
	if channel == "push" && isPermanentPushDeliveryFailure(result) {
		return true
	}
	if result.Status < 400 || result.Status >= 500 {
		return false
	}
	switch result.Status {
	case http.StatusUnauthorized,
		http.StatusForbidden,
		http.StatusRequestTimeout,
		http.StatusConflict,
		http.StatusTooEarly,
		http.StatusTooManyRequests:
		return false
	default:
		return true
	}
}
