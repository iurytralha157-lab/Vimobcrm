package whatsapp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/jackc/pgx/v5"
)

type evolutionSessionConfig struct {
	ID           string
	InstanceName string
	InstanceID   string
	Settings     map[string]any
}

type evolutionFetchOptions struct {
	Body             any
	Query            map[string]any
	InstanceID       string
	Token            string
	UseGlobalAPIKey  bool
	MaxResponseBytes int64
}

type evolutionFetchResult struct {
	OK      bool
	Status  int
	Data    any
	RawText string
}

type evolutionEndpoint struct {
	Method  string
	Path    string
	Query   map[string]any
	Body    any
	Skipped bool
	Reason  string
}

func (client functionsClient) invokeEvolutionDirect(ctx context.Context, action string, payload map[string]any) (map[string]any, error) {
	if client.evolutionGoAPIURL == "" || client.evolutionGoAPIKey == "" {
		return nil, fmt.Errorf("%w: Evolution Go API configuration missing", ErrProviderFailed)
	}

	session, err := client.resolveEvolutionSession(ctx, payload)
	if err != nil {
		return nil, err
	}

	body := mapFromAny(payload["body"])
	instanceKey := client.evolutionInstanceKey(session, payload, body)
	token := client.evolutionSessionToken(session, payload)

	if action != "instance.create" && action != "instance.all" && instanceKey == "" {
		return nil, fmt.Errorf("%w: Evolution Go instance key missing", ErrProviderFailed)
	}

	switch action {
	case "instance.status":
		result, err := client.evolutionFetch(ctx, http.MethodGet, "/instance/status", evolutionFetchOptions{
			Token: token,
		})
		if err != nil {
			return nil, err
		}
		normalizedStatus := ""
		if result.OK {
			normalizedStatus = normalizeEvolutionStatus(result.Data)
		}

		response := map[string]any{
			"ok":               result.OK,
			"status":           result.Status,
			"data":             result.Data,
			"normalizedStatus": normalizedStatus,
			"rawResponse":      result.RawText,
			"diagnostics": map[string]any{
				"endpointUsed": "/instance/status",
				"instanceKey":  instanceKey,
				"authScope":    evolutionAuthScope(action),
			},
		}
		if !result.OK {
			response["error"] = evolutionErrorMessage(result.Data, result.RawText)
		}
		return response, nil
	case "instance.qr":
		result, err := client.evolutionFetch(ctx, http.MethodGet, "/instance/qr", evolutionFetchOptions{
			Token: token,
		})
		if err != nil {
			return nil, err
		}
		qr := normalizeEvolutionQR(result.Data)
		response := map[string]any{
			"ok":     result.OK && qr != "",
			"status": result.Status,
		}
		if qr != "" {
			response["data"] = map[string]any{
				"qrcode":         qr,
				"instanceKey":    instanceKey,
				"sourceEndpoint": "/instance/qr",
			}
		} else {
			response["data"] = result.Data
			response["error"] = "QR Code ainda nao disponivel."
		}
		response["rawResponse"] = result.RawText

		return response, nil
	}

	endpoint, err := evolutionEndpointFor(action, body, instanceKey)
	if err != nil {
		return nil, err
	}
	if endpoint.Skipped {
		return map[string]any{"ok": true, "skipped": true, "reason": endpoint.Reason}, nil
	}

	result, err := client.evolutionFetch(ctx, endpoint.Method, endpoint.Path, evolutionFetchOptions{
		Body:             endpoint.Body,
		Query:            endpoint.Query,
		InstanceID:       evolutionInstanceHeader(action, instanceKey),
		Token:            token,
		UseGlobalAPIKey:  evolutionUsesGlobalAPIKey(action),
		MaxResponseBytes: evolutionResponseMaxBytes(action),
	})
	if err != nil {
		return nil, err
	}

	responseData := result.Data
	if isEvolutionSendAction(action) {
		if messageID := evolutionSentMessageID(result.Data); messageID != "" {
			if dataMap, ok := result.Data.(map[string]any); ok {
				responseData = cloneMap(dataMap)
				responseData.(map[string]any)["sentMessageId"] = messageID
				responseData.(map[string]any)["messageId"] = messageID
			} else {
				responseData = map[string]any{
					"data":          result.Data,
					"sentMessageId": messageID,
					"messageId":     messageID,
				}
			}
		}
	}

	ok := result.OK && !evolutionSemanticFailure(result.Data)
	response := map[string]any{
		"ok":     ok,
		"status": result.Status,
		"data":   responseData,
	}
	if !ok {
		response["error"] = evolutionErrorMessage(result.Data, result.RawText)
	}

	return response, nil
}

