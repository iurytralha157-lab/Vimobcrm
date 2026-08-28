package leads

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	notificationDispatchWorkerInterval = 15 * time.Second
	// One notification can fan out to three provider calls. Claiming one row at
	// a time ensures no later item sits idle until its lease expires.
	notificationDispatchBatchLimit   = 1
	notificationDispatchDrainLimit   = 25
	notificationDispatchConcurrency  = 3
	notificationDispatchDrainTimeout = 45 * time.Second
	notificationDispatchMaxAttempts  = 24
	notificationDispatchClaimTimeout = 15 * time.Minute
	scheduleReminderLockKey          = int64(860421706)
)

var billingNotificationDispatchAuthorizationQuery = "select " + billingNotificationAuthorizationSQL("$1", "$2")
var errNotificationDeliveryClaimLost = errors.New("notification delivery claim lost")

func billingNotificationAuthorizationSQL(organizationParameter string, userParameter string) string {
	return `exists (
	select 1
	from public.organization_members membership
	join public.users account
	  on account.id = membership.user_id
	where membership.organization_id = ` + organizationParameter + `::uuid
	  and membership.user_id = ` + userParameter + `::uuid
	  and membership.is_active = true
	  and coalesce(account.is_active, true) = true
	  and (
		lower(coalesce(membership.role, 'user')) in ('owner', 'admin')
		or exists (
			select 1
			from public.user_permission_overrides permission_override
			where permission_override.organization_id = membership.organization_id
			  and permission_override.user_id = membership.user_id
			  and permission_override.permission_key = 'settings_billing'
			  and permission_override.allowed = true
		)
		or (
			not exists (
				select 1
				from public.user_permission_overrides permission_override
				where permission_override.organization_id = membership.organization_id
				  and permission_override.user_id = membership.user_id
				  and permission_override.permission_key = 'settings_billing'
			)
			and exists (
				select 1
				from public.user_organization_roles user_role
				join public.organization_role_permissions role_permission
				  on role_permission.organization_id = user_role.organization_id
				 and role_permission.role_id = user_role.role_id
				join public.available_permissions permission
				  on permission.id = role_permission.permission_id
				where user_role.organization_id = membership.organization_id
				  and user_role.user_id = membership.user_id
				  and user_role.is_active = true
				  and permission.key = 'settings_billing'
			)
		)
	  )
 )`
}

type pendingNotification struct {
	ID             string
	OrganizationID string
	UserID         string
	LeadID         *string
	Title          string
	Content        string
	Type           string
	TargetURL      string
	Metadata       map[string]any
}

type notificationDeliveryResult struct {
	WhatsApp DispatchChannelResult
	Push     DispatchChannelResult
	Email    DispatchChannelResult
	Error    string
	// Billing receipt delivery owns its payment-state lock and persistence in
	// one transaction. The generic caller must not overwrite that result with
	// the stale metadata snapshot it claimed earlier.
	SkipPersistence bool
}

func (repo Repository) StartNotificationDispatchWorker(ctx context.Context, logger *slog.Logger) {
	if logger == nil {
		logger = slog.Default()
	}

	go func() {
		timer := time.NewTimer(7 * time.Second)
		defer timer.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				created, err := repo.createDueScheduleReminderNotifications(ctx)
				if err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("schedule reminder notification worker failed", "error", err)
				} else if created > 0 {
					logger.Info("schedule reminder notifications enqueued", "count", created)
				}
				if err := repo.processNotificationDeliveries(ctx, logger); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("notification delivery worker failed", "error", err)
				}
				timer.Reset(notificationDispatchWorkerInterval)
			}
		}
	}()
}

func (repo Repository) ProcessLeadWhatsAppNotifications(ctx context.Context) error {
	return repo.ProcessNotificationDeliveries(ctx)
}

func (repo Repository) ProcessNotificationDeliveries(ctx context.Context) error {
	return repo.processNotificationDeliveries(ctx, nil)
}

func (repo Repository) processNotificationDeliveries(ctx context.Context, logger *slog.Logger) error {
	if err := repo.processPendingPropertyReservationNotificationJobs(ctx); err != nil {
		if logger == nil {
			return err
		}
		logger.Error("property reservation notification outbox recovery failed", "error", err)
	}

	// Drain a bounded burst immediately. Each worker claims exactly one row in
	// its own transaction, so every provider fan-out owns an independent token
	// and lease. The wall-clock boundary stops new claims without cancelling an
	// in-flight provider call whose result still needs durable persistence.
	deadline := time.Now().Add(notificationDispatchDrainTimeout)
	var started atomic.Int64
	errorChannel := make(chan error, notificationDispatchConcurrency)
	var workers sync.WaitGroup
	workers.Add(notificationDispatchConcurrency)
	for range notificationDispatchConcurrency {
		go func() {
			defer workers.Done()
			for {
				if ctx.Err() != nil || time.Now().After(deadline) {
					return
				}
				if started.Add(1) > notificationDispatchDrainLimit {
					return
				}
				processed, err := repo.processOneNotificationDelivery(ctx, logger)
				if err != nil {
					select {
					case errorChannel <- err:
					default:
					}
					return
				}
				if !processed {
					return
				}
			}
		}()
	}
	workers.Wait()
	close(errorChannel)

	if err := ctx.Err(); err != nil {
		return err
	}
	for err := range errorChannel {
		if err != nil {
			return err
		}
	}
	return nil
}

func (repo Repository) processOneNotificationDelivery(
	ctx context.Context,
	logger *slog.Logger,
) (bool, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	notifications, err := repo.listPendingNotificationDeliveries(ctx, tx)
	if err != nil {
		return false, err
	}
	notifications, err = repo.claimPendingNotificationDeliveries(ctx, tx, notifications)
	if err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	if len(notifications) == 0 {
		return false, nil
	}

	notification := notifications[0]
	delivery := repo.dispatchPendingNotification(ctx, notification, nil)
	if logger != nil && delivery.Error != "" {
		logger.Warn(
			"notification delivery failed",
			"notification_id", notification.ID,
			"organization_id", notification.OrganizationID,
			"user_id", notification.UserID,
			"event_key", stringFromMap(notification.Metadata, "event_key"),
			"error", delivery.Error,
		)
	}
	if !delivery.SkipPersistence {
		if err := repo.markNotificationDeliveryDirect(ctx, notification, delivery); err != nil {
			return true, err
		}
	}
	return true, nil
}

func (repo Repository) dispatchNotificationDeliveries(ctx context.Context, notification Notification, channels []string) notificationDeliveryResult {
	pending := pendingNotification{
		ID:             notification.ID,
		OrganizationID: notification.OrganizationID,
		UserID:         notification.UserID,
		LeadID:         notification.LeadID,
		Title:          notification.Title,
		Content:        firstNotificationText(stringValue(notification.Content), stringFromMap(notification.Metadata, "body")),
		Type:           notification.Type,
		TargetURL:      notification.TargetURL,
		Metadata:       notification.Metadata,
	}
	if pending.Metadata == nil {
		pending.Metadata = map[string]any{}
	}
	delivery := repo.dispatchPendingNotification(ctx, pending, channels)
	if delivery.SkipPersistence {
		return delivery
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		delivery.Error = firstNotificationText(delivery.Error, err.Error())
		return delivery
	}
	defer tx.Rollback(ctx)
	if err := repo.markNotificationDelivery(ctx, tx, pending, delivery); err != nil {
		delivery.Error = firstNotificationText(delivery.Error, err.Error())
		return delivery
	}
	if err := tx.Commit(ctx); err != nil {
		delivery.Error = firstNotificationText(delivery.Error, err.Error())
	}
	return delivery
}

