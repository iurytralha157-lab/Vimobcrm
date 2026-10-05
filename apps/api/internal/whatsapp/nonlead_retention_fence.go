package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// The SQL completion already removed an expired, never-applied inbox item in
// the same transaction that wrote its replay tombstone and causal outcome.
// The generic worker must not attempt to complete that deleted lease again.
var errWhatsAppNonleadExpiredInboxCompleted = errors.New("expired WhatsApp nonlead inbox completed")

// A deleted pre-lead message must not be recreated by a later provider replay.
// The database function reads immutable routing provenance and the genuine
// provider timestamp. Local arrival time cannot prove that a delayed provider
// replay is new. Missing proof on a purged route is an error.
func whatsappNonleadEventWasPurged(
	ctx context.Context,
	tx pgx.Tx,
	organizationID, sessionID, providerMessageID, inboxEventKey string,
	providerOccurredAt *time.Time,
) (bool, error) {
	if strings.TrimSpace(providerMessageID) == "" {
		return false, fmt.Errorf("WhatsApp retention fence requires a provider message id")
	}
	var purged bool
	err := tx.QueryRow(ctx, `
		select public.whatsapp_nonlead_event_is_purged(
			$1::uuid, $2::uuid, $3, nullif($4, ''), $5::timestamptz
		)
	`, organizationID, sessionID, providerMessageID, inboxEventKey, providerOccurredAt).Scan(&purged)
	return purged, err
}

func currentWhatsAppNonleadRoutingKey(
	ctx context.Context,
	tx pgx.Tx,
	organizationID, sessionID, baseRoutingKey string,
) (string, error) {
	if baseRoutingKey == evolutionWebhookSessionRoute {
		return baseRoutingKey, nil
	}
	var routingKey string
	err := tx.QueryRow(ctx, `
		select private.current_whatsapp_nonlead_routing_key(
			$1::uuid, $2::uuid, $3
		)
	`, organizationID, sessionID, baseRoutingKey).Scan(&routingKey)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(routingKey) == "" || len(routingKey) > evolutionWebhookMaxRoutingBytes {
		return "", fmt.Errorf("WhatsApp retention returned an invalid routing key")
	}
	return routingKey, nil
}

func completeWhatsAppNonleadExpiredInbox(
	ctx context.Context,
	tx pgx.Tx,
	item pendingEvolutionWebhook,
	providerMessageID string,
) (bool, error) {
	if strings.TrimSpace(item.ID) == "" || strings.TrimSpace(providerMessageID) == "" {
		return false, nil
	}
	var completed bool
	err := tx.QueryRow(ctx, `
		select private.complete_whatsapp_nonlead_expired_inbox(
			$1::uuid, $2::uuid, $3::uuid, $4, $5
		)
	`, item.ID, item.OrganizationID, item.SessionID,
		providerMessageID, whatsappWebhookWorkerID).Scan(&completed)
	return completed, err
}
