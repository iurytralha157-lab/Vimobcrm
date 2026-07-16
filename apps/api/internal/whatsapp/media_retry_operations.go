package whatsapp

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const whatsappMediaMaxBytes = 26 * 1024 * 1024

type retryMediaMessage struct {
	ID               string
	OrganizationID   string
	ConversationID   string
	SessionID        string
	MessageID        string
	MessageType      string
	MediaURL         string
	MediaMimeType    string
	MediaStoragePath string
	Metadata         map[string]any
}

type recoveredWhatsAppMedia struct {
	bytes       []byte
	contentType string
	source      string
}

func (repo Repository) retryStoredMediaDownload(ctx context.Context, tenantContext tenant.Context, rawMessageID string) (map[string]any, error) {
	messageID, ok := normalizeUUID(rawMessageID)
	if !ok {
		return nil, ErrMessageNotFound
	}

	message, err := repo.loadRetryMediaMessage(ctx, tenantContext, messageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrMessageNotFound
	}
	if err != nil {
		return nil, err
	}

	if strings.TrimSpace(message.MediaStoragePath) != "" {
		if !whatsappMediaPathBelongsToOrganization(message.MediaStoragePath, tenantContext.OrganizationID) {
			return nil, fmt.Errorf("%w: caminho da midia armazenada fora do escopo da organizacao", ErrProviderFailed)
		}
		signedURL, _ := repo.storage.signedURL(ctx, whatsappMediaBucket, message.MediaStoragePath, whatsappMediaSignedURLTTLSeconds)
		return map[string]any{
			"ok":                 true,
			"message_id":         message.ID,
			"media_status":       "ready",
			"media_url":          signedURL,
			"media_storage_path": message.MediaStoragePath,
			"already_ready":      true,
		}, nil
	}

	media, err := repo.recoverWhatsAppMedia(ctx, message)
	if err != nil {
		_ = repo.markMediaRetryFailed(ctx, tenantContext.OrganizationID, message.ID, err)
		return nil, err
	}

	contentType := firstNonEmpty(media.contentType, message.MediaMimeType, fallbackWhatsAppMediaMimeType(message.MessageType))
	extension := mediaExtension(contentType)
	sessionID := firstNonEmpty(message.SessionID, "no-session")
	objectName := sanitizeWhatsAppMediaObjectPart(firstNonEmpty(message.MessageID, message.ID))
	objectPath := fmt.Sprintf("orgs/%s/sessions/%s/incoming/%s.%s", message.OrganizationID, sessionID, objectName, extension)

	if err := repo.storage.upload(ctx, whatsappMediaBucket, objectPath, contentType, bytes.NewReader(media.bytes), true); err != nil {
		_ = repo.markMediaRetryFailed(ctx, tenantContext.OrganizationID, message.ID, err)
		return nil, err
	}

	signedURL, _ := repo.storage.signedURL(ctx, whatsappMediaBucket, objectPath, whatsappMediaSignedURLTTLSeconds)
	_, err = repo.db.Pool().Exec(ctx, `
		update public.whatsapp_messages
		set media_storage_path = $3,
		    media_url = null,
		    media_mime_type = nullif($4, ''),
		    media_status = 'ready',
		    media_error = null,
		    media_size = $5,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, message.ID, objectPath, contentType, int64(len(media.bytes)))
	if err != nil {
		return nil, err
	}
	whatsappMediaSignedURLCache.Delete(objectPath)

	return map[string]any{
		"ok":                 true,
		"message_id":         message.ID,
		"media_status":       "ready",
		"media_url":          signedURL,
		"media_mime_type":    contentType,
		"media_storage_path": objectPath,
		"media_size":         len(media.bytes),
		"source":             media.source,
	}, nil
}

func (repo Repository) loadRetryMediaMessage(ctx context.Context, tenantContext tenant.Context, messageID string) (retryMediaMessage, error) {
	var message retryMediaMessage
	var metadata string
	args := append(baseConversationArgs(tenantContext), messageID)
	err := repo.db.Pool().QueryRow(ctx, `
		select
			wm.id::text,
			wm.organization_id::text,
			wm.conversation_id::text,
			coalesce(wm.session_id::text, ''),
			coalesce(wm.message_id, wm.provider_message_id, wm.id::text),
			coalesce(wm.message_type, ''),
			coalesce(wm.media_url, ''),
			coalesce(wm.media_mime_type, ''),
			coalesce(wm.media_storage_path, ''),
			coalesce(wm.metadata, '{}'::jsonb)::text
		from public.whatsapp_messages wm
		join public.whatsapp_conversations wc on wc.id = wm.conversation_id
		left join public.whatsapp_sessions ws on ws.id = wc.session_id
		left join public.leads l on l.id = wc.lead_id
		where wm.organization_id = $1::uuid
		  and wc.organization_id = $1::uuid
		  and wc.deleted_at is null
		  and `+conversationVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
		  and `+conversationMessageLeadMatchSQL()+`
		  and wm.id = $5::uuid
		limit 1
	`, args...).Scan(
		&message.ID,
		&message.OrganizationID,
		&message.ConversationID,
		&message.SessionID,
		&message.MessageID,
		&message.MessageType,
		&message.MediaURL,
		&message.MediaMimeType,
		&message.MediaStoragePath,
		&metadata,
	)
	if err != nil {
		return retryMediaMessage{}, err
	}
	message.Metadata = decodeObjectJSON(metadata)
	return message, nil
}