func (repo Repository) listPendingNotificationDeliveries(ctx context.Context, tx pgx.Tx) ([]pendingNotification, error) {
	rows, err := tx.Query(ctx, `
		select
			id::text,
			organization_id::text,
			coalesce(user_id::text, ''),
			coalesce(lead_id::text, ''),
			coalesce(title, ''),
			coalesce(content, body, ''),
			coalesce(type, 'info'),
			coalesce(target_url, ''),
			coalesce(metadata, '{}'::jsonb)::text
		from public.notifications
		where (
		    (
		      lower(coalesce(metadata->'dispatch'->'whatsapp'->>'required', metadata->>'whatsapp_dispatch_required', 'false')) in ('true', '1', 'yes')
		      and coalesce(metadata->'dispatch'->'whatsapp'->>'status', metadata->'whatsapp_dispatch'->>'status', 'pending') not in ('accepted', 'delivered', 'delivery_failed', 'sent', 'skipped', 'permanent_failed')
			      and coalesce(nullif(coalesce(metadata->'dispatch'->'whatsapp'->>'attempts', metadata->'whatsapp_dispatch'->>'attempts'), '')::int, 0) < $1
			      and coalesce(nullif(metadata->'dispatch'->'whatsapp'->>'next_attempt_at', '')::timestamptz, '-infinity'::timestamptz) <= now()
		      and (
		        coalesce(metadata->'dispatch'->'whatsapp'->>'status', metadata->'whatsapp_dispatch'->>'status', 'pending') <> 'processing'
			        or coalesce(nullif(metadata->'dispatch'->'whatsapp'->>'claimed_at', '')::timestamptz, now() - interval '1 hour') < now() - ($3::bigint * interval '1 second')
		      )
		    )
		    or (
		      lower(coalesce(metadata->'dispatch'->'push'->>'required', 'false')) in ('true', '1', 'yes')
		      and coalesce(metadata->'dispatch'->'push'->>'status', 'pending') not in ('accepted', 'delivered', 'delivery_failed', 'sent', 'skipped', 'permanent_failed')
			      and coalesce(nullif(metadata->'dispatch'->'push'->>'attempts', '')::int, 0) < $1
			      and coalesce(nullif(metadata->'dispatch'->'push'->>'next_attempt_at', '')::timestamptz, '-infinity'::timestamptz) <= now()
		      and (
		        coalesce(metadata->'dispatch'->'push'->>'status', 'pending') <> 'processing'
			        or coalesce(nullif(metadata->'dispatch'->'push'->>'claimed_at', '')::timestamptz, now() - interval '1 hour') < now() - ($3::bigint * interval '1 second')
		      )
		    )
		    or (
		      lower(coalesce(metadata->'dispatch'->'email'->>'required', 'false')) in ('true', '1', 'yes')
		      and coalesce(metadata->'dispatch'->'email'->>'status', 'pending') not in ('accepted', 'delivered', 'delivery_failed', 'sent', 'skipped', 'permanent_failed')
			      and coalesce(nullif(metadata->'dispatch'->'email'->>'attempts', '')::int, 0) < $1
			      and coalesce(nullif(metadata->'dispatch'->'email'->>'next_attempt_at', '')::timestamptz, '-infinity'::timestamptz) <= now()
		      and (
		        coalesce(metadata->'dispatch'->'email'->>'status', 'pending') <> 'processing'
			        or coalesce(nullif(metadata->'dispatch'->'email'->>'claimed_at', '')::timestamptz, now() - interval '1 hour') < now() - ($3::bigint * interval '1 second')
		      )
		    )
		  )
		  and lower(btrim(coalesce(metadata->>'policy_type', ''))) <> 'cadence_task'
		  and lower(btrim(coalesce(metadata->>'event_key', ''))) not in (
		    'cadence_task',
		    'cadence_task_warning',
		    'cadence_task_overdue',
		    'cadence_task_reminder',
		    'lead_cadence_task'
		  )
		order by created_at asc
		limit $2
		for update skip locked
	`, notificationDispatchMaxAttempts, notificationDispatchBatchLimit, int64(notificationDispatchClaimTimeout/time.Second))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	notifications := []pendingNotification{}
	for rows.Next() {
		var item pendingNotification
		var leadID string
		var rawMetadata string
		if err := rows.Scan(&item.ID, &item.OrganizationID, &item.UserID, &leadID, &item.Title, &item.Content, &item.Type, &item.TargetURL, &rawMetadata); err != nil {
			return nil, err
		}
		if strings.TrimSpace(leadID) != "" {
			item.LeadID = &leadID
		}
		item.Metadata = map[string]any{}
		if strings.TrimSpace(rawMetadata) != "" {
			_ = json.Unmarshal([]byte(rawMetadata), &item.Metadata)
		}
		if isCadenceNotificationDeliverySuppressed(item.Metadata) {
			// Cadence notifications are retired. Leave historical rows untouched
			// while keeping them outside every external-delivery claim.
			continue
		}
		notifications = append(notifications, item)
	}
	return notifications, rows.Err()
}

func (repo Repository) claimPendingNotificationDeliveries(ctx context.Context, tx pgx.Tx, notifications []pendingNotification) ([]pendingNotification, error) {
	claimed := make([]pendingNotification, 0, len(notifications))
	claimToken := fmt.Sprintf("%d", time.Now().UTC().UnixNano())

	for _, notification := range notifications {
		metadata := notification.Metadata
		if metadata == nil {
			metadata = map[string]any{}
		}
		if isCadenceNotificationDeliverySuppressed(metadata) {
			continue
		}

		channelClaimed := false
		for _, channel := range []string{"whatsapp", "push", "email"} {
			if !shouldClaimNotificationChannel(metadata, channel) {
				continue
			}
			metadata = setNotificationChannelProcessing(metadata, channel, claimToken)
			if channel == "whatsapp" {
				metadata = prepareTransactionalWhatsAppReceiptCorrelation(metadata, notification)
			}
			channelClaimed = true
		}
		if !channelClaimed {
			continue
		}

		if _, err := tx.Exec(ctx, `
			update public.notifications
			set metadata = $2::jsonb
			where id = $1::uuid
		`, notification.ID, jsonb(metadata)); err != nil {
			return nil, err
		}

		notification.Metadata = metadata
		claimed = append(claimed, notification)
	}

	return claimed, nil
}

func (repo Repository) dispatchPendingNotification(ctx context.Context, notification pendingNotification, channels []string) notificationDeliveryResult {
	if isCadenceNotificationDeliverySuppressed(notification.Metadata) {
		return notificationDeliveryResult{
			Error:           "cadence_notification_delivery_disabled",
			SkipPersistence: true,
		}
	}
	if stringFromMap(notification.Metadata, "event_key") == "billing_payment_receipt" {
		return repo.dispatchPendingBillingReceiptNotification(ctx, notification, channels)
	}
	return repo.dispatchPendingNotificationUnchecked(ctx, notification, channels)
}

