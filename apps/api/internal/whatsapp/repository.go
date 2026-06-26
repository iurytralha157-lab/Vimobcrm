package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

const whatsappMediaSignedURLTTLSeconds = 24 * 60 * 60

type Repository struct {
	db        *dbpkg.Postgres
	storage   storageClient
	functions functionsClient
}

type scanner interface {
	Scan(dest ...any) error
}

func NewRepository(db *dbpkg.Postgres, storageConfig StorageConfig) Repository {
	return Repository{
		db:        db,
		storage:   newStorageClient(storageConfig),
		functions: newFunctionsClient(storageConfig),
	}
}

func (repo Repository) ListSessions(ctx context.Context, tenantContext tenant.Context) ([]Session, error) {
	args := []any{tenantContext.OrganizationID, tenantContext.UserID, canManageWhatsApp(tenantContext)}
	rows, err := repo.db.Pool().Query(ctx, `
		select `+sessionSelectFields()+`
		from public.whatsapp_sessions ws
		left join public.users owner on owner.id = ws.owner_user_id
		where ws.organization_id = $1::uuid
		  and ws.is_active is not false
		  and ($3::boolean or ws.owner_user_id = $2::uuid)
		order by ws.created_at desc, ws.id desc
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sessions := []Session{}
	for rows.Next() {
		session, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, session)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return sessions, nil
}

func (repo Repository) GetSession(ctx context.Context, tenantContext tenant.Context, sessionID string) (Session, error) {
	sessionID, ok := normalizeUUID(sessionID)
	if !ok {
		return Session{}, ErrSessionNotFound
	}

	session, err := scanSession(repo.db.Pool().QueryRow(ctx, `
		select `+sessionSelectFields()+`
		from public.whatsapp_sessions ws
		left join public.users owner on owner.id = ws.owner_user_id
		where ws.organization_id = $1::uuid
		  and ws.id = $2::uuid
		  and ws.is_active is not false
		  and ($4::boolean or ws.owner_user_id = $3::uuid or exists (
		    select 1
		    from public.whatsapp_session_access access
		    where access.session_id = ws.id
		      and access.user_id = $3::uuid
		      and coalesce(access.can_view, access.can_read, true) = true
		  ))
		limit 1
	`, tenantContext.OrganizationID, sessionID, tenantContext.UserID, canManageWhatsApp(tenantContext)))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrSessionNotFound
	}
	if err != nil {
		return Session{}, err
	}

	return session, nil
}

func (repo Repository) ListSessionAccess(ctx context.Context, tenantContext tenant.Context, sessionID string) ([]SessionAccess, error) {
	sessionID, ok := normalizeUUID(sessionID)
	if !ok {
		return nil, ErrSessionNotFound
	}
	if err := repo.ensureCanManageSession(ctx, tenantContext, sessionID); err != nil {
		return nil, err
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			access.id::text,
			access.session_id::text,
			access.user_id::text,
			coalesce(access.access_mode, 'assigned_leads_only'),
			coalesce(access.can_view, access.can_read, true),
			coalesce(access.can_read, access.can_view, true),
			coalesce(access.can_send, false),
			coalesce(access.only_leads_access, true),
			access.granted_by::text,
			access.created_at,
			u.id::text,
			u.name,
			u.email
		from public.whatsapp_session_access access
		left join public.users u on u.id = access.user_id
		where access.organization_id = $1::uuid
		  and access.session_id = $2::uuid
		order by u.name asc, access.created_at asc
	`, tenantContext.OrganizationID, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	access := []SessionAccess{}
	for rows.Next() {
		item, err := scanSessionAccess(rows)
		if err != nil {
			return nil, err
		}
		access = append(access, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return access, nil
}

func (repo Repository) GrantSessionAccess(ctx context.Context, tenantContext tenant.Context, sessionID string, input grantAccessInput) error {
	sessionID, ok := normalizeUUID(sessionID)
	if !ok {
		return ErrSessionNotFound
	}
	if err := repo.ensureCanManageSession(ctx, tenantContext, sessionID); err != nil {
		return err
	}
	if err := repo.validateUser(ctx, tenantContext.OrganizationID, input.UserID); err != nil {
		return err
	}

	_, err := repo.db.Pool().Exec(ctx, `
		insert into public.whatsapp_session_access (
			organization_id,
			session_id,
			user_id,
			can_view,
			can_read,
			can_send,
			access_mode,
			only_leads_access,
			granted_by
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4::boolean,
			$4::boolean,
			$5::boolean,
			$6,
			$7::boolean,
			$8::uuid
		)
		on conflict (session_id, user_id)
		do update set
			can_view = excluded.can_view,
			can_read = excluded.can_read,
			can_send = excluded.can_send,
			access_mode = excluded.access_mode,
			only_leads_access = excluded.only_leads_access,
			granted_by = excluded.granted_by
	`, tenantContext.OrganizationID, sessionID, input.UserID, input.CanView, input.CanSend, input.AccessMode, input.AccessMode != "full_inbox", tenantContext.UserID)
	return err
}

func (repo Repository) RevokeSessionAccess(ctx context.Context, tenantContext tenant.Context, sessionID string, userID string) error {
	sessionID, ok := normalizeUUID(sessionID)
	if !ok {
		return ErrSessionNotFound
	}
	userID, ok = normalizeUUID(userID)
	if !ok {
		return ErrInvalidInput
	}
	if err := repo.ensureCanManageSession(ctx, tenantContext, sessionID); err != nil {
		return err
	}

	_, err := repo.db.Pool().Exec(ctx, `
		delete from public.whatsapp_session_access
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and user_id = $3::uuid
	`, tenantContext.OrganizationID, sessionID, userID)
	return err
}

func (repo Repository) ListConversations(ctx context.Context, tenantContext tenant.Context, filter ConversationListFilter) ([]Conversation, error) {
	if filter.AccessibleProvided && len(filter.SessionIDs) == 0 {
		return []Conversation{}, nil
	}

	args := baseConversationArgs(tenantContext)
	where := []string{
		"wc.organization_id = $1::uuid",
		"wc.deleted_at is null",
		conversationVisibilitySQL(),
	}

	addFilter := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}

	if filter.SessionID != "" {
		addFilter("wc.session_id = $%d::uuid", filter.SessionID)
	}
	if len(filter.SessionIDs) > 0 {
		placeholders := make([]string, 0, len(filter.SessionIDs))
		for _, sessionID := range filter.SessionIDs {
			args = append(args, sessionID)
			placeholders = append(placeholders, fmt.Sprintf("$%d::uuid", len(args)))
		}
		where = append(where, "wc.session_id in ("+strings.Join(placeholders, ", ")+")")
	}
	if filter.HideGroups {
		where = append(where, "wc.is_group = false")
	}
	if !filter.ShowArchived {
		where = append(where, "wc.archived_at is null")
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select `+conversationSelectFields()+`
		from public.whatsapp_conversations wc
		left join public.whatsapp_sessions ws on ws.id = wc.session_id
		left join public.leads l on l.id = wc.lead_id
		left join public.pipelines pipeline on pipeline.id = l.pipeline_id
		left join public.stages stage on stage.id = l.stage_id
		where `+strings.Join(where, " and ")+`
		order by wc.last_message_at desc nulls last, wc.created_at desc, wc.id desc
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	conversations := []Conversation{}
	for rows.Next() {
		conversation, err := scanConversation(rows)
		if err != nil {
			return nil, err
		}
		conversations = append(conversations, conversation)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return conversations, nil
}

func (repo Repository) GetConversation(ctx context.Context, tenantContext tenant.Context, conversationID string) (Conversation, error) {
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return Conversation{}, ErrConversationNotFound
	}

	args := append(baseConversationArgs(tenantContext), conversationID)
	conversation, err := scanConversation(repo.db.Pool().QueryRow(ctx, `
		select `+conversationSelectFields()+`
		from public.whatsapp_conversations wc
		left join public.whatsapp_sessions ws on ws.id = wc.session_id
		left join public.leads l on l.id = wc.lead_id
		left join public.pipelines pipeline on pipeline.id = l.pipeline_id
		left join public.stages stage on stage.id = l.stage_id
		where wc.organization_id = $1::uuid
		  and wc.deleted_at is null
		  and `+conversationVisibilitySQL()+`
		  and wc.id = $6::uuid
		limit 1
	`, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return Conversation{}, ErrConversationNotFound
	}
	if err != nil {
		return Conversation{}, err
	}

	return conversation, nil
}

func (repo Repository) ListMessages(ctx context.Context, tenantContext tenant.Context, conversationID string, filter MessageFilter) (MessagePage, error) {
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return MessagePage{}, ErrConversationNotFound
	}
	if err := repo.ensureCanViewConversation(ctx, tenantContext, conversationID); err != nil {
		return MessagePage{}, err
	}

	args := []any{tenantContext.OrganizationID, conversationID, filter.Limit}
	where := []string{
		"wm.organization_id = $1::uuid",
		"wm.conversation_id = $2::uuid",
	}
	if filter.Cursor != nil {
		args = append(args, *filter.Cursor)
		where = append(where, fmt.Sprintf("coalesce(wm.sent_at, wm.created_at) < $%d::timestamptz", len(args)))
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select `+messageSelectFields()+`
		from public.whatsapp_messages wm
		where `+strings.Join(where, " and ")+`
		order by coalesce(wm.sent_at, wm.created_at) desc, wm.id desc
		limit $3::integer
	`, args...)
	if err != nil {
		return MessagePage{}, err
	}
	defer rows.Close()

	descMessages := []Message{}
	for rows.Next() {
		message, err := scanMessage(rows)
		if err != nil {
			return MessagePage{}, err
		}
		descMessages = append(descMessages, message)
	}
	if err := rows.Err(); err != nil {
		return MessagePage{}, err
	}

	var nextCursor *time.Time
	if len(descMessages) == filter.Limit {
		value := descMessages[len(descMessages)-1].SentAt
		nextCursor = &value
	}

	messages := make([]Message, 0, len(descMessages))
	for index := len(descMessages) - 1; index >= 0; index-- {
		messages = append(messages, descMessages[index])
	}
	if err := repo.hydrateMessageMediaURLs(ctx, messages); err != nil {
		return MessagePage{}, err
	}

	return MessagePage{Messages: messages, NextCursor: nextCursor}, nil
}

func (repo Repository) MarkConversationAsRead(ctx context.Context, tenantContext tenant.Context, conversationID string) error {
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return ErrConversationNotFound
	}
	if err := repo.ensureCanViewConversation(ctx, tenantContext, conversationID); err != nil {
		return err
	}

	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_conversations
		set unread_count = 0,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, conversationID)
	return err
}

func (repo Repository) ArchiveConversation(ctx context.Context, tenantContext tenant.Context, conversationID string, archive bool) error {
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return ErrConversationNotFound
	}
	if err := repo.ensureCanEditConversation(ctx, tenantContext, conversationID); err != nil {
		return err
	}

	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_conversations
		set archived_at = case when $3::boolean then now() else null end,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, conversationID, archive)
	return err
}

func (repo Repository) DeleteConversation(ctx context.Context, tenantContext tenant.Context, conversationID string) error {
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return ErrConversationNotFound
	}
	if err := repo.ensureCanEditConversation(ctx, tenantContext, conversationID); err != nil {
		return err
	}

	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_conversations
		set deleted_at = now(),
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, conversationID)
	return err
}

func (repo Repository) LinkConversationToLead(ctx context.Context, tenantContext tenant.Context, conversationID string, leadID string) error {
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return ErrConversationNotFound
	}
	if err := repo.ensureCanEditConversation(ctx, tenantContext, conversationID); err != nil {
		return err
	}
	if err := repo.validateLead(ctx, tenantContext.OrganizationID, leadID); err != nil {
		return err
	}

	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_conversations
		set lead_id = $3::uuid,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, conversationID, leadID)
	return err
}

func (repo Repository) hydrateMessageMediaURLs(ctx context.Context, messages []Message) error {
	for index := range messages {
		if messages[index].MediaStoragePath == nil || *messages[index].MediaStoragePath == "" {
			continue
		}
		signedURL, err := repo.storage.signedURL(ctx, "whatsapp-media", *messages[index].MediaStoragePath, whatsappMediaSignedURLTTLSeconds)
		if err != nil || signedURL == "" {
			continue
		}
		messages[index].MediaURL = &signedURL
	}

	return nil
}

func (repo Repository) ensureCanManageSession(ctx context.Context, tenantContext tenant.Context, sessionID string) error {
	var ok bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.whatsapp_sessions ws
			where ws.organization_id = $1::uuid
			  and ws.id = $2::uuid
			  and ws.is_active is not false
			  and ($4::boolean or ws.owner_user_id = $3::uuid)
		)
	`, tenantContext.OrganizationID, sessionID, tenantContext.UserID, canManageWhatsApp(tenantContext)).Scan(&ok)
	if err != nil {
		return err
	}
	if !ok {
		return ErrSessionNotFound
	}

	return nil
}

func (repo Repository) ensureCanViewConversation(ctx context.Context, tenantContext tenant.Context, conversationID string) error {
	var ok bool
	args := append(baseConversationArgs(tenantContext), conversationID)
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.whatsapp_conversations wc
			left join public.whatsapp_sessions ws on ws.id = wc.session_id
			left join public.leads l on l.id = wc.lead_id
			where wc.organization_id = $1::uuid
			  and wc.deleted_at is null
			  and `+conversationVisibilitySQL()+`
			  and wc.id = $6::uuid
		)
	`, args...).Scan(&ok)
	if err != nil {
		return err
	}
	if !ok {
		return ErrConversationNotFound
	}

	return nil
}

func (repo Repository) ensureCanEditConversation(ctx context.Context, tenantContext tenant.Context, conversationID string) error {
	var ok bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.whatsapp_conversations wc
			left join public.whatsapp_sessions ws on ws.id = wc.session_id
			where wc.organization_id = $1::uuid
			  and wc.deleted_at is null
			  and wc.id = $2::uuid
			  and (
			    $4::boolean
			    or ws.owner_user_id = $3::uuid
			    or exists (
			      select 1
			      from public.whatsapp_session_access access
			      where access.session_id = wc.session_id
			        and access.user_id = $3::uuid
			        and coalesce(access.can_view, access.can_read, true) = true
			        and coalesce(access.can_send, false) = true
			    )
			  )
		)
	`, tenantContext.OrganizationID, conversationID, tenantContext.UserID, canManageWhatsApp(tenantContext)).Scan(&ok)
	if err != nil {
		return err
	}
	if !ok {
		return ErrConversationNotFound
	}

	return nil
}

func (repo Repository) validateUser(ctx context.Context, organizationID string, userID string) error {
	var exists bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.users u
			left join public.organization_members om
			  on om.user_id = u.id
			 and om.organization_id = $1::uuid
			 and om.is_active = true
			where u.id = $2::uuid
			  and u.is_active = true
			  and (u.organization_id = $1::uuid or om.id is not null)
		)
	`, organizationID, userID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalidReference
	}

	return nil
}

func (repo Repository) validateLead(ctx context.Context, organizationID string, leadID string) error {
	var exists bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.leads
			where organization_id = $1::uuid
			  and id = $2::uuid
		)
	`, organizationID, leadID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalidReference
	}

	return nil
}

