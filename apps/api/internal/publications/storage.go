package publications

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

const publicationMediaBucket = "property-private"

type publicationStorageClient struct {
	projectURL string
	apiKey     string
	httpClient *http.Client
}

func newPublicationStorageClient(projectURL string, apiKey string) publicationStorageClient {
	return publicationStorageClient{
		projectURL: strings.TrimRight(strings.TrimSpace(projectURL), "/"),
		apiKey:     strings.TrimSpace(apiKey),
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

func (client publicationStorageClient) signedURL(ctx context.Context, objectPath string, expiresIn time.Duration) (string, error) {
	objectPath = strings.Trim(strings.TrimSpace(objectPath), "/")
	if client.projectURL == "" || client.apiKey == "" {
		return "", ErrStorageNotConfigured
	}
	if objectPath == "" || expiresIn <= 0 {
		return "", ErrMediaNotFound
	}
	payload, err := json.Marshal(map[string]any{
		"expiresIn": int(expiresIn.Seconds()),
		"paths":     []string{objectPath},
	})
	if err != nil {
		return "", err
	}
	endpoint := fmt.Sprintf("%s/storage/v1/object/sign/%s", client.projectURL, url.PathEscape(publicationMediaBucket))
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	setPublicationStorageAuth(request, client.apiKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := client.httpClient.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	raw, readErr := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if readErr != nil {
		return "", readErr
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("supabase storage signing failed with status %d", response.StatusCode)
	}
	var items []struct {
		Path      string `json:"path"`
		SignedURL string `json:"signedURL"`
		Error     string `json:"error"`
	}
	if err := json.Unmarshal(raw, &items); err != nil {
		return "", err
	}
	for _, item := range items {
		if item.Path != objectPath || strings.TrimSpace(item.Error) != "" || strings.TrimSpace(item.SignedURL) == "" {
			continue
		}
		return client.resolveURL(item.SignedURL)
	}
	return "", errors.New("supabase storage did not sign the requested publication asset")
}

// Supabase accepts both legacy JWT service-role keys and the newer opaque
// sb_secret_* keys through apikey. Only JWT-shaped keys are valid Bearer
// credentials; sending an opaque secret in Authorization is rejected by the
// storage gateway and needlessly duplicates a privileged credential.
func setPublicationStorageAuth(request *http.Request, apiKey string) {
	request.Header.Set("apikey", apiKey)
	request.Header.Del("Authorization")
	segments := strings.Split(apiKey, ".")
	if len(segments) == 3 && segments[0] != "" && segments[1] != "" && segments[2] != "" {
		request.Header.Set("Authorization", "Bearer "+apiKey)
	}
}

func (client publicationStorageClient) resolveURL(value string) (string, error) {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(value, "/storage/v1/") {
		value = client.projectURL + value
	} else if strings.HasPrefix(value, "/") {
		value = client.projectURL + "/storage/v1" + value
	} else if !strings.HasPrefix(value, "http://") && !strings.HasPrefix(value, "https://") {
		value = client.projectURL + "/storage/v1/" + strings.TrimLeft(value, "/")
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil {
		return "", errors.New("supabase storage returned an invalid signed URL")
	}
	project, err := url.Parse(client.projectURL)
	if err != nil || !strings.EqualFold(parsed.Host, project.Host) {
		return "", errors.New("supabase storage returned a signed URL for an unexpected host")
	}
	return parsed.String(), nil
}

func safeExternalMediaURL(value string) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil {
		return "", false
	}
	return parsed.String(), true
}
