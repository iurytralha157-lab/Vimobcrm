package whatsapp

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

var ErrStorageNotConfigured = errors.New("whatsapp storage is not configured")

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
		httpClient: &http.Client{Timeout: 20 * time.Second},
	}
}

func (client storageClient) signedURL(ctx context.Context, bucket string, objectPath string, expiresIn int) (string, error) {
	if client.projectURL == "" || client.apiKey == "" || strings.TrimSpace(objectPath) == "" {
		return "", nil
	}

	body, _ := json.Marshal(map[string]any{"expiresIn": expiresIn})
	endpoint := fmt.Sprintf(
		"%s/storage/v1/object/sign/%s/%s",
		client.projectURL,
		url.PathEscape(bucket),
		escapeStorageObjectPath(objectPath),
	)

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
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

	payload, err := io.ReadAll(io.LimitReader(response.Body, 8192))
	if err != nil {
		return "", err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("supabase storage signed url failed: %s", strings.TrimSpace(string(payload)))
	}

	var parsed struct {
		SignedURL string `json:"signedURL"`
		SignedUrl string `json:"signedUrl"`
	}
	if err := json.Unmarshal(payload, &parsed); err != nil {
		return "", err
	}

	signed := parsed.SignedURL
	if signed == "" {
		signed = parsed.SignedUrl
	}
	if strings.HasPrefix(signed, "/") {
		signed = client.projectURL + signed
	}

	return signed, nil
}

func (client storageClient) upload(ctx context.Context, bucket string, objectPath string, contentType string, body io.Reader, upsert bool) error {
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
	request.Header.Set("Authorization", "Bearer "+client.apiKey)
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("Cache-Control", "3600")
	if upsert {
		request.Header.Set("x-upsert", "true")
	} else {
		request.Header.Set("x-upsert", "false")
	}

	response, err := client.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		payload, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		message := strings.TrimSpace(string(payload))
		if message == "" {
			message = response.Status
		}
		return fmt.Errorf("supabase storage upload failed: %s", message)
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

func escapeStorageObjectPath(value string) string {
	parts := strings.Split(strings.Trim(value, "/"), "/")
	for index, part := range parts {
		parts[index] = url.PathEscape(part)
	}

	return strings.Join(parts, "/")
}
