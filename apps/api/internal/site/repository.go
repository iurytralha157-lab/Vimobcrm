package site

import (
	"context"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db      *dbpkg.Postgres
	storage storageClient
}

type siteScanner interface {
	Scan(dest ...any) error
}

type execer interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

type siteQueryer interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type publicLeadDestination struct {
	PipelineID *string
	StageID    *string
}

func NewRepository(db *dbpkg.Postgres, storageConfig StorageConfig) Repository {
	return Repository{
		db:      db,
		storage: newStorageClient(storageConfig),
	}
}