func (repo Repository) recoverWhatsAppMedia(ctx context.Context, message retryMediaMessage) (recoveredWhatsAppMedia, error) {
	raw := mapFromAny(message.Metadata["raw"])
	if len(raw) == 0 {
		raw = message.Metadata
	}

	for _, candidate := range mediaBase64Candidates(raw, message.MessageType) {
		payload, err := decodeFlexibleBase64Media(candidate)
		if err == nil && len(payload) > 0 {
			return recoveredWhatsAppMedia{
				bytes:       payload,
				contentType: firstNonEmpty(message.MediaMimeType, detectWhatsAppMediaMimeType(payload), fallbackWhatsAppMediaMimeType(message.MessageType)),
				source:      "metadata_base64",
			}, nil
		}
	}

	for _, candidate := range mediaURLCandidates(raw, message) {
		media, err := repo.downloadWhatsAppMediaURL(ctx, candidate)
		if err == nil && len(media.bytes) > 0 {
			return media, nil
		}
	}

	return recoveredWhatsAppMedia{}, fmt.Errorf("%w: midia nao encontrada no payload salvo", ErrProviderFailed)
}

func (repo Repository) downloadWhatsAppMediaURL(ctx context.Context, sourceURL string) (recoveredWhatsAppMedia, error) {
	sourceURL = strings.TrimSpace(sourceURL)
	parsed, err := url.Parse(sourceURL)
	allowed, providerHost := allowedWhatsAppMediaURL(parsed, repo.functions.evolutionGoAPIURL, repo.storage.projectURL)
	if err != nil || !allowed {
		return recoveredWhatsAppMedia{}, fmt.Errorf("%w: URL da midia invalida", ErrProviderFailed)
	}

	headers := []map[string]string{{}}
	if providerHost && repo.functions.evolutionGoAPIKey != "" {
		headers = append(headers, map[string]string{
			"apikey":        repo.functions.evolutionGoAPIKey,
			"Authorization": "Bearer " + repo.functions.evolutionGoAPIKey,
		})
	}

	client := *repo.functions.httpClient
	client.CheckRedirect = func(request *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return fmt.Errorf("too many media redirects")
		}
		redirectAllowed, redirectProviderHost := allowedWhatsAppMediaURL(
			request.URL,
			repo.functions.evolutionGoAPIURL,
			repo.storage.projectURL,
		)
		if !redirectAllowed {
			return fmt.Errorf("media redirect host is not allowed")
		}
		if !redirectProviderHost {
			request.Header.Del("apikey")
			request.Header.Del("Authorization")
		}
		return nil
	}

	for _, headerSet := range headers {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
		if err != nil {
			return recoveredWhatsAppMedia{}, err
		}
		for key, value := range headerSet {
			request.Header.Set(key, value)
		}

		response, err := client.Do(request)
		if err != nil {
			continue
		}
		payload, readErr := readLimitedWhatsAppMedia(response)
		response.Body.Close()
		if readErr != nil || response.StatusCode < 200 || response.StatusCode >= 300 {
			continue
		}

		return recoveredWhatsAppMedia{
			bytes:       payload,
			contentType: firstNonEmpty(strings.Split(response.Header.Get("Content-Type"), ";")[0], detectWhatsAppMediaMimeType(payload)),
			source:      "metadata_url",
		}, nil
	}

	return recoveredWhatsAppMedia{}, fmt.Errorf("%w: nao foi possivel baixar a midia no provedor", ErrProviderFailed)
}

