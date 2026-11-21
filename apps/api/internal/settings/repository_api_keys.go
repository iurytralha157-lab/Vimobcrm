package settings

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type apiKeyScanner interface {
	Scan(dest ...any) error
}

func (repo Repository) ListAPIKeys(ctx context.Context, tenantContext tenant.Context) ([]APIKey, error) {
	if !canManageSetting(tenantContext, permissions.SettingsIntegrations) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			id::text,
			organization_id::text,
			name,
			key_prefix,
			(is_active and (expires_at is null or expires_at > now())) as is_active,
			last_used_at::text,
			created_by::text,
			expires_at::text,
			created_at::text,
			updated_at::text
		from public.organization_api_keys
		where organization_id = $1::uuid
		order by created_at desc, id desc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []APIKey{}
	for rows.Next() {
		item, err := scanAPIKey(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	return items, rows.Err()
}

func (repo Repository) CreateAPIKey(ctx context.Context, tenantContext tenant.Context, input CreateAPIKeyInput) (CreateAPIKeyResult, error) {
	if !canManageSetting(tenantContext, permissions.SettingsIntegrations) {
		return CreateAPIKeyResult{}, tenant.ErrOrganizationAccessDenied
	}
	name, ok := normalizeAPIKeyName(input.Name)
	if !ok {
		return CreateAPIKeyResult{}, ErrInvalidInput
	}

	rawKey, err := generateRawAPIKey()
	if err != nil {
		return CreateAPIKeyResult{}, err
	}

	keyHash := sha256.Sum256([]byte(rawKey))
	prefix := rawKey[:14]

	item, err := scanAPIKey(repo.db.Pool().QueryRow(ctx, `
		insert into public.organization_api_keys (
			organization_id,
			name,
			key_prefix,
			key_hash,
			created_by
		)
		values ($1::uuid, $2, $3, $4, $5::uuid)
		returning
			id::text,
			organization_id::text,
			name,
			key_prefix,
			(is_active and (expires_at is null or expires_at > now())) as is_active,
			last_used_at::text,
			created_by::text,
			expires_at::text,
			created_at::text,
			updated_at::text
	`, tenantContext.OrganizationID, name, prefix, hex.EncodeToString(keyHash[:]), tenantContext.UserID))
	if err != nil {
		return CreateAPIKeyResult{}, err
	}

	return CreateAPIKeyResult{APIKey: rawKey, Key: item}, nil
}

func normalizeAPIKeyName(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "Chave Padrao", true
	}
	return value, utf8.RuneCountInString(value) <= 80
}

func (repo Repository) DeleteAPIKey(ctx context.Context, tenantContext tenant.Context, apiKeyID string) error {
	if !canManageSetting(tenantContext, permissions.SettingsIntegrations) {
		return tenant.ErrOrganizationAccessDenied
	}

	apiKeyID, ok := normalizeUUID(apiKeyID)
	if !ok {
		return ErrInvalidInput
	}

	tag, err := repo.db.Pool().Exec(ctx, `
		delete from public.organization_api_keys
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, apiKeyID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrAPIKeyNotFound
	}

	return nil
}

func scanAPIKey(row apiKeyScanner) (APIKey, error) {
	var item APIKey
	var lastUsedAt, createdBy, expiresAt pgtype.Text

	err := row.Scan(
		&item.ID,
		&item.OrganizationID,
		&item.Name,
		&item.KeyPrefix,
		&item.IsActive,
		&lastUsedAt,
		&createdBy,
		&expiresAt,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return APIKey{}, ErrAPIKeyNotFound
		}
		return APIKey{}, err
	}

	item.LastUsedAt = textPointer(lastUsedAt)
	item.CreatedBy = textPointer(createdBy)
	item.ExpiresAt = textPointer(expiresAt)
	return item, nil
}

func generateRawAPIKey() (string, error) {
	var bytes [32]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}

	return "vimob_" + hex.EncodeToString(bytes[:]), nil
}
