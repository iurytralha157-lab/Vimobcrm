package properties

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) GetWorkspace(ctx context.Context, tenantContext tenant.Context, propertyID string) (PropertyWorkspaceResponse, error) {
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return PropertyWorkspaceResponse{}, ErrPropertyNotFound
	}

	canViewContacts, err := repo.canViewPropertyOwnerContacts(ctx, tenantContext)
	if err != nil {
		return PropertyWorkspaceResponse{}, err
	}
	canManage := canManageProperties(tenantContext)

	workspaceArguments, visibilityClause := workspaceReadVisibility(
		tenantContext,
		propertyID,
		canViewContacts,
		canManage,
	)

	var propertyJSON, offersJSON, ownershipsJSON, assetsJSON, keysJSON, movementsJSON string
	workspaceQuery := `
		select
			to_jsonb(visible_property)::text,
			coalesce((
				select jsonb_agg(` + workspaceOfferProjection("offer", "$4::boolean") + ` order by offer.offer_type, offer.id)
				from public.property_offers offer
				where offer.organization_id = visible_property.organization_id
				  and offer.property_id = visible_property.id
				  and ($4::boolean or offer.status = 'active')
			), '[]'::jsonb)::text,
			coalesce((
				select jsonb_agg(` + workspaceOwnershipProjection("ownership", "owner", "$3::boolean", "$4::boolean") + `
					order by ownership.valid_from desc, ownership.is_primary desc, ownership.id)
				from public.property_ownerships ownership
				join public.property_owners owner
				  on owner.organization_id = ownership.organization_id
				 and owner.id = ownership.owner_id
				where ownership.organization_id = visible_property.organization_id
				  and ownership.property_id = visible_property.id
			), '[]'::jsonb)::text,
			coalesce((
				select jsonb_agg(` + workspaceAssetProjectionWithAccessPath("asset", "$4::boolean") + `
					order by asset.asset_type, asset.is_primary desc, asset.sort_order, asset.id)
				from public.property_assets asset
				where asset.organization_id = visible_property.organization_id
				  and asset.property_id = visible_property.id
				  and ($4::boolean or asset.visibility <> 'confidential')
			), '[]'::jsonb)::text,
			coalesce((
				select jsonb_agg(` + workspaceKeyProjection("property_key") + ` order by property_key.status, property_key.label, property_key.id)
				from public.property_keys property_key
				where property_key.organization_id = visible_property.organization_id
				  and property_key.property_id = visible_property.id
				  and $4::boolean
			), '[]'::jsonb)::text,
			coalesce((
				select jsonb_agg(` + workspaceKeyMovementProjection("recent_movement") + ` order by recent_movement.occurred_at desc, recent_movement.id desc)
				from (
					select movement.*
					from public.property_key_movements movement
					join public.property_keys property_key
					  on property_key.organization_id = movement.organization_id
					 and property_key.id = movement.property_key_id
					where movement.organization_id = visible_property.organization_id
					  and property_key.property_id = visible_property.id
					  and $4::boolean
					order by movement.occurred_at desc, movement.id desc
					limit 50
				) recent_movement
			), '[]'::jsonb)::text
		from public.properties visible_property
		where ` + visibilityClause + `
		limit 1
	`
	err = repo.db.Pool().QueryRow(ctx, workspaceQuery, workspaceArguments...).Scan(
		&propertyJSON,
		&offersJSON,
		&ownershipsJSON,
		&assetsJSON,
		&keysJSON,
		&movementsJSON,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return PropertyWorkspaceResponse{}, ErrPropertyNotFound
	}
	if err != nil {
		if _, unavailable := unavailableNormalizedWorkspaceResource(err); unavailable {
			return repo.getLegacyWorkspace(
				ctx,
				tenantContext,
				propertyID,
				canViewContacts,
				canManage,
			)
		}
		return PropertyWorkspaceResponse{}, err
	}

	propertyObject, err := decodeWorkspaceObject(propertyJSON)
	if err != nil {
		return PropertyWorkspaceResponse{}, err
	}
	property := normalizePropertyOutput(Property(propertyObject))
	if !canViewContacts {
		redactPropertyOwnerContacts(property)
	}

	offers, err := decodeWorkspaceList(offersJSON)
	if err != nil {
		return PropertyWorkspaceResponse{}, err
	}
	ownerships, err := decodeWorkspaceList(ownershipsJSON)
	if err != nil {
		return PropertyWorkspaceResponse{}, err
	}
	assets, err := decodeWorkspaceList(assetsJSON)
	if err != nil {
		return PropertyWorkspaceResponse{}, err
	}
	repo.enrichWorkspaceAssetAccessURLs(ctx, tenantContext.OrganizationID, propertyID, assets)
	keys, err := decodeWorkspaceList(keysJSON)
	if err != nil {
		return PropertyWorkspaceResponse{}, err
	}
	movements, err := decodeWorkspaceList(movementsJSON)
	if err != nil {
		return PropertyWorkspaceResponse{}, err
	}

	workspace := PropertyWorkspace{
		Property:           projectWorkspaceProperty(property, canManage, canViewContacts),
		Offers:             offers,
		Ownerships:         ownerships,
		Assets:             assets,
		Keys:               keys,
		RecentKeyMovements: movements,
	}
	workspace.Summary = buildWorkspaceSummary(workspace)

	return PropertyWorkspaceResponse{
		Data: workspace,
		Meta: WorkspaceMeta{
			CanManage:            canManage,
			CanViewOwnerContacts: canViewContacts,
			CanViewConfidential:  canManage,
		},
	}, nil
}

