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
	ProviderMessageID                  string
	ProviderMessageIDSynthetic         bool
	RemoteJID                          string
	RemoteAliases                      []string
	ContactPhone                       string
	ContactName                        string
	SenderJID                          string
	SenderName                         string
	Content                            string
	MessageType                        string
	FromMe                             bool
	IsGroup                            bool
	SentAt                             time.Time
	MediaURL                           string
	MediaBase64                        string
	MediaMimeType                      string
	MediaStoragePath                   string
	MediaSize                          int64
	ReactionTargetID                   string
	ReactionEmoji                      string
	IsReaction                         bool
	DeletionTargetID                   string
	IsDeletion                         bool
	HasCampaignSignal                  bool
	IsCTWAAd                           bool
	CampaignSourceType                 string
	CampaignSourceID                   string
	CampaignSourceURL                  string
	CampaignCreativeURL                string
	CampaignCreativeVideoURL           string
	CampaignCTWAClid                   string
	CampaignHeadline                   string
	CampaignEntryPointConversionSource string
	CampaignEntryPointConversionApp    string
	CampaignConversionSource           string
	CampaignSourceApp                  string
	CampaignShowAdAttribution          *bool
	CampaignPropertyCode               string
	UnsupportedID                      bool
	UnsupportedMessage                 bool
	Raw                                map[string]any
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
		firstString(messageNode, "conversation"),
		firstString(messageNode, "Conversation"),
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
	referralSourceURL := nativeFirstHTTPURL(referral, "source_url", "sourceUrl", "SourceURL", "url", "link")
	referralSourceType := firstString(referral, "source_type", "sourceType", "SourceType")
	entryPointSource := firstString(referral,
		"entry_point_conversion_source", "entryPointConversionSource", "EntryPointConversionSource",
	)
	entryPointApp := firstString(referral,
		"entry_point_conversion_app", "entryPointConversionApp", "EntryPointConversionApp",
	)
	conversionSource := firstString(referral, "conversion_source", "conversionSource", "ConversionSource")
	sourceApp := firstString(referral, "source_app", "sourceApp", "SourceApp")
	showAdAttribution := nativeOptionalBool(nativeFirstValue(referral,
		"show_ad_attribution", "showAdAttribution", "ShowAdAttribution",
	))

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
	providerMessageID = stripNullBytes(strings.TrimSpace(providerMessageID))
	providerIDSynthetic := providerMessageID == ""
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
		ProviderMessageID:                  providerMessageID,
		ProviderMessageIDSynthetic:         providerIDSynthetic,
		RemoteJID:                          identity.RemoteJID,
		RemoteAliases:                      aliases,
		ContactPhone:                       identity.ContactPhone,
		ContactName:                        firstNonEmpty(contactName, identity.ContactPhone),
		SenderJID:                          senderJID,
		SenderName:                         firstNonEmpty(firstString(info, "PushName", "pushName"), firstString(raw, "pushName", "senderName", "notifyName")),
		Content:                            stripNullBytes(content),
		MessageType:                        mediaType,
		FromMe:                             fromMe,
		IsGroup:                            identity.IsGroup,
		SentAt:                             sentAt.UTC(),
		MediaURL:                           mediaURL,
		MediaBase64:                        mediaBase64,
		MediaMimeType:                      mediaMimeType,
		MediaSize:                          nativeInt64(nativeFirstValue(mediaBlock, "fileLength", "FileLength", "fileSize", "mediaSize")),
		ReactionTargetID:                   reactionTarget,
		ReactionEmoji:                      reactionEmoji,
		IsReaction:                         isReaction,
		DeletionTargetID:                   deletionTarget,
		IsDeletion:                         isDeletion,
		HasCampaignSignal:                  nativeHasCampaignSignal(raw),
		IsCTWAAd:                           !fromMe && !identity.IsGroup && nativeIsCTWAAdReferral(entryPointSource, referralSourceType),
		CampaignSourceType:                 referralSourceType,
		CampaignSourceID:                   firstString(referral, "source_id", "sourceId", "SourceID", "ad_id", "adId", "AdID"),
		CampaignSourceURL:                  referralSourceURL,
		CampaignCreativeURL:                firstString(referral, "image_url", "thumbnail_url"),
		CampaignCreativeVideoURL:           firstString(referral, "video_url"),
		CampaignCTWAClid:                   firstString(referral, "ctwa_clid", "ctwaClid", "CTWAClid", "click_id", "clickId"),
		CampaignHeadline:                   firstString(referral, "headline", "title", "Title", "body", "description"),
		CampaignEntryPointConversionSource: entryPointSource,
		CampaignEntryPointConversionApp:    entryPointApp,
		CampaignConversionSource:           conversionSource,
		CampaignSourceApp:                  sourceApp,
		CampaignShowAdAttribution:          showAdAttribution,
		CampaignPropertyCode:               nativeCampaignPropertyCode(content, referralSourceURL),
		UnsupportedID:                      unsupportedIdentity,
		UnsupportedMessage:                 len(protocolMessage) > 0 && !isDeletion,
		Raw:                                raw,
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
				if normalized == "referral" || normalized == "externaladreply" || normalized == "ctwa" || normalized == "adsource" || normalized == "ad" {
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
	merged := map[string]any{}
	root, ok := value.(map[string]any)
	if !ok || len(root) == 0 {
		return nil
	}

	appendCandidate := func(candidate map[string]any) {
		if normalized := nativeNormalizeCampaignReferralCandidate(candidate); len(normalized) > 0 {
			merged = nativeMergeCampaignReferral(merged, normalized)
		}
	}
	appendContainer := func(container map[string]any) {
		if len(container) == 0 {
			return
		}
		appendCandidate(container)
		appendCandidate(nativeFirstMap(container,
			"externalAdReply", "ExternalAdReply", "externalAdReplyInfo", "externalAdReplyMessage",
		))
		appendCandidate(nativeFirstMap(container, "referral", "Referral"))
	}

	messageNode := nativeFirstMap(root, "message", "Message")
	if len(messageNode) == 0 {
		messageNode = root
	}
	info := nativeFirstMap(root, "info", "Info")

	// Campaign authorization is intentionally limited to provider-owned
	// referral/context fields on the current message. In particular, never walk
	// quotedMessage recursively: an ad referral quoted by a later organic
	// message is historical content, not a fresh CTWA entry point.
	for _, container := range []map[string]any{
		nativeFirstMap(root, "referral", "Referral"),
		nativeFirstMap(messageNode, "referral", "Referral"),
		nativeFirstMap(info, "referral", "Referral"),
		nativeFirstMap(root, "contextInfo", "ContextInfo"),
		nativeFirstMap(messageNode, "contextInfo", "ContextInfo"),
		nativeFirstMap(info, "contextInfo", "ContextInfo"),
		nativeFirstMap(messageNode, "extendedTextMessage.contextInfo", "extendedTextMessage.ContextInfo", "ExtendedTextMessage.contextInfo", "ExtendedTextMessage.ContextInfo"),
		nativeFirstMap(messageNode, "imageMessage.contextInfo", "imageMessage.ContextInfo", "ImageMessage.contextInfo", "ImageMessage.ContextInfo"),
		nativeFirstMap(messageNode, "videoMessage.contextInfo", "videoMessage.ContextInfo", "VideoMessage.contextInfo", "VideoMessage.ContextInfo"),
		nativeFirstMap(messageNode, "audioMessage.contextInfo", "audioMessage.ContextInfo", "AudioMessage.contextInfo", "AudioMessage.ContextInfo"),
		nativeFirstMap(messageNode, "documentMessage.contextInfo", "documentMessage.ContextInfo", "DocumentMessage.contextInfo", "DocumentMessage.ContextInfo"),
		nativeFirstMap(messageNode, "stickerMessage.contextInfo", "stickerMessage.ContextInfo", "StickerMessage.contextInfo", "StickerMessage.ContextInfo"),
		nativeFirstMap(root, "externalAdReply", "ExternalAdReply"),
		nativeFirstMap(messageNode, "externalAdReply", "ExternalAdReply"),
	} {
		appendContainer(container)
	}
	if len(merged) == 0 {
		return nil
	}
	return merged
}

