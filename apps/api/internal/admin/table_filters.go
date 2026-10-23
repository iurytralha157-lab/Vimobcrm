package admin

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/searchtext"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type AdminTableFilter struct {
	Search        string
	Limit, Offset int
}
type AdminTablePage struct {
	Data []map[string]any   `json:"data"`
	Meta AdminTablePageMeta `json:"meta"`
}
type AdminTablePageMeta struct {
	NextOffset *int `json:"nextOffset"`
}

func parseAdminTableFilter(values url.Values) (AdminTableFilter, error) {
	f := AdminTableFilter{Search: strings.TrimSpace(values.Get("search")), Limit: 120}
	if utf8.RuneCountInString(f.Search) > 180 || strings.ContainsRune(f.Search, '\x00') {
		return f, ErrInvalidInput
	}
	for _, field := range []struct {
		name     string
		target   *int
		min, max int
	}{
		{"limit", &f.Limit, 1, 200}, {"offset", &f.Offset, 0, 1_000_000},
	} {
		if raw := values.Get(field.name); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil || n < field.min || n > field.max {
				return f, ErrInvalidInput
			}
			*field.target = n
		}
	}
	return f, nil
}

var adminTableSearchFields = map[string][]string{
	"onboarding_requests": {"company_name", "responsible_name", "responsible_email", "status", "created_at"},
	"feature_requests":    {"title", "category", "status", "created_at"},
	"notifications":       {"type", "is_read", "created_at"},
	"email_templates":     {"name", "subject", "slug", "updated_at"},
	"email_logs":          {"recipient_email", "subject", "status", "sent_at"},
	"announcements":       {"message", "target_type", "is_active", "created_at"},
	"help_articles":       {"title", "category", "is_active", "updated_at"},
	"audit_logs":          {"action", "entity_type", "user_id", "created_at"},
}

func adminTablePageSQL(tc tenant.Context, table string, f AdminTableFilter) (string, []any, error) {
	if !tc.IsSuperAdmin {
		return "", nil, tenant.ErrOrganizationAccessDenied
	}
	if !isAllowedAdminReadTable(table) || f.Limit < 1 || f.Limit > 200 || f.Offset < 0 || f.Offset > 1_000_000 || utf8.RuneCountInString(f.Search) > 180 || strings.ContainsRune(f.Search, '\x00') {
		return "", nil, ErrInvalidInput
	}
	args := []any{f.Limit + 1, f.Offset}
	where := "true"
	if f.Search != "" {
		fields := adminTableSearchFields[table]
		if len(fields) == 0 {
			return "", nil, ErrInvalidInput
		}
		expressions := make([]string, 0, len(fields))
		for _, field := range fields {
			expressions = append(expressions, fmt.Sprintf("(to_jsonb(t)->>'%s')", field))
		}
		args = append(args, searchtext.Pattern(f.Search))
		where = searchtext.AnySQL(expressions, "$3")
	}
	projection := "to_jsonb(t)"
	if table == "notifications" {
		projection = `jsonb_build_object('id',t.id,'title','[redigido]','type',coalesce(t.type,'info'),'is_read',t.is_read,'created_at',t.created_at)`
	}
	identifier := pgx.Identifier{"public", table}.Sanitize()
	query := fmt.Sprintf(`select %s from %s t where %s
  order by coalesce(to_jsonb(t)->>'created_at',to_jsonb(t)->>'updated_at',to_jsonb(t)->>'sent_at','') desc,
    coalesce(to_jsonb(t)->>'id','') desc limit $1 offset $2`, projection, identifier, where)
	return query, args, nil
}

func (repo Repository) ListTableRowsPage(ctx context.Context, tc tenant.Context, table string, f AdminTableFilter) (AdminTablePage, error) {
	page := AdminTablePage{Data: []map[string]any{}}
	query, args, err := adminTablePageSQL(tc, table, f)
	if err != nil {
		return page, err
	}
	rows, err := repo.queryJSONRows(ctx, query, args...)
	if err != nil {
		return page, err
	}
	if len(rows) > f.Limit {
		rows = rows[:f.Limit]
		next := f.Offset + f.Limit
		page.Meta.NextOffset = &next
	}
	page.Data = rows
	return page, nil
}
