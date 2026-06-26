package automations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var ErrAutomationStorageNotConfigured = errors.New("automation storage is not configured")

type StorageConfig struct {
	ProjectURL string
	APIKey     string
}

type storageClient struct {
	projectURL string
	apiKey     string
	httpClient *http.Client
}

type storageObject struct {
	Name           string         `json:"name"`
	ID             *string        `json:"id"`
	CreatedAt      *string        `json:"created_at"`
	UpdatedAt      *string        `json:"updated_at"`
	LastAccessedAt *string        `json:"last_accessed_at"`
	Metadata       map[string]any `json:"metadata"`
}

func newStorageClient(config StorageConfig) storageClient {
	return storageClient{
		projectURL: strings.TrimRight(strings.TrimSpace(config.ProjectURL), "/"),
		apiKey:     strings.TrimSpace(config.APIKey),
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (client storageClient) list(ctx context.Context, bucket string, prefix string, limit int) ([]storageObject, error) {
	if client.projectURL == "" || client.apiKey == "" {
		return nil, ErrAutomationStorageNotConfigured
	}
	if limit < 1 || limit > 500 {
		limit = 100
	}

	payload, _ := json.Marshal(map[string]any{
		"prefix": strings.Trim(prefix, "/"),
		"limit":  limit,
		"offset": 0,
		"sortBy": map[string]string{
			"column": "created_at",
			"order":  "desc",
		},
	})

	endpoint := fmt.Sprintf(
		"%s/storage/v1/object/list/%s",
		client.projectURL,
		url.PathEscape(bucket),
	)

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	client.setJSONHeaders(request)

	response, err := client.httpClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, storageStatusError("list", response.Status, raw)
	}

	var objects []storageObject
	if len(raw) == 0 {
		return []storageObject{}, nil
	}
	if err := json.Unmarshal(raw, &objects); err != nil {
		return nil, err
	}

	return objects, nil
}

func (client storageClient) upload(ctx context.Context, bucket string, objectPath string, contentType string, body io.Reader) error {
	if client.projectURL == "" || client.apiKey == "" {
		return ErrAutomationStorageNotConfigured
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
	client.setAuthHeaders(request)
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("Cache-Control", "3600")
	request.Header.Set("x-upsert", "false")

	response, err := client.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return storageStatusError("upload", response.Status, raw)
	}

	return nil
}

func (client storageClient) remove(ctx context.Context, bucket string, objectPath string) error {
	if client.projectURL == "" || client.apiKey == "" {
		return ErrAutomationStorageNotConfigured
	}

	payload, _ := json.Marshal(map[string]any{
		"prefixes": []string{strings.Trim(objectPath, "/")},
	})
	endpoint := fmt.Sprintf(
		"%s/storage/v1/object/%s",
		client.projectURL,
		url.PathEscape(bucket),
	)

	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	client.setJSONHeaders(request)

	response, err := client.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return storageStatusError("delete", response.Status, raw)
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

func (client storageClient) setJSONHeaders(request *http.Request) {
	client.setAuthHeaders(request)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
}

func (client storageClient) setAuthHeaders(request *http.Request) {
	request.Header.Set("apikey", client.apiKey)
	request.Header.Set("Authorization", "Bearer "+client.apiKey)
}

func storageStatusError(operation string, status string, payload []byte) error {
	message := strings.TrimSpace(string(payload))
	if message == "" {
		message = status
	}

	return fmt.Errorf("%w: supabase storage %s failed: %s", ErrAutomationStorage, operation, message)
}

func escapeStorageObjectPath(value string) string {
	parts := strings.Split(strings.Trim(value, "/"), "/")
	for index, part := range parts {
		parts[index] = url.PathEscape(part)
	}

	return strings.Join(parts, "/")
}
