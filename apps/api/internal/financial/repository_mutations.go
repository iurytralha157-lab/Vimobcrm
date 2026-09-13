package financial

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

func (repo Repository) insertMap(ctx context.Context, table string, organizationID string, payload map[string]any, specs map[string]FieldSpec, returning string) (map[string]any, error) {
	return repo.insertMapWithExec(ctx, repo.db.Pool(), table, organizationID, payload, specs, returning)
}

func (repo Repository) insertMapWithExec(ctx context.Context, exec execer, table string, organizationID string, payload map[string]any, specs map[string]FieldSpec, returning string) (map[string]any, error) {
	columns := []string{"organization_id"}
	args := []any{organizationID}
	placeholders := []string{"$1::uuid"}
	for key, spec := range specs {
		value, ok := payload[key]
		if !ok {
			continue
		}
		args = append(args, cleanValue(value))
		columns = append(columns, spec.Column)
		placeholders = append(placeholders, placeholderForKind(spec.Kind, len(args)))
	}
	if len(columns) == 1 {
		return nil, ErrInvalidInput
	}
	identifier := pgx.Identifier{"public", table}.Sanitize()
	sql := fmt.Sprintf(`
		insert into %s (%s)
		values (%s)
		returning %s
	`, identifier, strings.Join(columns, ", "), strings.Join(placeholders, ", "), returning)
	return queryJSONObjectExec(ctx, exec, sql, args...)
}

func (repo Repository) updateMap(ctx context.Context, table string, organizationID string, id string, payload map[string]any, specs map[string]FieldSpec, returning string) (map[string]any, error) {
	return repo.updateMapWithExec(ctx, repo.db.Pool(), table, organizationID, id, payload, specs, returning)
}

func (repo Repository) updateMapWithExec(ctx context.Context, exec execer, table string, organizationID string, id string, payload map[string]any, specs map[string]FieldSpec, returning string) (map[string]any, error) {
	id, ok := normalizeUUID(id)
	if !ok {
		return nil, ErrInvalidInput
	}
	args := []any{organizationID, id}
	assignments := []string{}
	for key, spec := range specs {
		value, ok := payload[key]
		if !ok {
			continue
		}
		args = append(args, cleanValue(value))
		assignments = append(assignments, fmt.Sprintf("%s = %s", spec.Column, placeholderForKind(spec.Kind, len(args))))
	}
	if len(assignments) == 0 {
		return nil, ErrInvalidInput
	}
	assignments = append(assignments, "updated_at = now()")
	identifier := pgx.Identifier{"public", table}.Sanitize()
	sql := fmt.Sprintf(`
		update %s
		set %s
		where organization_id = $1::uuid
		  and id = $2::uuid
		returning %s
	`, identifier, strings.Join(assignments, ", "), returning)
	item, err := queryJSONObjectExec(ctx, exec, sql, args...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return item, err
}

func (repo Repository) deleteByID(ctx context.Context, table string, organizationID string, id string) error {
	id, ok := normalizeUUID(id)
	if !ok {
		return ErrInvalidInput
	}
	identifier := pgx.Identifier{"public", table}.Sanitize()
	tag, err := repo.db.Pool().Exec(ctx, fmt.Sprintf(`
		delete from %s
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, identifier), organizationID, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func placeholderForKind(kind string, index int) string {
	switch kind {
	case "uuid":
		return fmt.Sprintf("$%d::uuid", index)
	case "date":
		return fmt.Sprintf("$%d::date", index)
	case "timestamptz":
		return fmt.Sprintf("$%d::timestamptz", index)
	case "numeric":
		return fmt.Sprintf("$%d::numeric", index)
	case "int":
		return fmt.Sprintf("$%d::int", index)
	case "bool":
		return fmt.Sprintf("$%d::boolean", index)
	case "json":
		return fmt.Sprintf("$%d::jsonb", index)
	default:
		return fmt.Sprintf("$%d", index)
	}
}

func cleanValue(value any) any {
	switch typed := value.(type) {
	case string:
		if strings.TrimSpace(typed) == "" {
			return nil
		}
		return strings.TrimSpace(typed)
	case []any, map[string]any:
		raw, _ := json.Marshal(typed)
		return string(raw)
	default:
		return typed
	}
}