func isCadenceNotificationDeliverySuppressed(metadata map[string]any) bool {
	policyType := strings.ToLower(strings.TrimSpace(stringFromMap(metadata, "policy_type")))
	if policyType == "cadence_task" {
		return true
	}

	eventKey := strings.ToLower(strings.TrimSpace(stringFromMap(metadata, "event_key")))
	switch eventKey {
	case "cadence_task", "cadence_task_warning", "cadence_task_overdue", "cadence_task_reminder", "lead_cadence_task":
		return true
	default:
		return false
	}
}

func (repo Repository) dispatchPendingNotificationUnchecked(ctx context.Context, notification pendingNotification, channels []string) notificationDeliveryResult {
	var result notificationDeliveryResult
	if shouldAttemptNotificationChannel(notification.Metadata, "whatsapp", channels) {
		if rejected := repo.preflightBillingNotificationChannel(ctx, notification); rejected != nil {
			result.WhatsApp = *rejected
		} else {
			result.WhatsApp, _ = repo.dispatchPendingWhatsAppNotification(ctx, notification)
		}
	}
	if shouldAttemptNotificationChannel(notification.Metadata, "push", channels) {
		if rejected := repo.preflightBillingNotificationChannel(ctx, notification); rejected != nil {
			result.Push = *rejected
		} else {
			result.Push = repo.dispatchPendingPushNotification(ctx, notification)
		}
	}
	if shouldAttemptNotificationChannel(notification.Metadata, "email", channels) {
		if rejected := repo.preflightBillingNotificationChannel(ctx, notification); rejected != nil {
			result.Email = *rejected
		} else {
			result.Email = repo.dispatchPendingEmailNotification(ctx, notification)
		}
	}

	for _, item := range []DispatchChannelResult{result.WhatsApp, result.Push, result.Email} {
		if item.Error != "" && item.Enabled && !item.OK {
			result.Error = firstNotificationText(result.Error, item.Error)
		}
	}
	return result
}

func (repo Repository) preflightBillingNotificationChannel(ctx context.Context, notification pendingNotification) *DispatchChannelResult {
	eventKey := strings.ToLower(strings.TrimSpace(stringFromMap(notification.Metadata, "event_key")))
	if !requiresCurrentBillingNotificationAuthorization(eventKey) {
		return nil
	}

	authorized, err := repo.currentBillingNotificationAuthorization(
		ctx,
		notification.OrganizationID,
		notification.UserID,
	)
	if err != nil {
		return &DispatchChannelResult{
			Enabled: true,
			Error:   "billing_dispatch_authorization_check_failed: " + trimMax(err.Error(), 700),
		}
	}
	if !authorized {
		return &DispatchChannelResult{
			Enabled:   true,
			Permanent: true,
			Skipped:   1,
			Error:     "billing_dispatch_authorization_revoked",
		}
	}
	return nil
}

func (repo Repository) currentBillingNotificationAuthorization(ctx context.Context, organizationID string, userID string) (bool, error) {
	var authorized bool
	err := repo.db.Pool().QueryRow(
		ctx,
		billingNotificationDispatchAuthorizationQuery,
		organizationID,
		userID,
	).Scan(&authorized)
	return authorized, err
}

func requiresCurrentBillingNotificationAuthorization(eventKey string) bool {
	eventKey = strings.ToLower(strings.TrimSpace(eventKey))
	return isBillingNotificationEvent(eventKey) && eventKey != "billing_payment_receipt"
}

func (repo Repository) dispatchPendingBillingReceiptNotification(
	ctx context.Context,
	notification pendingNotification,
	channels []string,
) notificationDeliveryResult {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return billingReceiptPreflightFailure(notification, channels, err)
	}
	defer tx.Rollback(ctx)

	var paymentStatus string
	var persistedMetadataRaw string
	err = tx.QueryRow(ctx, `
		select
		  upper(coalesce(payment.status, 'UNKNOWN')),
		  coalesce(notification.metadata, '{}'::jsonb)::text
		from public.notifications notification
		join public.asaas_payments payment
		  on payment.id::text = notification.metadata ->> 'payment_id'
		 and payment.organization_id = notification.organization_id
		join public.billing_payment_receipts receipt
		  on receipt.id::text = notification.metadata ->> 'receipt_id'
		 and receipt.payment_id = payment.id
		 and receipt.organization_id = notification.organization_id
		where notification.id = $1::uuid
		  and notification.organization_id = $2::uuid
		  and notification.metadata ->> 'event_key' = 'billing_payment_receipt'
		for update of payment, notification, receipt
	`, notification.ID, notification.OrganizationID).Scan(&paymentStatus, &persistedMetadataRaw)
	if errors.Is(err, pgx.ErrNoRows) {
		paymentStatus = "UNKNOWN"
	} else if err != nil {
		return billingReceiptPreflightFailure(notification, channels, err)
	}
	if paymentStatus != "UNKNOWN" {
		persistedMetadata := map[string]any{}
		if err := json.Unmarshal([]byte(persistedMetadataRaw), &persistedMetadata); err != nil {
			return billingReceiptPreflightFailure(notification, channels, err)
		}
		if !notificationClaimsMatch(notification.Metadata, persistedMetadata, channels) {
			return notificationDeliveryResult{
				Error:           errNotificationDeliveryClaimLost.Error(),
				SkipPersistence: true,
			}
		}
	}

	if !isConfirmedBillingReceiptPaymentStatus(paymentStatus) {
		if _, err := tx.Exec(ctx, `
			select private.cancel_billing_payment_receipt_delivery(
			  $1::uuid,
			  $2
			)
		`, notification.ID, paymentStatus); err != nil {
			return billingReceiptPreflightFailure(notification, channels, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return billingReceiptPreflightFailure(notification, channels, err)
		}
		return notificationDeliveryResult{SkipPersistence: true}
	}

	// Keep the payment, receipt and claimed notification update-locked through
	// the provider request and outbox state write. A concurrent refund waits,
	// then preserves a delivery
	// already accepted by the provider while cancelling every unsent channel.
	result := repo.dispatchPendingNotificationUnchecked(ctx, notification, channels)
	if err := repo.markNotificationDelivery(ctx, tx, notification, result); err != nil {
		result.Error = firstNotificationText(result.Error, "billing_receipt_delivery_persist_failed: "+err.Error())
		result.SkipPersistence = true
		return result
	}
	if err := tx.Commit(ctx); err != nil {
		result.Error = firstNotificationText(result.Error, "billing_receipt_delivery_commit_failed: "+err.Error())
	}
	result.SkipPersistence = true
	return result
}

func isConfirmedBillingReceiptPaymentStatus(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH", "REFUND_DENIED":
		return true
	default:
		return false
	}
}

func billingReceiptPreflightFailure(
	notification pendingNotification,
	channels []string,
	err error,
) notificationDeliveryResult {
	message := "billing_receipt_payment_preflight_failed"
	if err != nil {
		message += ": " + trimMax(err.Error(), 900)
	}
	result := notificationDeliveryResult{
		Error:           message,
		SkipPersistence: true,
	}
	if shouldAttemptNotificationChannel(notification.Metadata, "whatsapp", channels) {
		result.WhatsApp = DispatchChannelResult{Enabled: true, Error: message}
	}
	if shouldAttemptNotificationChannel(notification.Metadata, "email", channels) {
		result.Email = DispatchChannelResult{Enabled: true, Error: message}
	}
	return result
}

