package whatsapp

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const whatsappMediaBucket = "whatsapp-media"

func (repo Repository) SendMessage(ctx context.Context, tenantContext tenant.Context, conversationID string, input sendMessageInput) (SendMessageResponse, error) {
	expectedLeadID, err := validateExpectedLeadID(input.ExpectedLeadID)
	if err != nil {
		return SendMessageResponse{}, err
	}
	input.ExpectedLeadID = expectedLeadID

	conversation, err := repo.GetConversation(ctx, tenantContext, conversationID)
	if err != nil {
		return SendMessageResponse{}, err
	}
	if pointerValue(conversation.LeadID) != input.ExpectedLeadID {
		return SendMessageResponse{}, ErrConversationNotFound
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
	clientMessageID = stripNullBytes(clientMessageID)
	providerRequestID := deterministicProviderMessageID(clientMessageID)

	phone := whatsAppDestinationPhone(conversation.RemoteJID)
	destination := phone
	if conversation.IsGroup {
		destination = conversation.RemoteJID
	}

	storedMediaURL := input.MediaURL
	storedMediaPath := storagePathFromPublicURL(input.MediaURL, repo.storage.projectURL)
	if storedMediaURL != "" && (storedMediaPath == "" || !whatsappMediaPathBelongsToOrganization(storedMediaPath, tenantContext.OrganizationID)) {
		return SendMessageResponse{}, fmt.Errorf("%w: midia deve estar persistida no storage do Vimob antes do envio", ErrInvalidInput)
	}
	if input.Base64 != "" && storedMediaURL == "" {
		payload, decodeErr := decodeBase64Media(input.Base64)
		if decodeErr != nil {
			return SendMessageResponse{}, fmt.Errorf("%w: midia base64 invalida", ErrInvalidInput)
		}
		extension := mediaExtension(input.Mimetype)
		storedMediaPath = fmt.Sprintf("orgs/%s/sessions/%s/outgoing/%s.%s", session.OrganizationID, session.ID, providerRequestID, extension)
		if uploadErr := repo.storage.upload(ctx, whatsappMediaBucket, storedMediaPath, input.Mimetype, bytes.NewReader(payload), true); uploadErr != nil {
			return SendMessageResponse{}, fmt.Errorf("%w: nao foi possivel persistir a midia antes do envio", ErrProviderFailed)
		}
		storedMediaURL = repo.storage.publicURL(whatsappMediaBucket, storedMediaPath)
	}

	isMediaMessage := storedMediaURL != "" || input.Base64 != ""
	actualContent := input.Text
	if isMediaMessage && textLooksLikeFilename(input.Text, input.Filename) {
		actualContent = ""
	}

	mentions := mentionsFromText(input.Text)
	action := "send.text"
	body := map[string]any{
		"id":       providerRequestID,
		"number":   destination,
		"text":     input.Text,
		"mentions": mentions,
	}
	if isMediaMessage {
		action = "send.media"
		if input.MediaType == "audio" {
			action = "send.audio"
		}
		body = map[string]any{
			"id":           providerRequestID,
			"number":       destination,
			"type":         input.MediaType,
			"mediatype":    input.MediaType,
			"mediaType":    input.MediaType,
			"mimetype":     input.Mimetype,
			"fileName":     input.Filename,
			"filename":     input.Filename,
			"caption":      nilIfEmpty(actualContent),
			"mentions":     mentions,
			"mentionedJid": mentions,
		}
		// The durable worker signs mediaStoragePath immediately before provider
		// delivery. Do not spend a Storage round-trip or persist a bearer URL in
		// the request transaction.
	}
	if storedMediaPath != "" {
		body["mediaStoragePath"] = storedMediaPath
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

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return SendMessageResponse{}, err
	}
	defer tx.Rollback(ctx)

	// The canonical cross-resource order is session -> conversation -> lead.
	// Lock the read-only session fence explicitly before the physical chat; a
	// joined FOR UPDATE lets the executor choose the opposite order and can
	// deadlock with signed native ingress, which necessarily resolves a session
	// before it can identify the conversation.
	if err := lockOwnedConnectedEvolutionSession(ctx, tx, tenantContext, session.ID); err != nil {
		if errors.Is(err, ErrSessionNotFound) {
			return SendMessageResponse{}, ErrConversationNotFound
		}
		return SendMessageResponse{}, err
	}

	// Recheck the immutable binding snapshot under the conversation lock. This
	// closes the assignment/session TOCTOU window between the initial read and
	// the durable outbox commit.
	var lockedConversationID, lockedLeadID, lockedSessionID, lockedRemoteJID string
	var lockedIsGroup bool
	err = tx.QueryRow(ctx, `
		select wc.id::text, wc.lead_id::text, wc.session_id::text, wc.remote_jid, wc.is_group
		from public.whatsapp_conversations wc
		where wc.organization_id = $1::uuid
		  and wc.id = $2::uuid
		  and wc.session_id = $3::uuid
		  and wc.lead_id = $4::uuid
		  and wc.deleted_at is null
		for update of wc
	`, tenantContext.OrganizationID, conversation.ID, session.ID, input.ExpectedLeadID).Scan(
		&lockedConversationID,
		&lockedLeadID,
		&lockedSessionID,
		&lockedRemoteJID,
		&lockedIsGroup,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return SendMessageResponse{}, ErrConversationNotFound
	}
	if err != nil {
		return SendMessageResponse{}, err
	}
	visibilityArgs := append(baseConversationArgs(tenantContext), lockedLeadID)
	var lockedLeadVisible bool
	err = tx.QueryRow(ctx, `
		select true
		from public.leads as l
		where l.organization_id = $1::uuid
		  and l.id = $5::uuid
		  and `+leadVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
		for share of l
	`, visibilityArgs...).Scan(&lockedLeadVisible)
	if errors.Is(err, pgx.ErrNoRows) {
		return SendMessageResponse{}, ErrConversationNotFound
	}
	if err != nil {
		return SendMessageResponse{}, err
	}
	if lockedSessionID != session.ID || lockedRemoteJID != conversation.RemoteJID || lockedIsGroup != conversation.IsGroup {
		return SendMessageResponse{}, fmt.Errorf("%w: identidade da conversa mudou; recarregue antes de enviar", ErrInvalidReference)
	}
	conversation.LeadID = &lockedLeadID

	var messageRowID string
	err = tx.QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id,
			conversation_id,
			session_id,
			lead_id,
			sender_user_id,
			message_id,
			client_message_id,
			from_me,
			direction,
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
			'outbound',
			nullif($8, ''),
			$9,
			nullif($10, ''),
			nullif($11, ''),
			$12,
			nullif($13, ''),
			$14,
			'queued',
			now(),
			nullif($15, ''),
			$16::jsonb
		)
		on conflict (organization_id, session_id, client_message_id)
		  where client_message_id is not null
		do nothing
		returning id::text
	`, session.OrganizationID, conversation.ID, session.ID, lockedLeadID, tenantContext.UserID, providerRequestID, clientMessageID, actualContent, messageType, storedMediaURL, input.Mimetype, mediaStatus, storedMediaPath, lockedRemoteJID, senderName, jsonb(map[string]any{"delivery": "outbox"})).Scan(&messageRowID)
	if errors.Is(err, pgx.ErrNoRows) {
		var existingConversationID, existingLeadID, existingContent, existingMessageType, existingRemoteJID string
		var existingMediaURL, existingMimeType string
		if err := tx.QueryRow(ctx, `
			select
				id::text,
				conversation_id::text,
				lead_id::text,
				coalesce(content, ''),
				message_type,
				coalesce(remote_jid, ''),
				coalesce(media_url, ''),
				coalesce(media_mime_type, '')
			from public.whatsapp_messages
			where organization_id = $1::uuid
			  and session_id = $2::uuid
			  and client_message_id = $3
			limit 1
		`, session.OrganizationID, session.ID, clientMessageID).Scan(
			&messageRowID,
			&existingConversationID,
			&existingLeadID,
			&existingContent,
			&existingMessageType,
			&existingRemoteJID,
			&existingMediaURL,
			&existingMimeType,
		); err != nil {
			return SendMessageResponse{}, err
		}
		if existingConversationID != conversation.ID ||
			existingLeadID != lockedLeadID ||
			existingContent != actualContent ||
			existingMessageType != messageType ||
			existingRemoteJID != conversation.RemoteJID ||
			existingMediaURL != storedMediaURL ||
			existingMimeType != input.Mimetype {
			return SendMessageResponse{}, fmt.Errorf("%w: clientMessageId ja pertence a outra mensagem", ErrInvalidInput)
		}
		if err := tx.Commit(ctx); err != nil {
			return SendMessageResponse{}, err
		}
		wakeWhatsAppOutboxWorker()
		message, err := repo.getOutboundMessageByClientID(ctx, session.OrganizationID, session.ID, clientMessageID)
		if err != nil {
			return SendMessageResponse{}, err
		}
		return SendMessageResponse{ClientMessageID: clientMessageID, ConversationID: conversation.ID, Status: message.Status, Message: &message}, nil
	}
	if err != nil {
		return SendMessageResponse{}, err
	}

	outboxPayload := jsonb(map[string]any{"action": action, "body": body})
	if _, err := tx.Exec(ctx, `
		insert into public.whatsapp_outbox (
			organization_id, session_id, conversation_id, message_id,
			client_message_id, recipient_jid, message_type, payload, provider_message_id,
			status, next_attempt_at
		)
		values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8::jsonb, $9, 'pending', now())
		on conflict (organization_id, session_id, client_message_id) do nothing
	`, session.OrganizationID, session.ID, conversation.ID, messageRowID, clientMessageID, conversation.RemoteJID, messageType, outboxPayload, providerRequestID); err != nil {
		return SendMessageResponse{}, err
	}

	if !isAIClientMessageID(clientMessageID) {
		pausedAt := time.Now().UTC()
		if _, err := tx.Exec(ctx, `
			insert into public.conversation_ai_state (
				organization_id, conversation_id, memory, human_override,
				paused_until, updated_at
			)
			values ($1::uuid, $2::uuid, $3::jsonb, false, $4::timestamptz, now())
			on conflict (organization_id, conversation_id)
			do update set
				memory = coalesce(public.conversation_ai_state.memory, '{}'::jsonb) || excluded.memory,
				paused_until = greatest(coalesce(public.conversation_ai_state.paused_until, now()), excluded.paused_until),
				updated_at = now()
		`, session.OrganizationID, conversation.ID, jsonb(map[string]any{
			"last_human_takeover_reason": "human_message_sent",
			"last_human_takeover_at":     pausedAt.Format(time.RFC3339),
		}), pausedAt.Add(aiHumanPauseDuration)); err != nil {
			return SendMessageResponse{}, err
		}
	}

	_, err = tx.Exec(ctx, `
		update public.whatsapp_conversations
		set last_message = $3,
		    last_message_at = now(),
		    unread_count = 0,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and session_id = $4::uuid
		  and lead_id = $5::uuid
	`, session.OrganizationID, conversation.ID, outgoingLastMessage(messageType, actualContent, senderName, conversation.IsGroup), session.ID, lockedLeadID)
	if err != nil {
		return SendMessageResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return SendMessageResponse{}, err
	}
	wakeWhatsAppOutboxWorker()

	message, err := repo.getOutboundMessageByClientID(ctx, session.OrganizationID, session.ID, clientMessageID)
	if err != nil {
		return SendMessageResponse{}, err
	}

	return SendMessageResponse{
		ClientMessageID: clientMessageID,
		ConversationID:  conversation.ID,
		Status:          message.Status,
		Message:         &message,
	}, nil
}

func (repo Repository) MarkAsSeenOnWhatsApp(ctx context.Context, tenantContext tenant.Context, conversationID string, expectedLeadID string) error {
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return ErrConversationNotFound
	}
	expectedLeadID, err := validateExpectedConversationLeadSnapshot(expectedLeadID)
	if err != nil {
		return err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	sessionID, err := discoverConversationSessionID(ctx, tx, tenantContext.OrganizationID, conversationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrConversationNotFound
	}
	if err != nil {
		return err
	}
	if err := lockOwnedConnectedEvolutionSession(ctx, tx, tenantContext, sessionID); err != nil {
		if errors.Is(err, ErrSessionNotFound) {
			return ErrConversationNotFound
		}
		return err
	}

	args := append(baseConversationArgs(tenantContext), conversationID, sessionID)
	var lockedConversationID, lockedSessionID, remoteJID string
	lockSQL := `
		select wc.id::text, wc.session_id::text, wc.remote_jid
		from public.whatsapp_conversations wc
		where wc.organization_id = $1::uuid
		  and wc.id = $5::uuid
		  and wc.session_id = $6::uuid
		  and wc.deleted_at is null
	`
	if expectedLeadID == unlinkedConversationLeadSnapshot {
		lockSQL += `
		  and wc.lead_id is null
		for update of wc
		`
	} else {
		args = append(args, expectedLeadID)
		lockSQL += fmt.Sprintf(`
		  and wc.lead_id = $%d::uuid
		  and exists (
			select 1
			from public.leads l
			where l.id = wc.lead_id
			  and l.organization_id = wc.organization_id
			  and %s
		  )
		for update of wc
		`, len(args), leadVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext)))
	}
	err = tx.QueryRow(ctx, lockSQL, args...).Scan(&lockedConversationID, &lockedSessionID, &remoteJID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrConversationNotFound
	}
	if err != nil {
		return err
	}

	messageLeadPredicate := "lead_id is null"
	messageArgs := []any{tenantContext.OrganizationID, lockedConversationID, lockedSessionID}
	if expectedLeadID != unlinkedConversationLeadSnapshot {
		messageArgs = append(messageArgs, expectedLeadID)
		messageLeadPredicate = fmt.Sprintf("lead_id = $%d::uuid", len(messageArgs))
	}
	rows, err := tx.Query(ctx, `
		select message_id
		from public.whatsapp_messages
		where organization_id = $1::uuid
		  and conversation_id = $2::uuid
		  and session_id = $3::uuid
		  and `+messageLeadPredicate+`
		  and from_me = false
		order by coalesce(sent_at, created_at) desc
		limit 20
	`, messageArgs...)
	if err != nil {
		return err
	}

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
		rows.Close()
		return err
	}
	rows.Close()

	// Release the conversation/session locks before provider I/O. The message
	// IDs were selected from the exact immutable binding snapshot; a later
	// rebind does not make those provider receipts belong to the new card.
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	_, err = repo.functions.invokeEvolution(ctx, "message.markread", map[string]any{
		"session_id": sessionID,
		"body": map[string]any{
			"allowWhatsAppReadReceipt": true,
			"jid":                      remoteJID,
			"messageIds":               messageIDs,
		},
	})
	if err != nil {
		return err
	}
	return nil
}

