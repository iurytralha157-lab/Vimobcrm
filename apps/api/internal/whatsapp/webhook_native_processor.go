package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	webhookProcessorEdge           = "edge"
	webhookProcessorNative         = "native"
	webhookProcessorNativeFallback = "native_fallback"
	nativeProviderMessageMaxBytes  = 1 << 20
)

type nativeEvolutionSession struct {
	ID               string
	OrganizationID   string
	PhoneNumber      string
	ProfileName      string
	OwnerUserID      string
	CreatedBy        string
	AdvancedSettings map[string]any
}

type nativeEvolutionConversation struct {
	ID        string
	LeadID    string
	RemoteJID string
	LeadIsNew bool
}

type nativeEvolutionLead struct {
	ID             string
	AssignedUserID string
	Name           string
	IsNew          bool
}

const nativeLegacyNonManagedRecoveryQuery = `
	select
	  message.id::text,
	  message.conversation_id::text,
	  coalesce(message.lead_id::text, ''),
	  coalesce(conversation.lead_id::text, ''),
	  conversation.remote_jid,
	  coalesce(message.provider_message_id, message.message_id, ''),
	  coalesce(message.content, ''),
	  coalesce(message.message_type, 'text'),
	  coalesce(message.sent_at, message.received_at, message.created_at),
	  coalesce(message.metadata, '{}'::jsonb)::text,
	  coalesce(lead.metadata, '{}'::jsonb)::text
	from public.whatsapp_messages as message
	join public.whatsapp_conversations as conversation
	  on conversation.organization_id = message.organization_id
	 and conversation.session_id = message.session_id
	 and conversation.id = message.conversation_id
	left join public.leads as lead
	  on lead.organization_id = message.organization_id
	 and lead.id = message.lead_id
	where message.organization_id = $1::uuid
	  and message.session_id = $2::uuid
	  and (
	    message.provider_message_id = $3
	    or (message.provider_message_id is null and message.message_id = $3)
	  )
	  and coalesce(message.from_me, false) = false
	  and lower(coalesce(message.direction, 'inbound')) <> 'outbound'
	order by message.created_at, message.id
	limit 1
	for update of message, conversation
`

const nativeLegacyNonManagedConversationRecoveryQuery = `
	update public.whatsapp_conversations as conversation
	set last_message = $5,
	    last_message_preview = $5,
	    last_message_at = $4::timestamptz,
	    unread_count = greatest(0, coalesce(conversation.unread_count, 0) + 1),
	    updated_at = now()
	where conversation.organization_id = $1::uuid
	  and conversation.session_id = $2::uuid
	  and conversation.id = $3::uuid
	  and (conversation.last_message_at is null or conversation.last_message_at < $4::timestamptz)
`

var errNativeWebhookMessageLikeUnsupported = errors.New("native WhatsApp processor rejected an unsupported message-like event")
var errNativeEvolutionLeadPhoneAmbiguous = errors.New("native WhatsApp lead phone matches multiple leads")

func normalizeEvolutionWebhookProcessorMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case webhookProcessorNative:
		return webhookProcessorNative
	case webhookProcessorNativeFallback, "native-fallback", "hybrid":
		return webhookProcessorNativeFallback
	default:
		// Production remains on the existing Edge processor until the operator
		// explicitly enables a session-safe backend cutover.
		return webhookProcessorEdge
	}
}

func (repo Repository) dispatchEvolutionWebhook(ctx context.Context, item pendingEvolutionWebhook) error {
	mode := evolutionWebhookProcessorModeForSession(
		repo.functions.webhookProcessorMode,
		repo.functions.webhookRolloutSessionIDs,
		item.SessionID,
	)
	if mode == webhookProcessorEdge {
		return repo.forwardEvolutionWebhook(ctx, item)
	}

	handled, err := repo.processEvolutionWebhookNative(ctx, item)
	if err != nil {
		return err
	}
	if handled {
		return nil
	}
	if mode == webhookProcessorNativeFallback {
		// Never hand an unrecognized message, reaction, receipt or campaign
		// referral to the legacy Edge implementation. A version-skewed Edge
		// could create a lead or persist a message under weaker rules. Keeping
		// the item in the durable inbox makes it retry and eventually enter the
		// DLQ without crossing that trust boundary.
		if nativeFallbackRequiresNativeHandling(item) {
			return errNativeWebhookMessageLikeUnsupported
		}
		return repo.forwardEvolutionWebhook(ctx, item)
	}
	return errors.New("native WhatsApp processor does not support this event")
}

func nativeFallbackRequiresNativeHandling(item pendingEvolutionWebhook) bool {
	payload, err := decodeNativeEvolutionPayload(item.Payload)
	if err != nil {
		return true
	}
	event := nativeEvolutionEventName(payload, item.EventType)
	compactEvent := strings.NewReplacer(".", "", "_", "", "-", "", " ", "").Replace(strings.ToLower(event))
	for _, marker := range []string{"message", "reaction", "receipt", "ack", "referral", "campaign", "ctwa", "externalad"} {
		if strings.Contains(compactEvent, marker) {
			return true
		}
	}
	if nativeIsStatusEvent(event) &&
		!strings.Contains(compactEvent, "connection") &&
		!strings.Contains(compactEvent, "instance") &&
		!strings.Contains(compactEvent, "session") {
		return true
	}
	if len(extractNativeEvolutionMessages(payload)) > 0 ||
		len(extractNativeEvolutionStatuses(payload)) > 0 ||
		nativeHasCampaignSignal(payload) ||
		len(nativeCampaignReferral(payload)) > 0 {
		return true
	}
	return nativePayloadContainsMessageLikeKey(payload, 0)
}

func nativePayloadContainsMessageLikeKey(value any, depth int) bool {
	if depth > 12 || value == nil {
		return false
	}
	switch typed := value.(type) {
	case map[string]any:
		for key, nested := range typed {
			normalized := strings.NewReplacer("_", "", "-", "", ".", "", " ", "").Replace(strings.ToLower(key))
			for _, marker := range []string{"message", "reaction", "receipt", "referral", "campaign", "ctwa", "externaladreply"} {
				if strings.Contains(normalized, marker) {
					return true
				}
			}
			if nativePayloadContainsMessageLikeKey(nested, depth+1) {
				return true
			}
		}
	case []any:
		for _, nested := range typed {
			if nativePayloadContainsMessageLikeKey(nested, depth+1) {
				return true
			}
		}
	}
	return false
}

func evolutionWebhookProcessorModeForSession(configuredMode string, allowlist []string, sessionID string) string {
	if !webhookRolloutAllowsSession(allowlist, sessionID) {
		return webhookProcessorEdge
	}
	return normalizeEvolutionWebhookProcessorMode(configuredMode)
}

func (repo Repository) processEvolutionWebhookNative(ctx context.Context, item pendingEvolutionWebhook) (bool, error) {
	if strings.TrimSpace(item.OrganizationID) == "" || strings.TrimSpace(item.SessionID) == "" {
		return false, fmt.Errorf("native webhook requires organization and session scope")
	}
	payload, err := decodeNativeEvolutionPayload(item.Payload)
	if err != nil {
		return false, err
	}
	event := nativeEvolutionEventName(payload, item.EventType)

	if nativeIsStatusEvent(event) {
		statuses := extractNativeEvolutionStatuses(payload)
		if len(statuses) == 0 {
			return false, nil
		}
		return true, repo.processNativeEvolutionStatuses(ctx, item, statuses)
	}

	messages := extractNativeEvolutionMessages(payload)
	if len(messages) > 0 {
		for _, message := range messages {
			// Unsupported protocol shapes remain in the durable inbox and can
			// never fall back to Edge. Campaign referrals supported by the native
			// parser continue below under the strict Meta-only creation rules.
			if message.UnsupportedMessage {
				return false, nil
			}
			if message.IsReaction && message.ReactionTargetID == "" {
				return false, nil
			}
			if !message.IsReaction && !message.IsDeletion && !nativeIsMediaType(message.MessageType) && strings.TrimSpace(message.Content) == "" {
				return false, nil
			}
		}
		// Persist the conversation, canonical message and media job without any
		// provider I/O. The separately leased media worker applies type/size policy
		// and performs at most one download globally.
		if err := repo.processNativeEvolutionMessages(ctx, item, messages); err != nil {
			return true, err
		}
		return true, nil
	}

	qrCode := ""
	if strings.Contains(event, "qr") {
		qrCode = nativeEvolutionQRCode(payload)
	}
	connectionStatus, connectionRecognized, connectionError := nativeEvolutionConnectionStatus(payload, event)
	if qrCode == "" && !connectionRecognized {
		return false, nil
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return true, err
	}
	defer tx.Rollback(ctx)
	session, err := loadNativeEvolutionSession(ctx, tx, item)
	if err != nil {
		return true, err
	}
	lifecycleUpdatesAllowed := sessionAutoReconnectEnabled(session.AdvancedSettings)
	if qrCode != "" && lifecycleUpdatesAllowed {
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_sessions
			set status = 'qr_ready',
			    qr_code = $3,
			    advanced_settings = coalesce(advanced_settings, '{}'::jsonb) || jsonb_build_object(
			      'qr_code', $3,
			      'qr_updated_at', now()
			    ),
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and provider = 'evolution_go'
			  and coalesce(is_active, true) = true
			  and coalesce(status, '') not in ('deleted', 'disabled')
			  and lower(coalesce(advanced_settings->>'auto_reconnect_enabled', 'true')) <> 'false'
		`, session.OrganizationID, session.ID, qrCode); err != nil {
			return true, err
		}
	}
	if connectionRecognized && lifecycleUpdatesAllowed {
		data := nativeFirstMap(payload, "data", "Data")
		jid := firstNonEmpty(
			firstString(data, "jid", "JID", "phone", "Phone", "user.id"),
			firstString(payload, "jid", "JID", "phone", "Phone", "user.id"),
		)
		phoneNumber := ""
		if phone, ok := phoneFromIdentityValue(jid); ok {
			phoneNumber = phone
		}
		profileName := firstNonEmpty(
			firstString(data, "pushName", "name", "profileName"),
			firstString(payload, "pushName", "name", "profileName"),
			session.ProfileName,
		)
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_sessions
			set status = coalesce(nullif($3, ''), status),
			    phone_number = case when $3 = 'connected' then coalesce(nullif($4, ''), phone_number) else phone_number end,
			    profile_name = case when $3 = 'connected' then coalesce(nullif($5, ''), profile_name) else profile_name end,
			    last_connected_at = case when $3 = 'connected' then now() else last_connected_at end,
			    last_error = nullif($6, ''),
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and provider = 'evolution_go'
			  and coalesce(is_active, true) = true
			  and coalesce(status, '') not in ('deleted', 'disabled')
			  and lower(coalesce(advanced_settings->>'auto_reconnect_enabled', 'true')) <> 'false'
		`, session.OrganizationID, session.ID, connectionStatus, phoneNumber, profileName, connectionError); err != nil {
			return true, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return true, err
	}
	return true, nil
}

