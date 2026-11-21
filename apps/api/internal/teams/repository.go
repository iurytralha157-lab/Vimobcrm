package teams

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/pgvalue"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db              *dbpkg.Postgres
	storage         storageClient
	beginMutationTx func(context.Context) (pgx.Tx, error)
}

const (
	maxTeamNameLength    = 120
	maxTeamLogoURLLength = 2000
	maxTeamMembers       = 500
	maxTeamRevision      = 9007199254740991
)

type teamScanner interface {
	Scan(dest ...any) error
}

type queryRowExecutor interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type teamReadExecutor interface {
	queryRowExecutor
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func NewRepository(db *dbpkg.Postgres, storageConfig StorageConfig) Repository {
	return Repository{
		db:      db,
		storage: newStorageClient(storageConfig),
	}
}

func (repo Repository) UploadLogo(ctx context.Context, tenantContext tenant.Context, contentType string, size int64, _ string, body io.Reader) (AssetUpload, error) {
	if !canManageTeams(tenantContext) {
		return AssetUpload{}, tenant.ErrOrganizationAccessDenied
	}
	ext := extensionForContentType(contentType)
	if ext == "" {
		return AssetUpload{}, ErrInvalidInput
	}
	objectPath := fmt.Sprintf("organizations/%s/teams/%d%s", tenantContext.OrganizationID, time.Now().UTC().UnixMilli(), ext)
	if err := repo.storage.upload(ctx, "logos", objectPath, contentType, body); err != nil {
		return AssetUpload{}, err
	}
	return AssetUpload{
		URL:         repo.storage.publicURL("logos", objectPath),
		Path:        objectPath,
		Bucket:      "logos",
		ContentType: contentType,
		Size:        size,
	}, nil
}

func textOrNil(value *string) any {
	if value == nil {
		return nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil
	}
	return cleaned
}

func textPointer(value pgtype.Text) *string {
	return pgvalue.TextPointer(value)
}

func normalizeUUID(value string) (string, bool) {
	return pgvalue.NormalizeUUID(value)
}

func extensionForContentType(contentType string) string {
	if before, _, ok := strings.Cut(contentType, ";"); ok {
		contentType = before
	}
	switch strings.ToLower(strings.TrimSpace(contentType)) {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "image/svg+xml":
		return ".svg"
	default:
		return ""
	}
}