func sessionSelectFields() string {
	return `
		ws.id::text,
		ws.organization_id::text,
		ws.owner_user_id::text,
		ws.instance_name,
		ws.display_name,
		ws.instance_id,
		ws.status,
		ws.phone_number,
		ws.profile_name,
		ws.profile_picture,
		coalesce(ws.is_active, true),
		coalesce(ws.is_notification_session, false),
		ws.provider,
		coalesce(ws.advanced_settings, '{}'::jsonb)::text,
		ws.created_at,
		ws.updated_at,
		ws.last_connected_at,
		owner.id::text,
		owner.name,
		owner.email`
}

func conversationSelectFields() string {
	return `
		wc.id::text,
		coalesce(wc.session_id::text, ''),
		wc.lead_id::text,
		wc.remote_jid,
		wc.contact_name,
		wc.contact_phone,
		wc.contact_picture,
		wc.contact_presence,
		wc.presence_updated_at,
		wc.last_message,
		wc.last_message_at,
		wc.unread_count,
		wc.is_group,
		wc.archived_at,
		wc.deleted_at,
		wc.created_at,
		wc.updated_at,
		ws.id::text,
		ws.instance_name,
		ws.phone_number,
		ws.status,
		ws.organization_id::text,
		ws.provider,
		l.id::text,
		l.name,
		l.whatsapp_avatar_url,
		l.pipeline_id::text,
		l.stage_id::text,
		pipeline.id::text,
		pipeline.name,
		stage.id::text,
		stage.name,
		stage.color,
		coalesce((
			select jsonb_agg(jsonb_build_object(
				'tag', jsonb_build_object(
					'id', t.id::text,
					'name', t.name,
					'color', t.color
				)
			))
			from public.lead_tags lt
			join public.tags t on t.id = lt.tag_id
			where lt.lead_id = l.id
		), '[]'::jsonb)::text`
}

