package properties

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Owner map[string]any

type OwnerInput struct {
	Name             string
	PhoneResidential string
	PhoneCommercial  string
	Cellphone        string
	Email            string
	MediaSource      string
	NotifyEmail      bool
	Notes            string
}

func (repo Repository) ListOwners(ctx context.Context, tenantContext tenant.Context) ([]Owner, error) {
	args := []any{tenantContext.OrganizationID}
	propertyScope := ""
	ownerScope := ""
	if !canManageProperties(tenantContext) {
		if tenantContext.UserID == "" {
			return []Owner{}, nil
		}
		args = append(args, tenantContext.UserID)
		userIndex := len(args)
		propertyScope = fmt.Sprintf(" and (p.responsible_user_id = $%d::uuid or p.created_by = $%d::uuid)", userIndex, userIndex)
		ownerScope = fmt.Sprintf(`
		  and exists (
			select 1
			from public.properties p_scope
			where p_scope.organization_id = po.organization_id
			  and (
				p_scope.owner_id = po.id
				or (
					p_scope.owner_id is null
					and nullif(trim(p_scope.owner_name), '') is not null
					and lower(trim(p_scope.owner_name)) = lower(trim(po.name))
				)
			  )
			  and (p_scope.responsible_user_id = $%d::uuid or p_scope.created_by = $%d::uuid)
		  )
		`, userIndex, userIndex)
	}

	rows, err := repo.db.Pool().Query(ctx, fmt.Sprintf(`
		select (
			to_jsonb(po)
			|| jsonb_build_object(
				'property_count', coalesce(property_totals.property_count, 0),
				'properties', coalesce(property_preview.properties, '[]'::jsonb)
			)
		)::text
		from public.property_owners po
		left join lateral (
			select count(*)::int as property_count
			from public.properties p
			where p.organization_id = po.organization_id
				  and (
					p.owner_id = po.id
					or (
						p.owner_id is null
						and nullif(trim(p.owner_name), '') is not null
						and lower(trim(p.owner_name)) = lower(trim(po.name))
					)
				  )
				  %s
		) property_totals on true
		left join lateral (
			select jsonb_agg(
				jsonb_build_object(
					'id', property_rows.id,
					'code', property_rows.code,
					'title', property_rows.title,
					'tipo_de_negocio', property_rows.tipo_de_negocio,
					'bairro', property_rows.bairro,
					'cidade', property_rows.cidade
				)
				order by property_rows.created_at desc, property_rows.id desc
			) as properties
			from (
				select
					p.id,
					p.code,
					p.title,
					p.tipo_de_negocio,
					p.bairro,
					p.cidade,
					p.created_at
				from public.properties p
				where p.organization_id = po.organization_id
				  and (
					p.owner_id = po.id
					or (
						p.owner_id is null
						and nullif(trim(p.owner_name), '') is not null
						and lower(trim(p.owner_name)) = lower(trim(po.name))
					)
				  )
				  %s
				order by p.created_at desc, p.id desc
				limit 3
			) property_rows
		) property_preview on true
		where po.organization_id = $1::uuid
		  and coalesce(po.is_active, true) = true
		  %s
		order by lower(po.name), po.created_at desc
	`, propertyScope, propertyScope, ownerScope), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []Owner{}
	for rows.Next() {
		item, err := scanOwner(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (repo Repository) CreateOwner(ctx context.Context, tenantContext tenant.Context, input OwnerInput) (Owner, error) {
	if !canCreatePropertyOwners(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	input.Name = trimMax(input.Name, 160)
	input.PhoneResidential = trimMax(input.PhoneResidential, 40)
	input.PhoneCommercial = trimMax(input.PhoneCommercial, 40)
	input.Cellphone = trimMax(input.Cellphone, 40)
	input.Email = strings.ToLower(trimMax(input.Email, 160))
	input.MediaSource = trimMax(input.MediaSource, 80)
	input.Notes = trimMax(input.Notes, 1200)
	if input.Name == "" {
		return nil, fmt.Errorf("%w: owner name is required", ErrInvalidInput)
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	lockKey := "owner:" + strings.ToLower(input.Name) + ":" + input.Cellphone + ":" + input.Email
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`, tenantContext.OrganizationID, lockKey); err != nil {
		return nil, err
	}

	owner, err := scanOwner(tx.QueryRow(ctx, `
		select to_jsonb(po)::text
		from public.property_owners po
		where po.organization_id = $1::uuid
		  and lower(po.name) = lower($2)
		  and coalesce(po.cellphone, '') = coalesce(nullif($3, ''), '')
		  and coalesce(po.email, '') = coalesce(nullif($4, ''), '')
		limit 1
	`, tenantContext.OrganizationID, input.Name, input.Cellphone, input.Email))
	if err == nil {
		return owner, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	owner, err = scanOwner(tx.QueryRow(ctx, `
		insert into public.property_owners (
			organization_id,
			name,
			phone_residential,
			phone_commercial,
			cellphone,
			email,
			media_source,
			notify_email,
			notes,
			created_by
		)
		values (
			$1::uuid,
			$2,
			nullif($3, ''),
			nullif($4, ''),
			nullif($5, ''),
			nullif($6, ''),
			nullif($7, ''),
			$8,
			nullif($9, ''),
			nullif($10, '')::uuid
		)
		returning to_jsonb(property_owners)::text
	`, tenantContext.OrganizationID, input.Name, input.PhoneResidential, input.PhoneCommercial, input.Cellphone, input.Email, input.MediaSource, input.NotifyEmail, input.Notes, tenantContext.UserID))
	if err != nil {
		return nil, err
	}

	return owner, tx.Commit(ctx)
}

func (repo Repository) UpdateOwner(ctx context.Context, tenantContext tenant.Context, ownerID string, input OwnerInput) (Owner, error) {
	ownerID, ok := normalizeUUID(ownerID)
	if !ok {
		return nil, ErrPropertyNotFound
	}

	input.Name = trimMax(input.Name, 160)
	input.PhoneResidential = trimMax(input.PhoneResidential, 40)
	input.PhoneCommercial = trimMax(input.PhoneCommercial, 40)
	input.Cellphone = trimMax(input.Cellphone, 40)
	input.Email = strings.ToLower(trimMax(input.Email, 160))
	input.MediaSource = trimMax(input.MediaSource, 80)
	input.Notes = trimMax(input.Notes, 1200)
	if input.Name == "" {
		return nil, fmt.Errorf("%w: owner name is required", ErrInvalidInput)
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	allowed, err := repo.canEditOwner(ctx, tx, tenantContext, ownerID)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	var owner Owner
	err = tx.QueryRow(ctx, `
		update public.property_owners
		set
			name = $3,
			phone_residential = nullif($4, ''),
			phone_commercial = nullif($5, ''),
			cellphone = nullif($6, ''),
			email = nullif($7, ''),
			media_source = nullif($8, ''),
			notify_email = $9,
			notes = nullif($10, ''),
			updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and coalesce(is_active, true) = true
		returning to_jsonb(property_owners)::text
	`, tenantContext.OrganizationID, ownerID, input.Name, input.PhoneResidential, input.PhoneCommercial, input.Cellphone, input.Email, input.MediaSource, input.NotifyEmail, input.Notes).Scan((*jsonTextOwner)(&owner))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPropertyNotFound
	}
	if err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		update public.properties
		set
			owner_name = $3,
			owner_phone_residential = nullif($4, ''),
			owner_phone_commercial = nullif($5, ''),
			owner_cellphone = nullif($6, ''),
			owner_email = nullif($7, ''),
			owner_media_source = nullif($8, ''),
			owner_notify_email = $9,
			updated_at = now()
		where organization_id = $1::uuid
		  and owner_id = $2::uuid
	`, tenantContext.OrganizationID, ownerID, input.Name, input.PhoneResidential, input.PhoneCommercial, input.Cellphone, input.Email, input.MediaSource, input.NotifyEmail); err != nil {
		return nil, err
	}

	return owner, tx.Commit(ctx)
}

func (repo Repository) canEditOwner(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, ownerID string) (bool, error) {
	if canManageProperties(tenantContext) {
		return true, nil
	}
	if tenantContext.UserID == "" {
		return false, nil
	}

	var exists bool
	err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.property_owners po
			join public.properties p
			  on p.organization_id = po.organization_id
			 and (
				p.owner_id = po.id
				or (
					p.owner_id is null
					and nullif(trim(p.owner_name), '') is not null
					and lower(trim(p.owner_name)) = lower(trim(po.name))
				)
			 )
			where po.organization_id = $1::uuid
			  and po.id = $2::uuid
			  and coalesce(po.is_active, true) = true
			  and (p.responsible_user_id = $3::uuid or p.created_by = $3::uuid)
		)
	`, tenantContext.OrganizationID, ownerID, tenantContext.UserID).Scan(&exists)
	return exists, err
}

func scanOwner(row scanner) (Owner, error) {
	var owner Owner
	if err := row.Scan((*jsonTextOwner)(&owner)); err != nil {
		return nil, err
	}
	return owner, nil
}

type jsonTextOwner Owner

func (owner *jsonTextOwner) Scan(value any) error {
	var raw string
	switch typed := value.(type) {
	case string:
		raw = typed
	case []byte:
		raw = string(typed)
	default:
		return fmt.Errorf("cannot scan owner json from %T", value)
	}

	out := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return err
	}
	*owner = jsonTextOwner(out)
	return nil
}
