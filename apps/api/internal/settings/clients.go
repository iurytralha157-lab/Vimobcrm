package settings

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type ExternalConfig struct {
	ProjectURL    string
	APIKey        string
	ResendAPIKey  string
	FromEmail     string
	ReplyTo       string
	SupportEmail  string
	AppURL        string
}

type storageClient struct {
	projectURL string
	apiKey     string
	httpClient *http.Client
}

type authAdminClient struct {
	projectURL string
	apiKey     string
	httpClient *http.Client
}

type passwordNotificationClient struct {
	apiKey       string
	fromEmail    string
	replyTo      string
	supportEmail string
	appURL       string
	httpClient   *http.Client
}

type passwordChangedEmailInput struct {
	UserID    string
	Email     string
	Name      string
	ChangedAt time.Time
}

func newStorageClient(config ExternalConfig) storageClient {
	return storageClient{
		projectURL: strings.TrimRight(strings.TrimSpace(config.ProjectURL), "/"),
		apiKey:     strings.TrimSpace(config.APIKey),
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func newAuthAdminClient(config ExternalConfig) authAdminClient {
	return authAdminClient{
		projectURL: strings.TrimRight(strings.TrimSpace(config.ProjectURL), "/"),
		apiKey:     strings.TrimSpace(config.APIKey),
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func newPasswordNotificationClient(config ExternalConfig) passwordNotificationClient {
	return passwordNotificationClient{
		apiKey:       strings.TrimSpace(config.ResendAPIKey),
		fromEmail:    cleanEmailHeader(firstNonEmpty(config.FromEmail, "Vimob CRM <naoresponde@vimobcrm.com.br>")),
		replyTo:      cleanEmailHeader(firstNonEmpty(config.ReplyTo, "contato@vimobcrm.com.br")),
		supportEmail: cleanEmailHeader(firstNonEmpty(config.SupportEmail, "contato@vimobcrm.com.br")),
		appURL:       strings.TrimRight(firstNonEmpty(config.AppURL, "https://vimobcrm.com.br"), "/"),
		httpClient:   &http.Client{Timeout: 15 * time.Second},
	}
}

func (client passwordNotificationClient) isConfigured() bool {
	return client.apiKey != "" && client.fromEmail != ""
}

func (client storageClient) upload(ctx context.Context, bucket string, objectPath string, contentType string, body io.Reader) error {
	if client.projectURL == "" || client.apiKey == "" {
		return ErrStorageNotConfigured
	}

	endpoint := fmt.Sprintf(
		"%s/storage/v1/object/%s/%s",
		client.projectURL,
		url.PathEscape(bucket),
		escapeStorageObjectPath(objectPath),
	)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, body)
	if err != nil {
		return err
	}
	request.Header.Set("apikey", client.apiKey)
	request.Header.Set("Authorization", "Bearer "+client.apiKey)
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("Cache-Control", "3600")
	request.Header.Set("x-upsert", "true")

	response, err := client.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		payload, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return externalStatusError(ErrStorageOperation, response.Status, payload)
	}

	return nil
}

func (client storageClient) publicURL(bucket string, objectPath string) string {
	if client.projectURL == "" {
		return ""
	}

	return fmt.Sprintf(
		"%s/storage/v1/object/public/%s/%s",
		client.projectURL,
		url.PathEscape(bucket),
		escapeStorageObjectPath(objectPath),
	)
}

func (client authAdminClient) updatePassword(ctx context.Context, userID string, password string) error {
	if client.projectURL == "" || client.apiKey == "" {
		return ErrAuthNotConfigured
	}

	payload, _ := json.Marshal(map[string]any{"password": password})
	endpoint := fmt.Sprintf("%s/auth/v1/admin/users/%s", client.projectURL, url.PathEscape(userID))
	request, err := http.NewRequestWithContext(ctx, http.MethodPut, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("apikey", client.apiKey)
	request.Header.Set("Authorization", "Bearer "+client.apiKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")

	response, err := client.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		payload, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return externalStatusError(ErrAuthOperation, response.Status, payload)
	}

	return nil
}

func (client passwordNotificationClient) sendPasswordChanged(ctx context.Context, input passwordChangedEmailInput) error {
	email := cleanEmailHeader(input.Email)
	if client.apiKey == "" || email == "" {
		return nil
	}

	changedAt := input.ChangedAt.UTC()
	if changedAt.IsZero() {
		changedAt = time.Now().UTC()
	}

	body, _ := json.Marshal(map[string]any{
		"from":    client.fromEmail,
		"to":      []string{email},
		"subject": "Senha alterada com sucesso no Vimob CRM",
		"html":    client.renderPasswordChangedHTML(input, changedAt),
		"reply_to": client.replyTo,
	})

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+client.apiKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	if input.UserID != "" {
		request.Header.Set("Idempotency-Key", fmt.Sprintf("password-changed-%s-%d", input.UserID, changedAt.Unix()))
	}

	response, err := client.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		payload, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return externalStatusError(ErrEmailOperation, response.Status, payload)
	}

	return nil
}

func (client passwordNotificationClient) renderPasswordChangedHTML(input passwordChangedEmailInput, changedAt time.Time) string {
	name := strings.TrimSpace(input.Name)
	greeting := "Ola."
	if name != "" {
		greeting = fmt.Sprintf("Ola, %s.", html.EscapeString(name))
	}

	appURL := html.EscapeString(client.appURL)
	supportEmail := html.EscapeString(client.supportEmail)
	changedAtLabel := html.EscapeString(changedAt.Format("02/01/2006 15:04 UTC"))

	return fmt.Sprintf(`<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Senha alterada com sucesso</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f6f3;color:#151515;font-family:Arial,Helvetica,sans-serif">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%%" style="width:100%%;background:#f5f6f3;border-collapse:collapse">
      <tr>
        <td align="center" style="padding:32px 16px">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%%" style="width:100%%;max-width:640px;border-collapse:collapse">
            <tr>
              <td style="background:#ffffff;border:1px solid #e2e5df;border-radius:14px;overflow:hidden;box-shadow:0 16px 42px rgba(21,21,21,.06)">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%%" style="border-collapse:collapse">
                  <tr>
                    <td style="height:6px;background:#ff4529;font-size:0;line-height:0">&nbsp;</td>
                  </tr>
                  <tr>
                    <td style="padding:34px 34px 10px">
                      <p style="margin:0 0 10px;color:#d9341d;font-size:12px;font-weight:700;line-height:1.4;text-transform:uppercase;letter-spacing:1.8px">Seguran&ccedil;a da conta</p>
                      <h1 style="margin:0;color:#151515;font-size:30px;font-weight:700;line-height:1.18;letter-spacing:0">Senha alterada com sucesso</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:18px 34px 36px">
                      <p style="margin:0 0 16px;color:#151515;font-size:16px;line-height:1.65">%s</p>
                      <p style="margin:0 0 16px;color:#151515;font-size:16px;line-height:1.65">A senha da sua conta no Vimob CRM foi alterada em %s.</p>
                      <p style="margin:0 0 16px;color:#151515;font-size:16px;line-height:1.65">Se foi voc&ecirc;, nenhuma a&ccedil;&atilde;o adicional &eacute; necess&aacute;ria.</p>
                      <p style="margin:24px 0 0;padding:14px 16px;border-left:4px solid #ff4529;background:#fff0ed;color:#151515;font-size:14px;line-height:1.6;border-radius:0 8px 8px 0">Se voc&ecirc; n&atilde;o reconhece essa altera&ccedil;&atilde;o, entre em contato imediatamente pelo e-mail <a href="mailto:%s" style="color:#d9341d;text-decoration:underline">%s</a>.</p>
                      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 6px">
                        <tr>
                          <td bgcolor="#ff4529" style="border-radius:8px">
                            <a href="%s/login" style="display:inline-block;padding:14px 22px;color:#ffffff;font-size:15px;font-weight:700;line-height:1;text-decoration:none;border-radius:8px;background:#ff4529">Acessar Vimob CRM</a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding:22px 8px 0;color:#626872;font-size:12px;line-height:1.65">
                <p style="margin:0">Por seguranca, o Vimob CRM nunca envia senhas por e-mail.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`, greeting, changedAtLabel, supportEmail, supportEmail, appURL)
}

func externalStatusError(base error, status string, payload []byte) error {
	message := strings.TrimSpace(string(payload))
	if message == "" {
		message = status
	}

	return fmt.Errorf("%w: %s", base, message)
}

func cleanEmailHeader(value string) string {
	return strings.TrimSpace(strings.NewReplacer("\r", " ", "\n", " ").Replace(value))
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}

	return ""
}

func escapeStorageObjectPath(value string) string {
	parts := strings.Split(strings.Trim(value, "/"), "/")
	for index, part := range parts {
		parts[index] = url.PathEscape(part)
	}

	return strings.Join(parts, "/")
}
