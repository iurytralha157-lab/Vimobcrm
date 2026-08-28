package meta

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	maxMessagingRouteIDLength    = 256
	maxMessagingExternalIDLength = 512
	maxMessagingContactLength    = 256
	maxMessagingContentLength    = 10_000
	maxMessagingPreviewLength    = 1_000
	maxMessagingMediaURLLength   = 2_048
)

// findMessagingIntegrationQuery deliberately has no organization input. The
// organization is derived only from a unique, connected integration owned by
// the destination Page/Instagram account in the signed provider payload.
const findMessagingIntegrationQuery = `
	select
		count(*)::bigint as matching_integrations,
		coalesce(
			(
				jsonb_agg(
					jsonb_build_object(
						'id', integration.id::text,
						'organization_id', integration.organization_id::text,
						'page_id', integration.page_id,
						'instagram_business_account_id', integration.instagram_business_account_id
					)
					order by integration.updated_at desc nulls last, integration.created_at desc nulls last
				) -> 0
			),
			'{}'::jsonb
		) as integration
	from public.meta_integrations integration
	join public.organization_modules marketing_access
	  on marketing_access.organization_id = integration.organization_id
	 and lower(btrim(marketing_access.module_name)) = 'campaigns'
	 and marketing_access.is_enabled = true
	join public.organization_modules conversations_access
	  on conversations_access.organization_id = integration.organization_id
	 and lower(btrim(conversations_access.module_name)) = 'whatsapp'
	 and conversations_access.is_enabled = true
	where coalesce(integration.is_connected, false) = true
	  and (
		($2 = 'messenger' and integration.page_id = $1)
		or (
			$2 = 'instagram'
			and (
				integration.instagram_business_account_id = $1
				or integration.page_id = $1
			)
		)
	  )
`

const upsertMessagingConversationQuery = `
	insert into public.meta_conversations (
		organization_id,
		external_id,
		platform,
		page_id,
		contact_name,
		contact_picture,
		unread_count,
		is_archived,
		created_at,
		updated_at
	)
	values ($1::uuid, $2, $3, $4, $5, $6, 0, false, now(), now())
	on conflict (organization_id, platform, page_id, external_id)
	where organization_id is not null
	  and platform is not null
	  and page_id is not null
	  and external_id is not null
	do update set
		contact_name = coalesce(nullif(excluded.contact_name, ''), meta_conversations.contact_name),
		contact_picture = coalesce(nullif(excluded.contact_picture, ''), meta_conversations.contact_picture),
		updated_at = meta_conversations.updated_at
	returning id::text
`

const insertInboundMessageQuery = `
	insert into public.meta_messages (
		conversation_id,
		external_id,
		content,
		message_type,
		from_me,
		status,
		media_url,
		media_mime_type,
		sent_at,
		created_at
	)
	values ($1::uuid, $2, $3, $4, false, 'received', $5, $6, $7, now())
	on conflict (conversation_id, external_id)
	where conversation_id is not null and external_id is not null
	do nothing
	returning id::text
`

const updateInboundConversationQuery = `
	update public.meta_conversations
	set last_message = case
			when last_message_at is null or last_message_at <= $3 then $4
			else last_message
		end,
		last_message_at = greatest(coalesce(last_message_at, $3), $3),
		unread_count = least(coalesce(unread_count, 0) + 1, 2147483647),
		updated_at = now()
	where organization_id = $1::uuid
	  and id = $2::uuid
`

type messagingEvent struct {
	Platform          string
	EntryID           string
	SenderID          string
	RecipientID       string
	ExternalMessageID string
	Content           string
	MessageType       string
	MediaURL          *string
	MediaMIMEType     *string
	ContactName       *string
	ContactPicture    *string
	SentAt            time.Time
}

type messagingIntegration struct {
	ID                         string
	OrganizationID             string
	PageID                     string
	InstagramBusinessAccountID string
}

type messagingQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func extractMessagingEvents(payload map[string]any) []messagingEvent {
	platform := messagingPlatform(textFromAny(payload["object"]))
	if platform == "" {
		return []messagingEvent{}
	}

	entries, _ := payload["entry"].([]any)
	events := make([]messagingEvent, 0)
	for _, rawEntry := range entries {
		entry, ok := rawEntry.(map[string]any)
		if !ok {
			continue
		}
		entryID := safeMessagingIdentifier(textFromAny(entry["id"]), maxMessagingRouteIDLength)
		if entryID == "" {
			continue
		}
		entryTimestamp := entry["time"]
		messagingItems, _ := entry["messaging"].([]any)
		for _, rawItem := range messagingItems {
			item, ok := rawItem.(map[string]any)
			if !ok {
				continue
			}
			message, ok := item["message"].(map[string]any)
			if !ok || boolFromAny(message["is_echo"]) {
				// Delivery/read receipts and postbacks do not carry an inbound
				// message object. Echoes must never increment the unread count.
				continue
			}

			sender := objectMap(item["sender"])
			recipient := objectMap(item["recipient"])
			senderID := safeMessagingIdentifier(textFromAny(sender["id"]), maxMessagingRouteIDLength)
			recipientID := safeMessagingIdentifier(textFromAny(recipient["id"]), maxMessagingRouteIDLength)
			externalID := safeMessagingIdentifier(textFromAny(message["mid"]), maxMessagingExternalIDLength)
			if senderID == "" || externalID == "" || senderID == recipientID {
				continue
			}

			content := truncateMessagingValue(textFromAny(message["text"]), maxMessagingContentLength)
			messageType, mediaURL, mediaMIMEType := extractMessagingAttachment(message)
			if messageType == "" {
				messageType = "text"
			}
			if content == "" && messageType == "text" {
				continue
			}

			contactName := nullableMessagingValue(
				firstNonEmpty(textFromAny(sender["name"]), textFromAny(sender["username"])),
				maxMessagingContactLength,
			)
			contactPicture := sanitizeMetaMediaURL(
				firstNonEmpty(textFromAny(sender["profile_picture_url"]), textFromAny(sender["profile_pic"])),
			)

			events = append(events, messagingEvent{
				Platform:          platform,
				EntryID:           entryID,
				SenderID:          senderID,
				RecipientID:       recipientID,
				ExternalMessageID: externalID,
				Content:           content,
				MessageType:       messageType,
				MediaURL:          mediaURL,
				MediaMIMEType:     mediaMIMEType,
				ContactName:       contactName,
				ContactPicture:    contactPicture,
				SentAt:            parseMessagingTimestamp(item["timestamp"], entryTimestamp),
			})
		}
	}
	return events
}

func messagingPlatform(object string) string {
	switch strings.ToLower(strings.TrimSpace(object)) {
	case "page":
		return "messenger"
	case "instagram":
		return "instagram"
	default:
		return ""
	}
}

func extractMessagingAttachment(message map[string]any) (string, *string, *string) {
	attachments, _ := message["attachments"].([]any)
	for _, rawAttachment := range attachments {
		attachment, ok := rawAttachment.(map[string]any)
		if !ok {
			continue
		}
		attachmentType := strings.ToLower(strings.TrimSpace(textFromAny(attachment["type"])))
		switch attachmentType {
		case "image", "video", "audio", "file":
		case "sticker":
			attachmentType = "image"
		default:
			attachmentType = "attachment"
		}
		attachmentPayload := objectMap(attachment["payload"])
		mediaURL := sanitizeMetaMediaURL(firstNonEmpty(
			textFromAny(attachmentPayload["url"]),
			textFromAny(attachmentPayload["src"]),
		))
		mediaMIMEType := safeMessagingMIME(firstNonEmpty(
			textFromAny(attachment["mime_type"]),
			textFromAny(attachmentPayload["mime_type"]),
		))
		return attachmentType, mediaURL, mediaMIMEType
	}
	return "", nil, nil
}

func sanitizeMetaMediaURL(raw string) *string {
	raw = strings.TrimSpace(strings.ReplaceAll(raw, "\x00", ""))
	if raw == "" || len(raw) > maxMessagingMediaURLLength*2 {
		return nil
	}
	parsed, err := url.Parse(raw)
	if err != nil || !strings.EqualFold(parsed.Scheme, "https") || parsed.Host == "" || parsed.User != nil {
		return nil
	}
	pathLower, _ := url.PathUnescape(strings.ToLower(parsed.EscapedPath()))
	if strings.Contains(pathLower, "access_token") || strings.Contains(pathLower, "appsecret_proof") {
		return nil
	}
	// Meta media links are commonly signed. Persisting query strings would
	// retain provider credentials/signatures, so only the HTTPS origin/path is
	// stored. The backend can resolve fresh media later if required.
	parsed.RawQuery = ""
	parsed.ForceQuery = false
	parsed.Fragment = ""
	parsed.RawFragment = ""
	normalized := parsed.String()
	if len(normalized) > maxMessagingMediaURLLength {
		return nil
	}
	return &normalized
}