var normalizedWorkspaceResourcesByTable = map[string]string{
	"property_offers":        "offers",
	"property_ownerships":    "ownerships",
	"property_assets":        "assets",
	"property_keys":          "keys",
	"property_key_movements": "key_history",
}

var normalizedWorkspaceResources = []string{
	"offers",
	"ownerships",
	"assets",
	"keys",
	"key_history",
}

func unavailableNormalizedWorkspaceResource(err error) (string, bool) {
	var databaseError *pgconn.PgError
	if !errors.As(err, &databaseError) || databaseError.Code != "42P01" {
		return "", false
	}

	schema := strings.TrimSpace(databaseError.SchemaName)
	table := strings.TrimSpace(databaseError.TableName)
	if table == "" {
		var ok bool
		schema, table, ok = parseUndefinedWorkspaceRelation(databaseError.Message)
		if !ok {
			return "", false
		}
	} else if strings.Contains(table, ".") {
		var ok bool
		schema, table, ok = splitWorkspaceRelation(table)
		if !ok {
			return "", false
		}
	}

	if schema != "" && schema != "public" {
		return "", false
	}
	resource, ok := normalizedWorkspaceResourcesByTable[table]
	return resource, ok
}

func parseUndefinedWorkspaceRelation(message string) (string, string, bool) {
	const prefix = `relation "`
	const suffix = `" does not exist`
	if !strings.HasPrefix(message, prefix) || !strings.HasSuffix(message, suffix) {
		return "", "", false
	}
	relation := strings.TrimSuffix(strings.TrimPrefix(message, prefix), suffix)
	return splitWorkspaceRelation(relation)
}

func splitWorkspaceRelation(relation string) (string, string, bool) {
	parts := strings.Split(relation, ".")
	switch len(parts) {
	case 1:
		return "", parts[0], parts[0] != ""
	case 2:
		return parts[0], parts[1], parts[0] != "" && parts[1] != ""
	default:
		return "", "", false
	}
}

func (repo Repository) getLegacyWorkspace(
	ctx context.Context,
	tenantContext tenant.Context,
	propertyID string,
	canViewContacts bool,
	canManage bool,
) (PropertyWorkspaceResponse, error) {
	workspaceArguments, visibilityClause := legacyWorkspaceReadVisibility(tenantContext, propertyID)

	var propertyJSON string
	err := repo.db.Pool().QueryRow(ctx, `
		select to_jsonb(visible_property)::text
		from public.properties visible_property
		where `+visibilityClause+`
		limit 1
	`, workspaceArguments...).Scan(&propertyJSON)
	if errors.Is(err, pgx.ErrNoRows) {
		return PropertyWorkspaceResponse{}, ErrPropertyNotFound
	}
	if err != nil {
		return PropertyWorkspaceResponse{}, err
	}

	return buildLegacyWorkspaceResponse(propertyJSON, canViewContacts, canManage)
}