func allowedWhatsAppMediaURL(candidate *url.URL, evolutionURL string, projectURL string) (allowed bool, providerHost bool) {
	if !validWhatsAppMediaOriginURL(candidate) {
		return false, false
	}

	configuredHosts := []struct {
		raw      string
		provider bool
	}{
		{raw: evolutionURL, provider: true},
		{raw: projectURL, provider: false},
	}
	for _, configured := range configuredHosts {
		parsed, err := url.Parse(strings.TrimSpace(configured.raw))
		if err == nil && sameWhatsAppMediaOrigin(candidate, parsed) {
			return true, configured.provider
		}
	}

	// Provider CDN media is public and never receives Evolution credentials.
	// It is accepted only over the standard HTTPS origin.
	if !strings.EqualFold(candidate.Scheme, "https") || effectiveWhatsAppMediaPort(candidate) != "443" {
		return false, false
	}
	host := normalizedWhatsAppMediaHost(candidate)
	for _, domain := range []string{"whatsapp.net", "fbcdn.net", "fbsbx.com"} {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			return true, false
		}
	}
	return false, false
}

func validWhatsAppMediaOriginURL(candidate *url.URL) bool {
	if candidate == nil || candidate.User != nil || candidate.Opaque != "" || candidate.Hostname() == "" {
		return false
	}
	if !strings.EqualFold(candidate.Scheme, "http") && !strings.EqualFold(candidate.Scheme, "https") {
		return false
	}
	return effectiveWhatsAppMediaPort(candidate) != ""
}

func sameWhatsAppMediaOrigin(candidate *url.URL, configured *url.URL) bool {
	if !validWhatsAppMediaOriginURL(candidate) || !validWhatsAppMediaOriginURL(configured) {
		return false
	}
	return strings.EqualFold(candidate.Scheme, configured.Scheme) &&
		normalizedWhatsAppMediaHost(candidate) == normalizedWhatsAppMediaHost(configured) &&
		effectiveWhatsAppMediaPort(candidate) == effectiveWhatsAppMediaPort(configured)
}

func normalizedWhatsAppMediaHost(candidate *url.URL) string {
	if candidate == nil {
		return ""
	}
	return strings.ToLower(strings.TrimSuffix(candidate.Hostname(), "."))
}

func effectiveWhatsAppMediaPort(candidate *url.URL) string {
	if candidate == nil {
		return ""
	}
	if port := candidate.Port(); port != "" {
		return port
	}
	switch strings.ToLower(candidate.Scheme) {
	case "http":
		return "80"
	case "https":
		return "443"
	default:
		return ""
	}
}