func (repo Repository) dispatchPendingWhatsAppNotification(ctx context.Context, notification pendingNotification) (DispatchWhatsAppResult, error) {
	eventKey := firstNotificationText(stringFromMap(notification.Metadata, "event_key"), "notification")
	variables := notificationVariables(notification.Metadata)
	recipient, err := repo.resolveNotificationDeliveryRecipient(ctx, notification, eventKey, "whatsapp")
	if err != nil {
		return DispatchWhatsAppResult{Enabled: true, Error: err.Error()}, err
	}
	if path := stringFromMap(variables, "checkout_path"); strings.HasPrefix(path, "/") {
		variables["checkout_url"] = strings.TrimRight(repo.notificationEmail.appURL, "/") + path
	}
	if path := stringFromMap(variables, "verification_path"); strings.HasPrefix(path, "/") {
		variables["verification_url"] = strings.TrimRight(repo.notificationEmail.appURL, "/") + path
	}
	// The email confirmation action is an authentication credential. It belongs
	// exclusively to the addressed email and must never be copied into a
	// WhatsApp template payload or provider log.
	delete(variables, "email_confirmation_url")

	request := DispatchNotificationRequest{
		EventKey:  eventKey,
		UserID:    notification.UserID,
		Recipient: recipient.WhatsApp,
		Title:     notification.Title,
		Content:   notification.Content,
		Variables: variables,
		LeadID:    notification.LeadID,
		DedupeKey: firstNotificationText(stringFromMap(notification.Metadata, "dedupe_key"), notification.ID),
		Channels:  []string{"whatsapp"},
	}
	tenantContext := tenant.Context{
		OrganizationID: notification.OrganizationID,
		UserID:         notification.UserID,
	}
	result, err := repo.dispatchWhatsAppNotification(ctx, tenantContext, request, recipient, notification.Title, notification.Content, eventKey, request.DedupeKey)
	return result, err
}

func (repo Repository) resolveNotificationDeliveryRecipient(
	ctx context.Context,
	notification pendingNotification,
	eventKey string,
	channel string,
) (notificationRecipient, error) {
	if snapshot, complete := immutableNotificationRecipientSnapshot(notification, eventKey, channel); complete {
		return snapshot, nil
	}

	recipient, err := repo.getNotificationRecipient(ctx, notification.OrganizationID, notification.UserID)
	if err != nil {
		return notificationRecipient{}, err
	}
	// Operational billing messages must follow the currently authorized
	// account contact. The metadata values are only the enqueue-time audit
	// snapshot and may already be stale after an email/phone correction.
	if requiresCurrentBillingNotificationContact(eventKey) {
		return recipient, nil
	}
	// Preserve the existing policy for operational events: the active membership
	// lookup above must succeed before any optional metadata override is used.
	recipient.Name = firstNotificationText(stringFromMap(notification.Metadata, "recipient_name"), recipient.Name)
	recipient.Email = firstNotificationText(stringFromMap(notification.Metadata, "recipient_email"), recipient.Email)
	recipient.WhatsApp = firstNotificationText(stringFromMap(notification.Metadata, "recipient_whatsapp"), recipient.WhatsApp)
	return recipient, nil
}

func immutableNotificationRecipientSnapshot(notification pendingNotification, eventKey string, channel string) (notificationRecipient, bool) {
	eventKey = strings.TrimSpace(eventKey)
	if !usesImmutableNotificationRecipientSnapshot(eventKey) {
		return notificationRecipient{}, false
	}

	recipient := notificationRecipient{
		ID:       notification.UserID,
		Name:     stringFromMap(notification.Metadata, "recipient_name"),
		Email:    stringFromMap(notification.Metadata, "recipient_email"),
		WhatsApp: stringFromMap(notification.Metadata, "recipient_whatsapp"),
	}
	switch strings.ToLower(strings.TrimSpace(channel)) {
	case "email":
		return recipient, recipient.Email != ""
	case "whatsapp":
		return recipient, recipient.WhatsApp != ""
	default:
		return notificationRecipient{}, false
	}
}

func usesImmutableNotificationRecipientSnapshot(eventKey string) bool {
	eventKey = strings.ToLower(strings.TrimSpace(eventKey))
	return eventKey == "onboarding_welcome" ||
		eventKey == "onboarding_email_confirmation" ||
		eventKey == "billing_payment_receipt"
}

func requiresCurrentBillingNotificationContact(eventKey string) bool {
	eventKey = strings.ToLower(strings.TrimSpace(eventKey))
	return isBillingNotificationEvent(eventKey) && eventKey != "billing_payment_receipt"
}

func (repo Repository) dispatchPendingPushNotification(ctx context.Context, notification pendingNotification) DispatchChannelResult {
	if repo.notificationPush == nil || !repo.notificationPush.hasAnySender() {
		return DispatchChannelResult{Enabled: false, Error: "push_sender_not_configured"}
	}
	subscriptions, err := repo.listActivePushSubscriptions(ctx, notification.UserID)
	if err != nil {
		return DispatchChannelResult{Enabled: true, Error: err.Error()}
	}
	if len(subscriptions) == 0 {
		return DispatchChannelResult{Enabled: true, Error: "push_tokens_missing"}
	}

	payload := pushPayload{
		Title:     notification.Title,
		Body:      notification.Content,
		Type:      notification.Type,
		LeadID:    notification.LeadID,
		TargetURL: firstNotificationText(notification.TargetURL, notificationTargetURL(notification)),
	}
	aggregate := DispatchChannelResult{Enabled: true, Attempted: true, Provider: "push", OK: true}
	permanentFailures := 0
	for _, subscription := range subscriptions {
		item := repo.notificationPush.send(ctx, subscription, payload)
		permanent := isPermanentPushDeliveryFailure(item)
		_ = repo.recordPushDelivery(ctx, notification, subscription, item, permanent)
		if item.Attempted && item.OK {
			aggregate.Sent++
			continue
		}
		if permanent {
			permanentFailures++
			_ = repo.deactivateDeadPushSubscription(ctx, notification.UserID, subscription)
		}
		aggregate.Skipped++
		if item.Error != "" {
			aggregate.Error = firstNotificationText(aggregate.Error, item.Error)
		}
		if item.Status != 0 {
			aggregate.Status = item.Status
		}
	}
	if aggregate.Sent == 0 {
		aggregate.OK = false
		aggregate.Permanent = permanentFailures == len(subscriptions)
	}
	return aggregate
}

func (repo Repository) recordPushDelivery(ctx context.Context, notification pendingNotification, subscription pushSubscription, result DispatchChannelResult, permanent bool) error {
	if strings.TrimSpace(subscription.ID) == "" {
		return nil
	}
	errorCode := strings.TrimSpace(result.Error)
	if len(errorCode) > 240 {
		errorCode = errorCode[:240]
	}
	_, err := repo.db.Pool().Exec(ctx, `
		with token_health as (
			update public.push_tokens
			set last_success_at = case when $5 then now() else last_success_at end,
			    last_failure_at = case when $5 then last_failure_at else now() end,
			    last_failure_reason = case when $5 then null else nullif($6, '') end,
			    failure_count = case when $5 then 0 else coalesce(failure_count, 0) + 1 end,
			    updated_at = now()
			where id = $3::uuid and user_id = $2::uuid
			returning id
		)
		insert into public.push_delivery_events (
			organization_id, notification_id, push_token_id, user_id,
			platform, provider, attempted, succeeded, permanent_failure,
			status_code, error_code
		)
		select $1::uuid, $4::uuid, id, $2::uuid,
		       $7, $8, $9, $5, $10, nullif($11, 0), nullif($6, '')
		from token_health
	`, notification.OrganizationID, notification.UserID, subscription.ID, notification.ID,
		result.Attempted && result.OK, errorCode, subscription.Platform, result.Provider,
		result.Attempted, permanent, result.Status)
	if isUndefinedTableError(err) || isUndefinedColumnError(err) {
		return nil
	}
	return err
}

