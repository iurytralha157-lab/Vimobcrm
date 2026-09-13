package admin

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	defaultNotificationDeliveryListLimit = 50
	maximumNotificationDeliveryListLimit = 100
)

type NotificationDeliveryOperations struct {
	Metrics    []map[string]any `json:"metrics"`
	Deliveries []map[string]any `json:"deliveries"`
}

type ReplayNotificationDeliveryRequest struct {
	Reason string `json:"reason"`
}

var notificationDeliveryStatuses = map[string]struct{}{
	"accepted":           {},
	"all":                {},
	"blocked_dependency": {},
	"cancelled":          {},
	"dead_letter":        {},
	"delivered":          {},
	"leased":             {},
	"permanent_failed":   {},
	"queued":             {},
	"retry_wait":         {},
	"sending":            {},
}

func normalizeNotificationDeliveryStatus(value string) (string, bool) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return "problems", true
	}
	_, ok := notificationDeliveryStatuses[normalized]
	return normalized, ok
}

func normalizeNotificationDeliveryLimit(value int) int {
	if value < 1 {
		return defaultNotificationDeliveryListLimit
	}
	if value > maximumNotificationDeliveryListLimit {
		return maximumNotificationDeliveryListLimit
	}
	return value
}

func normalizeNotificationReplayReason(value string) (string, bool) {
	normalized := strings.TrimSpace(value)
	return normalized, normalized != "" && utf8.RuneCountInString(normalized) <= 1_000
}

func (repo Repository) NotificationDeliveryOperations(
	ctx context.Context,
	tenantContext tenant.Context,
	status string,
	limit int,
) (NotificationDeliveryOperations, error) {
	if !tenantContext.IsSuperAdmin {
		return NotificationDeliveryOperations{}, tenant.ErrOrganizationAccessDenied
	}

	normalizedStatus, ok := normalizeNotificationDeliveryStatus(status)
	if !ok {
		return NotificationDeliveryOperations{}, ErrInvalidInput
	}
	limit = normalizeNotificationDeliveryLimit(limit)

	metrics, err := repo.queryJSONRows(ctx, `
		select jsonb_strip_nulls(jsonb_build_object(
			'organizationId', metric.organization_id::text,
			'channel', metric.channel,
			'status', metric.status,
			'deliveryCount', metric.delivery_count,
			'dueCount', metric.due_count,
			'oldestCreatedAt', metric.oldest_created_at,
			'oldestNextAttemptAt', metric.oldest_next_attempt_at,
			'oldestLeaseExpiresAt', metric.oldest_lease_expires_at,
			'maxAttemptCount', metric.max_attempt_count
		))
		from private.notification_delivery_metrics() as metric
		order by metric.status, metric.channel, metric.organization_id
	`)
	if err != nil {
		return NotificationDeliveryOperations{}, err
	}

	deliveries, err := repo.queryJSONRows(ctx, `
		select jsonb_strip_nulls(jsonb_build_object(
			'id', delivery.id::text,
			'notificationId', delivery.notification_id::text,
			'organizationId', delivery.organization_id::text,
			'organizationName', organization.name,
			'userId', delivery.user_id::text,
			'eventKey', notification.metadata ->> 'event_key',
			'title', notification.title,
			'channel', delivery.channel,
			'recipientKey', delivery.recipient_key,
			'status', delivery.status,
			'priority', delivery.priority,
			'attemptCount', delivery.attempt_count,
			'maxAttempts', delivery.max_attempts,
			'nextAttemptAt', delivery.next_attempt_at,
			'expiresAt', delivery.expires_at,
			'leaseExpiresAt', delivery.lease_expires_at,
			'dependencyKey', delivery.dependency_key,
			'provider', delivery.provider,
			'providerMessageId', delivery.provider_message_id,
			'providerStatus', delivery.provider_status,
			'acceptedAt', delivery.accepted_at,
			'deliveredAt', delivery.delivered_at,
			'terminalAt', delivery.terminal_at,
			'lastErrorCode', delivery.last_error_code,
			'lastErrorMessage', delivery.last_error_message,
			'lastErrorAt', delivery.last_error_at,
			'createdAt', delivery.created_at,
			'updatedAt', delivery.updated_at
		))
		from private.notification_deliveries as delivery
		join public.notifications as notification
		  on notification.id = delivery.notification_id
		left join public.organizations as organization
		  on organization.id = delivery.organization_id
		where (
			$1 = 'all'
			or delivery.status = $1
			or (
				$1 = 'problems'
				and delivery.status in (
					'accepted', 'blocked_dependency', 'dead_letter', 'leased',
					'permanent_failed', 'retry_wait', 'sending'
				)
			)
		)
		order by
		  case delivery.status
			when 'dead_letter' then 0
			when 'permanent_failed' then 1
			when 'blocked_dependency' then 2
			when 'retry_wait' then 3
			when 'sending' then 4
			when 'leased' then 5
			when 'accepted' then 6
			else 7
		  end,
		  delivery.updated_at desc,
		  delivery.id
		limit $2
	`, normalizedStatus, limit)
	if err != nil {
		return NotificationDeliveryOperations{}, err
	}

	return NotificationDeliveryOperations{
		Metrics:    metrics,
		Deliveries: deliveries,
	}, nil
}

func (repo Repository) ReplayNotificationDelivery(
	ctx context.Context,
	tenantContext tenant.Context,
	deliveryID string,
	reason string,
) error {
	if !tenantContext.IsSuperAdmin {
		return tenant.ErrOrganizationAccessDenied
	}

	deliveryID, ok := normalizeUUID(deliveryID)
	if !ok {
		return ErrInvalidInput
	}
	reason, ok = normalizeNotificationReplayReason(reason)
	if !ok {
		return ErrInvalidInput
	}

	var replayed bool
	err := repo.db.Pool().QueryRow(ctx, `
		select private.replay_notification_delivery(
			$1::uuid,
			$2,
			$3
		)
	`, deliveryID, reason, tenantContext.UserID).Scan(&replayed)
	if err != nil {
		return err
	}
	if !replayed {
		return ErrInvalidInput
	}
	return nil
}
