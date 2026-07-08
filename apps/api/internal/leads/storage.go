package leads

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

var (
	ErrStorageNotConfigured = errors.New("lead storage is not configured")
	ErrStorageOperation     = errors.New("lead storage operation failed")
)

type StorageConfig struct {
	ProjectURL  string
	APIKey      string
	EvolutionGo EvolutionGoConfig
}

type EvolutionGoConfig struct {
	APIURL string
	APIKey string
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
	request.Header.Set("Authorization", "Bearer "+client.apiKey)
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
		return "", fmt.Errorf("%w: signed url failed: %s", ErrStorageOperation, strings.TrimSpace(string(payload)))
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

	return client.resolveSignedURL(signed), nil
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

func (client storageClient) resolveSignedURL(value string) string {
	signed := strings.TrimSpace(value)
	if signed == "" {
		return ""
	}
	if strings.HasPrefix(signed, "http://") || strings.HasPrefix(signed, "https://") {
		return signed
	}
	if client.projectURL == "" {
		return signed
	}

	switch {
	case strings.HasPrefix(signed, "/storage/v1/"):
		return client.projectURL + signed
	case strings.HasPrefix(signed, "/object/"):
		return client.projectURL + "/storage/v1" + signed
	case strings.HasPrefix(signed, "object/"):
		return client.projectURL + "/storage/v1/" + signed
	case strings.HasPrefix(signed, "/"):
		return client.projectURL + signed
	default:
		return signed
	}
}