func isPermanentPushDeliveryFailure(result DispatchChannelResult) bool {
	errorText := strings.ToLower(strings.TrimSpace(result.Error))
	provider := strings.ToLower(strings.TrimSpace(result.Provider))
	if strings.Contains(errorText, "web_push_subscription_incomplete") {
		return true
	}

	if provider == "web_push" {
		return result.Status == http.StatusNotFound ||
			result.Status == http.StatusGone ||
			strings.Contains(errorText, "push subscription has unsubscribed or expired")
	}

	return strings.Contains(errorText, "fcm_unregistered") ||
		strings.Contains(errorText, "unregistered") ||
		strings.Contains(errorText, "notregistered") ||
		strings.Contains(errorText, "registration-token-not-registered")
}

func (repo Repository) deactivateDeadPushSubscription(ctx context.Context, userID string, subscription pushSubscription) error {
	endpoint := strings.TrimSpace(subscription.Endpoint)
	token := nativePushToken(subscription)
	if endpoint == "" && token == "" {
		return nil
	}

	_, err := repo.db.Pool().Exec(ctx, `
		update public.push_tokens
		set is_active = false,
		    updated_at = now()
		where user_id = $1::uuid
		  and (
		    ($2 <> '' and endpoint = $2)
		    or ($3 <> '' and token = $3)
		  )
	`, userID, endpoint, token)
	if isUndefinedTableError(err) || isUndefinedColumnError(err) {
		return nil
	}
	return err
}

func (repo Repository) dispatchPendingEmailNotification(ctx context.Context, notification pendingNotification) DispatchChannelResult {
	eventKey := firstNotificationText(stringFromMap(notification.Metadata, "event_key"), "notification")
	if eventKey != "deal_won" && eventKey != "onboarding_welcome" && eventKey != "onboarding_email_confirmation" && !isBillingNotificationEvent(eventKey) {
		return DispatchChannelResult{Enabled: false, Error: "email_event_not_supported"}
	}
	if confirmationURL := stringFromMap(notificationVariables(notification.Metadata), "email_confirmation_url"); confirmationURL != "" && emailConfirmationCapabilityExpired(notification.Metadata, time.Now().UTC()) {
		return DispatchChannelResult{
			Enabled:   true,
			Permanent: true,
			Provider:  "resend",
			Error:     "onboarding_email_confirmation_capability_expired",
		}
	}
	recipient, err := repo.resolveNotificationDeliveryRecipient(ctx, notification, eventKey, "email")
	if err != nil {
		return DispatchChannelResult{Enabled: true, Error: err.Error()}
	}
	idempotencyKey := "vimob:" + eventKey + ":" + notification.ID + ":v1"
	if err := repo.prepareNotificationEmailDelivery(
		ctx,
		notification,
		recipient.Email,
		transactionalEmailSubject(eventKey, notification.Title),
		eventKey,
		idempotencyKey,
	); err != nil {
		return DispatchChannelResult{
			Enabled:        true,
			Provider:       "resend",
			Recipient:      strings.TrimSpace(recipient.Email),
			IdempotencyKey: idempotencyKey,
			Error:          "email_log_prepare_failed: " + trimMax(err.Error(), 900),
		}
	}
	if eventKey == "onboarding_welcome" || eventKey == "onboarding_email_confirmation" {
		variables := notificationVariables(notification.Metadata)
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
		variables := notificationVariables(notification.Metadata)
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
	payload := dealWonEmailPayload{
		RecipientEmail: recipient.Email,
		RecipientName:  recipient.Name,
		LeadName:       firstNotificationText(stringFromMap(notification.Metadata, "lead_name"), stringFromMap(notificationVariables(notification.Metadata), "lead_name")),
		ActorName:      firstNotificationText(stringFromMap(notification.Metadata, "actor_name"), stringFromMap(notificationVariables(notification.Metadata), "actor_name")),
		Organization:   firstNotificationText(stringFromMap(notification.Metadata, "organization_name"), stringFromMap(notificationVariables(notification.Metadata), "organization_name")),
		Value:          firstNotificationText(stringFromMap(notification.Metadata, "valor_interesse"), stringFromMap(notificationVariables(notification.Metadata), "valor_interesse")),
		LeadURL:        firstNotificationText(notification.TargetURL, notificationTargetURL(notification)),
		IdempotencyKey: idempotencyKey,
	}
	return repo.notificationEmail.sendDealWon(ctx, payload)
}

func (repo Repository) prepareNotificationEmailDelivery(
	ctx context.Context,
	notification pendingNotification,
	recipientEmail string,
	subject string,
	eventKey string,
	idempotencyKey string,
) error {
	_, err := repo.db.Pool().Exec(ctx, `
		insert into public.email_logs (
			organization_id,
			user_id,
			notification_id,
			recipient_email,
			subject,
			status,
			error_message,
			sent_at,
			template_key,
			provider,
			idempotency_key,
			updated_at,
			metadata
		)
		values (
			$1::uuid,
			nullif($2, '')::uuid,
			$3::uuid,
			$4,
			$5,
			'processing',
			null,
			null,
			$6,
			'resend',
			$7,
			now(),
			jsonb_build_object('event_key', $6, 'phase', 'provider_request_pending')
		)
		on conflict (notification_id) where notification_id is not null
		do update set
			recipient_email = excluded.recipient_email,
			subject = excluded.subject,
			status = case
				when email_logs.status_event_at is not null
				  or email_logs.status = 'delivered'
					then email_logs.status
				else 'processing'
			end,
			error_message = case
				when email_logs.status_event_at is not null
				  or email_logs.status = 'delivered'
					then email_logs.error_message
				else null
			end,
			template_key = excluded.template_key,
			provider = excluded.provider,
			idempotency_key = coalesce(email_logs.idempotency_key, excluded.idempotency_key),
			updated_at = now(),
			metadata = coalesce(email_logs.metadata, '{}'::jsonb) || excluded.metadata
	`, notification.OrganizationID, notification.UserID, notification.ID,
		strings.TrimSpace(recipientEmail), strings.TrimSpace(subject), eventKey, idempotencyKey)
	return err
}

func (repo Repository) markNotificationDelivery(ctx context.Context, tx pgx.Tx, notification pendingNotification, result notificationDeliveryResult) error {
	metadata := notification.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	writeWhatsApp := result.WhatsApp.Enabled || result.WhatsApp.Attempted || result.WhatsApp.Error != ""
	writePush := result.Push.Enabled || result.Push.Attempted || result.Push.Error != ""
	writeEmail := result.Email.Enabled || result.Email.Attempted || result.Email.Error != ""
	whatsAppClaimToken := notificationChannelClaimToken(metadata, "whatsapp")
	pushClaimToken := notificationChannelClaimToken(metadata, "push")
	emailClaimToken := notificationChannelClaimToken(metadata, "email")
	if writeWhatsApp {
		metadata = setNotificationChannelDispatch(metadata, "whatsapp", result.WhatsApp)
		metadata["whatsapp_dispatch"] = mapFromAny(mapFromAny(metadata["dispatch"])["whatsapp"])
	}
	if writePush {
		metadata = setNotificationChannelDispatch(metadata, "push", result.Push)
	}
	if writeEmail {
		metadata = setNotificationChannelDispatch(metadata, "email", result.Email)
	}

	command, err := tx.Exec(ctx, `
		update public.notifications
		set metadata = $2::jsonb
		where id = $1::uuid
		  and (
		    not $3::boolean
		    or $4 = ''
		    or coalesce(metadata #>> '{dispatch,whatsapp,claim_token}', '') = $4
		  )
		  and (
		    not $5::boolean
		    or $6 = ''
		    or coalesce(metadata #>> '{dispatch,push,claim_token}', '') = $6
		  )
		  and (
		    not $7::boolean
		    or $8 = ''
		    or coalesce(metadata #>> '{dispatch,email,claim_token}', '') = $8
		  )
	`, notification.ID, jsonb(metadata), writeWhatsApp, whatsAppClaimToken, writePush, pushClaimToken, writeEmail, emailClaimToken)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return errNotificationDeliveryClaimLost
	}
	if writeEmail {
		return repo.recordNotificationEmailDelivery(ctx, tx, notification, result.Email)
	}
	return nil
}