func (repo Repository) RetryMediaDownload(ctx context.Context, tenantContext tenant.Context, messageID string) (map[string]any, error) {
	return repo.retryStoredMediaDownload(ctx, tenantContext, messageID)
}

func (repo Repository) GetHistoryAccess(ctx context.Context, tenantContext tenant.Context, filter HistoryAccessFilter) (HistoryAccessResponse, error) {
	if filter.LeadID != "" {
		return repo.getLeadHistoryAccess(ctx, tenantContext, filter)
	}

	conversationID := filter.ConversationID
	conversation, err := repo.GetConversation(ctx, tenantContext, conversationID)
	if err != nil {
		return HistoryAccessResponse{}, err
	}

	messageFilter := filter.MessageFilter
	if messageFilter.Limit == 0 {
		messageFilter.Limit = 50
	}
	page, err := repo.ListMessages(ctx, tenantContext, conversation.ID, messageFilter)
	if err != nil {
		return HistoryAccessResponse{}, err
	}

	return HistoryAccessResponse{
		Conversation: &conversation,
		Messages:     page.Messages,
		NextCursor:   page.NextCursor,
	}, nil
}

func (repo Repository) getLeadHistoryAccess(ctx context.Context, tenantContext tenant.Context, filter HistoryAccessFilter) (HistoryAccessResponse, error) {
	leadID, ok := normalizeUUID(filter.LeadID)
	if !ok {
		return HistoryAccessResponse{}, ErrInvalidReference
	}
	if err := repo.ensureCanViewLead(ctx, tenantContext, leadID); err != nil {
		return HistoryAccessResponse{}, err
	}

	messageFilter := filter.MessageFilter
	if messageFilter.Limit == 0 {
		messageFilter.Limit = 50
	}

	conversations := []Conversation{}
	if messageFilter.CursorAt == nil {
		var err error
		conversations, err = repo.listLeadHistoryConversations(ctx, tenantContext, leadID, filter.ConversationID)
		if err != nil {
			return HistoryAccessResponse{}, err
		}
		for index := range conversations {
			_, currentErr := repo.GetConversationForExpectedLead(ctx, tenantContext, conversations[index].ID, leadID)
			switch {
			case currentErr == nil:
				conversations[index].HistoricalLeadView = false
			case errors.Is(currentErr, ErrConversationNotFound):
				conversations[index].HistoricalLeadView = true
			default:
				return HistoryAccessResponse{}, currentErr
			}
		}
	}

	page, err := repo.listLeadHistoryMessages(ctx, tenantContext, leadID, filter.ConversationID, messageFilter)
	if err != nil {
		return HistoryAccessResponse{}, err
	}

	var conversation *Conversation
	if len(conversations) > 0 {
		conversation = &conversations[0]
	}

	return HistoryAccessResponse{
		Conversation:  conversation,
		Conversations: conversations,
		Messages:      page.Messages,
		NextCursor:    page.NextCursor,
	}, nil
}

