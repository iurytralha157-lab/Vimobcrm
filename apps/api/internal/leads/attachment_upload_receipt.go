package leads

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/supabasehttp"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var ErrAttachmentUploadConflict = errors.New("attachment upload key has different content")
var ErrAttachmentUploadUnavailable = errors.New("attachment upload receipt storage is unavailable")

type attachmentUploadReceipt struct {
	key, digest, leadID, objectPath, attachmentID string
}

type attachmentUploadOperations struct {
	begin   func(context.Context) (pgx.Tx, error)
	insert  func(context.Context, pgx.Tx, leadAttachmentCreateInput, string) (LeadAttachment, error)
	upload  func(context.Context, string, string, []byte) error
	sign    func(context.Context, tenant.Context, *LeadAttachment)
	cleanup func(tenant.Context, attachmentUploadReceipt)
}

func attachmentUploadDigest(leadID, name, contentType string, content []byte) string {
	contentDigest := sha256.Sum256(content)
	metadata, _ := json.Marshal([]string{"lead-attachment:v1", leadID, name, contentType, hex.EncodeToString(contentDigest[:])})
	digest := sha256.Sum256(metadata)
	return hex.EncodeToString(digest[:])
}

func readAttachmentUploadReceipt(ctx context.Context, tx pgx.Tx, actor tenant.Context, receipt attachmentUploadReceipt) (attachmentUploadReceipt, error) {
	var digest, leadID, objectPath string
	var attachmentID pgtype.Text
	err := tx.QueryRow(ctx, `select payload_sha256,lead_id::text,object_path,attachment_id::text
	 from private.lead_attachment_upload_receipts where organization_id=$1::uuid and actor_id=$2::uuid and request_key=$3::uuid
	 for update`, actor.OrganizationID, actor.UserID, receipt.key).Scan(&digest, &leadID, &objectPath, &attachmentID)
	if err != nil {
		return receipt, attachmentReceiptStorageError(err)
	}
	if digest != receipt.digest || leadID != receipt.leadID || objectPath != receipt.objectPath {
		return receipt, ErrAttachmentUploadConflict
	}
	receipt.attachmentID = textValue(attachmentID)
	return receipt, nil
}

func prepareAttachmentUploadReceipt(ctx context.Context, tx pgx.Tx, actor tenant.Context, receipt attachmentUploadReceipt) (attachmentUploadReceipt, error) {
	_, err := tx.Exec(ctx, `insert into private.lead_attachment_upload_receipts
	 (organization_id,actor_id,request_key,lead_id,payload_sha256,object_path)
	 values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6) on conflict(organization_id,actor_id,request_key) do nothing`,
		actor.OrganizationID, actor.UserID, receipt.key, receipt.leadID, receipt.digest, receipt.objectPath)
	if err != nil {
		return receipt, attachmentReceiptStorageError(err)
	}
	return readAttachmentUploadReceipt(ctx, tx, actor, receipt)
}

func completeAttachmentUploadReceipt(ctx context.Context, tx pgx.Tx, actor tenant.Context, receipt attachmentUploadReceipt, attachmentID string) error {
	updated, err := tx.Exec(ctx, `update private.lead_attachment_upload_receipts set attachment_id=$4::uuid,completed_at=now()
	 where organization_id=$1::uuid and actor_id=$2::uuid and request_key=$3::uuid
	 and payload_sha256=$5 and attachment_id is null`, actor.OrganizationID, actor.UserID, receipt.key, attachmentID, receipt.digest)
	if err != nil {
		return attachmentReceiptStorageError(err)
	}
	if updated.RowsAffected() != 1 {
		return ErrAttachmentUploadUnavailable
	}
	return nil
}

func attachmentReceiptStorageError(err error) error {
	var databaseError *pgconn.PgError
	if errors.As(err, &databaseError) {
		switch databaseError.Code {
		case "42P01", "3F000", "42703", "42501":
			return ErrAttachmentUploadUnavailable
		}
	}
	return err
}

// The prepared receipt is durable before Storage is touched. Its lock makes
// retries write exactly the same bytes/path; completing the attachment and its
// receipt is one database commit. A lost response replays the existing row.
func (repo Repository) uploadLeadAttachmentWithReceipt(ctx context.Context, actor tenant.Context, input leadAttachmentCreateInput, content []byte, contentType string, receipt attachmentUploadReceipt, columns leadAttachmentColumns) (LeadAttachment, error) {
	return runAttachmentUpload(ctx, actor, input, content, contentType, receipt, columns, attachmentUploadOperations{
		begin: repo.db.Pool().Begin,
		insert: func(ctx context.Context, tx pgx.Tx, input leadAttachmentCreateInput, objectPath string) (LeadAttachment, error) {
			input.FileURL = repo.storage.publicURL(leadAttachmentBucket, objectPath)
			return repo.insertLeadAttachment(ctx, tx, actor, input, columns, objectPath)
		},
		upload: repo.uploadAttachmentObject, sign: repo.signLeadAttachmentURL, cleanup: repo.cleanupRolledBackAttachmentUpload,
	})
}

