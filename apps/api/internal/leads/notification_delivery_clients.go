package leads

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

type notificationEmailClient struct {
	apiKey       string
	fromEmail    string
	replyTo      string
	supportEmail string
	appURL       string
	httpClient   *http.Client
}

type dealWonEmailPayload struct {
	RecipientEmail string
	RecipientName  string
	LeadName       string
	ActorName      string
	Organization   string
	Value          string
	LeadURL        string
}

func newNotificationEmailClient(config EmailConfig) notificationEmailClient {
	return notificationEmailClient{
		apiKey:       strings.TrimSpace(config.ResendAPIKey),
		fromEmail:    firstNotificationText(config.FromEmail, "Vimob CRM <naoresponde@vimobcrm.com.br>"),
		replyTo:      strings.TrimSpace(config.ReplyTo),
		supportEmail: strings.TrimSpace(config.SupportEmail),
		appURL:       strings.TrimRight(firstNotificationText(config.AppURL, "https://app.vimobcrm.com.br"), "/"),
		httpClient:   &http.Client{Timeout: 15 * time.Second},
	}
}

func (client notificationEmailClient) sendDealWon(ctx context.Context, payload dealWonEmailPayload) DispatchChannelResult {
	result := DispatchChannelResult{Enabled: client.apiKey != ""}
	if strings.TrimSpace(payload.RecipientEmail) == "" {
		result.Error = "recipient_email_missing"
		return result
	}
	if client.apiKey == "" {
		result.Error = "resend_api_key_missing"
		return result
	}

	subject := "Lead ganho no Vimob"
	leadName := firstNotificationText(payload.LeadName, "Lead")
	actorName := firstNotificationText(payload.ActorName, "Equipe Vimob")
	body := client.dealWonHTML(payload, leadName, actorName)
	requestBody := map[string]any{
		"from":    client.fromEmail,
		"to":      []string{strings.TrimSpace(payload.RecipientEmail)},
		"subject": subject,
		"html":    body,
	}
	if client.replyTo != "" {
		requestBody["reply_to"] = client.replyTo
	}

	rawBody, err := json.Marshal(requestBody)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(rawBody))
	if err != nil {
		result.Error = err.Error()
		return result
	}
	request.Header.Set("Authorization", "Bearer "+client.apiKey)
	request.Header.Set("Content-Type", "application/json")

	result.Attempted = true
	result.Provider = "resend"
	response, err := client.httpClient.Do(request)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	defer response.Body.Close()
	result.Status = response.StatusCode
	result.OK = response.StatusCode >= 200 && response.StatusCode < 300
	if !result.OK {
		raw, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
		result.Error = trimMax(firstNotificationText(strings.TrimSpace(string(raw)), response.Status), 240)
	}
	return result
}

func (client notificationEmailClient) dealWonHTML(payload dealWonEmailPayload, leadName string, actorName string) string {
	valueLine := ""
	if strings.TrimSpace(payload.Value) != "" {
		valueLine = fmt.Sprintf(`<p style="margin:0 0 8px;color:#4b5563;font-size:15px;">Valor: <strong style="color:#111827;">%s</strong></p>`, htmlEscape(payload.Value))
	}
	button := ""
	if strings.TrimSpace(payload.LeadURL) != "" {
		button = fmt.Sprintf(`<a href="%s" style="display:inline-block;background:#ff482a;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;font-size:14px;">Abrir lead</a>`, htmlEscape(payload.LeadURL))
	}
	return fmt.Sprintf(`<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:28px;">
  <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #eee;">
    <p style="margin:0 0 8px;color:#ff482a;font-size:13px;font-weight:700;text-transform:uppercase;">Lead ganho</p>
    <h1 style="margin:0 0 16px;color:#111827;font-size:24px;line-height:1.25;">%s marcou um lead como ganho</h1>
    <p style="margin:0 0 8px;color:#4b5563;font-size:15px;">Lead: <strong style="color:#111827;">%s</strong></p>
    %s
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">%s</p>
    %s
  </div>
</div>
</body></html>`, htmlEscape(actorName), htmlEscape(leadName), valueLine, htmlEscape(firstNotificationText(payload.Organization, "Vimob CRM")), button)
}

type notificationPushClient struct {
	vapidPublicKey        string
	vapidPrivateKey       string
	vapidSubject          string
	fcmServerKey          string
	fcmProjectID          string
	fcmServiceAccountJSON string
	fcmServiceAccountFile string
	fcmTokenMu            sync.Mutex
	fcmAccessToken        string
	fcmAccessTokenExpiry  time.Time
	httpClient            *http.Client
}

type pushSubscription struct {
	ID       string
	Endpoint string
	P256DH   string
	Auth     string
	Token    string
	Platform string
}

type pushPayload struct {
	Title     string
	Body      string
	Type      string
	LeadID    *string
	TargetURL string
}