func (repo Repository) downloadNativeEvolutionMedia(ctx context.Context, item pendingEvolutionWebhook, message nativeEvolutionMessage) (recoveredWhatsAppMedia, error) {
	providerMessage, err := nativeEvolutionProviderMessage(message)
	if err != nil {
		return recoveredWhatsAppMedia{}, err
	}
	body := map[string]any{
		"message":   providerMessage,
		"messageId": message.ProviderMessageID,
	}
	payload := map[string]any{
		"session_id":      item.SessionID,
		"organization_id": item.OrganizationID,
		"body":            body,
	}

	response, err := repo.functions.invokeEvolutionDirect(ctx, "message.downloadMedia", payload)
	if err != nil {
		return recoveredWhatsAppMedia{}, err
	}
	status := nativeEvolutionResponseStatus(response)
	if !nativeEvolutionResponseOK(response) && (status == 404 || status == 405) {
		response, err = repo.functions.invokeEvolutionDirect(ctx, "message.downloadImage", payload)
		if err != nil {
			return recoveredWhatsAppMedia{}, err
		}
	}
	if !nativeEvolutionResponseOK(response) {
		return recoveredWhatsAppMedia{}, nativeEvolutionMediaRejection(nativeEvolutionResponseStatus(response))
	}

	encoded := firstString(response,
		"data.data.base64",
		"data.base64",
		"base64",
		"data.data.data.base64",
	)
	if encoded == "" {
		return recoveredWhatsAppMedia{}, fmt.Errorf("%w: Evolution Go media recovery returned no bytes", ErrProviderFailed)
	}
	contentType := nativeDataURLMimeType(encoded)
	decoded, err := decodeFlexibleBase64Media(encoded)
	if err != nil {
		return recoveredWhatsAppMedia{}, err
	}
	if len(decoded) == 0 {
		return recoveredWhatsAppMedia{}, fmt.Errorf("%w: Evolution Go media recovery returned an empty file", ErrProviderFailed)
	}
	if len(decoded) > whatsappMediaMaxBytes {
		return recoveredWhatsAppMedia{}, fmt.Errorf("%w: arquivo acima do limite de 25MB", ErrInvalidInput)
	}

	return recoveredWhatsAppMedia{
		bytes:       decoded,
		contentType: firstNonEmpty(contentType, message.MediaMimeType, detectWhatsAppMediaMimeType(decoded), fallbackWhatsAppMediaMimeType(message.MessageType)),
		source:      "evolution_go_download",
	}, nil
}

func nativeEvolutionMediaRejection(status int64) error {
	if status == http.StatusRequestEntityTooLarge {
		return fmt.Errorf(
			"%w: %w: Evolution Go rejected media above the configured size",
			ErrProviderFailed,
			errWhatsAppMediaTooLarge,
		)
	}
	return fmt.Errorf("%w: Evolution Go media recovery failed with status %d", ErrProviderFailed, status)
}

func nativeEvolutionProviderMessage(message nativeEvolutionMessage) (map[string]any, error) {
	node := nativeFirstMap(message.Raw, "message", "Message")
	if len(node) == 0 {
		node = message.Raw
	}
	blockNames := map[string]string{
		"imagemessage":    "imageMessage",
		"videomessage":    "videoMessage",
		"audiomessage":    "audioMessage",
		"documentmessage": "documentMessage",
		"stickermessage":  "stickerMessage",
	}
	providerMessage := map[string]any{}
	for key, value := range node {
		canonical, allowed := blockNames[strings.ToLower(strings.TrimSpace(key))]
		if !allowed {
			continue
		}
		block, ok := nativeSanitizeProviderValue(value, 0)
		if !ok {
			return nil, fmt.Errorf("%w: Evolution Go media message is invalid", ErrProviderFailed)
		}
		providerMessage[canonical] = block
		break
	}
	if len(providerMessage) == 0 {
		return nil, fmt.Errorf("%w: Evolution Go media block was not found", ErrProviderFailed)
	}
	raw, err := json.Marshal(providerMessage)
	if err != nil || len(raw) > nativeProviderMessageMaxBytes {
		return nil, fmt.Errorf("%w: Evolution Go media message exceeds the recovery limit", ErrProviderFailed)
	}
	return providerMessage, nil
}

func nativeSanitizeProviderValue(value any, depth int) (any, bool) {
	if depth > 10 {
		return nil, false
	}
	switch typed := value.(type) {
	case nil, bool, float64, int, int64:
		return typed, true
	case string:
		if len(typed) > nativeProviderMessageMaxBytes {
			return nil, false
		}
		return stripNullBytes(typed), true
	case map[string]any:
		if len(typed) > 256 {
			return nil, false
		}
		out := make(map[string]any, len(typed))
		for key, item := range typed {
			key = strings.TrimSpace(stripNullBytes(key))
			if key == "" || len(key) > 128 {
				return nil, false
			}
			clean, ok := nativeSanitizeProviderValue(item, depth+1)
			if !ok {
				return nil, false
			}
			out[key] = clean
		}
		return out, true
	case []any:
		if len(typed) > 256 {
			return nil, false
		}
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			clean, ok := nativeSanitizeProviderValue(item, depth+1)
			if !ok {
				return nil, false
			}
			out = append(out, clean)
		}
		return out, true
	default:
		return nil, false
	}
}

func nativeEvolutionResponseOK(response map[string]any) bool {
	value, _ := nativeBool(response["ok"])
	return value
}

func nativeEvolutionResponseStatus(response map[string]any) int64 {
	return nativeInt64(response["status"])
}

func nativeDataURLMimeType(value string) string {
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(strings.ToLower(value), "data:") {
		return ""
	}
	header, _, found := strings.Cut(value, ",")
	if !found {
		return ""
	}
	header = header[len("data:"):]
	mimeType, _, _ := strings.Cut(header, ";")
	if !strings.Contains(mimeType, "/") {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(mimeType))
}