func (repo Repository) listLeadHistoryConversations(ctx context.Context, tenantContext tenant.Context, leadID string, conversationID string) ([]Conversation, error) {
	args := append(baseConversationArgs(tenantContext), leadID)
	conversationWhere := ""
	if strings.TrimSpace(conversationID) != "" {
		var ok bool
		conversationID, ok = normalizeUUID(conversationID)
		if !ok {
			return nil, ErrInvalidReference
		}
		args = append(args, conversationID)
		conversationWhere = fmt.Sprintf("and wc.id = $%d::uuid", len(args))
	}
	rows, err := repo.db.Pool().Query(ctx, `
		select `+leadHistoryConversationSelectFields()+`
		from public.whatsapp_conversations wc
		left join lateral (
		  select
		    wm.remote_jid,
		    coalesce(nullif(wm.content, ''), case wm.message_type
		      when 'image' then '[Imagem]'
		      when 'video' then '[Video]'
		      when 'audio' then '[Audio]'
		      when 'document' then '[Documento]'
		      when 'sticker' then '[Figurinha]'
		      else '[Mensagem]'
		    end) as preview,
		    coalesce(wm.sent_at, wm.created_at) as message_at,
		    min(coalesce(wm.sent_at, wm.created_at)) over () as first_at
		  from public.whatsapp_messages wm
		  where wm.organization_id = $1::uuid
		    and wm.conversation_id = wc.id
		    and `+leadHistoryMessageLeadMatchSQL()+`
		  order by coalesce(wm.sent_at, wm.created_at) desc, wm.id desc
		  limit 1
		) history on true
		left join public.whatsapp_sessions ws
		  on ws.id = wc.session_id
		 and ws.organization_id = wc.organization_id
		left join public.leads l
		  on l.id = $5::uuid
		 and l.organization_id = wc.organization_id
		left join public.pipelines pipeline on pipeline.id = l.pipeline_id
		left join public.stages stage on stage.id = l.stage_id
		where wc.organization_id = $1::uuid
		  and `+leadHistoryVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
		  `+conversationWhere+`
		  and (
		    wc.lead_id = $5::uuid
		    or exists (
		      select 1
		      from public.whatsapp_conversation_lead_bindings binding_history
		      where binding_history.organization_id = wc.organization_id
		        and binding_history.conversation_id = wc.id
		        and binding_history.lead_id = $5::uuid
		    )
		    or exists (
		      select 1
		      from public.whatsapp_messages wm
		      where wm.organization_id = $1::uuid
		        and wm.conversation_id = wc.id
		        and wm.lead_id = $5::uuid
		    )
		  )
		order by history.message_at desc nulls last, wc.created_at desc
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

func (repo Repository) listLeadHistoryMessages(ctx context.Context, tenantContext tenant.Context, leadID string, conversationID string, filter MessageFilter) (MessagePage, error) {
	queryLimit := filter.Limit + 1
	args := append(baseConversationArgs(tenantContext), leadID, queryLimit)
	where := []string{
		"wm.organization_id = $1::uuid",
		"wc.organization_id = $1::uuid",
		leadHistoryVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext)),
		leadHistoryMessageLeadMatchSQL(),
	}
	if strings.TrimSpace(conversationID) != "" {
		var ok bool
		conversationID, ok = normalizeUUID(conversationID)
		if !ok {
			return MessagePage{}, ErrInvalidReference
		}
		args = append(args, conversationID)
		where = append(where, fmt.Sprintf("wc.id = $%d::uuid", len(args)))
	}
	if filter.CursorAt != nil {
		args = append(args, *filter.CursorAt)
		cursorAtArg := len(args)
		if filter.CursorID != "" {
			args = append(args, filter.CursorID)
			where = append(where, fmt.Sprintf(
				"(coalesce(wm.sent_at, wm.created_at), wm.id) < ($%d::timestamptz, $%d::uuid)",
				cursorAtArg,
				len(args),
			))
		} else {
			where = append(where, fmt.Sprintf(
				"coalesce(wm.sent_at, wm.created_at) < $%d::timestamptz",
				cursorAtArg,
			))
		}
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select `+messageSelectFieldsWithSession("historical_ws.id")+`
		from public.whatsapp_messages wm
		join public.whatsapp_conversations wc on wc.id = wm.conversation_id
		left join public.whatsapp_sessions historical_ws
		  on historical_ws.id = wm.session_id
		 and historical_ws.organization_id = wm.organization_id
		left join public.leads l
		  on l.id = $5::uuid
		 and l.organization_id = wc.organization_id
		where `+strings.Join(where, " and ")+`
		order by coalesce(wm.sent_at, wm.created_at) desc, wm.id desc
		limit $6::integer
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

	var nextCursor *string
	if len(descMessages) > filter.Limit {
		descMessages = descMessages[:filter.Limit]
		oldest := descMessages[len(descMessages)-1]
		value := oldest.SentAt.UTC().Format(time.RFC3339Nano) + "|" + oldest.ID
		nextCursor = &value
	}

	messages := make([]Message, 0, len(descMessages))
	for index := len(descMessages) - 1; index >= 0; index-- {
		messages = append(messages, descMessages[index])
	}
	if err := repo.hydrateMessageMediaURLs(ctx, tenantContext.OrganizationID, messages); err != nil {
		return MessagePage{}, err
	}

	return MessagePage{Messages: messages, NextCursor: nextCursor}, nil
}

func (repo Repository) resolveSendSession(ctx context.Context, tenantContext tenant.Context, conversation Conversation, preferredSessionID string) (Session, error) {
	conversationSessionID := strings.TrimSpace(conversation.SessionID)
	if conversationSessionID == "" {
		return Session{}, fmt.Errorf("%w: conversa sem conexao WhatsApp fixa", ErrInvalidReference)
	}
	if preferredSessionID = strings.TrimSpace(preferredSessionID); preferredSessionID != "" {
		preferredSessionID, ok := normalizeUUID(preferredSessionID)
		if !ok {
			return Session{}, ErrSessionNotFound
		}
		if preferredSessionID != conversationSessionID {
			return Session{}, fmt.Errorf("%w: inicie uma nova conversa na conexao WhatsApp selecionada", ErrInvalidInput)
		}
	}

	session, err := repo.getCanSendSession(ctx, tenantContext, conversationSessionID)
	if err != nil {
		return Session{}, err
	}
	if session.Status != "connected" {
		return Session{}, fmt.Errorf("%w: WhatsApp desta conversa esta desconectado.", ErrInvalidInput)
	}
	return session, nil
}

func (repo Repository) resolveAnyConnectedSendSession(ctx context.Context, tenantContext tenant.Context, purpose string) (Session, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select `+sessionSelectFields()+`
		from public.whatsapp_sessions ws
		left join public.users owner on owner.id = ws.owner_user_id
		where ws.organization_id = $1::uuid
		  and ws.is_active is not false
		  and ws.status = 'connected'
		  and coalesce(ws.provider, 'evolution') = 'evolution_go'
		  and ws.owner_user_id = $2::uuid
		order by ws.last_connected_at desc nulls last, ws.created_at desc
		limit 2
	`, tenantContext.OrganizationID, tenantContext.UserID)
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
		return Session{}, fmt.Errorf("%w: Selecione qual WhatsApp deseja usar para %s.", ErrInvalidInput, purpose)
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
		  and coalesce(ws.status, '') <> 'deleted'
		  and coalesce(ws.provider, 'evolution') = 'evolution_go'
		  and ws.owner_user_id = $3::uuid
		limit 1
	`, tenantContext.OrganizationID, sessionID, tenantContext.UserID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrSessionNotFound
	}
	if err != nil {
		return Session{}, err
	}

	return session, nil
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
	if err := repo.ensureCanViewLead(ctx, tenantContext, leadID); err != nil {
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
		  and `+conversationVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
		  and wc.lead_id = $5::uuid
		order by wc.last_message_at desc nulls last, wc.created_at desc
		limit 1
	`, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		conversations, historyErr := repo.listLeadHistoryConversations(ctx, tenantContext, leadID, "")
		if historyErr != nil {
			return nil, historyErr
		}
		if len(conversations) == 0 {
			return nil, nil
		}
		conversation = conversations[0]
		conversation.HistoricalLeadView = true
		return &conversation, nil
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