func nativeNormalizeCampaignReferralCandidate(value map[string]any) map[string]any {
	if len(value) == 0 {
		return nil
	}
	normalized := map[string]any{}
	fields := []struct {
		canonical string
		paths     []string
	}{
		{canonical: "source_type", paths: []string{"source_type", "sourceType", "SourceType"}},
		{canonical: "source_id", paths: []string{"source_id", "sourceId", "SourceID", "ad_id", "adId", "AdID"}},
		{canonical: "ctwa_clid", paths: []string{"ctwa_clid", "ctwaClid", "CTWAClid", "click_id", "clickId"}},
		{canonical: "entry_point_conversion_source", paths: []string{"entry_point_conversion_source", "entryPointConversionSource", "EntryPointConversionSource"}},
		{canonical: "entry_point_conversion_app", paths: []string{"entry_point_conversion_app", "entryPointConversionApp", "EntryPointConversionApp"}},
		{canonical: "conversion_source", paths: []string{"conversion_source", "conversionSource", "ConversionSource"}},
		{canonical: "source_app", paths: []string{"source_app", "sourceApp", "SourceApp"}},
	}
	for _, field := range fields {
		if item := firstString(value, field.paths...); item != "" {
			normalized[field.canonical] = item
		}
	}
	if sourceURL := nativeFirstHTTPURL(value, "source_url", "sourceUrl", "SourceURL"); sourceURL != "" {
		normalized["source_url"] = sourceURL
	}
	if show, present := nativeBool(nativeFirstValue(value,
		"show_ad_attribution", "showAdAttribution", "ShowAdAttribution",
	)); present {
		normalized["show_ad_attribution"] = show
	}
	if normalized["source_url"] == nil {
		if sourceURL := nativeFirstHTTPURL(value, "url", "link"); sourceURL != "" {
			normalized["source_url"] = sourceURL
		}
	}
	if headline := firstString(value, "headline", "title", "Title"); headline != "" {
		normalized["headline"] = headline
	}
	if body := firstString(value, "body", "description", "text", "Body"); body != "" {
		normalized["body"] = body
	}
	if thumbnailURL := nativeFirstHTTPURL(value, "thumbnail_url", "thumbnailUrl", "ThumbnailURL", "preview_url"); thumbnailURL != "" {
		normalized["thumbnail_url"] = thumbnailURL
	}
	if imageURL := nativeFirstHTTPURL(value, "image_url", "imageUrl", "ImageURL", "picture"); imageURL != "" {
		normalized["image_url"] = imageURL
	}
	if videoURL := nativeFirstHTTPURL(value, "video_url", "videoUrl", "VideoURL", "media_url", "mediaUrl"); videoURL != "" {
		normalized["video_url"] = videoURL
	}
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}

