package financial

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
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (client storageClient) upload(ctx context.Context, bucket string, objectPath string, contentType string, body io.Reader) error {
	if client.projectURL == "" || client.apiKey == "" {
		return ErrStorageMissing
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, client.objectURL(bucket, objectPath), body)
	if err != nil {
		return err
	}
	if strings.TrimSpace(contentType) == "" {
		contentType = "application/octet-stream"
	}
	request.Header.Set("apikey", client.apiKey)
	request.Header.Set("Authorization", "Bearer "+client.apiKey)
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("x-upsert", "false")
	return client.doStorageRequest(request)
}

func (client storageClient) remove(ctx context.Context, bucket string, objectPaths []string) error {
	if client.projectURL == "" || client.apiKey == "" {
		return ErrStorageMissing
	}
	payload, _ := json.Marshal(map[string]any{"prefixes": objectPaths})
	endpoint := fmt.Sprintf("%s/storage/v1/object/%s", client.projectURL, url.PathEscape(bucket))
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("apikey", client.apiKey)
	request.Header.Set("Authorization", "Bearer "+client.apiKey)
	request.Header.Set("Content-Type", "application/json")
	return client.doStorageRequest(request)
}

func (client storageClient) signedURL(ctx context.Context, bucket string, objectPath string, expiresIn int) (string, error) {
	if client.projectURL == "" || client.apiKey == "" {
		return "", ErrStorageMissing
	}
	payload, _ := json.Marshal(map[string]any{"expiresIn": expiresIn})
	endpoint := fmt.Sprintf("%s/storage/v1/object/sign/%s/%s", client.projectURL, url.PathEscape(bucket), escapeStorageObjectPath(objectPath))
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	request.Header.Set("apikey", client.apiKey)
	request.Header.Set("Authorization", "Bearer "+client.apiKey)
	request.Header.Set("Content-Type", "application/json")

	response, err := client.httpClient.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("%w: %s", ErrStorageFailed, strings.TrimSpace(string(raw)))
	}
	var parsed struct {
		SignedURL string `json:"signedURL"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", err
	}
	if strings.HasPrefix(parsed.SignedURL, "http") {
		return parsed.SignedURL, nil
	}
	return client.projectURL + "/storage/v1" + parsed.SignedURL, nil
}

func (client storageClient) doStorageRequest(request *http.Request) error {
	response, err := client.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return fmt.Errorf("%w: %s", ErrStorageFailed, strings.TrimSpace(string(raw)))
	}
	return nil
}

func (client storageClient) objectURL(bucket string, objectPath string) string {
	return fmt.Sprintf("%s/storage/v1/object/%s/%s", client.projectURL, url.PathEscape(bucket), escapeStorageObjectPath(objectPath))
}

func escapeStorageObjectPath(value string) string {
	parts := strings.Split(strings.Trim(value, "/"), "/")
	for index, part := range parts {
		parts[index] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}
