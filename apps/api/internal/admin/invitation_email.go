package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

const invitationEmailLogTimeout = 10 * time.Second

var errInvitationEmailDefinitelyNotAccepted = errors.New("invitation email definitely not accepted")

type invitationEmailInput struct {
	InvitationID     string
	OrganizationID   string
	UserID           *string
	Email            string
	RecipientName    string
	OrganizationName string
	Role             string
	InviteURL        string
	ExistingAccount  bool
	IdempotencyKey   string
}

type invitationEmailDelivery struct {
	ProviderMessageID string
	Status            string
}

func (repo Repository) invitationURL(token string) string {
	return fmt.Sprintf("%s/convite/%s", strings.TrimRight(repo.appURL, "/"), token)
}

func (repo Repository) sendInvitationEmail(ctx context.Context, input invitationEmailInput) (invitationEmailDelivery, error) {
	if repo.resendAPIKey == "" || repo.fromEmail == "" {
		return invitationEmailDelivery{}, fmt.Errorf("%w: resend invitation email is not configured", errInvitationEmailDefinitelyNotAccepted)
	}
	if strings.TrimSpace(input.InvitationID) == "" ||
		strings.TrimSpace(input.OrganizationID) == "" ||
		strings.TrimSpace(input.IdempotencyKey) == "" {
		return invitationEmailDelivery{}, fmt.Errorf("%w: invitation email observability identifiers are missing", errInvitationEmailDefinitelyNotAccepted)
	}

	subject := fmt.Sprintf("Convite para acessar %s no Vimob", input.OrganizationName)
	if input.ExistingAccount {
		subject = fmt.Sprintf("Acesse %s com sua conta Vimob", input.OrganizationName)
	}
	if err := repo.prepareInvitationEmailDelivery(ctx, input, subject); err != nil {
		return invitationEmailDelivery{}, fmt.Errorf("%w: prepare invitation email log: %v", errInvitationEmailDefinitelyNotAccepted, err)
	}

	payload, err := json.Marshal(map[string]any{
		"from":     repo.fromEmail,
		"to":       []string{cleanEmailHeader(input.Email)},
		"reply_to": repo.replyTo,
		"subject":  subject,
		"html":     repo.renderInvitationHTML(input),
	})
	if err != nil {
		repo.recordInvitationEmailFailureDetached(ctx, input, subject, err)
		return invitationEmailDelivery{}, fmt.Errorf("%w: encode invitation email: %v", errInvitationEmailDefinitelyNotAccepted, err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(payload))
	if err != nil {
		repo.recordInvitationEmailFailureDetached(ctx, input, subject, err)
		return invitationEmailDelivery{}, fmt.Errorf("%w: build invitation email request: %v", errInvitationEmailDefinitelyNotAccepted, err)
	}
	request.Header.Set("Authorization", "Bearer "+repo.resendAPIKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	if idempotencyKey := strings.TrimSpace(input.IdempotencyKey); idempotencyKey != "" {
		request.Header.Set("Idempotency-Key", idempotencyKey)
	}

	response, err := repo.httpClient.Do(request)
	if err != nil {
		repo.recordInvitationEmailOutcomeUnknownDetached(ctx, input, subject, err)
		return invitationEmailDelivery{}, err
	}
	defer response.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		repo.recordInvitationEmailOutcomeUnknownDetached(ctx, input, subject, err)
		return invitationEmailDelivery{}, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		providerErr := fmt.Errorf("resend invitation failed: %s", strings.TrimSpace(string(raw)))
		repo.recordInvitationEmailFailureDetached(ctx, input, subject, providerErr)
		return invitationEmailDelivery{}, fmt.Errorf("%w: %v", errInvitationEmailDefinitelyNotAccepted, providerErr)
	}
	var providerResponse struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &providerResponse); err != nil {
		repo.recordInvitationEmailOutcomeUnknownDetached(ctx, input, subject, err)
		return invitationEmailDelivery{}, fmt.Errorf("decode resend invitation response: %w", err)
	}
	providerResponse.ID = strings.TrimSpace(providerResponse.ID)
	if providerResponse.ID == "" {
		err := fmt.Errorf("resend invitation response did not include a message id")
		repo.recordInvitationEmailOutcomeUnknownDetached(ctx, input, subject, err)
		return invitationEmailDelivery{}, err
	}
	recordContext, cancelRecord := context.WithTimeout(context.WithoutCancel(ctx), invitationEmailLogTimeout)
	defer cancelRecord()
	if err := repo.recordInvitationEmailAccepted(recordContext, input, subject, providerResponse.ID); err != nil {
		repo.recordInvitationEmailOutcomeUnknownDetached(ctx, input, subject, err)
		return invitationEmailDelivery{}, fmt.Errorf("persist accepted invitation email: %w", err)
	}

	return invitationEmailDelivery{
		ProviderMessageID: providerResponse.ID,
		Status:            "accepted",
	}, nil
}

