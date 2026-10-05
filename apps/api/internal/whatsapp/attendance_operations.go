package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type attendanceScope struct {
	ConversationID                   string
	SessionID                        string
	LeadID                           string
	BindingID                        string
	ActorName                        string
	SessionNumberKey                 string
	ConsentNumberKey                 string
	OwnNumberWithOtherWhatsAppOrigin bool
}

func (repo Repository) GetConversationAttendance(
	ctx context.Context,
	tenantContext tenant.Context,
	conversationID string,
	input attendanceInput,
) (AttendanceResponse, error) {
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return AttendanceResponse{}, ErrConversationNotFound
	}
	// Establish conversation/lead visibility before returning a distinct
	// revoked-access error. A guessed session ID must not become an oracle.
	conversation, err := repo.GetConversation(ctx, tenantContext, conversationID)
	if err != nil {
		return AttendanceResponse{}, repo.revokedConversationErrorIfAssigned(
			ctx, tenantContext, conversationID, input.SendSessionID, input.ExpectedLeadID, err,
		)
	}
	if conversation.SessionID != input.SendSessionID || pointerValue(conversation.LeadID) != input.ExpectedLeadID {
		return AttendanceResponse{}, ErrConversationNotFound
	}

	// This endpoint runs whenever the chat is opened. A stable read-only
	// snapshot keeps the scope and ledger mutually consistent without making
	// webhook/rebind writers wait on row locks.
	tx, err := repo.db.Pool().BeginTx(ctx, pgx.TxOptions{
		IsoLevel:   pgx.RepeatableRead,
		AccessMode: pgx.ReadOnly,
	})
	if err != nil {
		return AttendanceResponse{}, err
	}
	defer tx.Rollback(ctx)

	scope, err := lockAttendanceScope(ctx, tx, tenantContext, conversationID, input, true, false, false)
	if err != nil {
		if errors.Is(err, ErrSessionNotFound) {
			return AttendanceResponse{}, repo.revokedSessionErrorIfShared(ctx, tenantContext, input.SendSessionID)
		}
		return AttendanceResponse{}, err
	}
	response, err := loadAttendanceResponse(ctx, tx, tenantContext, scope)
	if err != nil {
		return AttendanceResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AttendanceResponse{}, err
	}
	return response, nil
}

func (repo Repository) JoinConversationAttendance(
	ctx context.Context,
	tenantContext tenant.Context,
	conversationID string,
	input attendanceInput,
) (AttendanceResponse, error) {
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return AttendanceResponse{}, ErrConversationNotFound
	}
	conversation, err := repo.GetConversation(ctx, tenantContext, conversationID)
	if err != nil {
		return AttendanceResponse{}, repo.revokedConversationErrorIfAssigned(
			ctx, tenantContext, conversationID, input.SendSessionID, input.ExpectedLeadID, err,
		)
	}
	if conversation.SessionID != input.SendSessionID || pointerValue(conversation.LeadID) != input.ExpectedLeadID {
		return AttendanceResponse{}, ErrConversationNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return AttendanceResponse{}, err
	}
	defer tx.Rollback(ctx)

	scope, err := lockAttendanceScope(ctx, tx, tenantContext, conversationID, input, true, true, true)
	if err != nil {
		if errors.Is(err, ErrSessionNotFound) {
			return AttendanceResponse{}, repo.revokedSessionErrorIfShared(ctx, tenantContext, input.SendSessionID)
		}
		return AttendanceResponse{}, err
	}
	confirmationRequired, err := attendanceConfirmationRequired(ctx, tx, tenantContext, scope)
	if err != nil {
		return AttendanceResponse{}, err
	}
	if confirmationRequired && !input.ConfirmedSharing {
		return AttendanceResponse{}, ErrAttendanceRequired
	}

	var ingressSequenceCutoff int64
	if err := tx.QueryRow(ctx, `
		select case when is_called then last_value::bigint else 0::bigint end
		from public.whatsapp_webhook_routing_ingress_sequence
	`).Scan(&ingressSequenceCutoff); err != nil {
		return AttendanceResponse{}, err
	}
	if confirmationRequired {
		_, err = tx.Exec(ctx, `
			insert into public.whatsapp_attendance_send_consents (
				organization_id, user_id, lead_id, number_key
			) values ($1::uuid, $2::uuid, $3::uuid, $4)
			on conflict on constraint whatsapp_attendance_send_consents_identity_key do nothing
		`, tenantContext.OrganizationID, tenantContext.UserID, scope.LeadID, scope.ConsentNumberKey)
		if err != nil {
			return AttendanceResponse{}, err
		}
	}

	_, created, err := insertAttendanceEntry(
		ctx,
		tx,
		tenantContext,
		scope,
		ingressSequenceCutoff,
		confirmationRequired,
	)
	if err != nil {
		return AttendanceResponse{}, err
	}
	// This ledger entry gates capture and sending. The visible CRM marker is
	// written only after the provider has acknowledged a human message.

	response, err := loadAttendanceResponse(ctx, tx, tenantContext, scope)
	if err != nil {
		return AttendanceResponse{}, err
	}
	response.Created = created
	if err := tx.Commit(ctx); err != nil {
		return AttendanceResponse{}, err
	}
	return response, nil
}

