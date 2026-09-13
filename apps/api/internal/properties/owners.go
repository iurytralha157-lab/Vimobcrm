package properties

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Owner map[string]any

type OwnerInput struct {
	Name              string
	PhoneResidential  string
	PhoneCommercial   string
	Cellphone         string
	Email             string
	MediaSource       string
	NotifyEmail       bool
	Notes             string
	ExpectedUpdatedAt string
}

func (repo Repository) ListOwners(ctx context.Context, tenantContext tenant.Context) ([]Owner, error) {
	page, err := repo.ListOwnersPage(ctx, tenantContext, OwnerListFilter{
		Limit:     ownerPageDefaultLimit,
		Paginated: true,
	})
	if err != nil {
		return nil, err
	}
	return page.Items, nil
}

func (repo Repository) ListOwnersPage(ctx context.Context, tenantContext tenant.Context, filter OwnerListFilter) (OwnerPage, error) {
	if tenantContext.UserID == "" {
		return OwnerPage{Items: []Owner{}}, nil
	}
	if filter.Limit == 0 {
		filter.Limit = ownerPageDefaultLimit
	}
	filter.Paginated = true
	if filter.Limit < 1 || filter.Limit > ownerPageMaxLimit {
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
	queryLimit := filter.Limit + 1
	limitClause := "limit $12"
	args = append(
		args,
		canViewContacts,
		canManageProperties(tenantContext),
		filter.Search,
		hasCursor,
		cursor.NameKey,
		cursor.CreatedAt,
		cursor.ID,
	)
	args = append(args, queryLimit)

	rows, err := repo.db.Pool().Query(ctx, fmt.Sprintf(`
		with filtered_owners as (
			select
				po.*,
				lower(po.name) as owner_sort_name,
				count(*) over()::int as owner_total_count
			from public.property_owners po
			where po.organization_id = $1::uuid
			  and coalesce(po.is_active, true) = true
			  and %s
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
	`, propertyOwnerSearchClause("po", "$7", "$5"), ownerScope, limitClause, ownerPropertyAssociationSQL("p", "po"), propertyScope,
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
	if len(items) > filter.Limit {
		encoded, err := encodeOwnerCursor(cursors[filter.Limit-1])
		if err != nil {
			return OwnerPage{}, err
		}
		nextCursor = &encoded
		items = items[:filter.Limit]
	}
	return OwnerPage{Items: items, NextCursor: nextCursor, TotalCount: totalCount}, nil
}

func propertyOwnerSearchClause(alias string, searchPlaceholder string, canViewContactsPlaceholder string) string {
	return `(
		` + searchPlaceholder + `::text = ''
		or lower(coalesce(` + alias + `.name, '')) like '%' || lower(` + searchPlaceholder + `::text) || '%'
		or (
			` + canViewContactsPlaceholder + `::boolean
			and lower(
				coalesce(` + alias + `.phone_residential, '') || ' ' ||
				coalesce(` + alias + `.phone_commercial, '') || ' ' ||
				coalesce(` + alias + `.cellphone, '') || ' ' ||
				coalesce(` + alias + `.email, '') || ' ' ||
				coalesce(` + alias + `.media_source, '')
			) like '%' || lower(` + searchPlaceholder + `::text) || '%'
		)
	)`
}

func (repo Repository) CreateOwner(ctx context.Context, tenantContext tenant.Context, input OwnerInput) (Owner, error) {
	if !canCreatePropertyOwners(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	if err := validateOwnerInput(&input); err != nil {
		return nil, err
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	ownerID, err := resolveOrCreateInlinePropertyOwner(ctx, tx, tenantContext, input)
	if err != nil {
		return nil, err
	}
	owner, err := scanOwner(tx.QueryRow(ctx, `
		select `+workspaceOwnerProjection("po", "true", "true")+`::text
		from public.property_owners po
		where po.organization_id = $1::uuid and po.id = $2::uuid
	`, tenantContext.OrganizationID, ownerID))
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

	if err := validateOwnerInput(&input); err != nil {
		return nil, err
	}
	if err := validateRequiredWorkspaceTimestamp(input.ExpectedUpdatedAt, "expected_updated_at"); err != nil {
		return nil, err
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
	var currentUpdatedAt time.Time
	var currentName string
	if err := tx.QueryRow(ctx, `
		select updated_at, name
		from public.property_owners
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and coalesce(is_active, true)
		for update
	`, tenantContext.OrganizationID, ownerID).Scan(&currentUpdatedAt, &currentName); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrPropertyNotFound
		}
		return nil, err
	}
	if err := validateCatalogMutationVersion(currentUpdatedAt, input.ExpectedUpdatedAt); err != nil {
		return nil, err
	}
	if !strings.EqualFold(strings.TrimSpace(currentName), strings.TrimSpace(input.Name)) {
		var legacyNameInUse bool
		if err := tx.QueryRow(
			ctx,
			ownerLegacyNameInUseSQL(),
			tenantContext.OrganizationID,
			currentName,
			input.Name,
		).Scan(&legacyNameInUse); err != nil {
			return nil, err
		}
		if legacyNameInUse {
			return nil, ErrPropertyOwnerInUse
		}
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
		return nil, normalizeWorkspaceDatabaseError(err)
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
			origin_media = nullif($8, ''),
			owner_notify_email = $9,
			updated_at = now()
		where organization_id = $1::uuid
		  and owner_id = $2::uuid
	`, tenantContext.OrganizationID, ownerID, input.Name, input.PhoneResidential, input.PhoneCommercial, input.Cellphone, input.Email, input.MediaSource, input.NotifyEmail); err != nil {
		return nil, normalizeWorkspaceDatabaseError(err)
	}

	return owner, tx.Commit(ctx)
}

// DeactivateOwner keeps historical ownership data intact. A referenced owner
// must first be detached or have the active ownership period ended.
func (repo Repository) DeactivateOwner(ctx context.Context, tenantContext tenant.Context, ownerID string, expectedUpdatedAt string) error {
	if !canManageProperties(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	if err := validateRequiredWorkspaceTimestamp(expectedUpdatedAt, "expected_updated_at"); err != nil {
		return err
	}
	ownerID, ok := normalizeUUID(ownerID)
	if !ok {
		return ErrPropertyOwnerNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := lockWorkspaceOwner(ctx, tx, tenantContext.OrganizationID, ownerID); err != nil {
		return err
	}

	var currentUpdatedAt time.Time
	if err := tx.QueryRow(ctx, `
		select updated_at
		from public.property_owners
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and coalesce(is_active, true)
		for update
	`, tenantContext.OrganizationID, ownerID).Scan(&currentUpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPropertyOwnerNotFound
		}
		return err
	}
	if err := validateCatalogMutationVersion(currentUpdatedAt, expectedUpdatedAt); err != nil {
		return err
	}

	var inUse bool
	if err := tx.QueryRow(ctx, ownerDeactivationInUseSQL(), tenantContext.OrganizationID, ownerID).Scan(&inUse); err != nil {
		return err
	}
	if inUse {
		return ErrPropertyOwnerInUse
	}

	if _, err := tx.Exec(ctx, `
		update public.property_owners
		set is_active = false, updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, tenantContext.OrganizationID, ownerID); err != nil {
		return normalizeWorkspaceDatabaseError(err)
	}
	return tx.Commit(ctx)
}

func validateOwnerInput(input *OwnerInput) error {
	fields := []struct {
		name     string
		value    *string
		limit    int
		required bool
	}{
		{name: "name", value: &input.Name, limit: 160, required: true},
		{name: "phone_residential", value: &input.PhoneResidential, limit: 40},
		{name: "phone_commercial", value: &input.PhoneCommercial, limit: 40},
		{name: "cellphone", value: &input.Cellphone, limit: 40},
		{name: "email", value: &input.Email, limit: 160},
		{name: "media_source", value: &input.MediaSource, limit: 80},
		{name: "notes", value: &input.Notes, limit: 1200},
	}
	for _, field := range fields {
		value, err := validateBoundedOwnerText(*field.value, field.name, field.limit, field.required)
		if err != nil {
			return err
		}
		*field.value = value
	}
	if input.Email != "" {
		email, err := validateOwnerEmail(input.Email)
		if err != nil {
			return err
		}
		input.Email = email
	}
	if input.NotifyEmail && input.Email == "" {
		return fmt.Errorf("%w: owner email is required when notify_email is enabled", ErrInvalidInput)
	}
	return nil
}

func validateOwnerEmail(value string) (string, error) {
	address, err := mail.ParseAddress(value)
	if err != nil || !strings.EqualFold(address.Address, value) {
		return "", fmt.Errorf("%w: owner email is invalid", ErrInvalidInput)
	}
	return strings.ToLower(address.Address), nil
}

func validateBoundedOwnerText(value string, field string, limit int, required bool) (string, error) {
	value = strings.TrimSpace(value)
	if required && value == "" {
		return "", fmt.Errorf("%w: owner %s is required", ErrInvalidInput, field)
	}
	if len([]rune(value)) > limit {
		return "", fmt.Errorf("%w: owner %s must have at most %d characters", ErrInvalidInput, field, limit)
	}
	return value, nil
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

func ownerDeactivationInUseSQL() string {
	return `
		select (
			exists (
				select 1
				from public.properties property
				join public.property_owners owner
				  on owner.organization_id = property.organization_id
				 and owner.id = $2::uuid
				where property.organization_id = $1::uuid
				  and ` + ownerPropertyAssociationSQL("property", "owner") + `
				limit 1
			)
			or exists (
				select 1
				from public.property_ownerships scheduled_ownership
				where scheduled_ownership.organization_id = $1::uuid
				  and scheduled_ownership.owner_id = $2::uuid
				  and (scheduled_ownership.valid_to is null or current_date < scheduled_ownership.valid_to)
				limit 1
			)
		)
	`
}

func ownerLegacyNameInUseSQL() string {
	return `
		select exists (
			select 1
			from public.properties property
			where property.organization_id = $1::uuid
			  and property.owner_id is null
			  and nullif(trim(property.owner_name), '') is not null
			  and (
				lower(trim(property.owner_name)) = lower(trim($2))
				or lower(trim(property.owner_name)) = lower(trim($3))
			  )
			limit 1
		)
	`
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
