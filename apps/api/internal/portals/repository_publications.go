package portals

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/propertyscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) ListPublications(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	if !propertyscope.CanRead(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	rows, err := repo.db.Pool().Query(ctx, `
		with integration as (
		  select id, organization_id
		  from public.portal_integrations
		  where organization_id = $1::uuid
		    and portal = 'grupo_olx'
		  limit 1
		), canonical as (
		  select publication.*,
		         version.payload->'channel_config' as channel_config
		  from public.property_channel_publications publication
		  join integration
		    on integration.organization_id = publication.organization_id
		   and publication.channel_account_key = integration.id::text
		  left join public.property_channel_publication_versions version
		    on version.publication_id = publication.id
		   and version.organization_id = publication.organization_id
		   and version.property_id = publication.property_id
		   and version.channel = publication.channel
		   and version.channel_account_key = publication.channel_account_key
		   and version.version = publication.current_version
		  where publication.channel = 'grupo_olx'
		), legacy as (
		  select publication.*
		  from public.portal_listing_publications publication
		  join integration on integration.id = publication.integration_id
		  where publication.portal = 'grupo_olx'
		), scope_properties as (
		  select property_id from canonical
		  union
		  select property_id from legacy
		)
		select jsonb_build_object(
			'id', coalesce(legacy.id, canonical.id)::text,
			'integration_id', integration.id::text,
			'property_id', property.id::text,
			'canonical_managed', canonical.id is not null,
			'desired_state', canonical.desired_state,
			'observed_state', canonical.observed_state,
			'canonical_desired_state', canonical.desired_state,
			'canonical_observed_state', canonical.observed_state,
			'canonical_published_version', canonical.published_version,
			'client_listing_id', coalesce(
			  nullif(trim(canonical.channel_config->>'client_listing_id'), ''),
			  canonical.provider_listing_id,
			  legacy.client_listing_id,
			  property.code,
			  property.id::text
			),
			'publication_type', case
			  when canonical.id is not null
			   and canonical.desired_state = 'unpublished'
			   and canonical.observed_state = 'unpublished'
			   and canonical.published_version is null
			    then coalesce(legacy.publication_type, nullif(trim(canonical.channel_config->>'publication_type'), ''), 'STANDARD')
			  else coalesce(nullif(trim(canonical.channel_config->>'publication_type'), ''), legacy.publication_type, 'STANDARD')
			end,
			'is_enabled', case
			  when canonical.id is not null then canonical.desired_state <> 'unpublished'
			  else coalesce(legacy.is_enabled, false)
			end,
			'status', coalesce(canonical.observed_state, legacy.status),
			'validation_errors', coalesce(canonical.validation_errors, legacy.validation_errors, '[]'::jsonb),
			'last_exported_at', legacy.last_exported_at,
			'last_seen_in_feed_at', legacy.last_seen_in_feed_at,
			'last_error', coalesce(canonical.last_error_message, legacy.last_error),
			'created_at', coalesce(canonical.created_at, legacy.created_at),
			'updated_at', coalesce(canonical.updated_at, legacy.updated_at),
			'canonical_updated_at', canonical.updated_at,
			'property', jsonb_build_object(
				'id', property.id::text,
				'code', property.code,
				'title', property.title,
				'status', property.status,
				'tipo_de_negocio', property.tipo_de_negocio,
				'tipo_de_imovel', property.tipo_de_imovel,
				'cidade', property.cidade,
				'bairro', property.bairro,
				'preco', property.preco,
				'valor_locacao', property.valor_locacao,
				'imagem_principal', property.imagem_principal
			)
		)
		from scope_properties scope
		cross join integration
		join public.properties property
		  on property.organization_id = integration.organization_id
		 and property.id = scope.property_id
		 and `+propertyscope.VisibilitySQL("property", "$2", "$3", "$4")+`
		left join canonical on canonical.property_id = scope.property_id
		left join legacy on legacy.property_id = scope.property_id
		order by coalesce(canonical.updated_at, legacy.updated_at) desc, property.id
	`,
		tenantContext.OrganizationID,
		propertyscope.CanViewAll(tenantContext),
		tenantContext.UserID,
		propertyscope.CanViewTeam(tenantContext),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanJSONRows(rows)
}

func (repo Repository) UpsertPublications(ctx context.Context, tenantContext tenant.Context, request UpsertPublicationsRequest) ([]map[string]any, error) {
	// Provider identity/product metadata changes the external publication contract.
	// Keep this manager-only even when this repository is called outside HTTP routes.
	if !propertyscope.CanViewAll(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	if len(request.Publications) == 0 {
		return repo.ListPublications(ctx, tenantContext)
	}
	for _, item := range request.Publications {
		if item.IsEnabled != nil {
			// Publication state is exclusively owned by the canonical commands,
			// which enforce PropertyManage and durable delivery. This legacy
			// settings endpoint can edit only provider identity/product metadata.
			return nil, ErrCanonicalManaged
		}
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	integrationID, err := ensureGrupoOLXIntegration(ctx, tx, tenantContext)
	if err != nil {
		return nil, err
	}

	for _, item := range request.Publications {
		propertyID := strings.TrimSpace(item.PropertyID)
		if propertyID == "" || !validPublicationType(item.PublicationType) {
			return nil, ErrInvalidInput
		}
		var propertyCode string
		if err := tx.QueryRow(ctx, `
			select coalesce(code, '')
			from public.properties
			where id = $1::uuid
			  and organization_id = $2::uuid
			for update
		`, propertyID, tenantContext.OrganizationID).Scan(&propertyCode); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrInvalidInput
			}
			return nil, err
		}
		publicationType := normalizePublicationType(item.PublicationType)
		clientListingID := strings.TrimSpace(item.ClientListingID)
		if clientListingID == "" {
			clientListingID = normalizeClientListingID(propertyCode, propertyID)
		}
		clientListingID = normalizeClientListingID(clientListingID, propertyID)
		lockKey := "grupo_olx_listing_id:" + tenantContext.OrganizationID + ":" + integrationID + ":" + clientListingID
		if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, lockKey); err != nil {
			return nil, err
		}
		var listingIDConflict bool
		if err := tx.QueryRow(ctx, `
			select exists (
			  select 1
			  from public.property_channel_publications publication
			  where publication.organization_id = $1::uuid
			    and publication.channel = 'grupo_olx'
			    and publication.channel_account_key = $2
			    and publication.provider_listing_id = $3
			    and publication.property_id <> $4::uuid
			  union all
			  select 1
			  from public.portal_listing_publications legacy
			  where legacy.organization_id = $1::uuid
			    and legacy.integration_id = $2::uuid
			    and legacy.client_listing_id = $3
			    and legacy.property_id <> $4::uuid
			)
		`, tenantContext.OrganizationID, integrationID, clientListingID, propertyID).Scan(&listingIDConflict); err != nil {
			return nil, err
		}
		if listingIDConflict {
			return nil, ErrDuplicateListingID
		}

		var legacyClientListingID, legacyPublicationType string
		var legacyEnabled bool
		legacyExists := true
		err = tx.QueryRow(ctx, `
			select client_listing_id, publication_type, is_enabled
			from public.portal_listing_publications
			where integration_id = $1::uuid
			  and organization_id = $2::uuid
			  and property_id = $3::uuid
			limit 1
			for update
		`, integrationID, tenantContext.OrganizationID, propertyID).Scan(
			&legacyClientListingID, &legacyPublicationType, &legacyEnabled,
		)
		if errors.Is(err, pgx.ErrNoRows) {
			legacyExists = false
		} else if err != nil {
			return nil, err
		}
		if legacyExists && strings.TrimSpace(legacyClientListingID) != clientListingID {
			return nil, ErrCanonicalListingIDLocked
		}

		var canonicalProviderListingID *string
		var canonicalDesiredState, canonicalObservedState string
		var canonicalPublishedVersion *int64
		var canonicalPublicationType string
		canonicalManaged := true
		err = tx.QueryRow(ctx, `
			select provider_listing_id, desired_state, observed_state, published_version,
			       coalesce((
			         select version.payload->'channel_config'->>'publication_type'
			         from public.property_channel_publication_versions version
			         where version.publication_id = publication.id
			           and version.version = publication.current_version
			         limit 1
			       ), '')
			from public.property_channel_publications publication
			where publication.organization_id = $1::uuid
			  and publication.property_id = $2::uuid
			  and publication.channel = 'grupo_olx'
			  and publication.channel_account_key = $3
			limit 1
			for update
		`, tenantContext.OrganizationID, propertyID, integrationID).Scan(
			&canonicalProviderListingID,
			&canonicalDesiredState,
			&canonicalObservedState,
			&canonicalPublishedVersion,
			&canonicalPublicationType,
		)
		if errors.Is(err, pgx.ErrNoRows) {
			canonicalManaged = false
		} else if err != nil {
			return nil, err
		}
		if canonicalManaged && canonicalProviderListingID != nil && strings.TrimSpace(*canonicalProviderListingID) != clientListingID {
			return nil, ErrCanonicalListingIDLocked
		}
		fullyUnpublished := canonicalDesiredState == "unpublished" && canonicalObservedState == "unpublished" && canonicalPublishedVersion == nil
		if canonicalManaged && canonicalPublicationType != "" && normalizePublicationType(canonicalPublicationType) != publicationType && !fullyUnpublished {
			return nil, ErrCanonicalProductLocked
		}
		legacyProductChanged := legacyExists && normalizePublicationType(legacyPublicationType) != publicationType
		if legacyEnabled && legacyProductChanged && !fullyUnpublished {
			return nil, ErrCanonicalManaged
		}
		if legacyProductChanged && !fullyUnpublished {
			return nil, ErrCanonicalProductLocked
		}
		_, err = tx.Exec(ctx, `
			insert into public.portal_listing_publications (
				integration_id,
				organization_id,
				portal,
				property_id,
				client_listing_id,
				publication_type,
				is_enabled,
				status,
				updated_at
			)
			values ($1::uuid, $2::uuid, 'grupo_olx', $3::uuid, $4, $5, false, 'disabled', now())
			on conflict (integration_id, property_id)
			do update set
				publication_type = excluded.publication_type,
				updated_at = now()
		`, integrationID, tenantContext.OrganizationID, propertyID, clientListingID, publicationType)
		if err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return repo.ListPublications(ctx, tenantContext)
}

func ensureGrupoOLXIntegration(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `
		insert into public.portal_integrations (
			organization_id,
			portal,
			status,
			is_active,
			created_by,
			updated_at
		)
		values ($1::uuid, 'grupo_olx', 'draft', false, $2::uuid, now())
		on conflict (organization_id, portal)
		do update set updated_at = now()
		returning id::text
	`, tenantContext.OrganizationID, tenantContext.UserID).Scan(&id)
	return id, err
}

func normalizePublicationType(value string) string {
	value = strings.ToUpper(strings.TrimSpace(value))
	if value == "" {
		return "STANDARD"
	}
	if len(value) > 80 {
		return value[:80]
	}
	return value
}

func normalizeClientListingID(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		value = fallback
	}
	value = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '-'
	}, value)
	value = strings.Trim(value, "-_")
	if value == "" {
		value = strings.ReplaceAll(fallback, "-", "")
	}
	if len(value) > 50 {
		value = value[:50]
	}
	return value
}