func safeMessagingMIME(raw string) *string {
	raw = strings.TrimSpace(strings.ReplaceAll(raw, "\x00", ""))
	if raw == "" || len(raw) > 128 {
		return nil
	}
	mediaType, _, err := mime.ParseMediaType(raw)
	if err != nil || !strings.Contains(mediaType, "/") {
		return nil
	}
	mediaType = strings.ToLower(mediaType)
	return &mediaType
}

func parseMessagingTimestamp(primary any, fallback any) time.Time {
	for _, raw := range []any{primary, fallback} {
		value, err := strconv.ParseInt(textFromAny(raw), 10, 64)
		if err != nil || value <= 0 {
			continue
		}
		var timestamp time.Time
		if value >= 1_000_000_000_000 {
			timestamp = time.UnixMilli(value)
		} else {
			timestamp = time.Unix(value, 0)
		}
		if timestamp.Year() >= 2000 && timestamp.Year() <= 2100 {
			return timestamp.UTC()
		}
	}
	return time.Time{}
}

func boolFromAny(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		parsed, err := strconv.ParseBool(strings.TrimSpace(typed))
		return err == nil && parsed
	default:
		return false
	}
}

func safeMessagingIdentifier(value string, maxLength int) string {
	value = strings.TrimSpace(strings.ReplaceAll(value, "\x00", ""))
	if value == "" || len(value) > maxLength {
		return ""
	}
	return value
}

func nullableMessagingValue(value string, maxLength int) *string {
	value = truncateMessagingValue(value, maxLength)
	if value == "" {
		return nil
	}
	return &value
}

func truncateMessagingValue(value string, maxRunes int) string {
	value = strings.TrimSpace(strings.ReplaceAll(value, "\x00", ""))
	if maxRunes <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) > maxRunes {
		runes = runes[:maxRunes]
	}
	return string(runes)
}

