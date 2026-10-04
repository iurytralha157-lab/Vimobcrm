package whatsapp

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/supabasehttp"
)

// removeWhatsAppMediaObject removes exactly one private WhatsApp object through
// the Storage API. Database rows in storage.objects must never be deleted by
// the retention worker: doing so leaves the underlying file behind.
//
// The caller must first own a database lease for this path and prove that no
// surviving message, media job, or other asset refers to it. A successful
// request is idempotent when Storage no longer contains the path.
func (client storageClient) removeWhatsAppMediaObject(ctx context.Context, organizationID, objectPath string) error {
	if client.projectURL == "" || client.apiKey == "" {
		return ErrStorageNotConfigured
	}
	if !whatsappMediaPathBelongsToOrganization(objectPath, organizationID) {
		return fmt.Errorf("whatsapp media deletion path is outside the organization scope")
	}

	// Use the single-object endpoint. The bulk endpoint's JSON field happens
	// to be named "prefixes"; this endpoint unambiguously names one object.
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
	if response.StatusCode == http.StatusNotFound {
		exists, existsErr := client.objectExists(ctx, whatsappMediaBucket, objectPath)
		if existsErr != nil {
			return existsErr
		}
		if !exists {
			return nil
		}
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		// Storage errors can contain signed URLs and identifiers; return only the
		// status and leave the path itself out of logs.
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return fmt.Errorf("supabase storage WhatsApp media delete failed with status %d", response.StatusCode)
	}
	// Consume at most a small response; the single-object endpoint's response
	// body is not needed to establish this idempotent deletion.
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	return nil
}
