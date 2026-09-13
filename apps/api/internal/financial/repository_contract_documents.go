package financial

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) ListContractDocuments(ctx context.Context, tenantContext tenant.Context, id string) ([]any, error) {
	if !canReadFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok {
		return nil, ErrInvalidInput
	}
	var raw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		select attachments
		from public.contracts
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, id).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	items := []any{}
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	return items, nil
}

func (repo Repository) UploadContractDocument(ctx context.Context, tenantContext tenant.Context, id string, fileName string, size int64, contentType string, body io.Reader) (map[string]any, error) {
	if !canManageFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok {
		return nil, ErrInvalidInput
	}
	if err := repo.ensureContract(ctx, tenantContext, id); err != nil {
		return nil, err
	}
	safeName := sanitizeFileName(fileName)
	uploadedAt := time.Now().UTC()
	objectPath := fmt.Sprintf("%s/%s/%d_%s", tenantContext.OrganizationID, id, uploadedAt.UnixMilli(), safeName)
	// Storage and Postgres do not share a transaction. Handled failures below
	// are compensated, while process crashes in this gap require a durable
	// outbox/reconciler (and therefore a schema migration) to close completely.
	if err := repo.storage.upload(ctx, "contract-documents", objectPath, contentType, body); err != nil {
		return nil, err
	}
	doc := map[string]any{
		"name":        fileName,
		"path":        objectPath,
		"size":        size,
		"uploaded_at": uploadedAt.Format(time.RFC3339),
	}
	raw, err := json.Marshal(doc)
	if err != nil {
		return nil, repo.compensateContractDocumentUpload(ctx, objectPath, err)
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, repo.compensateContractDocumentUpload(ctx, objectPath, err)
	}
	defer tx.Rollback(ctx)
	if err := appendContractDocumentMetadataWithExec(ctx, tx, tenantContext.OrganizationID, id, objectPath, raw); err != nil {
		_ = tx.Rollback(ctx)
		return nil, repo.compensateContractDocumentUpload(ctx, objectPath, err)
	}
	if err := tx.Commit(ctx); err != nil {
		// A commit error can be ambiguous: Postgres may have committed even if the
		// acknowledgement was lost. Keep the object so committed metadata can
		// never point to a file that compensation removed.
		return nil, err
	}
	return doc, nil
}

func (repo Repository) DeleteContractDocument(ctx context.Context, tenantContext tenant.Context, id string, path string) error {
	if !canManageFinancial(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok || strings.TrimSpace(path) == "" {
		return ErrInvalidInput
	}
	if !isContractDocumentObjectPath(tenantContext.OrganizationID, id, path) {
		return ErrNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	document, err := removeContractDocumentMetadataWithExec(ctx, tx, tenantContext.OrganizationID, id, path)
	if err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		// Do not delete from Storage when the metadata commit outcome is unknown.
		// At worst this leaves an orphan object, never a broken metadata link.
		return err
	}

	// The database commit intentionally precedes irreversible object deletion.
	// A crash after this point can leave an orphan object, which is safer than
	// metadata referencing a missing file and needs an outbox to reconcile.
	if err := repo.storage.remove(ctx, "contract-documents", []string{path}); err != nil {
		compensationCtx, cancel := contractDocumentCompensationContext(ctx)
		defer cancel()
		return reconcileContractDocumentDeleteFailure(
			compensationCtx,
			repo.storage,
			path,
			err,
			func(restoreCtx context.Context) error {
				return repo.restoreContractDocumentMetadata(restoreCtx, tenantContext.OrganizationID, id, path, document)
			},
		)
	}
	return nil
}

func (repo Repository) compensateContractDocumentUpload(ctx context.Context, objectPath string, cause error) error {
	compensationCtx, cancel := contractDocumentCompensationContext(ctx)
	defer cancel()
	return compensateContractDocumentUpload(compensationCtx, repo.storage, objectPath, cause)
}

func (repo Repository) restoreContractDocumentMetadata(ctx context.Context, organizationID string, contractID string, path string, document json.RawMessage) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := restoreContractDocumentMetadataWithExec(ctx, tx, organizationID, contractID, path, document); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (repo Repository) ContractDocumentSignedURL(ctx context.Context, tenantContext tenant.Context, id string, path string) (map[string]any, error) {
	if !canReadFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok || strings.TrimSpace(path) == "" {
		return nil, ErrInvalidInput
	}
	if err := repo.ensureContractDocument(ctx, tenantContext, id, path); err != nil {
		return nil, err
	}
	signedURL, err := repo.storage.signedURL(ctx, "contract-documents", path, 60)
	if err != nil {
		return nil, err
	}
	return map[string]any{"signedUrl": signedURL}, nil
}

func (repo Repository) ensureContractDocument(ctx context.Context, tenantContext tenant.Context, id string, path string) error {
	if !isContractDocumentObjectPath(tenantContext.OrganizationID, id, path) {
		return ErrNotFound
	}

	var exists bool
	if err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.contracts c
			cross join lateral jsonb_array_elements(
				case when jsonb_typeof(c.attachments) = 'array' then c.attachments else '[]'::jsonb end
			) item
			where c.organization_id = $1::uuid
			  and c.id = $2::uuid
			  and item->>'path' = $3
		)
	`, tenantContext.OrganizationID, id, path).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	return nil
}

func sanitizeFileName(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "documento"
	}
	builder := strings.Builder{}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '.' || char == '_' || char == '-' {
			builder.WriteRune(char)
		} else {
			builder.WriteRune('_')
		}
	}
	return builder.String()
}