func lockAttendanceScope(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	conversationID string,
	input attendanceInput,
	requireOwner bool,
	requireConnected bool,
	lockRows bool,
) (attendanceScope, error) {
	scope := attendanceScope{
		ConversationID: conversationID,
		SessionID:      input.SendSessionID,
		LeadID:         input.ExpectedLeadID,
	}

	// POST preserves the shared cross-resource lock order used by sending,
	// native ingress and binding transitions: session -> conversation -> lead ->
	// binding. GET uses the same checks in a repeatable-read snapshot, without
	// blocking webhook or rebind writers on every chat open.
	sessionLock := ""
	conversationLock := ""
	leadLock := ""
	bindingLock := ""
	if lockRows {
		sessionLock = " for share of ws"
		conversationLock = " for share of conversation"
		leadLock = " for share of l"
		bindingLock = " for share of binding"
	}

	var lockedSessionID, lockedOwnerUserID, sessionPhone string
	err := tx.QueryRow(ctx, `
		select ws.id::text, ws.owner_user_id::text, coalesce(ws.phone_number, '')
		from public.whatsapp_sessions as ws
		where ws.organization_id = $1::uuid
		  and ws.id = $2::uuid
		  and ws.provider = 'evolution_go'
		  and coalesce(ws.is_active, true) = true
		  and coalesce(ws.status, '') <> 'deleted'
		  and (not $4::boolean or ws.owner_user_id = $3::uuid or `+sessionGrantExistsSQL("ws", "$3::uuid", true)+`)
		  and (not $5::boolean or ws.status = 'connected')
	`+sessionLock, tenantContext.OrganizationID, scope.SessionID, tenantContext.UserID, requireOwner, requireConnected).Scan(&lockedSessionID, &lockedOwnerUserID, &sessionPhone)
	if errors.Is(err, pgx.ErrNoRows) {
		return attendanceScope{}, ErrSessionNotFound
	}
	if err != nil {
		return attendanceScope{}, err
	}
	scope.SessionNumberKey = normalizeDigits(sessionPhone)
	if len(scope.SessionNumberKey) < 8 || len(scope.SessionNumberKey) > 20 {
		scope.SessionNumberKey = ""
	}
	scope.ConsentNumberKey = "session:" + scope.SessionID
	if scope.SessionNumberKey != "" {
		scope.ConsentNumberKey = "phone:" + scope.SessionNumberKey
	}

	var lockedConversationID string
	err = tx.QueryRow(ctx, `
		select conversation.id::text
		from public.whatsapp_conversations as conversation
		where conversation.organization_id = $1::uuid
		  and conversation.id = $2::uuid
		  and conversation.session_id = $3::uuid
		  and conversation.lead_id = $4::uuid
		  and conversation.deleted_at is null
	`+conversationLock, tenantContext.OrganizationID, scope.ConversationID, lockedSessionID, scope.LeadID).Scan(&lockedConversationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return attendanceScope{}, ErrConversationNotFound
	}
	if err != nil {
		return attendanceScope{}, err
	}

	visibilityArgs := append(baseConversationArgs(tenantContext), scope.LeadID,
		requireOwner && lockedOwnerUserID != tenantContext.UserID)
	var lockedLeadID string
	var originSessionID *string
	var originSessionPhone *string
	var hasHistoryOnOtherNumber bool
	err = tx.QueryRow(ctx, `
		select l.id::text, l.source_session_id::text, origin_session.phone_number,
		       (l.source_session_id is null and exists (
		         select 1 from public.whatsapp_conversations as prior
		         left join public.whatsapp_sessions as previous_session
		           on previous_session.organization_id = prior.organization_id
		          and previous_session.id = prior.session_id
		         where prior.organization_id = l.organization_id
		           and prior.lead_id = l.id
		           and prior.session_id <> $7::uuid
		           and prior.last_message_at is not null
		           and prior.deleted_at is null
		           and ($8 = '' or regexp_replace(coalesce(previous_session.phone_number, ''), '[^0-9]', '', 'g') <> $8)
		       ))
		from public.leads as l
		left join public.whatsapp_sessions as origin_session
		  on origin_session.organization_id = l.organization_id
		 and origin_session.id = l.source_session_id
		where l.organization_id = $1::uuid
		  and l.id = $5::uuid
		  and `+leadVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
		  and (not $6::boolean or l.assigned_user_id = $2::uuid)
	`+leadLock, append(visibilityArgs, scope.SessionID, scope.SessionNumberKey)...).Scan(&lockedLeadID, &originSessionID, &originSessionPhone, &hasHistoryOnOtherNumber)
	if errors.Is(err, pgx.ErrNoRows) {
		return attendanceScope{}, ErrConversationNotFound
	}
	if err != nil {
		return attendanceScope{}, err
	}
	originHasOtherNumber := originSessionID != nil && *originSessionID != scope.SessionID
	if originHasOtherNumber && scope.SessionNumberKey != "" && originSessionPhone != nil &&
		normalizeDigits(*originSessionPhone) == scope.SessionNumberKey {
		originHasOtherNumber = false
	}
	scope.OwnNumberWithOtherWhatsAppOrigin = lockedOwnerUserID == tenantContext.UserID &&
		(originHasOtherNumber || hasHistoryOnOtherNumber)

	err = tx.QueryRow(ctx, `
		select binding.id::text
		from public.whatsapp_conversation_lead_bindings as binding
		where binding.organization_id = $1::uuid
		  and binding.conversation_id = $2::uuid
		  and binding.session_id = $3::uuid
		  and binding.lead_id = $4::uuid
		  and binding.active_to is null
		  and binding.stale = false
	`+bindingLock, tenantContext.OrganizationID, scope.ConversationID, scope.SessionID, scope.LeadID).Scan(&scope.BindingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return attendanceScope{}, ErrConversationBindingChanged
	}
	if err != nil {
		return attendanceScope{}, err
	}
	if err := tx.QueryRow(ctx, `
		select left(coalesce(nullif(btrim(user_row.name), ''), nullif(btrim(user_row.email), ''), 'Usuario'), 180)
		from public.users as user_row
		where user_row.id = $1::uuid
		  and coalesce(user_row.is_active, false) = true
		  and exists (
		    select 1 from public.organization_members member
		    where member.organization_id = $2::uuid
		      and member.user_id = user_row.id
		      and coalesce(member.is_active, false) = true
		      and member.deleted_at is null
		  )
	`, tenantContext.UserID, tenantContext.OrganizationID).Scan(&scope.ActorName); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return attendanceScope{}, ErrConversationNotFound
		}
		return attendanceScope{}, err
	}
	return scope, nil
}

func insertAttendanceEntry(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	scope attendanceScope,
	ingressSequenceCutoff int64,
	confirmedSharing bool,
) (AttendanceEntry, bool, error) {
	entrySource := "implicit"
	if confirmedSharing {
		entrySource = "manual"
	}
	entry, err := scanAttendanceEntry(tx.QueryRow(ctx, `
		insert into public.whatsapp_attendance_entries (
			organization_id, conversation_id, session_id, lead_id,
			binding_id, user_id, actor_name_snapshot, joined_at,
			ingress_sequence_cutoff, entry_source
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5::uuid, $6::uuid, $7, clock_timestamp(), $8::bigint, $9
		)
		on conflict (organization_id, conversation_id, binding_id, session_id, user_id)
		do nothing
		returning `+attendanceEntrySelectFields()+`
	`, tenantContext.OrganizationID, scope.ConversationID, scope.SessionID,
		scope.LeadID, scope.BindingID, tenantContext.UserID, scope.ActorName,
		ingressSequenceCutoff, entrySource))
	if err == nil {
		return entry, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return AttendanceEntry{}, false, err
	}

	entry, err = scanAttendanceEntry(tx.QueryRow(ctx, `
		select `+attendanceEntrySelectFields()+`
		from public.whatsapp_attendance_entries
		where organization_id = $1::uuid
		  and conversation_id = $2::uuid
		  and binding_id = $3::uuid
		  and session_id = $4::uuid
		  and user_id = $5::uuid
		limit 1
	`, tenantContext.OrganizationID, scope.ConversationID, scope.BindingID,
		scope.SessionID, tenantContext.UserID))
	return entry, false, err
}

func attendanceConfirmationRequired(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, scope attendanceScope) (bool, error) {
	if !scope.OwnNumberWithOtherWhatsAppOrigin {
		return false, nil
	}
	var alreadyConfirmed bool
	err := tx.QueryRow(ctx, `
		select exists (
		  select 1 from public.whatsapp_attendance_send_consents as consent
		  where consent.organization_id = $1::uuid
		    and consent.lead_id = $2::uuid
		    and consent.user_id = $3::uuid
		    and consent.number_key = $4
		)
	`, tenantContext.OrganizationID, scope.LeadID, tenantContext.UserID, scope.ConsentNumberKey).Scan(&alreadyConfirmed)
	return !alreadyConfirmed, err
}

func requireAttendanceSendConsent(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, conversationID, leadID, sessionID string) error {
	scope, err := lockAttendanceScope(ctx, tx, tenantContext, conversationID,
		attendanceInput{ExpectedLeadID: leadID, SendSessionID: sessionID}, true, true, false)
	if err != nil {
		return err
	}
	confirmationRequired, err := attendanceConfirmationRequired(ctx, tx, tenantContext, scope)
	if err != nil {
		return err
	}
	if confirmationRequired {
		return ErrAttendanceRequired
	}
	return nil
}

func loadAttendanceResponse(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	scope attendanceScope,
) (AttendanceResponse, error) {
	confirmationRequired, err := attendanceConfirmationRequired(ctx, tx, tenantContext, scope)
	if err != nil {
		return AttendanceResponse{}, err
	}
	rows, err := tx.Query(ctx, `
		select `+attendanceEntrySelectFields()+`
		from public.whatsapp_attendance_entries
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
		order by joined_at, id
	`, tenantContext.OrganizationID, scope.LeadID)
	if err != nil {
		return AttendanceResponse{}, err
	}
	defer rows.Close()

	response := AttendanceResponse{Entries: []AttendanceEntry{}, ConfirmationRequired: confirmationRequired}
	for rows.Next() {
		entry, err := scanAttendanceEntry(rows)
		if err != nil {
			return AttendanceResponse{}, err
		}
		if entry.MarkerAt != nil {
			response.Entries = append(response.Entries, entry)
		}
		if entry.ConversationID == scope.ConversationID &&
			entry.BindingID == scope.BindingID &&
			entry.SessionID == scope.SessionID &&
			entry.UserID == tenantContext.UserID {
			current := entry
			response.CurrentEntry = &current
			response.Joined = true
		}
	}
	if err := rows.Err(); err != nil {
		return AttendanceResponse{}, err
	}
	return response, nil
}

func attendanceEntrySelectFields() string {
	return `
		id::text,
		organization_id::text,
		conversation_id::text,
		session_id::text,
		lead_id::text,
		binding_id::text,
		user_id::text,
		actor_name_snapshot,
		joined_at,
		entry_source,
		ingress_sequence_cutoff,
		marker_at,
		marker_kind
	`
}

func scanAttendanceEntry(row scanner) (AttendanceEntry, error) {
	var entry AttendanceEntry
	err := row.Scan(
		&entry.ID,
		&entry.OrganizationID,
		&entry.ConversationID,
		&entry.SessionID,
		&entry.LeadID,
		&entry.BindingID,
		&entry.UserID,
		&entry.ActorNameSnapshot,
		&entry.JoinedAt,
		&entry.EntrySource,
		&entry.IngressSequenceCutoff,
		&entry.MarkerAt,
		&entry.MarkerKind,
	)
	return entry, err
}

// recordConfirmedAttendanceMarker runs inside the same transaction that marks
// the outbox sent. The caller has already locked the lead through its contact
// clock update, so concurrent sends to the same card choose one first sender.
// A queued message, a failed send, an automation or a reaction never creates a
// human participation marker.
func recordConfirmedAttendanceMarker(ctx context.Context, tx pgx.Tx, organizationID, messageRowID, outboxID string, queuedAt time.Time) error {
	var entryID, leadID, userID, actorName, conversationID, sessionID, bindingID, markerKind string
	var markerAt time.Time
	err := tx.QueryRow(ctx, `
		update public.whatsapp_attendance_entries as entry
		set marker_at = clock_timestamp(),
		    marker_kind = case when exists (
		      -- A concurrent send can be acknowledged first even if it was queued
		      -- later. The lead lock makes its confirmed marker visible here.
		      select 1 from public.whatsapp_attendance_entries as prior_entry
		      where prior_entry.organization_id = message.organization_id
		        and prior_entry.lead_id = message.lead_id
		        and prior_entry.id <> entry.id
		        and prior_entry.marker_at is not null
		    ) then 'joined' when exists (
		      -- Current conversation bindings use the lead index, then the
		      -- conversation message index. Later CRM arrivals cannot turn an
		      -- already queued first send into a join.
		      select 1
		      from public.whatsapp_conversations as prior_conversation
		      join public.whatsapp_messages as previous
		        on previous.organization_id = prior_conversation.organization_id
		       and previous.conversation_id = prior_conversation.id
		      left join public.whatsapp_outbox as prior_delivery
		        on prior_delivery.message_id = previous.id
		       and prior_delivery.organization_id = previous.organization_id
		      where prior_conversation.organization_id = message.organization_id
		        and prior_conversation.lead_id = message.lead_id
		        and (previous.lead_id = message.lead_id or previous.lead_id is null)
		        and previous.id <> message.id
		        and previous.message_type <> 'reaction'
		        and previous.capture_state is distinct from 'suppressed'
		        and (
		          (not coalesce(previous.from_me, false)
		            and previous.created_at < $3::timestamptz)
		          or (coalesce(previous.from_me, false)
		            and previous.status in ('sent', 'delivered', 'read')
		            and (
		              (prior_delivery.status in ('sent', 'delivered', 'read')
		                and prior_delivery.sent_at <= current_delivery.sent_at)
		              or (prior_delivery.id is null
		                and previous.created_at < $3::timestamptz
		                and previous.sent_at < $3::timestamptz)
		            ))
		        )
		    ) then 'joined' when exists (
		      -- Keep messages from this lead's earlier conversation bindings.
		      select 1
		      from public.whatsapp_conversation_lead_bindings as prior_binding
		      join public.whatsapp_messages as previous
		        on previous.organization_id = prior_binding.organization_id
		       and previous.conversation_id = prior_binding.conversation_id
		      left join public.whatsapp_outbox as prior_delivery
		        on prior_delivery.message_id = previous.id
		       and prior_delivery.organization_id = previous.organization_id
		      where prior_binding.organization_id = message.organization_id
		        and prior_binding.lead_id = message.lead_id
		        and (previous.lead_id = message.lead_id or previous.lead_id is null)
		        and previous.id <> message.id
		        and previous.message_type <> 'reaction'
		        and previous.capture_state is distinct from 'suppressed'
		        and (
		          (not coalesce(previous.from_me, false)
		            and previous.created_at < $3::timestamptz)
		          or (coalesce(previous.from_me, false)
		            and previous.status in ('sent', 'delivered', 'read')
		            and (
		              (prior_delivery.status in ('sent', 'delivered', 'read')
		                and prior_delivery.sent_at <= current_delivery.sent_at)
		              or (prior_delivery.id is null
		                and previous.created_at < $3::timestamptz
		                and previous.sent_at < $3::timestamptz)
		            ))
		        )
		    ) then 'joined' else 'started' end
		from public.whatsapp_messages as message,
		     public.whatsapp_outbox as current_delivery
		where message.id = $1::uuid
		  and message.organization_id = $2::uuid
		  and current_delivery.id = $4::uuid
		  and current_delivery.organization_id = message.organization_id
		  and current_delivery.message_id = message.id
		  and current_delivery.status in ('sent', 'delivered', 'read')
		  and current_delivery.sent_at is not null
		  and message.capture_state is distinct from 'suppressed'
		  and message.status in ('sent', 'delivered', 'read')
		  and message.message_type <> 'reaction'
		  and coalesce(message.metadata->>'origin', '') <> 'automation'
		  and message.sender_user_id = entry.user_id
		  and message.organization_id = entry.organization_id
		  and message.conversation_id = entry.conversation_id
		  and message.session_id = entry.session_id
		  and message.lead_id = entry.lead_id
		  and entry.id::text = message.metadata->>'attendance_entry_id'
		  and entry.marker_at is null
		returning entry.id::text, entry.lead_id::text, entry.user_id::text,
		          entry.actor_name_snapshot, entry.conversation_id::text,
		          entry.session_id::text, entry.binding_id::text,
		          entry.marker_kind, entry.marker_at
	`, messageRowID, organizationID, queuedAt, outboxID).Scan(
		&entryID, &leadID, &userID, &actorName, &conversationID,
		&sessionID, &bindingID, &markerKind, &markerAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}

	title := fmt.Sprintf("%s entrou na conversa", actorName)
	description := "Participação confirmada após o envio pelo WhatsApp."
	if markerKind == "started" {
		title = fmt.Sprintf("%s iniciou uma conversa", actorName)
	}
	metadata := jsonb(map[string]any{
		"attendance_entry_id": entryID,
		"conversation_id":     conversationID,
		"session_id":          sessionID,
		"binding_id":          bindingID,
		"marker_kind":         markerKind,
		"marker_at":           markerAt.Format(time.RFC3339Nano),
		"message_row_id":      messageRowID,
	})
	updated, err := tx.Exec(ctx, `
		update public.lead_timeline_events
		set title = $3, description = $4, event_at = $5::timestamptz,
		    metadata = coalesce(metadata, '{}'::jsonb) || $6::jsonb
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
		  and event_type = 'whatsapp_attendance_joined'
		  and metadata->>'attendance_entry_id' = $7
	`, organizationID, leadID, title, description, markerAt, metadata, entryID)
	if err != nil {
		return err
	}
	if updated.RowsAffected() > 0 {
		return nil
	}
	_, err = tx.Exec(ctx, `
		insert into public.lead_timeline_events (
		  organization_id, lead_id, user_id, actor_user_id,
		  event_type, title, description, event_at, metadata
		) values (
		  $1::uuid, $2::uuid, $3::uuid, $3::uuid,
		  'whatsapp_attendance_joined', $4, $5, $6::timestamptz, $7::jsonb
		)
	`, organizationID, leadID, userID, title, description, markerAt, metadata)
	return err
}
