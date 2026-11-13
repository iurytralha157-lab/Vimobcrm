package whatsapp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/supabasehttp"
)

var errOutboundMediaDigestMismatch = errors.New("outbound media bytes differ from the immutable intent")

func outboundMediaDigest(payload []byte) string {
	digest := sha256.Sum256(payload)
	return hex.EncodeToString(digest[:])
}

func outboundMediaImmutablePath(organizationID, sessionID, providerID, mimeType, digest string) string {
	return outboundMediaPathWithExtension(organizationID, sessionID, providerID, digest, mediaExtension(mimeType))
}

func outboundMediaPathWithExtension(organizationID, sessionID, providerID, digest, extension string) string {
	return fmt.Sprintf("orgs/%s/sessions/%s/outgoing/%s/%s.%s", organizationID, sessionID, providerID, digest, extension)
}

// Automation uploads share a fixed mapping with the Edge runtime and SQL RPC.
// The host MIME registry can differ between the worker image and the runtime.
var automationOutboundMediaExtensions = map[string]string{
	"image:image/jpeg": "jpg", "image:image/png": "png", "image:image/webp": "webp", "image:image/gif": "gif",
	"audio:audio/aac": "aac", "audio:audio/mpeg": "mp3", "audio:audio/mp3": "mp3", "audio:audio/ogg": "ogg",
	"audio:audio/wav": "wav", "audio:audio/webm": "webm", "audio:audio/mp4": "m4a",
	"video:video/mp4": "mp4", "video:video/mpeg": "mpeg", "video:video/quicktime": "mov",
	"video:video/webm": "webm", "video:video/ogg": "ogv",
}

func immutableOutboundMediaPathDigest(objectPath string) (string, bool) {
	parts := strings.Split(objectPath, "/")
	if len(parts) != 7 || parts[0] != "orgs" || parts[2] != "sessions" || parts[4] != "outgoing" || parts[5] == "" || strings.ContainsAny(parts[5], "?#\r\n\t") {
		return "", false
	}
	if org, ok := normalizeUUID(parts[1]); !ok || org != parts[1] {
		return "", false
	}
	if session, ok := normalizeUUID(parts[3]); !ok || session != parts[3] {
		return "", false
	}
	digest, extension, found := strings.Cut(parts[6], ".")
	decoded, err := hex.DecodeString(digest)
	if !found || extension == "" || strings.ContainsAny(extension, ".?#\r\n\t") || err != nil || len(decoded) != sha256.Size || digest != strings.ToLower(digest) {
		return "", false
	}
	return digest, true
}

// Repairs still use upload(upsert=true) for older inbound objects. New
// outgoing digest objects must never enter that overwrite path.
func immutableOutboundUploadBody(body io.Reader, expectedDigest string) (io.Reader, error) {
	if seekable, ok := body.(io.ReadSeeker); ok {
		position, err := seekable.Seek(0, io.SeekCurrent)
		if err != nil {
			return nil, err
		}
		hash := sha256.New()
		n, readErr := io.Copy(hash, io.LimitReader(seekable, int64(whatsappMediaAbsoluteMaxBytes)+1))
		_, seekErr := seekable.Seek(position, io.SeekStart)
		if readErr != nil {
			return nil, readErr
		}
		if seekErr != nil {
			return nil, seekErr
		}
		if n <= 0 || n > int64(whatsappMediaAbsoluteMaxBytes) || hex.EncodeToString(hash.Sum(nil)) != expectedDigest {
			return nil, errOutboundMediaDigestMismatch
		}
		return body, nil
	}
	payload, err := io.ReadAll(io.LimitReader(body, int64(whatsappMediaAbsoluteMaxBytes)+1))
	if err != nil {
		return nil, err
	}
	if len(payload) == 0 || len(payload) > whatsappMediaAbsoluteMaxBytes || outboundMediaDigest(payload) != expectedDigest {
		return nil, errOutboundMediaDigestMismatch
	}
	return bytes.NewReader(payload), nil
}

// An upload with an ambiguous response may already exist. Reconciliation may
// reuse it only after reading and verifying the exact bytes; it never upserts.
func (client storageClient) uploadImmutable(ctx context.Context, objectPath, mimeType string, payload []byte) error {
	err := client.upload(ctx, whatsappMediaBucket, objectPath, mimeType, bytes.NewReader(payload), false)
	if err == nil {
		return nil
	}
	var httpErr storageUploadHTTPError
	if !errors.As(err, &httpErr) || !httpErr.objectAlreadyExists {
		return err
	}
	return client.verifyOutboundMediaDigest(ctx, objectPath, outboundMediaDigest(payload))
}

func (client storageClient) verifyOutboundMediaDigest(ctx context.Context, objectPath, expectedDigest string) error {
	if client.projectURL == "" || client.apiKey == "" {
		return ErrStorageNotConfigured
	}
	if len(expectedDigest) != 64 {
		return errOutboundMediaDigestMismatch
	}
	endpoint := fmt.Sprintf("%s/storage/v1/object/%s/%s", client.projectURL, url.PathEscape(whatsappMediaBucket), supabasehttp.EscapeObjectPath(objectPath))
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	supabasehttp.SetServiceAuth(request, client.apiKey)
	response, err := client.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return storageSigningHTTPError{statusCode: response.StatusCode}
	}
	hash := sha256.New()
	n, err := io.Copy(hash, io.LimitReader(response.Body, int64(whatsappMediaAbsoluteMaxBytes)+1))
	if err != nil {
		return err
	}
	if n <= 0 || n > int64(whatsappMediaAbsoluteMaxBytes) || !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), expectedDigest) {
		return errOutboundMediaDigestMismatch
	}
	return nil
}

func (client storageClient) outboundMediaBytes(ctx context.Context, objectPath string) ([]byte, error) {
	if client.projectURL == "" || client.apiKey == "" {
		return nil, ErrStorageNotConfigured
	}
	endpoint := fmt.Sprintf("%s/storage/v1/object/%s/%s", client.projectURL, url.PathEscape(whatsappMediaBucket), supabasehttp.EscapeObjectPath(objectPath))
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	supabasehttp.SetServiceAuth(request, client.apiKey)
	response, err := client.httpClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, storageSigningHTTPError{statusCode: response.StatusCode}
	}
	payload, err := io.ReadAll(io.LimitReader(response.Body, int64(whatsappMediaAbsoluteMaxBytes)+1))
	if err != nil {
		return nil, err
	}
	if len(payload) == 0 || len(payload) > whatsappMediaAbsoluteMaxBytes {
		return nil, fmt.Errorf("%w: midia deve ter no maximo 25MB", ErrInvalidInput)
	}
	return payload, nil
}
