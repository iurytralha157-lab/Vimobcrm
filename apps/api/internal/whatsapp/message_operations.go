package whatsapp

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const whatsappMediaBucket = "whatsapp-media"

func (repo Repository) SendMessage(ctx context.Context, tenantContext tenant.Context, conversationID string, input sendMessageInput) (SendMessageResponse, error) {
	conversation, err := repo.GetConversation(ctx, tenantContext, conversationID)
	if err != nil {
		return SendMessageResponse{}, err
	}

	session, err := repo.resolveSendSession(ctx, tenantContext, conversation, input.SendSessionID)
	if err != nil {
		return SendMessageResponse{}, err
	}
	if session.Provider != "evolution_go" {
		return SendMessageResponse{}, fmt.Errorf("%w: legacy Evolution provider is disabled", ErrInvalidInput)
	}
	if session.Status != "connected" {
		return SendMessageResponse{}, fmt.Errorf("%w: WhatsApp desconectado. Reconecte ou selecione uma conexao ativa.", ErrInvalidInput)
	}

	if err := repo.rebindConversationSession(ctx, tenantContext.OrganizationID, conversation.ID, session.ID, conversation.RemoteJID); err != nil {
		return SendMessageResponse{}, err
	}
	conversation.SessionID = session.ID
	conversation.Session = &SessionLite{
		ID:             session.ID,
		InstanceName:   session.InstanceName,
		PhoneNumber:    session.PhoneNumber,
		Status:         session.Status,
		OrganizationID: session.OrganizationID,
		Provider:       &session.Provider,
	}

	clientMessageID := input.ClientMessageID
	if clientMessageID == "" {
		clientMessageID = createClientMessageID()
	}

	rawPhone := strings.NewReplacer("@c.us", "", "@s.whatsapp.net", "", "@g.us", "").Replace(conversation.RemoteJID)
	phone := formatPhoneForWhatsApp(rawPhone)
	destination := phone
	if conversation.IsGroup {
		destination = conversation.RemoteJID
	}

	storedMediaURL := input.MediaURL
	storedMediaPath := storagePathFromPublicURL(input.MediaURL)
	if input.Base64 != "" && storedMediaURL == "" {
		payload, decodeErr := decodeBase64Media(input.Base64)
		if decodeErr == nil {
			extension := mediaExtension(input.Mimetype)
			storedMediaPath = fmt.Sprintf("orgs/%s/sessions/%s/outgoing/%s.%s", session.OrganizationID, session.ID, clientMessageID, extension)
			if uploadErr := repo.storage.upload(ctx, whatsappMediaBucket, storedMediaPath, input.Mimetype, bytes.NewReader(payload), true); uploadErr == nil {
				storedMediaURL = repo.storage.publicURL(whatsappMediaBucket, storedMediaPath)
			}
		}
	}

	isMediaMessage := storedMediaURL != "" || input.Base64 != ""
	actualContent := input.Text
	if isMediaMessage && textLooksLikeFilename(input.Text, input.Filename) {
		actualContent = ""
	}

	mediaSource := storedMediaURL
	if mediaSource == "" {
		mediaSource = input.Base64
	}
	if storedMediaPath != "" && !(input.MediaType == "audio" && input.Base64 != "") {
		if signedURL, signErr := repo.storage.signedURL(ctx, whatsappMediaBucket, storedMediaPath, 15*60); signErr == nil && signedURL != "" {
			mediaSource = signedURL
		}
	}

	mentions := mentionsFromText(input.Text)
	var providerResult map[string]any
	if mediaSource != "" {
		action := "send.media"
		if input.MediaType == "audio" {
			action = "send.audio"
		}
		body := map[string]any{
			"number":       destination,
			"type":         input.MediaType,
			"url":          mediaSource,
			"media":        mediaSource,
			"base64":       mediaSource,
			"mediatype":    input.MediaType,
			"mediaType":    input.MediaType,
			"mimetype":     input.Mimetype,
			"fileName":     input.Filename,
			"filename":     input.Filename,
			"caption":      nilIfEmpty(actualContent),
			"mentions":     mentions,
			"mentionedJid": mentions,
		}
		providerResult, err = repo.functions.invokeEvolution(ctx, action, map[string]any{
			"session_id": session.ID,
			"body":       body,
		})
	} else {
		providerResult, err = repo.functions.invokeEvolution(ctx, "send.text", map[string]any{
			"session_id": session.ID,
			"body": map[string]any{
				"number":   destination,
				"text":     input.Text,
				"mentions": mentions,
			},
		})
	}
	if err != nil {
		return SendMessageResponse{}, err
	}

	if conversation.LeadID == nil && !conversation.IsGroup {
		if matchedLeadID, matchedLeadName := repo.matchLeadByPhone(ctx, session.OrganizationID, conversation.ContactPhone, conversation.RemoteJID, phone); matchedLeadID != "" {
			conversation.LeadID = &matchedLeadID
			_, _ = repo.db.Pool().Exec(ctx, `
				update public.whatsapp_conversations
				set lead_id = $3::uuid,
				    contact_name = coalesce(nullif($4, ''), contact_name),
				    updated_at = now()
				where organization_id = $1::uuid
				  and id = $2::uuid
			`, session.OrganizationID, conversation.ID, matchedLeadID, matchedLeadName)
		}
	}

	messageID := providerMessageID(providerResult)
	if messageID == "" {
		messageID = clientMessageID
	}
	senderName := repo.userDisplayName(ctx, tenantContext.UserID)
	messageType := input.MediaType
	if messageType == "" {
		messageType = "text"
	}
	mediaStatus := (*string)(nil)
	if isMediaMessage {
		value := "ready"
		mediaStatus = &value
	}

	_, err = repo.db.Pool().Exec(ctx, `
		insert into public.whatsapp_messages (
			organization_id,
			conversation_id,
			session_id,
			lead_id,
			sender_user_id,
			message_id,
			client_message_id,
			from_me,
			content,
			message_type,
			media_url,
			media_mime_type,
			media_status,
			media_storage_path,
			remote_jid,
			status,
			sent_at,
			sender_name,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4::uuid,
			$5::uuid,
			$6,
			$7,
			true,
			nullif($8, ''),
			$9,
			nullif($10, ''),
			nullif($11, ''),
			$12,
			nullif($13, ''),
			$14,
			'sent',
			now(),
			nullif($15, ''),
			$16::jsonb
		)
		on conflict (conversation_id, message_id)
		do update set
			client_message_id = excluded.client_message_id,
			session_id = excluded.session_id,
			lead_id = excluded.lead_id,
			content = excluded.content,
			message_type = excluded.message_type,
			media_url = excluded.media_url,
			media_mime_type = excluded.media_mime_type,
			media_status = excluded.media_status,
			media_storage_path = excluded.media_storage_path,
			status = excluded.status,
			sent_at = excluded.sent_at,
			sender_name = excluded.sender_name,
			metadata = excluded.metadata
	`, session.OrganizationID, conversation.ID, session.ID, conversation.LeadID, tenantContext.UserID, messageID, clientMessageID, actualContent, messageType, storedMediaURL, input.Mimetype, mediaStatus, storedMediaPath, conversation.RemoteJID, senderName, jsonb(map[string]any{"provider_response": providerResult}))
	if err != nil {
		return SendMessageResponse{}, fmt.Errorf("%w: Mensagem enviada no WhatsApp, mas nao foi salva no historico do CRM.", ErrProviderFailed)
	}

	if conversation.LeadID != nil {
		repo.insertLeadTimelineEvent(ctx, session.OrganizationID, *conversation.LeadID, tenantContext.UserID, messageID, actualContent, messageType, session.ID, session.InstanceName)
	}

	_, err = repo.db.Pool().Exec(ctx, `
		update public.whatsapp_conversations
		set last_message = $3,
		    last_message_at = now(),
		    unread_count = 0,
		    session_id = $4::uuid,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, session.OrganizationID, conversation.ID, outgoingLastMessage(messageType, actualContent, senderName, conversation.IsGroup), session.ID)
	if err != nil {
		return SendMessageResponse{}, err
	}

	return SendMessageResponse{
		ClientMessageID: clientMessageID,
		ConversationID:  conversation.ID,
		ProviderData:    providerResult,
	}, nil
}

func (repo Repository) MarkAsSeenOnWhatsApp(ctx context.Context, tenantContext tenant.Context, conversationID string) error {
	conversation, err := repo.GetConversation(ctx, tenantContext, conversationID)
	if err != nil {
		return err
	}
	if err := repo.ensureCanEditConversation(ctx, tenantContext, conversation.ID); err != nil {
		return err
	}

	session, err := repo.getCanSendSession(ctx, tenantContext, conversation.SessionID)
	if err != nil {
		return err
	}
	if session.Provider != "evolution_go" {
		return fmt.Errorf("%w: Marcacao como lida esta disponivel apenas para Evolution Go.", ErrInvalidInput)
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select message_id
		from public.whatsapp_messages
		where organization_id = $1::uuid
		  and conversation_id = $2::uuid
		  and from_me = false
		order by coalesce(sent_at, created_at) desc
		limit 20
	`, tenantContext.OrganizationID, conversation.ID)
	if err != nil {
		return err
	}
	defer rows.Close()

	messageIDs := []string{}
	for rows.Next() {
		var messageID string
		if err := rows.Scan(&messageID); err != nil {
			return err
		}
		if strings.TrimSpace(messageID) != "" {
			messageIDs = append(messageIDs, messageID)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	_, err = repo.functions.invokeEvolution(ctx, "message.markread", map[string]any{
		"session_id": session.ID,
		"body": map[string]any{
			"allowWhatsAppReadReceipt": true,
			"jid":                      conversation.RemoteJID,
			"messageIds":               messageIDs,
		},
	})
	return err
}

func (repo Repository) RetryMediaDownload(ctx context.Context, tenantContext tenant.Context, messageID string) (map[string]any, error) {
	messageID, ok := normalizeUUID(messageID)
	if !ok {
		return nil, ErrMessageNotFound
	}

	var conversationID string
	err := repo.db.Pool().QueryRow(ctx, `
		select wm.conversation_id::text
		from public.whatsapp_messages wm
		where wm.organization_id = $1::uuid
		  and wm.id = $2::uuid
		limit 1
	`, tenantContext.OrganizationID, messageID).Scan(&conversationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrMessageNotFound
	}
	if err != nil {
		return nil, err
	}
	if err := repo.ensureCanViewConversation(ctx, tenantContext, conversationID); err != nil {
		return nil, err
	}

	return repo.functions.invoke(ctx, "media-worker", map[string]any{
		"message_id": messageID,
		"force":      true,
	})
}

func (repo Repository) GetHistoryAccess(ctx context.Context, tenantContext tenant.Context, filter HistoryAccessFilter) (HistoryAccessResponse, error) {
	conversationID := filter.ConversationID
	if conversationID == "" && filter.LeadID != "" {
		found, err := repo.findConversationForLead(ctx, tenantContext, filter.LeadID)
		if err != nil {
			return HistoryAccessResponse{}, err
		}
		if found == nil {
			return HistoryAccessResponse{Messages: []Message{}}, nil
		}
		conversationID = found.ID
	}

	conversation, err := repo.GetConversation(ctx, tenantContext, conversationID)
	if err != nil {
		return HistoryAccessResponse{}, err
	}

	limit := 50
	if filter.AllMessages {
		limit = 500
	}
	page, err := repo.ListMessages(ctx, tenantContext, conversation.ID, MessageFilter{Limit: limit})
	if err != nil {
		return HistoryAccessResponse{}, err
	}

	return HistoryAccessResponse{Conversation: &conversation, Messages: page.Messages}, nil
}

func (repo Repository) resolveSendSession(ctx context.Context, tenantContext tenant.Context, conversation Conversation, preferredSessionID string) (Session, error) {
	if preferredSessionID != "" {
		session, err := repo.getCanSendSession(ctx, tenantContext, preferredSessionID)
		if err == nil && session.Status == "connected" {
			return session, nil
		}
	}

	if conversation.SessionID != "" {
		session, err := repo.getCanSendSession(ctx, tenantContext, conversation.SessionID)
		if err == nil && session.Status == "connected" {
			return session, nil
		}
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select `+sessionSelectFields()+`
		from public.whatsapp_sessions ws
		left join public.users owner on owner.id = ws.owner_user_id
		where ws.organization_id = $1::uuid
		  and ws.is_active is not false
		  and ws.status = 'connected'
		  and (
		    $3::boolean
		    or ws.owner_user_id = $2::uuid
		    or exists (
		      select 1
		      from public.whatsapp_session_access access
		      where access.session_id = ws.id
		        and access.user_id = $2::uuid
		        and coalesce(access.can_view, access.can_read, true) = true
		        and coalesce(access.can_send, false) = true
		    )
		  )
		order by ws.last_connected_at desc nulls last, ws.created_at desc
		limit 2
	`, tenantContext.OrganizationID, tenantContext.UserID, canManageWhatsApp(tenantContext))
	if err != nil {
		return Session{}, err
	}
	defer rows.Close()

	sessions := []Session{}
	for rows.Next() {
		session, err := scanSession(rows)
		if err != nil {
			return Session{}, err
		}
		sessions = append(sessions, session)
	}
	if err := rows.Err(); err != nil {
		return Session{}, err
	}
	if len(sessions) == 1 {
		return sessions[0], nil
	}
	if len(sessions) > 1 {
		return Session{}, fmt.Errorf("%w: Selecione qual WhatsApp deseja usar para enviar esta mensagem.", ErrInvalidInput)
	}

	return Session{}, fmt.Errorf("%w: WhatsApp desconectado. Reconecte ou selecione uma conexao ativa.", ErrInvalidInput)
}

func (repo Repository) getCanSendSession(ctx context.Context, tenantContext tenant.Context, sessionID string) (Session, error) {
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
		  and (
		    $4::boolean
		    or ws.owner_user_id = $3::uuid
		    or exists (
		      select 1
		      from public.whatsapp_session_access access
		      where access.session_id = ws.id
		        and access.user_id = $3::uuid
		        and coalesce(access.can_view, access.can_read, true) = true
		        and coalesce(access.can_send, false) = true
		    )
		  )
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

func (repo Repository) rebindConversationSession(ctx context.Context, organizationID string, conversationID string, sessionID string, remoteJID string) error {
	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_conversations
		set session_id = $3::uuid,
		    remote_jid = coalesce(nullif($4, ''), remote_jid),
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, organizationID, conversationID, sessionID, remoteJID)
	return err
}

func (repo Repository) matchLeadByPhone(ctx context.Context, organizationID string, contactPhone *string, remoteJID string, fallbackPhone string) (string, string) {
	phoneDigits := normalizePhone(firstNonEmpty(pointerValue(contactPhone), remoteJID, fallbackPhone))
	tail := phoneDigits
	if len(tail) > 8 {
		tail = tail[len(tail)-8:]
	}
	if tail == "" {
		return "", ""
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select id::text, name, phone
		from public.leads
		where organization_id = $1::uuid
		  and phone ilike $2
		limit 10
	`, organizationID, "%"+tail+"%")
	if err != nil {
		return "", ""
	}
	defer rows.Close()

	for rows.Next() {
		var id, name string
		var phone *string
		if err := rows.Scan(&id, &name, &phone); err != nil {
			return "", ""
		}
		candidate := normalizePhone(pointerValue(phone))
		if len(candidate) > 8 {
			candidate = candidate[len(candidate)-8:]
		}
		if candidate == tail {
			return id, name
		}
	}

	return "", ""
}

func (repo Repository) userDisplayName(ctx context.Context, userID string) string {
	var name string
	_ = repo.db.Pool().QueryRow(ctx, `
		select coalesce(nullif(name, ''), email, '')
		from public.users
		where id = $1::uuid
		limit 1
	`, userID).Scan(&name)
	return name
}

func (repo Repository) insertLeadTimelineEvent(ctx context.Context, organizationID string, leadID string, userID string, messageID string, content string, mediaType string, sessionID string, instanceName string) {
	_, _ = repo.db.Pool().Exec(ctx, `
		insert into public.lead_timeline_events (
			organization_id,
			lead_id,
			event_type,
			title,
			description,
			user_id,
			actor_user_id,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			'whatsapp_message_sent',
			'Mensagem WhatsApp enviada',
			$3,
			$4::uuid,
			$4::uuid,
			$5::jsonb
		)
	`, organizationID, leadID, firstNonEmpty(content, "Midia enviada"), userID, jsonb(map[string]any{
		"message_id":    messageID,
		"content":       content,
		"media_type":    mediaType,
		"session_id":    sessionID,
		"instance_name": instanceName,
	}))
}

func (repo Repository) findConversationForLead(ctx context.Context, tenantContext tenant.Context, leadID string) (*Conversation, error) {
	if err := repo.validateLead(ctx, tenantContext.OrganizationID, leadID); err != nil {
		return nil, err
	}

	args := append(baseConversationArgs(tenantContext), leadID)
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
		  and wc.lead_id = $6::uuid
		order by wc.last_message_at desc nulls last, wc.created_at desc
		limit 1
	`, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &conversation, nil
}

func nilIfEmpty(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}

	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}

	return ""
}

func pointerValue(value *string) string {
	if value == nil {
		return ""
	}

	return *value
}
