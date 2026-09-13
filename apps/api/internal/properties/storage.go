package properties

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

var (
	ErrStorageNotConfigured = errors.New("storage is not configured")
	ErrStorageOperation     = errors.New("storage operation failed")
	errStorageObjectInvalid = errors.New("stored object is invalid")
)

type storageHTTPStatusError struct {
	StatusCode int
	Message    string
}

func (err *storageHTTPStatusError) Error() string {
	return fmt.Sprintf("supabase storage request failed with HTTP %d: %s", err.StatusCode, err.Message)
}

func (err *storageHTTPStatusError) Unwrap() error {
	return ErrStorageOperation
}

type StorageConfig struct {
	ProjectURL string
	APIKey     string
}

type storageClient struct {
	projectURL string
	apiKey     string
	httpClient *http.Client
}

type propertyStorageObjectInfo struct {
	MIMEType string
	Size     int64
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
	request.Header.Set("x-upsert", "false")

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
	return supabasehttp.PublicObjectURL(client.projectURL, bucket, objectPath)
}

func (client storageClient) createSignedUploadURL(ctx context.Context, bucket string, objectPath string) (string, string, error) {
	if client.projectURL == "" || client.apiKey == "" {
		return "", "", ErrStorageNotConfigured
	}
	endpoint := fmt.Sprintf(
		"%s/storage/v1/object/upload/sign/%s/%s",
		client.projectURL,
		url.PathEscape(bucket),
		supabasehttp.EscapeObjectPath(objectPath),
	)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader([]byte(`{}`)))
	if err != nil {
		return "", "", err
	}
	client.setAuthorizedJSONHeaders(request)

	raw, err := client.doStorageRequest(request)
	if err != nil {
		return "", "", err
	}
	var result struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return "", "", err
	}
	signedURL := client.resolveStorageURL(result.URL)
	parsed, err := url.Parse(signedURL)
	if err != nil {
		return "", "", err
	}
	token := strings.TrimSpace(parsed.Query().Get("token"))
	if token == "" {
		return "", "", errors.New("supabase storage signed upload response omitted token")
	}
	return signedURL, token, nil
}

func (client storageClient) objectInfo(ctx context.Context, bucket string, objectPath string) (propertyStorageObjectInfo, error) {
	if client.projectURL == "" || client.apiKey == "" {
		return propertyStorageObjectInfo{}, ErrStorageNotConfigured
	}
	endpoint := fmt.Sprintf(
		"%s/storage/v1/object/info/%s/%s",
		client.projectURL,
		url.PathEscape(bucket),
		supabasehttp.EscapeObjectPath(objectPath),
	)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return propertyStorageObjectInfo{}, fmt.Errorf("%w: build object info request: %v", ErrStorageOperation, err)
	}
	supabasehttp.SetServiceAuth(request, client.apiKey)
	raw, err := client.doStorageRequest(request)
	if err != nil {
		return propertyStorageObjectInfo{}, err
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		return propertyStorageObjectInfo{}, fmt.Errorf("%w: decode object info response: %v", ErrStorageOperation, err)
	}
	metadata, _ := result["metadata"].(map[string]any)
	mimeType := firstStorageString(metadata, "mimetype", "mimeType", "content-type", "contentType")
	if mimeType == "" {
		mimeType = firstStorageString(result, "mimetype", "mimeType", "content_type", "contentType")
	}
	size := firstStorageInt64(metadata, "size", "contentLength", "content_length")
	if size < 0 {
		size = firstStorageInt64(result, "size", "contentLength", "content_length")
	}
	return propertyStorageObjectInfo{MIMEType: strings.ToLower(strings.TrimSpace(mimeType)), Size: size}, nil
}

// objectPrefix reads bytes through the authenticated object endpoint. Storage
// metadata is uploader-controlled, so publication eligibility must not infer a
// file format from metadata or response headers alone.
func (client storageClient) objectPrefix(ctx context.Context, bucket string, objectPath string) ([]byte, error) {
	if client.projectURL == "" || client.apiKey == "" {
		return nil, ErrStorageNotConfigured
	}
	endpoint := fmt.Sprintf(
		"%s/storage/v1/object/authenticated/%s/%s",
		client.projectURL,
		url.PathEscape(bucket),
		supabasehttp.EscapeObjectPath(objectPath),
	)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("%w: build object verification request: %v", ErrStorageOperation, err)
	}
	supabasehttp.SetServiceAuth(request, client.apiKey)
	request.Header.Set("Range", "bytes=0-511")
	response, err := client.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("%w: verify stored object: %v", ErrStorageOperation, err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		payload, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		message := strings.TrimSpace(string(payload))
		if message == "" {
			message = response.Status
		}
		return nil, &storageHTTPStatusError{StatusCode: response.StatusCode, Message: message}
	}
	prefix, err := io.ReadAll(io.LimitReader(response.Body, 512))
	if err != nil {
		return nil, fmt.Errorf("%w: read stored object bytes: %v", ErrStorageOperation, err)
	}
	if len(prefix) == 0 {
		return nil, fmt.Errorf("%w: stored object verification returned no bytes", errStorageObjectInvalid)
	}
	return prefix, nil
}