func messageSelectFields() string {
	return `
		wm.id::text,
		wm.conversation_id::text,
		coalesce(wm.session_id::text, ''),
		coalesce(wm.message_id, wm.client_message_id, wm.id::text),
		wm.client_message_id,
		wm.from_me,
		wm.content,
		wm.message_type,
		wm.media_url,
		wm.media_mime_type,
		wm.media_status,
		wm.media_error,
		wm.media_size,
		wm.media_storage_path,
		wm.remote_jid,
		wm.reaction_to_message_id,
		wm.reaction_emoji,
		wm.reaction_sender_jid,
		wm.reaction_sender_name,
		coalesce(wm.metadata, '{}'::jsonb)::text,
		wm.status,
		coalesce(wm.sent_at, wm.created_at),
		wm.delivered_at,
		wm.read_at,
		wm.sender_jid,
		wm.sender_name`
}

func scanSession(row scanner) (Session, error) {
	var session Session
	var ownerID, ownerName, ownerEmail pgtype.Text
	var displayName, instanceID, phoneNumber, profileName, profilePicture pgtype.Text
	var lastConnectedAt pgtype.Timestamptz
	var settingsJSON string

	if err := row.Scan(
		&session.ID,
		&session.OrganizationID,
		&session.OwnerUserID,
		&session.InstanceName,
		&displayName,
		&instanceID,
		&session.Status,
		&phoneNumber,
		&profileName,
		&profilePicture,
		&session.IsActive,
		&session.IsNotificationSession,
		&session.Provider,
		&settingsJSON,
		&session.CreatedAt,
		&session.UpdatedAt,
		&lastConnectedAt,
		&ownerID,
		&ownerName,
		&ownerEmail,
	); err != nil {
		return Session{}, err
	}

	session.DisplayName = textPtr(displayName)
	session.InstanceID = textPtr(instanceID)
	session.PhoneNumber = textPtr(phoneNumber)
	session.ProfileName = textPtr(profileName)
	session.ProfilePicture = textPtr(profilePicture)
	session.LastConnectedAt = timePtr(lastConnectedAt)
	session.AdvancedSettings = decodeObjectJSON(settingsJSON)
	if ownerID.Valid {
		session.Owner = &OwnerRef{ID: ownerID.String, Name: textValue(ownerName), Email: textValue(ownerEmail)}
	}

	return session, nil
}