func (repo Repository) processNativeEvolutionMessages(ctx context.Context, item pendingEvolutionWebhook, messages []nativeEvolutionMessage) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for _, message := range messages {
		if nativeIsMediaType(message.MessageType) {
			if err := lockWhatsAppMediaMutation(ctx, tx); err != nil {
				return err
			}
			break
		}
	}
	session, err := loadNativeEvolutionSession(ctx, tx, item)
	if err != nil {
		return err
	}

	autoReplyInputs := []autoReplyInput{}
	mediaQueued := false
	for _, message := range messages {
		if message.FromMe {
			// Some provider status endpoints expose the profile name in the field
			// historically treated as a phone. A signed outbound webhook is a
			// stronger source for the account JID and repairs that legacy value so
			// outbound reactions have a canonical actor identity.
			if phoneNumber, ok := phoneFromIdentityValue(message.SenderJID); ok && phoneNumber != session.PhoneNumber {
				if _, err := tx.Exec(ctx, `
					update public.whatsapp_sessions
					set phone_number = $3, updated_at = now()
					where organization_id = $1::uuid and id = $2::uuid
					  and provider = 'evolution_go'
				`, session.OrganizationID, session.ID, phoneNumber); err != nil {
					return err
				}
				session.PhoneNumber = phoneNumber
			}
		}
		if message.IsDeletion {
			if err := processNativeEvolutionDeletion(ctx, tx, session, message); err != nil {
				return err
			}
			continue
		}
		if message.IsReaction {
			if err := processNativeEvolutionReaction(ctx, tx, session, message); err != nil {
				return err
			}
			continue
		}
		if nativeIsMediaType(message.MessageType) && message.MediaStoragePath == "" {
			policy := automaticWhatsAppMediaPolicy(message.MessageType, message.MediaMimeType, message.MediaSize)
			if policy.automatic {
				message.MediaStatus = "pending"
				message.MediaError = ""
			} else {
				message.MediaStatus = "failed"
				message.MediaError = policy.errorCode
			}
		}

		if _, err := tx.Exec(ctx, `
			select pg_advisory_xact_lock(hashtextextended($1, 0))
		`, "whatsapp-native:"+session.OrganizationID+":"+firstNonEmpty(message.ContactPhone, message.ProviderMessageID)); err != nil {
			return err
		}
		rule, err := findNativeInboundRule(ctx, tx, session, message)
		if err != nil {
			return err
		}
		if nativeManagedProviderEventAlreadyHandled(rule) {
			if err := reconcileNativeHandledMessageTransport(ctx, tx, session, message); err != nil {
				return err
			}
			if rule.LegacyNonManagedRetry {
				if err := recoverNativeLegacyNonManagedRetry(ctx, tx, session, message, rule); err != nil {
					return err
				}
			} else if message.IsCTWAAd {
				// Edge may have committed the managed ledger before a transient
				// attribution failure. A native retry repairs that metadata, while
				// tolerating older handled rows that predate attribution support.
				if err := enrichNativeManagedWhatsAppLeadEntryAttribution(
					ctx,
					tx,
					session,
					rule.ManagedProviderEventLeadID,
					message,
					true,
				); err != nil {
					return err
				}
			}
			if boolFromObject(session.AdvancedSettings, "ai_auto_reply_enabled") {
				recoveredInput, ok, err := recoverNativeHandledAutoReplyInput(
					ctx,
					tx,
					session,
					message.ProviderMessageID,
					rule.ManagedProviderEventLeadID,
				)
				if err != nil {
					return err
				}
				if ok {
					autoReplyInputs = append(autoReplyInputs, recoveredInput)
				}
			}
			continue
		}
		conversation, err := ensureNativeEvolutionConversation(ctx, tx, session, message, rule)
		if err != nil {
			return err
		}
		inserted, effectiveConversationID, messageRowID, err := insertNativeEvolutionMessage(ctx, tx, session, conversation, message)
		if err != nil {
			return err
		}
		queued, err := enqueueNativeEvolutionMediaJob(ctx, tx, session, effectiveConversationID, message, messageRowID)
		if err != nil {
			return err
		}
		mediaQueued = mediaQueued || queued
		if message.FromMe {
			if err := reconcileNativeOutboundOutbox(ctx, tx, session, message, messageRowID); err != nil {
				return err
			}
		}
		if inserted && effectiveConversationID == conversation.ID {
			if err := updateNativeEvolutionConversation(ctx, tx, session, conversation, message); err != nil {
				return err
			}
		}
		if !message.FromMe && !message.IsGroup {
			applyInboundEffects := inserted || rule.ManagedProviderEventPending
			if applyInboundEffects {
				if err := applyNativeInboundBusinessEffects(ctx, tx, session, conversation, message, messageRowID, rule); err != nil {
					return err
				}
			}
			if applyInboundEffects && conversation.LeadID != "" && boolFromObject(session.AdvancedSettings, "ai_auto_reply_enabled") && strings.TrimSpace(message.Content) != "" {
				autoReplyInputs = append(autoReplyInputs, autoReplyInput{
					OrganizationID: session.OrganizationID,
					SessionID:      session.ID,
					ConversationID: conversation.ID,
					MessageID:      messageRowID,
					Text:           message.Content,
				})
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if mediaQueued {
		wakeWhatsAppMediaWorker()
	}
	for _, input := range autoReplyInputs {
		if _, err := repo.enqueueAutoReplyJob(ctx, input); err != nil {
			return err
		}
	}
	return nil
}

func recoverNativeLegacyNonManagedRetry(
	ctx context.Context,
	tx pgx.Tx,
	session nativeEvolutionSession,
	incoming nativeEvolutionMessage,
	rule nativeInboundRule,
) error {
	var messageRowID string
	var conversationID string
	var messageLeadID string
	var conversationLeadID string
	var remoteJID string
	var providerMessageID string
	var content string
	var messageType string
	var sentAt time.Time
	var messageMetadataJSON string
	var leadMetadataJSON string
	if err := tx.QueryRow(
		ctx,
		nativeLegacyNonManagedRecoveryQuery,
		session.OrganizationID,
		session.ID,
		incoming.ProviderMessageID,
	).Scan(
		&messageRowID,
		&conversationID,
		&messageLeadID,
		&conversationLeadID,
		&remoteJID,
		&providerMessageID,
		&content,
		&messageType,
		&sentAt,
		&messageMetadataJSON,
		&leadMetadataJSON,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("legacy non-managed WhatsApp retry message was not found")
		}
		return err
	}
	if providerMessageID != strings.TrimSpace(incoming.ProviderMessageID) {
		return errors.New("legacy non-managed WhatsApp retry provider identity mismatch")
	}
	if messageLeadID != "" && conversationLeadID != "" && messageLeadID != conversationLeadID {
		return errors.New("legacy non-managed WhatsApp retry conversation lead mismatch")
	}
	if rule.ManagedProviderEventLeadID != "" && rule.ManagedProviderEventLeadID != messageLeadID {
		return errors.New("legacy non-managed WhatsApp retry lead mismatch")
	}

	persistedMessage := nativeEvolutionMessage{
		ProviderMessageID:          providerMessageID,
		ProviderMessageIDSynthetic: incoming.ProviderMessageIDSynthetic,
		RemoteJID:                  remoteJID,
		Content:                    content,
		MessageType:                firstNonEmpty(messageType, "text"),
		SentAt:                     sentAt.UTC(),
	}
	persistedMessage = nativeMessageWithPersistedCampaignAttribution(
		persistedMessage,
		decodeObjectJSON(messageMetadataJSON),
	)
	conversation := nativeEvolutionConversation{
		ID:        conversationID,
		LeadID:    messageLeadID,
		RemoteJID: remoteJID,
	}
	leadMetadata := decodeObjectJSON(leadMetadataJSON)
	conversation.LeadIsNew = messageLeadID != "" && strings.TrimSpace(stringFromAny(
		leadMetadata["whatsapp_initial_provider_event_id"],
	)) == nativeWhatsAppProviderEventID(session, persistedMessage)

	if _, err := tx.Exec(
		ctx,
		nativeLegacyNonManagedConversationRecoveryQuery,
		session.OrganizationID,
		session.ID,
		conversation.ID,
		persistedMessage.SentAt,
		nativeEvolutionPreview(persistedMessage),
	); err != nil {
		return err
	}
	return applyNativeInboundBusinessEffects(
		ctx,
		tx,
		session,
		conversation,
		persistedMessage,
		messageRowID,
		nativeInboundRule{},
	)
}

func nativeMessageWithPersistedCampaignAttribution(
	message nativeEvolutionMessage,
	metadata map[string]any,
) nativeEvolutionMessage {
	attribution := mapFromAny(metadata["whatsapp_attribution"])
	referral := nativeMergeCampaignReferral(
		nativeNormalizePersistedCampaignReferralCandidate(mapFromAny(metadata["whatsapp_referral"])),
		nativeNormalizePersistedCampaignReferralCandidate(mapFromAny(attribution["source_referral"])),
	)
	attributionProof := map[string]any{}
	for _, key := range []string{
		"entry_point_conversion_source",
		"explicit_source_type",
		"ctwa_clid",
		"show_ad_attribution",
		"ctwa_proof_conflict",
		"ctwa_show_ad_attribution_invalid",
	} {
		if value := nativeFirstValue(attribution, key); value != nil {
			attributionProof[key] = value
		}
	}
	referral = nativeMergeCampaignReferral(
		referral,
		nativeNormalizePersistedCampaignReferralCandidate(attributionProof),
	)

	// source_type may have been inferred from ctwa_clid. Only the provider's
	// explicitly persisted source type can authorize the CTWA v2 fallback.
	message.CampaignSourceType = firstString(referral, "explicit_source_type")
	message.CampaignSourceID = firstNonEmpty(
		firstString(referral, "source_id", "sourceId", "ad_id", "adId"),
		firstString(attribution, "source_id", "ad_id"),
	)
	message.CampaignSourceURL = firstNonEmpty(
		nativeFirstHTTPURL(referral, "source_url", "sourceUrl"),
		nativeFirstHTTPURL(attribution, "source_url", "creative_link_url", "creative_destination_url"),
	)
	message.CampaignCreativeURL = firstNonEmpty(
		nativeFirstHTTPURL(referral, "image_url", "thumbnail_url"),
		nativeFirstHTTPURL(attribution, "creative_url"),
	)
	message.CampaignCreativeVideoURL = firstNonEmpty(
		nativeFirstHTTPURL(referral, "video_url"),
		nativeFirstHTTPURL(attribution, "creative_video_url"),
	)
	message.CampaignCTWAClid = firstNonEmpty(
		firstString(referral, "ctwa_clid", "ctwaClid"),
		firstString(attribution, "ctwa_clid"),
	)
	message.CampaignHeadline = firstNonEmpty(
		firstString(referral, "headline", "title", "body"),
		firstString(attribution, "campaign_name", "ad_name", "creative_name", "source_referral_title"),
	)
	message.CampaignEntryPointConversionSource = firstNonEmpty(
		firstString(referral, "entry_point_conversion_source", "entryPointConversionSource"),
		firstString(attribution, "entry_point_conversion_source"),
	)
	message.CampaignEntryPointConversionApp = firstNonEmpty(
		firstString(referral, "entry_point_conversion_app", "entryPointConversionApp"),
		firstString(attribution, "entry_point_conversion_app"),
	)
	message.CampaignConversionSource = firstNonEmpty(
		firstString(referral, "conversion_source", "conversionSource"),
		firstString(attribution, "conversion_source"),
	)
	message.CampaignSourceApp = firstNonEmpty(
		firstString(referral, "source_app", "sourceApp"),
		firstString(attribution, "source_app"),
	)
	message.CampaignShowAdAttribution, message.CampaignShowAdAttributionInvalid = nativeOptionalStrictBool(
		nativeFirstValue(referral, "show_ad_attribution", "showAdAttribution"),
	)
	message.CampaignShowAdAttributionInvalid = message.CampaignShowAdAttributionInvalid || nativeFailClosedMarker(
		nativeFirstValue(referral, "ctwa_show_ad_attribution_invalid"),
	)
	message.CampaignCTWAProofConflict = nativeFailClosedMarker(
		nativeFirstValue(referral, "ctwa_proof_conflict"),
	)
	message.CampaignPropertyCode = firstNonEmpty(
		firstString(referral, "property_code"),
		firstString(attribution, "property_code"),
	)
	message.HasCampaignSignal = len(referral) > 0 || len(attribution) > 0
	message.CTWAConfirmationMethod = nativeCTWAAdConfirmationMethod(message)
	message.IsCTWAAd = message.CTWAConfirmationMethod != ""
	return message
}

func nativeNormalizePersistedCampaignReferralCandidate(value map[string]any) map[string]any {
	if len(value) == 0 {
		return nil
	}
	normalized := make(map[string]any, len(value)+2)
	for key, item := range value {
		normalized[key] = item
	}

	proofConflict := nativeFailClosedMarker(nativeFirstValue(value, "ctwa_proof_conflict"))
	showInvalid := nativeFailClosedMarker(nativeFirstValue(value, "ctwa_show_ad_attribution_invalid"))

	explicitSourceType, explicitInvalid := nativeStrictCampaignProofText(value, "explicit_source_type")
	entryPoint, entryInvalid := nativeStrictCampaignProofText(value,
		"entry_point_conversion_source", "entryPointConversionSource", "EntryPointConversionSource",
	)
	ctwaClid, clidInvalid := nativeStrictCampaignProofText(value,
		"ctwa_clid", "ctwaClid", "CTWAClid", "click_id", "clickId",
	)
	showRaw := nativeFirstValue(value,
		"show_ad_attribution", "showAdAttribution", "ShowAdAttribution",
	)
	show, parsedShowInvalid := nativeOptionalStrictBool(showRaw)
	proofConflict = proofConflict || explicitInvalid || entryInvalid || clidInvalid
	showInvalid = showInvalid || parsedShowInvalid

	for _, key := range []string{
		"explicit_source_type",
		"entry_point_conversion_source", "entryPointConversionSource", "EntryPointConversionSource",
		"ctwa_clid", "ctwaClid", "CTWAClid", "click_id", "clickId",
		"show_ad_attribution", "showAdAttribution", "ShowAdAttribution",
		"ctwa_proof_conflict", "ctwa_show_ad_attribution_invalid",
	} {
		delete(normalized, key)
	}
	if explicitSourceType != "" {
		normalized["explicit_source_type"] = explicitSourceType
	}
	if entryPoint != "" {
		normalized["entry_point_conversion_source"] = entryPoint
	}
	if ctwaClid != "" {
		normalized["ctwa_clid"] = ctwaClid
	}
	if show != nil {
		normalized["show_ad_attribution"] = *show
	}
	if proofConflict {
		normalized["ctwa_proof_conflict"] = true
	}
	if showInvalid {
		normalized["ctwa_show_ad_attribution_invalid"] = true
	}
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}

type nativeHandledAutoReplyQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

const nativeHandledAutoReplyInputQuery = `
	select message.conversation_id::text, message.id::text, coalesce(message.content, '')
	from public.whatsapp_messages as message
	join public.whatsapp_conversations as conversation
	  on conversation.organization_id = message.organization_id
	 and conversation.session_id = message.session_id
	 and conversation.id = message.conversation_id
	where message.organization_id = $1::uuid
	  and message.session_id = $2::uuid
	  and (
	    message.provider_message_id = $3
	    or (message.provider_message_id is null and message.message_id = $3)
	  )
	  and coalesce(message.from_me, false) = false
	  and lower(coalesce(message.direction, 'inbound')) <> 'outbound'
	  and message.lead_id = $4::uuid
	  and conversation.lead_id = $4::uuid
	limit 1
`

// A provider retry can arrive after the message/lifecycle transaction committed
// but before the separate auto-reply job insert succeeded. Recover only the
// already-persisted transport identity; the caller still skips every lead,
// inbound-rule, attribution and distribution effect.
func recoverNativeHandledAutoReplyInput(
	ctx context.Context,
	querier nativeHandledAutoReplyQuerier,
	session nativeEvolutionSession,
	providerMessageID string,
	leadID string,
) (autoReplyInput, bool, error) {
	providerMessageID = strings.TrimSpace(providerMessageID)
	leadID = strings.TrimSpace(leadID)
	if providerMessageID == "" || leadID == "" {
		return autoReplyInput{}, false, nil
	}

	input := autoReplyInput{
		OrganizationID: session.OrganizationID,
		SessionID:      session.ID,
	}
	err := querier.QueryRow(
		ctx,
		nativeHandledAutoReplyInputQuery,
		session.OrganizationID,
		session.ID,
		providerMessageID,
		leadID,
	).Scan(&input.ConversationID, &input.MessageID, &input.Text)
	if errors.Is(err, pgx.ErrNoRows) {
		return autoReplyInput{}, false, nil
	}
	if err != nil {
		return autoReplyInput{}, false, err
	}
	if strings.TrimSpace(input.Text) == "" {
		return autoReplyInput{}, false, nil
	}
	return input, true, nil
}

// reconcileNativeOutboundOutbox turns a late signed outbound webhook into the
// provider acknowledgement that an HTTP timeout could not prove. This is the
// safe alternative to automatically resending an outcome-unknown message.
func reconcileNativeOutboundOutbox(
	ctx context.Context,
	tx pgx.Tx,
	session nativeEvolutionSession,
	message nativeEvolutionMessage,
	messageRowID string,
) error {
	if strings.TrimSpace(message.ProviderMessageID) == "" || strings.TrimSpace(messageRowID) == "" {
		return nil
	}

	var outboxID, clientMessageID string
	err := tx.QueryRow(ctx, `
		update public.whatsapp_outbox as outbox
		set message_id = $4::uuid,
		    provider_message_id = $3,
		    status = case when outbox.status in ('delivered', 'read') then outbox.status else 'sent' end,
		    sent_at = coalesce(outbox.sent_at, $5),
		    failed_at = null,
		    dead_lettered_at = null,
		    locked_at = null,
		    locked_by = null,
		    last_error = null,
		    updated_at = now()
		where outbox.organization_id = $1::uuid
		  and outbox.session_id = $2::uuid
		  and outbox.provider_message_id = $3
		returning outbox.id::text, outbox.client_message_id
	`, session.OrganizationID, session.ID, message.ProviderMessageID, messageRowID, message.SentAt).Scan(&outboxID, &clientMessageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		update public.whatsapp_messages
		set provider_message_id = $3,
		    message_id = $3,
		    status = case when status in ('delivered', 'read') then status else 'sent' end,
		    sent_at = coalesce(sent_at, $4),
		    updated_at = now()
		where id = $1::uuid
		  and organization_id = $2::uuid
	`, messageRowID, session.OrganizationID, message.ProviderMessageID, message.SentAt); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		update public.leads as lead
		set last_contact_at = greatest(
		      coalesce(lead.last_contact_at, '-infinity'::timestamptz),
		      coalesce(message.sent_at, $4)
		    ),
		    first_response_at = coalesce(lead.first_response_at, message.sent_at, $4),
		    first_response_seconds = coalesce(
		      lead.first_response_seconds,
		      greatest(0, extract(epoch from (coalesce(message.sent_at, $4) - lead.created_at))::integer)
		    ),
		    first_response_channel = coalesce(lead.first_response_channel, 'whatsapp'),
		    first_response_is_automation = coalesce(
		      lead.first_response_is_automation,
		      coalesce(message.metadata->>'origin', '') = 'automation'
		    ),
		    first_response_actor_user_id = coalesce(lead.first_response_actor_user_id, message.sender_user_id),
		    updated_at = now()
		from public.whatsapp_messages as message
		where message.id = $1::uuid
		  and message.organization_id = $2::uuid
		  and message.session_id = $3::uuid
		  and message.lead_id = lead.id
		  and lead.organization_id = message.organization_id
	`, messageRowID, session.OrganizationID, session.ID, message.SentAt); err != nil {
		return err
	}

	timelineResult, err := tx.Exec(ctx, `
		update public.lead_timeline_events as timeline
		set event_type = 'whatsapp_message_sent',
		    title = 'Mensagem WhatsApp enviada',
		    metadata = (coalesce(timeline.metadata, '{}'::jsonb) - 'last_error') || jsonb_build_object(
		      'delivery_status', 'sent',
		      'message_id', $4,
		      'client_message_id', $5,
		      'message_row_id', $1::uuid
		    ),
		    event_at = coalesce(message.sent_at, $6)
		from public.whatsapp_messages as message
		where timeline.organization_id = $2::uuid
		  and timeline.metadata->>'outbox_id' = $3
		  and message.id = $1::uuid
		  and message.organization_id = timeline.organization_id
	`, messageRowID, session.OrganizationID, outboxID, message.ProviderMessageID, clientMessageID, message.SentAt)
	if err != nil {
		return err
	}
	if timelineResult.RowsAffected() == 0 {
		if _, err := tx.Exec(ctx, `
			insert into public.lead_timeline_events (
			  organization_id, lead_id, event_type, title, description,
			  user_id, actor_user_id, metadata, event_at
			)
			select
			  message.organization_id, message.lead_id, 'whatsapp_message_sent',
			  'Mensagem WhatsApp enviada', coalesce(nullif(message.content, ''), '[Mensagem]'),
			  message.sender_user_id, message.sender_user_id,
			  jsonb_build_object(
			    'outbox_id', $3::uuid,
			    'message_row_id', message.id,
			    'message_id', $4,
			    'client_message_id', $5,
			    'delivery_status', 'sent'
			  ),
			  coalesce(message.sent_at, $6)
			from public.whatsapp_messages as message
			where message.id = $1::uuid
			  and message.organization_id = $2::uuid
			  and message.lead_id is not null
		`, messageRowID, session.OrganizationID, outboxID, message.ProviderMessageID, clientMessageID, message.SentAt); err != nil {
			return err
		}
	}

	if _, err := tx.Exec(ctx, `
		update public.automation_effect_dispatches as dispatch
		set status = 'succeeded',
		    provider_id = $3,
		    error_message = null,
		    completed_at = now(),
		    response = (coalesce(dispatch.response, '{}'::jsonb) - 'last_error') || jsonb_build_object(
		      'status', 'sent',
		      'delivery_status', 'sent',
		      'provider_id', $3,
		      'message_id', $4::uuid,
		      'outbox_id', $2::uuid
		    )
		where dispatch.organization_id = $1::uuid
		  and dispatch.effect_key = $5
		  and dispatch.request->>'delivery_contract' = 'canonical_whatsapp_outbox_v1'
		  and dispatch.response->>'outbox_id' = $2
		  and dispatch.status in ('succeeded', 'failed', 'unknown')
	`, session.OrganizationID, outboxID, message.ProviderMessageID, messageRowID, clientMessageID); err != nil {
		return err
	}

	return nil
}

func loadNativeEvolutionSession(ctx context.Context, tx pgx.Tx, item pendingEvolutionWebhook) (nativeEvolutionSession, error) {
	var session nativeEvolutionSession
	var advancedSettings string
	err := tx.QueryRow(ctx, `
		select id::text, organization_id::text, coalesce(phone_number, ''), coalesce(profile_name, ''),
		       coalesce(owner_user_id::text, ''), coalesce(owner_user_id::text, ''),
		       coalesce(advanced_settings, '{}'::jsonb)::text
		from public.whatsapp_sessions
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and provider = 'evolution_go'
		  and coalesce(is_active, true) = true
		  and lower(btrim(coalesce(status, ''))) not in ('deleted', 'disabled')
		for share
	`, item.OrganizationID, item.SessionID).Scan(
		&session.ID,
		&session.OrganizationID,
		&session.PhoneNumber,
		&session.ProfileName,
		&session.OwnerUserID,
		&session.CreatedBy,
		&advancedSettings,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nativeEvolutionSession{}, ErrSessionNotFound
	}
	if err == nil {
		session.AdvancedSettings = decodeObjectJSON(advancedSettings)
	}
	return session, err
}

func ensureNativeEvolutionConversation(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession, message nativeEvolutionMessage, rule nativeInboundRule) (nativeEvolutionConversation, error) {
	aliases := uniqueStrings(append([]string{message.RemoteJID}, message.RemoteAliases...)...)
	var conversation nativeEvolutionConversation
	err := tx.QueryRow(ctx, `
		select wc.id::text, coalesce(wc.lead_id::text, ''), wc.remote_jid
		from public.whatsapp_conversations wc
		where wc.organization_id = $1::uuid
		  and wc.session_id = $2::uuid
		  and (
		    wc.remote_jid = any($3::text[])
		    or exists (
		      select 1
		      from public.whatsapp_contact_identity_aliases alias
		      where alias.organization_id = $1::uuid
		        and alias.session_id = $2::uuid
		        and alias.alias_jid = any($3::text[])
		        and alias.canonical_jid = wc.remote_jid
		    )
		  )
		order by (wc.remote_jid = $4) desc, wc.deleted_at nulls first, wc.last_message_at desc nulls last
		limit 1
		for update of wc
	`, session.OrganizationID, session.ID, aliases, message.RemoteJID).Scan(&conversation.ID, &conversation.LeadID, &conversation.RemoteJID)
	conversationMissing := errors.Is(err, pgx.ErrNoRows)
	if err != nil && !conversationMissing {
		return nativeEvolutionConversation{}, err
	}

	lead := nativeEvolutionLead{}
	if !message.IsGroup {
		if rule.ManagedProviderEventPending {
			lead, err = findScopedNativeEvolutionLeadByID(
				ctx,
				tx,
				session.OrganizationID,
				rule.ManagedProviderEventLeadID,
			)
			if err != nil {
				return nativeEvolutionConversation{}, err
			}
			if conversation.LeadID != "" && conversation.LeadID != lead.ID {
				return nativeEvolutionConversation{}, errors.New("pending managed WhatsApp provider event conversation lead mismatch")
			}
		} else if nativeConversationHasAttachedLead(conversation, conversationMissing) {
			// The conversation link is already scoped by organization and session.
			// Re-load that exact lead in the same organization instead of resolving
			// the phone globally again; legacy duplicate WhatsApp-only values must
			// not block an otherwise valid established chat.
			lead, err = findScopedNativeEvolutionLeadByID(
				ctx,
				tx,
				session.OrganizationID,
				conversation.LeadID,
			)
			if err != nil {
				return nativeEvolutionConversation{}, err
			}
		} else {
			lead, err = findSingleNativeEvolutionLead(ctx, tx, session.OrganizationID, message)
			if errors.Is(err, errNativeEvolutionLeadPhoneAmbiguous) && !message.IsCTWAAd {
				// Preserve ordinary chat delivery without guessing which historical
				// duplicate owns the phone. CTWA creation still fails closed below.
				lead = nativeEvolutionLead{}
				err = nil
			}
			if err != nil {
				return nativeEvolutionConversation{}, err
			}
			if lead.ID == "" && !message.FromMe && message.IsCTWAAd {
				lead, err = createAuthorizedNativeLead(ctx, tx, session, message, rule)
				if err != nil {
					return nativeEvolutionConversation{}, err
				}
			}
		}
	}
	conversation, conversationMissing, err = reconcileNativeEvolutionConversationIdentity(
		ctx, tx, session, message, conversation, conversationMissing, lead,
	)
	if err != nil {
		return nativeEvolutionConversation{}, err
	}

	if conversationMissing {
		contactName := firstNonEmpty(message.ContactName, message.ContactPhone, message.RemoteJID)
		err = tx.QueryRow(ctx, `
			insert into public.whatsapp_conversations (
				organization_id, session_id, lead_id, assigned_user_id, remote_jid,
				contact_phone, contact_name, is_group, unread_count, metadata
			) values (
				$1::uuid, $2::uuid, nullif($3, '')::uuid, nullif($4, '')::uuid, $5,
				nullif($6, ''), nullif($7, ''), $8, 0, '{"source":"evolution_go_native"}'::jsonb
			)
			on conflict (organization_id, session_id, remote_jid)
			do update set
				deleted_at = null,
				lead_id = coalesce(whatsapp_conversations.lead_id, excluded.lead_id),
				assigned_user_id = coalesce(whatsapp_conversations.assigned_user_id, excluded.assigned_user_id),
				contact_phone = coalesce(whatsapp_conversations.contact_phone, excluded.contact_phone),
				contact_name = coalesce(whatsapp_conversations.contact_name, excluded.contact_name),
				updated_at = now()
			returning id::text, coalesce(lead_id::text, ''), remote_jid
		`, session.OrganizationID, session.ID, lead.ID, lead.AssignedUserID, message.RemoteJID, message.ContactPhone, contactName, message.IsGroup).Scan(
			&conversation.ID, &conversation.LeadID, &conversation.RemoteJID,
		)
		if err != nil {
			return nativeEvolutionConversation{}, err
		}
	} else if conversation.LeadID == "" && lead.ID != "" {
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_conversations
			set lead_id = $4::uuid,
			    assigned_user_id = coalesce(assigned_user_id, nullif($5, '')::uuid),
			    contact_phone = coalesce(contact_phone, nullif($6, '')),
			    contact_name = coalesce(contact_name, nullif($7, '')),
			    deleted_at = null,
			    updated_at = now()
			where organization_id = $1::uuid and session_id = $2::uuid and id = $3::uuid
		`, session.OrganizationID, session.ID, conversation.ID, lead.ID, lead.AssignedUserID, message.ContactPhone, message.ContactName); err != nil {
			return nativeEvolutionConversation{}, err
		}
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_messages
			set lead_id = $4::uuid, updated_at = now()
			where organization_id = $1::uuid and session_id = $2::uuid
			  and conversation_id = $3::uuid and lead_id is null
		`, session.OrganizationID, session.ID, conversation.ID, lead.ID); err != nil {
			return nativeEvolutionConversation{}, err
		}
		conversation.LeadID = lead.ID
	}
	conversation.LeadIsNew = lead.IsNew && conversation.LeadID == lead.ID
	if rule.ManagedProviderEventPending && conversation.LeadID != lead.ID {
		return nativeEvolutionConversation{}, errors.New("pending managed WhatsApp provider event lead mismatch")
	}

	for _, alias := range aliases {
		if strings.TrimSpace(alias) == "" {
			continue
		}
		if _, err := tx.Exec(ctx, `
			insert into public.whatsapp_contact_identity_aliases (
				organization_id, session_id, alias_jid, canonical_jid, contact_phone,
				lead_id, is_group, metadata
			) values (
				$1::uuid, $2::uuid, $3, $4, nullif($5, ''), nullif($6, '')::uuid, $7,
				'{"source":"evolution_go_native"}'::jsonb
			)
			on conflict (organization_id, session_id, alias_jid)
			do update set
				last_seen_at = now(),
				lead_id = coalesce(whatsapp_contact_identity_aliases.lead_id, excluded.lead_id),
				contact_phone = coalesce(whatsapp_contact_identity_aliases.contact_phone, excluded.contact_phone)
		`, session.OrganizationID, session.ID, alias, conversation.RemoteJID, message.ContactPhone, conversation.LeadID, message.IsGroup); err != nil {
			return nativeEvolutionConversation{}, err
		}
	}
	return conversation, nil
}