func (repo Repository) recordInvitationEmailFailureDetached(
	ctx context.Context,
	input invitationEmailInput,
	subject string,
	deliveryErr error,
) {
	recordContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), invitationEmailLogTimeout)
	defer cancel()
	repo.recordInvitationEmailFailure(recordContext, input, subject, deliveryErr)
}

func (repo Repository) recordInvitationEmailOutcomeUnknownDetached(
	ctx context.Context,
	input invitationEmailInput,
	subject string,
	deliveryErr error,
) {
	recordContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), invitationEmailLogTimeout)
	defer cancel()
	if repo.db == nil {
		return
	}
	_, err := repo.db.Pool().Exec(recordContext, `
		update public.email_logs
		set status = case
				when status_event_at is not null or status = 'delivered' then status
				else 'processing'
			end,
			error_message = case
				when status_event_at is not null or status = 'delivered' then error_message
				else left($2, 1000)
			end,
			updated_at = now(),
			metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
				'event_key', 'internal_user_invitation',
				'invitation_id', $3,
				'phase', 'provider_outcome_unknown',
				'subject', $4
			)
		where provider = 'resend'
		  and idempotency_key = $1
	`, strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(deliveryErr.Error()), input.InvitationID, subject)
	if err != nil {
		slog.Error(
			"invitation email outcome and log update are both unknown",
			"invitation_id", input.InvitationID,
			"organization_id", input.OrganizationID,
			"error", err,
		)
	}
}

func (repo Repository) prepareInvitationEmailDelivery(
	ctx context.Context,
	input invitationEmailInput,
	subject string,
) error {
	_, err := repo.db.Pool().Exec(ctx, `
		insert into public.email_logs (
			organization_id,
			user_id,
			recipient_email,
			subject,
			status,
			error_message,
			sent_at,
			template_key,
			provider,
			idempotency_key,
			updated_at,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			$3,
			$4,
			'processing',
			null,
			null,
			'invitation',
			'resend',
			$5,
			now(),
			jsonb_build_object(
				'event_key', 'internal_user_invitation',
				'invitation_id', $6,
				'phase', 'provider_request_pending'
			)
		)
		on conflict (provider, idempotency_key) where idempotency_key is not null
		do update set
			recipient_email = excluded.recipient_email,
			subject = excluded.subject,
			user_id = coalesce(email_logs.user_id, excluded.user_id),
			updated_at = now(),
			metadata = coalesce(email_logs.metadata, '{}'::jsonb) || excluded.metadata
	`, input.OrganizationID, input.UserID, cleanEmailHeader(input.Email), subject,
		strings.TrimSpace(input.IdempotencyKey), input.InvitationID)
	return err
}