func newNotificationPushClient(config PushConfig) *notificationPushClient {
	subject := strings.TrimSpace(config.VAPIDSubject)
	if strings.HasPrefix(strings.ToLower(subject), "mailto:") {
		subject = strings.TrimSpace(subject[len("mailto:"):])
	}
	return &notificationPushClient{
		vapidPublicKey:        strings.TrimSpace(config.VAPIDPublicKey),
		vapidPrivateKey:       strings.TrimSpace(config.VAPIDPrivateKey),
		vapidSubject:          firstNotificationText(subject, "contato@vimobcrm.com.br"),
		fcmServerKey:          strings.TrimSpace(config.FCMServerKey),
		fcmProjectID:          strings.TrimSpace(config.FCMProjectID),
		fcmServiceAccountJSON: strings.TrimSpace(config.FCMServiceAccountJSON),
		fcmServiceAccountFile: strings.TrimSpace(config.FCMServiceAccountFile),
		httpClient:            &http.Client{Timeout: 15 * time.Second},
	}
}

func (client *notificationPushClient) hasAnySender() bool {
	if client == nil {
		return false
	}
	return client.vapidPrivateKey != "" || client.hasNativeFCMSender()
}

func (client *notificationPushClient) hasNativeFCMSender() bool {
	if client == nil {
		return false
	}
	return client.hasFCMV1CredentialSource() || client.fcmServerKey != ""
}

func (client *notificationPushClient) hasFCMV1CredentialSource() bool {
	if client == nil {
		return false
	}
	return client.fcmServiceAccountJSON != "" || client.fcmServiceAccountFile != ""
}

func (client *notificationPushClient) send(ctx context.Context, subscription pushSubscription, payload pushPayload) DispatchChannelResult {
	if isNativePushSubscription(subscription) {
		return client.sendNativeFCM(ctx, subscription, payload)
	}
	return client.sendWeb(ctx, subscription, payload)
}

func isNativePushSubscription(subscription pushSubscription) bool {
	platform := strings.ToLower(strings.TrimSpace(subscription.Platform))
	return strings.HasPrefix(strings.TrimSpace(subscription.Endpoint), "native:") ||
		platform == "ios" ||
		platform == "android"
}

func (client *notificationPushClient) sendWeb(ctx context.Context, subscription pushSubscription, payload pushPayload) DispatchChannelResult {
	result := DispatchChannelResult{Enabled: client.vapidPrivateKey != ""}
	if subscription.Endpoint == "" || subscription.P256DH == "" || subscription.Auth == "" {
		result.Error = "web_push_subscription_incomplete"
		return result
	}
	if client.vapidPrivateKey == "" {
		result.Error = "vapid_private_key_missing"
		return result
	}

	message, err := json.Marshal(map[string]any{
		"title":      payload.Title,
		"body":       payload.Body,
		"type":       payload.Type,
		"lead_id":    payload.LeadID,
		"target_url": payload.TargetURL,
	})
	if err != nil {
		result.Error = err.Error()
		return result
	}

	result.Attempted = true
	result.Provider = "web_push"
	response, err := webpush.SendNotificationWithContext(ctx, message, &webpush.Subscription{
		Endpoint: subscription.Endpoint,
		Keys: webpush.Keys{
			Auth:   subscription.Auth,
			P256dh: subscription.P256DH,
		},
	}, &webpush.Options{
		HTTPClient:      client.httpClient,
		Subscriber:      client.vapidSubject,
		VAPIDPublicKey:  client.vapidPublicKey,
		VAPIDPrivateKey: client.vapidPrivateKey,
		TTL:             60 * 60,
	})
	if err != nil {
		result.Error = err.Error()
		return result
	}
	defer response.Body.Close()
	result.Status = response.StatusCode
	result.OK = response.StatusCode >= 200 && response.StatusCode < 300
	if !result.OK {
		raw, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
		result.Error = trimMax(firstNotificationText(strings.TrimSpace(string(raw)), response.Status), 240)
	}
	return result
}

func (client *notificationPushClient) sendNativeFCM(ctx context.Context, subscription pushSubscription, payload pushPayload) DispatchChannelResult {
	result := DispatchChannelResult{Enabled: client.hasNativeFCMSender()}
	token := nativePushToken(subscription)
	if token == "" {
		result.Error = "native_push_token_missing"
		return result
	}
	if client.hasFCMV1CredentialSource() {
		return client.sendNativeFCMV1(ctx, token, payload)
	}
	if client.fcmServerKey == "" {
		result.Error = "fcm_credentials_missing"
		return result
	}
	return client.sendNativeFCMLegacy(ctx, token, payload)
}

