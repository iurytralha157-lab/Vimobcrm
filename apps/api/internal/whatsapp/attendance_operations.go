package whatsapp

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type attendanceScope struct {
	ConversationID string
	SessionID      string
	LeadID         string
	BindingID      string
	ActorName      string
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

	scope, err := lockAttendanceScope(ctx, tx, tenantContext, conversationID, input, false, false, false)
	if err != nil {
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

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return AttendanceResponse{}, err
	}
	defer tx.Rollback(ctx)

	scope, err := lockAttendanceScope(ctx, tx, tenantContext, conversationID, input, true, true, true)
	if err != nil {
		return AttendanceResponse{}, err
	}

	var ingressSequenceCutoff int64
	if err := tx.QueryRow(ctx, `
		select case when is_called then last_value::bigint else 0::bigint end
		from public.whatsapp_webhook_routing_ingress_sequence
	`).Scan(&ingressSequenceCutoff); err != nil {
		return AttendanceResponse{}, err
	}

	entry, created, err := insertAttendanceEntry(
		ctx,
		tx,
		tenantContext,
		scope,
		ingressSequenceCutoff,
	)
	if err != nil {
		return AttendanceResponse{}, err
	}
	if created {
		title := fmt.Sprintf("%s entrou no atendimento", scope.ActorName)
		if _, err := tx.Exec(ctx, `
			insert into public.lead_timeline_events (
				organization_id, lead_id, user_id, actor_user_id,
				event_type, title, description, event_at, metadata
			) values (
				$1::uuid, $2::uuid, $3::uuid, $3::uuid,
				'whatsapp_attendance_joined', $4, $5, $6::timestamptz,
				jsonb_build_object(
					'attendance_entry_id', $7::uuid,
					'conversation_id', $8::uuid,
					'session_id', $9::uuid,
					'binding_id', $10::uuid,
					'ingress_sequence_cutoff', $11::bigint
				)
			)
		`, tenantContext.OrganizationID, scope.LeadID, tenantContext.UserID,
			title, "Atendimento pelo WhatsApp iniciado.", entry.JoinedAt,
			entry.ID, scope.ConversationID, scope.SessionID, scope.BindingID,
			entry.IngressSequenceCutoff); err != nil {
			return AttendanceResponse{}, err
		}
	}

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

	var lockedSessionID string
	err := tx.QueryRow(ctx, `
		select ws.id::text
		from public.whatsapp_sessions as ws
		where ws.organization_id = $1::uuid
		  and ws.id = $2::uuid
		  and ws.provider = 'evolution_go'
		  and coalesce(ws.is_active, true) = true
		  and coalesce(ws.status, '') <> 'deleted'
		  and (not $4::boolean or ws.owner_user_id = $3::uuid)
		  and (not $5::boolean or ws.status = 'connected')
	`+sessionLock, tenantContext.OrganizationID, scope.SessionID, tenantContext.UserID, requireOwner, requireConnected).Scan(&lockedSessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return attendanceScope{}, ErrSessionNotFound
	}
	if err != nil {
		return attendanceScope{}, err
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

	visibilityArgs := append(baseConversationArgs(tenantContext), scope.LeadID)
	var lockedLeadID string
	err = tx.QueryRow(ctx, `
		select l.id::text
		from public.leads as l
		where l.organization_id = $1::uuid
		  and l.id = $5::uuid
		  and `+leadVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
	`+leadLock, visibilityArgs...).Scan(&lockedLeadID)
	if errors.Is(err, pgx.ErrNoRows) {
		return attendanceScope{}, ErrConversationNotFound
	}
	if err != nil {
		return attendanceScope{}, err
	}

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
		  and user_row.organization_id = $2::uuid
		  and coalesce(user_row.is_active, false) = true
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
) (AttendanceEntry, bool, error) {
	entry, err := scanAttendanceEntry(tx.QueryRow(ctx, `
		insert into public.whatsapp_attendance_entries (
			organization_id, conversation_id, session_id, lead_id,
			binding_id, user_id, actor_name_snapshot, joined_at,
			ingress_sequence_cutoff
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5::uuid, $6::uuid, $7, clock_timestamp(), $8::bigint
		)
		on conflict (organization_id, conversation_id, binding_id, session_id, user_id)
		do nothing
		returning `+attendanceEntrySelectFields()+`
	`, tenantContext.OrganizationID, scope.ConversationID, scope.SessionID,
		scope.LeadID, scope.BindingID, tenantContext.UserID, scope.ActorName,
		ingressSequenceCutoff))
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

func loadAttendanceResponse(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	scope attendanceScope,
) (AttendanceResponse, error) {
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

	response := AttendanceResponse{Entries: []AttendanceEntry{}}
	for rows.Next() {
		entry, err := scanAttendanceEntry(rows)
		if err != nil {
			return AttendanceResponse{}, err
		}
		response.Entries = append(response.Entries, entry)
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
		ingress_sequence_cutoff
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
	)
	return entry, err
}
