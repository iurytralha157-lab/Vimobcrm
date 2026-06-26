package telemetry

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db *dbpkg.Postgres
}

type scanner interface {
	Scan(dest ...any) error
}

func NewRepository(db *dbpkg.Postgres) Repository {
	return Repository{db: db}
}

func (repo Repository) Create(ctx context.Context, tenantContext tenant.Context, input createInput) (ErrorEvent, error) {
	return scanEvent(repo.db.Pool().QueryRow(ctx, `
		insert into public.error_events (
			organization_id,
			user_id,
			request_id,
			source,
			severity,
			category,
			message,
			error_code,
			http_status,
			method,
			path,
			route,
			component,
			stack,
			stack_hash,
			fingerprint,
			url,
			user_agent,
			browser_context,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			$3,
			$4,
			$5,
			$6,
			$7,
			$8,
			$9::integer,
			$10,
			$11,
			$12,
			$13,
			$14,
			$15,
			$16,
			$17,
			$18,
			$19::jsonb,
			$20::jsonb
		)
		returning `+eventSelectFields(""),
		nullableString(tenantContext.OrganizationID),
		nullableString(tenantContext.UserID),
		nullableString(input.RequestID),
		input.Source,
		input.Severity,
		nullableString(input.Category),
		input.Message,
		nullableString(input.ErrorCode),
		nullableInt(input.HTTPStatus),
		nullableString(input.Method),
		nullableString(input.Path),
		nullableString(input.Route),
		nullableString(input.Component),
		nullableString(input.Stack),
		nullableString(input.StackHash),
		input.Fingerprint,
		nullableString(input.URL),
		nullableString(input.UserAgent),
		jsonb(input.BrowserContext),
		jsonb(input.Metadata),
	))
}

func (repo Repository) List(ctx context.Context, filter ListFilter) (ListResponse, error) {
	args := []any{}
	where := []string{"true"}

	addFilter := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}

	if filter.Search != "" {
		args = append(args, "%"+filter.Search+"%")
		searchIndex := len(args)
		where = append(where, fmt.Sprintf(`(
			e.message ilike $%d
			or e.error_code ilike $%d
			or e.path ilike $%d
			or e.component ilike $%d
			or e.request_id ilike $%d
			or e.fingerprint ilike $%d
		)`, searchIndex, searchIndex, searchIndex, searchIndex, searchIndex, searchIndex))
	}
	if filter.Severity != "" {
		addFilter("e.severity = $%d", filter.Severity)
	}
	if filter.Source != "" {
		addFilter("e.source = $%d", filter.Source)
	}
	if filter.OrganizationID != "" {
		addFilter("e.organization_id = $%d::uuid", filter.OrganizationID)
	}
	if filter.Fingerprint != "" {
		addFilter("e.fingerprint = $%d", filter.Fingerprint)
	}
	if filter.Unresolved {
		where = append(where, "e.resolved_at is null")
	}

	args = append(args, filter.Limit, filter.Offset)
	limitIndex := len(args) - 1
	offsetIndex := len(args)

	rows, err := repo.db.Pool().Query(ctx, `
		select
			count(*) over() as total_count,
			`+eventSelectFields("e.")+`
		from public.error_events e
		where `+strings.Join(where, " and ")+`
		order by e.created_at desc, e.id desc
		limit $`+fmt.Sprint(limitIndex)+`
		offset $`+fmt.Sprint(offsetIndex),
		args...,
	)
	if err != nil {
		return ListResponse{}, err
	}
	defer rows.Close()

	events := make([]ErrorEvent, 0, filter.Limit)
	var total int64
	for rows.Next() {
		event, rowTotal, err := scanEventWithTotal(rows)
		if err != nil {
			return ListResponse{}, err
		}
		total = rowTotal
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return ListResponse{}, err
	}

	return ListResponse{
		Data:   events,
		Total:  total,
		Limit:  filter.Limit,
		Offset: filter.Offset,
	}, nil
}

