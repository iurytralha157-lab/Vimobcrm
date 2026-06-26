package audit

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"

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

func (repo Repository) List(ctx context.Context, tenantContext tenant.Context, filter ListFilter) (ListResponse, error) {
	args := []any{}
	where := []string{"true"}

	add := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}

	if tenantContext.IsSuperAdmin {
		if filter.OrganizationID != "" {
			add("al.organization_id = $%d::uuid", filter.OrganizationID)
		}
	} else {
		if tenantContext.OrganizationID == "" {
			return ListResponse{}, tenant.ErrOrganizationRequired
		}
		if filter.OrganizationID != "" && filter.OrganizationID != tenantContext.OrganizationID {
			return ListResponse{}, tenant.ErrOrganizationAccessDenied
		}
		add("al.organization_id = $%d::uuid", tenantContext.OrganizationID)
	}
	if filter.UserID != "" {
		add("al.user_id = $%d::uuid", filter.UserID)
	}
	if filter.Action != "" {
		add("al.action = $%d", filter.Action)
	}
	if filter.EntityType != "" {
		add("al.entity_type = $%d", filter.EntityType)
	}
	if filter.StartDate != "" {
		add("al.created_at >= $%d::timestamptz", filter.StartDate)
	}
	if filter.EndDate != "" {
		add("al.created_at <= $%d::timestamptz", filter.EndDate)
	}

	offset := (filter.Page - 1) * filter.Limit
	args = append(args, filter.Limit, offset)
	limitIndex := len(args) - 1
	offsetIndex := len(args)

	rows, err := repo.db.Pool().Query(ctx, `
		select
			count(*) over() as total_count,
			al.id::text,
			al.organization_id::text,
			al.user_id::text,
			al.action,
			al.entity_type,
			al.entity_id,
			al.old_data::text,
			al.new_data::text,
			al.ip_address::text,
			al.user_agent,
			al.created_at,
			u.id::text,
			u.name,
			u.email,
			o.id::text,
			o.name
		from public.audit_logs al
		left join public.users u on u.id = al.user_id
		left join public.organizations o on o.id = al.organization_id
		where `+strings.Join(where, " and ")+`
		order by al.created_at desc, al.id desc
		limit $`+fmt.Sprint(limitIndex)+`
		offset $`+fmt.Sprint(offsetIndex),
		args...,
	)
	if err != nil {
		return ListResponse{}, err
	}
	defer rows.Close()

	logs := make([]AuditLog, 0, filter.Limit)
	var total int64
	for rows.Next() {
		log, rowTotal, err := scanAuditLogWithTotal(rows)
		if err != nil {
			return ListResponse{}, err
		}
		total = rowTotal
		logs = append(logs, log)
	}
	if err := rows.Err(); err != nil {
		return ListResponse{}, err
	}

	totalPages := 0
	if filter.Limit > 0 && total > 0 {
		totalPages = int(math.Ceil(float64(total) / float64(filter.Limit)))
	}

	return ListResponse{
		Data:       logs,
		Count:      total,
		TotalPages: totalPages,
	}, nil
}

func (repo Repository) Create(ctx context.Context, tenantContext tenant.Context, input createInput) error {
	organizationID := input.OrganizationID
	if organizationID == "" {
		organizationID = tenantContext.OrganizationID
	}
	if organizationID != "" && !tenantContext.IsSuperAdmin && organizationID != tenantContext.OrganizationID {
		return tenant.ErrOrganizationAccessDenied
	}

	_, err := repo.db.Pool().Exec(ctx, `
		insert into public.audit_logs (
			user_id,
			organization_id,
			action,
			entity_type,
			entity_id,
			old_data,
			new_data,
			ip_address,
			user_agent
		)
		values (
			$1::uuid,
			$2::uuid,
			$3,
			$4,
			nullif($5, ''),
			$6::jsonb,
			$7::jsonb,
			$8::inet,
			$9
		)
	`,
		nullableString(tenantContext.UserID),
		nullableString(organizationID),
		input.Action,
		input.EntityType,
		input.EntityID,
		jsonb(input.OldData),
		jsonb(input.NewData),
		nullableString(input.IPAddress),
		nullableString(input.UserAgent),
	)
	return err
}

func scanAuditLogWithTotal(row scanner) (AuditLog, int64, error) {
	var total int64
	log, err := scanAuditLogFields(row, &total)
	return log, total, err
}

func scanAuditLogFields(row scanner, total *int64) (AuditLog, error) {
	var log AuditLog
	var organizationID, userID, entityID, oldData, newData, ipAddress, userAgent pgtype.Text
	var userIDValue, userName, userEmail, orgID, orgName pgtype.Text

	dest := []any{
		&log.ID,
		&organizationID,
		&userID,
		&log.Action,
		&log.EntityType,
		&entityID,
		&oldData,
		&newData,
		&ipAddress,
		&userAgent,
		&log.CreatedAt,
		&userIDValue,
		&userName,
		&userEmail,
		&orgID,
		&orgName,
	}
	if total != nil {
		dest = append([]any{total}, dest...)
	}

	if err := row.Scan(dest...); err != nil {
		return AuditLog{}, err
	}

	log.OrganizationID = textValue(organizationID)
	log.UserID = textValue(userID)
	log.EntityID = textValue(entityID)
	log.OldData = jsonMap(textValue(oldData))
	log.NewData = jsonMap(textValue(newData))
	log.IPAddress = textValue(ipAddress)
	log.UserAgent = textValue(userAgent)
	if userIDValue.Valid {
		log.User = &AuditUser{
			ID:    userIDValue.String,
			Name:  textValue(userName),
			Email: textValue(userEmail),
		}
	}
	if orgID.Valid {
		log.Organization = &AuditOrg{
			ID:   orgID.String,
			Name: textValue(orgName),
		}
	}

	return log, nil
}

func textValue(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func jsonMap(value string) map[string]any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(value), &out); err != nil {
		return nil
	}
	return out
}

func jsonb(value map[string]any) string {
	if value == nil {
		return "null"
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return "null"
	}
	return string(payload)
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}
