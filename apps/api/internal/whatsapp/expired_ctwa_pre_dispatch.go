package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// A confirmed first CTWA that waited seven days after a session cutover must
// not create a late lead. Complete its isolated route before either processor
// mode sees the provider body. The SQL transaction preserves newer inbox rows.
func (repo Repository) completeExpiredCTWABeforeDispatch(
	ctx context.Context,
	item pendingEvolutionWebhook,
) (bool, error) {
	payload, err := decodeNativeEvolutionPayload(item.Payload)
	if err != nil {
		return false, fmt.Errorf("decode aged cutover CTWA webhook: %w", err)
	}
	metadata, _ := payload[evolutionWebhookRoutingMetaKey].(map[string]any)
	if strings.TrimSpace(stringFromAny(metadata["cutover_epoch"])) == "" {
		return false, nil
	}

	messages := withoutNativeEvolutionHistorySyncControls(extractNativeEvolutionMessages(payload))
	confirmed := make([]nativeEvolutionMessage, 0, 1)
	for _, message := range messages {
		if message.IsCTWAAd && nativeCTWAAdConfirmationMethod(message) != "" {
			confirmed = append(confirmed, message)
		}
	}
	if len(confirmed) == 0 {
		// A callback parsed by an older ingress binary may have durable CTWA
		// proof even when this binary no longer recognizes its provider shape.
		// Do not let such a seven-day-old first arrival reach lead creation.
		var agedSnapshotCount int
		var agedProviderID, agedProof string
		err = repo.db.Pool().QueryRow(ctx, `
			select count(*),
			       coalesce(max(snapshot.provider_message_id), ''),
			       coalesce(max(snapshot.snapshot->>'context_proof'), '')
			  from public.whatsapp_webhook_inbox as inbox
			  join public.whatsapp_webhook_routing_snapshots as snapshot
			    on snapshot.organization_id = inbox.organization_id
			   and snapshot.session_id = inbox.session_id
			   and snapshot.inbox_event_key = inbox.event_key
			  where inbox.id = $1::uuid
			    and inbox.status = 'processing'
			    and inbox.locked_by = $2
			    and inbox.created_at + interval '168 hours' <= clock_timestamp()
			    and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
			    and snapshot.binding_eligible is true
			    and snapshot.snapshot->>'context_kind' = 'contextual_intake'
			    and snapshot.snapshot->>'context_proof' in (
			      'managed_rule',
			      'canonical_intake_v1:entry_point_ctwa_ad',
			      'canonical_intake_v1:evolution_ctwa_clid_v1'
			    )
		`, item.ID, whatsappWebhookWorkerID).Scan(
			&agedSnapshotCount, &agedProviderID, &agedProof)
		if err != nil {
			return false, fmt.Errorf("check aged contextual intake snapshot: %w", err)
		}
		if agedSnapshotCount > 0 {
			if agedSnapshotCount != 1 || agedProviderID == "" ||
				!strings.HasPrefix(agedProof, "canonical_intake_v1:") {
				return false, errors.New("aged CTWA snapshot is not recognized by current provider parser")
			}
			// The immutable snapshot records the historical confirmation method.
			// SQL still verifies the raw singleton body, first route position,
			// lease and absence of CRM effects before deleting anything.
			return repo.completeExpiredCTWAByProof(ctx, item,
				agedProviderID, strings.TrimPrefix(agedProof, "canonical_intake_v1:"))
		}
		return false, nil
	}
	// Ask the database clock first. A fresh mixed callback follows its normal
	// processor path; isolation becomes mandatory only once deletion is due.
	var due bool
	err = repo.db.Pool().QueryRow(ctx, `
		select inbox.created_at + interval '168 hours' <= clock_timestamp()
		from public.whatsapp_webhook_inbox as inbox
		where inbox.id = $1::uuid
		  and inbox.status = 'processing'
		  and inbox.locked_by = $2
	`, item.ID, whatsappWebhookWorkerID).Scan(&due)
	if err != nil {
		return false, fmt.Errorf("check aged CTWA deadline using database clock: %w", err)
	}
	if !due {
		return false, nil
	}
	if len(messages) != 1 || len(confirmed) != 1 ||
		!isDirectInboundRetentionMessage(confirmed[0]) {
		return false, errors.New("aged CTWA webhook must contain one isolated direct inbound message")
	}
	if err := requireIsolatedEvolutionWebhookDirectMessages([]evolutionWebhookDurablePart{{
		EventType: item.EventType, Payload: item.Payload,
	}}); err != nil {
		return false, err
	}
	return repo.completeExpiredCTWAByProof(ctx, item,
		confirmed[0].ProviderMessageID, nativeCTWAAdConfirmationMethod(confirmed[0]))
}

func (repo Repository) completeExpiredCTWAByProof(
	ctx context.Context, item pendingEvolutionWebhook, providerMessageID, method string,
) (bool, error) {
	var disposition string
	err := repo.db.Pool().QueryRow(ctx, `
		select private.complete_expired_ctwa_webhook_route(
		  $1::uuid, $2, $3, $4
		)
	`, item.ID, whatsappWebhookWorkerID, providerMessageID, method).Scan(&disposition)
	if err != nil {
		return false, fmt.Errorf("complete aged cutover CTWA before dispatch: %w", err)
	}
	switch disposition {
	case "completed":
		return true, nil
	case "not_due":
		return false, nil
	case "delegate_general_policy":
		if evolutionWebhookProcessorModeForSession(
			repo.functions.webhookProcessorMode,
			repo.functions.webhookRolloutSessionIDs,
			item.SessionID,
		) != webhookProcessorNative {
			return false, errors.New("active nonlead retention requires native WhatsApp processing")
		}
		return false, nil
	default:
		return false, fmt.Errorf("unknown aged CTWA completion disposition %q", disposition)
	}
}