func buildLegacyWorkspaceResponse(propertyJSON string, canViewContacts bool, canManage bool) (PropertyWorkspaceResponse, error) {
	propertyObject, err := decodeWorkspaceObject(propertyJSON)
	if err != nil {
		return PropertyWorkspaceResponse{}, err
	}
	property := normalizePropertyOutput(Property(propertyObject))
	if !canViewContacts {
		redactPropertyOwnerContacts(property)
	}

	workspace := PropertyWorkspace{
		Property:           projectWorkspaceProperty(property, canManage, canViewContacts),
		Offers:             make([]map[string]any, 0),
		Ownerships:         make([]map[string]any, 0),
		Assets:             make([]map[string]any, 0),
		Keys:               make([]map[string]any, 0),
		RecentKeyMovements: make([]map[string]any, 0),
	}
	workspace.Summary = buildWorkspaceSummary(workspace)
	normalizedResourcesAvailable := false

	return PropertyWorkspaceResponse{
		Data: workspace,
		Meta: WorkspaceMeta{
			CanManage:                    canManage,
			CanViewOwnerContacts:         canViewContacts,
			CanViewConfidential:          canManage,
			NormalizedResourcesAvailable: &normalizedResourcesAvailable,
			UnavailableResources:         append([]string(nil), normalizedWorkspaceResources...),
		},
	}, nil
}

func workspaceReadVisibility(tenantContext tenant.Context, propertyID string, canViewContacts bool, canManage bool) ([]any, string) {
	arguments := []any{
		tenantContext.OrganizationID,
		propertyID,
		canViewContacts,
		canManage,
	}
	where := []string{
		"visible_property.organization_id = $1::uuid",
		"visible_property.id = $2::uuid",
	}
	arguments, where = addScopedPropertyVisibility(arguments, where, tenantContext, "visible_property", "")
	return arguments, strings.Join(where, " and ")
}

func legacyWorkspaceReadVisibility(tenantContext tenant.Context, propertyID string) ([]any, string) {
	arguments := []any{
		tenantContext.OrganizationID,
		propertyID,
	}
	where := []string{
		"visible_property.organization_id = $1::uuid",
		"visible_property.id = $2::uuid",
	}
	arguments, where = addScopedPropertyVisibility(arguments, where, tenantContext, "visible_property", "")
	return arguments, strings.Join(where, " and ")
}

