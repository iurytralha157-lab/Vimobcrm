package homenotices

import dbpkg "github.com/vimob-crm/vimob-crm/packages/db"

type Repository struct {
	db *dbpkg.Postgres
}

func NewRepository(db *dbpkg.Postgres) Repository {
	return Repository{db: db}
}

var _ Store = Repository{}
