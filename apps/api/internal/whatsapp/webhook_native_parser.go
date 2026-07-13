package whatsapp

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type nativeEvolutionMessage struct {
	ProviderMessageID    string
	RemoteJID            string
	RemoteAliases        []string
	ContactPhone         string
	ContactName          string
	SenderJID            string
	SenderName           string
	Content              string
	MessageType          string
	FromMe               bool
	IsGroup              bool
	SentAt               time.Time
	MediaURL             string
	MediaBase64          string
	MediaMimeType        string
	MediaStoragePath     string
	MediaSize            int64
	ReactionTargetID     string
	ReactionEmoji        string
	IsReaction           bool
	DeletionTargetID     string
	IsDeletion           bool
	HasCampaignSignal    bool
	CampaignSourceType   string
	CampaignSourceID     string
	CampaignSourceURL    string
	CampaignCTWAClid     string
	CampaignHeadline     string
	CampaignPropertyCode string
	UnsupportedID        bool
	UnsupportedMessage   bool
	Raw                  map[string]any
}

type nativeEvolutionStatus struct {
	MessageIDs []string
	Status     string
	OccurredAt time.Time
	Error      string
}

func decodeNativeEvolutionPayload(payload []byte) (map[string]any, error) {
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return nil, err
	}
	return decoded, nil
}

func nativeEvolutionEventName(payload map[string]any, fallback string) string {
	return strings.ToLower(strings.TrimSpace(firstNonEmpty(
		firstString(payload, "event", "Event", "type", "Type", "action", "data.event", "Data.Event"),
		fallback,
	)))
}

func extractNativeEvolutionMessages(payload map[string]any) []nativeEvolutionMessage {
	data := nativeFirstValue(payload, "data", "Data")
	candidates := []any{
		nativeFirstValue(payload, "messages", "Messages"),
		nativeFirstValue(payload, "message", "Message"),
		nativeFirstValue(mapFromAny(data), "messages", "Messages"),
		nativeFirstValue(mapFromAny(data), "message", "Message"),
		data,
		payload,
	}

	seen := map[string]bool{}
	result := make([]nativeEvolutionMessage, 0, 1)
	for _, candidate := range candidates {
		for _, raw := range nativeObjectList(candidate) {
			if !nativeLooksLikeMessage(raw) {
				continue
			}
			message, ok := normalizeNativeEvolutionMessage(raw)
			if !ok {
				continue
			}
			key := message.ProviderMessageID + "\x00" + message.RemoteJID
			if seen[key] {
				continue
			}
			seen[key] = true
			result = append(result, message)
		}
	}
	return result
}