func nativeConversationHasAttachedLead(conversation nativeEvolutionConversation, conversationMissing bool) bool {
	return !conversationMissing && strings.TrimSpace(conversation.ID) != "" && strings.TrimSpace(conversation.LeadID) != ""
}

const nativeScopedManagedPendingLeadQuery = `
	select lead.id::text, coalesce(lead.assigned_user_id::text, ''), coalesce(lead.name, '')
	from public.leads lead
	where lead.organization_id = $1::uuid
	  and lead.id = $2::uuid
	limit 1
`

func findScopedNativeEvolutionLeadByID(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	leadID string,
) (nativeEvolutionLead, error) {
	if strings.TrimSpace(leadID) == "" {
		return nativeEvolutionLead{}, errors.New("scoped WhatsApp conversation lead is missing")
	}
	var lead nativeEvolutionLead
	err := tx.QueryRow(ctx, nativeScopedManagedPendingLeadQuery, organizationID, leadID).Scan(
		&lead.ID,
		&lead.AssignedUserID,
		&lead.Name,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nativeEvolutionLead{}, errors.New("scoped WhatsApp conversation lead was not found in organization")
	}
	return lead, err
}

func reconcileNativeEvolutionConversationIdentity(
	ctx context.Context,
	tx pgx.Tx,
	session nativeEvolutionSession,
	message nativeEvolutionMessage,
	current nativeEvolutionConversation,
	currentMissing bool,
	lead nativeEvolutionLead,
) (nativeEvolutionConversation, bool, error) {
	canonicalJID := strings.TrimSpace(message.RemoteJID)
	if message.IsGroup || message.ContactPhone == "" || canonicalJID == "" || isOpaqueWhatsAppJID(canonicalJID) {
		return current, currentMissing, nil
	}
	opaqueAliases := make([]string, 0, len(message.RemoteAliases))
	for _, alias := range uniqueStrings(message.RemoteAliases...) {
		if isOpaqueWhatsAppJID(alias) {
			opaqueAliases = append(opaqueAliases, alias)
		}
	}
	if len(opaqueAliases) == 0 {
		return current, currentMissing, nil
	}

	var target nativeEvolutionConversation
	var targetDeleted bool
	err := tx.QueryRow(ctx, `
		select id::text, coalesce(lead_id::text, ''), remote_jid, deleted_at is not null
		from public.whatsapp_conversations
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and remote_jid = $3
		limit 1
		for update
	`, session.OrganizationID, session.ID, canonicalJID).Scan(&target.ID, &target.LeadID, &target.RemoteJID, &targetDeleted)
	targetMissing := errors.Is(err, pgx.ErrNoRows)
	if err != nil && !targetMissing {
		return nativeEvolutionConversation{}, false, err
	}

	rows, err := tx.Query(ctx, `
		select id::text, coalesce(lead_id::text, ''), remote_jid
		from public.whatsapp_conversations
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and remote_jid = any($3::text[])
		  and deleted_at is null
		  and ($4 = '' or id::text <> $4)
		order by id
		for update
	`, session.OrganizationID, session.ID, opaqueAliases, target.ID)
	if err != nil {
		return nativeEvolutionConversation{}, false, err
	}
	sources := []nativeEvolutionConversation{}
	for rows.Next() {
		var source nativeEvolutionConversation
		if err := rows.Scan(&source.ID, &source.LeadID, &source.RemoteJID); err != nil {
			rows.Close()
			return nativeEvolutionConversation{}, false, err
		}
		sources = append(sources, source)
	}
	rows.Close()
	if len(sources) == 0 {
		return current, currentMissing, nil
	}

	if targetMissing {
		target = sources[0]
		sources = sources[1:]
		desiredLeadID, err := safeNativeMergedLeadID("", target.LeadID, lead.ID)
		if err != nil {
			return nativeEvolutionConversation{}, false, err
		}
		if err := validateNativeConversationLeadShape(ctx, tx, session, target.ID, desiredLeadID); err != nil {
			return nativeEvolutionConversation{}, false, err
		}
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_conversations
			set remote_jid = $4,
			    contact_phone = coalesce(nullif($5, ''), contact_phone),
			    contact_name = coalesce(nullif(contact_name, ''), nullif($6, ''), nullif($5, '')),
			    lead_id = nullif($7, '')::uuid,
			    assigned_user_id = coalesce(assigned_user_id, nullif($8, '')::uuid),
			    deleted_at = null,
			    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
			      'promoted_from_remote_jid', $9,
			      'identity_promoted_at', now(),
			      'identity_promotion_source', 'evolution_go_native'
			    ),
			    updated_at = now()
			where organization_id = $1::uuid and session_id = $2::uuid and id = $3::uuid
		`, session.OrganizationID, session.ID, target.ID, canonicalJID, message.ContactPhone, message.ContactName,
			desiredLeadID, lead.AssignedUserID, target.RemoteJID); err != nil {
			return nativeEvolutionConversation{}, false, err
		}
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_messages
			set remote_jid = case when remote_jid is null or remote_jid = $4 then $5 else remote_jid end,
			    lead_id = coalesce(lead_id, nullif($6, '')::uuid),
			    updated_at = now()
			where organization_id = $1::uuid and session_id = $2::uuid and conversation_id = $3::uuid
		`, session.OrganizationID, session.ID, target.ID, target.RemoteJID, canonicalJID, desiredLeadID); err != nil {
			return nativeEvolutionConversation{}, false, err
		}
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_contact_identity_aliases
			set canonical_jid = $4,
			    contact_phone = coalesce(contact_phone, nullif($5, '')),
			    lead_id = coalesce(lead_id, nullif($6, '')::uuid),
			    last_seen_at = now()
			where organization_id = $1::uuid and session_id = $2::uuid
			  and (canonical_jid = $3 or alias_jid = $3)
		`, session.OrganizationID, session.ID, target.RemoteJID, canonicalJID, message.ContactPhone, desiredLeadID); err != nil {
			return nativeEvolutionConversation{}, false, err
		}
		target.RemoteJID = canonicalJID
		target.LeadID = desiredLeadID
	} else {
		desiredLeadID, err := safeNativeMergedLeadID(target.LeadID, "", lead.ID)
		if err != nil {
			return nativeEvolutionConversation{}, false, err
		}
		if targetDeleted {
			if _, err := tx.Exec(ctx, `
				update public.whatsapp_conversations
				set deleted_at = null, lead_id = coalesce(lead_id, nullif($4, '')::uuid), updated_at = now()
				where organization_id = $1::uuid and session_id = $2::uuid and id = $3::uuid
			`, session.OrganizationID, session.ID, target.ID, desiredLeadID); err != nil {
				return nativeEvolutionConversation{}, false, err
			}
		}
		target.LeadID = desiredLeadID
	}

	for _, source := range sources {
		merged, err := mergeNativeEvolutionConversation(ctx, tx, session, target, source, message, lead)
		if err != nil {
			return nativeEvolutionConversation{}, false, err
		}
		target = merged
	}
	return target, false, nil
}

func safeNativeMergedLeadID(targetLeadID string, sourceLeadID string, resolvedLeadID string) (string, error) {
	nonEmpty := uniqueStrings(targetLeadID, sourceLeadID, resolvedLeadID)
	if len(nonEmpty) > 1 {
		return "", fmt.Errorf("%w: LID promotion has conflicting lead ownership", ErrInvalidInput)
	}
	if len(nonEmpty) == 0 {
		return "", nil
	}
	// A previously linked opaque conversation is promoted only when the now
	// visible phone resolves to that same lead. Ambiguous/mismatched ownership
	// remains quarantined rather than exposing history to another person.
	if sourceLeadID != "" && resolvedLeadID == "" {
		return "", fmt.Errorf("%w: LID promotion could not verify existing lead ownership", ErrInvalidInput)
	}
	return nonEmpty[0], nil
}

func validateNativeConversationLeadShape(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession, conversationID string, desiredLeadID string) error {
	var conflict bool
	if err := tx.QueryRow(ctx, `
		select
		  exists (
		    select 1 from public.whatsapp_messages
		    where organization_id = $1::uuid and session_id = $2::uuid and conversation_id = $3::uuid
		      and lead_id is not null and ($4 = '' or lead_id::text <> $4)
		  )
		  or exists (
		    select 1 from public.whatsapp_inbound_logs
		    where organization_id = $1::uuid and conversation_id = $3::uuid
		      and lead_id is not null and ($4 = '' or lead_id::text <> $4)
		  )
		  or exists (
		    select 1 from public.automation_executions
		    where organization_id = $1::uuid and conversation_id = $3::uuid
		      and lead_id is not null and ($4 = '' or lead_id::text <> $4)
		  )
		  or exists (
		    select 1 from public.conversation_ai_state
		    where organization_id = $1::uuid and conversation_id = $3::uuid
		      and lead_id is not null and ($4 = '' or lead_id::text <> $4)
		  )
		  or exists (
		    select 1 from public.automation_event_outbox
		    where organization_id = $1::uuid and conversation_id = $3::uuid
		      and lead_id is not null and ($4 = '' or lead_id::text <> $4)
		  )
	`, session.OrganizationID, session.ID, conversationID, desiredLeadID).Scan(&conflict); err != nil {
		return err
	}
	if conflict {
		return fmt.Errorf("%w: LID promotion found conflicting lead history", ErrInvalidInput)
	}
	return nil
}

func mergeNativeEvolutionConversation(
	ctx context.Context,
	tx pgx.Tx,
	session nativeEvolutionSession,
	target nativeEvolutionConversation,
	source nativeEvolutionConversation,
	message nativeEvolutionMessage,
	lead nativeEvolutionLead,
) (nativeEvolutionConversation, error) {
	if target.ID == "" || source.ID == "" || target.ID == source.ID {
		return target, nil
	}
	desiredLeadID, err := safeNativeMergedLeadID(target.LeadID, source.LeadID, lead.ID)
	if err != nil {
		return nativeEvolutionConversation{}, err
	}
	if err := validateNativeConversationLeadShape(ctx, tx, session, source.ID, desiredLeadID); err != nil {
		return nativeEvolutionConversation{}, err
	}

	var duplicateMessages bool
	if err := tx.QueryRow(ctx, `
		select exists (
		  select 1
		  from public.whatsapp_messages source_message
		  join public.whatsapp_messages target_message
		    on target_message.conversation_id = $4::uuid
		   and target_message.message_id = source_message.message_id
		  where source_message.organization_id = $1::uuid
		    and source_message.session_id = $2::uuid
		    and source_message.conversation_id = $3::uuid
		    and source_message.message_id is not null
		)
	`, session.OrganizationID, session.ID, source.ID, target.ID).Scan(&duplicateMessages); err != nil {
		return nativeEvolutionConversation{}, err
	}
	if duplicateMessages {
		return nativeEvolutionConversation{}, fmt.Errorf("%w: LID promotion found conflicting provider message history", ErrInvalidInput)
	}

	var sourceAIState, targetAIState bool
	if err := tx.QueryRow(ctx, `
		select
		  exists (select 1 from public.conversation_ai_state where organization_id = $1::uuid and conversation_id = $2::uuid),
		  exists (select 1 from public.conversation_ai_state where organization_id = $1::uuid and conversation_id = $3::uuid)
	`, session.OrganizationID, source.ID, target.ID).Scan(&sourceAIState, &targetAIState); err != nil {
		return nativeEvolutionConversation{}, err
	}
	if sourceAIState && targetAIState {
		return nativeEvolutionConversation{}, fmt.Errorf("%w: LID promotion found conflicting AI conversation state", ErrInvalidInput)
	}

	if _, err := tx.Exec(ctx, `
		update public.whatsapp_messages
		set conversation_id = $4::uuid,
		    remote_jid = case when remote_jid is null or remote_jid = $3 then $5 else remote_jid end,
		    lead_id = coalesce(lead_id, nullif($6, '')::uuid),
		    updated_at = now()
		where organization_id = $1::uuid and session_id = $2::uuid and conversation_id = $7::uuid
	`, session.OrganizationID, session.ID, source.RemoteJID, target.ID, target.RemoteJID, desiredLeadID, source.ID); err != nil {
		return nativeEvolutionConversation{}, err
	}
	if _, err := tx.Exec(ctx, `
		update public.whatsapp_outbox
		set conversation_id = $4::uuid, recipient_jid = $5, updated_at = now()
		where organization_id = $1::uuid and session_id = $2::uuid and conversation_id = $3::uuid
	`, session.OrganizationID, session.ID, source.ID, target.ID, target.RemoteJID); err != nil {
		return nativeEvolutionConversation{}, err
	}
	if _, err := tx.Exec(ctx, `
		update public.whatsapp_message_reactions
		set conversation_id = $4::uuid, updated_at = now()
		where organization_id = $1::uuid and session_id = $2::uuid and conversation_id = $3::uuid
	`, session.OrganizationID, session.ID, source.ID, target.ID); err != nil {
		return nativeEvolutionConversation{}, err
	}
	if _, err := tx.Exec(ctx, `
		insert into public.whatsapp_chat_labels (conversation_id, label_id)
		select $3::uuid, chat_label.label_id
		from public.whatsapp_chat_labels chat_label
		join public.whatsapp_labels label on label.id = chat_label.label_id
		where label.organization_id = $1::uuid
		  and label.session_id = $4::uuid
		  and chat_label.conversation_id = $2::uuid
		on conflict (conversation_id, label_id) do nothing;
		delete from public.whatsapp_chat_labels chat_label
		using public.whatsapp_labels label
		where label.id = chat_label.label_id
		  and label.organization_id = $1::uuid
		  and label.session_id = $4::uuid
		  and chat_label.conversation_id = $2::uuid
	`, session.OrganizationID, source.ID, target.ID, session.ID); err != nil {
		return nativeEvolutionConversation{}, err
	}
	if _, err := tx.Exec(ctx, `
		update public.whatsapp_inbound_logs set conversation_id = $3::uuid
		where organization_id = $1::uuid and conversation_id = $2::uuid;
		update public.automation_executions set conversation_id = $3::uuid
		where organization_id = $1::uuid and conversation_id = $2::uuid;
		update public.outbox_messages set conversation_id = $3::uuid
		where organization_id = $1::uuid and conversation_id = $2::uuid;
		update public.automation_event_outbox set conversation_id = $3::uuid, updated_at = now()
		where organization_id = $1::uuid and conversation_id = $2::uuid;
	`, session.OrganizationID, source.ID, target.ID); err != nil {
		return nativeEvolutionConversation{}, err
	}
	if sourceAIState {
		if _, err := tx.Exec(ctx, `
			update public.conversation_ai_state set conversation_id = $3::uuid, updated_at = now()
			where organization_id = $1::uuid and conversation_id = $2::uuid
		`, session.OrganizationID, source.ID, target.ID); err != nil {
			return nativeEvolutionConversation{}, err
		}
	}

	if _, err := tx.Exec(ctx, `
		update public.whatsapp_contact_identity_aliases
		set canonical_jid = $4,
		    contact_phone = coalesce(contact_phone, nullif($5, '')),
		    lead_id = coalesce(lead_id, nullif($6, '')::uuid),
		    last_seen_at = now()
		where organization_id = $1::uuid and session_id = $2::uuid
		  and (canonical_jid = $3 or alias_jid = $3)
	`, session.OrganizationID, session.ID, source.RemoteJID, target.RemoteJID, message.ContactPhone, desiredLeadID); err != nil {
		return nativeEvolutionConversation{}, err
	}
	if _, err := tx.Exec(ctx, `
		with source_state as (
		  select unread_count, assigned_user_id from public.whatsapp_conversations
		  where organization_id = $1::uuid and session_id = $2::uuid and id = $3::uuid
		), latest as (
		  select
		    coalesce(nullif(content, ''), case message_type
		      when 'image' then 'Imagem' when 'video' then 'Video' when 'audio' then 'Audio'
		      when 'document' then 'Documento' when 'sticker' then 'Figurinha' else 'Mensagem' end) preview,
		    coalesce(sent_at, created_at) message_at
		  from public.whatsapp_messages
		  where organization_id = $1::uuid and session_id = $2::uuid and conversation_id = $4::uuid
		  order by coalesce(sent_at, created_at) desc, created_at desc
		  limit 1
		)
		update public.whatsapp_conversations target
		set lead_id = nullif($5, '')::uuid,
		    assigned_user_id = coalesce(target.assigned_user_id, (select assigned_user_id from source_state), nullif($6, '')::uuid),
		    contact_phone = coalesce(nullif($7, ''), target.contact_phone),
		    contact_name = coalesce(nullif(target.contact_name, ''), nullif($8, ''), nullif($7, '')),
		    unread_count = coalesce(target.unread_count, 0) + coalesce((select unread_count from source_state), 0),
		    last_message = coalesce((select preview from latest), target.last_message),
		    last_message_preview = coalesce((select preview from latest), target.last_message_preview),
		    last_message_at = greatest(coalesce(target.last_message_at, '-infinity'::timestamptz), coalesce((select message_at from latest), '-infinity'::timestamptz)),
		    metadata = coalesce(target.metadata, '{}'::jsonb) || jsonb_build_object(
		      'merged_lid_conversation_ids', coalesce(target.metadata->'merged_lid_conversation_ids', '[]'::jsonb) || jsonb_build_array($3::uuid),
		      'identity_merged_at', now(),
		      'identity_merge_source', 'evolution_go_native'
		    ),
		    deleted_at = null,
		    updated_at = now()
		where target.organization_id = $1::uuid and target.session_id = $2::uuid and target.id = $4::uuid
	`, session.OrganizationID, session.ID, source.ID, target.ID, desiredLeadID, lead.AssignedUserID, message.ContactPhone, message.ContactName); err != nil {
		return nativeEvolutionConversation{}, err
	}
	if _, err := tx.Exec(ctx, `
		update public.whatsapp_conversations
		set deleted_at = coalesce(deleted_at, now()),
		    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
		      'merged_into_conversation_id', $4::uuid,
		      'legacy_remote_jid', remote_jid,
		      'merge_source', 'evolution_go_native'
		    ),
		    updated_at = now()
		where organization_id = $1::uuid and session_id = $2::uuid and id = $3::uuid
	`, session.OrganizationID, session.ID, source.ID, target.ID); err != nil {
		return nativeEvolutionConversation{}, err
	}
	target.LeadID = desiredLeadID
	return target, nil
}

func findSingleNativeEvolutionLead(ctx context.Context, tx pgx.Tx, organizationID string, message nativeEvolutionMessage) (nativeEvolutionLead, error) {
	candidates := phoneMatchCandidates(append([]string{message.ContactPhone}, message.RemoteAliases...)...)
	if len(candidates) == 0 {
		return nativeEvolutionLead{}, nil
	}
	rows, err := tx.Query(ctx, `
		select l.id::text, coalesce(l.assigned_user_id::text, ''), coalesce(l.name, '')
		from public.leads l
		where l.organization_id = $1::uuid
		  and l.phone is not null
		  and exists (
		    select 1
		    from unnest($2::text[]) candidate(value)
		    where normalize_phone(candidate.value) <> ''
		      and normalize_phone(l.phone) = normalize_phone(candidate.value)
		  )
		order by case when l.deal_status = 'open' then 0 else 1 end, l.created_at desc
		limit 2
	`, organizationID, candidates)
	if err != nil {
		return nativeEvolutionLead{}, err
	}
	defer rows.Close()
	matches := []nativeEvolutionLead{}
	for rows.Next() {
		var match nativeEvolutionLead
		if err := rows.Scan(&match.ID, &match.AssignedUserID, &match.Name); err != nil {
			return nativeEvolutionLead{}, err
		}
		matches = append(matches, match)
	}
	if err := rows.Err(); err != nil {
		return nativeEvolutionLead{}, err
	}
	return nativeSingleEvolutionLeadMatch(matches)
}

func nativeSingleEvolutionLeadMatch(matches []nativeEvolutionLead) (nativeEvolutionLead, error) {
	switch len(matches) {
	case 0:
		return nativeEvolutionLead{}, nil
	case 1:
		return matches[0], nil
	default:
		// Ambiguous phone ownership must stop before upsert. Treating ambiguity
		// as "not found" could create or attach a third lead for the same phone.
		return nativeEvolutionLead{}, errNativeEvolutionLeadPhoneAmbiguous
	}
}

func createAuthorizedNativeLead(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession, message nativeEvolutionMessage, rule nativeInboundRule) (nativeEvolutionLead, error) {
	if message.ContactPhone == "" || !message.IsCTWAAd {
		return nativeEvolutionLead{}, nil
	}
	ctwaConfirmationMethod := nativeCTWAAdConfirmationMethod(message)
	if ctwaConfirmationMethod == "" {
		return nativeEvolutionLead{}, nil
	}
	propertyID, err := resolveNativeCampaignProperty(ctx, tx, session.OrganizationID, message.CampaignPropertyCode)
	if err != nil {
		return nativeEvolutionLead{}, err
	}

	assignmentRule := nativeCTWALeadAssignmentRule(rule)
	assignment, err := resolveNativeLeadAssignment(ctx, tx, session, assignmentRule)
	if err != nil {
		return nativeEvolutionLead{}, err
	}
	createdBy := assignment.UserID
	if createdBy == "" {
		createdBy, err = resolveNativeActiveSessionOwner(ctx, tx, session)
		if err != nil {
			return nativeEvolutionLead{}, err
		}
	}
	attribution := nativeCampaignAttribution(message)
	metadataPayload := map[string]any{
		"source":                                "whatsapp",
		"whatsapp_session_id":                   session.ID,
		"remote_jid":                            message.RemoteJID,
		"matched_rule_id":                       rule.ID,
		"managed_whatsapp_message_distribution": rule.ManagedMessageDistribution,
		"target_team_id":                        assignment.TeamID,
		"target_round_robin_id":                 nativeTargetRoundRobinID(rule, assignment),
		"campaign_label":                        firstNonEmpty(rule.CampaignLabel, message.CampaignHeadline),
		"ctwa_ad_confirmed":                     true,
		"whatsapp_lead_creation_contract":       "ctwa_ad_v2",
		"ctwa_confirmation_method":              ctwaConfirmationMethod,
		"whatsapp_initial_provider_event_id":    session.ID + ":" + message.ProviderMessageID,
		"whatsapp_attribution":                  attribution,
		"property_id":                           propertyID,
	}
	if rule.ManagedMessageDistribution {
		metadataPayload["managed_whatsapp_initial_provider_event_id"] = session.ID + ":" + message.ProviderMessageID
	}
	metadata := jsonb(metadataPayload)
	sourceDetailFallback := "WhatsApp Meta Ads"

	var lead nativeEvolutionLead
	err = tx.QueryRow(ctx, `
		select id::text, coalesce(assigned_user_id::text, ''), coalesce(name, ''), is_new_lead
		from public.upsert_whatsapp_webhook_lead(
		  p_organization_id => $1::uuid,
		  p_name => $2,
		  p_phone => $3,
		  p_whatsapp => $3,
		  p_source_detail => nullif($4, ''),
		  p_source_session_id => $5::uuid,
		  p_initial_message => nullif($6, ''),
		  p_message => nullif($6, ''),
		  p_property_code => nullif($13, ''),
		  p_property_id => nullif($14, '')::uuid,
		  p_interest_property_id => nullif($14, '')::uuid,
		  p_assigned_user_id => nullif($7, '')::uuid,
		  p_assigned_at => case when nullif($7, '') is null then null else $8::timestamptz end,
		  p_pipeline_id => nullif($10, '')::uuid,
		  p_stage_id => nullif($11, '')::uuid,
		  p_created_by => nullif($12, '')::uuid,
		  p_first_touch_at => $8::timestamptz,
		  p_first_touch_channel => 'whatsapp',
		  p_last_contact_at => $8::timestamptz,
		  p_metadata => $9::jsonb
		)
	`, session.OrganizationID, firstNonEmpty(message.ContactName, message.ContactPhone), message.ContactPhone,
		firstNonEmpty(rule.CampaignLabel, message.CampaignHeadline, rule.SourceLabel, sourceDetailFallback), session.ID, message.Content,
		assignment.UserID, message.SentAt, metadata, assignment.PipelineID, assignment.StageID, createdBy,
		message.CampaignPropertyCode, propertyID).Scan(
		&lead.ID,
		&lead.AssignedUserID,
		&lead.Name,
		&lead.IsNew,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		// The database guard is intentionally a second fail-closed layer for
		// every CTWA creation mode. Committing a conversation/message without the
		// requested lead would consume the provider event and lose the lead.
		return nativeEvolutionLead{}, errors.New("WhatsApp CTWA lead creation context was rejected")
	}
	if err != nil {
		return nativeEvolutionLead{}, err
	}
	if rule.ManagedMessageDistribution && lead.IsNew {
		if err := tx.QueryRow(ctx, `
			select coalesce(assigned_user_id::text, ''), coalesce(name, '')
			from public.leads
			where organization_id = $1::uuid and id = $2::uuid
		`, session.OrganizationID, lead.ID).Scan(&lead.AssignedUserID, &lead.Name); err != nil {
			return nativeEvolutionLead{}, err
		}
	}
	if lead.IsNew && assignment.RoundRobinID != "" {
		if _, err := tx.Exec(ctx, `
			update public.round_robins
			set current_position = $3, updated_at = now()
			where organization_id = $1::uuid and id = $2::uuid
		`, session.OrganizationID, assignment.RoundRobinID, assignment.RoundRobinPosition); err != nil {
			return nativeEvolutionLead{}, err
		}
		if _, err := tx.Exec(ctx, `
			insert into public.round_robin_logs (
			  organization_id, round_robin_id, lead_id, assigned_user_id, reason, metadata
			)
			select $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'whatsapp_inbound_rule', $5::jsonb
			where not exists (
			  select 1 from public.round_robin_logs log
			  where log.organization_id = $1::uuid and log.round_robin_id = $2::uuid
			    and log.lead_id = $3::uuid and log.metadata->>'message_id' = $6
			)
		`, session.OrganizationID, assignment.RoundRobinID, lead.ID, assignment.UserID,
			jsonb(map[string]any{
				"whatsapp_session_id": session.ID,
				"matched_rule_id":     rule.ID,
				"message_id":          message.ProviderMessageID,
			}), message.ProviderMessageID); err != nil {
			return nativeEvolutionLead{}, err
		}
	}
	return lead, nil
}

func nativeCTWALeadAssignmentRule(rule nativeInboundRule) nativeInboundRule {
	if rule.ManagedMessageDistribution {
		return rule
	}
	// CTWA without a canonical managed queue falls back only to the active
	// session owner. Legacy rule users, teams, pipelines and round robins must
	// not bypass canonical schedules, tags or redistribution.
	return nativeInboundRule{}
}

func nativeTargetRoundRobinID(rule nativeInboundRule, assignment nativeLeadAssignment) string {
	if rule.ManagedMessageDistribution {
		return rule.TargetRoundRobinID
	}
	return assignment.RoundRobinID
}

func resolveNativeCampaignProperty(ctx context.Context, tx pgx.Tx, organizationID string, rawCode string) (string, error) {
	code := strings.TrimSpace(rawCode)
	if code == "" {
		return "", nil
	}
	rows, err := tx.Query(ctx, `
		select property.id::text
		from public.properties property
		where property.organization_id = $1::uuid
		  and (
		    btrim(coalesce(property.code, '')) = $2
		    or btrim(coalesce(property.referencia_alternativa, '')) = $2
		    or btrim(coalesce(property.external_id, '')) = $2
		    or btrim(coalesce(property.imoview_codigo, '')) = $2
		    or btrim(coalesce(property.vista_codigo, '')) = $2
		  )
		order by property.updated_at desc, property.id
		limit 2
		for share
	`, organizationID, code)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	matches := make([]string, 0, 2)
	for rows.Next() {
		var propertyID string
		if err := rows.Scan(&propertyID); err != nil {
			return "", err
		}
		matches = append(matches, propertyID)
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	// Duplicate property codes are unsafe: never guess and never cross an
	// organization boundary merely because an external reference matches.
	if len(matches) != 1 {
		return "", nil
	}
	return matches[0], nil
}

func insertNativeEvolutionMessage(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession, conversation nativeEvolutionConversation, message nativeEvolutionMessage) (bool, string, string, error) {
	messageMetadata := jsonb(nativeEvolutionMessageMetadata(message))
	var existingID, existingConversationID, existingStatus string
	err := tx.QueryRow(ctx, `
		select id::text, conversation_id::text, status
		from public.whatsapp_messages
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and (
		    message_id = $3 or provider_message_id = $3 or client_message_id = $3
		  )
		limit 1
		for update
	`, session.OrganizationID, session.ID, message.ProviderMessageID).Scan(&existingID, &existingConversationID, &existingStatus)
	if err == nil {
		incomingStatus := "received"
		if message.FromMe {
			incomingStatus = "sent"
		}
		status := nativeMonotonicStatus(existingStatus, incomingStatus)
		_, err = tx.Exec(ctx, `
			update public.whatsapp_messages
			set provider_message_id = coalesce(provider_message_id, $4),
			    message_id = coalesce(message_id, $4),
			    status = $5,
			    content = coalesce(content, nullif($6, '')),
			    media_url = coalesce(media_url, nullif($7, '')),
			    media_mime_type = coalesce(media_mime_type, nullif($8, '')),
			    media_storage_path = coalesce(media_storage_path, nullif($9, '')),
			    media_status = case
			      when coalesce(media_storage_path, nullif($9, '')) is not null then 'ready'
			      when media_status in ('ready', 'pending') then media_status
			      else coalesce(nullif($13, ''), media_status)
			    end,
			    media_error = case
			      when coalesce(media_storage_path, nullif($9, '')) is not null then null
			      when media_status in ('ready', 'pending') then media_error
			      else coalesce(nullif($14, ''), media_error)
			    end,
			    media_size = coalesce(media_size, nullif($11, 0)),
			    sent_at = coalesce(sent_at, $10),
			    received_at = case when from_me then received_at else coalesce(received_at, now()) end,
			    metadata = coalesce(metadata, '{}'::jsonb) || $12::jsonb,
			    updated_at = now()
			where organization_id = $1::uuid and session_id = $2::uuid and id = $3::uuid
		`, session.OrganizationID, session.ID, existingID, message.ProviderMessageID, status, message.Content, message.MediaURL, message.MediaMimeType, message.MediaStoragePath, message.SentAt, message.MediaSize, messageMetadata, message.MediaStatus, message.MediaError)
		return false, existingConversationID, existingID, err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return false, "", "", err
	}

	status := "received"
	direction := "inbound"
	if message.FromMe {
		status = "sent"
		direction = "outbound"
	}
	mediaStatus := message.MediaStatus
	mediaError := message.MediaError
	if nativeIsMediaType(message.MessageType) {
		if message.MediaStoragePath != "" {
			mediaStatus = "ready"
			mediaError = ""
		} else if mediaStatus == "" {
			mediaStatus = "pending"
		}
	}
	var insertedID string
	err = tx.QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id, lead_id,
			provider_message_id, message_id, from_me, direction, content,
			message_type, media_url, media_mime_type, media_storage_path,
			media_status, media_error, media_size, remote_jid, sender_jid,
			sender_name, status, sent_at, received_at, metadata
		) values (
			$1::uuid, $2::uuid, $3::uuid, nullif($4, '')::uuid,
			$5, $5, $6, $7, nullif($8, ''),
			$9, nullif($10, ''), nullif($11, ''), nullif($12, ''),
			nullif($13, ''), nullif($14, ''), nullif($15, 0), $16, nullif($17, ''),
			nullif($18, ''), $19, $20, case when $6 then null else now() end,
			$21::jsonb
		)
		on conflict (conversation_id, message_id) do nothing
		returning id::text
	`, session.OrganizationID, conversation.ID, session.ID, conversation.LeadID,
		message.ProviderMessageID, message.FromMe, direction, message.Content,
		message.MessageType, message.MediaURL, message.MediaMimeType, message.MediaStoragePath,
		mediaStatus, mediaError, message.MediaSize, conversation.RemoteJID, message.SenderJID,
		message.SenderName, status, message.SentAt, messageMetadata).Scan(&insertedID)
	if errors.Is(err, pgx.ErrNoRows) {
		if err := tx.QueryRow(ctx, `
			select id::text from public.whatsapp_messages
			where organization_id = $1::uuid and session_id = $2::uuid
			  and conversation_id = $3::uuid and message_id = $4
			limit 1
		`, session.OrganizationID, session.ID, conversation.ID, message.ProviderMessageID).Scan(&insertedID); err != nil {
			return false, "", "", err
		}
		return false, conversation.ID, insertedID, nil
	}
	return err == nil, conversation.ID, insertedID, err
}