func evolutionInstanceHeader(action string, instanceKey string) string {
	if instanceKey == "" || evolutionUsesGlobalAPIKey(action) {
		return ""
	}

	return instanceKey
}

func evolutionUsesGlobalAPIKey(action string) bool {
	return stringIn(action,
		"instance.create",
		"instance.delete",
		"instance.all",
		"instance.info",
		"instance.forceReconnect",
	)
}

func evolutionAllowsProviderFailure(action string) bool {
	return stringIn(action,
		"instance.status",
		"instance.qr",
		"instance.delete",
		"instance.disconnect",
		"instance.logout",
	)
}

func evolutionAuthScope(action string) string {
	if evolutionUsesGlobalAPIKey(action) {
		return "global"
	}

	return "instance"
}

func evolutionResponseMaxBytes(action string) int64 {
	if stringIn(action, "message.downloadMedia", "message.downloadImage") {
		// Base64 expands the 26 MiB binary ceiling by roughly 4/3. The extra
		// MiB accounts for the provider's small JSON envelope.
		return int64(whatsappMediaMaxBytes*4/3 + 1<<20)
	}
	return 1 << 20
}

func (client functionsClient) resolveEvolutionSession(ctx context.Context, payload map[string]any) (evolutionSessionConfig, error) {
	sessionID := stringFromAny(firstPresentAny(payload["session_id"], payload["sessionId"]))
	if sessionID == "" {
		return evolutionSessionConfig{Settings: map[string]any{}}, nil
	}
	if _, ok := normalizeUUID(sessionID); !ok {
		return evolutionSessionConfig{}, fmt.Errorf("%w: WhatsApp session is invalid", ErrProviderFailed)
	}
	if client.db == nil {
		return evolutionSessionConfig{}, fmt.Errorf("%w: WhatsApp session storage is not configured", ErrProviderFailed)
	}

	var session evolutionSessionConfig
	var settingsRaw string
	err := client.db.Pool().QueryRow(ctx, `
		select
			id::text,
			coalesce(instance_name, ''),
			coalesce(instance_id, ''),
			coalesce(advanced_settings, '{}'::jsonb)::text
		from public.whatsapp_sessions
		where id = $1::uuid
		limit 1
	`, sessionID).Scan(&session.ID, &session.InstanceName, &session.InstanceID, &settingsRaw)
	if errors.Is(err, pgx.ErrNoRows) {
		return evolutionSessionConfig{}, fmt.Errorf("%w: WhatsApp session was not found", ErrProviderFailed)
	}
	if err != nil {
		return evolutionSessionConfig{}, err
	}

	session.Settings = map[string]any{}
	_ = json.Unmarshal([]byte(settingsRaw), &session.Settings)

	return session, nil
}

func (client functionsClient) evolutionInstanceKey(session evolutionSessionConfig, payload map[string]any, body map[string]any) string {
	candidates := []any{
		session.Settings["evolution_go_resolved_instance_key"],
		payload["instance_id"],
		payload["instanceId"],
		body["instanceId"],
		session.InstanceID,
		payload["instance_name"],
		payload["instanceName"],
		body["name"],
		body["instanceName"],
		session.InstanceName,
	}

	for _, candidate := range candidates {
		if value := stringFromAny(candidate); value != "" {
			return value
		}
	}

	return ""
}

