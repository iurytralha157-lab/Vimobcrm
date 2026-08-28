package financial

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/supabasehttp"
)

const maxContractDocumentBytes int64 = 25 * 1024 * 1024
const contractDocumentCompensationTimeout = 10 * time.Second

type contractDocumentStorage interface {
	upload(ctx context.Context, bucket string, objectPath string, contentType string, body io.Reader) error
	remove(ctx context.Context, bucket string, objectPaths []string) error
	signedURL(ctx context.Context, bucket string, objectPath string, expiresIn int) (string, error)
	objectExists(ctx context.Context, bucket string, objectPath string) (bool, error)
}

var contractDocumentContentTypes = map[string]string{
	".pdf":  "application/pdf",
	".doc":  "application/msword",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".png":  "image/png",
	".webp": "image/webp",
	".xls":  "application/vnd.ms-excel",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

func validateContractDocumentUpload(fileName string, declaredContentType string, file multipart.File) (string, error) {
	fileName = strings.TrimSpace(fileName)
	if fileName == "" || utf8.RuneCountInString(fileName) > 255 || strings.IndexFunc(fileName, unicode.IsControl) >= 0 {
		return "", ErrInvalidInput
	}
	extension := strings.ToLower(filepath.Ext(fileName))
	expectedContentType, allowed := contractDocumentContentTypes[extension]
	if !allowed {
		return "", ErrInvalidInput
	}

	contentType, _, err := mime.ParseMediaType(strings.TrimSpace(declaredContentType))
	if err != nil || !strings.EqualFold(contentType, expectedContentType) {
		return "", ErrInvalidInput
	}

	sample := make([]byte, 512)
	read, readErr := file.Read(sample)
	if readErr != nil && readErr != io.EOF {
		return "", ErrInvalidInput
	}
	if _, seekErr := file.Seek(0, io.SeekStart); seekErr != nil {
		return "", ErrInvalidInput
	}
	if read == 0 || !hasContractDocumentSignature(extension, sample[:read]) {
		return "", ErrInvalidInput
	}

	return expectedContentType, nil
}

func hasContractDocumentSignature(extension string, sample []byte) bool {
	switch extension {
	case ".pdf":
		return bytes.HasPrefix(sample, []byte("%PDF-"))
	case ".jpg", ".jpeg":
		return len(sample) >= 3 && sample[0] == 0xff && sample[1] == 0xd8 && sample[2] == 0xff
	case ".png":
		return bytes.HasPrefix(sample, []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a})
	case ".webp":
		return len(sample) >= 12 && bytes.Equal(sample[:4], []byte("RIFF")) && bytes.Equal(sample[8:12], []byte("WEBP"))
	case ".docx", ".xlsx":
		return bytes.HasPrefix(sample, []byte{'P', 'K', 0x03, 0x04})
	case ".doc", ".xls":
		return bytes.HasPrefix(sample, []byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1})
	default:
		return false
	}
}

func isContractDocumentObjectPath(organizationID string, contractID string, objectPath string) bool {
	prefix := strings.TrimSpace(organizationID) + "/" + strings.TrimSpace(contractID) + "/"
	filePart, ok := strings.CutPrefix(strings.TrimSpace(objectPath), prefix)
	return ok && filePart != "" && !strings.Contains(filePart, "/") && filePart != "." && filePart != ".."
}

func (client storageClient) objectExists(ctx context.Context, bucket string, objectPath string) (bool, error) {
	if client.projectURL == "" || client.apiKey == "" {
		return false, ErrStorageMissing
	}
	endpoint := fmt.Sprintf(
		"%s/storage/v1/object/info/%s/%s",
		client.projectURL,
		url.PathEscape(bucket),
		escapeStorageObjectPath(objectPath),
	)
	request, err := http.NewRequestWithContext(ctx, http.MethodHead, endpoint, nil)
	if err != nil {
		return false, err
	}
	supabasehttp.SetServiceAuth(request, client.apiKey)
	response, err := client.httpClient.Do(request)
	if err != nil {
		return false, err
	}
	defer response.Body.Close()
	switch {
	case response.StatusCode >= 200 && response.StatusCode < 300:
		return true, nil
	case response.StatusCode == http.StatusNotFound:
		return false, nil
	default:
		raw, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return false, fmt.Errorf("%w: object verification failed with status %d: %s", ErrStorageFailed, response.StatusCode, strings.TrimSpace(string(raw)))
	}
}

func contractDocumentCompensationContext(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(parent), contractDocumentCompensationTimeout)
}

func compensateContractDocumentUpload(ctx context.Context, storage contractDocumentStorage, objectPath string, cause error) error {
	if cleanupErr := storage.remove(ctx, "contract-documents", []string{objectPath}); cleanupErr != nil {
		return errors.Join(cause, fmt.Errorf("contract document upload compensation failed: %w", cleanupErr))
	}
	return cause
}