func (repo Repository) recordNotificationEmailDelivery(ctx context.Context, tx pgx.Tx, notification pendingNotification, result DispatchChannelResult) error {
	status := "blocked"
	if result.OK {
		status = "accepted"
	} else if result.Attempted {
		status = "failed"
	}
	eventKey := firstNotificationText(stringFromMap(notification.Metadata, "event_key"), "notification")
	if strings.EqualFold(strings.TrimSpace(result.Provider), "resend") && strings.TrimSpace(result.MessageID) != "" {
		if _, err := tx.Exec(ctx, `
			select pg_catalog.pg_advisory_xact_lock(
				pg_catalog.hashtextextended('resend:' || $1, 0)
			)
		`, strings.TrimSpace(result.MessageID)); err != nil {
			return err
		}
	}
	_, err := tx.Exec(ctx, `
		insert into public.email_logs (
			organization_id,
			user_id,
			notification_id,
			recipient_email,
			subject,
			status,
			error_message,
			sent_at,
			template_key,
			provider,
			provider_message_id,
			idempotency_key,
			accepted_at,
			updated_at,
			metadata
		)
		values (
			$1::uuid,
			nullif($2, '')::uuid,
			$3::uuid,
			$4,
			$5,
			$6,
			nullif($7, ''),
			now(),
			$8,
			coalesce(nullif($9, ''), 'resend'),
			nullif($10, ''),
			nullif($11, ''),
			case when $6 = 'accepted' then now() else null end,
			now(),
			jsonb_build_object('event_key', $8, 'http_status', $12::int)
		)
		on conflict (notification_id) where notification_id is not null
		do update set
			recipient_email = excluded.recipient_email,
			subject = excluded.subject,
			status = case
				when email_logs.status_event_at is not null
				  or email_logs.status = 'delivered'
					then email_logs.status
				else excluded.status
			end,
			error_message = case
				when email_logs.status_event_at is not null
				  or email_logs.status = 'delivered'
					then email_logs.error_message
				else excluded.error_message
			end,
			sent_at = excluded.sent_at,
			provider = excluded.provider,
			provider_message_id = coalesce(excluded.provider_message_id, email_logs.provider_message_id),
			idempotency_key = coalesce(excluded.idempotency_key, email_logs.idempotency_key),
			accepted_at = coalesce(email_logs.accepted_at, excluded.accepted_at),
			updated_at = now(),
			metadata = coalesce(email_logs.metadata, '{}'::jsonb) || excluded.metadata
	`, notification.OrganizationID, notification.UserID, notification.ID,
		strings.TrimSpace(result.Recipient), transactionalEmailSubject(eventKey, notification.Title), status, trimMax(result.Error, 1000),
		eventKey, result.Provider, result.MessageID, result.IdempotencyKey, result.Status)
	return err
}

func (repo Repository) markNotificationDeliveryDirect(ctx context.Context, notification pendingNotification, result notificationDeliveryResult) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := repo.markNotificationDelivery(ctx, tx, notification, result); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func setNotificationChannelDispatch(metadata map[string]any, channel string, result DispatchChannelResult) map[string]any {
	dispatch := mapFromAny(metadata["dispatch"])
	previous := mapFromAny(dispatch[channel])
	attempts := notificationDispatchAttempts(metadata, channel) + 1
	status := "failed"
	errorText := result.Error
	switch {
	case result.OK:
		status = "sent"
		if channel == "email" || channel == "whatsapp" {
			// A provider 2xx only accepted the request. Delivery is reconciled by
			// the signed provider webhook; accepted is terminal for automatic
			// retries so we never duplicate a transactional message.
			status = "accepted"
		}
	case result.OutcomeUnknown && channel == "whatsapp":
		// The request was written but its response was not authoritative. Do not
		// resend blindly: keep an accepted-like terminal state that the signed
		// provider webhook can reconcile by expected_message_id.
		status = "accepted"
	case result.Permanent:
		status = "permanent_failed"
	case attempts >= notificationDispatchMaxAttempts:
		status = "permanent_failed"
	}
	nextAttemptAt := ""
	if status == "failed" {
		delay := 30 * time.Second * time.Duration(1<<minInt(attempts-1, 7))
		if delay > time.Hour {
			delay = time.Hour
		}
		nextAttemptAt = time.Now().UTC().Add(delay).Format(time.RFC3339)
	}
	dispatch[channel] = map[string]any{
		"required":            true,
		"status":              status,
		"attempts":            attempts,
		"provider":            result.Provider,
		"recipient":           firstNotificationText(result.Recipient, stringFromMap(previous, "recipient")),
		"session_id":          result.SessionID,
		"instance_id":         result.InstanceID,
		"message_id":          result.MessageID,
		"expected_message_id": result.ExpectedMessageID,
		"idempotency_key":     result.IdempotencyKey,
		"http_status":         result.Status,
		"sent":                result.Sent,
		"skipped":             result.Skipped,
		"error":               errorText,
		"outcome_unknown":     result.OutcomeUnknown,
		"next_attempt_at":     nextAttemptAt,
		"updated_at":          time.Now().UTC().Format(time.RFC3339),
	}
	metadata["dispatch"] = dispatch
	if channel == "email" && (result.OK || result.Permanent) {
		metadata = scrubEmailConfirmationCapability(metadata)
	}
	return metadata
}

func emailConfirmationCapabilityExpired(metadata map[string]any, now time.Time) bool {
	expiresAt := strings.TrimSpace(stringFromMap(metadata, "email_confirmation_expires_at"))
	if expiresAt == "" {
		return true
	}
	parsed, err := time.Parse(time.RFC3339, expiresAt)
	return err != nil || !now.Before(parsed)
}

