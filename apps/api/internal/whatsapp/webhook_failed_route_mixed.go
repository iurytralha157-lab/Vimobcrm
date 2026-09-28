package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

const failedRouteUnprovenReason = "failed_route_identity_unproven:v1"
const failedRouteMixedUnprovenReason = "failed_route_mixed_identity_unproven:v1"
const failedRouteMixedUnsupportedReason = "failed_route_mixed_member_unsupported:v1"
const failedRouteMixedUnsplitReason = "failed_route_mixed_unsplit_requires_review:v1"

// Capture split members in a stable route order, independent of provider
// array order. Results remain in original ordinal positions for inbox writes.
func evolutionWebhookCaptureOrder(parts []evolutionWebhookDurablePart) []int {
	order := make([]int, len(parts))
	keys := make([]string, len(parts))
	for index, part := range parts {
		order[index] = index
		decoded, err := decodeNativeEvolutionPayload(part.Payload)
		if err != nil {
			continue
		}
		messages := withoutNativeEvolutionHistorySyncControls(extractNativeEvolutionMessages(decoded))
		messages = withoutNativeEvolutionGroupMessages(messages)
		if len(messages) == 1 {
			keys[index] = evolutionWebhookMessageBindingRoutingKey(messages[0])
		}
	}
	sort.SliceStable(order, func(a, b int) bool {
		if keys[order[a]] == keys[order[b]] {
			return order[a] < order[b]
		}
		return keys[order[a]] < keys[order[b]]
	})
	return order
}

// An unsplittable wrapper is not allowed to acquire per-contact routing locks
// or write temporary ledgers. Providers can reorder members on replay; taking
// those locks first could deadlock two callbacks before either raw ACK commits.
func failedRouteHasUnsplitMultipleDirectMessages(parts []evolutionWebhookDurablePart) bool {
	for _, part := range parts {
		decoded, err := decodeNativeEvolutionPayload(part.Payload)
		if err != nil {
			continue
		}
		messages := withoutNativeEvolutionHistorySyncControls(extractNativeEvolutionMessages(decoded))
		messages = withoutNativeEvolutionGroupMessages(messages)
		if len(messages) > 1 {
			return true
		}
	}
	return false
}

func failedRouteMixedIsolationReason(parts []evolutionWebhookDurablePart, mode string) string {
	if failedRouteHasUnsplitMixedNoGo(parts) {
		return failedRouteMixedUnprovenReason
	}
	for _, part := range parts {
		decoded, err := decodeNativeEvolutionPayload(part.Payload)
		if err != nil {
			continue
		}
		metadata := mapFromAny(decoded[evolutionWebhookRoutingMetaKey])
		snapshotEnvelope := mapFromAny(metadata["routing_snapshot"])
		snapshots := nativeObjectList(snapshotEnvelope["messages"])
		if len(snapshots) < 2 {
			continue
		}
		if mode == webhookProcessorEdge || nativeIsStatusEvent(nativeEvolutionEventName(decoded, part.EventType)) {
			return failedRouteMixedUnsplitReason
		}
		messages := withoutNativeEvolutionHistorySyncControls(extractNativeEvolutionMessages(decoded))
		messages = withoutNativeEvolutionGroupMessages(messages)
		if len(messages) != len(snapshots) {
			return failedRouteMixedUnsupportedReason
		}
		// This mirrors the native message validation that would otherwise
		// terminalize the ENTIRE inbox row, including unrelated valid members.
		for _, message := range messages {
			if message.UnsupportedMessage ||
				(message.IsReaction && message.ReactionTargetID == "") ||
				(!message.IsReaction && !message.IsDeletion &&
					!nativeIsMediaType(message.MessageType) && strings.TrimSpace(message.Content) == "") {
				return failedRouteMixedUnsupportedReason
			}
		}
		return failedRouteMixedUnsplitReason
	}
	return ""
}

// A provider wrapper that cannot be split can contain unrelated contacts.
// If one member cannot be routed safely, keep the whole wrapper private and
// roll back every tentative routing ledger instead of DEAD-lettering peers.
func failedRouteHasUnsplitMixedNoGo(parts []evolutionWebhookDurablePart) bool {
	for _, part := range parts {
		var payload struct {
			Ingress struct {
				RoutingSnapshot struct {
					Messages []struct {
						QuarantineReason string `json:"quarantine_reason"`
					} `json:"messages"`
				} `json:"routing_snapshot"`
			} `json:"__vimob_ingress"`
		}
		if json.Unmarshal(part.Payload, &payload) != nil {
			continue // The inbox trigger still rejects malformed marked batches.
		}
		members := payload.Ingress.RoutingSnapshot.Messages
		if len(members) < 2 {
			continue
		}
		for _, member := range members {
			if member.QuarantineReason == failedRouteUnprovenReason {
				return true
			}
		}
	}
	return false
}