func nativeEvolutionMessageMetadata(message nativeEvolutionMessage) map[string]any {
	return map[string]any{
		"source":               "evolution_go_webhook",
		"whatsapp_attribution": nativeCampaignAttribution(message),
		"whatsapp_referral":    nativeCampaignReferralSnapshot(message),
	}
}

func updateNativeEvolutionConversation(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession, conversation nativeEvolutionConversation, message nativeEvolutionMessage) error {
	preview := nativeEvolutionPreview(message)
	unreadIncrement := 0
	if !message.FromMe {
		unreadIncrement = 1
	}
	_, err := tx.Exec(ctx, `
		update public.whatsapp_conversations
		set last_message = case when last_message_at is null or last_message_at <= $4 then $5 else last_message end,
		    last_message_preview = case when last_message_at is null or last_message_at <= $4 then $5 else last_message_preview end,
		    last_message_at = greatest(coalesce(last_message_at, $4), $4),
		    unread_count = greatest(0, coalesce(unread_count, 0) + $6),
		    contact_name = coalesce(contact_name, nullif($7, '')),
		    contact_phone = coalesce(contact_phone, nullif($8, '')),
		    updated_at = now()
		where organization_id = $1::uuid and session_id = $2::uuid and id = $3::uuid
	`, session.OrganizationID, session.ID, conversation.ID, message.SentAt, preview, unreadIncrement, message.ContactName, message.ContactPhone)
	return err
}