func (repo Repository) processMessagingEvent(ctx context.Context, event messagingEvent) MessagingResult {
	result := MessagingResult{
		Status:            "failed",
		ExternalMessageID: event.ExternalMessageID,
		PageID:            event.EntryID,
		Platform:          event.Platform,
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	defer func() { _ = tx.Rollback(ctx) }()

	integration, err := findMessagingIntegration(ctx, tx, event.EntryID, event.Platform)
	if errors.Is(err, pgx.ErrNoRows) {
		result.Status = "skipped"
		result.Error = "connected Meta integration was not found for messaging destination"
		return result
	}
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.OrganizationID = integration.OrganizationID
	result.PageID = firstNonEmpty(integration.PageID, event.EntryID)

	if !messagingDestinationMatches(event, integration) {
		result.Status = "skipped"
		result.Error = "messaging recipient does not match the connected Meta integration"
		return result
	}

	conversationPageID := firstNonEmpty(integration.PageID, integration.InstagramBusinessAccountID)
	if conversationPageID == "" {
		result.Error = "connected Meta integration has no routable page identifier"
		return result
	}

	var conversationID string
	err = tx.QueryRow(ctx, upsertMessagingConversationQuery,
		integration.OrganizationID,
		event.SenderID,
		event.Platform,
		conversationPageID,
		nullablePointer(event.ContactName),
		nullablePointer(event.ContactPicture),
	).Scan(&conversationID)
	if errors.Is(err, pgx.ErrNoRows) {
		result.Error = "messaging conversation key belongs to a different tenant or platform"
		return result
	}
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.ConversationID = conversationID

	sentAt := event.SentAt
	if sentAt.IsZero() {
		sentAt = time.Now().UTC()
	}
	var messageID string
	err = tx.QueryRow(ctx, insertInboundMessageQuery,
		conversationID,
		event.ExternalMessageID,
		nullableString(event.Content),
		event.MessageType,
		nullablePointer(event.MediaURL),
		nullablePointer(event.MediaMIMEType),
		sentAt,
	).Scan(&messageID)
	if errors.Is(err, pgx.ErrNoRows) {
		if err := tx.QueryRow(ctx, `
			select id::text
			from public.meta_messages
			where conversation_id = $1::uuid
			  and external_id = $2
			limit 1
		`, conversationID, event.ExternalMessageID).Scan(&messageID); err != nil {
			result.Error = err.Error()
			return result
		}
		result.Status = "duplicate"
		result.MessageID = messageID
		if err := tx.Commit(ctx); err != nil {
			result.Status = "failed"
			result.Error = err.Error()
		}
		return result
	}
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.MessageID = messageID

	preview := messagingPreview(event)
	command, err := tx.Exec(ctx, updateInboundConversationQuery,
		integration.OrganizationID,
		conversationID,
		sentAt,
		preview,
	)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	if command.RowsAffected() != 1 {
		result.Error = "tenant-scoped messaging conversation update failed"
		return result
	}
	if err := tx.Commit(ctx); err != nil {
		result.Error = err.Error()
		return result
	}

	result.Status = "processed"
	result.Error = ""
	return result
}

func findMessagingIntegration(ctx context.Context, queryer messagingQueryer, routeID string, platform string) (messagingIntegration, error) {
	var (
		matchCount int64
		raw        []byte
	)
	if err := queryer.QueryRow(ctx, findMessagingIntegrationQuery, routeID, platform).Scan(&matchCount, &raw); err != nil {
		return messagingIntegration{}, err
	}
	if matchCount == 0 {
		return messagingIntegration{}, pgx.ErrNoRows
	}
	if matchCount > 1 {
		return messagingIntegration{}, fmt.Errorf(
			"%w: %s destination %q matches %d connected integrations",
			ErrAmbiguousMessagingIntegration,
			platform,
			routeID,
			matchCount,
		)
	}
	var item map[string]any
	if err := json.Unmarshal(raw, &item); err != nil {
		return messagingIntegration{}, err
	}
	integration := messagingIntegration{
		ID:                         textFromAny(item["id"]),
		OrganizationID:             textFromAny(item["organization_id"]),
		PageID:                     textFromAny(item["page_id"]),
		InstagramBusinessAccountID: textFromAny(item["instagram_business_account_id"]),
	}
	if integration.ID == "" || integration.OrganizationID == "" {
		return messagingIntegration{}, errors.New("connected Meta messaging integration is incomplete")
	}
	return integration, nil
}

func messagingDestinationMatches(event messagingEvent, integration messagingIntegration) bool {
	destinations := []string{
		event.EntryID,
		integration.PageID,
		integration.InstagramBusinessAccountID,
	}
	if event.RecipientID != "" && !containsMessagingIdentifier(destinations, event.RecipientID) {
		return false
	}
	// Some provider echo variants omit message.is_echo. A sender equal to the
	// connected business destination is outbound and must be ignored.
	return !containsMessagingIdentifier(destinations, event.SenderID)
}

func containsMessagingIdentifier(values []string, expected string) bool {
	expected = strings.TrimSpace(expected)
	if expected == "" {
		return false
	}
	for _, value := range values {
		if strings.TrimSpace(value) == expected {
			return true
		}
	}
	return false
}

func messagingPreview(event messagingEvent) string {
	if event.Content != "" {
		return truncateMessagingValue(event.Content, maxMessagingPreviewLength)
	}
	switch event.MessageType {
	case "image":
		return "[image]"
	case "video":
		return "[video]"
	case "audio":
		return "[audio]"
	case "file":
		return "[file]"
	default:
		return "[attachment]"
	}
}

func aggregateWebhookResults(leadResults []LeadgenResult, messagingResults []MessagingResult) (string, string, string, int) {
	status := "skipped"
	errorMessage := ""
	processed := 0
	organizations := map[string]struct{}{}

	apply := func(resultStatus string, organizationID string, resultError string) {
		if organizationID != "" {
			organizations[organizationID] = struct{}{}
		}
		if resultError != "" && errorMessage == "" {
			errorMessage = resultError
		}
		switch resultStatus {
		case "failed":
			status = "failed"
		case "processed":
			processed++
			if status != "failed" {
				status = "processed"
			}
		case "duplicate":
			if status != "failed" && status != "processed" {
				status = "duplicate"
			}
		}
	}
	for _, result := range leadResults {
		apply(result.Status, result.OrganizationID, result.Error)
	}
	for _, result := range messagingResults {
		apply(result.Status, result.OrganizationID, result.Error)
	}

	organizationID := ""
	if len(organizations) == 1 {
		for id := range organizations {
			organizationID = id
		}
	}
	return status, organizationID, errorMessage, processed
}
