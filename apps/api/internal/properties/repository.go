package properties

import (
	"fmt"
	"sort"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/pgvalue"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db      *dbpkg.Postgres
	storage storageClient
}

type scanner interface {
	Scan(dest ...any) error
}

func NewRepository(db *dbpkg.Postgres, storageConfig StorageConfig) Repository {
	return Repository{
		db:      db,
		storage: newStorageClient(storageConfig),
	}
}

func updateParts(input propertyRequest, firstPlaceholder int) ([]string, []any) {
	keys := sortedMutationKeys(input)
	assignments := make([]string, 0, len(keys))
	args := make([]any, 0, len(keys))

	for _, key := range keys {
		def := writableColumns[key]
		args = append(args, input[key])
		placeholder := typedPlaceholder(firstPlaceholder+len(args)-1, def.kind)
		if def.column == "metadata" {
			assignments = append(assignments, fmt.Sprintf(
				"%s = (case when jsonb_typeof(%s) = 'object' then %s else '{}'::jsonb end) || %s",
				def.column,
				def.column,
				def.column,
				placeholder,
			))
			continue
		}
		assignments = append(assignments, fmt.Sprintf("%s = %s", def.column, placeholder))
	}

	return assignments, args
}

func sortedMutationKeys(input propertyRequest) []string {
	keys := make([]string, 0, len(input))
	for key := range input {
		if _, ok := writableColumns[key]; ok {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	return keys
}

func typedPlaceholder(index int, kind fieldKind) string {
	placeholder := fmt.Sprintf("$%d", index)
	switch kind {
	case fieldBool:
		return placeholder + "::boolean"
	case fieldInt:
		return placeholder + "::integer"
	case fieldNumeric:
		return placeholder + "::numeric"
	case fieldUUID:
		return placeholder + "::uuid"
	case fieldDate:
		return placeholder + "::date"
	case fieldJSON:
		return placeholder + "::jsonb"
	case fieldTextArray:
		return placeholder + "::text[]"
	default:
		return placeholder
	}
}

func normalizeUUID(value string) (string, bool) {
	return pgvalue.NormalizeUUID(value)
}
