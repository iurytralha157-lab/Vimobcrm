package financial

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) queryJSONRows(ctx context.Context, sql string, args ...any) ([]map[string]any, error) {
	rows, err := repo.db.Pool().Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var item map[string]any
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (repo Repository) queryJSONObject(ctx context.Context, sql string, args ...any) (map[string]any, error) {
	return queryJSONObjectExec(ctx, repo.db.Pool(), sql, args...)
}

func queryJSONObjectExec(ctx context.Context, exec interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}, sql string, args ...any) (map[string]any, error) {
	var raw []byte
	if err := exec.QueryRow(ctx, sql, args...).Scan(&raw); err != nil {
		return nil, err
	}
	var item map[string]any
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil, err
	}
	return item, nil
}

func (repo Repository) queryJSONArray(ctx context.Context, sql string, args ...any) ([]any, error) {
	var raw []byte
	if err := repo.db.Pool().QueryRow(ctx, sql, args...).Scan(&raw); err != nil {
		return nil, err
	}
	items := []any{}
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	return items, nil
}

func canReadFinancial(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission("financial_view") || tenantContext.HasPermission("financial_manage")
}

func canManageFinancial(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission("financial_manage") || tenantContext.HasRole("owner", "admin")
}

const (
	defaultFinancialListLimit = 200
	maximumFinancialListLimit = 500
	maximumFinancialOffset    = 10_000_000
)

func financialListPaginationSQL(values url.Values, args *[]any) (string, error) {
	limit := defaultFinancialListLimit
	if raw := strings.TrimSpace(values.Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > maximumFinancialListLimit {
			return "", ErrInvalidInput
		}
		limit = parsed
	}
	offset := 0
	if raw := strings.TrimSpace(values.Get("offset")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 || parsed > maximumFinancialOffset {
			return "", ErrInvalidInput
		}
		offset = parsed
	}
	*args = append(*args, limit, offset)
	return fmt.Sprintf("limit $%d::int offset $%d::int", len(*args)-1, len(*args)), nil
}
