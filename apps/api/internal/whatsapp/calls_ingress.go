package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// CallState and CallRecording are versioned, CRM-owned provider contracts.
// Never infer a call from WhatsMeow's raw struct JSON or a click in the UI.
type evolutionCallState struct {
	CallID     string
	InstanceID string
	PeerJID    string
	Direction  string
	State      string
	OccurredAt time.Time
	Reason     string
}

type evolutionCallRecording struct {
	CallID     string
	InstanceID string
	Status     string
	OccurredAt time.Time
	Channels   []map[string]any
}

var errCallStateNotYetReceived = errors.New("Evolution call state has not arrived before recording")

func evolutionCallEventKind(eventType string) string {
	switch compactEvolutionWebhookControlName(eventType) {
	case "callstate":
		return "state"
	case "callrecording":
		return "recording"
	default:
		return ""
	}
}

func parseEvolutionCallState(payload []byte) (evolutionCallState, error) {
	decoded, err := decodeNativeEvolutionPayload(payload)
	if err != nil {
		return evolutionCallState{}, err
	}
	data := mapFromAny(decoded["data"])
	if nativeInt64(data["version"]) != 1 {
		return evolutionCallState{}, errors.New("Evolution call state version is unsupported")
	}
	rawPeerJID := normalizeRemoteAlias(stringFromAny(data["peerJid"]))
	if !strings.HasSuffix(rawPeerJID, "@s.whatsapp.net") &&
		!strings.HasSuffix(rawPeerJID, "@c.us") &&
		!strings.HasSuffix(rawPeerJID, "@lid") {
		return evolutionCallState{}, errors.New("Evolution call state peer is not a direct WhatsApp JID")
	}
	event := evolutionCallState{
		CallID:     strings.TrimSpace(stringFromAny(data["callId"])),
		InstanceID: strings.TrimSpace(stringFromAny(data["instanceId"])),
		PeerJID:    newWhatsAppContactIdentity("", rawPeerJID, false).RemoteJID,
		Direction:  strings.TrimSpace(stringFromAny(data["direction"])),
		State:      strings.TrimSpace(stringFromAny(data["state"])),
		Reason:     strings.TrimSpace(stringFromAny(data["reason"])),
	}
	if event.CallID == "" || len(event.CallID) > 256 || event.InstanceID == "" ||
		event.PeerJID == "" || len(event.PeerJID) > 256 ||
		isOpaqueWhatsAppJID(event.PeerJID) && !strings.HasSuffix(event.PeerJID, "@lid") ||
		strings.Contains(event.PeerJID, "@g.us") ||
		!stringIn(event.Direction, "incoming", "outgoing") ||
		!stringIn(event.State, "incoming", "outgoing", "ringing", "active", "end_pending", "reject_pending", "outcome_unknown", "rejected", "ended", "failed") {
		return evolutionCallState{}, errors.New("Evolution call state is invalid")
	}
	event.OccurredAt, err = time.Parse(time.RFC3339Nano, strings.TrimSpace(stringFromAny(data["occurredAt"])))
	if err != nil || event.OccurredAt.IsZero() {
		return evolutionCallState{}, errors.New("Evolution call state timestamp is invalid")
	}
	// Preserve delayed provider callbacks as history, but reject implausible
	// future timestamps so a forged callback cannot keep a call ringing.
	if event.OccurredAt.After(time.Now().Add(5 * time.Minute)) {
		return evolutionCallState{}, errors.New("Evolution call state timestamp is in the future")
	}
	return event, nil
}

