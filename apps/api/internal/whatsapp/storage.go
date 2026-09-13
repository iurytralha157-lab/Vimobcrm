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

	"github.com/vimob-crm/vimob-crm/apps/api/internal/supabasehttp"
)

var ErrStorageNotConfigured = errors.New("whatsapp storage is not configured")

type StorageConfig struct {
	ProjectURL  string
	APIKey      string
	EvolutionGo EvolutionGoConfig
}

type EvolutionGoConfig struct {
	APIURL                   string
	APIKey                   string
	ImageDigest              string
	WebhookURL               string
	BackendWebhookURL        string
	WebhookProcessorMode     string
	WebhookRolloutSessionIDs []string
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
		supabasehttp.EscapeObjectPath(objectPath),
	)

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	supabasehttp.SetServiceAuth(request, client.apiKey)
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
	return client.resolveSignedURL(signed), nil
}

func (client storageClient) upload(ctx context.Context, bucket string, objectPath string, contentType string, body io.Reader, upsert bool) error {
	if client.projectURL == "" || client.apiKey == "" {
		return ErrStorageNotConfigured
	}

	endpoint := fmt.Sprintf(
		"%s/storage/v1/object/%s/%s",
		client.projectURL,
		url.PathEscape(bucket),
		supabasehttp.EscapeObjectPath(objectPath),
	)

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, body)
	if err != nil {
		return err
	}
	if strings.TrimSpace(contentType) == "" {
		contentType = "application/octet-stream"
	}
	supabasehttp.SetServiceAuth(request, client.apiKey)
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

func (client storageClient) objectExists(ctx context.Context, bucket string, objectPath string) (bool, error) {
	if client.projectURL == "" || client.apiKey == "" {
		return false, ErrStorageNotConfigured
	}
	if strings.TrimSpace(objectPath) == "" {
		return false, fmt.Errorf("storage object path is required")
	}

	endpoint := fmt.Sprintf(
		"%s/storage/v1/object/%s/%s",
		client.projectURL,
		url.PathEscape(bucket),
		supabasehttp.EscapeObjectPath(objectPath),
	)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return false, err
	}
	supabasehttp.SetServiceAuth(request, client.apiKey)
	// Reconciliation only needs object existence. Bound the response even if a
	// Storage deployment ignores Range so media bytes are never downloaded into
	// the worker merely to recover a database marker.
	request.Header.Set("Range", "bytes=0-0")

	response, err := client.httpClient.Do(request)
	if err != nil {
		return false, err
	}
	defer response.Body.Close()

	switch response.StatusCode {
	case http.StatusOK, http.StatusPartialContent:
		return true, nil
	case http.StatusNotFound:
		return false, nil
	default:
		payload, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		if response.StatusCode == http.StatusBadRequest && storageObjectMissingResponse(payload) {
			// Older self-hosted Storage releases used 400 for a missing object.
			// Accept only the narrow provider error markers; every other 400 is a
			// configuration/path/auth failure and must remain visible.
			return false, nil
		}
		message := strings.TrimSpace(string(payload))
		if message == "" {
			message = response.Status
		}
		return false, fmt.Errorf("supabase storage object reconciliation failed: %s", message)
	}
}

func storageObjectMissingResponse(payload []byte) bool {
	message := strings.ToLower(strings.TrimSpace(string(payload)))
	for _, marker := range []string{`object not found`, `no such key`, `nosuchkey`, `not_found`} {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}

func (client storageClient) publicURL(bucket string, objectPath string) string {
	if client.projectURL == "" {
		return ""
	}

	// whatsapp-media is private. Persist this stable object reference; delivery
	// and read paths exchange it for a short-lived signed URL.
	return fmt.Sprintf(
		"%s/storage/v1/object/public/%s/%s",
		client.projectURL,
		url.PathEscape(bucket),
		supabasehttp.EscapeObjectPath(objectPath),
	)
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