func (repo Repository) Resolve(ctx context.Context, eventID string, resolvedBy string, note string) (ErrorEvent, error) {
	if !isUUID(eventID) {
		return ErrorEvent{}, ErrEventNotFound
	}

	event, err := scanEvent(repo.db.Pool().QueryRow(ctx, `
		update public.error_events
		set resolved_at = now(),
		    resolved_by = $2::uuid,
		    resolution_note = nullif($3, '')
		where id = $1::uuid
		returning `+eventSelectFields(""),
		eventID,
		resolvedBy,
		note,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrorEvent{}, ErrEventNotFound
	}
	return event, err
}

func eventSelectFields(prefix string) string {
	return `
		` + prefix + `id::text,
		` + prefix + `organization_id::text,
		` + prefix + `user_id::text,
		` + prefix + `request_id,
		` + prefix + `source,
		` + prefix + `severity,
		` + prefix + `category,
		` + prefix + `message,
		` + prefix + `error_code,
		` + prefix + `http_status,
		` + prefix + `method,
		` + prefix + `path,
		` + prefix + `route,
		` + prefix + `component,
		` + prefix + `stack,
		` + prefix + `stack_hash,
		` + prefix + `fingerprint,
		` + prefix + `url,
		` + prefix + `user_agent,
		` + prefix + `browser_context::text,
		` + prefix + `metadata::text,
		` + prefix + `created_at,
		` + prefix + `resolved_at,
		` + prefix + `resolved_by::text,
		` + prefix + `resolution_note`
}

func scanEventWithTotal(row scanner) (ErrorEvent, int64, error) {
	var total int64
	event, err := scanEventFields(row, &total)
	return event, total, err
}

func scanEvent(row scanner) (ErrorEvent, error) {
	return scanEventFields(row, nil)
}

func scanEventFields(row scanner, total *int64) (ErrorEvent, error) {
	var event ErrorEvent
	var organizationID, userID, requestID, category, errorCode, method, path, route, component pgtype.Text
	var stack, stackHash, url, userAgent, browserContext, metadata, resolvedBy, resolutionNote pgtype.Text
	var httpStatus pgtype.Int4
	var resolvedAt pgtype.Timestamptz

	dest := []any{
		&event.ID,
		&organizationID,
		&userID,
		&requestID,
		&event.Source,
		&event.Severity,
		&category,
		&event.Message,
		&errorCode,
		&httpStatus,
		&method,
		&path,
		&route,
		&component,
		&stack,
		&stackHash,
		&event.Fingerprint,
		&url,
		&userAgent,
		&browserContext,
		&metadata,
		&event.CreatedAt,
		&resolvedAt,
		&resolvedBy,
		&resolutionNote,
	}

	if total != nil {
		dest = append([]any{total}, dest...)
	}

	if err := row.Scan(dest...); err != nil {
		return ErrorEvent{}, err
	}

	event.OrganizationID = textValue(organizationID)
	event.UserID = textValue(userID)
	event.RequestID = textValue(requestID)
	event.Category = textValue(category)
	event.ErrorCode = textValue(errorCode)
	if httpStatus.Valid {
		event.HTTPStatus = int(httpStatus.Int32)
	}
	event.Method = textValue(method)
	event.Path = textValue(path)
	event.Route = textValue(route)
	event.Component = textValue(component)
	event.Stack = textValue(stack)
	event.StackHash = textValue(stackHash)
	event.URL = textValue(url)
	event.UserAgent = textValue(userAgent)
	event.BrowserContext = jsonMap(textValue(browserContext))
	event.Metadata = jsonMap(textValue(metadata))
	if resolvedAt.Valid {
		resolved := resolvedAt.Time
		event.ResolvedAt = &resolved
	}
	event.ResolvedBy = textValue(resolvedBy)
	event.ResolutionNote = textValue(resolutionNote)

	return event, nil
}

func textValue(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func jsonMap(value string) map[string]any {
	if strings.TrimSpace(value) == "" {
		return map[string]any{}
	}

	var out map[string]any
	if err := json.Unmarshal([]byte(value), &out); err != nil {
		return map[string]any{}
	}
	return out
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func nullableInt(value int) any {
	if value == 0 {
		return nil
	}
	return value
}

func jsonb(value any) string {
	payload, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(payload)
}