func readLimitedWhatsAppMedia(response *http.Response) ([]byte, error) {
	if response.ContentLength > whatsappMediaMaxBytes {
		return nil, fmt.Errorf("%w: arquivo acima do limite de 25MB", ErrInvalidInput)
	}

	payload, err := io.ReadAll(io.LimitReader(response.Body, whatsappMediaMaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(payload) == 0 {
		return nil, fmt.Errorf("%w: arquivo vazio", ErrProviderFailed)
	}
	if len(payload) > whatsappMediaMaxBytes {
		return nil, fmt.Errorf("%w: arquivo acima do limite de 25MB", ErrInvalidInput)
	}

	return payload, nil
}

func (repo Repository) markMediaRetryFailed(ctx context.Context, organizationID string, messageID string, mediaErr error) error {
	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_messages
		set media_status = 'failed',
		    media_error = nullif($3, ''),
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, organizationID, messageID, strings.TrimSpace(mediaErr.Error()))
	return err
}

func mediaBase64Candidates(raw map[string]any, messageType string) []string {
	paths := append([]string{
		"base64",
		"Base64",
		"media",
		"file",
		"thumbnail",
		"thumbnailBase64",
		"jpegThumbnail",
		"Message.base64",
		"Message.Base64",
		"Message.media",
		"Message.file",
		"Message.thumbnail",
		"Message.thumbnailBase64",
		"Message.jpegThumbnail",
		"message.base64",
		"message.media",
		"message.file",
		"message.thumbnail",
		"message.thumbnailBase64",
		"message.jpegThumbnail",
		"data.Message.base64",
		"Data.Message.base64",
	}, mediaBlockPaths(messageType, "base64", "Base64", "media", "file", "thumbnail", "thumbnailBase64", "jpegThumbnail")...)

	candidates := make([]string, 0, len(paths)+4)
	for _, path := range paths {
		if value := firstString(raw, path); looksLikeBase64Media(value) {
			candidates = append(candidates, value)
		}
	}
	for _, value := range recursiveMediaStrings(raw, map[string]bool{
		"base64":          true,
		"thumbnail":       true,
		"thumbnailbase64": true,
		"jpegthumbnail":   true,
	}) {
		if looksLikeBase64Media(value) {
			candidates = append(candidates, value)
		}
	}
	return uniqueMediaStrings(candidates)
}

func mediaURLCandidates(raw map[string]any, message retryMediaMessage) []string {
	paths := append([]string{
		"media_url",
		"mediaUrl",
		"url",
		"URL",
		"Message.media_url",
		"Message.mediaUrl",
		"Message.url",
		"Message.URL",
		"message.media_url",
		"message.mediaUrl",
		"message.url",
		"data.Message.mediaUrl",
		"Data.Message.mediaUrl",
	}, mediaBlockPaths(message.MessageType, "url", "URL", "mediaUrl", "media_url")...)

	candidates := []string{message.MediaURL}
	for _, path := range paths {
		if value := firstString(raw, path); looksLikeHTTPURL(value) {
			candidates = append(candidates, value)
		}
	}
	for _, value := range recursiveMediaStrings(raw, map[string]bool{
		"media_url": true,
		"mediaurl":  true,
		"url":       true,
	}) {
		if looksLikeHTTPURL(value) {
			candidates = append(candidates, value)
		}
	}
	return uniqueMediaStrings(candidates)
}

func mediaBlockPaths(messageType string, fields ...string) []string {
	blocks := []string{
		"imageMessage",
		"ImageMessage",
		"videoMessage",
		"VideoMessage",
		"audioMessage",
		"AudioMessage",
		"documentMessage",
		"DocumentMessage",
		"stickerMessage",
		"StickerMessage",
	}
	if messageType != "" {
		blocks = append([]string{messageType + "Message", strings.Title(messageType) + "Message"}, blocks...)
	}

	paths := make([]string, 0, len(blocks)*len(fields)*2)
	for _, block := range blocks {
		for _, field := range fields {
			paths = append(paths, "Message."+block+"."+field, "message."+block+"."+field)
		}
	}
	return paths
}

func recursiveMediaStrings(value any, keys map[string]bool) []string {
	var out []string
	var walk func(any, int)
	walk = func(current any, depth int) {
		if depth > 8 || current == nil {
			return
		}
		switch typed := current.(type) {
		case map[string]any:
			for key, item := range typed {
				normalizedKey := strings.ToLower(strings.ReplaceAll(key, "-", "_"))
				if keys[normalizedKey] {
					if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
						out = append(out, text)
					}
				}
				walk(item, depth+1)
			}
		case []any:
			for _, item := range typed {
				walk(item, depth+1)
			}
		}
	}
	walk(value, 0)
	return out
}

func decodeFlexibleBase64Media(value string) ([]byte, error) {
	if payload, err := decodeBase64Media(value); err == nil {
		return payload, nil
	}

	value = strings.TrimSpace(value)
	if strings.Contains(value, ",") && strings.HasPrefix(value, "data:") {
		_, after, _ := strings.Cut(value, ",")
		value = after
	}
	value = strings.TrimSpace(value)

	decoders := []*base64.Encoding{
		base64.RawStdEncoding,
		base64.RawURLEncoding,
		base64.URLEncoding,
	}
	for _, decoder := range decoders {
		if payload, err := decoder.DecodeString(value); err == nil {
			return payload, nil
		}
	}

	return nil, fmt.Errorf("%w: base64 da midia invalido", ErrProviderFailed)
}

func looksLikeBase64Media(value string) bool {
	value = strings.TrimSpace(value)
	return value != "" && !looksLikeHTTPURL(value) && len(value) > 64
}

func looksLikeHTTPURL(value string) bool {
	value = strings.TrimSpace(value)
	return strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://")
}

func detectWhatsAppMediaMimeType(payload []byte) string {
	if len(payload) == 0 {
		return ""
	}
	if len(payload) > 512 {
		payload = payload[:512]
	}
	return http.DetectContentType(payload)
}

func fallbackWhatsAppMediaMimeType(messageType string) string {
	switch strings.ToLower(strings.TrimSpace(messageType)) {
	case "image":
		return "image/jpeg"
	case "video":
		return "video/mp4"
	case "audio":
		return "audio/ogg"
	case "sticker":
		return "image/webp"
	default:
		return "application/octet-stream"
	}
}

func sanitizeWhatsAppMediaObjectPart(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return randomHex(8)
	}

	var builder strings.Builder
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '-' || char == '_' || char == '.' {
			builder.WriteRune(char)
		} else {
			builder.WriteRune('_')
		}
	}
	out := strings.Trim(builder.String(), "._-")
	if out == "" {
		return randomHex(8)
	}
	if len(out) > 120 {
		out = out[:120]
	}
	return out
}

func uniqueMediaStrings(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}
