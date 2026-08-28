package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

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
