package settings

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type ExternalConfig struct {
	ProjectURL string
	APIKey     string
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

func externalStatusError(base error, status string, payload []byte) error {
	message := strings.TrimSpace(string(payload))
	if message == "" {
		message = status
	}

	return fmt.Errorf("%w: %s", base, message)
}

func escapeStorageObjectPath(value string) string {
	parts := strings.Split(strings.Trim(value, "/"), "/")
	for index, part := range parts {
		parts[index] = url.PathEscape(part)
	}

	return strings.Join(parts, "/")
}