func (client functionsClient) evolutionSessionToken(session evolutionSessionConfig, payload map[string]any) string {
	token := stringFromAny(firstPresentAny(payload["token"], session.Settings["token"]))
	if token == "" || token == "default_token" {
		return client.evolutionGoAPIKey
	}

	return token
}

func (client functionsClient) evolutionFetch(ctx context.Context, method string, path string, options evolutionFetchOptions) (evolutionFetchResult, error) {
	endpoint, err := url.Parse(client.evolutionGoAPIURL + path)
	if err != nil {
		return evolutionFetchResult{}, err
	}
	query := endpoint.Query()
	for key, value := range options.Query {
		if text := stringFromAny(value); text != "" {
			query.Set(key, text)
		}
	}
	endpoint.RawQuery = query.Encode()

	var body io.Reader
	if options.Body != nil && method != http.MethodGet && method != http.MethodHead {
		raw, err := json.Marshal(options.Body)
		if err != nil {
			return evolutionFetchResult{}, err
		}
		body = bytes.NewReader(raw)
	}

	request, err := http.NewRequestWithContext(ctx, method, endpoint.String(), body)
	if err != nil {
		return evolutionFetchResult{}, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	if options.UseGlobalAPIKey || options.Token == "" {
		request.Header.Set("apikey", client.evolutionGoAPIKey)
	} else {
		request.Header.Set("apikey", options.Token)
	}
	if options.InstanceID != "" {
		request.Header.Set("instanceId", options.InstanceID)
	}

	response, err := client.httpClient.Do(request)
	if err != nil {
		return evolutionFetchResult{}, fmt.Errorf("%w: %w: %v", ErrProviderFailed, ErrProviderOutcomeUnknown, err)
	}
	defer response.Body.Close()

	responseLimit := options.MaxResponseBytes
	if responseLimit <= 0 {
		responseLimit = 1 << 20
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, responseLimit+1))
	if err != nil {
		return evolutionFetchResult{}, fmt.Errorf("%w: %w: response read failed: %v", ErrProviderFailed, ErrProviderOutcomeUnknown, err)
	}
	if int64(len(raw)) > responseLimit {
		return evolutionFetchResult{}, fmt.Errorf("%w: %w: Evolution Go response exceeds the allowed size", ErrProviderFailed, ErrProviderOutcomeUnknown)
	}

	var data any = map[string]any{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &data); err != nil {
			data = map[string]any{"raw": string(raw)}
		}
	}

	return evolutionFetchResult{
		OK:      response.StatusCode >= 200 && response.StatusCode < 300,
		Status:  response.StatusCode,
		Data:    data,
		RawText: string(raw),
	}, nil
}