func (client storageClient) createSignedURLs(ctx context.Context, bucket string, objectPaths []string, expiresIn time.Duration) (map[string]string, error) {
	result := map[string]string{}
	if len(objectPaths) == 0 {
		return result, nil
	}
	if client.projectURL == "" || client.apiKey == "" {
		return result, ErrStorageNotConfigured
	}
	payload, err := json.Marshal(map[string]any{
		"expiresIn": int(expiresIn.Seconds()),
		"paths":     objectPaths,
	})
	if err != nil {
		return nil, err
	}
	endpoint := fmt.Sprintf("%s/storage/v1/object/sign/%s", client.projectURL, url.PathEscape(bucket))
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	client.setAuthorizedJSONHeaders(request)
	raw, err := client.doStorageRequest(request)
	if err != nil {
		return nil, err
	}
	var items []struct {
		Path      string `json:"path"`
		SignedURL string `json:"signedURL"`
		Error     string `json:"error"`
	}
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	for _, item := range items {
		if strings.TrimSpace(item.Path) == "" || strings.TrimSpace(item.SignedURL) == "" || strings.TrimSpace(item.Error) != "" {
			continue
		}
		result[item.Path] = client.resolveStorageURL(item.SignedURL)
	}
	return result, nil
}

func (client storageClient) remove(ctx context.Context, bucket string, objectPaths []string) error {
	if len(objectPaths) == 0 {
		return nil
	}
	if client.projectURL == "" || client.apiKey == "" {
		return ErrStorageNotConfigured
	}
	payload, err := json.Marshal(map[string]any{"prefixes": objectPaths})
	if err != nil {
		return err
	}
	endpoint := fmt.Sprintf("%s/storage/v1/object/%s", client.projectURL, url.PathEscape(bucket))
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	client.setAuthorizedJSONHeaders(request)
	_, err = client.doStorageRequest(request)
	return err
}

func (client storageClient) doStorageRequest(request *http.Request) ([]byte, error) {
	response, err := client.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrStorageOperation, err)
	}
	defer response.Body.Close()
	raw, readErr := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if readErr != nil {
		return nil, fmt.Errorf("%w: read response: %v", ErrStorageOperation, readErr)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message := strings.TrimSpace(string(raw))
		if message == "" {
			message = response.Status
		}
		return nil, &storageHTTPStatusError{StatusCode: response.StatusCode, Message: message}
	}
	return raw, nil
}

func isInvalidStoredObjectError(err error) bool {
	if errors.Is(err, errStorageObjectInvalid) {
		return true
	}
	var statusError *storageHTTPStatusError
	return errors.As(err, &statusError) &&
		(statusError.StatusCode == http.StatusBadRequest || statusError.StatusCode == http.StatusNotFound)
}

func (client storageClient) setAuthorizedJSONHeaders(request *http.Request) {
	supabasehttp.SetServiceAuth(request, client.apiKey)
	request.Header.Set("Content-Type", "application/json")
}

func (client storageClient) resolveStorageURL(value string) string {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") {
		return value
	}
	if strings.HasPrefix(value, "/storage/v1/") {
		return client.projectURL + value
	}
	if strings.HasPrefix(value, "/") {
		return client.projectURL + "/storage/v1" + value
	}
	return client.projectURL + "/storage/v1/" + strings.TrimLeft(value, "/")
}

func firstStorageString(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if text, ok := values[key].(string); ok && strings.TrimSpace(text) != "" {
			return text
		}
	}
	return ""
}

func firstStorageInt64(values map[string]any, keys ...string) int64 {
	for _, key := range keys {
		switch value := values[key].(type) {
		case float64:
			return int64(value)
		case json.Number:
			parsed, err := value.Int64()
			if err == nil {
				return parsed
			}
		}
	}
	return -1
}