func scanSessionAccess(row scanner) (SessionAccess, error) {
	var item SessionAccess
	var grantedBy, userID, userName, userEmail pgtype.Text
	if err := row.Scan(
		&item.ID,
		&item.SessionID,
		&item.UserID,
		&item.AccessMode,
		&item.CanView,
		&item.CanRead,
		&item.CanSend,
		&item.OnlyLeadsAccess,
		&grantedBy,
		&item.CreatedAt,
		&userID,
		&userName,
		&userEmail,
	); err != nil {
		return SessionAccess{}, err
	}
	item.GrantedBy = textPtr(grantedBy)
	if userID.Valid {
		item.User = &AccessUser{ID: userID.String, Name: textValue(userName), Email: textValue(userEmail)}
	}

	return item, nil
}

func scanConversation(row scanner) (Conversation, error) {
	var conversation Conversation
	var leadID, contactName, contactPhone, contactPicture, contactPresence, lastMessage pgtype.Text
	var presenceUpdatedAt, lastMessageAt, archivedAt, deletedAt pgtype.Timestamptz
	var sessionID, sessionInstanceName, sessionPhone, sessionStatus, sessionOrgID, sessionProvider pgtype.Text
	var leadRefID, leadName, leadAvatar, leadPipelineID, leadStageID pgtype.Text
	var pipelineID, pipelineName, stageID, stageName, stageColor pgtype.Text
	var tagsJSON string

	if err := row.Scan(
		&conversation.ID,
		&conversation.SessionID,
		&leadID,
		&conversation.RemoteJID,
		&contactName,
		&contactPhone,
		&contactPicture,
		&contactPresence,
		&presenceUpdatedAt,
		&lastMessage,
		&lastMessageAt,
		&conversation.UnreadCount,
		&conversation.IsGroup,
		&archivedAt,
		&deletedAt,
		&conversation.CreatedAt,
		&conversation.UpdatedAt,
		&sessionID,
		&sessionInstanceName,
		&sessionPhone,
		&sessionStatus,
		&sessionOrgID,
		&sessionProvider,
		&leadRefID,
		&leadName,
		&leadAvatar,
		&leadPipelineID,
		&leadStageID,
		&pipelineID,
		&pipelineName,
		&stageID,
		&stageName,
		&stageColor,
		&tagsJSON,
	); err != nil {
		return Conversation{}, err
	}

	conversation.LeadID = textPtr(leadID)
	conversation.ContactName = textPtr(contactName)
	conversation.ContactPhone = textPtr(contactPhone)
	conversation.ContactPicture = textPtr(contactPicture)
	conversation.ContactPresence = textPtr(contactPresence)
	conversation.PresenceUpdatedAt = timePtr(presenceUpdatedAt)
	conversation.LastMessage = textPtr(lastMessage)
	conversation.LastMessageAt = timePtr(lastMessageAt)
	conversation.ArchivedAt = timePtr(archivedAt)
	conversation.DeletedAt = timePtr(deletedAt)

	if sessionID.Valid {
		conversation.Session = &SessionLite{
			ID:             sessionID.String,
			InstanceName:   textValue(sessionInstanceName),
			PhoneNumber:    textPtr(sessionPhone),
			Status:         textValue(sessionStatus),
			OrganizationID: textValue(sessionOrgID),
			Provider:       textPtr(sessionProvider),
		}
	}

	if leadRefID.Valid {
		lead := &LeadLite{
			ID:                leadRefID.String,
			Name:              textValue(leadName),
			WhatsAppAvatarURL: textPtr(leadAvatar),
			PipelineID:        textPtr(leadPipelineID),
			StageID:           textPtr(leadStageID),
			Tags:              decodeLeadTags(tagsJSON),
		}
		if pipelineID.Valid {
			lead.Pipeline = &NameRef{ID: pipelineID.String, Name: textValue(pipelineName)}
		}
		if stageID.Valid {
			lead.Stage = &StageRef{ID: stageID.String, Name: textValue(stageName), Color: textPtr(stageColor)}
		}
		conversation.Lead = lead
	}

	return conversation, nil
}

