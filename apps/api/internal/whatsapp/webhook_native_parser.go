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
	"unicode"
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
	CTWAConfirmationMethod             string
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
	CampaignShowAdAttributionInvalid   bool
	CampaignCTWAProofConflict          bool
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
	dataMap := mapFromAny(data)
	dataMessage := nativeFirstValue(dataMap, "message", "Message")
	var dataMessageEnvelope map[string]any
	if _, singular := dataMessage.(map[string]any); singular {
		dataMessageEnvelope = dataMap
	}
	type messageCandidate struct {
		value    any
		envelope map[string]any
	}
	candidates := []messageCandidate{
		{value: nativeFirstValue(payload, "messages", "Messages")},
		{value: nativeFirstValue(payload, "message", "Message")},
		// A shared data envelope is ambiguous for a batch. Every item in
		// data.messages must carry its own identity and referral.
		{value: nativeFirstValue(dataMap, "messages", "Messages")},
		{value: dataMessage, envelope: dataMessageEnvelope},
		{value: data},
		{value: payload},
	}

	seen := map[string]bool{}
	result := make([]nativeEvolutionMessage, 0, 1)
	for _, candidate := range candidates {
		for _, raw := range nativeObjectList(candidate.value) {
			if !nativeLooksLikeMessage(raw) {
				continue
			}
			// A wrapper such as data.message may carry the contact phone next to
			// the actual message. It is an envelope, not a second message.
			if nativeWrapsEvolutionMessage(raw) {
				continue
			}
			message, ok := normalizeNativeEvolutionMessageWithEnvelope(raw, candidate.envelope)
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
	return normalizeNativeEvolutionMessageWithEnvelope(raw, nil)
}

func normalizeNativeEvolutionMessageWithEnvelope(raw map[string]any, envelope map[string]any) (nativeEvolutionMessage, bool) {
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
		envelopePhone := ""
		if strings.HasSuffix(strings.ToLower(strings.TrimSpace(remoteCandidate)), "@lid") {
			envelopePhone = nativeInboundEnvelopePhone(envelope)
		}
		phoneCandidate = firstNonEmpty(
			nativeFirstPhoneIdentity(info, "SenderPN", "senderPN", "SenderPn", "Sender", "sender", "SenderAlt", "senderAlt"),
			nativeFirstPhoneIdentity(raw, "sender", "senderJid", "from", "phone", "number"),
			envelopePhone,
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
	if len(envelope) > 0 {
		referral = nativeMergeCampaignReferral(referral, nativeCampaignReferral(envelope))
	}
	referralSourceURL := nativeFirstHTTPURL(referral, "source_url", "sourceUrl", "SourceURL", "url", "link")
	referralSourceType := firstString(referral, "explicit_source_type", "source_type", "sourceType", "SourceType")
	entryPointSource := firstString(referral,
		"entry_point_conversion_source", "entryPointConversionSource", "EntryPointConversionSource",
	)
	entryPointApp := firstString(referral,
		"entry_point_conversion_app", "entryPointConversionApp", "EntryPointConversionApp",
	)
	conversionSource := firstString(referral, "conversion_source", "conversionSource", "ConversionSource")
	sourceApp := firstString(referral, "source_app", "sourceApp", "SourceApp")
	showAdAttribution, showAdAttributionInvalid := nativeOptionalStrictBool(nativeFirstValue(referral,
		"show_ad_attribution", "showAdAttribution", "ShowAdAttribution",
	))
	showAdAttributionInvalid = showAdAttributionInvalid || nativeFailClosedMarker(
		nativeFirstValue(referral, "ctwa_show_ad_attribution_invalid"),
	)
	ctwaProofConflict := nativeFailClosedMarker(nativeFirstValue(referral, "ctwa_proof_conflict"))

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
	campaignCTWAClid := firstString(referral, "ctwa_clid", "ctwaClid", "CTWAClid", "click_id", "clickId")
	ctwaConfirmationMethod := nativeCTWAAdConfirmationMethod(nativeEvolutionMessage{
		ProviderMessageID:                  providerMessageID,
		ProviderMessageIDSynthetic:         providerIDSynthetic,
		FromMe:                             fromMe,
		IsGroup:                            identity.IsGroup,
		CampaignSourceType:                 referralSourceType,
		CampaignCTWAClid:                   campaignCTWAClid,
		CampaignEntryPointConversionSource: entryPointSource,
		CampaignShowAdAttribution:          showAdAttribution,
		CampaignShowAdAttributionInvalid:   showAdAttributionInvalid,
		CampaignCTWAProofConflict:          ctwaProofConflict,
	})
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
		HasCampaignSignal:                  nativeHasCampaignSignal(raw) || len(referral) > 0,
		IsCTWAAd:                           ctwaConfirmationMethod != "",
		CTWAConfirmationMethod:             ctwaConfirmationMethod,
		CampaignSourceType:                 referralSourceType,
		CampaignSourceID:                   firstString(referral, "source_id", "sourceId", "SourceID", "ad_id", "adId", "AdID"),
		CampaignSourceURL:                  referralSourceURL,
		CampaignCreativeURL:                firstString(referral, "image_url", "thumbnail_url"),
		CampaignCreativeVideoURL:           firstString(referral, "video_url"),
		CampaignCTWAClid:                   campaignCTWAClid,
		CampaignHeadline:                   firstString(referral, "headline", "title", "Title", "body", "description"),
		CampaignEntryPointConversionSource: entryPointSource,
		CampaignEntryPointConversionApp:    entryPointApp,
		CampaignConversionSource:           conversionSource,
		CampaignSourceApp:                  sourceApp,
		CampaignShowAdAttribution:          showAdAttribution,
		CampaignShowAdAttributionInvalid:   showAdAttributionInvalid,
		CampaignCTWAProofConflict:          ctwaProofConflict,
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
	if incoming == "" || current == incoming || current == "read" || current == "failed" {
		return current
	}
	if incoming == "read" {
		return incoming
	}
	if incoming == "failed" && (current == "delivered" || current == "read") {
		return current
	}
	currentRank, currentRanked := nativeDeliveryStatusRank(current)
	incomingRank, incomingRanked := nativeDeliveryStatusRank(incoming)
	if currentRanked && incomingRanked && incomingRank < currentRank {
		return current
	}
	return incoming
}

func nativeDeliveryStatusRank(status string) (int, bool) {
	switch status {
	case "received":
		return 0, true
	case "queued", "pending", "retry":
		return 1, true
	case "processing", "sending":
		return 2, true
	case "sent":
		return 3, true
	case "delivered":
		return 4, true
	case "read":
		return 5, true
	default:
		return 0, false
	}
}

func nativeMonotonicOutboxStatus(current string, incoming string) string {
	current = strings.ToLower(strings.TrimSpace(current))
	incoming = strings.ToLower(strings.TrimSpace(incoming))
	if current == "dead" {
		return current
	}
	if current != "" && (incoming == "received" || incoming == "queued" || incoming == "pending") {
		return current
	}
	return nativeMonotonicStatus(current, incoming)
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
			"externalAdReply", "ExternalAdReply", "external_ad_reply",
			"externalAdReplyInfo", "ExternalAdReplyInfo",
			"externalAdReplyMessage", "ExternalAdReplyMessage",
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
		nativeFirstMap(root, "contextInfo", "ContextInfo", "context_info"),
		nativeFirstMap(messageNode, "contextInfo", "ContextInfo", "context_info"),
		nativeFirstMap(info, "contextInfo", "ContextInfo", "context_info"),
		nativeFirstMap(messageNode, "extendedTextMessage.contextInfo", "extendedTextMessage.ContextInfo", "extendedTextMessage.context_info", "ExtendedTextMessage.contextInfo", "ExtendedTextMessage.ContextInfo", "ExtendedTextMessage.context_info"),
		nativeFirstMap(messageNode, "imageMessage.contextInfo", "imageMessage.ContextInfo", "imageMessage.context_info", "ImageMessage.contextInfo", "ImageMessage.ContextInfo", "ImageMessage.context_info"),
		nativeFirstMap(messageNode, "videoMessage.contextInfo", "videoMessage.ContextInfo", "videoMessage.context_info", "VideoMessage.contextInfo", "VideoMessage.ContextInfo", "VideoMessage.context_info"),
		nativeFirstMap(messageNode, "audioMessage.contextInfo", "audioMessage.ContextInfo", "audioMessage.context_info", "AudioMessage.contextInfo", "AudioMessage.ContextInfo", "AudioMessage.context_info"),
		nativeFirstMap(messageNode, "documentMessage.contextInfo", "documentMessage.ContextInfo", "documentMessage.context_info", "DocumentMessage.contextInfo", "DocumentMessage.ContextInfo", "DocumentMessage.context_info"),
		nativeFirstMap(messageNode, "stickerMessage.contextInfo", "stickerMessage.ContextInfo", "stickerMessage.context_info", "StickerMessage.contextInfo", "StickerMessage.ContextInfo", "StickerMessage.context_info"),
		nativeFirstMap(root, "externalAdReply", "ExternalAdReply", "external_ad_reply"),
		nativeFirstMap(messageNode, "externalAdReply", "ExternalAdReply", "external_ad_reply"),
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
		{canonical: "source_id", paths: []string{"source_id", "sourceId", "SourceID", "ad_id", "adId", "AdID"}},
		{canonical: "entry_point_conversion_app", paths: []string{"entry_point_conversion_app", "entryPointConversionApp", "EntryPointConversionApp"}},
		{canonical: "conversion_source", paths: []string{"conversion_source", "conversionSource", "ConversionSource"}},
		{canonical: "source_app", paths: []string{"source_app", "sourceApp", "SourceApp"}},
	}
	for _, field := range fields {
		if item := firstString(value, field.paths...); item != "" {
			normalized[field.canonical] = item
		}
	}
	proofInvalid := false
	if explicitSourceType, invalid := nativeStrictCampaignProofText(value,
		"explicit_source_type", "source_type", "sourceType", "SourceType",
	); invalid {
		proofInvalid = true
	} else if explicitSourceType != "" {
		normalized["explicit_source_type"] = explicitSourceType
		normalized["source_type"] = explicitSourceType
	}
	if ctwaClid, invalid := nativeStrictCampaignProofText(value,
		"ctwa_clid", "ctwaClid", "CTWAClid", "click_id", "clickId",
	); invalid {
		proofInvalid = true
	} else if ctwaClid != "" {
		normalized["ctwa_clid"] = ctwaClid
	}
	if entryPoint, invalid := nativeStrictCampaignProofText(value,
		"entry_point_conversion_source", "entryPointConversionSource", "EntryPointConversionSource",
	); invalid {
		proofInvalid = true
	} else if entryPoint != "" {
		normalized["entry_point_conversion_source"] = entryPoint
	}
	if sourceURL := nativeFirstHTTPURL(value, "source_url", "sourceUrl", "SourceURL"); sourceURL != "" {
		normalized["source_url"] = sourceURL
	}
	if rawShow := nativeFirstValue(value,
		"show_ad_attribution", "showAdAttribution", "ShowAdAttribution",
	); rawShow != nil {
		show, invalid := nativeOptionalStrictBool(rawShow)
		if invalid {
			normalized["ctwa_show_ad_attribution_invalid"] = true
		} else if show != nil {
			normalized["show_ad_attribution"] = *show
		}
	}
	if nativeFailClosedMarker(nativeFirstValue(value, "ctwa_proof_conflict")) {
		proofInvalid = true
	}
	if proofInvalid {
		normalized["ctwa_proof_conflict"] = true
	}
	if nativeFailClosedMarker(nativeFirstValue(value, "ctwa_show_ad_attribution_invalid")) {
		normalized["ctwa_show_ad_attribution_invalid"] = true
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
	proofConflict := nativeCampaignReferralProofConflict(primary, fallback)
	for key, value := range primary {
		merged[key] = value
	}
	for key, value := range fallback {
		current, exists := merged[key]
		if !exists || current == nil || strings.TrimSpace(stringFromAny(current)) == "" {
			merged[key] = value
		}
	}
	if proofConflict {
		merged["ctwa_proof_conflict"] = true
	}
	return merged
}

func nativeOptionalStrictBool(value any) (*bool, bool) {
	if value == nil {
		return nil, false
	}
	var parsed bool
	switch typed := value.(type) {
	case bool:
		parsed = typed
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "true", "1", "yes", "sim":
			parsed = true
		case "false", "0", "no", "nao", "não":
			parsed = false
		default:
			return nil, true
		}
	case float64:
		if typed != 0 && typed != 1 {
			return nil, true
		}
		parsed = typed == 1
	case int:
		if typed != 0 && typed != 1 {
			return nil, true
		}
		parsed = typed == 1
	case int64:
		if typed != 0 && typed != 1 {
			return nil, true
		}
		parsed = typed == 1
	default:
		return nil, true
	}
	return &parsed, false
}

func nativeStrictCampaignProofText(value map[string]any, paths ...string) (string, bool) {
	for _, path := range paths {
		raw := nativeValueAt(value, path)
		if raw == nil {
			continue
		}
		text, ok := raw.(string)
		if !ok {
			return "", true
		}
		if text = strings.TrimSpace(text); text != "" {
			return text, false
		}
	}
	return "", false
}

func nativeFailClosedMarker(value any) bool {
	if value == nil || value == false {
		return false
	}
	return true
}

func nativeCampaignProofText(value map[string]any, key string, foldCase bool) (string, bool) {
	raw := nativeFirstValue(value, key)
	if raw == nil {
		return "", false
	}
	text := strings.TrimSpace(stringFromAny(raw))
	if text == "" {
		return "", false
	}
	if foldCase {
		text = strings.ToLower(text)
	}
	return text, true
}

func nativeCampaignReferralProofConflict(primary map[string]any, fallback map[string]any) bool {
	if nativeFailClosedMarker(nativeFirstValue(primary, "ctwa_proof_conflict")) ||
		nativeFailClosedMarker(nativeFirstValue(fallback, "ctwa_proof_conflict")) {
		return true
	}
	for _, field := range []struct {
		key      string
		foldCase bool
	}{
		{key: "entry_point_conversion_source", foldCase: true},
		{key: "explicit_source_type", foldCase: true},
		{key: "ctwa_clid"},
	} {
		left, leftPresent := nativeCampaignProofText(primary, field.key, field.foldCase)
		right, rightPresent := nativeCampaignProofText(fallback, field.key, field.foldCase)
		if leftPresent && rightPresent && left != right {
			return true
		}
	}
	leftRaw := nativeFirstValue(primary, "show_ad_attribution")
	rightRaw := nativeFirstValue(fallback, "show_ad_attribution")
	if leftRaw != nil && rightRaw != nil {
		left, leftInvalid := nativeOptionalStrictBool(leftRaw)
		right, rightInvalid := nativeOptionalStrictBool(rightRaw)
		if leftInvalid || rightInvalid || left == nil || right == nil || *left != *right {
			return true
		}
	}
	return false
}

func nativeIsCTWAAdReferral(entryPointConversionSource string, explicitSourceType string) bool {
	return nativeCTWAAdConfirmationMethod(nativeEvolutionMessage{
		CampaignEntryPointConversionSource: entryPointConversionSource,
		CampaignSourceType:                 explicitSourceType,
	}) != ""
}

func nativeValidCTWAClickIdentifier(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) < 8 || len(value) > 512 {
		return false
	}
	for _, char := range value {
		if unicode.IsControl(char) {
			return false
		}
	}
	return true
}

