package portals

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/jsonvalue"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/propertyscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const maxChavesNaMaoFeedBytes = 30 * 1024 * 1024

func (repo Repository) GetChavesNaMao(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
	if err := repo.requireChavesNaMaoHomologation(); err != nil {
		return nil, err
	}
	return repo.getChavesNaMaoIntegrationJSON(ctx, tenantContext.OrganizationID)
}

func (repo Repository) getChavesNaMaoIntegrationJSON(ctx context.Context, organizationID string) (map[string]any, error) {
	var raw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		select jsonb_build_object(
			'id', integration.id::text,
			'organization_id', integration.organization_id::text,
			'portal', integration.portal,
			'status', integration.status,
			'is_active', integration.is_active,
			'feed_token', integration.feed_token,
			'settings', integration.settings,
			'last_feed_accessed_at', integration.last_feed_accessed_at,
			'last_sync_status', integration.last_sync_status,
			'last_error', integration.last_error,
			'lead_webhook_available', false,
			'lead_webhook_blocker', 'Contrato publico de leads indisponivel; requer homologacao oficial.',
			'created_at', integration.created_at,
			'updated_at', integration.updated_at
		)
		from public.portal_integrations integration
		where integration.organization_id = $1::uuid
		  and integration.portal = 'chaves_na_mao'
		limit 1
	`, organizationID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return decodeChavesNaMaoIntegration(raw)
}

func decodeChavesNaMaoIntegration(raw []byte) (map[string]any, error) {
	item, err := jsonvalue.DecodeObjectAllowBlank(raw)
	if err != nil {
		return nil, err
	}
	settings, _ := item["settings"].(map[string]any)
	normalized, normalizeErr := normalizeGrupoOLXSettings(settings, false)
	if normalizeErr != nil || normalized == nil {
		normalized = map[string]any{}
	}
	item["settings"] = normalized
	delete(item, "webhook_token")
	return item, nil
}

func (repo Repository) SaveChavesNaMao(
	ctx context.Context,
	tenantContext tenant.Context,
	request ChavesNaMaoSettingsRequest,
) (map[string]any, error) {
	if err := repo.requireChavesNaMaoHomologation(); err != nil {
		return nil, err
	}
	settings, err := normalizeGrupoOLXSettings(request.Settings, true)
	if err != nil {
		return nil, err
	}
	settingsJSON, err := json.Marshal(nonNilMap(settings))
	if err != nil {
		return nil, err
	}
	var raw []byte
	err = repo.db.Pool().QueryRow(ctx, `
		insert into public.portal_integrations (
			organization_id, portal, status, is_active, settings, created_by, updated_at
		) values ($1::uuid, 'chaves_na_mao', 'draft', false, $2::jsonb, $3::uuid, now())
		on conflict (organization_id, portal)
		do update set
			settings = case when $4::boolean then excluded.settings else portal_integrations.settings end,
			last_error = null,
			updated_at = now()
		returning jsonb_build_object(
			'id', portal_integrations.id::text,
			'organization_id', portal_integrations.organization_id::text,
			'portal', portal_integrations.portal,
			'status', portal_integrations.status,
			'is_active', portal_integrations.is_active,
			'feed_token', portal_integrations.feed_token,
			'settings', portal_integrations.settings,
			'last_feed_accessed_at', portal_integrations.last_feed_accessed_at,
			'last_sync_status', portal_integrations.last_sync_status,
			'last_error', portal_integrations.last_error,
			'lead_webhook_available', false,
			'lead_webhook_blocker', 'Contrato publico de leads indisponivel; requer homologacao oficial.',
			'created_at', portal_integrations.created_at,
			'updated_at', portal_integrations.updated_at
		)
	`, tenantContext.OrganizationID, string(settingsJSON), tenantContext.UserID, request.Settings != nil).Scan(&raw)
	if err != nil {
		return nil, err
	}
	return decodeChavesNaMaoIntegration(raw)
}

func (repo Repository) ActivateChavesNaMao(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
	if err := repo.requireChavesNaMaoHomologation(); err != nil {
		return nil, err
	}
	if _, err := repo.db.Pool().Exec(ctx, `
		insert into public.portal_integrations (organization_id, portal, status, is_active, created_by, updated_at)
		values ($1::uuid, 'chaves_na_mao', 'pending_setup', true, $2::uuid, now())
		on conflict (organization_id, portal)
		do update set
			status = case when portal_integrations.status = 'connected' then 'connected' else 'pending_setup' end,
			is_active = true,
			last_error = null,
			updated_at = now()
	`, tenantContext.OrganizationID, tenantContext.UserID); err != nil {
		return nil, err
	}
	return repo.getChavesNaMaoIntegrationJSON(ctx, tenantContext.OrganizationID)
}

func (repo Repository) PauseChavesNaMao(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
	if err := repo.requireChavesNaMaoHomologation(); err != nil {
		return nil, err
	}
	command, err := repo.db.Pool().Exec(ctx, `
		update public.portal_integrations
		set status = 'paused', is_active = false, last_error = null, updated_at = clock_timestamp()
		where organization_id = $1::uuid and portal = 'chaves_na_mao'
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	if command.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	// Preserve the token and serve an empty drain feed so already queued
	// advertisements can be removed by the provider.
	return repo.getChavesNaMaoIntegrationJSON(ctx, tenantContext.OrganizationID)
}