func scrubEmailConfirmationCapability(metadata map[string]any) map[string]any {
	variables := mapFromAny(metadata["variables"])
	_, nestedExists := variables["email_confirmation_url"]
	_, rootExists := metadata["email_confirmation_url"]
	if !nestedExists && !rootExists {
		return metadata
	}
	delete(variables, "email_confirmation_url")
	delete(metadata, "email_confirmation_url")
	metadata["variables"] = variables
	metadata["email_confirmation_scrubbed_at"] = time.Now().UTC().Format(time.RFC3339)
	return metadata
}

func setNotificationChannelProcessing(metadata map[string]any, channel string, claimToken string) map[string]any {
	dispatch := mapFromAny(metadata["dispatch"])
	current := mapFromAny(dispatch[channel])
	current["required"] = true
	current["status"] = "processing"
	current["claim_token"] = claimToken
	current["claimed_at"] = time.Now().UTC().Format(time.RFC3339)
	current["updated_at"] = time.Now().UTC().Format(time.RFC3339)
	dispatch[channel] = current
	metadata["dispatch"] = dispatch
	if channel == "whatsapp" {
		metadata["whatsapp_dispatch"] = mapFromAny(current)
		metadata["whatsapp_dispatch_required"] = true
	}
	return metadata
}

func prepareTransactionalWhatsAppReceiptCorrelation(metadata map[string]any, notification pendingNotification) map[string]any {
	eventKey := strings.ToLower(strings.TrimSpace(stringFromMap(metadata, "event_key")))
	if !isPlatformTransactionalNotificationEvent(eventKey) {
		return metadata
	}
	recipient := normalizeNotificationWhatsAppRecipient(stringFromMap(metadata, "recipient_whatsapp"))
	dedupeKey := firstNotificationText(stringFromMap(metadata, "dedupe_key"), notification.ID)
	idempotencyKey := notificationWhatsAppIdempotencyKey(notification.OrganizationID, eventKey, dedupeKey)
	if recipient == "" || idempotencyKey == "" {
		return metadata
	}
	dispatch := mapFromAny(metadata["dispatch"])
	current := mapFromAny(dispatch["whatsapp"])
	current["provider"] = "evolution_go"
	current["notification_id"] = notification.ID
	current["organization_id"] = notification.OrganizationID
	current["recipient"] = recipient
	current["idempotency_key"] = idempotencyKey
	current["expected_message_id"] = deterministicNotificationWhatsAppMessageID(idempotencyKey)
	current["prepared_at"] = time.Now().UTC().Format(time.RFC3339)
	dispatch["whatsapp"] = current
	metadata["dispatch"] = dispatch
	metadata["whatsapp_dispatch"] = mapFromAny(current)
	return metadata
}

func notificationChannelClaimToken(metadata map[string]any, channel string) string {
	dispatch := mapFromAny(mapFromAny(metadata["dispatch"])[channel])
	claimToken := strings.TrimSpace(fmt.Sprint(dispatch["claim_token"]))
	if claimToken == "" && channel == "whatsapp" {
		claimToken = strings.TrimSpace(fmt.Sprint(mapFromAny(metadata["whatsapp_dispatch"])["claim_token"]))
	}
	return claimToken
}

func notificationClaimsMatch(claimed map[string]any, persisted map[string]any, requested []string) bool {
	for _, channel := range []string{"whatsapp", "push", "email"} {
		if !shouldAttemptNotificationChannel(claimed, channel, requested) {
			continue
		}
		expected := notificationChannelClaimToken(claimed, channel)
		if expected != "" && notificationChannelClaimToken(persisted, channel) != expected {
			return false
		}
	}
	return true
}

func shouldClaimNotificationChannel(metadata map[string]any, channel string) bool {
	if !shouldAttemptNotificationChannel(metadata, channel, nil) {
		return false
	}
	status := notificationChannelStatus(metadata, channel)
	if status != "processing" {
		return true
	}
	return notificationChannelClaimExpired(metadata, channel)
}

func shouldAttemptNotificationChannel(metadata map[string]any, channel string, requested []string) bool {
	if !requestWantsChannel(requested, channel) {
		return false
	}
	required := false
	if channel == "whatsapp" {
		required = truthyString(stringFromMap(metadata, "whatsapp_dispatch_required"))
	}
	channelDispatch := mapFromAny(mapFromAny(metadata["dispatch"])[channel])
	required = required || truthyValue(channelDispatch["required"])
	if !required {
		return false
	}
	status := notificationChannelStatus(metadata, channel)
	switch status {
	case "accepted", "delivered", "delivery_failed", "sent", "skipped", "permanent_failed":
		return false
	}
	return notificationDispatchAttempts(metadata, channel) < notificationDispatchMaxAttempts
}

func notificationChannelStatus(metadata map[string]any, channel string) string {
	channelDispatch := mapFromAny(mapFromAny(metadata["dispatch"])[channel])
	status := strings.TrimSpace(fmt.Sprint(channelDispatch["status"]))
	if status == "" && channel == "whatsapp" {
		status = strings.TrimSpace(fmt.Sprint(mapFromAny(metadata["whatsapp_dispatch"])["status"]))
	}
	if status == "" {
		status = "pending"
	}
	return status
}

func notificationChannelClaimExpired(metadata map[string]any, channel string) bool {
	channelDispatch := mapFromAny(mapFromAny(metadata["dispatch"])[channel])
	claimedAt := strings.TrimSpace(fmt.Sprint(channelDispatch["claimed_at"]))
	if claimedAt == "" && channel == "whatsapp" {
		claimedAt = strings.TrimSpace(fmt.Sprint(mapFromAny(metadata["whatsapp_dispatch"])["claimed_at"]))
	}
	if claimedAt == "" {
		return true
	}
	parsed, err := time.Parse(time.RFC3339, claimedAt)
	if err != nil {
		return true
	}
	return time.Since(parsed) > notificationDispatchClaimTimeout
}

func notificationDispatchAttempts(metadata map[string]any, channel string) int {
	if metadata == nil {
		return 0
	}
	dispatch := mapFromAny(mapFromAny(metadata["dispatch"])[channel])
	if len(dispatch) == 0 && channel == "whatsapp" {
		dispatch = mapFromAny(metadata["whatsapp_dispatch"])
	}
	value := dispatch["attempts"]
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(typed))
		if err == nil {
			return parsed
		}
	case fmt.Stringer:
		parsed, err := strconv.Atoi(strings.TrimSpace(typed.String()))
		if err == nil {
			return parsed
		}
	}
	return 0
}

