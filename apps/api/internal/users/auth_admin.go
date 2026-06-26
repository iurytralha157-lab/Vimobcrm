package users

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type AuthAdminConfig struct {
	ProjectURL string
	APIKey     string
}

type authAdminClient struct {
	projectURL string
	apiKey     string
	httpClient *http.Client
}

type authAdminCreateUserInput struct {
	Email    string
	Password string
	Name     string
}

func newAuthAdminClient(config AuthAdminConfig) authAdminClient {
	return authAdminClient{
		projectURL: strings.TrimRight(strings.TrimSpace(config.ProjectURL), "/"),
		apiKey:     strings.TrimSpace(config.APIKey),
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (client authAdminClient) createUser(ctx context.Context, input authAdminCreateUserInput) (string, error) {
	if client.projectURL == "" || client.apiKey == "" {
		return "", ErrAuthAdminNotConfigured
	}

	payload, err := json.Marshal(map[string]any{
		"email":         input.Email,
		"password":      input.Password,
		"email_confirm": true,
		"user_metadata": map[string]any{
			"name": input.Name,
		},
	})
	if err != nil {
		return "", err
	}

	endpoint := fmt.Sprintf("%s/auth/v1/admin/users", client.projectURL)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	request.Header.Set("apikey", client.apiKey)
	request.Header.Set("Authorization", "Bearer "+client.apiKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")

	response, err := client.httpClient.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if response.StatusCode == http.StatusConflict || response.StatusCode == http.StatusUnprocessableEntity {
		return "", fmt.Errorf("%w: auth user already exists", ErrUserConflict)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", authAdminStatusError(response.Status, raw)
	}

	var parsed struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", err
	}
	if strings.TrimSpace(parsed.ID) == "" {
		return "", authAdminStatusError("empty response", raw)
	}

	return parsed.ID, nil
}

func (client authAdminClient) userURL(userID string) string {
	return fmt.Sprintf("%s/auth/v1/admin/users/%s", client.projectURL, url.PathEscape(userID))
}

func authAdminStatusError(status string, payload []byte) error {
	message := strings.TrimSpace(string(payload))
	if message == "" {
		message = status
	}

	return fmt.Errorf("%w: %s", ErrAuthAdminOperation, message)
}

func generateTemporaryPassword() (string, error) {
	const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*"
	var builder strings.Builder
	builder.Grow(14)

	for builder.Len() < 14 {
		index, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			return "", err
		}
		builder.WriteByte(alphabet[index.Int64()])
	}

	return builder.String(), nil
}

func isConflictError(err error) bool {
	return errors.Is(err, ErrUserConflict)
}
