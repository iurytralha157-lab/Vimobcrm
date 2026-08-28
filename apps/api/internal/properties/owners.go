package properties

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

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
	page, err := repo.ListOwnersPage(ctx, tenantContext, OwnerListFilter{})
	if err != nil {
		return nil, err
	}
	return page.Items, nil
}

func (repo Repository) ListOwnersPage(ctx context.Context, tenantContext tenant.Context, filter OwnerListFilter) (OwnerPage, error) {
	if tenantContext.UserID == "" {
		return OwnerPage{Items: []Owner{}}, nil
	}
	if filter.Paginated && (filter.Limit < 1 || filter.Limit > ownerPageMaxLimit) {
		return OwnerPage{}, fmt.Errorf("%w: owner page limit must be between 1 and %d", ErrInvalidInput, ownerPageMaxLimit)
	}

	args := []any{
		tenantContext.OrganizationID,
		canViewAllProperties(tenantContext),
		tenantContext.UserID,
		canViewTeamProperties(tenantContext),
	}
	propertyScope := " and " + propertyVisibilitySQL("$2", "$3", "$4", "p")
	ownerScope := ""
	if !canManageProperties(tenantContext) {
		ownerScope = `
		  and exists (
			select 1
			from public.properties p_scope
			where p_scope.organization_id = po.organization_id
			  and ` + ownerPropertyAssociationSQL("p_scope", "po") + `
			  and ` + propertyVisibilitySQL("$2", "$3", "$4", "p_scope") + `
		  )
		`
	}
	canViewContacts, err := repo.canViewPropertyOwnerContacts(ctx, tenantContext)
	if err != nil {
		return OwnerPage{}, err
	}

	hasCursor := filter.Cursor != nil
	cursor := ownerCursor{
		CreatedAt: time.Unix(0, 0).UTC(),
		ID:        "00000000-0000-0000-0000-000000000000",
	}
	if filter.Cursor != nil {
		cursor = *filter.Cursor
	}
	queryLimit := 1
	limitClause := ""
	if filter.Paginated {
		queryLimit = filter.Limit + 1
		limitClause = "limit $12"
	}
	args = append(
		args,
		canViewContacts,
		canManageProperties(tenantContext),
		filter.Search,
		hasCursor,
		cursor.NameKey,
		cursor.CreatedAt,
		cursor.ID,
		queryLimit,
	)

	rows, err := repo.db.Pool().Query(ctx, fmt.Sprintf(`
		with filtered_owners as (
			select
				po.*,
				lower(po.name) as owner_sort_name,
				count(*) over()::int as owner_total_count
			from public.property_owners po
			where po.organization_id = $1::uuid
			  and coalesce(po.is_active, true) = true
			  and (
				$7::text = ''
				or strpos(lower(po.name), lower($7::text)) > 0
				or (
					$5::boolean
					and strpos(
						lower(concat_ws(' ', po.phone_residential, po.phone_commercial, po.cellphone, po.email, po.media_source)),
						lower($7::text)
					) > 0
				)
			  )
			  %s
		), page_owners as materialized (
			select *
			from filtered_owners po
			where (
				not $8::boolean
				or po.owner_sort_name > $9::text
				or (po.owner_sort_name = $9::text and po.created_at < $10::timestamptz)
				or (po.owner_sort_name = $9::text and po.created_at = $10::timestamptz and po.id < $11::uuid)
			)
			order by po.owner_sort_name, po.created_at desc, po.id desc
			%s
		)
		select (
			`+workspaceOwnerProjection("po", "$5::boolean", "$6::boolean")+`
			|| jsonb_build_object(
				'property_count', coalesce(property_totals.property_count, 0),
				'properties', coalesce(property_preview.properties, '[]'::jsonb)
			)
		)::text,
		po.owner_sort_name,
		po.created_at,
		po.id::text,
		po.owner_total_count
		from page_owners po
		left join lateral (
			select count(*)::int as property_count
			from public.properties p
			where p.organization_id = po.organization_id
				  and %s
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
				  and %s
				  %s
				order by p.created_at desc, p.id desc
				limit 3
			) property_rows
		) property_preview on true
		order by po.owner_sort_name, po.created_at desc, po.id desc
	`, ownerScope, limitClause, ownerPropertyAssociationSQL("p", "po"), propertyScope,
		ownerPropertyAssociationSQL("p", "po"), propertyScope), args...)
	if err != nil {
		return OwnerPage{}, err
	}
	defer rows.Close()

	items := []Owner{}
	cursors := []ownerCursor{}
	totalCount := 0
	for rows.Next() {
		var item Owner
		var sortName string
		var createdAt time.Time
		var id string
		var rowTotalCount int
		if err := rows.Scan((*jsonTextOwner)(&item), &sortName, &createdAt, &id, &rowTotalCount); err != nil {
			return OwnerPage{}, err
		}
		if !canViewContacts {
			redactOwnerContacts(item)
		}
		items = append(items, item)
		cursors = append(cursors, ownerCursor{NameKey: sortName, CreatedAt: createdAt.UTC(), ID: id})
		if totalCount == 0 {
			totalCount = rowTotalCount
		}
	}
	if err := rows.Err(); err != nil {
		return OwnerPage{}, err
	}

	var nextCursor *string
	if filter.Paginated && len(items) > filter.Limit {
		encoded, err := encodeOwnerCursor(cursors[filter.Limit-1])
		if err != nil {
			return OwnerPage{}, err
		}
		nextCursor = &encoded
		items = items[:filter.Limit]
	}
	if !filter.Paginated {
		totalCount = len(items)
	}

	return OwnerPage{Items: items, NextCursor: nextCursor, TotalCount: totalCount}, nil
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
		select `+workspaceOwnerProjection("po", "true", "true")+`::text
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
		returning `+workspaceOwnerProjection("property_owners", "true", "true")+`::text
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
	if err := lockWorkspaceOwner(ctx, tx, tenantContext.OrganizationID, ownerID); err != nil {
		return nil, err
	}

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
		returning `+workspaceOwnerProjection("property_owners", "true", "true")+`::text
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

func ownerPropertyAssociationSQL(propertyAlias string, ownerAlias string) string {
	return `(
		` + propertyAlias + `.owner_id = ` + ownerAlias + `.id
		or exists (
			select 1
			from public.property_ownerships as normalized_ownership
			where normalized_ownership.organization_id = ` + propertyAlias + `.organization_id
			  and normalized_ownership.property_id = ` + propertyAlias + `.id
			  and normalized_ownership.owner_id = ` + ownerAlias + `.id
			  and normalized_ownership.valid_from <= current_date
			  and (normalized_ownership.valid_to is null or current_date < normalized_ownership.valid_to)
		)
		or (
			` + propertyAlias + `.owner_id is null
			and nullif(trim(` + propertyAlias + `.owner_name), '') is not null
			and lower(trim(` + propertyAlias + `.owner_name)) = lower(trim(` + ownerAlias + `.name))
		)
	)`
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
			 and `+ownerPropertyAssociationSQL("p", "po")+`
			where po.organization_id = $1::uuid
			  and po.id = $2::uuid
			  and coalesce(po.is_active, true) = true
			  and `+propertyVisibilitySQL("$4", "$3", "$5", "p")+`
		)
	`, tenantContext.OrganizationID, ownerID, tenantContext.UserID,
		canViewAllProperties(tenantContext), canViewTeamProperties(tenantContext)).Scan(&exists)
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
