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

type storageUploadHTTPError struct {
	statusCode          int
	objectAlreadyExists bool
}

func (err storageUploadHTTPError) Error() string {
	return fmt.Sprintf("supabase storage upload returned HTTP %d", err.statusCode)
}

type StorageConfig struct {
	ProjectURL                           string
	APIKey                               string
	EvolutionGo                          EvolutionGoConfig
	WhatsAppPostFormFollowUpGuardEnabled bool
	LegacyNativeCompatEnabled            bool
	LiveBoundDeadBacklogBypassEnabled    bool
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
		return "", ErrStorageNotConfigured
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
		return "", storageSigningHTTPError{statusCode: response.StatusCode}
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
	immutableDigest, immutable := immutableOutboundMediaPathDigest(objectPath)
	immutable = immutable && bucket == whatsappMediaBucket
	if immutable {
		var err error
		body, err = immutableOutboundUploadBody(body, immutableDigest)
		if err != nil {
			return err
		}
		upsert = false
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
	// Buckets with allowed_mime_types match the Content-Type verbatim, so a
	// recorder mimetype like "audio/ogg;codecs=opus" is rejected with HTTP 400.
	// Store the base type; the provider payload keeps the original mimetype.
	contentType = strings.TrimSpace(strings.Split(contentType, ";")[0])
	if contentType == "" {
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
		var parsed struct {
			StatusCode string `json:"statusCode"`
			Error      string `json:"error"`
			Message    string `json:"message"`
		}
		_ = json.Unmarshal(payload, &parsed)
		duplicate := (response.StatusCode == 400 || response.StatusCode == 409) &&
			(parsed.StatusCode == "409" && strings.EqualFold(parsed.Error, "Duplicate") && strings.EqualFold(parsed.Message, "The resource already exists") ||
				strings.EqualFold(parsed.Message, "Asset Already Exists"))
		if immutable && duplicate {
			return client.verifyOutboundMediaDigest(ctx, objectPath, immutableDigest)
		}
		// A 400 that names a rejected mime type (bucket allow-list): retry once
		// as application/octet-stream, which the media bucket allows. Any other
		// 400 stays a single attempt.
		mimeRejected := response.StatusCode == http.StatusBadRequest && !duplicate &&
			(strings.EqualFold(parsed.Error, "invalid_mime_type") ||
				strings.Contains(strings.ToLower(parsed.Message), "mime type"))
		if mimeRejected && contentType != "application/octet-stream" {
			if seeker, ok := body.(io.Seeker); ok {
				if _, seekErr := seeker.Seek(0, io.SeekStart); seekErr == nil {
					return client.upload(ctx, bucket, objectPath, "application/octet-stream", body, upsert)
				}
			}
		}
		return storageUploadHTTPError{statusCode: response.StatusCode, objectAlreadyExists: duplicate}
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

type storageDeleteHTTPError struct {
	statusCode int
}

func (err storageDeleteHTTPError) Error() string {
	return fmt.Sprintf("supabase storage delete returned HTTP %d", err.statusCode)
}

// deleteUnlinkedMediaObject uses the Storage API so object bytes and metadata
// are removed together. The caller holds the GC row lock and rechecks live
// references before invoking it.
func (client storageClient) deleteUnlinkedMediaObject(ctx context.Context, organizationID string, objectPath string) error {
	if client.projectURL == "" || client.apiKey == "" {
		return ErrStorageNotConfigured
	}
	if !validUnlinkedMediaGCPath(organizationID, objectPath) {
		return errors.New("invalid unlinked media GC path")
	}

	endpoint := fmt.Sprintf(
		"%s/storage/v1/object/%s/%s",
		client.projectURL,
		url.PathEscape(whatsappMediaBucket),
		supabasehttp.EscapeObjectPath(objectPath),
	)
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
	if err != nil {
		return err
	}
	supabasehttp.SetServiceAuth(request, client.apiKey)

	response, err := client.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound || response.StatusCode >= 200 && response.StatusCode < 300 {
		return nil
	}
	if response.StatusCode == http.StatusBadRequest {
		// The local self-hosted Storage API returns HTTP 400 with an embedded
		// 404/not_found code for a missing object. Accept only that exact shape;
		// other 400 responses remain operational errors.
		var missing struct {
			StatusCode string `json:"statusCode"`
			Error      string `json:"error"`
			Message    string `json:"message"`
		}
		payload, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		if json.Unmarshal(payload, &missing) == nil && missing.StatusCode == "404" &&
			missing.Error == "not_found" && strings.EqualFold(missing.Message, "Object not found") {
			return nil
		}
	}
	return storageDeleteHTTPError{statusCode: response.StatusCode}
}

func validUnlinkedMediaGCPath(organizationID string, objectPath string) bool {
	orgID, ok := normalizeUUID(organizationID)
	if !ok || !strings.HasPrefix(objectPath, "orgs/"+orgID+"/") {
		return false
	}
	if strings.ContainsAny(objectPath, "?#\r\n\t") {
		return false
	}
	return whatsappMediaPathBelongsToOrganization(objectPath, orgID)
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