func processNativeEvolutionDeletion(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession, message nativeEvolutionMessage) error {
	var targetID, conversationID string
	var targetSentAt *time.Time
	err := tx.QueryRow(ctx, `
		select id::text, conversation_id::text, sent_at
		from public.whatsapp_messages
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and (message_id = $3 or provider_message_id = $3 or client_message_id = $3)
		limit 1
		for update
	`, session.OrganizationID, session.ID, message.DeletionTargetID).Scan(&targetID, &conversationID, &targetSentAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("deletion target %s not found yet", message.DeletionTargetID)
	}
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		update public.whatsapp_messages
		set content = 'Esta mensagem foi apagada',
		    message_type = 'deleted',
		    media_url = null,
		    media_storage_path = null,
		    media_status = null,
		    media_error = null,
		    media_mime_type = null,
		    media_size = null,
		    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
		      'deleted', true,
		      'deleted_at', coalesce(metadata->>'deleted_at', now()::text),
		      'deletion_event_id', $4
		    ),
		    updated_at = now()
		where organization_id = $1::uuid and session_id = $2::uuid and id = $3::uuid
	`, session.OrganizationID, session.ID, targetID, message.ProviderMessageID); err != nil {
		return err
	}
	if targetSentAt != nil {
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_conversations
			set last_message = 'Esta mensagem foi apagada',
			    last_message_preview = 'Esta mensagem foi apagada',
			    updated_at = now()
			where organization_id = $1::uuid and session_id = $2::uuid and id = $3::uuid
			  and last_message_at = $4::timestamptz
		`, session.OrganizationID, session.ID, conversationID, *targetSentAt); err != nil {
			return err
		}
	}
	return nil
}

