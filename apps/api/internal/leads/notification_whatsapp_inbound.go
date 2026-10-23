package leads

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const whatsappInboundAttendantEvent = "whatsapp_inbound_attendant"
const whatsappInboundPushTimeout = 8 * time.Second

func (repo Repository) cancelUnstartedWhatsAppInboundPush(ctx context.Context, delivery normalizedNotificationDelivery, reason string) error {
	result, err := repo.db.Pool().Exec(ctx, `update private.notification_deliveries delivery
		set status='cancelled', terminal_at=now(), next_attempt_at=null, lease_token=null,
		leased_by=null, lease_expires_at=null, blocked_at=null, dependency_key=null,
		last_error_code=$3, last_error_message=$3, last_error_at=now(), updated_at=now()
		where delivery.id=$1::uuid and delivery.lease_token=$2::uuid
		  and delivery.channel='push' and delivery.status='leased' and delivery.attempt_count=0
		  and exists(select 1 from public.notifications notification where notification.id=delivery.notification_id
		    and notification.organization_id=delivery.organization_id
		    and notification.metadata->>'event_key'='whatsapp_inbound_attendant')`, delivery.ID, delivery.LeaseToken, reason)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return errNotificationDeliveryClaimLost
	}
	return nil
}

func isWhatsAppInboundAttendantNotification(notification pendingNotification) bool {
	return strings.EqualFold(strings.TrimSpace(stringFromMap(notification.Metadata, "event_key")), whatsappInboundAttendantEvent)
}

// The DB owns recipient selection and redirection so Go and Edge inserts share
// one transactional producer. Start the durable provider marker under the same
// authorization locks, then commit before network I/O. Transfer after this
// boundary sees an in-progress attempt and cannot redirect it.
func (repo Repository) beginWhatsAppInboundPushFence(ctx context.Context, notification pendingNotification) (pgx.Tx, string, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, "", err
	}
	release := func() { _ = tx.Rollback(context.Background()) }
	if _, err := tx.Exec(ctx, "set local lock_timeout = '2s'; set local statement_timeout = '5s'; set local idle_in_transaction_session_timeout = '20s'"); err != nil {
		release()
		return nil, "", err
	}
	var outcome string
	err = tx.QueryRow(ctx, "select private.prepare_whatsapp_inbound_attendant_push($1::uuid)", notification.ID).Scan(&outcome)
	if err != nil {
		release()
		return nil, "", err
	}
	if outcome == "authorized" {
		return tx, outcome, nil
	}
	if outcome == "cancelled" || outcome == "redirected" {
		err = tx.Commit(ctx)
		release()
		return nil, outcome, err
	}
	release()
	if outcome != "revoked" {
		return nil, "", fmt.Errorf("unexpected WhatsApp notification fence outcome %q", outcome)
	}
	return nil, outcome, nil
}

func (repo Repository) fenceNormalizedWhatsAppInboundPush(ctx context.Context, delivery normalizedNotificationDelivery, notification pendingNotification, prepare func(pgx.Tx) normalizedNotificationPreflight) normalizedNotificationPreflight {
	tx, outcome, err := repo.beginWhatsAppInboundPushFence(ctx, notification)
	if err != nil {
		return normalizedNotificationTransientPreflight("vimob", "whatsapp_inbound_authorization_failed: "+trimMax(err.Error(), 700))
	}
	if outcome == "cancelled" || outcome == "redirected" {
		return normalizedNotificationPreflight{Finalized: true}
	}
	if outcome != "authorized" {
		return normalizedNotificationPermanentPreflight("vimob", "whatsapp_inbound_authorization_revoked")
	}
	// Resolve the current recipient before old-token/configuration failures can
	// consume a pending alert. Use this transaction for token reads as well: an
	// authorization fence must not exhaust the pool while waiting for another
	// connection, or let token ownership change before the start marker.
	preflight := prepare(tx)
	if preflight.Send == nil || preflight.Failure != nil || preflight.DependencyKey != "" {
		_ = tx.Rollback(context.Background())
		return preflight
	}
	send := preflight.Send
	preflight.Release = func() { _ = tx.Rollback(context.Background()) }
	preflight.Start = func(startContext context.Context) error {
		var started bool
		if err := tx.QueryRow(startContext, `select private.start_notification_delivery($1::uuid, $2::uuid, $3)`,
			delivery.ID, delivery.LeaseToken, preflight.Provider).Scan(&started); err != nil {
			return err
		}
		if !started {
			return errNotificationDeliveryClaimLost
		}
		return tx.Commit(startContext)
	}
	preflight.Send = func(sendContext context.Context) DispatchChannelResult {
		boundedContext, cancel := context.WithTimeout(sendContext, whatsappInboundPushTimeout)
		defer cancel()
		return send(boundedContext)
	}
	return preflight
}