func normalizeNativeEvolutionMessage(raw map[string]any) (nativeEvolutionMessage, bool) {
	info := nativeFirstMap(raw, "Info", "info")
	key := nativeFirstMap(raw, "key", "Key")
	messageNode := nativeFirstMap(raw, "message", "Message")
	if len(messageNode) == 0 {
		messageNode = raw
	}

	fromMe, _ := nativeBool(nativeFirstValue(
		info,
		"IsFromMe", "fromMe", "FromMe",
	))
	if value, ok := nativeBool(nativeFirstValue(key, "fromMe", "FromMe")); ok {
		fromMe = value
	}
	if value, ok := nativeBool(nativeFirstValue(raw, "fromMe", "from_me", "FromMe")); ok {
		fromMe = value
	}

	groupHint, _ := nativeBool(nativeFirstValue(info, "IsGroup", "isGroup"))
	if value, ok := nativeBool(nativeFirstValue(raw, "isGroup", "is_group")); ok {
		groupHint = value
	}

	remoteCandidate := firstNonEmpty(
		firstString(key, "remoteJid", "RemoteJID", "remote_jid"),
		firstString(raw, "remoteJid", "remote_jid", "chat", "chatId", "chatJid", "chat_jid", "jid"),
		firstString(info, "Chat", "chat", "JID", "jid"),
	)
	if strings.Contains(strings.ToLower(remoteCandidate), "@g.us") {
		groupHint = true
	}

	phoneCandidate := ""
	if fromMe {
		phoneCandidate = firstNonEmpty(
			firstString(info, "RecipientPN", "recipientPN", "RecipientPn", "Recipient", "recipient", "RecipientAlt", "recipientAlt"),
			firstString(raw, "recipient", "recipientJid", "to", "phone", "number"),
			remoteCandidate,
		)
	} else {
		phoneCandidate = firstNonEmpty(
			firstString(info, "SenderPN", "senderPN", "SenderPn", "Sender", "sender", "SenderAlt", "senderAlt"),
			firstString(raw, "sender", "senderJid", "from", "phone", "number"),
			remoteCandidate,
		)
	}

	identityPhone := phoneCandidate
	if groupHint {
		identityPhone = ""
	}
	identity := newWhatsAppContactIdentity(identityPhone, remoteCandidate, groupHint)
	if identity.RemoteJID == "" {
		return nativeEvolutionMessage{}, false
	}
	unsupportedIdentity := !identity.IsGroup && identity.ContactPhone == "" && isOpaqueWhatsAppJID(identity.RemoteJID)

	senderJID := firstNonEmpty(
		firstString(key, "participant", "Participant"),
		firstString(raw, "participant", "sender", "senderJid"),
		firstString(info, "SenderPN", "senderPN", "Sender", "sender"),
	)
	if senderJID == "" && !fromMe {
		senderJID = identity.RemoteJID
	}
	if normalized := normalizeRemoteAlias(senderJID); normalized != "" {
		senderJID = normalized
	}

	mediaType, mediaBlock := nativeMediaBlock(messageNode, raw, info)
	content := firstNonEmpty(
		nativeStringValue(messageNode["conversation"]),
		nativeStringValue(messageNode["Conversation"]),
		firstString(messageNode, "extendedTextMessage.text", "ExtendedTextMessage.Text"),
		firstString(mediaBlock, "caption", "Caption"),
		firstString(raw, "text", "body", "content", "caption"),
	)
	if mediaType == "" {
		mediaType = "text"
	}

	reaction := nativeFirstMap(messageNode, "reactionMessage", "ReactionMessage", "encReactionMessage", "EncReactionMessage")
	if len(reaction) == 0 {
		reaction = nativeFirstMap(raw, "reaction", "reactionMessage", "ReactionMessage")
	}
	isReaction := len(reaction) > 0
	protocolMessage := nativeFirstMap(messageNode, "protocolMessage", "ProtocolMessage")
	deletionTarget := firstString(protocolMessage, "key.id", "key.ID", "Key.id", "Key.ID", "messageId", "message_id")
	protocolType := strings.ToLower(firstString(protocolMessage, "type", "Type", "protocolType", "protocol_type"))
	isDeletion := deletionTarget != "" && nativeIsDeletionProtocolType(protocolType)
	reactionTarget := ""
	reactionEmoji := ""
	if isReaction {
		reactionTarget = firstString(reaction, "key.id", "key.ID", "Key.id", "Key.ID", "messageId", "messageID", "message_id")
		reactionEmoji = firstString(reaction, "text", "emoji")
		mediaType = "reaction"
		content = reactionEmoji
	}
	if isDeletion {
		mediaType = "deleted_event"
		content = ""
	}
	referral := nativeCampaignReferral(raw)
	referralSourceURL := firstString(referral, "source_url", "sourceUrl", "SourceURL", "url", "link")

	sentAt := nativeTimestamp(nativeFirstValue(
		info,
		"Timestamp", "timestamp",
	))
	if sentAt.IsZero() {
		sentAt = nativeTimestamp(nativeFirstValue(raw, "messageTimestamp", "timestamp", "createdAt", "created_at"))
	}
	if sentAt.IsZero() {
		sentAt = time.Now().UTC()
	}

	providerMessageID := firstNonEmpty(
		firstString(info, "ID", "Id", "id"),
		firstString(key, "id", "ID"),
		firstString(raw, "id", "ID", "messageId", "message_id", "provider_message_id"),
	)
	if providerMessageID == "" {
		encoded, _ := json.Marshal(raw)
		digest := sha256.Sum256(encoded)
		providerMessageID = "native-" + hex.EncodeToString(digest[:16])
	}

	mediaURL := firstNonEmpty(
		firstString(mediaBlock, "url", "URL", "mediaUrl", "media_url"),
		firstString(messageNode, "url", "URL", "mediaUrl", "media_url"),
		firstString(raw, "mediaUrl", "media_url", "url"),
	)
	mediaBase64 := firstNonEmpty(
		firstString(mediaBlock, "base64", "Base64", "media", "file", "thumbnailBase64", "jpegThumbnail"),
		firstString(messageNode, "base64", "Base64", "media", "file", "thumbnailBase64", "jpegThumbnail"),
		firstString(raw, "base64", "Base64", "media", "file", "thumbnailBase64", "jpegThumbnail"),
	)
	if strings.HasPrefix(mediaBase64, "http://") || strings.HasPrefix(mediaBase64, "https://") {
		if mediaURL == "" {
			mediaURL = mediaBase64
		}
		mediaBase64 = ""
	}
	mediaMimeType := firstNonEmpty(
		firstString(mediaBlock, "mimetype", "Mimetype", "mimeType"),
		firstString(messageNode, "mimetype", "Mimetype", "mimeType"),
		firstString(raw, "mimetype", "mimeType"),
	)

	aliases := identity.RemoteAliases()
	aliases = append(aliases, remoteCandidate)
	if !identity.IsGroup {
		aliases = append(aliases, phoneCandidate)
	}
	// A group participant must never become an alias of the group chat. For an
	// outbound direct message SenderPN is our own device, not the contact.
	if !identity.IsGroup && !fromMe {
		aliases = append(aliases, senderJID)
	}
	aliases = uniqueStrings(aliases...)
	contactName := ""
	if fromMe {
		contactName = firstString(raw, "contactName", "chatName", "name", "contact.name")
	} else {
		contactName = firstNonEmpty(
			firstString(info, "PushName", "pushName"),
			firstString(raw, "pushName", "contactName", "notifyName", "chatName", "name"),
		)
	}
	return nativeEvolutionMessage{
		ProviderMessageID:    stripNullBytes(strings.TrimSpace(providerMessageID)),
		RemoteJID:            identity.RemoteJID,
		RemoteAliases:        aliases,
		ContactPhone:         identity.ContactPhone,
		ContactName:          firstNonEmpty(contactName, identity.ContactPhone),
		SenderJID:            senderJID,
		SenderName:           firstNonEmpty(firstString(info, "PushName", "pushName"), firstString(raw, "pushName", "senderName", "notifyName")),
		Content:              stripNullBytes(content),
		MessageType:          mediaType,
		FromMe:               fromMe,
		IsGroup:              identity.IsGroup,
		SentAt:               sentAt.UTC(),
		MediaURL:             mediaURL,
		MediaBase64:          mediaBase64,
		MediaMimeType:        mediaMimeType,
		MediaSize:            nativeInt64(nativeFirstValue(mediaBlock, "fileLength", "FileLength", "fileSize", "mediaSize")),
		ReactionTargetID:     reactionTarget,
		ReactionEmoji:        reactionEmoji,
		IsReaction:           isReaction,
		DeletionTargetID:     deletionTarget,
		IsDeletion:           isDeletion,
		HasCampaignSignal:    nativeHasCampaignSignal(raw),
		CampaignSourceType:   firstString(referral, "source_type", "sourceType", "SourceType"),
		CampaignSourceID:     firstString(referral, "source_id", "sourceId", "SourceID", "ad_id", "adId", "AdID"),
		CampaignSourceURL:    referralSourceURL,
		CampaignCTWAClid:     firstString(referral, "ctwa_clid", "ctwaClid", "CTWAClid", "click_id", "clickId"),
		CampaignHeadline:     firstString(referral, "headline", "title", "Title", "body", "description"),
		CampaignPropertyCode: nativeCampaignPropertyCode(content, referralSourceURL),
		UnsupportedID:        unsupportedIdentity,
		UnsupportedMessage:   len(protocolMessage) > 0 && !isDeletion,
		Raw:                  raw,
	}, true
}

