package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"strings"
)

type invitationEmailInput struct {
	Email            string
	OrganizationName string
	Role             string
	InviteURL        string
}

func (repo Repository) invitationURL(token string) string {
	return fmt.Sprintf("%s/convite/%s", strings.TrimRight(repo.appURL, "/"), token)
}

func (repo Repository) sendInvitationEmail(ctx context.Context, input invitationEmailInput) error {
	if repo.resendAPIKey == "" || repo.fromEmail == "" {
		return fmt.Errorf("resend invitation email is not configured")
	}

	payload, err := json.Marshal(map[string]any{
		"from":     repo.fromEmail,
		"to":       []string{cleanEmailHeader(input.Email)},
		"reply_to": repo.replyTo,
		"subject":  fmt.Sprintf("Convite para acessar %s no Vimob", input.OrganizationName),
		"html":     repo.renderInvitationHTML(input),
	})
	if err != nil {
		return err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+repo.resendAPIKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")

	response, err := repo.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	raw, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("resend invitation failed: %s", strings.TrimSpace(string(raw)))
	}

	return nil
}

func (repo Repository) renderInvitationHTML(input invitationEmailInput) string {
	organizationName := html.EscapeString(input.OrganizationName)
	roleLabel := "corretor"
	if input.Role == "admin" {
		roleLabel = "administrador"
	}
	inviteURL := html.EscapeString(input.InviteURL)
	supportEmail := html.EscapeString(firstNonEmpty(repo.supportEmail, repo.replyTo, "contato@vimobcrm.com.br"))

	return fmt.Sprintf(`<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Convite Vimob</title>
  </head>
  <body style="margin:0;background:#f4f5f7;font-family:Inter,Arial,sans-serif;color:#151515;">
    <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="background:#f4f5f7;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:28px 30px 10px;">
                <div style="font-size:26px;font-weight:700;color:#ff4529;">Vimob</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 30px 26px;">
                <h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;font-weight:600;">Você foi convidado para %s</h1>
                <p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#5c626b;">
                  Você recebeu acesso como <strong>%s</strong>. Confirme o convite para entrar na organização pelo Vimob CRM.
                </p>
                <a href="%s" style="display:inline-block;background:#ff4529;color:#ffffff;text-decoration:none;border-radius:6px;padding:13px 22px;font-size:14px;font-weight:600;">
                  Aceitar convite
                </a>
                <p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:#8a9099;">
                  Se o botão não funcionar, copie e cole este link no navegador:<br>
                  <span style="word-break:break-all;color:#ff4529;">%s</span>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 30px 26px;border-top:1px solid #eef0f3;font-size:12px;line-height:1.6;color:#8a9099;">
                Precisa de ajuda? Fale com %s.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`, organizationName, roleLabel, inviteURL, inviteURL, supportEmail)
}

func cleanEmailHeader(value string) string {
	return strings.NewReplacer("\r", "", "\n", "").Replace(strings.TrimSpace(value))
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