func reconcileContractDocumentDeleteFailure(
	ctx context.Context,
	storage contractDocumentStorage,
	objectPath string,
	deleteErr error,
	restoreMetadata func(context.Context) error,
) error {
	if deleteErr == nil {
		return nil
	}

	// A missing Storage configuration means no delete request was sent, so the
	// object is known to remain and restoring metadata is safe.
	if errors.Is(deleteErr, ErrStorageMissing) {
		if restoreErr := restoreMetadata(ctx); restoreErr != nil {
			return errors.Join(deleteErr, fmt.Errorf("contract document metadata restoration failed: %w", restoreErr))
		}
		return deleteErr
	}

	exists, verificationErr := storage.objectExists(ctx, "contract-documents", objectPath)
	if verificationErr != nil {
		// The delete outcome is unknown. Do not restore metadata because the
		// object may already be gone; an orphan object is safer than a broken link.
		return errors.Join(deleteErr, fmt.Errorf("contract document delete outcome could not be verified: %w", verificationErr))
	}
	if !exists {
		// The DELETE response was lost or failed after the object was removed.
		// Metadata is already absent, so the requested end state was reached.
		return nil
	}
	if restoreErr := restoreMetadata(ctx); restoreErr != nil {
		return errors.Join(deleteErr, fmt.Errorf("contract document metadata restoration failed: %w", restoreErr))
	}
	return deleteErr
}

func lockContractDocumentAttachmentsWithExec(ctx context.Context, exec execer, organizationID string, contractID string) ([]byte, error) {
	var attachments []byte
	err := exec.QueryRow(ctx, `
		select case
			when jsonb_typeof(attachments) = 'array' then attachments
			else '[]'::jsonb
		end
		from public.contracts
		where organization_id = $1::uuid
		  and id = $2::uuid
		for update
	`, organizationID, contractID).Scan(&attachments)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return attachments, nil
}

func appendContractDocumentMetadataWithExec(
	ctx context.Context,
	exec execer,
	organizationID string,
	contractID string,
	objectPath string,
	document json.RawMessage,
) error {
	attachments, err := lockContractDocumentAttachmentsWithExec(ctx, exec, organizationID, contractID)
	if err != nil {
		return err
	}
	if _, exists, err := contractDocumentFromAttachments(attachments, objectPath); err != nil {
		return err
	} else if exists {
		return ErrConflict
	}

	tag, err := exec.Exec(ctx, `
		update public.contracts
		set attachments = (
			case when jsonb_typeof(attachments) = 'array' then attachments else '[]'::jsonb end
		) || jsonb_build_array($3::jsonb),
		updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and not exists (
			select 1
			from jsonb_array_elements(
				case when jsonb_typeof(attachments) = 'array' then attachments else '[]'::jsonb end
			) item
			where item->>'path' = $4
		  )
	`, organizationID, contractID, string(document), objectPath)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrConflict
	}
	return nil
}

func removeContractDocumentMetadataWithExec(
	ctx context.Context,
	exec execer,
	organizationID string,
	contractID string,
	objectPath string,
) (json.RawMessage, error) {
	attachments, err := lockContractDocumentAttachmentsWithExec(ctx, exec, organizationID, contractID)
	if err != nil {
		return nil, err
	}
	document, exists, err := contractDocumentFromAttachments(attachments, objectPath)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}

	tag, err := exec.Exec(ctx, `
		update public.contracts
		set attachments = coalesce((
			select jsonb_agg(item order by ordinal)
			from jsonb_array_elements(
				case when jsonb_typeof(attachments) = 'array' then attachments else '[]'::jsonb end
			) with ordinality items(item, ordinal)
			where item->>'path' <> $3
		), '[]'::jsonb),
		updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and exists (
			select 1
			from jsonb_array_elements(
				case when jsonb_typeof(attachments) = 'array' then attachments else '[]'::jsonb end
			) item
			where item->>'path' = $3
		  )
	`, organizationID, contractID, objectPath)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() != 1 {
		return nil, ErrConflict
	}
	return document, nil
}

func restoreContractDocumentMetadataWithExec(
	ctx context.Context,
	exec execer,
	organizationID string,
	contractID string,
	objectPath string,
	document json.RawMessage,
) error {
	attachments, err := lockContractDocumentAttachmentsWithExec(ctx, exec, organizationID, contractID)
	if err != nil {
		return err
	}
	if _, exists, err := contractDocumentFromAttachments(attachments, objectPath); err != nil {
		return err
	} else if exists {
		return nil
	}

	tag, err := exec.Exec(ctx, `
		update public.contracts
		set attachments = (
			case when jsonb_typeof(attachments) = 'array' then attachments else '[]'::jsonb end
		) || jsonb_build_array($3::jsonb),
		updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and not exists (
			select 1
			from jsonb_array_elements(
				case when jsonb_typeof(attachments) = 'array' then attachments else '[]'::jsonb end
			) item
			where item->>'path' = $4
		  )
	`, organizationID, contractID, string(document), objectPath)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrConflict
	}
	return nil
}

func contractDocumentFromAttachments(attachments []byte, objectPath string) (json.RawMessage, bool, error) {
	var documents []json.RawMessage
	if err := json.Unmarshal(attachments, &documents); err != nil {
		return nil, false, err
	}
	for _, document := range documents {
		var reference struct {
			Path string `json:"path"`
		}
		if err := json.Unmarshal(document, &reference); err != nil {
			return nil, false, err
		}
		if reference.Path == objectPath {
			return append(json.RawMessage(nil), document...), true, nil
		}
	}
	return nil, false, nil
}