func nativeCTWAAdConfirmationMethod(message nativeEvolutionMessage) string {
	if message.FromMe || message.IsGroup {
		return ""
	}
	if message.CampaignCTWAProofConflict {
		return ""
	}
	if message.CampaignShowAdAttributionInvalid {
		return ""
	}
	entryPoint := strings.ToLower(strings.TrimSpace(message.CampaignEntryPointConversionSource))
	explicitSourceType := strings.ToLower(strings.TrimSpace(message.CampaignSourceType))
	if entryPoint != "" {
		if entryPoint == "ctwa_ad" && (explicitSourceType == "" || explicitSourceType == "ad") {
			return "entry_point_ctwa_ad"
		}
		return ""
	}
	if message.ProviderMessageIDSynthetic || strings.TrimSpace(message.ProviderMessageID) == "" {
		return ""
	}
	if explicitSourceType != "ad" || !nativeValidCTWAClickIdentifier(message.CampaignCTWAClid) {
		return ""
	}
	if message.CampaignShowAdAttribution != nil && !*message.CampaignShowAdAttribution {
		return ""
	}
	return "evolution_ctwa_clid_v1"
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

func nativeWrapsEvolutionMessage(value map[string]any) bool {
	// Scalar IDs commonly belong to the Evolution instance/envelope. A parent
	// without Info/key that contains a structurally complete child is a wrapper,
	// not a second message.
	if len(nativeFirstMap(value, "Info", "info")) > 0 || len(nativeFirstMap(value, "key", "Key")) > 0 {
		return false
	}
	for _, nested := range nativeObjectList(nativeFirstValue(value, "message", "Message")) {
		if len(nativeFirstMap(nested, "Info", "info")) > 0 || len(nativeFirstMap(nested, "key", "Key")) > 0 {
			return true
		}
	}
	return false
}

func nativeInboundEnvelopePhone(envelope map[string]any) string {
	if len(envelope) == 0 {
		return ""
	}
	return nativeFirstPhoneIdentity(envelope,
		"SenderPN", "senderPN", "SenderPn",
		"senderJid", "sender_jid", "senderPhone", "sender_phone",
		"phone", "number", "sender",
	)
}

func nativeFirstPhoneIdentity(value map[string]any, paths ...string) string {
	for _, path := range paths {
		candidate := firstString(value, path)
		if _, ok := phoneFromIdentityValue(candidate); ok {
			return candidate
		}
	}
	return ""
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