func (repo Repository) listActivePushSubscriptions(ctx context.Context, userID string) ([]pushSubscription, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select
			id::text,
			coalesce(endpoint, ''),
			coalesce(p256dh, ''),
			coalesce(auth, ''),
			coalesce(token, ''),
			coalesce(platform, ''),
			coalesce(device_info, '{}'::jsonb)::text
		from public.push_tokens
		where user_id = $1::uuid
		  and coalesce(is_active, true) = true
		order by updated_at desc nulls last, created_at desc nulls last
	`, userID)
	if isUndefinedTableError(err) || isUndefinedColumnError(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	subscriptions := []pushSubscription{}
	seenSubscriptions := map[string]struct{}{}
	for rows.Next() {
		var item pushSubscription
		var rawDeviceInfo string
		if err := rows.Scan(&item.ID, &item.Endpoint, &item.P256DH, &item.Auth, &item.Token, &item.Platform, &rawDeviceInfo); err != nil {
			return nil, err
		}
		var deviceInfo map[string]any
		_ = json.Unmarshal([]byte(rawDeviceInfo), &deviceInfo)
		item.Endpoint = firstNotificationText(item.Endpoint, stringFromMap(deviceInfo, "endpoint"))
		item.P256DH = firstNotificationText(item.P256DH, stringFromMap(deviceInfo, "p256dh"))
		item.Auth = firstNotificationText(item.Auth, stringFromMap(deviceInfo, "auth"))
		item.Platform = strings.ToLower(firstNotificationText(item.Platform, stringFromMap(deviceInfo, "platform")))
		if item.Endpoint == "" && item.Token != "" && isNativePushSubscription(item) {
			item.Endpoint = "native:" + firstNotificationText(item.Platform, "unknown") + ":" + item.Token
		}
		if item.Endpoint == "" && item.Token != "" && item.Platform == "web" {
			item.Endpoint = item.Token
		}
		if item.Endpoint == "" && item.Token == "" {
			continue
		}
		dedupeKey := item.Endpoint + "\x00" + item.Token
		if _, seen := seenSubscriptions[dedupeKey]; seen {
			continue
		}
		seenSubscriptions[dedupeKey] = struct{}{}
		subscriptions = append(subscriptions, item)
	}
	return subscriptions, rows.Err()
}

func (repo Repository) CreateDueScheduleReminderNotifications(ctx context.Context) error {
	_, err := repo.createDueScheduleReminderNotifications(ctx)
	return err
}

func (repo Repository) createDueScheduleReminderNotifications(ctx context.Context) (int64, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	var locked bool
	if err := tx.QueryRow(ctx, `select pg_try_advisory_xact_lock($1)`, scheduleReminderLockKey).Scan(&locked); err != nil {
		return 0, err
	}
	if !locked {
		return 0, nil
	}

	tag, err := tx.Exec(ctx, `
		with due_events as (
			select
				se.id,
				se.organization_id,
				se.user_id,
				se.lead_id,
				se.property_id,
				se.title,
				se.event_type,
				coalesce(se.reminder_minutes, 5) as reminder_minutes,
				se.start_time,
				se.start_time - make_interval(mins => greatest(coalesce(se.reminder_minutes, 5), 0)) as reminder_due_at,
				l.name as lead_name,
				p.title as property_title,
				p.code as property_code
			from public.schedule_events se
			left join public.leads l
			  on l.organization_id = se.organization_id
			 and l.id = se.lead_id
			left join public.properties p
			  on p.organization_id = se.organization_id
			 and p.id = se.property_id
			where coalesce(se.status, 'scheduled') = 'scheduled'
			  and se.start_time > now()
			  and se.start_time - make_interval(mins => greatest(coalesce(se.reminder_minutes, 5), 0)) <= now() + interval '30 seconds'
		),
		recipients as (
			select distinct
				due_events.id,
				due_events.organization_id,
				due_events.user_id,
				due_events.lead_id,
				due_events.property_id,
				due_events.title,
				due_events.event_type,
				due_events.reminder_minutes,
				due_events.start_time,
				due_events.reminder_due_at,
				due_events.lead_name,
				due_events.property_title,
				due_events.property_code
			from due_events
			union
			select distinct
				due_events.id,
				due_events.organization_id,
				sea.user_id,
				due_events.lead_id,
				due_events.property_id,
				due_events.title,
				due_events.event_type,
				due_events.reminder_minutes,
				due_events.start_time,
				due_events.reminder_due_at,
				due_events.lead_name,
				due_events.property_title,
				due_events.property_code
			from due_events
			join public.schedule_event_assignees sea
			  on sea.event_id = due_events.id
			 and sea.organization_id = due_events.organization_id
		),
		pending_recipients as (
			select recipients.*
			from recipients
			where user_id is not null
			  and not exists (
			    select 1
			    from public.notifications n
			    where n.organization_id = recipients.organization_id
			      and n.user_id = recipients.user_id
			      and n.metadata->>'dedupe_key' = 'schedule_reminder:' || recipients.id::text || ':' || recipients.user_id::text
			  )
			order by reminder_due_at asc, start_time asc, id asc, user_id asc
			limit 50
		)
		insert into public.notifications (
			organization_id,
			user_id,
			title,
			content,
			body,
			type,
			channel,
			lead_id,
			target_url,
			metadata
		)
		select
			organization_id,
			user_id,
			'Lembrete de agenda',
			'A atividade "' || title || '" comeca em instantes.',
			'A atividade "' || title || '" comeca em instantes.',
			'schedule',
			'in_app',
			lead_id,
			'/agenda',
			jsonb_build_object(
				'event_key', 'schedule_reminder',
				'dedupe_key', 'schedule_reminder:' || id::text || ':' || user_id::text,
				'schedule_event_id', id::text,
				'schedule_title', title,
				'schedule_event_type', event_type,
				'reminder_minutes', reminder_minutes,
				'start_time', start_time,
				'reminder_due_at', reminder_due_at,
				'lead_id', lead_id,
				'lead_name', nullif(lead_name, ''),
				'property_id', property_id,
				'property_title', nullif(property_title, ''),
				'property_code', nullif(property_code, ''),
				'dispatch', jsonb_build_object(
					'push', jsonb_build_object('required', true, 'status', 'pending'),
					'whatsapp', jsonb_build_object('required', true, 'status', 'pending')
				),
				'whatsapp_dispatch_required', true,
				'whatsapp_dispatch', jsonb_build_object('status', 'pending')
			)
		from pending_recipients
		on conflict do nothing
	`)
	if isUndefinedTableError(err) || isUndefinedColumnError(err) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func notificationTargetURL(notification pendingNotification) string {
	if notification.LeadID != nil && strings.TrimSpace(*notification.LeadID) != "" {
		return "/crm/pipelines?lead=" + strings.TrimSpace(*notification.LeadID)
	}
	switch notification.Type {
	case "schedule":
		return "/agenda"
	case "whatsapp":
		return "/settings?tab=integrations"
	default:
		return "/notifications"
	}
}

func billingPeriodLabel(value string) string {
	switch strings.TrimSpace(value) {
	case "1", "1.0":
		return "mensal"
	case "6", "6.0":
		return "semestral"
	case "12", "12.0":
		return "anual"
	default:
		return firstNotificationText(strings.TrimSpace(value), "mensal")
	}
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}

func notificationVariables(metadata map[string]any) map[string]any {
	if metadata == nil {
		return map[string]any{}
	}
	variables := map[string]any{}
	for key, value := range metadata {
		switch key {
		case "dispatch", "whatsapp_dispatch", "push_dispatch", "email_dispatch", "variables":
			continue
		default:
			variables[key] = value
		}
	}
	if nested, ok := metadata["variables"].(map[string]any); ok {
		for key, value := range nested {
			variables[key] = value
		}
	}
	return variables
}

func truthyString(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "true", "1", "yes", "sim":
		return true
	default:
		return false
	}
}

func truthyValue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return truthyString(typed)
	case float64:
		return typed != 0
	case int:
		return typed != 0
	default:
		return false
	}
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