func (repo Repository) UpsertPropertyOffer(ctx context.Context, tenantContext tenant.Context, propertyID string, offerType string, input UpsertPropertyOfferInput) (map[string]any, error) {
	if !canManageProperties(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return nil, ErrPropertyNotFound
	}
	offerType = strings.ToLower(strings.TrimSpace(offerType))
	if err := input.Validate(offerType); err != nil {
		return nil, err
	}

	termsJSON, err := json.Marshal(input.Terms)
	if err != nil {
		return nil, fmt.Errorf("%w: offer terms are invalid", ErrInvalidInput)
	}
	metadataJSON, err := json.Marshal(input.Metadata)
	if err != nil {
		return nil, fmt.Errorf("%w: offer metadata is invalid", ErrInvalidInput)
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := lockWorkspaceProperty(ctx, tx, tenantContext.OrganizationID, propertyID); err != nil {
		return nil, err
	}

	expectedUpdatedAt := ""
	if input.ExpectedUpdatedAt != nil {
		expectedUpdatedAt = strings.TrimSpace(*input.ExpectedUpdatedAt)
	}
	pricePeriod := ""
	if input.PricePeriod != nil {
		pricePeriod = *input.PricePeriod
	}
	availableFrom := ""
	if input.AvailableFrom != nil {
		availableFrom = strings.TrimSpace(*input.AvailableFrom)
	}
	availableUntil := ""
	if input.AvailableUntil != nil {
		availableUntil = strings.TrimSpace(*input.AvailableUntil)
	}

	arguments := []any{
		tenantContext.OrganizationID,
		propertyID,
		offerType,
		input.Status,
		input.Price,
		input.Currency,
		pricePeriod,
		string(termsJSON),
		availableFrom,
		availableUntil,
		tenantContext.UserID,
		string(metadataJSON),
		expectedUpdatedAt,
	}
	stateArguments := append(append([]any{}, arguments[:10]...), arguments[11])

	var raw string
	var matchesDesiredState bool
	existingErr := tx.QueryRow(ctx, `
		select
			`+workspaceOfferProjection("offer", "true")+`::text,
			(
				offer.status = $4
				and offer.price is not distinct from $5::numeric
				and offer.currency = $6
				and offer.price_period is not distinct from nullif($7, '')
				and offer.terms = $8::jsonb
				and offer.available_from is not distinct from nullif($9, '')::date
				and offer.available_until is not distinct from nullif($10, '')::date
				and offer.metadata = $11::jsonb
			) as matches_desired_state
		from public.property_offers as offer
		where offer.organization_id = $1::uuid
		  and offer.property_id = $2::uuid
		  and offer.offer_type = $3
		for update of offer
	`, stateArguments...).Scan(&raw, &matchesDesiredState)
	if existingErr != nil && !errors.Is(existingErr, pgx.ErrNoRows) {
		return nil, normalizeWorkspaceDatabaseError(existingErr)
	}

	if existingErr == nil && matchesDesiredState {
		if err := syncLegacyPropertyOfferProjection(ctx, tx, tenantContext.OrganizationID, propertyID); err != nil {
			return nil, err
		}
		offer, err := decodeWorkspaceObject(raw)
		if err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return offer, nil
	}

	if existingErr == nil {
		// An update must prove which representation it is replacing. Omitting the
		// precondition is reserved for create-only PUTs and therefore conflicts.
		if expectedUpdatedAt == "" {
			return nil, ErrPropertyWorkspaceConflict
		}
		err = tx.QueryRow(ctx, `
			update public.property_offers as offer
			set status = $4,
				price = $5::numeric,
				currency = $6,
				price_period = nullif($7, ''),
				terms = $8::jsonb,
				available_from = nullif($9, '')::date,
				available_until = nullif($10, '')::date,
				published_at = case when $4 = 'active' then coalesce(offer.published_at, now()) else offer.published_at end,
				completed_at = case when $4 = 'completed' then coalesce(offer.completed_at, now()) else offer.completed_at end,
				updated_by = nullif($11, '')::uuid,
				metadata = $12::jsonb
			where offer.organization_id = $1::uuid
			  and offer.property_id = $2::uuid
			  and offer.offer_type = $3
			  and offer.updated_at = $13::timestamptz
			returning `+workspaceOfferProjection("offer", "true")+`::text
		`, arguments...).Scan(&raw)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrPropertyWorkspaceConflict
		}
	} else {
		// Supplying a version for a representation that does not exist is also a
		// conflict; it must never create a different resource by accident.
		if expectedUpdatedAt != "" {
			return nil, ErrPropertyWorkspaceConflict
		}
		err = tx.QueryRow(ctx, `
			insert into public.property_offers (
				organization_id, property_id, offer_type, status, price, currency,
				price_period, terms, available_from, available_until,
				published_at, completed_at, created_by, updated_by, metadata
			)
			values (
				$1::uuid, $2::uuid, $3, $4, $5::numeric, $6,
				nullif($7, ''), $8::jsonb, nullif($9, '')::date, nullif($10, '')::date,
				case when $4 = 'active' then now() end,
				case when $4 = 'completed' then now() end,
				nullif($11, '')::uuid, nullif($11, '')::uuid, $12::jsonb
			)
			returning `+workspaceOfferProjection("property_offers", "true")+`::text
		`, arguments[:12]...).Scan(&raw)
	}
	if err != nil {
		return nil, normalizeWorkspaceDatabaseError(err)
	}

	if err := syncLegacyPropertyOfferProjection(ctx, tx, tenantContext.OrganizationID, propertyID); err != nil {
		return nil, err
	}

	offer, err := decodeWorkspaceObject(raw)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return offer, nil
}