func evolutionEndpointFor(action string, body map[string]any, instanceKey string) (evolutionEndpoint, error) {
	switch action {
	case "instance.create":
		instanceName := firstPresentAny(body["name"], body["instanceName"], instanceKey)
		return evolutionEndpoint{
			Method: http.MethodPost,
			Path:   "/instance/create",
			Body: withoutEmptyMap(map[string]any{
				"name":         instanceName,
				"instanceName": instanceName,
				"integration":  firstPresentAny(body["integration"], "WHATSAPP-BAILEYS"),
				"token":        body["token"],
				"proxy":        body["proxy"],
				"webhookUrl":   firstPresentAny(body["webhookUrl"], body["webhook_url"], body["url"]),
				"webhook_url":  firstPresentAny(body["webhook_url"], body["webhookUrl"], body["url"]),
				"subscribe":    body["subscribe"],
				"events":       body["events"],
				"advancedSettings": mergeMaps(map[string]any{
					"rejectCall":      false,
					"ignoreGroups":    false,
					"alwaysOnline":    false,
					"readMessages":    false,
					"ignoreStatus":    false,
					"syncFullHistory": false,
				}, mapFromAny(body["advancedSettings"])),
			}),
		}, nil
	case "instance.connect":
		return evolutionEndpoint{Method: http.MethodPost, Path: "/instance/connect", Query: map[string]any{"instanceId": instanceKey}, Body: body}, nil
	case "instance.reconnect":
		return evolutionEndpoint{Method: http.MethodPost, Path: "/instance/reconnect"}, nil
	case "instance.forceReconnect":
		return evolutionEndpoint{
			Method: http.MethodPost,
			Path:   fmt.Sprintf("/instance/forcereconnect/%s", url.PathEscape(instanceKey)),
			Body: withoutEmptyMap(map[string]any{
				"number": body["number"],
			}),
		}, nil
	case "instance.info":
		return evolutionEndpoint{
			Method: http.MethodGet,
			Path:   fmt.Sprintf("/instance/info/%s", url.PathEscape(instanceKey)),
		}, nil
	case "instance.advancedSettings":
		return evolutionEndpoint{
			Method: http.MethodPut,
			Path:   fmt.Sprintf("/instance/%s/advanced-settings", url.PathEscape(instanceKey)),
			Body:   evolutionNotificationSafeSettingsBody(),
		}, nil
	case "instance.delete":
		return evolutionEndpoint{Method: http.MethodDelete, Path: fmt.Sprintf("/instance/delete/%s", url.PathEscape(instanceKey))}, nil
	case "instance.disconnect":
		return evolutionEndpoint{Method: http.MethodPost, Path: "/instance/disconnect"}, nil
	case "instance.logout":
		return evolutionEndpoint{Method: http.MethodDelete, Path: "/instance/logout"}, nil
	case "send.text":
		return evolutionEndpoint{Method: http.MethodPost, Path: "/send/text", Body: evolutionSendTextBody(body)}, nil
	case "send.media":
		return evolutionEndpoint{Method: http.MethodPost, Path: "/send/media", Body: evolutionSendMediaBody(body, "")}, nil
	case "send.audio":
		return evolutionEndpoint{Method: http.MethodPost, Path: "/send/media", Body: evolutionSendMediaBody(body, "audio")}, nil
	case "send.sticker":
		return evolutionEndpoint{Method: http.MethodPost, Path: "/send/sticker", Body: body}, nil
	case "message.delete":
		return evolutionEndpoint{Method: http.MethodPost, Path: "/message/delete", Body: body}, nil
	case "message.edit":
		return evolutionEndpoint{Method: http.MethodPost, Path: "/message/edit", Body: body}, nil
	case "message.react":
		return evolutionEndpoint{Method: http.MethodPost, Path: "/message/react", Body: body}, nil
	case "message.downloadMedia":
		// Evolution Go mainline exposes this route. Keep the action allowlisted
		// here so provider media recovery can never turn into an arbitrary fetch.
		return evolutionEndpoint{Method: http.MethodPost, Path: "/message/downloadmedia", Body: body}, nil
	case "message.downloadImage":
		// Compatibility route used by the currently deployed Evolution Go build.
		return evolutionEndpoint{Method: http.MethodPost, Path: "/message/downloadimage", Body: body}, nil
	case "message.markread":
		if body["allowWhatsAppReadReceipt"] != true {
			return evolutionEndpoint{Skipped: true, Reason: "read_receipts_disabled"}, nil
		}
		return evolutionEndpoint{Method: http.MethodPost, Path: "/message/markread", Body: withoutEmptyMap(map[string]any{
			"jid":        firstPresentAny(body["jid"], body["remoteJid"], body["number"]),
			"messageIds": body["messageIds"],
			"messageId":  body["messageId"],
		})}, nil
	case "chat.archive":
		return evolutionEndpoint{Method: http.MethodPost, Path: "/chat/archive", Body: body}, nil
	case "chat.mute":
		return evolutionEndpoint{Method: http.MethodPost, Path: "/chat/mute", Body: body}, nil
	case "chat.pin":
		return evolutionEndpoint{Method: http.MethodPost, Path: "/chat/pin", Body: body}, nil
	case "chat.historySync":
		return evolutionEndpoint{Method: http.MethodPost, Path: "/chat/historySync", Body: body}, nil
	case "label.list":
		return evolutionEndpoint{Method: http.MethodGet, Path: "/label"}, nil
	case "label.addChat":
		return evolutionEndpoint{Method: http.MethodPost, Path: "/label/chat", Body: body}, nil
	case "label.removeChat":
		return evolutionEndpoint{Method: http.MethodPost, Path: "/unlabel/chat", Body: body}, nil
	case "group.myAll":
		return evolutionEndpoint{Method: http.MethodGet, Path: "/group/myall"}, nil
	case "group.info":
		return evolutionEndpoint{Method: http.MethodPost, Path: "/group/info", Body: body}, nil
	case "group.inviteLink":
		return evolutionEndpoint{Method: http.MethodPost, Path: "/group/invitelink", Body: body}, nil
	case "group.setName":
		return evolutionEndpoint{Method: http.MethodPost, Path: "/group/name", Body: body}, nil
	case "group.setDescription":
		return evolutionEndpoint{Method: http.MethodPost, Path: "/group/description", Body: body}, nil
	case "group.setPhoto":
		return evolutionEndpoint{Method: http.MethodPost, Path: "/group/photo", Body: body}, nil
	case "user.avatar":
		return evolutionEndpoint{Method: http.MethodPost, Path: "/user/avatar", Body: body}, nil
	case "user.check":
		return evolutionEndpoint{Method: http.MethodPost, Path: "/user/check", Body: body}, nil
	case "user.contacts":
		return evolutionEndpoint{Method: http.MethodGet, Path: "/user/contacts"}, nil
	default:
		return evolutionEndpoint{}, fmt.Errorf("%w: unsupported Evolution Go action: %s", ErrProviderFailed, action)
	}
}