func extractNativeEvolutionStatuses(payload map[string]any) []nativeEvolutionStatus {
	data := nativeFirstValue(payload, "data", "Data")
	dataMap := mapFromAny(data)
	candidates := []any{
		nativeFirstValue(dataMap, "statuses", "Statuses"),
		nativeFirstValue(dataMap, "status", "Status"),
		nativeFirstValue(dataMap, "receipts", "Receipts"),
		data,
	}
	result := make([]nativeEvolutionStatus, 0, 1)
	seen := map[string]bool{}
	for _, candidate := range candidates {
		for _, entry := range nativeObjectList(candidate) {
			ids := nativeStringList(nativeFirstValue(entry, "MessageIDs", "messageIds", "message_ids"))
			ids = append(ids, firstString(entry, "messageId", "message_id", "id", "ID", "key.id", "Key.ID"))
			ids = uniqueStrings(ids...)
			status := nativeProviderStatus(firstNonEmpty(
				firstString(entry, "status", "Status", "state", "State", "ack", "Ack", "type", "Type"),
				firstString(payload, "state", "State", "status", "Status"),
			))
			if len(ids) == 0 || status == "" {
				continue
			}
			key := strings.Join(ids, ",") + "\x00" + status
			if seen[key] {
				continue
			}
			seen[key] = true
			occurredAt := nativeTimestamp(nativeFirstValue(entry, "timestamp", "Timestamp", "time", "date"))
			if occurredAt.IsZero() {
				occurredAt = time.Now().UTC()
			}
			result = append(result, nativeEvolutionStatus{
				MessageIDs: ids,
				Status:     status,
				OccurredAt: occurredAt.UTC(),
				Error:      firstNonEmpty(firstString(entry, "error", "message", "reason"), "Falha no envio"),
			})
		}
	}
	return result
}

func nativeProviderStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "3", "4", "read", "played":
		return "read"
	case "2", "delivered", "delivery", "device_ack", "deviceack":
		return "delivered"
	case "1", "sent", "server_ack", "serverack":
		return "sent"
	case "0", "queued", "pending":
		return "pending"
	case "-1", "failed", "error":
		return "failed"
	default:
		return ""
	}
}

func nativeMonotonicStatus(current string, incoming string) string {
	current = strings.ToLower(strings.TrimSpace(current))
	incoming = strings.ToLower(strings.TrimSpace(incoming))
	if current == "" {
		return incoming
	}
	if incoming == "" || current == incoming || current == "read" {
		return current
	}
	if incoming == "read" {
		return incoming
	}
	if (current == "sent" || current == "delivered") && (incoming == "pending" || incoming == "queued") {
		return current
	}
	if current == "delivered" && incoming == "sent" {
		return current
	}
	if current == "failed" && (incoming == "pending" || incoming == "sent" || incoming == "queued") {
		return current
	}
	if incoming == "failed" && (current == "delivered" || current == "read") {
		return current
	}
	return incoming
}

func nativeMediaBlock(messageNode map[string]any, raw map[string]any, info map[string]any) (string, map[string]any) {
	for _, candidate := range []struct {
		kind  string
		paths []string
	}{
		{kind: "image", paths: []string{"imageMessage", "ImageMessage"}},
		{kind: "video", paths: []string{"videoMessage", "VideoMessage"}},
		{kind: "audio", paths: []string{"audioMessage", "AudioMessage"}},
		{kind: "document", paths: []string{"documentMessage", "DocumentMessage"}},
		{kind: "sticker", paths: []string{"stickerMessage", "StickerMessage"}},
	} {
		if block := nativeFirstMap(messageNode, candidate.paths...); len(block) > 0 {
			return candidate.kind, block
		}
	}
	hint := strings.ToLower(firstNonEmpty(
		firstString(raw, "messageType", "type", "mediaType", "mediatype", "kind"),
		firstString(info, "MediaType", "mediaType", "MessageType", "messageType"),
	))
	for _, kind := range []string{"image", "video", "audio", "document", "sticker"} {
		if hint == kind {
			return kind, messageNode
		}
	}
	return "", map[string]any{}
}

func nativeHasCampaignSignal(value any) bool {
	var walk func(any, int) bool
	walk = func(current any, depth int) bool {
		if depth > 10 || current == nil {
			return false
		}
		switch typed := current.(type) {
		case map[string]any:
			for key, item := range typed {
				normalized := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(key, "_", ""), "-", ""))
				if normalized == "referral" || normalized == "externaladreply" || normalized == "ctwa" || normalized == "adsource" {
					return true
				}
				if walk(item, depth+1) {
					return true
				}
			}
		case []any:
			for _, item := range typed {
				if walk(item, depth+1) {
					return true
				}
			}
		}
		return false
	}
	return walk(value, 0)
}

func nativeCampaignReferral(value any) map[string]any {
	var walk func(any, int) map[string]any
	walk = func(current any, depth int) map[string]any {
		if depth > 10 || current == nil {
			return nil
		}
		switch typed := current.(type) {
		case map[string]any:
			for _, key := range []string{"externalAdReply", "ExternalAdReply", "externalAdReplyInfo", "quotedAd", "ad", "referral", "Referral"} {
				if nested, ok := typed[key].(map[string]any); ok {
					if candidate := walk(nested, depth+1); candidate != nil {
						return candidate
					}
				}
			}
			if firstString(typed,
				"source_type", "sourceType", "SourceType",
				"source_id", "sourceId", "SourceID", "ad_id", "adId", "AdID",
				"ctwa_clid", "ctwaClid", "source_url", "sourceUrl",
			) != "" {
				return typed
			}
			for _, nested := range typed {
				if candidate := walk(nested, depth+1); candidate != nil {
					return candidate
				}
			}
		case []any:
			for _, nested := range typed {
				if candidate := walk(nested, depth+1); candidate != nil {
					return candidate
				}
			}
		}
		return nil
	}
	return walk(value, 0)
}