func parseEvolutionCallRecording(payload []byte) (evolutionCallRecording, error) {
	decoded, err := decodeNativeEvolutionPayload(payload)
	if err != nil {
		return evolutionCallRecording{}, err
	}
	data := mapFromAny(decoded["data"])
	if nativeInt64(data["version"]) != 1 {
		return evolutionCallRecording{}, errors.New("Evolution call recording version is unsupported")
	}
	event := evolutionCallRecording{
		CallID:     strings.TrimSpace(stringFromAny(data["callId"])),
		InstanceID: strings.TrimSpace(stringFromAny(data["instanceId"])),
		Status:     strings.TrimSpace(stringFromAny(data["status"])),
	}
	if event.CallID == "" || len(event.CallID) > 256 || event.InstanceID == "" ||
		!stringIn(event.Status, "complete", "partial", "failed") {
		return evolutionCallRecording{}, errors.New("Evolution call recording is invalid")
	}
	event.OccurredAt, err = time.Parse(time.RFC3339Nano, strings.TrimSpace(stringFromAny(data["occurredAt"])))
	if err != nil || event.OccurredAt.IsZero() {
		return evolutionCallRecording{}, errors.New("Evolution call recording timestamp is invalid")
	}
	seen := map[string]bool{}
	for _, raw := range nativeObjectList(data["channels"]) {
		channel := strings.TrimSpace(stringFromAny(raw["channel"]))
		if !stringIn(channel, "incoming", "outgoing") ||
			seen[channel] || strings.TrimSpace(stringFromAny(raw["contentType"])) != "audio/wav" ||
			nativeInt64(raw["sizeBytes"]) < 0 || nativeInt64(raw["sizeBytes"]) > 256<<20 {
			return evolutionCallRecording{}, errors.New("Evolution call recording manifest is invalid")
		}
		seen[channel] = true
		event.Channels = append(event.Channels, map[string]any{
			"channel": channel, "contentType": "audio/wav", "sizeBytes": nativeInt64(raw["sizeBytes"]),
		})
	}
	if event.Status != "failed" && len(event.Channels) == 0 {
		return evolutionCallRecording{}, errors.New("Evolution call recording has no channels")
	}
	return event, nil
}

func callStateRank(state string) int {
	switch state {
	case "incoming", "outgoing":
		return 0
	case "ringing":
		return 1
	case "active":
		return 2
	case "end_pending", "reject_pending":
		return 3
	case "outcome_unknown":
		return 4
	case "rejected", "ended", "failed":
		return 5
	default:
		return -1
	}
}

func nextCallState(previous, incoming string, previousAt, incomingAt time.Time) string {
	if callStateRank(previous) >= 5 {
		return previous
	}
	if callStateRank(incoming) > callStateRank(previous) ||
		(callStateRank(incoming) == callStateRank(previous) && !incomingAt.Before(previousAt)) {
		return incoming
	}
	return previous
}

func callStateDescription(direction, state string) string {
	switch state {
	case "incoming":
		return "Ligação recebida"
	case "outgoing":
		return "Ligação iniciada"
	case "ringing":
		return "Chamando"
	case "active":
		return "Ligação atendida"
	case "end_pending":
		return "Encerrando ligação"
	case "reject_pending":
		return "Recusando ligação"
	case "outcome_unknown":
		return "Confirmação da ligação pendente"
	case "rejected":
		return "Ligação recusada"
	case "ended":
		return "Ligação encerrada"
	case "failed":
		return "Ligação não concluída"
	default:
		if direction == "incoming" {
			return "Ligação recebida"
		}
		return "Ligação realizada"
	}
}