func (repo Repository) recordInvitationEmailAccepted(
	ctx context.Context,
	input invitationEmailInput,
	subject string,
	providerMessageID string,
) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// The verified webhook takes this exact provider-message lock before it
	// inserts or reconciles an event. Holding the same lock while attaching the
	// provider id guarantees that either the trigger replays an existing orphan
	// or the webhook observes the canonical email log after this commit.
	if _, err := tx.Exec(ctx, `
		select pg_catalog.pg_advisory_xact_lock(
			pg_catalog.hashtextextended(
				'resend:' || left(btrim($1), 255),
				0
			)
		)
	`, providerMessageID); err != nil {
		return err
	}

	tag, err := tx.Exec(ctx, `
		update public.email_logs
		set provider_message_id = left(btrim($2), 255),
			status = case
				when status_event_at is not null or status = 'delivered' then status
				else 'accepted'
			end,
			error_message = case
				when status_event_at is not null or status = 'delivered' then error_message
				else null
			end,
			sent_at = coalesce(sent_at, now()),
			accepted_at = coalesce(accepted_at, now()),
			updated_at = now(),
			metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
				'event_key', 'internal_user_invitation',
				'invitation_id', $3,
				'phase', 'provider_accepted',
				'subject', $4
			)
		where provider = 'resend'
		  and idempotency_key = $1
	`, strings.TrimSpace(input.IdempotencyKey), providerMessageID, input.InvitationID, subject)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("invitation email log was not found")
	}
	return tx.Commit(ctx)
}

func (repo Repository) recordInvitationEmailFailure(
	ctx context.Context,
	input invitationEmailInput,
	subject string,
	deliveryErr error,
) {
	if repo.db == nil {
		return
	}
	_, err := repo.db.Pool().Exec(ctx, `
		update public.email_logs
		set status = case
				when status_event_at is not null or status = 'delivered' then status
				else 'failed'
			end,
			error_message = case
				when status_event_at is not null or status = 'delivered' then error_message
				else left($2, 1000)
			end,
			updated_at = now(),
			metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
				'event_key', 'internal_user_invitation',
				'invitation_id', $3,
				'phase', 'provider_request_failed',
				'subject', $4
			)
		where provider = 'resend'
		  and idempotency_key = $1
	`, strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(deliveryErr.Error()), input.InvitationID, subject)
	if err != nil {
		// The original provider failure remains the caller-visible error. This log
		// reports the secondary observability failure without hiding it.
		slog.Error(
			"invitation email provider and log update both failed",
			"invitation_id", input.InvitationID,
			"organization_id", input.OrganizationID,
			"error", err,
		)
	}
}

func invitationEmailIdempotencyKey(invitationID string, tokenHash string) string {
	invitationID = strings.TrimSpace(invitationID)
	tokenHash = strings.TrimSpace(tokenHash)
	if invitationID == "" || tokenHash == "" {
		return ""
	}
	return fmt.Sprintf("invitation/%s/%s", invitationID, tokenHash)
}

func (repo Repository) renderInvitationHTML(input invitationEmailInput) string {
	organizationName := html.EscapeString(input.OrganizationName)
	roleLabel := "corretor"
	if input.Role == "admin" {
		roleLabel = "administrador"
	} else if input.Role == "manager" {
		roleLabel = "gestor"
	}
	inviteURL := html.EscapeString(input.InviteURL)
	supportEmail := html.EscapeString(firstNonEmpty(repo.supportEmail, repo.replyTo, "contato@vimobcrm.com.br"))
	heading := fmt.Sprintf("Voce foi convidado para %s", organizationName)
	body := fmt.Sprintf("Voce recebeu acesso como <strong>%s</strong>. Complete seu cadastro para entrar na organizacao pelo Vimob CRM.", roleLabel)
	buttonLabel := "Completar cadastro"
	if input.ExistingAccount {
		body = fmt.Sprintf("Voce recebeu acesso como <strong>%s</strong>. Use sua conta Vimob atual para aceitar o convite e acessar esta organizacao.", roleLabel)
		buttonLabel = "Entrar e aceitar"
	}
	if recipientName := html.EscapeString(strings.TrimSpace(input.RecipientName)); recipientName != "" {
		body = fmt.Sprintf("Ola, <strong>%s</strong>.<br><br>%s", recipientName, body)
	}

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
                <h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;font-weight:600;">%s</h1>
                <p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#5c626b;">
                  %s
                </p>
                <a href="%s" style="display:inline-block;background:#ff4529;color:#ffffff;text-decoration:none;border-radius:6px;padding:13px 22px;font-size:14px;font-weight:600;">
                  %s
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
</html>`, heading, body, inviteURL, buttonLabel, inviteURL, supportEmail)
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