func evolutionNotificationSafeSettingsBody() map[string]any {
	return map[string]any{
		"alwaysOnline": false,
		"readMessages": false,
		"rejectCall":   false,
		"ignoreGroups": false,
		"ignoreStatus": false,
	}
}

func evolutionSendTextBody(body map[string]any) map[string]any {
	out := evolutionSendCommonBody(body)
	out["text"] = firstPresentAny(body["text"], body["message"], body["body"], body["caption"])

	return withoutEmptyMap(out)
}

func evolutionSendMediaBody(body map[string]any, forcedType string) map[string]any {
	mediaType := firstPresentAny(forcedType, body["type"], body["mediatype"], body["mediaType"], body["kind"])
	urlMedia := firstPresentAny(body["url"], body["mediaUrl"], body["path"], body["file"])
	base64Media := firstPresentAny(body["base64"], body["base64Media"])
	media := firstPresentAny(urlMedia, body["media"], base64Media)
	filename := firstPresentAny(body["filename"], body["fileName"], body["name"])
	out := evolutionSendCommonBody(body)
	out["type"] = mediaType
	out["mediatype"] = mediaType
	out["mediaType"] = mediaType
	out["media"] = media
	if urlMedia != nil {
		out["url"] = urlMedia
		out["mediaUrl"] = urlMedia
		out["path"] = urlMedia
		out["file"] = urlMedia
	}
	if base64Media != nil {
		out["base64"] = base64Media
	}
	if mediaType == "audio" {
		out["audio"] = media
		out["ptt"] = firstPresentAny(body["ptt"], true)
	}
	if mediaType == "image" {
		out["image"] = media
	}
	if mediaType == "video" {
		out["video"] = media
	}
	if mediaType == "document" {
		out["document"] = media
	}
	out["mimetype"] = body["mimetype"]
	out["caption"] = body["caption"]
	out["filename"] = filename
	out["fileName"] = filename

	return withoutEmptyMap(out)
}

