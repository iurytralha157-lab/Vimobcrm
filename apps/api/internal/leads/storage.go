package leads

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var (
	ErrStorageNotConfigured = errors.New("lead storage is not configured")
	ErrStorageOperation     = errors.New("lead storage operation failed")
)

type StorageConfig struct {
	ProjectURL string
	APIKey     string
}

type storageClient struct {
	projectURL string
	apiKey     string
	httpClient *http.Client
}

func newStorageClient(config StorageConfig) storageClient {
	return storageClient{
		projectURL: strings.TrimRight(strings.TrimSpace(config.ProjectURL), "/"),
		apiKey:     strings.TrimSpace(config.APIKey),
		httpClient: &http.Client{Timeout: 45 * time.Second},
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
	if strings.TrimSpace(contentType) == "" {
		contentType = "application/octet-stream"
	}
	request.Header.Set("apikey", client.apiKey)
	if !isSupabaseAPIKey(client.apiKey) {
		request.Header.Set("Authorization", "Bearer "+client.apiKey)
	}
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("Cache-Control", "3600")
	request.Header.Set("x-upsert", "false")

	response, err := client.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrStorageOperation, err)
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		payload, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		message := strings.TrimSpace(string(payload))
		if message == "" {
			message = response.Status
		}
		return fmt.Errorf("%w: %s", ErrStorageOperation, message)
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

func isSupabaseAPIKey(value string) bool {
	return strings.HasPrefix(value, "sb_secret_") || strings.HasPrefix(value, "sb_publishable_")
}

func escapeStorageObjectPath(value string) string {
	parts := strings.Split(strings.Trim(value, "/"), "/")
	for index, part := range parts {
		parts[index] = url.PathEscape(part)
	}

	return strings.Join(parts, "/")
}