func (repo Repository) RegenerateChavesNaMaoFeedToken(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
	if err := repo.requireChavesNaMaoHomologation(); err != nil {
		return nil, err
	}
	command, err := repo.db.Pool().Exec(ctx, `
		update public.portal_integrations
		set feed_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
		    updated_at = now()
		where organization_id = $1::uuid and portal = 'chaves_na_mao'
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	if command.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return repo.getChavesNaMaoIntegrationJSON(ctx, tenantContext.OrganizationID)
}

func (repo Repository) integrationByChavesNaMaoFeedToken(ctx context.Context, token string) (publicIntegration, error) {
	token = strings.TrimSuffix(strings.TrimSpace(token), ".xml")
	if token == "" {
		return publicIntegration{}, ErrInvalidInput
	}
	var integration publicIntegration
	var settingsRaw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		select id::text, organization_id::text, status, is_active, settings, created_at
		from public.portal_integrations
		where feed_token = $1 and portal = 'chaves_na_mao'
		limit 1
	`, token).Scan(
		&integration.ID,
		&integration.OrganizationID,
		&integration.Status,
		&integration.IsActive,
		&settingsRaw,
		&integration.FeedPublishedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return publicIntegration{}, ErrNotFound
	}
	if err != nil {
		return publicIntegration{}, err
	}
	_ = json.Unmarshal(settingsRaw, &integration.Settings)
	integration.Settings, err = normalizeGrupoOLXSettings(integration.Settings, false)
	if err != nil || integration.Settings == nil {
		integration.Settings = map[string]any{}
	}
	integration.ModuleEnabled, err = repo.portalModuleEnabled(ctx, integration.OrganizationID)
	if err != nil {
		return publicIntegration{}, err
	}
	return integration, nil
}