func processNativeEvolutionReaction(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession, message nativeEvolutionMessage) error {
	var targetID, conversationID, leadID, canonicalProviderID string
	err := tx.QueryRow(ctx, `
		select id::text, conversation_id::text, coalesce(lead_id::text, ''),
		       coalesce(provider_message_id, message_id, client_message_id, id::text)
		from public.whatsapp_messages
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and (message_id = $3 or provider_message_id = $3 or client_message_id = $3)
		limit 1
		for update
	`, session.OrganizationID, session.ID, message.ReactionTargetID).Scan(&targetID, &conversationID, &leadID, &canonicalProviderID)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("reaction target %s not found yet", message.ReactionTargetID)
	}
	if err != nil {
		return err
	}
	actorJID := normalizeRemoteAlias(message.SenderJID)
	if message.FromMe {
		var valid bool
		actorJID, valid = canonicalWhatsAppSelfJID(message.SenderJID)
		if !valid {
			actorJID, valid = canonicalWhatsAppSelfJID(session.PhoneNumber)
		}
		if !valid {
			return fmt.Errorf("outbound reaction actor identity is unavailable")
		}
	}
	actorJID = firstNonEmpty(actorJID, message.RemoteJID)
	if actorJID == "" {
		return fmt.Errorf("reaction actor is missing")
	}
	state := "active"
	if message.ReactionEmoji == "" {
		state = "removed"
	}
	if _, err := tx.Exec(ctx, `
		insert into public.whatsapp_message_reactions (
			organization_id, session_id, conversation_id, target_message_id,
			target_provider_message_id, provider_reaction_message_id, actor_jid,
			actor_name, from_me, emoji, status, reacted_at, removed_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, $6, $7, nullif($8, ''), $9, nullif($10, ''), $11, $12::timestamptz,
			case when $11 = 'removed' then $12::timestamptz else null::timestamptz end
		)
		on conflict (organization_id, session_id, target_provider_message_id, actor_jid)
		do update set
			provider_reaction_message_id = excluded.provider_reaction_message_id,
			actor_name = coalesce(excluded.actor_name, whatsapp_message_reactions.actor_name),
			from_me = excluded.from_me,
			emoji = excluded.emoji,
			status = excluded.status,
			reacted_at = excluded.reacted_at,
			removed_at = excluded.removed_at,
			updated_at = now()
	`, session.OrganizationID, session.ID, conversationID, targetID, canonicalProviderID,
		message.ProviderMessageID, actorJID, message.SenderName, message.FromMe,
		message.ReactionEmoji, state, message.SentAt); err != nil {
		return err
	}

	direction := "inbound"
	status := "received"
	if message.FromMe {
		direction = "outbound"
		status = "sent"
	}
	_, err = tx.Exec(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id, lead_id,
			provider_message_id, message_id, from_me, direction, content,
			message_type, reaction_to_message_id, reaction_emoji,
			reaction_sender_jid, reaction_sender_name, remote_jid, sender_jid,
			sender_name, status, sent_at, received_at, metadata
		) values (
			$1::uuid, $2::uuid, $3::uuid, nullif($4, '')::uuid,
			$5, $5, $6, $7, nullif($8, ''),
			'reaction', $9, nullif($8, ''), $10, nullif($11, ''), $12, $10,
			nullif($11, ''), $13, $14, case when $6 then null else now() end,
			jsonb_build_object('source', 'evolution_go_native')
		)
		on conflict (conversation_id, message_id)
		do update set
			content = excluded.content,
			reaction_emoji = excluded.reaction_emoji,
			reaction_sender_jid = excluded.reaction_sender_jid,
			reaction_sender_name = excluded.reaction_sender_name,
			sent_at = excluded.sent_at,
			updated_at = now()
	`, session.OrganizationID, conversationID, session.ID, leadID,
		message.ProviderMessageID, message.FromMe, direction, message.ReactionEmoji,
		canonicalProviderID, actorJID, message.SenderName, message.RemoteJID, status, message.SentAt)
	return err
}

func (repo Repository) processNativeEvolutionStatuses(ctx context.Context, item pendingEvolutionWebhook, statuses []nativeEvolutionStatus) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	session, err := loadNativeEvolutionSession(ctx, tx, item)
	if err != nil {
		return err
	}
	failedOutboxIDs := make([]string, 0)
	failedOutboxSeen := map[string]struct{}{}
	for _, receipt := range statuses {
		matched := map[string]bool{}
		type messageTarget struct {
			id       string
			current  string
			message  string
			provider string
			client   string
		}
		messageTargets := []messageTarget{}
		rows, err := tx.Query(ctx, `
			select id::text, coalesce(message_id, ''), coalesce(provider_message_id, ''),
			       coalesce(client_message_id, ''), status
			from public.whatsapp_messages
			where organization_id = $1::uuid and session_id = $2::uuid
			  and (
			    message_id = any($3::text[])
			    or provider_message_id = any($3::text[])
			    or client_message_id = any($3::text[])
			  )
			for update
		`, session.OrganizationID, session.ID, receipt.MessageIDs)
		if err != nil {
			return err
		}
		for rows.Next() {
			var target messageTarget
			if err := rows.Scan(&target.id, &target.message, &target.provider, &target.client, &target.current); err != nil {
				rows.Close()
				return err
			}
			messageTargets = append(messageTargets, target)
			markNativeMatchedIDs(matched, receipt.MessageIDs, target.message, target.provider, target.client)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		for _, target := range messageTargets {
			status := nativeMonotonicStatus(target.current, receipt.Status)
			if _, err := tx.Exec(ctx, `
				update public.whatsapp_messages
				set status = $4,
				    delivered_at = case when $4 = 'delivered' then coalesce(delivered_at, $5) else delivered_at end,
				    read_at = case when $4 = 'read' then coalesce(read_at, $5) else read_at end,
				    updated_at = now()
				where organization_id = $1::uuid and session_id = $2::uuid and id = $3::uuid
			`, session.OrganizationID, session.ID, target.id, status, receipt.OccurredAt); err != nil {
				return err
			}
		}

		type outboxTarget struct {
			id       string
			current  string
			provider string
			client   string
		}
		outboxTargets := []outboxTarget{}
		outboxRows, err := tx.Query(ctx, `
			select id::text, coalesce(provider_message_id, ''), client_message_id, status
			from public.whatsapp_outbox
			where organization_id = $1::uuid and session_id = $2::uuid
			  and (provider_message_id = any($3::text[]) or client_message_id = any($3::text[]))
			for update
		`, session.OrganizationID, session.ID, receipt.MessageIDs)
		if err != nil {
			return err
		}
		for outboxRows.Next() {
			var target outboxTarget
			if err := outboxRows.Scan(&target.id, &target.provider, &target.client, &target.current); err != nil {
				outboxRows.Close()
				return err
			}
			outboxTargets = append(outboxTargets, target)
			markNativeMatchedIDs(matched, receipt.MessageIDs, target.provider, target.client)
		}
		if err := outboxRows.Err(); err != nil {
			outboxRows.Close()
			return err
		}
		outboxRows.Close()
		for _, target := range outboxTargets {
			status := nativeMonotonicOutboxStatus(target.current, receipt.Status)
			if _, err := tx.Exec(ctx, `
				update public.whatsapp_outbox
				set status = $4,
				    sent_at = case when $4 = 'sent' then coalesce(sent_at, $5) else sent_at end,
				    delivered_at = case when $4 = 'delivered' then coalesce(delivered_at, $5) else delivered_at end,
				    read_at = case when $4 = 'read' then coalesce(read_at, $5) else read_at end,
				    failed_at = case when $4 = 'failed' then coalesce(failed_at, $5) else failed_at end,
				    last_error = case
				      when $4 = 'failed' then nullif($6, '')
				      when $4 in ('sent', 'delivered', 'read') then null
				      else last_error
				    end,
				    locked_at = case when $4 in ('sent', 'delivered', 'read', 'failed') then null else locked_at end,
				    locked_by = case when $4 in ('sent', 'delivered', 'read', 'failed') then null else locked_by end,
				    updated_at = now()
				where organization_id = $1::uuid and session_id = $2::uuid and id = $3::uuid
			`, session.OrganizationID, session.ID, target.id, status, receipt.OccurredAt, receipt.Error); err != nil {
				return err
			}
			if status == "failed" {
				if _, alreadyQueued := failedOutboxSeen[target.id]; !alreadyQueued {
					failedOutboxSeen[target.id] = struct{}{}
					failedOutboxIDs = append(failedOutboxIDs, target.id)
				}
			}
		}

		missing := []string{}
		for _, id := range receipt.MessageIDs {
			if !matched[id] {
				missing = append(missing, id)
			}
		}
		if len(missing) > 0 {
			return fmt.Errorf("message status target not found yet: %s", strings.Join(missing, ","))
		}
	}
	for _, outboxID := range failedOutboxIDs {
		if err := repo.syncTerminalWhatsAppOutboxFailures(ctx, tx, outboxID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func markNativeMatchedIDs(matched map[string]bool, expected []string, actual ...string) {
	for _, candidate := range actual {
		for _, id := range expected {
			if candidate != "" && candidate == id {
				matched[id] = true
			}
		}
	}
}

func nativeEvolutionPreview(message nativeEvolutionMessage) string {
	if message.Content != "" {
		return message.Content
	}
	switch message.MessageType {
	case "image":
		return "Imagem"
	case "video":
		return "Video"
	case "audio":
		return "Audio"
	case "document":
		return "Documento"
	case "sticker":
		return "Figurinha"
	default:
		return "Mensagem"
	}
}

func nativeIsMediaType(messageType string) bool {
	switch messageType {
	case "image", "video", "audio", "document", "sticker":
		return true
	default:
		return false
	}
}

func nativeIsStatusEvent(event string) bool {
	return strings.Contains(event, "status") || strings.Contains(event, "receipt") || strings.Contains(event, "ack")
}

func nativeEvolutionQRCode(payload map[string]any) string {
	return firstNonEmpty(
		firstString(payload, "qrcode", "Qrcode", "qrCode", "base64", "code"),
		firstString(payload, "data.qrcode", "data.Qrcode", "data.qrCode", "data.base64", "data.code"),
		firstString(payload, "Data.qrcode", "Data.Qrcode", "Data.qrCode", "Data.base64", "Data.code"),
	)
}

func nativeEvolutionConnectionStatus(payload map[string]any, event string) (string, bool, string) {
	data := nativeFirstMap(payload, "data", "Data")
	if len(data) == 0 {
		data = payload
	}
	state := strings.ToLower(firstNonEmpty(
		firstString(data, "state", "State", "connectionStatus", "status"),
		firstString(payload, "state", "State", "connectionStatus", "status"),
	))
	loggedIn, loggedInPresent := nativeBool(nativeFirstValue(data, "loggedIn", "LoggedIn"))
	connected, connectedPresent := nativeBool(nativeFirstValue(data, "connected", "Connected"))
	errorMessage := firstString(data, "error", "message", "reason")

	if loggedInPresent && connectedPresent {
		if loggedIn && connected {
			return "connected", true, ""
		}
		if !loggedIn && connected {
			return "qr_ready", true, ""
		}
		return "disconnected", true, errorMessage
	}
	if loggedInPresent {
		if loggedIn {
			return "connected", true, ""
		}
		return "disconnected", true, errorMessage
	}
	if connectedPresent {
		if connected {
			return "connected", true, ""
		}
		return "disconnected", true, errorMessage
	}
	if state == "open" || state == "connected" {
		return "connected", true, ""
	}
	if state == "qr" || state == "qrcode" || state == "qr_ready" || state == "pairing" || state == "connecting" || nativeEvolutionQRCode(payload) != "" {
		return "qr_ready", true, ""
	}
	if strings.Contains(event, "logout") ||
		state == "close" || state == "closed" || state == "disconnected" || state == "offline" || state == "logged_out" {
		return "disconnected", true, errorMessage
	}
	if state == "error" || state == "failed" || state == "failure" {
		return "", true, firstNonEmpty(errorMessage, "Falha na conexao")
	}
	return "", false, ""
}
