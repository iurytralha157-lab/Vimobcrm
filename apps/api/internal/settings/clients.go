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

	"github.com/vimob-crm/vimob-crm/apps/api/internal/supabasehttp"
)

type ExternalConfig struct {
	ProjectURL          string
	APIKey              string
	ResendAPIKey        string
	FromEmail           string
	ReplyTo             string
	SupportEmail        string
	AppURL              string
	VAPIDPublicKey      string
	AsaasURL            string
	AsaasAPIKey         string
	AsaasRequestTimeout time.Duration
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
		supabasehttp.EscapeObjectPath(objectPath),
	)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, body)
	if err != nil {
		return err
	}
	supabasehttp.SetServiceAuth(request, client.apiKey)
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
	return supabasehttp.PublicObjectURL(client.projectURL, bucket, objectPath)
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
	supabasehttp.SetServiceAuth(request, client.apiKey)
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

func (client authAdminClient) revokeSessions(ctx context.Context, authorization string, scope string) error {
	if client.projectURL == "" || client.apiKey == "" {
		return ErrAuthNotConfigured
	}
	if (scope != "global" && scope != "others" && scope != "local") ||
		!strings.HasPrefix(authorization, "Bearer ") || strings.TrimSpace(strings.TrimPrefix(authorization, "Bearer ")) == "" {
		return ErrAuthOperation
	}

	endpoint := client.projectURL + "/auth/v1/logout?scope=" + scope
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, nil)
	if err != nil {
		return fmt.Errorf("%w: prepare session revocation: %v", ErrAuthOperation, err)
	}
	supabasehttp.SetServiceAuth(request, client.apiKey)
	request.Header.Set("Authorization", authorization)

	response, err := client.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("%w: revoke sessions: %v", ErrAuthOperation, err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("%w: session revocation returned HTTP %d", ErrAuthOperation, response.StatusCode)
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
		"from":     client.fromEmail,
		"to":       []string{email},
		"subject":  "Senha alterada com sucesso no Vimob CRM",
		"html":     client.renderPasswordChangedHTML(input, changedAt),
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
	greeting := "Olá."
	if name != "" {
		greeting = fmt.Sprintf("Olá, %s.", html.EscapeString(name))
	}

	appURL := html.EscapeString(client.appURL)
	supportEmail := html.EscapeString(client.supportEmail)
	changedAtLabel := html.EscapeString(changedAt.Format("02/01/2006 15:04 UTC"))

	return fmt.Sprintf(`<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light" />
    <title>Senha alterada com sucesso</title>
    <style>
      :root { color-scheme: light; }
      @media only screen and (max-width: 600px) {
        .email-page { padding:32px 18px !important; }
        .email-logo { padding-bottom:36px !important; }
        .email-title { font-size:22px !important; }
      }
    </style>
  </head>
  <body bgcolor="#f7f8f6" style="margin:0;padding:0;background:#f7f8f6;color:#151515;font-family:Geist,'Segoe UI',Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%%">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;line-height:1px;mso-hide:all">
      A senha da sua conta Vimob CRM foi alterada. Se não reconhece esta alteração, entre em contato com o suporte.
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%%" bgcolor="#f7f8f6" style="width:100%%;background:#f7f8f6;border-collapse:collapse">
      <tr>
        <td class="email-page" align="center" style="padding:52px 24px">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:100%%;max-width:560px;border-collapse:collapse">
            <tr>
              <td class="email-logo" align="left" style="padding:0 0 48px">
                <img src="https://vimobcrm.com.br/images/logo-black.png" width="85" height="29" alt="Vimob CRM" style="display:block;width:85px;height:29px;border:0;outline:none;text-decoration:none" />
              </td>
            </tr>
            <tr>
              <td align="left">
                <p style="margin:0 0 10px;color:#d9341d;font-size:12px;font-weight:600;line-height:1.4;text-transform:uppercase;letter-spacing:1.4px">Seguran&ccedil;a da conta</p>
                <h1 class="email-title" style="margin:0 0 28px;color:#151515;font-size:24px;font-weight:400;line-height:1.25">Senha alterada com sucesso</h1>
                <p style="margin:0 0 16px;color:#151515;font-size:15px;line-height:1.6">%s</p>
                <p style="margin:0 0 16px;color:#151515;font-size:15px;line-height:1.6">A senha da sua conta no Vimob CRM foi alterada em %s.</p>
                <p style="margin:0 0 24px;color:#151515;font-size:15px;line-height:1.6">Se foi voc&ecirc;, nenhuma a&ccedil;&atilde;o adicional &eacute; necess&aacute;ria.</p>
                <p style="margin:0 0 32px;color:#626872;font-size:14px;line-height:1.6">Se voc&ecirc; n&atilde;o reconhece essa altera&ccedil;&atilde;o, entre em contato imediatamente pelo e-mail <a href="mailto:%s" style="color:#d9341d;text-decoration:underline">%s</a>.</p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate">
                  <tr>
                    <td align="left" height="48" bgcolor="#ff4529" style="height:48px;background:#ff4529;border-radius:6px;white-space:nowrap">
                      <a href="%s/login" style="display:block;height:48px;line-height:48px;padding:0 20px;color:#ffffff;font-size:15px;font-weight:400;text-align:center;text-decoration:none;border-radius:6px;background:#ff4529;white-space:nowrap">Acessar Vimob CRM</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:32px 0 0;color:#626872;font-size:12px;line-height:1.6">Por segurança, o Vimob CRM nunca envia senhas por e-mail.</p>
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