func (repo Repository) BuildChavesNaMaoFeed(ctx context.Context, token string) ([]byte, error) {
	if err := repo.requireChavesNaMaoHomologation(); err != nil {
		return nil, err
	}
	integration, err := repo.integrationByChavesNaMaoFeedToken(ctx, token)
	if err != nil {
		return nil, err
	}
	if integration.Status == "draft" || (!integration.IsActive && integration.Status != "paused") {
		return nil, ErrFeedNotActivated
	}
	feedActive := integration.IsActive && integration.Status != "paused" && integration.ModuleEnabled
	listings := []feedListing{}
	invalid := map[string][]string{}
	if feedActive {
		listings, invalid, err = repo.chavesNaMaoFeedListings(ctx, integration)
		if err != nil {
			return nil, err
		}
	}
	body, err := buildChavesNaMaoFeed(integration, listings)
	if err != nil {
		return nil, err
	}
	if len(body) > maxChavesNaMaoFeedBytes {
		return nil, ErrChavesNaMaoFeedSize
	}

	validIDs := make([]string, 0, len(listings))
	for _, listing := range listings {
		validIDs = append(validIDs, listing.PublicationID)
	}
	invalidJSON, err := json.Marshal(invalid)
	if err != nil {
		return nil, err
	}
	syncStatus := fmt.Sprintf("feed_served:valid=%d:invalid=%d", len(listings), len(invalid))
	integrationStatus := "connected"
	lastError := ""
	if !feedActive {
		syncStatus = "feed_draining:integration_inactive"
		integrationStatus = integration.Status
	} else if len(listings) == 0 && len(invalid) > 0 {
		integrationStatus = "error"
		lastError = "Todos os imoveis habilitados possuem erros de validacao."
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		update public.portal_integrations
		set last_feed_accessed_at = now(),
		    last_sync_status = $2,
		    status = case when $5::boolean then $3 else status end,
		    last_error = nullif($4, '')
		where id = $1::uuid and portal = 'chaves_na_mao'
	`, integration.ID, syncStatus, integrationStatus, lastError, feedActive); err != nil {
		return nil, err
	}
	if len(validIDs) > 0 {
		if _, err := tx.Exec(ctx, `
			update public.portal_listing_publications
			set status = 'exported',
			    last_exported_at = now(),
			    last_seen_in_feed_at = now(),
			    validation_errors = '[]'::jsonb,
			    last_error = null
			where integration_id = $1::uuid
			  and portal = 'chaves_na_mao'
			  and id = any($2::uuid[])
		`, integration.ID, validIDs); err != nil {
			return nil, err
		}
	}
	if len(invalid) > 0 {
		if _, err := tx.Exec(ctx, `
			update public.portal_listing_publications publication
			set status = 'invalid',
			    validation_errors = invalid.errors,
			    last_error = invalid.errors->>0
			from jsonb_each($2::jsonb) invalid(publication_id, errors)
			where publication.integration_id = $1::uuid
			  and publication.portal = 'chaves_na_mao'
			  and publication.id = invalid.publication_id::uuid
		`, integration.ID, string(invalidJSON)); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return body, nil
}

func (repo Repository) chavesNaMaoFeedListings(
	ctx context.Context,
	integration publicIntegration,
) ([]feedListing, map[string][]string, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select jsonb_build_object(
			'publication_id', publication.id::text,
			'property_id', publication.property_id::text,
			'source', 'legacy',
			'version_id', '',
			'published_version', 0,
			'payload_hash', '',
			'client_listing_id', publication.client_listing_id,
			'publication_type', publication.publication_type,
			'property', to_jsonb(property),
			'media', '[]'::jsonb
		)
		from public.portal_listing_publications publication
		join public.properties property
		  on property.id = publication.property_id
		 and property.organization_id = publication.organization_id
		where publication.integration_id = $1::uuid
		  and publication.organization_id = $2::uuid
		  and publication.portal = 'chaves_na_mao'
		  and publication.is_enabled = true
		order by property.updated_at desc, publication.id
		limit 50001
	`, integration.ID, integration.OrganizationID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	listings := []feedListing{}
	invalid := map[string][]string{}
	count := 0
	for rows.Next() {
		count++
		if err := ensureChavesNaMaoFeedLimit(count); err != nil {
			return nil, nil, err
		}
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, nil, err
		}
		var listing feedListing
		if err := json.Unmarshal(raw, &listing); err != nil {
			return nil, nil, err
		}
		if validationErrors := validateChavesNaMaoListing(integration, listing); len(validationErrors) > 0 {
			invalid[listing.PublicationID] = validationErrors
			continue
		}
		listings = append(listings, listing)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	return listings, invalid, nil
}

func (repo Repository) ListChavesNaMaoPublications(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	if !propertyscope.CanRead(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if err := repo.requireChavesNaMaoHomologation(); err != nil {
		return nil, err
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select jsonb_build_object(
			'id', publication.id::text,
			'integration_id', publication.integration_id::text,
			'property_id', publication.property_id::text,
			'client_listing_id', publication.client_listing_id,
			'publication_type', publication.publication_type,
			'is_enabled', publication.is_enabled,
			'status', publication.status,
			'validation_errors', publication.validation_errors,
			'last_exported_at', publication.last_exported_at,
			'last_seen_in_feed_at', publication.last_seen_in_feed_at,
			'last_error', publication.last_error,
			'created_at', publication.created_at,
			'updated_at', publication.updated_at,
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
		from public.portal_listing_publications publication
		join public.portal_integrations integration
		  on integration.id = publication.integration_id
		 and integration.organization_id = publication.organization_id
		join public.properties property
		  on property.id = publication.property_id
		 and property.organization_id = publication.organization_id
		 and `+propertyscope.VisibilitySQL("property", "$2", "$3", "$4")+`
		where publication.organization_id = $1::uuid
		  and publication.portal = 'chaves_na_mao'
		  and integration.portal = 'chaves_na_mao'
		order by publication.updated_at desc, publication.id
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

func (repo Repository) UpsertChavesNaMaoPublications(
	ctx context.Context,
	tenantContext tenant.Context,
	request UpsertPublicationsRequest,
) ([]map[string]any, error) {
	// Publication identity and enabled state affect an external listing. Keep
	// this manager-only even when the repository is called outside HTTP routes.
	if !propertyscope.CanViewAll(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if err := repo.requireChavesNaMaoHomologation(); err != nil {
		return nil, err
	}

	if len(request.Publications) == 0 {
		return repo.ListChavesNaMaoPublications(ctx, tenantContext)
	}
	if len(request.Publications) > 1000 {
		return nil, ErrInvalidInput
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	integrationID, err := ensureChavesNaMaoIntegration(ctx, tx, tenantContext)
	if err != nil {
		return nil, err
	}
	for _, item := range request.Publications {
		propertyID := strings.TrimSpace(item.PropertyID)
		if propertyID == "" || !validChavesNaMaoPublicationType(item.PublicationType) {
			return nil, ErrInvalidInput
		}
		var propertyCode string
		if err := tx.QueryRow(ctx, `
			select coalesce(code, '')
			from public.properties
			where id = $1::uuid and organization_id = $2::uuid
			for update
		`, propertyID, tenantContext.OrganizationID).Scan(&propertyCode); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrInvalidInput
			}
			return nil, err
		}
		fallbackListingID := normalizeClientListingID(propertyCode, propertyID)
		clientListingID := normalizeClientListingID(item.ClientListingID, fallbackListingID)
		publicationType := normalizeChavesNaMaoPublicationType(item.PublicationType)
		lockKey := "chaves_na_mao_listing_id:" + tenantContext.OrganizationID + ":" + integrationID + ":" + clientListingID
		if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, lockKey); err != nil {
			return nil, err
		}
		var conflict bool
		if err := tx.QueryRow(ctx, `
			select exists (
				select 1
				from public.portal_listing_publications
				where integration_id = $1::uuid
				  and portal = 'chaves_na_mao'
				  and client_listing_id = $2
				  and property_id <> $3::uuid
			)
		`, integrationID, clientListingID, propertyID).Scan(&conflict); err != nil {
			return nil, err
		}
		if conflict {
			return nil, ErrDuplicateListingID
		}
		enabled := true
		if item.IsEnabled != nil {
			enabled = *item.IsEnabled
		} else {
			_ = tx.QueryRow(ctx, `
				select is_enabled
				from public.portal_listing_publications
				where integration_id = $1::uuid and property_id = $2::uuid
			`, integrationID, propertyID).Scan(&enabled)
		}
		if _, err := tx.Exec(ctx, `
			insert into public.portal_listing_publications (
				integration_id,
				organization_id,
				portal,
				property_id,
				client_listing_id,
				publication_type,
				is_enabled,
				status,
				validation_errors,
				last_error,
				updated_at
			) values (
				$1::uuid,
				$2::uuid,
				'chaves_na_mao',
				$3::uuid,
				$4,
				$5,
				$6,
				case when $6 then 'pending' else 'disabled' end,
				'[]'::jsonb,
				null,
				now()
			)
			on conflict (integration_id, property_id)
			do update set
				client_listing_id = excluded.client_listing_id,
				publication_type = excluded.publication_type,
				is_enabled = excluded.is_enabled,
				status = excluded.status,
				validation_errors = '[]'::jsonb,
				last_error = null,
				updated_at = now()
		`, integrationID, tenantContext.OrganizationID, propertyID, clientListingID, publicationType, enabled); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return repo.ListChavesNaMaoPublications(ctx, tenantContext)
}

func ensureChavesNaMaoIntegration(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `
		insert into public.portal_integrations (
			organization_id, portal, status, is_active, created_by, updated_at
		) values ($1::uuid, 'chaves_na_mao', 'draft', false, $2::uuid, now())
		on conflict (organization_id, portal)
		do update set updated_at = now()
		returning id::text
	`, tenantContext.OrganizationID, tenantContext.UserID).Scan(&id)
	return id, err
}
