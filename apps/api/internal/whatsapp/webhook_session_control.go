package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func deferredEvolutionWebhookSessionState(item pendingEvolutionWebhook, payload map[string]any) (evolutionWebhookSessionState, bool) {
	event := nativeEvolutionEventName(payload, item.EventType)
	status, recognized, connectionError := nativeEvolutionConnectionStatus(payload, event)
	if !recognized {
		switch compactEvolutionWebhookControlName(event) {
		case "connected", "pairsuccess":
			status, recognized = "connected", true
		case "disconnected", "loggedout":
			status, recognized = "disconnected", true
		}
	}
	qr := ""
	if strings.Contains(event, "qr") || status == "qr_ready" {
		qr = nativeEvolutionQRCode(payload)
	}
	if qr == "" && !recognized {
		return evolutionWebhookSessionState{}, false
	}
	at, hasTimestamp := evolutionWebhookEventOccurredAt(payload, item.CreatedAt)
	state := evolutionWebhookSessionState{
		Handled: true, Status: status, QRCode: qr, ConnectionError: connectionError,
		OccurredAt: at, ProviderTimestamp: hasTimestamp,
		Rank: evolutionWebhookStateRankTerminal, EventKey: item.ID,
	}
	if status == "qr_ready" || qr != "" {
		state.Status = "qr_ready"
		state.Rank = evolutionWebhookStateRankQRCode
	}
	data := nativeFirstMap(payload, "data", "Data")
	jid := firstNonEmpty(firstString(data, "jid", "JID", "phone", "Phone", "user.id"),
		firstString(payload, "jid", "JID", "phone", "Phone", "user.id"))
	state.PhoneNumber, _ = phoneFromIdentityValue(jid)
	state.ProfileName = firstNonEmpty(firstString(data, "pushName", "name", "profileName"),
		firstString(payload, "pushName", "name", "profileName"))
	return state, true
}

func deferredSessionStateIsCurrent(settings map[string]any, currentStatus string, candidate evolutionWebhookSessionState) bool {
	if candidate.OccurredAt.IsZero() || candidate.EventKey == "" {
		return false
	}
	if candidate.Status != "disconnected" && !sessionAutoReconnectEnabled(settings) {
		return false
	}
	if candidate.Status == "qr_ready" && currentStatus == "connected" {
		return false
	}
	current := evolutionWebhookSessionState{
		OccurredAt: time.UnixMilli(nativeInt64(settings["webhook_state_event_at_ms"])),
		Rank:       int(nativeInt64(settings["webhook_state_event_rank"])),
		EventKey:   stringFromAny(settings["webhook_state_event_key"]),
	}
	// The inline SQL tuple persists milliseconds. Compare at that same
	// precision, otherwise microseconds retained by PostgreSQL make an exact
	// deferred replay look newer than its already committed millisecond tuple.
	candidate.OccurredAt = time.UnixMilli(candidate.OccurredAt.UnixMilli())
	return evolutionWebhookSessionStateNewer(candidate, current)
}