func scanMessage(row scanner) (Message, error) {
	var message Message
	var clientMessageID, content, mediaURL, mediaMimeType, mediaStatus, mediaError, mediaStoragePath pgtype.Text
	var remoteJID, reactionToMessageID, reactionEmoji, reactionSenderJID, reactionSenderName pgtype.Text
	var mediaSize pgtype.Int8
	var deliveredAt, readAt pgtype.Timestamptz
	var senderJID, senderName pgtype.Text
	var metadataJSON string

	if err := row.Scan(
		&message.ID,
		&message.ConversationID,
		&message.SessionID,
		&message.MessageID,
		&clientMessageID,
		&message.FromMe,
		&content,
		&message.MessageType,
		&mediaURL,
		&mediaMimeType,
		&mediaStatus,
		&mediaError,
		&mediaSize,
		&mediaStoragePath,
		&remoteJID,
		&reactionToMessageID,
		&reactionEmoji,
		&reactionSenderJID,
		&reactionSenderName,
		&metadataJSON,
		&message.Status,
		&message.SentAt,
		&deliveredAt,
		&readAt,
		&senderJID,
		&senderName,
	); err != nil {
		return Message{}, err
	}

	message.ClientMessageID = textPtr(clientMessageID)
	message.Content = textPtr(content)
	message.MediaURL = textPtr(mediaURL)
	message.MediaMimeType = textPtr(mediaMimeType)
	message.MediaStatus = textPtr(mediaStatus)
	message.MediaError = textPtr(mediaError)
	message.MediaSize = int64Ptr(mediaSize)
	message.MediaStoragePath = textPtr(mediaStoragePath)
	message.RemoteJID = textPtr(remoteJID)
	message.ReactionToMessageID = textPtr(reactionToMessageID)
	message.ReactionEmoji = textPtr(reactionEmoji)
	message.ReactionSenderJID = textPtr(reactionSenderJID)
	message.ReactionSenderName = textPtr(reactionSenderName)
	message.Metadata = decodeObjectJSON(metadataJSON)
	message.DeliveredAt = timePtr(deliveredAt)
	message.ReadAt = timePtr(readAt)
	message.SenderJID = textPtr(senderJID)
	message.SenderName = textPtr(senderName)

	return message, nil
}