func (repo Repository) dispatchLegacyWhatsAppInboundPush(ctx context.Context, notification pendingNotification) notificationDeliveryResult {
	tx, outcome, err := repo.beginWhatsAppInboundPushFence(ctx, notification)
	if err != nil {
		result := DispatchChannelResult{Enabled: true, Provider: "vimob", Error: "whatsapp_inbound_authorization_failed: " + trimMax(err.Error(), 700)}
		return notificationDeliveryResult{Push: result, Error: result.Error}
	}
	if outcome != "authorized" {
		result := DispatchChannelResult{Enabled: true, Permanent: true, Skipped: 1, Provider: "vimob", Error: "whatsapp_inbound_authorization_" + outcome}
		return notificationDeliveryResult{Push: result, Error: result.Error}
	}
	defer tx.Rollback(context.Background())
	if repo.notificationPush == nil || !repo.notificationPush.hasAnySender() {
		return notificationDeliveryResult{Push: DispatchChannelResult{Enabled: false, Error: "push_sender_not_configured"}, Error: "push_sender_not_configured"}
	}
	subscriptions, err := repo.listActivePushSubscriptionsWithQueryer(ctx, tx, notification.UserID, notification.OrganizationID)
	if err != nil {
		return notificationDeliveryResult{Push: DispatchChannelResult{Enabled: true, Error: err.Error()}, Error: err.Error()}
	}
	if len(subscriptions) == 0 {
		return notificationDeliveryResult{Push: DispatchChannelResult{Enabled: true, Error: "push_tokens_missing"}, Error: "push_tokens_missing"}
	}
	ready := make([]pushSubscription, 0, len(subscriptions))
	var failure *DispatchChannelResult
	for _, subscription := range subscriptions {
		preflight := repo.preparePushSubscriptionDelivery(notification, subscription)
		if preflight.Send != nil && preflight.Failure == nil && preflight.DependencyKey == "" {
			ready = append(ready, subscription)
		} else if failure == nil {
			failure = preflight.Failure
		}
	}
	if len(ready) == 0 {
		if failure == nil {
			failure = &DispatchChannelResult{Enabled: true, Error: "push_sender_not_ready"}
		}
		return notificationDeliveryResult{Push: *failure, Error: failure.Error}
	}
	// Persist before contacting any device. A lost response is ambiguous, so a
	// later reassignment must not redirect a legacy attempt already started.
	if _, err := tx.Exec(ctx, `update public.notifications
		set metadata = metadata || jsonb_build_object('whatsapp_inbound_provider_started', true)
		where id = $1::uuid and organization_id = $2::uuid
		  and metadata->>'event_key' = 'whatsapp_inbound_attendant'`, notification.ID, notification.OrganizationID); err != nil {
		result := DispatchChannelResult{Enabled: true, Provider: "vimob", Error: "whatsapp_inbound_start_marker_failed: " + trimMax(err.Error(), 700)}
		return notificationDeliveryResult{Push: result, Error: result.Error}
	}
	if err := tx.Commit(ctx); err != nil {
		result := DispatchChannelResult{Enabled: true, Provider: "vimob", Error: "whatsapp_inbound_start_marker_failed: " + trimMax(err.Error(), 700)}
		return notificationDeliveryResult{Push: result, Error: result.Error}
	}
	// Legacy persistence builds its JSON from the claimed snapshot. Preserve
	// the durable marker instead of overwriting it after the HTTP response.
	notification.Metadata["whatsapp_inbound_provider_started"] = true
	boundedContext, cancel := context.WithTimeout(ctx, whatsappInboundPushTimeout)
	defer cancel()
	result := repo.dispatchPushSubscriptions(boundedContext, notification, ready)
	return notificationDeliveryResult{Push: result, Error: result.Error}
}
