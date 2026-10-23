package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
)

type passwordRecoverySender func(context.Context, string) error

type passwordRecoveryRequestRecorder func(context.Context, string, string) error

func requestAdminPasswordRecovery(
	ctx context.Context,
	email string,
	requestedBy string,
	targetUserID string,
	send passwordRecoverySender,
	record passwordRecoveryRequestRecorder,
	logger *slog.Logger,
) error {
	if err := send(ctx, email); err != nil {
		return err
	}
	if err := record(ctx, requestedBy, targetUserID); err != nil {
		// Auth already accepted the recovery request. An audit failure cannot
		// truthfully turn that accepted request into a failed response.
		if logger == nil {
			logger = slog.Default()
		}
		logger.ErrorContext(ctx, "password recovery request accepted but audit persistence failed", "error", err)
	}
	return nil
}

func (repo Repository) recordPasswordRecoveryRequest(ctx context.Context, requestedBy, targetUserID string) error {
	_, err := repo.db.Pool().Exec(ctx, `
		insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
		values (
			$1::uuid,
			'password_recovery_requested',
			'user',
			$2,
			jsonb_build_object('channel', 'email', 'provider_result', 'accepted')
		)
	`, requestedBy, targetUserID)
	return err
}

func (repo Repository) sendAuthPasswordRecovery(ctx context.Context, email string) error {
	if repo.projectURL == "" || repo.apiKey == "" || repo.appURL == "" {
		return ErrPasswordRecoveryEmailFailed
	}

	payload, err := json.Marshal(map[string]string{"email": strings.TrimSpace(email)})
	if err != nil {
		return err
	}
	redirectURL := strings.TrimRight(repo.appURL, "/") + "/reset-password"
	endpoint := repo.projectURL + "/auth/v1/recover?redirect_to=" + url.QueryEscape(redirectURL)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	setAuthAdminHeaders(request, repo.apiKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")

	response, err := repo.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrPasswordRecoveryEmailFailed, err)
	}
	defer response.Body.Close()

	raw, readErr := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if readErr != nil {
		return fmt.Errorf("%w: %v", ErrPasswordRecoveryEmailFailed, readErr)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf(
			"%w: auth recovery returned %s: %s",
			ErrPasswordRecoveryEmailFailed,
			response.Status,
			strings.TrimSpace(string(raw)),
		)
	}

	return nil
}