func baseConversationArgs(tenantContext tenant.Context) []any {
	return []any{
		tenantContext.OrganizationID,
		tenantContext.UserID,
		canManageWhatsApp(tenantContext),
		canViewAllLeads(tenantContext),
		tenantContext.HasPermission("lead_view_team"),
	}
}

func conversationVisibilitySQL() string {
	return `(
		$3::boolean
		or ws.owner_user_id = $2::uuid
		or (
			wc.lead_id is not null
			and ` + leadVisibilitySQL() + `
		)
		or exists (
			select 1
			from public.whatsapp_session_access access
			where access.session_id = wc.session_id
			  and access.user_id = $2::uuid
			  and coalesce(access.can_view, access.can_read, true) = true
			  and (
				access.access_mode = 'full_inbox'
				or (access.access_mode = 'all_leads' and wc.lead_id is not null)
				or (
					access.access_mode in ('assigned_leads_only', 'team_leads')
					and wc.lead_id is not null
					and ` + leadVisibilitySQL() + `
				)
			  )
		)
	)`
}

func leadVisibilitySQL() string {
	return `(
		$4::boolean
		or l.assigned_user_id = $2::uuid
		or (
			$5::boolean
			and l.assigned_user_id is not null
			and exists (
				select 1
				from public.team_members leader
				join public.team_members member
				  on member.organization_id = leader.organization_id
				 and member.team_id = leader.team_id
				 and member.is_active = true
				where leader.organization_id = l.organization_id
				  and leader.user_id = $2::uuid
				  and leader.is_active = true
				  and leader.is_leader = true
				  and member.user_id = l.assigned_user_id
			)
		)
	)`
}

func canManageWhatsApp(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin") ||
		tenantContext.HasPermission("whatsapp_manage") ||
		tenantContext.HasPermission("settings_manage")
}

func canViewAllLeads(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin", "manager") ||
		tenantContext.HasPermission("lead_view_all")
}

func textValue(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}

	return value.String
}

func textPtr(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}

	return &value.String
}

func timePtr(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}

	return &value.Time
}

func int64Ptr(value pgtype.Int8) *int64 {
	if !value.Valid {
		return nil
	}

	return &value.Int64
}

func decodeObjectJSON(raw string) map[string]any {
	out := map[string]any{}
	_ = json.Unmarshal([]byte(raw), &out)
	return out
}

func decodeLeadTags(raw string) []LeadTagRef {
	out := []LeadTagRef{}
	_ = json.Unmarshal([]byte(raw), &out)
	return out
}