func syncLegacyPropertyOfferProjection(ctx context.Context, tx pgx.Tx, organizationID string, propertyID string) error {
	_, err := tx.Exec(ctx, `
		with commercial_projection as (
			select
				max(offer.price) filter (
					where offer.offer_type = 'sale' and offer.status = 'active'
				) as sale_price,
				max(offer.price) filter (
					where offer.offer_type = 'rent' and offer.status = 'active'
				) as rent_price,
				max(offer.price) filter (
					where offer.offer_type = 'seasonal' and offer.status = 'active'
				) as seasonal_price
			from public.property_offers as offer
			where offer.organization_id = $1::uuid
			  and offer.property_id = $2::uuid
		)
		update public.properties as property
		set preco = commercial_projection.sale_price,
			valor_locacao = coalesce(commercial_projection.rent_price, commercial_projection.seasonal_price),
			updated_at = now()
		from commercial_projection
		where property.organization_id = $1::uuid
		  and property.id = $2::uuid
		  and (property.preco, property.valor_locacao) is distinct from (
			commercial_projection.sale_price,
			coalesce(commercial_projection.rent_price, commercial_projection.seasonal_price)
		  )
	`, organizationID, propertyID)
	return err
}

func (repo Repository) CreatePropertyKey(ctx context.Context, tenantContext tenant.Context, propertyID string, input CreatePropertyKeyInput) (map[string]any, error) {
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
	metadataJSON, err := json.Marshal(input.Metadata)
	if err != nil {
		return nil, fmt.Errorf("%w: key metadata is invalid", ErrInvalidInput)
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := lockWorkspaceProperty(ctx, tx, tenantContext.OrganizationID, propertyID); err != nil {
		return nil, err
	}

	var keyID string
	err = tx.QueryRow(ctx, `
		insert into public.property_keys (
			organization_id, property_id, label, key_code, current_location,
			notes, metadata, created_by
		)
		values (
			$1::uuid, $2::uuid, $3, nullif($4, ''), nullif($5, ''),
			nullif($6, ''), $7::jsonb, nullif($8, '')::uuid
		)
		returning id::text
	`, tenantContext.OrganizationID, propertyID, input.Label, optionalWorkspaceValue(input.KeyCode), optionalWorkspaceValue(input.CurrentLocation), optionalWorkspaceValue(input.Notes), string(metadataJSON), tenantContext.UserID).Scan(&keyID)
	if err != nil {
		return nil, normalizeWorkspaceDatabaseError(err)
	}

	if _, err := tx.Exec(ctx, `
		insert into public.property_key_movements (
			organization_id, property_key_id, movement_type, to_location, metadata, created_by
		)
		values ($1::uuid, $2::uuid, 'registration', nullif($3, ''), '{}'::jsonb, nullif($4, '')::uuid)
	`, tenantContext.OrganizationID, keyID, optionalWorkspaceValue(input.CurrentLocation), tenantContext.UserID); err != nil {
		return nil, normalizeWorkspaceDatabaseError(err)
	}

	key, err := scanWorkspaceObject(tx.QueryRow(ctx, `
		select `+workspaceKeyProjection("property_key")+`::text
		from public.property_keys property_key
		where property_key.organization_id = $1::uuid
		  and property_key.property_id = $2::uuid
		  and property_key.id = $3::uuid
	`, tenantContext.OrganizationID, propertyID, keyID))
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return key, nil
}

func (repo Repository) AppendPropertyKeyMovement(ctx context.Context, tenantContext tenant.Context, propertyID string, keyID string, input PropertyKeyMovementInput) (PropertyKeyMovementResult, error) {
	if !canManageProperties(tenantContext) {
		return PropertyKeyMovementResult{}, tenant.ErrOrganizationAccessDenied
	}
	propertyID, propertyOK := normalizeUUID(propertyID)
	keyID, keyOK := normalizeUUID(keyID)
	if !propertyOK || !keyOK {
		return PropertyKeyMovementResult{}, ErrPropertyNotFound
	}
	if err := input.Validate(); err != nil {
		return PropertyKeyMovementResult{}, err
	}
	metadataJSON, err := json.Marshal(input.Metadata)
	if err != nil {
		return PropertyKeyMovementResult{}, fmt.Errorf("%w: movement metadata is invalid", ErrInvalidInput)
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return PropertyKeyMovementResult{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockWorkspaceProperty(ctx, tx, tenantContext.OrganizationID, propertyID); err != nil {
		return PropertyKeyMovementResult{}, err
	}
	var lockedKeyID string
	err = tx.QueryRow(ctx, `
		select property_key.id::text
		from public.property_keys property_key
		where property_key.organization_id = $1::uuid
		  and property_key.property_id = $2::uuid
		  and property_key.id = $3::uuid
		for update
	`, tenantContext.OrganizationID, propertyID, keyID).Scan(&lockedKeyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return PropertyKeyMovementResult{}, ErrPropertyNotFound
	}
	if err != nil {
		return PropertyKeyMovementResult{}, err
	}

	if existing, found, err := findIdempotentKeyMovement(ctx, tx, tenantContext.OrganizationID, input.IdempotencyKey); err != nil {
		return PropertyKeyMovementResult{}, err
	} else if found {
		if workspaceString(existing, "property_key_id") != keyID ||
			workspaceString(existing, "movement_type") != input.MovementType ||
			!keyMovementMatchesInput(existing, input) {
			return PropertyKeyMovementResult{}, ErrPropertyWorkspaceConflict
		}
		key, err := scanWorkspaceObject(tx.QueryRow(ctx, `
			select `+workspaceKeyProjection("property_key")+`::text
			from public.property_keys property_key
			where property_key.organization_id = $1::uuid and property_key.id = $2::uuid
		`, tenantContext.OrganizationID, keyID))
		if err != nil {
			return PropertyKeyMovementResult{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return PropertyKeyMovementResult{}, err
		}
		return PropertyKeyMovementResult{Movement: existing, Key: key}, nil
	}

	var raw string
	err = tx.QueryRow(ctx, `
		insert into public.property_key_movements (
			organization_id, property_key_id, movement_type, holder_user_id,
			holder_name, from_location, to_location, expected_return_at,
			idempotency_key, notes, metadata, created_by
		)
		values (
			$1::uuid, $2::uuid, $3, nullif($4, '')::uuid,
			nullif($5, ''), nullif($6, ''), nullif($7, ''), nullif($8, '')::timestamptz,
			$9, nullif($10, ''), $11::jsonb, nullif($12, '')::uuid
		)
		returning `+workspaceKeyMovementProjection("property_key_movements")+`::text
	`,
		tenantContext.OrganizationID,
		keyID,
		input.MovementType,
		optionalWorkspaceValue(input.HolderUserID),
		optionalWorkspaceValue(input.HolderName),
		optionalWorkspaceValue(input.FromLocation),
		optionalWorkspaceValue(input.ToLocation),
		optionalWorkspaceValue(input.ExpectedReturn),
		input.IdempotencyKey,
		optionalWorkspaceValue(input.Notes),
		string(metadataJSON),
		tenantContext.UserID,
	).Scan(&raw)
	if err != nil {
		return PropertyKeyMovementResult{}, normalizeWorkspaceDatabaseError(err)
	}
	movement, err := decodeWorkspaceObject(raw)
	if err != nil {
		return PropertyKeyMovementResult{}, err
	}
	key, err := scanWorkspaceObject(tx.QueryRow(ctx, `
		select `+workspaceKeyProjection("property_key")+`::text
		from public.property_keys property_key
		where property_key.organization_id = $1::uuid and property_key.id = $2::uuid
	`, tenantContext.OrganizationID, keyID))
	if err != nil {
		return PropertyKeyMovementResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return PropertyKeyMovementResult{}, err
	}
	return PropertyKeyMovementResult{Movement: movement, Key: key}, nil
}

func lockWorkspaceProperty(ctx context.Context, tx pgx.Tx, organizationID string, propertyID string) error {
	var lockedPropertyID string
	err := tx.QueryRow(ctx, `
		select id::text
		from public.properties
		where organization_id = $1::uuid and id = $2::uuid
		for update
	`, organizationID, propertyID).Scan(&lockedPropertyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrPropertyNotFound
	}
	return err
}

func findIdempotentKeyMovement(ctx context.Context, tx pgx.Tx, organizationID string, idempotencyKey string) (map[string]any, bool, error) {
	movement, err := scanWorkspaceObject(tx.QueryRow(ctx, `
		select `+workspaceKeyMovementProjection("movement")+`::text
		from public.property_key_movements movement
		where movement.organization_id = $1::uuid
		  and movement.idempotency_key = $2
		limit 1
	`, organizationID, idempotencyKey))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	return movement, err == nil, err
}

func scanWorkspaceObject(row scanner) (map[string]any, error) {
	var raw string
	if err := row.Scan(&raw); err != nil {
		return nil, err
	}
	return decodeWorkspaceObject(raw)
}

func decodeWorkspaceObject(raw string) (map[string]any, error) {
	var item map[string]any
	if err := json.Unmarshal([]byte(raw), &item); err != nil {
		return nil, err
	}
	if item == nil {
		item = map[string]any{}
	}
	return item, nil
}

func decodeWorkspaceList(raw string) ([]map[string]any, error) {
	items := []map[string]any{}
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		return nil, err
	}
	if items == nil {
		items = []map[string]any{}
	}
	return items, nil
}

func normalizeWorkspaceDatabaseError(err error) error {
	var databaseError *pgconn.PgError
	if !errors.As(err, &databaseError) {
		return err
	}
	switch databaseError.Message {
	case "property_ownership_allocation_exceeds_100":
		return fmt.Errorf("%w: ownership percentages exceed 100%% during the selected period; adjust the percentage or dates", ErrInvalidInput)
	case "property_ownership_owner_period_overlap":
		return fmt.Errorf("%w: this owner already has an ownership period that overlaps the selected dates; adjust the period", ErrInvalidInput)
	case "property_ownership_primary_period_overlap":
		return fmt.Errorf("%w: another primary owner covers part of the selected period; adjust the primary owner or dates", ErrInvalidInput)
	}
	switch databaseError.ConstraintName {
	case "property_ownerships_owner_period_excl":
		return fmt.Errorf("%w: this owner already has an ownership period that overlaps the selected dates; adjust the period", ErrInvalidInput)
	case "property_ownerships_primary_period_excl":
		return fmt.Errorf("%w: another primary owner covers part of the selected period; adjust the primary owner or dates", ErrInvalidInput)
	}
	switch databaseError.Code {
	case "23505":
		return ErrPropertyWorkspaceConflict
	case "23502", "23503", "23514", "23P01", "22P02", "22007", "22008":
		return fmt.Errorf("%w: workspace data violates a business rule", ErrInvalidInput)
	default:
		return err
	}
}

func buildWorkspaceSummary(workspace PropertyWorkspace) WorkspaceSummary {
	activeOffer := false
	for _, offer := range workspace.Offers {
		if workspaceString(offer, "status") == "active" && workspacePositiveNumber(offer["price"]) {
			activeOffer = true
			break
		}
	}

	publicPhoto := workspaceHasLegacyPhoto(workspace.Property)
	photoCount := 0
	documentCount := 0
	for _, asset := range workspace.Assets {
		switch workspaceString(asset, "asset_type") {
		case "photo":
			photoCount++
			if workspaceString(asset, "visibility") == "public" {
				publicPhoto = true
			}
		case "document":
			documentCount++
		}
	}

	currentOwner := workspaceString(workspace.Property, "owner_id") != "" || workspaceString(workspace.Property, "owner_name") != ""
	currentOwnerIDs := map[string]struct{}{}
	today := time.Now().UTC().Format("2006-01-02")
	for _, ownership := range workspace.Ownerships {
		validFrom := workspaceString(ownership, "valid_from")
		validTo := workspaceString(ownership, "valid_to")
		if validFrom <= today && (validTo == "" || today < validTo) {
			currentOwner = true
			currentOwnerIDs[workspaceString(ownership, "owner_id")] = struct{}{}
		}
	}
	ownerCount := len(currentOwnerIDs)
	if ownerCount == 0 && currentOwner {
		ownerCount = 1
	}

	status := normalizeASCII(workspaceString(workspace.Property, "status"))
	checks := []PublicationCheck{
		{Code: "title", Label: "Titulo comercial informado", Resolved: workspaceString(workspace.Property, "title") != ""},
		{Code: "type", Label: "Tipo do imovel definido", Resolved: workspaceString(workspace.Property, "tipo_de_imovel") != "" || workspaceString(workspace.Property, "tipo") != ""},
		{Code: "location", Label: "Bairro, cidade e UF informados", Resolved: workspaceString(workspace.Property, "bairro") != "" && workspaceString(workspace.Property, "cidade") != "" && workspaceString(workspace.Property, "uf") != ""},
		{Code: "description", Label: "Descricao para publicacao pronta", Resolved: workspaceString(workspace.Property, "descricao_site") != "" || workspaceString(workspace.Property, "descricao") != ""},
		{Code: "offer", Label: "Oferta ativa com valor valido", Resolved: activeOffer},
		{Code: "photo", Label: "Ao menos uma foto publica", Resolved: publicPhoto},
		{Code: "owner", Label: "Proprietario vinculado", Resolved: currentOwner},
		{Code: "responsible", Label: "Corretor responsavel definido", Resolved: workspaceString(workspace.Property, "responsible_user_id") != "" || workspaceString(workspace.Property, "cadastrado_por") != ""},
		{Code: "status", Label: "Imovel disponivel para divulgacao", Resolved: status == "active" || status == "ativo" || status == "disponivel"},
	}

	resolved := 0
	for _, check := range checks {
		if check.Resolved {
			resolved++
		}
	}
	score := 0
	if len(checks) > 0 {
		score = resolved * 100 / len(checks)
	}

	return WorkspaceSummary{
		CompletenessScore: score,
		PublicationReady:  resolved == len(checks),
		Checklist:         checks,
		Counts: WorkspaceEntityCount{
			Offers:     len(workspace.Offers),
			Owners:     ownerCount,
			Photos:     photoCount,
			Documents:  documentCount,
			Keys:       len(workspace.Keys),
			KeyHistory: len(workspace.RecentKeyMovements),
		},
	}
}

func workspaceString(record map[string]any, key string) string {
	value, ok := record[key]
	if !ok || value == nil {
		return ""
	}
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func workspacePositiveNumber(value any) bool {
	switch typed := value.(type) {
	case float64:
		return typed > 0
	case float32:
		return typed > 0
	case int:
		return typed > 0
	case int64:
		return typed > 0
	case json.Number:
		parsed, err := typed.Float64()
		return err == nil && parsed > 0
	case string:
		parsed, err := json.Number(strings.TrimSpace(typed)).Float64()
		return err == nil && parsed > 0
	default:
		return false
	}
}

func workspaceHasLegacyPhoto(property Property) bool {
	if workspaceString(property, "imagem_principal") != "" {
		return true
	}
	for _, key := range []string{"fotos", "image_urls"} {
		switch values := property[key].(type) {
		case []any:
			for _, value := range values {
				if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
					return true
				}
			}
		case []string:
			for _, value := range values {
				if strings.TrimSpace(value) != "" {
					return true
				}
			}
		}
	}
	return false
}

func optionalWorkspaceValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func keyMovementMatchesInput(existing map[string]any, input PropertyKeyMovementInput) bool {
	if workspaceString(existing, "holder_user_id") != optionalWorkspaceValue(input.HolderUserID) ||
		workspaceString(existing, "holder_name") != optionalWorkspaceValue(input.HolderName) ||
		workspaceString(existing, "from_location") != optionalWorkspaceValue(input.FromLocation) ||
		workspaceString(existing, "to_location") != optionalWorkspaceValue(input.ToLocation) ||
		workspaceString(existing, "notes") != optionalWorkspaceValue(input.Notes) {
		return false
	}

	existingExpected := workspaceString(existing, "expected_return_at")
	inputExpected := optionalWorkspaceValue(input.ExpectedReturn)
	if existingExpected != "" || inputExpected != "" {
		existingTime, existingErr := time.Parse(time.RFC3339Nano, existingExpected)
		inputTime, inputErr := time.Parse(time.RFC3339Nano, inputExpected)
		if existingErr != nil || inputErr != nil || !existingTime.Equal(inputTime) {
			return false
		}
	}

	existingMetadata, _ := existing["metadata"].(map[string]any)
	return reflect.DeepEqual(existingMetadata, input.Metadata)
}