func (repo Repository) applyEvolutionCallWebhook(
	ctx context.Context,
	tx pgx.Tx,
	session evolutionWebhookSession,
	eventType string,
	payload []byte,
) (bool, error) {
	kind := evolutionCallEventKind(eventType)
	if kind == "" {
		return false, nil
	}
	if kind == "recording" {
		event, err := parseEvolutionCallRecording(payload)
		if err != nil {
			return true, err
		}
		if !stringIn(event.InstanceID, session.InstanceID, session.InstanceName) {
			return true, errors.New("Evolution call recording instance identity changed")
		}
		var callID string
		status := "pending"
		if event.Status == "failed" {
			status = "failed"
		}
		err = tx.QueryRow(ctx, `
			update public.whatsapp_calls
			set recording_status = case when recording_status in ('ready', 'partial') then recording_status else $4 end,
			    recording_manifest = $5::jsonb,
			    recording_provider_status = $6,
			    recording_next_attempt_at = case when $4 = 'pending' then now() else null end,
			    recording_error = case when $4 = 'failed' then 'provider_recording_failed' else null end
			where organization_id = $1::uuid
			  and session_id = $2::uuid
			  and provider_call_id = $3
			returning id::text
		`, session.OrganizationID, session.ID, event.CallID, status, encodeCallRecordingManifest(event.Channels), event.Status).Scan(&callID)
		if errors.Is(err, pgx.ErrNoRows) {
			// Provider callbacks can race. A retry leaves this event durable;
			// inventing a contact or call from a recording manifest is unsafe.
			return true, errCallStateNotYetReceived
		}
		if err != nil {
			return true, err
		}
		if err := updateWhatsAppCallTimeline(ctx, tx, callID); err != nil {
			return true, err
		}
		return true, nil
	}

	event, err := parseEvolutionCallState(payload)
	if err != nil {
		return true, err
	}
	if !stringIn(event.InstanceID, session.InstanceID, session.InstanceName) {
		return true, errors.New("Evolution call state instance identity changed")
	}
	var enabled bool
	err = tx.QueryRow(ctx, `
		select coalesce((advanced_settings->>'whatsapp_calls_enabled')::boolean, false)
		from public.whatsapp_sessions
		where organization_id = $1::uuid and id = $2::uuid and provider = 'evolution_go'
	`, session.OrganizationID, session.ID).Scan(&enabled)
	if err != nil {
		return true, err
	}
	if !enabled {
		// Disabling calls blocks new calls, but final state callbacks must still
		// close an already captured call and its recording.
		var exists bool
		err = tx.QueryRow(ctx, `
			select exists(select 1 from public.whatsapp_calls
			  where organization_id = $1::uuid and session_id = $2::uuid and provider_call_id = $3)
		`, session.OrganizationID, session.ID, event.CallID).Scan(&exists)
		if err != nil || !exists {
			return true, err
		}
	}

	var callID, previousState, previousDirection, previousPeer string
	var previousAt time.Time
	err = tx.QueryRow(ctx, `
		select id::text, state, direction, remote_jid, last_event_at
		from public.whatsapp_calls
		where organization_id = $1::uuid and session_id = $2::uuid and provider_call_id = $3
		for update
	`, session.OrganizationID, session.ID, event.CallID).Scan(
		&callID, &previousState, &previousDirection, &previousPeer, &previousAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		conversationID, leadID, bindingErr := findCallConversationAtIngress(ctx, tx, session, event.PeerJID)
		if bindingErr != nil {
			return true, bindingErr
		}
		err = tx.QueryRow(ctx, `
			insert into public.whatsapp_calls (
			  organization_id, session_id, conversation_id, lead_id,
			  provider_call_id, remote_jid, direction, state, source,
			  reason, offered_at, answered_at, ended_at, last_event_at
			) values (
			  $1::uuid, $2::uuid, nullif($3,'')::uuid, nullif($4,'')::uuid,
			  $5, $6, $7, $8, 'meowcaller',
			  nullif($9,''), $10,
			  case when $8 = 'active' then $10::timestamptz else null end,
			  case when $8 in ('rejected','ended','failed') then $10::timestamptz else null end,
			  $10
			)
			on conflict (session_id, provider_call_id) do nothing
			returning id::text
		`, session.OrganizationID, session.ID, conversationID, leadID,
			event.CallID, event.PeerJID, event.Direction, event.State, event.Reason,
			event.OccurredAt).Scan(&callID)
		if errors.Is(err, pgx.ErrNoRows) {
			// A concurrent provider callback won the identity race.
			return true, errors.New("Evolution call state identity race; retry durable event")
		}
		if err != nil {
			return true, err
		}
	} else if err != nil {
		return true, err
	} else {
		if previousDirection != event.Direction {
			return true, errors.New("Evolution call state identity changed")
		}
		if previousPeer != event.PeerJID {
			var sameContact bool
			err = tx.QueryRow(ctx, `
				select exists (
				  select 1 from public.whatsapp_contact_identity_aliases alias
				  where alias.organization_id = $1::uuid and alias.session_id = $2::uuid
				    and ((alias.alias_jid = $3 and alias.canonical_jid = $4)
				      or (alias.alias_jid = $4 and alias.canonical_jid = $3))
				)
			`, session.OrganizationID, session.ID, previousPeer, event.PeerJID).Scan(&sameContact)
			if err != nil || !sameContact {
				return true, errors.New("Evolution call state contact identity changed")
			}
		}
		nextState := nextCallState(previousState, event.State, previousAt, event.OccurredAt)
		_, err = tx.Exec(ctx, `
			update public.whatsapp_calls
			set state = $2,
			    reason = coalesce(nullif($3,''), reason),
			    answer_claim_token = case when $4 in ('active','rejected','ended','failed')
			      then null else answer_claim_token end,
			    answered_at = case when $4 = 'active' then coalesce(answered_at, $5::timestamptz) else answered_at end,
			    ended_at = case when $4 in ('rejected','ended','failed') then coalesce(ended_at, $5::timestamptz) else ended_at end,
			    last_event_at = greatest(last_event_at, $5::timestamptz)
			where id = $1::uuid
		`, callID, nextState, event.Reason, event.State, event.OccurredAt)
		if err != nil {
			return true, err
		}
	}
	if err := updateWhatsAppCallTimeline(ctx, tx, callID); err != nil {
		return true, err
	}
	return true, nil
}