func (client *notificationPushClient) sendNativeFCMV1(ctx context.Context, token string, payload pushPayload) DispatchChannelResult {
	result := DispatchChannelResult{Enabled: true, Provider: "fcm_v1"}
	accessToken, projectID, err := client.fcmV1AccessToken(ctx)
	if err != nil {
		result.Error = trimMax(err.Error(), 240)
		return result
	}
	body := map[string]any{
		"message": map[string]any{
			"token": token,
			"notification": map[string]any{
				"title": payload.Title,
				"body":  payload.Body,
			},
			"data": map[string]string{
				"type":       payload.Type,
				"lead_id":    nullableStringPointer(payload.LeadID),
				"target_url": payload.TargetURL,
			},
			"android": map[string]any{
				"priority": "HIGH",
			},
			"apns": map[string]any{
				"headers": map[string]string{
					"apns-priority": "10",
				},
				"payload": map[string]any{
					"aps": map[string]any{
						"sound": "default",
					},
				},
			},
		},
	}
	rawBody, err := json.Marshal(body)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	endpoint := fmt.Sprintf("https://fcm.googleapis.com/v1/projects/%s/messages:send", url.PathEscape(projectID))
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(rawBody))
	if err != nil {
		result.Error = err.Error()
		return result
	}
	request.Header.Set("Authorization", "Bearer "+accessToken)
	request.Header.Set("Content-Type", "application/json")

	result.Attempted = true
	response, err := client.httpClient.Do(request)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	defer response.Body.Close()
	result.Status = response.StatusCode
	result.OK = response.StatusCode >= 200 && response.StatusCode < 300
	if !result.OK {
		raw, _ := io.ReadAll(io.LimitReader(response.Body, 8192))
		result.Error = classifyFCMV1Error(raw, response.Status)
	}
	return result
}

func (client *notificationPushClient) sendNativeFCMLegacy(ctx context.Context, token string, payload pushPayload) DispatchChannelResult {
	result := DispatchChannelResult{Enabled: client.fcmServerKey != ""}
	body := map[string]any{
		"to": token,
		"notification": map[string]any{
			"title": payload.Title,
			"body":  payload.Body,
		},
		"data": map[string]any{
			"type":       payload.Type,
			"lead_id":    nullableStringPointer(payload.LeadID),
			"target_url": payload.TargetURL,
		},
	}
	rawBody, err := json.Marshal(body)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://fcm.googleapis.com/fcm/send", bytes.NewReader(rawBody))
	if err != nil {
		result.Error = err.Error()
		return result
	}
	request.Header.Set("Authorization", "key="+client.fcmServerKey)
	request.Header.Set("Content-Type", "application/json")

	result.Attempted = true
	result.Provider = "fcm_legacy"
	response, err := client.httpClient.Do(request)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	defer response.Body.Close()
	result.Status = response.StatusCode
	result.OK = response.StatusCode >= 200 && response.StatusCode < 300
	raw, _ := io.ReadAll(io.LimitReader(response.Body, 8192))
	if result.OK {
		if errorText := classifyFCMLegacyBody(raw); errorText != "" {
			result.OK = false
			result.Error = errorText
		}
	} else {
		result.Error = trimMax(firstNotificationText(strings.TrimSpace(string(raw)), response.Status), 240)
	}
	return result
}

func classifyFCMV1Error(raw []byte, fallback string) string {
	var parsed struct {
		Error struct {
			Status  string `json:"status"`
			Message string `json:"message"`
			Details []struct {
				ErrorCode string `json:"errorCode"`
			} `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &parsed); err == nil {
		for _, detail := range parsed.Error.Details {
			if strings.EqualFold(strings.TrimSpace(detail.ErrorCode), "UNREGISTERED") {
				return "fcm_unregistered"
			}
		}
	}
	body := strings.TrimSpace(string(raw))
	if strings.Contains(strings.ToLower(body), `"errorcode":"unregistered"`) {
		return "fcm_unregistered"
	}
	return trimMax(firstNotificationText(body, fallback), 240)
}

func classifyFCMLegacyBody(raw []byte) string {
	body := strings.ToLower(strings.TrimSpace(string(raw)))
	if body == "" {
		return ""
	}
	if strings.Contains(body, `"error":"notregistered"`) ||
		strings.Contains(body, `"error":"invalidregistration"`) {
		return "fcm_unregistered"
	}
	return ""
}

func nativePushToken(subscription pushSubscription) string {
	if strings.TrimSpace(subscription.Token) != "" {
		return strings.TrimSpace(subscription.Token)
	}
	if strings.HasPrefix(subscription.Endpoint, "native:") {
		parts := strings.SplitN(subscription.Endpoint, ":", 3)
		if len(parts) == 3 {
			return strings.TrimSpace(parts[2])
		}
	}
	return ""
}

func nullableStringPointer(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func htmlEscape(value string) string {
	replacer := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&quot;",
		"'", "&#39;",
	)
	return replacer.Replace(value)
}