func evolutionSendCommonBody(body map[string]any) map[string]any {
	return withoutEmptyMap(map[string]any{
		"id":           firstPresentAny(body["id"], body["messageId"], body["clientMessageId"]),
		"number":       firstPresentAny(body["number"], body["phone"], body["jid"], body["remoteJid"]),
		"delay":        body["delay"],
		"quoted":       body["quoted"],
		"mentionAll":   body["mentionAll"],
		"mentionedJid": normalizeEvolutionMentionedJids(firstPresentAny(body["mentionedJid"], body["mentionedJids"], body["mentions"])),
	})
}

func normalizeEvolutionMentionedJids(value any) any {
	switch typed := value.(type) {
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := stringFromAny(item); text != "" {
				out = append(out, text)
			}
		}
		return out
	case []string:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if strings.TrimSpace(item) != "" {
				out = append(out, strings.TrimSpace(item))
			}
		}
		return out
	case string:
		parts := strings.Split(typed, ",")
		out := make([]string, 0, len(parts))
		for _, item := range parts {
			if strings.TrimSpace(item) != "" {
				out = append(out, strings.TrimSpace(item))
			}
		}
		return out
	default:
		return nil
	}
}

func normalizeEvolutionQR(data any) string {
	if text := stringFromAny(data); text != "" && strings.HasPrefix(text, "data:") {
		return text
	}

	return firstString(data,
		"qrcode",
		"Qrcode",
		"qrCode",
		"base64",
		"code",
		"data.qrcode",
		"data.Qrcode",
		"data.base64",
		"data.code",
	)
}

func normalizeEvolutionStatus(data any) string {
	rawState := strings.ToLower(firstString(data,
		"state",
		"connectionStatus",
		"data.state",
		"data.connectionStatus",
		"data.instance.state",
		"data.instance.connectionStatus",
		"data.session.state",
		"data.session.connectionStatus",
		"instance.state",
		"instance.connectionStatus",
		"session.state",
		"session.connectionStatus",
		"response.state",
		"response.connectionStatus",
	))
	rawStatus := strings.ToLower(firstString(data,
		"status",
		"data.status",
		"data.instance.status",
		"data.session.status",
		"instance.status",
		"session.status",
		"response.status",
	))
	loggedIn, hasLoggedIn := boolAtPath(data,
		"loggedIn",
		"LoggedIn",
		"data.loggedIn",
		"data.LoggedIn",
		"data.instance.loggedIn",
		"data.instance.LoggedIn",
		"instance.loggedIn",
		"instance.LoggedIn",
	)
	loggedOut := false
	if hasLoggedIn && !loggedIn {
		loggedOut = true
	}
	connected, hasConnected := boolAtPath(data,
		"connected",
		"Connected",
		"data.connected",
		"data.Connected",
		"data.instance.connected",
		"data.instance.Connected",
		"instance.connected",
		"instance.Connected",
	)

	if hasLoggedIn && hasConnected {
		if loggedIn && connected {
			return "connected"
		}
		if !loggedIn && connected {
			return "qr_ready"
		}
		return "disconnected"
	}
	if hasLoggedIn {
		if loggedIn {
			return "connected"
		}
		return "disconnected"
	}
	if hasConnected {
		if connected {
			return "connected"
		}
		return "disconnected"
	}

	if (stringIn(rawState, "open", "connected", "online", "ready", "authenticated", "logged_in", "loggedin") ||
		stringIn(rawStatus, "open", "connected", "online", "ready", "authenticated", "logged_in", "loggedin")) && !loggedOut {
		return "connected"
	}
	if stringIn(rawState, "qr", "qrcode", "qr_ready", "pairing", "connecting") ||
		stringIn(rawStatus, "qr", "qrcode", "qr_ready", "pairing", "connecting") ||
		normalizeEvolutionQR(data) != "" {
		return "qr_ready"
	}
	if loggedOut || stringIn(rawState, "close", "closed", "disconnected", "disconnect", "offline", "logout", "logged_out") ||
		stringIn(rawStatus, "close", "closed", "disconnected", "offline", "logout", "logged_out") {
		return "disconnected"
	}

	return ""
}