func findCallConversationAtIngress(
	ctx context.Context,
	tx pgx.Tx,
	session evolutionWebhookSession,
	peerJID string,
) (string, string, error) {
	rows, err := tx.Query(ctx, `
		select c.id::text, coalesce(c.lead_id::text, '')
		from public.whatsapp_conversations c
		where c.organization_id = $1::uuid
		  and c.session_id = $2::uuid
		  and c.deleted_at is null
		  and coalesce(c.is_group, false) = false
		  and (
		    c.remote_jid = $3
		    or exists (
		      select 1 from public.whatsapp_contact_identity_aliases alias
		      where alias.organization_id = c.organization_id
		        and alias.session_id = c.session_id
		        and alias.alias_jid = $3
		        and alias.canonical_jid = c.remote_jid
		    )
		  )
		order by c.id
		limit 2
	`, session.OrganizationID, session.ID, peerJID)
	if err != nil {
		return "", "", err
	}
	defer rows.Close()
	var conversationID, leadID string
	count := 0
	for rows.Next() {
		count++
		if err := rows.Scan(&conversationID, &leadID); err != nil {
			return "", "", err
		}
	}
	if err := rows.Err(); err != nil {
		return "", "", err
	}
	if count != 1 {
		return "", "", nil
	}
	return conversationID, leadID, nil
}

func updateWhatsAppCallTimeline(ctx context.Context, tx pgx.Tx, callID string) error {
	var organizationID, leadID, direction, state, recordingStatus, operatorID string
	var eventAt time.Time
	err := tx.QueryRow(ctx, `
		select organization_id::text, coalesce(lead_id::text,''), direction,
		       state, recording_status, coalesce(operator_user_id::text,''),
		       coalesce(offered_at, created_at)
		from public.whatsapp_calls where id = $1::uuid
	`, callID).Scan(&organizationID, &leadID, &direction, &state, &recordingStatus, &operatorID, &eventAt)
	if err != nil || leadID == "" {
		return err
	}
	title := "Ligação de WhatsApp realizada"
	if direction == "incoming" {
		title = "Ligação de WhatsApp recebida"
	}
	metadata := fmt.Sprintf(
		`{"whatsapp_call_id":%q,"direction":%q,"state":%q,"recording_status":%q}`,
		callID, direction, state, recordingStatus,
	)
	_, err = tx.Exec(ctx, `
		insert into public.lead_timeline_events (
		  id, organization_id, lead_id, user_id, actor_user_id,
		  event_type, title, description, metadata, event_at
		)
		values (
		  $8::uuid, $1::uuid, $2::uuid, nullif($3,'')::uuid, nullif($3,'')::uuid,
		  'whatsapp_call', $4, $5, $6::jsonb, $7
		)
		on conflict (id) do update
		set description = excluded.description,
		    metadata = excluded.metadata,
		    actor_user_id = coalesce(excluded.actor_user_id, lead_timeline_events.actor_user_id),
		    user_id = coalesce(excluded.user_id, lead_timeline_events.user_id)
		where lead_timeline_events.event_type = 'whatsapp_call'
		  and lead_timeline_events.organization_id = excluded.organization_id
		  and lead_timeline_events.lead_id = excluded.lead_id
	`, organizationID, leadID, operatorID, title,
		callStateDescription(direction, state), metadata, eventAt, callID)
	return err
}

func encodeCallRecordingManifest(channels []map[string]any) string {
	if len(channels) == 0 {
		return "[]"
	}
	parts := make([]string, 0, len(channels))
	for _, channel := range channels {
		parts = append(parts, fmt.Sprintf(
			`{"channel":%q,"contentType":"audio/wav","sizeBytes":%d}`,
			channel["channel"], channel["sizeBytes"],
		))
	}
	return "[" + strings.Join(parts, ",") + "]"
}