func nativeIsDeletionProtocolType(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "0", "revoke", "message_revoke", "message-revoke", "delete", "deleted":
		return true
	default:
		return false
	}
}

var nativePropertyCodePattern = regexp.MustCompile(`(?i)\b(?:cod(?:igo)?|im[oó]vel|ref)\s*[:#-]?\s*([a-z0-9][a-z0-9._/-]{1,40})\b`)

func nativeCampaignPropertyCode(content string, sourceURL string) string {
	if parsed, err := url.Parse(strings.TrimSpace(sourceURL)); err == nil {
		for _, key := range []string{"property_code", "codigo", "cod", "imovel", "ref", "utm_content"} {
			if value := strings.TrimSpace(parsed.Query().Get(key)); value != "" {
				if len(value) > 80 {
					value = value[:80]
				}
				return value
			}
		}
	}
	if match := nativePropertyCodePattern.FindStringSubmatch(content + " " + sourceURL); len(match) > 1 {
		return strings.TrimSpace(match[1])
	}
	return ""
}

func nativeLooksLikeMessage(value map[string]any) bool {
	for _, key := range []string{"key", "Key", "Info", "info", "message", "Message", "messageType", "text", "body", "content", "message_id", "messageId", "ID"} {
		if _, ok := value[key]; ok {
			return true
		}
	}
	return false
}

func nativeFirstMap(value map[string]any, paths ...string) map[string]any {
	for _, path := range paths {
		if candidate, ok := nativeValueAt(value, path).(map[string]any); ok {
			return candidate
		}
	}
	return map[string]any{}
}

func nativeFirstValue(value map[string]any, paths ...string) any {
	for _, path := range paths {
		candidate := nativeValueAt(value, path)
		if candidate != nil {
			return candidate
		}
	}
	return nil
}

func nativeValueAt(value map[string]any, path string) any {
	var current any = value
	for _, key := range strings.Split(path, ".") {
		object, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = object[key]
	}
	return current
}

func nativeObjectList(value any) []map[string]any {
	switch typed := value.(type) {
	case map[string]any:
		return []map[string]any{typed}
	case []any:
		result := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			if object, ok := item.(map[string]any); ok {
				result = append(result, object)
			}
		}
		return result
	default:
		return nil
	}
}

func nativeStringList(value any) []string {
	result := []string{}
	switch typed := value.(type) {
	case []any:
		for _, item := range typed {
			if text := nativeStringValue(item); text != "" {
				result = append(result, text)
			}
		}
	case []string:
		result = append(result, typed...)
	default:
		if text := nativeStringValue(value); text != "" {
			result = append(result, text)
		}
	}
	return result
}

func nativeStringValue(value any) string {
	return strings.TrimSpace(stringFromAny(value))
}

func nativeBool(value any) (bool, bool) {
	switch typed := value.(type) {
	case bool:
		return typed, true
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "true", "1", "yes", "sim":
			return true, true
		case "false", "0", "no", "nao", "não":
			return false, true
		}
	case float64:
		return typed != 0, true
	}
	return false, false
}

func nativeTimestamp(value any) time.Time {
	switch typed := value.(type) {
	case float64:
		return nativeUnixTimestamp(int64(typed))
	case int64:
		return nativeUnixTimestamp(typed)
	case int:
		return nativeUnixTimestamp(int64(typed))
	case string:
		trimmed := strings.TrimSpace(typed)
		if numeric, err := strconv.ParseInt(trimmed, 10, 64); err == nil {
			return nativeUnixTimestamp(numeric)
		}
		if parsed, err := time.Parse(time.RFC3339Nano, trimmed); err == nil {
			return parsed
		}
	case map[string]any:
		return nativeTimestamp(nativeFirstValue(typed, "seconds", "Seconds", "_seconds"))
	}
	return time.Time{}
}

func nativeUnixTimestamp(value int64) time.Time {
	if value == 0 {
		return time.Time{}
	}
	if value < 10_000_000_000 {
		return time.Unix(value, 0)
	}
	return time.UnixMilli(value)
}

func nativeInt64(value any) int64 {
	switch typed := value.(type) {
	case float64:
		return int64(typed)
	case int64:
		return typed
	case int:
		return int64(typed)
	case string:
		parsed, _ := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
		return parsed
	default:
		return 0
	}
}
