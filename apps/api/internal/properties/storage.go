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
)

var ErrStorageNotConfigured = errors.New("storage is not configured")

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
		escapeStorageObjectPath(objectPath),
	)

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, body)
	if err != nil {
		return err
	}
	if strings.TrimSpace(contentType) == "" {
		contentType = "application/octet-stream"
	}
	client.setAuthorizedHeaders(request)
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

func (client storageClient) createSignedUploadURL(ctx context.Context, bucket string, objectPath string) (string, string, error) {
	if client.projectURL == "" || client.apiKey == "" {
		return "", "", ErrStorageNotConfigured
	}
	endpoint := fmt.Sprintf(
		"%s/storage/v1/object/upload/sign/%s/%s",
		client.projectURL,
		url.PathEscape(bucket),
		escapeStorageObjectPath(objectPath),
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
		escapeStorageObjectPath(objectPath),
	)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return propertyStorageObjectInfo{}, err
	}
	client.setAuthorizedHeaders(request)
	raw, err := client.doStorageRequest(request)
	if err != nil {
		return propertyStorageObjectInfo{}, err
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		return propertyStorageObjectInfo{}, err
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
		escapeStorageObjectPath(objectPath),
	)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	client.setAuthorizedHeaders(request)
	request.Header.Set("Range", "bytes=0-511")
	response, err := client.httpClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		payload, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		message := strings.TrimSpace(string(payload))
		if message == "" {
			message = response.Status
		}
		return nil, fmt.Errorf("supabase storage object verification failed: %s", message)
	}
	prefix, err := io.ReadAll(io.LimitReader(response.Body, 512))
	if err != nil {
		return nil, err
	}
	if len(prefix) == 0 {
		return nil, errors.New("supabase storage object verification returned no bytes")
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
		return nil, err
	}
	defer response.Body.Close()
	raw, readErr := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if readErr != nil {
		return nil, readErr
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message := strings.TrimSpace(string(raw))
		if message == "" {
			message = response.Status
		}
		return nil, fmt.Errorf("supabase storage request failed: %s", message)
	}
	return raw, nil
}

func (client storageClient) setAuthorizedHeaders(request *http.Request) {
	request.Header.Set("apikey", client.apiKey)
	request.Header.Del("Authorization")
	segments := strings.Split(client.apiKey, ".")
	if len(segments) == 3 && segments[0] != "" && segments[1] != "" && segments[2] != "" {
		request.Header.Set("Authorization", "Bearer "+client.apiKey)
	}
}

func (client storageClient) setAuthorizedJSONHeaders(request *http.Request) {
	client.setAuthorizedHeaders(request)
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

func escapeStorageObjectPath(value string) string {
	parts := strings.Split(strings.Trim(value, "/"), "/")
	for index, part := range parts {
		parts[index] = url.PathEscape(part)
	}

	return strings.Join(parts, "/")
}