func nativeMergeCampaignReferral(primary map[string]any, fallback map[string]any) map[string]any {
	if len(primary) == 0 && len(fallback) == 0 {
		return nil
	}
	merged := make(map[string]any, len(primary)+len(fallback))
	for key, value := range primary {
		merged[key] = value
	}
	for key, value := range fallback {
		current, exists := merged[key]
		if !exists || current == nil || strings.TrimSpace(stringFromAny(current)) == "" {
			merged[key] = value
		}
	}
	return merged
}

func nativeOptionalBool(value any) *bool {
	parsed, ok := nativeBool(value)
	if !ok {
		return nil
	}
	return &parsed
}

func nativeIsCTWAAdReferral(entryPointConversionSource string, explicitSourceType string) bool {
	if !strings.EqualFold(strings.TrimSpace(entryPointConversionSource), "ctwa_ad") {
		return false
	}
	sourceType := strings.ToLower(strings.TrimSpace(explicitSourceType))
	return sourceType == "" || sourceType == "ad"
}

func nativeFirstHTTPURL(value map[string]any, paths ...string) string {
	for _, path := range paths {
		candidate := strings.TrimSpace(firstString(value, path))
		if candidate == "" {
			continue
		}
		parsed, err := url.Parse(candidate)
		if err != nil || parsed.Host == "" {
			continue
		}
		scheme := strings.ToLower(parsed.Scheme)
		if scheme == "http" || scheme == "https" {
			return candidate
		}
	}
	return ""
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