func runAttachmentUpload(ctx context.Context, actor tenant.Context, input leadAttachmentCreateInput, content []byte, contentType string, receipt attachmentUploadReceipt, columns leadAttachmentColumns, operations attachmentUploadOperations) (result LeadAttachment, operationErr error) {
	prepare, err := operations.begin(ctx)
	if err != nil {
		return result, err
	}
	defer prepare.Rollback(ctx)
	if err := lockAttachmentLeadResources(ctx, prepare, actor, input.LeadID, input.LeadID); err != nil {
		return result, err
	}
	receipt, err = prepareAttachmentUploadReceipt(ctx, prepare, actor, receipt)
	if err != nil {
		return result, err
	}
	if err := prepare.Commit(ctx); err != nil {
		return result, err // No Storage upload has started.
	}
	tx, err := operations.begin(ctx)
	if err != nil {
		return result, err
	}
	commitStarted, storageStarted := false, false
	defer func() {
		rollbackErr := tx.Rollback(ctx)
		confirmed := (!commitStarted && rollbackErr == nil) || errors.Is(operationErr, pgx.ErrTxCommitRollback)
		if operationErr != nil && storageStarted && confirmed {
			operations.cleanup(actor, receipt)
		}
	}()
	// All uploads use the same lead -> receipt lock order. Cleanup owns only
	// the receipt; it never reacquires a lead or conversation lock.
	if err := lockAttachmentLeadResources(ctx, tx, actor, input.LeadID, input.LeadID); err != nil {
		return result, err
	}
	receipt, err = readAttachmentUploadReceipt(ctx, tx, actor, receipt)
	if err != nil {
		return result, err
	}
	if receipt.attachmentID != "" {
		result, err = scanLeadAttachment(tx.QueryRow(ctx, `select `+leadAttachmentSelectFields(columns)+`
		 from public.lead_attachments la join public.leads l on l.id=la.lead_id
		 where l.organization_id=$1::uuid and la.lead_id=$2::uuid and la.id=$3::uuid`, actor.OrganizationID, input.LeadID, receipt.attachmentID))
		if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, ErrInvalidReference) {
			err = ErrLeadNotFound // A completed, deleted document is never recreated.
		}
		if err != nil {
			return result, err
		}
	} else {
		storageStarted = true
		if err := operations.upload(ctx, receipt.objectPath, contentType, content); err != nil {
			return result, err
		}
		result, err = operations.insert(ctx, tx, input, receipt.objectPath)
		if err != nil {
			return result, err
		}
		if err := completeAttachmentUploadReceipt(ctx, tx, actor, receipt, result.ID); err != nil {
			return result, err
		}
	}
	commitStarted = true
	if err := tx.Commit(ctx); err != nil {
		return LeadAttachment{}, err // Unknown COMMIT outcomes never delete Storage.
	}
	operations.sign(ctx, actor, &result)
	return result, nil
}

func (repo Repository) uploadAttachmentObject(ctx context.Context, objectPath, contentType string, content []byte) error {
	client := repo.storage
	if client.projectURL == "" || client.apiKey == "" {
		return ErrStorageNotConfigured
	}
	endpoint := fmt.Sprintf("%s/storage/v1/object/%s/%s", client.projectURL, url.PathEscape(leadAttachmentBucket), supabasehttp.EscapeObjectPath(objectPath))
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(content))
	if err != nil {
		return err
	}
	supabasehttp.SetServiceAuth(request, client.apiKey)
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("x-upsert", "true") // Receipt lock + payload hash make an exact replay safe.
	response, err := client.httpClient.Do(request)
	if err != nil {
		return ErrStorageOperation
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return ErrStorageOperation
	}
	return nil
}

// Delete only after a confirmed rollback, then reacquire the receipt lock and
// verify that no retry completed in between. Ambiguous errors retain the
// tracked object so the same request can safely recover it.
func (repo Repository) cleanupRolledBackAttachmentUpload(actor tenant.Context, receipt attachmentUploadReceipt) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)
	_ = cleanupAttachmentUploadIfPending(ctx, tx, actor, receipt, func(ctx context.Context, objectPath string) error {
		return repo.storage.delete(ctx, leadAttachmentBucket, objectPath)
	})
}

func validatedAttachmentContentType(content []byte) string {
	value := http.DetectContentType(content)
	value = strings.TrimSpace(strings.SplitN(value, ";", 2)[0])
	switch value {
	case "application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/mpeg", "video/quicktime", "video/webm", "video/ogg", "audio/aac", "audio/mpeg", "audio/mp3", "audio/ogg", "audio/wav", "audio/webm", "audio/mp4":
		return value
	default:
		return "application/octet-stream" // Office/text/unknown files remain downloadable, never executable HTML.
	}
}

func cleanupAttachmentUploadIfPending(ctx context.Context, tx pgx.Tx, actor tenant.Context, receipt attachmentUploadReceipt, remove func(context.Context, string) error) error {
	current, err := readAttachmentUploadReceipt(ctx, tx, actor, receipt)
	if err != nil {
		return err
	}
	if current.attachmentID != "" {
		return nil
	}
	return remove(ctx, receipt.objectPath)
}
