package properties

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	pathpkg "path"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) CreatePropertyOwnership(ctx context.Context, tenantContext tenant.Context, propertyID string, input CreatePropertyOwnershipInput) (map[string]any, error) {
	if !canManageProperties(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return nil, ErrPropertyNotFound
	}
	if err := input.Validate(); err != nil {
		return nil, err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	ownerID := ""
	if input.OwnerID != nil {
		ownerID = *input.OwnerID
		if err := lockWorkspaceOwner(ctx, tx, tenantContext.OrganizationID, ownerID); err != nil {
			return nil, err
		}
	} else {
		ownerID, err = createWorkspaceOwner(ctx, tx, tenantContext, *input.NewOwner)
		if err != nil {
			return nil, err
		}
		if err := lockWorkspaceOwner(ctx, tx, tenantContext.OrganizationID, ownerID); err != nil {
			return nil, err
		}
	}
	if err := lockWorkspaceProperty(ctx, tx, tenantContext.OrganizationID, propertyID); err != nil {
		return nil, err
	}
	if input.OwnerID != nil {
		var active bool
		err = tx.QueryRow(ctx, `
			select coalesce(owner.is_active, true)
			from public.property_owners as owner
			where owner.organization_id = $1::uuid and owner.id = $2::uuid
			for update of owner
		`, tenantContext.OrganizationID, ownerID).Scan(&active)
		if errors.Is(err, pgx.ErrNoRows) || !active {
			return nil, ErrPropertyOwnerNotFound
		}
		if err != nil {
			return nil, err
		}
	}

	if input.IsPrimary {
		if err := closeOverlappingPrimaryOwnerships(ctx, tx, tenantContext.OrganizationID, propertyID, input.ValidFrom, ""); err != nil {
			return nil, err
		}
	}

	item, err := scanWorkspaceObject(tx.QueryRow(ctx, `
		with inserted as (
			insert into public.property_ownerships (
				organization_id, property_id, owner_id, ownership_percentage,
				is_primary, valid_from, notes, created_by
			)
			values (
				$1::uuid, $2::uuid, $3::uuid, $4::numeric,
				$5::boolean, $6::date, nullif($7, ''), nullif($8, '')::uuid
			)
			returning *
		)
		select `+workspaceOwnershipProjection("ownership", "owner", "true", "true")+`::text
		from inserted as ownership
		join public.property_owners as owner
		  on owner.organization_id = ownership.organization_id and owner.id = ownership.owner_id
	`, tenantContext.OrganizationID, propertyID, ownerID, input.OwnershipPercentage,
		input.IsPrimary, input.ValidFrom, nullableWorkspaceString(input.Notes), tenantContext.UserID))
	if err != nil {
		return nil, normalizeWorkspaceDatabaseError(err)
	}
	if err := syncLegacyPropertyOwnerProjection(ctx, tx, tenantContext.OrganizationID, propertyID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return item, nil
}

func (repo Repository) UpdatePropertyOwnership(ctx context.Context, tenantContext tenant.Context, propertyID string, ownershipID string, input UpdatePropertyOwnershipInput) (map[string]any, error) {
	if !canManageProperties(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return nil, ErrPropertyNotFound
	}
	ownershipID, ok = normalizeUUID(ownershipID)
	if !ok {
		return nil, ErrPropertyOwnershipNotFound
	}
	if err := input.Validate(); err != nil {
		return nil, err
	}

	preloadedOwnerID := ""
	if input.Owner != nil {
		err := repo.db.Pool().QueryRow(ctx, `
			select ownership.owner_id::text
			from public.property_ownerships as ownership
			where ownership.organization_id = $1::uuid
			  and ownership.property_id = $2::uuid
			  and ownership.id = $3::uuid
		`, tenantContext.OrganizationID, propertyID, ownershipID).Scan(&preloadedOwnerID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrPropertyOwnershipNotFound
		}
		if err != nil {
			return nil, err
		}
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if preloadedOwnerID != "" {
		if err := lockWorkspaceOwner(ctx, tx, tenantContext.OrganizationID, preloadedOwnerID); err != nil {
			return nil, err
		}
	}
	if err := lockWorkspaceProperty(ctx, tx, tenantContext.OrganizationID, propertyID); err != nil {
		return nil, err
	}

	var ownerID, currentUpdatedAt string
	err = tx.QueryRow(ctx, `
		select ownership.owner_id::text, ownership.updated_at::text
		from public.property_ownerships as ownership
		where ownership.organization_id = $1::uuid
		  and ownership.property_id = $2::uuid
		  and ownership.id = $3::uuid
		for update of ownership
	`, tenantContext.OrganizationID, propertyID, ownershipID).Scan(&ownerID, &currentUpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPropertyOwnershipNotFound
	}
	if err != nil {
		return nil, err
	}
	if preloadedOwnerID != "" && ownerID != preloadedOwnerID {
		return nil, ErrPropertyWorkspaceConflict
	}
	if !workspaceTimestampsEqual(currentUpdatedAt, input.ExpectedUpdatedAt) {
		return nil, ErrPropertyWorkspaceConflict
	}

	if input.Owner != nil {
		command, err := tx.Exec(ctx, `
			update public.property_owners as owner
			set name = $3,
				phone_residential = nullif($4, ''),
				phone_commercial = nullif($5, ''),
				cellphone = nullif($6, ''),
				email = nullif($7, ''),
				media_source = nullif($8, ''),
				notify_email = $9::boolean,
				notes = nullif($10, ''),
				updated_at = now()
			where owner.organization_id = $1::uuid
			  and owner.id = $2::uuid
			  and coalesce(owner.is_active, true)
			  and owner.updated_at = $11::timestamptz
		`, tenantContext.OrganizationID, ownerID, input.Owner.Name,
			nullableWorkspaceString(input.Owner.PhoneResidential), nullableWorkspaceString(input.Owner.PhoneCommercial),
			nullableWorkspaceString(input.Owner.Cellphone), nullableWorkspaceString(input.Owner.Email),
			nullableWorkspaceString(input.Owner.MediaSource), input.Owner.NotifyEmail,
			nullableWorkspaceString(input.Owner.Notes), input.Owner.ExpectedUpdatedAt)
		if err != nil {
			return nil, normalizeWorkspaceDatabaseError(err)
		}
		if command.RowsAffected() != 1 {
			return nil, ErrPropertyWorkspaceConflict
		}
		if err := syncLegacyOwnerDetails(ctx, tx, tenantContext.OrganizationID, ownerID); err != nil {
			return nil, err
		}
	}

	if input.IsPrimary {
		if err := closeOverlappingPrimaryOwnerships(ctx, tx, tenantContext.OrganizationID, propertyID, input.ValidFrom, ownershipID); err != nil {
			return nil, err
		}
	}

	command, err := tx.Exec(ctx, `
		update public.property_ownerships as ownership
		set ownership_percentage = $4::numeric,
			is_primary = $5::boolean,
			valid_from = $6::date,
			notes = nullif($7, ''),
			updated_at = now()
		where ownership.organization_id = $1::uuid
		  and ownership.property_id = $2::uuid
		  and ownership.id = $3::uuid
		  and ownership.updated_at = $8::timestamptz
	`, tenantContext.OrganizationID, propertyID, ownershipID, input.OwnershipPercentage,
		input.IsPrimary, input.ValidFrom, nullableWorkspaceString(input.Notes), input.ExpectedUpdatedAt)
	if err != nil {
		return nil, normalizeWorkspaceDatabaseError(err)
	}
	if command.RowsAffected() != 1 {
		return nil, ErrPropertyWorkspaceConflict
	}
	if err := syncLegacyPropertyOwnerProjection(ctx, tx, tenantContext.OrganizationID, propertyID); err != nil {
		return nil, err
	}
	item, err := getWorkspaceOwnership(ctx, tx, tenantContext.OrganizationID, propertyID, ownershipID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return item, nil
}

func (repo Repository) EndPropertyOwnership(ctx context.Context, tenantContext tenant.Context, propertyID string, ownershipID string, input EndPropertyOwnershipInput) (map[string]any, error) {
	if !canManageProperties(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return nil, ErrPropertyNotFound
	}
	ownershipID, ok = normalizeUUID(ownershipID)
	if !ok {
		return nil, ErrPropertyOwnershipNotFound
	}
	if err := input.Validate(); err != nil {
		return nil, err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := lockWorkspaceProperty(ctx, tx, tenantContext.OrganizationID, propertyID); err != nil {
		return nil, err
	}
	var validFrom, validTo, currentUpdatedAt string
	err = tx.QueryRow(ctx, `
		select ownership.valid_from::text, coalesce(ownership.valid_to::text, ''), ownership.updated_at::text
		from public.property_ownerships as ownership
		where ownership.organization_id = $1::uuid
		  and ownership.property_id = $2::uuid
		  and ownership.id = $3::uuid
		for update of ownership
	`, tenantContext.OrganizationID, propertyID, ownershipID).Scan(&validFrom, &validTo, &currentUpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPropertyOwnershipNotFound
	}
	if err != nil {
		return nil, err
	}
	if validTo == input.ValidTo {
		item, err := getWorkspaceOwnership(ctx, tx, tenantContext.OrganizationID, propertyID, ownershipID)
		if err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return item, nil
	}
	if input.ValidTo <= validFrom {
		return nil, fmt.Errorf("%w: valid_to must be after valid_from", ErrInvalidInput)
	}
	if !workspaceTimestampsEqual(currentUpdatedAt, input.ExpectedUpdatedAt) {
		return nil, ErrPropertyWorkspaceConflict
	}
	command, err := tx.Exec(ctx, `
		update public.property_ownerships as ownership
		set valid_to = $4::date, updated_at = now()
		where ownership.organization_id = $1::uuid
		  and ownership.property_id = $2::uuid
		  and ownership.id = $3::uuid
		  and ownership.updated_at = $5::timestamptz
	`, tenantContext.OrganizationID, propertyID, ownershipID, input.ValidTo, input.ExpectedUpdatedAt)
	if err != nil {
		return nil, normalizeWorkspaceDatabaseError(err)
	}
	if command.RowsAffected() != 1 {
		return nil, ErrPropertyWorkspaceConflict
	}
	if err := syncLegacyPropertyOwnerProjection(ctx, tx, tenantContext.OrganizationID, propertyID); err != nil {
		return nil, err
	}
	item, err := getWorkspaceOwnership(ctx, tx, tenantContext.OrganizationID, propertyID, ownershipID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return item, nil
}

func createWorkspaceOwner(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, input PropertyOwnerDetailsInput) (string, error) {
	lockKey := "owner:" + strings.ToLower(input.Name) + ":" + nullableWorkspaceString(input.Cellphone) + ":" + nullableWorkspaceString(input.Email)
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`, tenantContext.OrganizationID, lockKey); err != nil {
		return "", err
	}
	var ownerID string
	err := tx.QueryRow(ctx, `
		select owner.id::text
		from public.property_owners as owner
		where owner.organization_id = $1::uuid
		  and coalesce(owner.is_active, true)
		  and lower(owner.name) = lower($2)
		  and coalesce(owner.cellphone, '') = $3
		  and coalesce(owner.email, '') = $4
		limit 1
		for update of owner
	`, tenantContext.OrganizationID, input.Name, nullableWorkspaceString(input.Cellphone), nullableWorkspaceString(input.Email)).Scan(&ownerID)
	if err == nil {
		return ownerID, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	err = tx.QueryRow(ctx, `
		insert into public.property_owners (
			organization_id, name, phone_residential, phone_commercial, cellphone,
			email, media_source, notify_email, notes, created_by
		)
		values (
			$1::uuid, $2, nullif($3, ''), nullif($4, ''), nullif($5, ''),
			nullif($6, ''), nullif($7, ''), $8::boolean, nullif($9, ''), nullif($10, '')::uuid
		)
		returning id::text
	`, tenantContext.OrganizationID, input.Name, nullableWorkspaceString(input.PhoneResidential),
		nullableWorkspaceString(input.PhoneCommercial), nullableWorkspaceString(input.Cellphone),
		nullableWorkspaceString(input.Email), nullableWorkspaceString(input.MediaSource),
		input.NotifyEmail, nullableWorkspaceString(input.Notes), tenantContext.UserID).Scan(&ownerID)
	return ownerID, err
}

func lockWorkspaceOwner(ctx context.Context, tx pgx.Tx, organizationID string, ownerID string) error {
	_, err := tx.Exec(ctx, `
		select pg_advisory_xact_lock(hashtext($1), hashtext($2))
	`, organizationID, "property-owner:"+ownerID)
	return err
}

func closeOverlappingPrimaryOwnerships(ctx context.Context, tx pgx.Tx, organizationID string, propertyID string, validFrom string, excludeID string) error {
	rows, err := tx.Query(ctx, `
		select ownership.id::text, ownership.owner_id::text,
			ownership.ownership_percentage::float8, ownership.valid_from::text,
			coalesce(ownership.valid_to::text, ''), coalesce(ownership.notes, ''),
			coalesce(ownership.created_by::text, '')
		from public.property_ownerships as ownership
		where ownership.organization_id = $1::uuid
		  and ownership.property_id = $2::uuid
		  and ownership.is_primary
		  and (ownership.valid_to is null or ownership.valid_to > $3::date)
		  and (nullif($4, '') is null or ownership.id <> nullif($4, '')::uuid)
		order by ownership.id
		for update of ownership
	`, organizationID, propertyID, validFrom, excludeID)
	if err != nil {
		return err
	}
	type primaryRow struct {
		id, ownerID, validFrom, validTo, notes, createdBy string
		percentage                                        float64
	}
	primaries := []primaryRow{}
	for rows.Next() {
		var row primaryRow
		if err := rows.Scan(&row.id, &row.ownerID, &row.percentage, &row.validFrom, &row.validTo, &row.notes, &row.createdBy); err != nil {
			rows.Close()
			return err
		}
		primaries = append(primaries, row)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, primary := range primaries {
		if primary.validFrom < validFrom {
			if _, err := tx.Exec(ctx, `
				update public.property_ownerships
				set valid_to = $3::date, updated_at = now()
				where organization_id = $1::uuid and id = $2::uuid
			`, organizationID, primary.id, validFrom); err != nil {
				return normalizeWorkspaceDatabaseError(err)
			}
			if _, err := tx.Exec(ctx, `
				insert into public.property_ownerships (
					organization_id, property_id, owner_id, ownership_percentage,
					is_primary, valid_from, valid_to, notes, created_by
				)
				values (
					$1::uuid, $2::uuid, $3::uuid, $4::numeric,
					false, $5::date, nullif($6, '')::date, nullif($7, ''), nullif($8, '')::uuid
				)
			`, organizationID, propertyID, primary.ownerID, primary.percentage,
				validFrom, primary.validTo, primary.notes, primary.createdBy); err != nil {
				return normalizeWorkspaceDatabaseError(err)
			}
			continue
		}
		if _, err := tx.Exec(ctx, `
			update public.property_ownerships
			set is_primary = false, updated_at = now()
			where organization_id = $1::uuid and id = $2::uuid
		`, organizationID, primary.id); err != nil {
			return normalizeWorkspaceDatabaseError(err)
		}
	}
	return nil
}

func syncLegacyPropertyOwnerProjection(ctx context.Context, tx pgx.Tx, organizationID string, propertyID string) error {
	_, err := tx.Exec(ctx, `
		with selected_owner as (
			select owner.id, owner.name, owner.phone_residential, owner.phone_commercial,
				owner.cellphone, owner.email, owner.media_source, owner.notify_email
			from public.property_ownerships as ownership
			join public.property_owners as owner
			  on owner.organization_id = ownership.organization_id and owner.id = ownership.owner_id
			where ownership.organization_id = $1::uuid
			  and ownership.property_id = $2::uuid
			  and ownership.valid_from <= current_date
			  and (ownership.valid_to is null or current_date < ownership.valid_to)
			  and coalesce(owner.is_active, true)
			order by ownership.is_primary desc, ownership.valid_from desc, ownership.updated_at desc, ownership.id
			limit 1
		), projection as (
			select selected_owner.* from selected_owner
			union all
			select null::uuid, null::text, null::text, null::text, null::text,
				null::text, null::text, false
			where not exists (select 1 from selected_owner)
		)
		update public.properties as property
		set owner_id = projection.id,
			owner_name = projection.name,
			owner_phone_residential = projection.phone_residential,
			owner_phone_commercial = projection.phone_commercial,
			owner_cellphone = projection.cellphone,
			owner_email = projection.email,
			owner_media_source = projection.media_source,
			owner_notify_email = projection.notify_email,
			updated_at = now()
		from projection
		where property.organization_id = $1::uuid
		  and property.id = $2::uuid
		  and (property.owner_id, property.owner_name, property.owner_phone_residential,
			property.owner_phone_commercial, property.owner_cellphone, property.owner_email,
			property.owner_media_source, property.owner_notify_email)
		  is distinct from
		  (projection.id, projection.name, projection.phone_residential,
			projection.phone_commercial, projection.cellphone, projection.email,
			projection.media_source, projection.notify_email)
	`, organizationID, propertyID)
	return err
}

func syncLegacyOwnerDetails(ctx context.Context, tx pgx.Tx, organizationID string, ownerID string) error {
	_, err := tx.Exec(ctx, `
		update public.properties as property
		set owner_name = owner.name,
			owner_phone_residential = owner.phone_residential,
			owner_phone_commercial = owner.phone_commercial,
			owner_cellphone = owner.cellphone,
			owner_email = owner.email,
			owner_media_source = owner.media_source,
			owner_notify_email = owner.notify_email,
			updated_at = now()
		from public.property_owners as owner
		where property.organization_id = $1::uuid
		  and property.owner_id = $2::uuid
		  and owner.organization_id = property.organization_id
		  and owner.id = property.owner_id
	`, organizationID, ownerID)
	return err
}

func getWorkspaceOwnership(ctx context.Context, queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, organizationID string, propertyID string, ownershipID string) (map[string]any, error) {
	item, err := scanWorkspaceObject(queryer.QueryRow(ctx, `
		select `+workspaceOwnershipProjection("ownership", "owner", "true", "true")+`::text
		from public.property_ownerships as ownership
		join public.property_owners as owner
		  on owner.organization_id = ownership.organization_id and owner.id = ownership.owner_id
		where ownership.organization_id = $1::uuid
		  and ownership.property_id = $2::uuid
		  and ownership.id = $3::uuid
	`, organizationID, propertyID, ownershipID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPropertyOwnershipNotFound
	}
	return item, err
}

func (repo Repository) CreatePropertyAsset(ctx context.Context, tenantContext tenant.Context, propertyID string, input CreatePropertyAssetInput) (map[string]any, error) {
	if !canManageProperties(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return nil, ErrPropertyNotFound
	}
	if err := input.Validate(tenantContext.OrganizationID, propertyID); err != nil {
		return nil, err
	}
	if input.StoragePath != nil {
		if err := repo.verifyStoredPropertyAsset(ctx, &input); err != nil {
			return nil, err
		}
	}
	metadataJSON, err := json.Marshal(input.Metadata)
	if err != nil {
		return nil, fmt.Errorf("%w: metadata is invalid", ErrInvalidInput)
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := lockWorkspaceProperty(ctx, tx, tenantContext.OrganizationID, propertyID); err != nil {
		return nil, err
	}
	if input.IsPrimary {
		if err := clearOtherPrimaryPhotos(ctx, tx, tenantContext.OrganizationID, propertyID, ""); err != nil {
			return nil, err
		}
	}
	assetID := ""
	if input.StoragePath != nil {
		assetID, _ = propertyAssetIDFromStoragePath(*input.StoragePath, tenantContext.OrganizationID, propertyID)
	}
	item, err := scanWorkspaceObject(tx.QueryRow(ctx, `
		insert into public.property_assets (
			id, organization_id, property_id, asset_type, visibility, storage_path,
			external_url, title, description, file_name, mime_type, file_size_bytes,
			sort_order, is_primary, document_category, expires_at, metadata, created_by
		)
		values (
			coalesce(nullif($18, '')::uuid, gen_random_uuid()),
			$1::uuid, $2::uuid, $3, $4, nullif($5, ''),
			nullif($6, ''), nullif($7, ''), nullif($8, ''), nullif($9, ''), nullif($10, ''), $11::bigint,
			$12::integer, $13::boolean, nullif($14, ''), nullif($15, '')::date, $16::jsonb, nullif($17, '')::uuid
		)
		returning `+workspaceAssetProjection("property_assets", "true")+`::text
	`, tenantContext.OrganizationID, propertyID, input.AssetType, input.Visibility,
		nullableWorkspaceString(input.StoragePath), nullableWorkspaceString(input.ExternalURL),
		nullableWorkspaceString(input.Title), nullableWorkspaceString(input.Description),
		nullableWorkspaceString(input.FileName), nullableWorkspaceString(input.MIMEType), input.FileSizeBytes,
		input.SortOrder, input.IsPrimary, nullableWorkspaceString(input.DocumentCategory),
		nullableWorkspaceString(input.ExpiresAt), string(metadataJSON), tenantContext.UserID, assetID))
	if err != nil {
		return nil, normalizeWorkspaceDatabaseError(err)
	}
	if input.IsPrimary {
		if err := syncLegacyPropertyPrimaryPhoto(ctx, tx, tenantContext.OrganizationID, propertyID, "", true); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return item, nil
}

func (repo Repository) UpdatePropertyAsset(ctx context.Context, tenantContext tenant.Context, propertyID string, assetID string, input UpdatePropertyAssetInput) (map[string]any, error) {
	if !canManageProperties(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return nil, ErrPropertyNotFound
	}
	assetID, ok = normalizeUUID(assetID)
	if !ok {
		return nil, ErrPropertyAssetNotFound
	}
	if err := input.Validate(); err != nil {
		return nil, err
	}

	// Storage verification is deliberately outside the database transaction.
	// The version is checked again after locking, so a concurrent change cannot
	// make this preflight overwrite a newer asset representation.
	current, err := repo.getWorkspaceAsset(ctx, repo.db.Pool(), tenantContext.OrganizationID, propertyID, assetID, false)
	if err != nil {
		return nil, err
	}
	target, err := mergePropertyAssetInput(current, input, tenantContext.OrganizationID, propertyID)
	if err != nil {
		return nil, err
	}
	// MIME and size stored for a private object are always re-derived from
	// Storage. Client-supplied metadata is never accepted as publication proof,
	// even when the locator itself did not change.
	if target.StoragePath != nil {
		if err := repo.verifyStoredPropertyAsset(ctx, &target); err != nil {
			return nil, err
		}
	}
	verifiedTarget := target
	metadataJSON, err := json.Marshal(target.Metadata)
	if err != nil {
		return nil, fmt.Errorf("%w: metadata is invalid", ErrInvalidInput)
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := lockWorkspaceProperty(ctx, tx, tenantContext.OrganizationID, propertyID); err != nil {
		return nil, err
	}
	current, err = repo.getWorkspaceAsset(ctx, tx, tenantContext.OrganizationID, propertyID, assetID, true)
	if err != nil {
		return nil, err
	}
	if !workspaceTimestampsEqual(workspaceString(current, "updated_at"), input.ExpectedUpdatedAt) {
		return nil, ErrPropertyWorkspaceConflict
	}
	target, err = mergePropertyAssetInput(current, input, tenantContext.OrganizationID, propertyID)
	if err != nil {
		return nil, err
	}
	if target.StoragePath != nil {
		if verifiedTarget.StoragePath == nil || *verifiedTarget.StoragePath != *target.StoragePath {
			return nil, ErrPropertyWorkspaceConflict
		}
		target.MIMEType = verifiedTarget.MIMEType
		target.FileSizeBytes = verifiedTarget.FileSizeBytes
	}
	if publishedAssetRepresentationChanged(current, target) {
		referenced, err := propertyAssetReferencedByPublishedVersion(
			ctx, tx, tenantContext.OrganizationID, propertyID, assetID,
		)
		if err != nil {
			return nil, err
		}
		if referenced {
			return nil, ErrPropertyAssetPublished
		}
	}
	oldExternalURL := workspaceString(current, "external_url")
	command, err := tx.Exec(ctx, `
		update public.property_assets as asset
		set asset_type = $4,
			visibility = $5,
			storage_path = nullif($6, ''),
			external_url = nullif($7, ''),
			title = nullif($8, ''),
			description = nullif($9, ''),
			file_name = nullif($10, ''),
			mime_type = nullif($11, ''),
			file_size_bytes = $12::bigint,
			document_category = nullif($13, ''),
			expires_at = nullif($14, '')::date,
			metadata = $15::jsonb,
			updated_at = now()
		where asset.organization_id = $1::uuid
		  and asset.property_id = $2::uuid
		  and asset.id = $3::uuid
		  and asset.updated_at = $16::timestamptz
	`, tenantContext.OrganizationID, propertyID, assetID, target.AssetType, target.Visibility,
		nullableWorkspaceString(target.StoragePath), nullableWorkspaceString(target.ExternalURL),
		nullableWorkspaceString(target.Title), nullableWorkspaceString(target.Description),
		nullableWorkspaceString(target.FileName), nullableWorkspaceString(target.MIMEType), target.FileSizeBytes,
		nullableWorkspaceString(target.DocumentCategory), nullableWorkspaceString(target.ExpiresAt),
		string(metadataJSON), input.ExpectedUpdatedAt)
	if err != nil {
		return nil, normalizeWorkspaceDatabaseError(err)
	}
	if command.RowsAffected() != 1 {
		return nil, ErrPropertyWorkspaceConflict
	}
	if workspaceString(current, "asset_type") == "photo" || target.AssetType == "photo" {
		if err := syncLegacyPropertyPrimaryPhoto(ctx, tx, tenantContext.OrganizationID, propertyID, oldExternalURL, workspaceBool(current, "is_primary")); err != nil {
			return nil, err
		}
	}
	item, err := repo.getWorkspaceAsset(ctx, tx, tenantContext.OrganizationID, propertyID, assetID, false)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return item, nil
}

func (repo Repository) ReorderPropertyAssets(ctx context.Context, tenantContext tenant.Context, propertyID string, input ReorderPropertyAssetsInput) ([]map[string]any, error) {
	if !canManageProperties(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return nil, ErrPropertyNotFound
	}
	if err := input.Validate(); err != nil {
		return nil, err
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := lockWorkspaceProperty(ctx, tx, tenantContext.OrganizationID, propertyID); err != nil {
		return nil, err
	}

	ordered := append([]PropertyAssetOrderItem(nil), input.Items...)
	sort.Slice(ordered, func(left, right int) bool { return ordered[left].ID < ordered[right].ID })
	ids := make([]string, len(ordered))
	for index := range ordered {
		ids[index] = ordered[index].ID
	}
	rows, err := tx.Query(ctx, `
		select asset.id::text, asset.updated_at::text
		from public.property_assets as asset
		where asset.organization_id = $1::uuid
		  and asset.property_id = $2::uuid
		  and asset.id = any($3::uuid[])
		order by asset.id
		for update of asset
	`, tenantContext.OrganizationID, propertyID, ids)
	if err != nil {
		return nil, err
	}
	versions := map[string]string{}
	for rows.Next() {
		var id, updatedAt string
		if err := rows.Scan(&id, &updatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		versions[id] = updatedAt
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(versions) != len(ordered) {
		return nil, ErrPropertyAssetNotFound
	}
	for _, item := range ordered {
		if !workspaceTimestampsEqual(versions[item.ID], item.ExpectedUpdatedAt) {
			return nil, ErrPropertyWorkspaceConflict
		}
	}
	for _, item := range ordered {
		command, err := tx.Exec(ctx, `
			update public.property_assets as asset
			set sort_order = $4::integer, updated_at = now()
			where asset.organization_id = $1::uuid
			  and asset.property_id = $2::uuid
			  and asset.id = $3::uuid
			  and asset.updated_at = $5::timestamptz
		`, tenantContext.OrganizationID, propertyID, item.ID, item.SortOrder, item.ExpectedUpdatedAt)
		if err != nil {
			return nil, normalizeWorkspaceDatabaseError(err)
		}
		if command.RowsAffected() != 1 {
			return nil, ErrPropertyWorkspaceConflict
		}
	}
	result := make([]map[string]any, 0, len(input.Items))
	for _, item := range input.Items {
		asset, err := repo.getWorkspaceAsset(ctx, tx, tenantContext.OrganizationID, propertyID, item.ID, false)
		if err != nil {
			return nil, err
		}
		result = append(result, asset)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return result, nil
}

func (repo Repository) SetPrimaryPropertyAsset(ctx context.Context, tenantContext tenant.Context, propertyID string, assetID string, input SetPrimaryPropertyAssetInput) ([]map[string]any, error) {
	if !canManageProperties(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return nil, ErrPropertyNotFound
	}
	assetID, ok = normalizeUUID(assetID)
	if !ok {
		return nil, ErrPropertyAssetNotFound
	}
	if err := input.Validate(); err != nil {
		return nil, err
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := lockWorkspaceProperty(ctx, tx, tenantContext.OrganizationID, propertyID); err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `
		select asset.id::text, asset.asset_type, asset.is_primary, asset.updated_at::text
		from public.property_assets as asset
		where asset.organization_id = $1::uuid and asset.property_id = $2::uuid
		order by asset.id
		for update of asset
	`, tenantContext.OrganizationID, propertyID)
	if err != nil {
		return nil, err
	}
	targetFound, targetPrimary := false, false
	targetVersion := ""
	for rows.Next() {
		var id, assetType, updatedAt string
		var isPrimary bool
		if err := rows.Scan(&id, &assetType, &isPrimary, &updatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		if id == assetID {
			targetFound, targetPrimary, targetVersion = true, isPrimary, updatedAt
			if assetType != "photo" {
				rows.Close()
				return nil, fmt.Errorf("%w: only photos can be primary", ErrInvalidInput)
			}
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if !targetFound {
		return nil, ErrPropertyAssetNotFound
	}
	if !workspaceTimestampsEqual(targetVersion, input.ExpectedUpdatedAt) {
		return nil, ErrPropertyWorkspaceConflict
	}
	if !targetPrimary {
		if err := clearOtherPrimaryPhotos(ctx, tx, tenantContext.OrganizationID, propertyID, assetID); err != nil {
			return nil, err
		}
		command, err := tx.Exec(ctx, `
			update public.property_assets as asset
			set is_primary = true, updated_at = now()
			where asset.organization_id = $1::uuid
			  and asset.property_id = $2::uuid
			  and asset.id = $3::uuid
			  and asset.updated_at = $4::timestamptz
		`, tenantContext.OrganizationID, propertyID, assetID, input.ExpectedUpdatedAt)
		if err != nil {
			return nil, normalizeWorkspaceDatabaseError(err)
		}
		if command.RowsAffected() != 1 {
			return nil, ErrPropertyWorkspaceConflict
		}
	}
	if err := syncLegacyPropertyPrimaryPhoto(ctx, tx, tenantContext.OrganizationID, propertyID, "", true); err != nil {
		return nil, err
	}
	items, err := listWorkspaceAssets(ctx, tx, tenantContext.OrganizationID, propertyID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return items, nil
}

func (repo Repository) DeletePropertyAsset(ctx context.Context, tenantContext tenant.Context, propertyID string, assetID string, input DeletePropertyAssetInput) (map[string]string, error) {
	if !canManageProperties(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return nil, ErrPropertyNotFound
	}
	assetID, ok = normalizeUUID(assetID)
	if !ok {
		return nil, ErrPropertyAssetNotFound
	}
	if err := input.Validate(); err != nil {
		return nil, err
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := lockWorkspaceProperty(ctx, tx, tenantContext.OrganizationID, propertyID); err != nil {
		return nil, err
	}
	current, err := repo.getWorkspaceAsset(ctx, tx, tenantContext.OrganizationID, propertyID, assetID, true)
	if err != nil {
		return nil, err
	}
	if !workspaceTimestampsEqual(workspaceString(current, "updated_at"), input.ExpectedUpdatedAt) {
		return nil, ErrPropertyWorkspaceConflict
	}
	referenced, err := propertyAssetReferencedByPublishedVersion(
		ctx, tx, tenantContext.OrganizationID, propertyID, assetID,
	)
	if err != nil {
		return nil, err
	}
	if referenced {
		return nil, ErrPropertyAssetPublished
	}
	storagePath := workspaceString(current, "storage_path")
	externalURL := workspaceString(current, "external_url")
	command, err := tx.Exec(ctx, `
		delete from public.property_assets as asset
		where asset.organization_id = $1::uuid
		  and asset.property_id = $2::uuid
		  and asset.id = $3::uuid
		  and asset.updated_at = $4::timestamptz
	`, tenantContext.OrganizationID, propertyID, assetID, input.ExpectedUpdatedAt)
	if err != nil {
		return nil, normalizeWorkspaceDatabaseError(err)
	}
	if command.RowsAffected() != 1 {
		return nil, ErrPropertyWorkspaceConflict
	}
	if workspaceString(current, "asset_type") == "photo" {
		if err := syncLegacyPropertyPrimaryPhoto(ctx, tx, tenantContext.OrganizationID, propertyID, externalURL, workspaceBool(current, "is_primary")); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	if storagePath != "" && isCanonicalPropertyStoragePath(storagePath, tenantContext.OrganizationID, propertyID) {
		cleanupContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		_ = repo.storage.remove(cleanupContext, propertyPrivateBucket, []string{storagePath})
		cancel()
	}
	return map[string]string{"id": assetID}, nil
}

func publishedAssetRepresentationChanged(current map[string]any, target CreatePropertyAssetInput) bool {
	return workspaceString(current, "asset_type") != target.AssetType ||
		workspaceString(current, "visibility") != target.Visibility ||
		workspaceString(current, "storage_path") != workspacePointerText(target.StoragePath) ||
		workspaceString(current, "external_url") != workspacePointerText(target.ExternalURL) ||
		workspaceString(current, "mime_type") != workspacePointerText(target.MIMEType) ||
		workspaceInt64PointerValue(current, "file_size_bytes") != workspaceInt64PointerValueFromPointer(target.FileSizeBytes)
}

func workspaceInt64PointerValue(source map[string]any, key string) string {
	value := workspaceMapInt64Pointer(source, key)
	return workspaceInt64PointerValueFromPointer(value)
}

func workspaceInt64PointerValueFromPointer(value *int64) string {
	if value == nil {
		return ""
	}
	return strconv.FormatInt(*value, 10)
}

func workspacePointerText(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func propertyAssetReferencedByPublishedVersion(
	ctx context.Context,
	queryer interface {
		QueryRow(context.Context, string, ...any) pgx.Row
	},
	organizationID string,
	propertyID string,
	assetID string,
) (bool, error) {
	var referenced bool
	err := queryer.QueryRow(ctx, `
		select exists (
		  select 1
		  from public.property_channel_publications publication
		  join public.property_channel_publication_versions version
		    on version.publication_id = publication.id
		  where publication.organization_id = $1::uuid
		    and publication.property_id = $2::uuid
		    and publication.desired_state = 'published'
		    and (
		      publication.published_version = version.version
		      or exists (
		        select 1
		        from public.property_channel_publication_jobs delivered_job
		        where delivered_job.publication_id = publication.id
		          and delivered_job.organization_id = publication.organization_id
		          and delivered_job.version_id = version.id
		      and delivered_job.action in ('publish', 'update', 'revalidate')
		          and delivered_job.status = 'succeeded'
		      )
		    )
		    and exists (
		      select 1
		      from jsonb_array_elements(coalesce(version.payload->'media', '[]'::jsonb)) media
		      where media->>'asset_id' = $3
		    )
		)
	`, organizationID, propertyID, assetID).Scan(&referenced)
	return referenced, err
}

func (repo Repository) CreatePropertyAssetUploadIntent(ctx context.Context, tenantContext tenant.Context, propertyID string, input CreatePropertyAssetUploadIntentInput) (PropertyAssetUploadIntent, error) {
	if !canManageProperties(tenantContext) {
		return PropertyAssetUploadIntent{}, tenant.ErrOrganizationAccessDenied
	}
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return PropertyAssetUploadIntent{}, ErrPropertyNotFound
	}
	if err := input.Validate(); err != nil {
		return PropertyAssetUploadIntent{}, err
	}
	var exists bool
	if err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1 from public.properties
			where organization_id = $1::uuid and id = $2::uuid
		)
	`, tenantContext.OrganizationID, propertyID).Scan(&exists); err != nil {
		return PropertyAssetUploadIntent{}, err
	}
	if !exists {
		return PropertyAssetUploadIntent{}, ErrPropertyNotFound
	}
	assetID, err := randomPropertyAssetUUID()
	if err != nil {
		return PropertyAssetUploadIntent{}, err
	}
	storagePath := fmt.Sprintf("orgs/%s/properties/%s/%s/%s", tenantContext.OrganizationID, propertyID, assetID, input.FileName)
	signedURL, token, err := repo.storage.createSignedUploadURL(ctx, propertyPrivateBucket, storagePath)
	if err != nil {
		return PropertyAssetUploadIntent{}, err
	}
	return PropertyAssetUploadIntent{
		Bucket: propertyPrivateBucket, StoragePath: storagePath, Token: token,
		SignedURL: signedURL, ExpiresAt: time.Now().UTC().Add(propertyAssetUploadTokenTTL).Format(time.RFC3339),
	}, nil
}

func (repo Repository) verifyStoredPropertyAsset(ctx context.Context, input *CreatePropertyAssetInput) error {
	if input.StoragePath == nil {
		return nil
	}
	info, err := repo.storage.objectInfo(ctx, propertyPrivateBucket, *input.StoragePath)
	if err != nil {
		if errors.Is(err, ErrStorageNotConfigured) {
			return err
		}
		return fmt.Errorf("%w: stored asset could not be verified", ErrInvalidInput)
	}
	if info.Size <= 0 || info.Size > propertyAssetMaxFileBytes {
		return fmt.Errorf("%w: stored asset size is invalid", ErrInvalidInput)
	}
	if _, ok := validPropertyPrivateMIMETypes[info.MIMEType]; !ok {
		return fmt.Errorf("%w: stored asset mime_type is invalid", ErrInvalidInput)
	}
	prefix, err := repo.storage.objectPrefix(ctx, propertyPrivateBucket, *input.StoragePath)
	if err != nil {
		if errors.Is(err, ErrStorageNotConfigured) {
			return err
		}
		return fmt.Errorf("%w: stored asset bytes could not be verified", ErrInvalidInput)
	}
	detectedMIMEType := strings.ToLower(strings.TrimSpace(strings.SplitN(http.DetectContentType(prefix), ";", 2)[0]))
	if detectedMIMEType != info.MIMEType {
		return fmt.Errorf("%w: stored asset bytes do not match Storage mime_type", ErrInvalidInput)
	}
	if input.FileSizeBytes != nil && *input.FileSizeBytes != info.Size {
		return fmt.Errorf("%w: file_size_bytes does not match Storage", ErrInvalidInput)
	}
	if input.MIMEType != nil && !strings.EqualFold(*input.MIMEType, info.MIMEType) {
		return fmt.Errorf("%w: mime_type does not match Storage", ErrInvalidInput)
	}
	input.FileSizeBytes = &info.Size
	input.MIMEType = &info.MIMEType
	if input.FileName == nil {
		fileName := pathpkg.Base(*input.StoragePath)
		input.FileName = &fileName
	}
	if input.AssetType == "photo" && !strings.HasPrefix(info.MIMEType, "image/") {
		return fmt.Errorf("%w: photos require an image object", ErrInvalidInput)
	}
	if input.AssetType == "document" && info.MIMEType != "application/pdf" {
		return fmt.Errorf("%w: documents require a PDF object", ErrInvalidInput)
	}
	return nil
}

func mergePropertyAssetInput(current map[string]any, input UpdatePropertyAssetInput, organizationID string, propertyID string) (CreatePropertyAssetInput, error) {
	target := CreatePropertyAssetInput{
		AssetType: input.AssetType, Visibility: input.Visibility,
		StoragePath:   workspaceMapStringPointer(current, "storage_path"),
		ExternalURL:   workspaceMapStringPointer(current, "external_url"),
		Title:         workspaceMapStringPointer(current, "title"),
		Description:   workspaceMapStringPointer(current, "description"),
		FileName:      workspaceMapStringPointer(current, "file_name"),
		MIMEType:      workspaceMapStringPointer(current, "mime_type"),
		FileSizeBytes: workspaceMapInt64Pointer(current, "file_size_bytes"),
		SortOrder:     workspaceInt(current, "sort_order"), IsPrimary: workspaceBool(current, "is_primary"),
		DocumentCategory: workspaceMapStringPointer(current, "document_category"),
		ExpiresAt:        workspaceMapStringPointer(current, "expires_at"), Metadata: input.Metadata,
	}
	applyString := func(field workspaceOptionalString, destination **string) {
		if field.Set {
			*destination = field.Value
		}
	}
	applyString(input.StoragePath, &target.StoragePath)
	applyString(input.ExternalURL, &target.ExternalURL)
	applyString(input.Title, &target.Title)
	applyString(input.Description, &target.Description)
	applyString(input.FileName, &target.FileName)
	applyString(input.MIMEType, &target.MIMEType)
	applyString(input.DocumentCategory, &target.DocumentCategory)
	applyString(input.ExpiresAt, &target.ExpiresAt)
	if input.FileSizeBytes.Set {
		target.FileSizeBytes = input.FileSizeBytes.Value
	}
	if err := target.Validate(organizationID, propertyID); err != nil {
		return CreatePropertyAssetInput{}, err
	}
	return target, nil
}

func (repo Repository) getWorkspaceAsset(ctx context.Context, queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, organizationID string, propertyID string, assetID string, forUpdate bool) (map[string]any, error) {
	lockClause := ""
	if forUpdate {
		lockClause = " for update of asset"
	}
	item, err := scanWorkspaceObject(queryer.QueryRow(ctx, `
		select `+workspaceAssetProjection("asset", "true")+`::text
		from public.property_assets as asset
		where asset.organization_id = $1::uuid
		  and asset.property_id = $2::uuid
		  and asset.id = $3::uuid`+lockClause,
		organizationID, propertyID, assetID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPropertyAssetNotFound
	}
	return item, err
}

func listWorkspaceAssets(ctx context.Context, queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, organizationID string, propertyID string) ([]map[string]any, error) {
	rows, err := queryer.Query(ctx, `
		select `+workspaceAssetProjection("asset", "true")+`::text
		from public.property_assets as asset
		where asset.organization_id = $1::uuid and asset.property_id = $2::uuid
		order by asset.asset_type, asset.is_primary desc, asset.sort_order, asset.id
	`, organizationID, propertyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		item, err := decodeWorkspaceObject(raw)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func clearOtherPrimaryPhotos(ctx context.Context, tx pgx.Tx, organizationID string, propertyID string, excludeID string) error {
	_, err := tx.Exec(ctx, `
		update public.property_assets as asset
		set is_primary = false, updated_at = now()
		where asset.organization_id = $1::uuid
		  and asset.property_id = $2::uuid
		  and asset.asset_type = 'photo'
		  and asset.is_primary
		  and (nullif($3, '') is null or asset.id <> nullif($3, '')::uuid)
	`, organizationID, propertyID, excludeID)
	return normalizeWorkspaceDatabaseError(err)
}

func syncLegacyPropertyPrimaryPhoto(ctx context.Context, tx pgx.Tx, organizationID string, propertyID string, removedExternalURL string, force bool) error {
	_, err := tx.Exec(ctx, `
		with replacement as (
			select asset.external_url
			from public.property_assets as asset
			where asset.organization_id = $1::uuid
			  and asset.property_id = $2::uuid
			  and asset.asset_type = 'photo'
			  and asset.visibility = 'public'
			  and asset.external_url is not null
			order by asset.is_primary desc, asset.sort_order, asset.id
			limit 1
		)
		update public.properties as property
		set imagem_principal = (select external_url from replacement), updated_at = now()
		where property.organization_id = $1::uuid
		  and property.id = $2::uuid
		  and ($4::boolean or ($3 <> '' and property.imagem_principal = $3))
		  and property.imagem_principal is distinct from (select external_url from replacement)
	`, organizationID, propertyID, removedExternalURL, force)
	return err
}

func (repo Repository) enrichWorkspaceAssetAccessURLs(ctx context.Context, organizationID string, propertyID string, assets []map[string]any) {
	paths := []string{}
	seen := map[string]struct{}{}
	pathByAssetID := map[string]string{}
	for _, asset := range assets {
		storagePath := workspaceString(asset, "_storage_path_for_access")
		delete(asset, "_storage_path_for_access")
		if !isCanonicalPropertyStoragePath(storagePath, organizationID, propertyID) {
			continue
		}
		pathByAssetID[workspaceString(asset, "id")] = storagePath
		if _, exists := seen[storagePath]; exists {
			continue
		}
		seen[storagePath] = struct{}{}
		paths = append(paths, storagePath)
	}
	if len(paths) == 0 {
		return
	}
	urls, err := repo.storage.createSignedURLs(ctx, propertyPrivateBucket, paths, propertyAssetAccessTTL)
	if err != nil {
		return
	}
	for _, asset := range assets {
		storagePath := pathByAssetID[workspaceString(asset, "id")]
		if accessURL := urls[storagePath]; accessURL != "" {
			asset["access_url"] = accessURL
		}
	}
}

func nullableWorkspaceString(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func workspaceTimestampsEqual(left string, right string) bool {
	leftTime, leftErr := parseWorkspaceTimestamp(left)
	rightTime, rightErr := parseWorkspaceTimestamp(right)
	return leftErr == nil && rightErr == nil && leftTime.Equal(rightTime)
}

func parseWorkspaceTimestamp(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	var lastErr error
	for _, layout := range []string{
		time.RFC3339Nano,
		"2006-01-02 15:04:05.999999999Z07:00",
		"2006-01-02 15:04:05.999999999Z07",
	} {
		parsed, err := time.Parse(layout, value)
		if err == nil {
			return parsed, nil
		}
		lastErr = err
	}
	return time.Time{}, lastErr
}

func workspaceMapStringPointer(item map[string]any, key string) *string {
	value := workspaceString(item, key)
	if value == "" {
		return nil
	}
	return &value
}

func workspaceMapInt64Pointer(item map[string]any, key string) *int64 {
	value, exists := item[key]
	if !exists || value == nil {
		return nil
	}
	switch number := value.(type) {
	case float64:
		converted := int64(number)
		return &converted
	case int64:
		converted := number
		return &converted
	default:
		return nil
	}
}

func workspaceInt(item map[string]any, key string) int {
	if number, ok := item[key].(float64); ok {
		return int(number)
	}
	return 0
}

func workspaceBool(item map[string]any, key string) bool {
	value, _ := item[key].(bool)
	return value
}

func randomPropertyAssetUUID() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(raw)
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32], nil
}