func lockFailedRouteMixedEventKey(
	ctx context.Context, tx pgx.Tx, session evolutionWebhookSession, eventKey string,
) error {
	_, err := tx.Exec(ctx, `
		select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
		  'failed_route_mixed:' || $1::uuid::text || ':' || $2::uuid::text || ':' || $3, 0))
	`, session.OrganizationID, session.ID, eventKey)
	return err
}

// Fast duplicate check precedes route capture. The later locked check still
// decides a race with a concurrently committing first delivery.
func (repo Repository) failedRouteMixedEnvelopeAlreadyReceived(
	ctx context.Context, session evolutionWebhookSession,
	envelope evolutionWebhookEnvelope, originalPayload []byte,
) (bool, error) {
	var exact bool
	err := repo.db.Pool().QueryRow(ctx, `
		select event_type = $4 and payload_sha256 =
		  private.canonical_jsonb_sha256($5::jsonb)
		from private.whatsapp_failed_route_mixed_envelope_raw
		where organization_id = $1::uuid and session_id = $2::uuid
		  and event_key = $3
	`, session.OrganizationID, session.ID, envelope.EventKey,
		envelope.EventType, string(originalPayload)).Scan(&exact)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !exact {
		return false, errors.New("failed route mixed receipt payload conflict")
	}
	return true, nil
}

func failedRouteMixedEnvelopeReceipt(
	ctx context.Context, tx pgx.Tx, session evolutionWebhookSession,
	envelope evolutionWebhookEnvelope, originalPayload []byte,
) (bool, error) {
	var exact bool
	err := tx.QueryRow(ctx, `
		select event_type = $4 and payload_sha256 =
		  private.canonical_jsonb_sha256($5::jsonb)
		from private.whatsapp_failed_route_mixed_envelope_raw
		where organization_id = $1::uuid and session_id = $2::uuid
		  and event_key = $3
	`, session.OrganizationID, session.ID, envelope.EventKey,
		envelope.EventType, string(originalPayload)).Scan(&exact)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !exact {
		return false, errors.New("failed route mixed receipt payload conflict")
	}
	return true, nil
}

func (repo Repository) persistFailedRouteMixedEnvelope(
	ctx context.Context, tx pgx.Tx, session evolutionWebhookSession,
	envelope evolutionWebhookEnvelope, originalPayload []byte, reason string,
) (evolutionWebhookReceipt, error) {
	if reason != failedRouteMixedUnprovenReason && reason != failedRouteMixedUnsupportedReason &&
		reason != failedRouteMixedUnsplitReason {
		return evolutionWebhookReceipt{}, errors.New("invalid failed route mixed isolation reason")
	}
	if err := lockFailedRouteMixedEventKey(ctx, tx, session, envelope.EventKey); err != nil {
		return evolutionWebhookReceipt{}, err
	}
	duplicate, err := failedRouteMixedEnvelopeReceipt(ctx, tx, session, envelope, originalPayload)
	if err != nil {
		return evolutionWebhookReceipt{}, err
	}
	if duplicate {
		if err := tx.Rollback(ctx); err != nil {
			return evolutionWebhookReceipt{}, err
		}
		return evolutionWebhookReceipt{
			ID: envelope.EventKey, SessionID: session.ID,
			EventType: envelope.EventType, Status: "dead",
			Duplicate: true, Inline: true,
		}, nil
	}
	var publicReceiptExists bool
	if err := tx.QueryRow(ctx, `
		select exists (select 1 from public.whatsapp_webhook_inbox
		  where event_key = $1)
	`, envelope.EventKey).Scan(&publicReceiptExists); err != nil {
		return evolutionWebhookReceipt{}, err
	}
	if publicReceiptExists {
		return evolutionWebhookReceipt{}, errors.New("failed route mixed receipt conflicts with public inbox")
	}
	var inserted bool
	err = tx.QueryRow(ctx, `
		insert into private.whatsapp_failed_route_mixed_envelope_raw (
		  organization_id,session_id,event_key,event_type,original_payload,payload_sha256,reason
		) values (
		  $1::uuid,$2::uuid,$3,$4,$5::jsonb,
		  private.canonical_jsonb_sha256($5::jsonb),$6
		) returning true
	`, session.OrganizationID, session.ID, envelope.EventKey,
		envelope.EventType, string(originalPayload), reason).Scan(&inserted)
	if err != nil || !inserted {
		return evolutionWebhookReceipt{}, fmt.Errorf("persist failed route mixed raw: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return evolutionWebhookReceipt{}, err
	}
	return evolutionWebhookReceipt{
		ID: envelope.EventKey, SessionID: session.ID,
		EventType: envelope.EventType, Status: "dead", Inline: true,
	}, nil
}