// Session control events may wait behind inbox work while a newer signed event
// is applied inline. Recheck both the durable claim and the same ordered tuple
// under the session row lock; FIFO alone cannot order those two execution paths.
func (repo Repository) applyDeferredEvolutionWebhookSessionState(ctx context.Context, item pendingEvolutionWebhook, state evolutionWebhookSessionState) error {
	if _, valid := normalizeUUID(item.ID); !valid || item.CreatedAt.IsZero() || item.Attempts < 1 || (item.ProcessingEpoch != 0 && item.ProcessingEpoch != 1) {
		return fmt.Errorf("deferred WhatsApp session control requires a current inbox claim")
	}
	tx, err := repo.beginNativeWebhookTx(ctx)
	if err != nil {
		return err
	}
	defer rollbackWebhookTx(tx)
	// The canonical cutover RPC takes this session lock too. Keep the lock order
	// session -> inbox, so its epoch cannot change between validation and commit.
	session, err := loadNativeEvolutionSessionWithLock(ctx, tx, item, true)
	if err != nil {
		return err
	}
	var eventKey, currentStatus string
	err = tx.QueryRow(ctx, `
		select inbox.event_key, session.status
		from public.whatsapp_webhook_inbox inbox
		join public.whatsapp_sessions session on session.id = inbox.session_id and session.organization_id = inbox.organization_id
		where inbox.id = $1::uuid and inbox.organization_id = $2::uuid and inbox.session_id = $3::uuid
		  and inbox.status = 'processing' and inbox.locked_by = $4
		  and inbox.edge_execution_id is null
		  and inbox.event_type = $5 and inbox.payload = $6::jsonb
		  and inbox.attempts = $7 and inbox.created_at = $8::timestamptz
		  and inbox.processing_epoch = $9
		  and inbox.processing_epoch = coalesce((
		    select cutover.active_epoch from private.whatsapp_webhook_session_cutovers cutover where cutover.session_id = inbox.session_id
		  ), 0)
		for update of inbox
	`, item.ID, item.OrganizationID, item.SessionID, whatsappWebhookWorkerID, item.EventType, string(item.Payload), item.Attempts, item.CreatedAt, item.ProcessingEpoch).Scan(&eventKey, &currentStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("deferred WhatsApp session control lost its claim, payload or active epoch")
	}
	if err != nil {
		return err
	}
	state.EventKey = eventKey
	if !deferredSessionStateIsCurrent(session.AdvancedSettings, currentStatus, state) {
		return tx.Commit(ctx)
	}
	patch := map[string]any{}
	remove := []string{}
	if state.Status != "" {
		patch = map[string]any{
			"webhook_state_event_at_ms":            state.OccurredAt.UTC().UnixMilli(),
			"webhook_state_event_rank":             state.Rank,
			"webhook_state_event_key":              state.EventKey,
			"webhook_state_has_provider_timestamp": state.ProviderTimestamp,
		}
		if state.QRCode != "" {
			patch["qr_code"] = state.QRCode
			patch["qr_updated_at"] = state.OccurredAt.UTC().Format(time.RFC3339Nano)
		} else if state.Status != "qr_ready" {
			remove = []string{"qr_code", "qr_updated_at"}
		}
	}
	_, err = tx.Exec(ctx, `
		update public.whatsapp_sessions
		set status = coalesce(nullif($3, ''), status),
		    qr_code = case when $4 <> '' then $4 when $3 not in ('', 'qr_ready') then null else qr_code end,
		    phone_number = case when $3 = 'connected' then coalesce(nullif($5, ''), phone_number) else phone_number end,
		    profile_name = case when $3 = 'connected' then coalesce(nullif($6, ''), profile_name) else profile_name end,
		    last_connected_at = case when $3 = 'connected' and (status <> 'connected' or last_connected_at is null) then now() else last_connected_at end,
		    last_error = nullif($7, ''),
		    advanced_settings = (coalesce(advanced_settings, '{}'::jsonb) - $9::text[]) || $8::jsonb,
		    updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
		  and ($3 <> '' or last_error is distinct from nullif($7, ''))
	`, session.OrganizationID, session.ID, state.Status, state.QRCode, state.PhoneNumber, state.ProfileName, state.ConnectionError, jsonb(patch), remove)
	if err != nil {
		return err
	}
	reconnected := state.Status == "connected"
	if reconnected {
		if _, err := tx.Exec(ctx, releaseWhatsAppOutboxRetriesAfterReconnectQuery, session.OrganizationID, session.ID); err != nil {
			return err
		}
		// Connected proves only a definitive disconnect ended, never that an
		// earlier detached download with unknown outcome has stopped running.
		if _, err := tx.Exec(ctx, `delete from private.whatsapp_media_session_quarantine
			where session_id = $1::uuid and reason = 'media_provider_disconnected' and updated_at <= $2::timestamptz`, session.ID, state.OccurredAt.UTC()); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if reconnected {
		wakeWhatsAppOutboxWorker()
		wakeWhatsAppMediaWorker()
	}
	return nil
}