func isEvolutionSendAction(action string) bool {
	return stringIn(action,
		"send.text",
		"send.media",
		"send.audio",
		"send.sticker",
		"send.location",
		"send.contact",
		"send.link",
		"send.poll",
	)
}

func evolutionSentMessageID(data any) string {
	if dataMap, ok := data.(map[string]any); ok {
		if value := providerMessageID(dataMap); value != "" {
			return value
		}
	}

	return providerMessageID(map[string]any{"data": data})
}

func evolutionSemanticFailure(data any) bool {
	return falseAtPath(data, "success") ||
		falseAtPath(data, "ok") ||
		falseAtPath(data, "data.success") ||
		falseAtPath(data, "data.ok")
}

func evolutionErrorMessage(data any, raw string) string {
	message := firstString(data, "error", "message", "data.error", "data.message")
	if message != "" {
		return message
	}
	if strings.TrimSpace(raw) != "" {
		return strings.TrimSpace(raw)
	}

	return "Falha na Evolution Go."
}

func firstPresentAny(values ...any) any {
	for _, value := range values {
		if stringValue, ok := value.(string); ok {
			if strings.TrimSpace(stringValue) != "" {
				return strings.TrimSpace(stringValue)
			}
			continue
		}
		if value != nil {
			return value
		}
	}

	return nil
}

func stringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	case float64:
		return fmt.Sprintf("%.0f", typed)
	case float32:
		return fmt.Sprintf("%.0f", typed)
	case int:
		return fmt.Sprintf("%d", typed)
	case int64:
		return fmt.Sprintf("%d", typed)
	case int32:
		return fmt.Sprintf("%d", typed)
	default:
		return ""
	}
}

func mapFromAny(value any) map[string]any {
	if valueMap, ok := value.(map[string]any); ok {
		return valueMap
	}

	return map[string]any{}
}

func withoutEmptyMap(input map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range input {
		if value == nil {
			continue
		}
		if text, ok := value.(string); ok && strings.TrimSpace(text) == "" {
			continue
		}
		if items, ok := value.([]string); ok && len(items) == 0 {
			continue
		}
		out[key] = value
	}

	return out
}

func mergeMaps(base map[string]any, override map[string]any) map[string]any {
	out := cloneMap(base)
	for key, value := range override {
		out[key] = value
	}

	return out
}

func cloneMap(input map[string]any) map[string]any {
	out := make(map[string]any, len(input))
	for key, value := range input {
		out[key] = value
	}

	return out
}

func boolFromMap(value any, keys ...string) (bool, bool) {
	valueMap, ok := value.(map[string]any)
	if !ok {
		return false, false
	}
	for _, key := range keys {
		if raw, exists := valueMap[key]; exists {
			if value, ok := raw.(bool); ok {
				return value, true
			}
		}
	}

	return false, false
}

func boolAtPath(value any, paths ...string) (bool, bool) {
	for _, path := range paths {
		current := value
		for _, key := range strings.Split(path, ".") {
			if object, ok := current.(map[string]any); ok {
				current = object[key]
			} else {
				current = nil
				break
			}
		}
		if currentBool, ok := current.(bool); ok {
			return currentBool, true
		}
	}

	return false, false
}

func falseAtPath(value any, path string) bool {
	current := value
	for _, key := range strings.Split(path, ".") {
		if object, ok := current.(map[string]any); ok {
			current = object[key]
		} else {
			return false
		}
	}

	if currentBool, ok := current.(bool); ok {
		return !currentBool
	}

	return false
}

func stringIn(value string, candidates ...string) bool {
	for _, candidate := range candidates {
		if value == candidate {
			return true
		}
	}

	return false
}
