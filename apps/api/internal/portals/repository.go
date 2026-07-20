package portals

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db *dbpkg.Postgres
}

func NewRepository(db *dbpkg.Postgres) Repository {
	return Repository{db: db}
}

func (repo Repository) GetGrupoOLX(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
	return repo.getIntegrationJSON(ctx, tenantContext.OrganizationID)
}

func (repo Repository) validateIntegrationReferences(ctx context.Context, organizationID string, request GrupoOLXSettingsRequest) error {
	pipelineID := optionalUUIDText(request.DefaultPipelineID)
	stageID := optionalUUIDText(request.DefaultStageID)
	assignedUserID := optionalUUIDText(request.DefaultAssignedUserID)
	roundRobinID := optionalUUIDText(request.DefaultRoundRobinID)

	var valid bool
	err := repo.db.Pool().QueryRow(ctx, `
		select
			($2 = '' or exists (
				select 1 from public.pipelines p
				where p.organization_id = $1::uuid and p.id = nullif($2, '')::uuid and coalesce(p.is_active, true)
			))
			and ($3 = '' or exists (
				select 1 from public.stages s
				join public.pipelines p on p.id = s.pipeline_id and p.organization_id = s.organization_id
				where s.organization_id = $1::uuid
				  and s.id = nullif($3, '')::uuid
				  and coalesce(s.is_active, true)
				  and ($2 = '' or s.pipeline_id = nullif($2, '')::uuid)
			))
			and ($4 = '' or exists (
				select 1 from public.organization_members om
				join public.users u on u.id = om.user_id
				where om.organization_id = $1::uuid
				  and om.user_id = nullif($4, '')::uuid
				  and coalesce(om.is_active, true)
				  and coalesce(u.is_active, true)
			))
			and ($5 = '' or exists (
				select 1 from public.round_robins rr
				where rr.organization_id = $1::uuid and rr.id = nullif($5, '')::uuid and coalesce(rr.is_active, true)
			))
	`, organizationID, pipelineID, stageID, assignedUserID, roundRobinID).Scan(&valid)
	if err != nil {
		return err
	}
	if !valid {
		return ErrInvalidInput
	}
	return nil
}

func (repo Repository) hydrateExistingReferences(ctx context.Context, organizationID string, request *GrupoOLXSettingsRequest) error {
	var pipelineID, stageID, assignedUserID, roundRobinID string
	err := repo.db.Pool().QueryRow(ctx, `
		select coalesce(default_pipeline_id::text, ''), coalesce(default_stage_id::text, ''),
		       coalesce(default_assigned_user_id::text, ''), coalesce(default_round_robin_id::text, '')
		from public.portal_integrations
		where organization_id = $1::uuid and portal = 'grupo_olx'
	`, organizationID).Scan(&pipelineID, &stageID, &assignedUserID, &roundRobinID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	setExistingOptionalString(&request.DefaultPipelineID, pipelineID)
	setExistingOptionalString(&request.DefaultStageID, stageID)
	setExistingOptionalString(&request.DefaultAssignedUserID, assignedUserID)
	setExistingOptionalString(&request.DefaultRoundRobinID, roundRobinID)
	return nil
}

func setExistingOptionalString(field *OptionalString, value string) {
	if field.Set || strings.TrimSpace(value) == "" {
		return
	}
	cleaned := strings.TrimSpace(value)
	field.Value = &cleaned
}

func (repo Repository) validateActivationSettings(ctx context.Context, organizationID string, request GrupoOLXSettingsRequest) error {
	settings := map[string]any{}
	secretConfigured := false
	var raw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		select settings, lead_webhook_secret_ref is not null
		from public.portal_integrations
		where organization_id = $1::uuid and portal = 'grupo_olx'
	`, organizationID).Scan(&raw, &secretConfigured)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if err == nil {
		_ = json.Unmarshal(raw, &settings)
	}
	if request.Settings != nil {
		settings = request.Settings
	}
	if request.LeadWebhookSecret.Set {
		secretConfigured = request.LeadWebhookSecret.Value != nil
	}
	name := strings.TrimSpace(textFromSettings(settings, "contact_name"))
	email := strings.TrimSpace(textFromSettings(settings, "contact_email"))
	if name == "" || email == "" || !secretConfigured {
		return ErrInvalidInput
	}
	address, err := mail.ParseAddress(email)
	if err != nil || !strings.EqualFold(address.Address, email) {
		return ErrInvalidInput
	}
	if detailURL := strings.TrimSpace(textFromSettings(settings, "detail_base_url")); detailURL != "" {
		parsed, err := url.ParseRequestURI(detailURL)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
			return ErrInvalidInput
		}
	}
	return nil
}

func (repo Repository) SaveGrupoOLX(ctx context.Context, tenantContext tenant.Context, request GrupoOLXSettingsRequest) (map[string]any, error) {
	isActive := false
	status := "draft"
	if request.IsActive != nil {
		isActive = *request.IsActive
		status = "paused"
		if isActive {
			status = "pending_setup"
		}
	}
	settingsJSON, _ := json.Marshal(nonNilMap(request.Settings))
	if err := repo.hydrateExistingReferences(ctx, tenantContext.OrganizationID, &request); err != nil {
		return nil, err
	}
	if err := repo.validateIntegrationReferences(ctx, tenantContext.OrganizationID, request); err != nil {
		return nil, err
	}
	if request.LeadWebhookSecret.Value != nil && len(*request.LeadWebhookSecret.Value) < 16 {
		return nil, ErrInvalidInput
	}
	if isActive {
		if err := repo.validateActivationSettings(ctx, tenantContext.OrganizationID, request); err != nil {
			return nil, err
		}
	}
	var secretRef any
	if request.LeadWebhookSecret.Value != nil {
		secretRef = webhookSecretDigest(*request.LeadWebhookSecret.Value)
	}

	var raw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		insert into public.portal_integrations (
			organization_id,
			portal,
			status,
			is_active,
			lead_webhook_secret_ref,
			default_pipeline_id,
			default_stage_id,
			default_assigned_user_id,
			default_round_robin_id,
			settings,
			created_by,
			updated_at
		)
		values (
			$1::uuid,
			'grupo_olx',
			$2,
			$3,
			$4,
			nullif($5, '')::uuid,
			nullif($6, '')::uuid,
			nullif($7, '')::uuid,
			nullif($8, '')::uuid,
			$9::jsonb,
			$10::uuid,
			now()
		)
		on conflict (organization_id, portal)
		do update set
			status = case
				when not $16 then portal_integrations.status
				when excluded.is_active = false then 'paused'
				when portal_integrations.status = 'connected' then 'connected'
				else excluded.status
			end,
			is_active = case when $16 then excluded.is_active else portal_integrations.is_active end,
			lead_webhook_secret_ref = case when $11 then excluded.lead_webhook_secret_ref else portal_integrations.lead_webhook_secret_ref end,
			default_pipeline_id = case when $12 then excluded.default_pipeline_id else portal_integrations.default_pipeline_id end,
			default_stage_id = case when $13 then excluded.default_stage_id else portal_integrations.default_stage_id end,
			default_assigned_user_id = case when $14 then excluded.default_assigned_user_id else portal_integrations.default_assigned_user_id end,
			default_round_robin_id = case when $15 then excluded.default_round_robin_id else portal_integrations.default_round_robin_id end,
			settings = case when $17 then excluded.settings else portal_integrations.settings end,
			last_error = null,
			updated_at = now()
		returning jsonb_build_object(
			'id', portal_integrations.id::text,
			'organization_id', portal_integrations.organization_id::text,
			'portal', portal_integrations.portal,
			'status', portal_integrations.status,
			'is_active', portal_integrations.is_active,
			'feed_token', portal_integrations.feed_token,
			'webhook_token', portal_integrations.webhook_token,
			'lead_webhook_secret_configured', portal_integrations.lead_webhook_secret_ref is not null,
			'default_pipeline_id', portal_integrations.default_pipeline_id::text,
			'default_stage_id', portal_integrations.default_stage_id::text,
			'default_assigned_user_id', portal_integrations.default_assigned_user_id::text,
			'default_round_robin_id', portal_integrations.default_round_robin_id::text,
			'settings', portal_integrations.settings,
			'last_feed_accessed_at', portal_integrations.last_feed_accessed_at,
			'last_lead_received_at', portal_integrations.last_lead_received_at,
			'last_import_report_at', portal_integrations.last_import_report_at,
			'last_sync_status', portal_integrations.last_sync_status,
			'last_error', portal_integrations.last_error,
			'created_at', portal_integrations.created_at,
			'updated_at', portal_integrations.updated_at
		)
	`, tenantContext.OrganizationID, status, isActive, secretRef,
		optionalUUIDValue(request.DefaultPipelineID), optionalUUIDValue(request.DefaultStageID),
		optionalUUIDValue(request.DefaultAssignedUserID), optionalUUIDValue(request.DefaultRoundRobinID),
		string(settingsJSON), tenantContext.UserID, request.LeadWebhookSecret.Set,
		request.DefaultPipelineID.Set, request.DefaultStageID.Set,
		request.DefaultAssignedUserID.Set, request.DefaultRoundRobinID.Set,
		request.IsActive != nil, request.Settings != nil).Scan(&raw)
	if err != nil {
		return nil, err
	}
	return decodeJSONObject(raw)
}

func (repo Repository) ActivateGrupoOLX(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
	if err := repo.validateActivationSettings(ctx, tenantContext.OrganizationID, GrupoOLXSettingsRequest{}); err != nil {
		return nil, err
	}
	var raw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		insert into public.portal_integrations (
			organization_id,
			portal,
			status,
			is_active,
			created_by,
			updated_at
		)
		values ($1::uuid, 'grupo_olx', 'pending_setup', true, $2::uuid, now())
		on conflict (organization_id, portal)
		do update set
			status = case when portal_integrations.status = 'connected' then 'connected' else 'pending_setup' end,
			is_active = true,
			last_error = null,
			updated_at = now()
		returning jsonb_build_object(
			'id', portal_integrations.id::text,
			'organization_id', portal_integrations.organization_id::text,
			'portal', portal_integrations.portal,
			'status', portal_integrations.status,
			'is_active', portal_integrations.is_active,
			'feed_token', portal_integrations.feed_token,
			'webhook_token', portal_integrations.webhook_token,
			'lead_webhook_secret_configured', portal_integrations.lead_webhook_secret_ref is not null,
			'default_pipeline_id', portal_integrations.default_pipeline_id::text,
			'default_stage_id', portal_integrations.default_stage_id::text,
			'default_assigned_user_id', portal_integrations.default_assigned_user_id::text,
			'default_round_robin_id', portal_integrations.default_round_robin_id::text,
			'settings', portal_integrations.settings,
			'last_feed_accessed_at', portal_integrations.last_feed_accessed_at,
			'last_lead_received_at', portal_integrations.last_lead_received_at,
			'last_import_report_at', portal_integrations.last_import_report_at,
			'last_sync_status', portal_integrations.last_sync_status,
			'last_error', portal_integrations.last_error,
			'created_at', portal_integrations.created_at,
			'updated_at', portal_integrations.updated_at
		)
	`, tenantContext.OrganizationID, tenantContext.UserID).Scan(&raw)
	if err != nil {
		return nil, err
	}
	return decodeJSONObject(raw)
}

func (repo Repository) RegenerateFeedToken(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
	var raw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		update public.portal_integrations
		set feed_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
		    updated_at = now()
		where organization_id = $1::uuid
		  and portal = 'grupo_olx'
		returning jsonb_build_object(
			'id', portal_integrations.id::text,
			'organization_id', portal_integrations.organization_id::text,
			'portal', portal_integrations.portal,
			'status', portal_integrations.status,
			'is_active', portal_integrations.is_active,
			'feed_token', portal_integrations.feed_token,
			'webhook_token', portal_integrations.webhook_token,
			'lead_webhook_secret_configured', portal_integrations.lead_webhook_secret_ref is not null,
			'default_pipeline_id', portal_integrations.default_pipeline_id::text,
			'default_stage_id', portal_integrations.default_stage_id::text,
			'default_assigned_user_id', portal_integrations.default_assigned_user_id::text,
			'default_round_robin_id', portal_integrations.default_round_robin_id::text,
			'settings', portal_integrations.settings,
			'last_feed_accessed_at', portal_integrations.last_feed_accessed_at,
			'last_lead_received_at', portal_integrations.last_lead_received_at,
			'last_import_report_at', portal_integrations.last_import_report_at,
			'last_sync_status', portal_integrations.last_sync_status,
			'last_error', portal_integrations.last_error,
			'created_at', portal_integrations.created_at,
			'updated_at', portal_integrations.updated_at
		)
	`, tenantContext.OrganizationID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return decodeJSONObject(raw)
}

func (repo Repository) RegenerateWebhookToken(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
	command, err := repo.db.Pool().Exec(ctx, `
		update public.portal_integrations
		set webhook_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
		    updated_at = now()
		where organization_id = $1::uuid
		  and portal = 'grupo_olx'
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	if command.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return repo.getIntegrationJSON(ctx, tenantContext.OrganizationID)
}

func (repo Repository) ListPublications(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select jsonb_build_object(
			'id', plp.id::text,
			'integration_id', plp.integration_id::text,
			'property_id', plp.property_id::text,
			'client_listing_id', plp.client_listing_id,
			'publication_type', plp.publication_type,
			'is_enabled', plp.is_enabled,
			'status', plp.status,
			'validation_errors', plp.validation_errors,
			'last_exported_at', plp.last_exported_at,
			'last_seen_in_feed_at', plp.last_seen_in_feed_at,
			'last_error', plp.last_error,
			'created_at', plp.created_at,
			'updated_at', plp.updated_at,
			'property', jsonb_build_object(
				'id', p.id::text,
				'code', p.code,
				'title', p.title,
				'status', p.status,
				'tipo_de_negocio', p.tipo_de_negocio,
				'tipo_de_imovel', p.tipo_de_imovel,
				'cidade', p.cidade,
				'bairro', p.bairro,
				'preco', p.preco,
				'valor_locacao', p.valor_locacao,
				'imagem_principal', p.imagem_principal
			)
		)
		from public.portal_listing_publications plp
		join public.portal_integrations pi on pi.id = plp.integration_id
		join public.properties p on p.id = plp.property_id
		where plp.organization_id = $1::uuid
		  and plp.portal = 'grupo_olx'
		order by plp.updated_at desc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanJSONRows(rows)
}

func (repo Repository) UpsertPublications(ctx context.Context, tenantContext tenant.Context, request UpsertPublicationsRequest) ([]map[string]any, error) {
	if len(request.Publications) == 0 {
		return repo.ListPublications(ctx, tenantContext)
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
		`, propertyID, tenantContext.OrganizationID).Scan(&propertyCode); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrInvalidInput
			}
			return nil, err
		}
		isEnabled := true
		if item.IsEnabled != nil {
			isEnabled = *item.IsEnabled
		}
		publicationType := normalizePublicationType(item.PublicationType)
		clientListingID := strings.TrimSpace(item.ClientListingID)
		if clientListingID == "" {
			clientListingID = normalizeClientListingID(propertyCode, propertyID)
		}
		clientListingID = normalizeClientListingID(clientListingID, propertyID)

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
			values ($1::uuid, $2::uuid, 'grupo_olx', $3::uuid, $4, $5, $6, case when $6 then 'pending' else 'disabled' end, now())
			on conflict (integration_id, property_id)
			do update set
				client_listing_id = excluded.client_listing_id,
				publication_type = excluded.publication_type,
				is_enabled = excluded.is_enabled,
				status = case when excluded.is_enabled then 'pending' else 'disabled' end,
				updated_at = now()
		`, integrationID, tenantContext.OrganizationID, propertyID, clientListingID, publicationType, isEnabled)
		if err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return repo.ListPublications(ctx, tenantContext)
}

func (repo Repository) BuildGrupoOLXFeed(ctx context.Context, token string) ([]byte, error) {
	integration, err := repo.integrationByPublicToken(ctx, token, "feed_token")
	if err != nil {
		return nil, err
	}
	selection, err := repo.feedListings(ctx, integration)
	if err != nil {
		return nil, err
	}
	xmlBytes, err := buildVRSyncFeed(integration, selection.Listings)
	if err != nil {
		return nil, err
	}
	if len(xmlBytes) > 30*1024*1024 {
		return nil, fmt.Errorf("grupo olx feed exceeds 30MB")
	}

	validIDs := make([]string, 0, len(selection.Listings))
	for _, listing := range selection.Listings {
		validIDs = append(validIDs, listing.PublicationID)
	}
	invalidJSON, err := json.Marshal(selection.Invalid)
	if err != nil {
		return nil, err
	}
	syncStatus := fmt.Sprintf("feed_served:valid=%d:invalid=%d", len(validIDs), len(selection.Invalid))
	integrationStatus := "connected"
	lastError := ""
	if len(validIDs) == 0 && len(selection.Invalid) > 0 {
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
		    status = $3,
		    last_error = nullif($4, ''),
		    updated_at = now()
		where id = $1::uuid
	`, integration.ID, syncStatus, integrationStatus, lastError); err != nil {
		return nil, err
	}
	if len(validIDs) > 0 {
		if _, err := tx.Exec(ctx, `
			update public.portal_listing_publications
			set status = 'exported',
			    last_exported_at = now(),
			    last_seen_in_feed_at = now(),
			    validation_errors = '[]'::jsonb,
			    last_error = null,
			    updated_at = now()
			where integration_id = $1::uuid
			  and id = any($2::uuid[])
		`, integration.ID, validIDs); err != nil {
			return nil, err
		}
	}
	if len(selection.Invalid) > 0 {
		if _, err := tx.Exec(ctx, `
			update public.portal_listing_publications publication
			set status = 'invalid',
			    validation_errors = invalid.errors,
			    last_error = invalid.errors->>0,
			    updated_at = now()
			from jsonb_each($2::jsonb) as invalid(publication_id, errors)
			where publication.integration_id = $1::uuid
			  and publication.id = invalid.publication_id::uuid
		`, integration.ID, string(invalidJSON)); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return xmlBytes, nil
}

type portalDestination struct {
	PipelineID         string
	StageID            string
	AssignedUserID     string
	TeamID             string
	RoundRobinID       string
	RoundRobinMemberID string
}

func (repo Repository) resolvePortalDestination(ctx context.Context, tx pgx.Tx, integration publicIntegration) (portalDestination, error) {
	destination := portalDestination{
		PipelineID:     integration.DefaultPipelineID,
		StageID:        integration.DefaultStageID,
		AssignedUserID: integration.DefaultAssignedUserID,
	}

	if integration.DefaultRoundRobinID != "" {
		var queuePipelineID, queueStageID string
		err := tx.QueryRow(ctx, `
			select coalesce(target_pipeline_id::text, ''), coalesce(target_stage_id::text, '')
			from public.round_robins
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and coalesce(is_active, true)
			for update
		`, integration.OrganizationID, integration.DefaultRoundRobinID).Scan(&queuePipelineID, &queueStageID)
		if errors.Is(err, pgx.ErrNoRows) {
			return portalDestination{}, ErrInvalidInput
		}
		if err != nil {
			return portalDestination{}, err
		}
		memberID, userID, teamID, err := selectPortalRoundRobinMember(ctx, tx, integration.OrganizationID, integration.DefaultRoundRobinID)
		if err != nil {
			return portalDestination{}, err
		}
		if userID == "" {
			return portalDestination{}, errors.New("grupo olx round robin has no available member")
		}
		destination.RoundRobinID = integration.DefaultRoundRobinID
		destination.RoundRobinMemberID = memberID
		destination.AssignedUserID = userID
		destination.TeamID = teamID
		if destination.PipelineID == "" {
			destination.PipelineID = queuePipelineID
		}
		if destination.StageID == "" {
			destination.StageID = queueStageID
		}
	}

	if destination.StageID != "" {
		var pipelineID string
		err := tx.QueryRow(ctx, `
			select pipeline_id::text
			from public.stages
			where organization_id = $1::uuid and id = $2::uuid and coalesce(is_active, true)
		`, integration.OrganizationID, destination.StageID).Scan(&pipelineID)
		if err != nil {
			return portalDestination{}, err
		}
		destination.PipelineID = pipelineID
	}
	if destination.PipelineID == "" {
		err := tx.QueryRow(ctx, `
			select id::text
			from public.pipelines
			where organization_id = $1::uuid and coalesce(is_active, true)
			order by is_default desc, position asc, created_at asc
			limit 1
		`, integration.OrganizationID).Scan(&destination.PipelineID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return portalDestination{}, err
		}
	}
	if destination.PipelineID != "" && destination.StageID == "" {
		err := tx.QueryRow(ctx, `
			select id::text
			from public.stages
			where organization_id = $1::uuid and pipeline_id = $2::uuid and coalesce(is_active, true)
			order by position asc, created_at asc
			limit 1
		`, integration.OrganizationID, destination.PipelineID).Scan(&destination.StageID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return portalDestination{}, err
		}
	}
	return destination, nil
}

func selectPortalRoundRobinMember(ctx context.Context, tx pgx.Tx, organizationID string, roundRobinID string) (string, string, string, error) {
	var memberID, userID, teamID string
	err := tx.QueryRow(ctx, `
		with entries as (
			select rrm.id, rrm.round_robin_id, rrm.organization_id, rrm.user_id, rrm.team_id,
			       coalesce(rrm.position, 0) as position, rrm.created_at
			from public.round_robin_members rrm
			where rrm.organization_id = $1::uuid
			  and rrm.round_robin_id = $2::uuid
			  and coalesce(rrm.is_active, true)
		), candidates as (
			select entries.id, entries.round_robin_id, entries.organization_id, entries.user_id,
			       entries.team_id, entries.position, entries.created_at,
			       tm.id as team_member_id, tm.created_at as team_member_created_at
			from entries
			left join public.team_members tm
			  on tm.organization_id = entries.organization_id
			 and tm.team_id = entries.team_id
			 and tm.user_id = entries.user_id
			 and coalesce(tm.is_active, true)
			where entries.user_id is not null
			union all
			select entries.id, entries.round_robin_id, entries.organization_id, tm.user_id,
			       entries.team_id, entries.position, entries.created_at,
			       tm.id, tm.created_at
			from entries
			join public.teams team
			  on team.id = entries.team_id and team.organization_id = entries.organization_id and coalesce(team.is_active, true)
			join public.team_members tm
			  on tm.organization_id = entries.organization_id
			 and tm.team_id = entries.team_id
			 and coalesce(tm.is_active, true)
			where entries.user_id is null and entries.team_id is not null
		)
		select candidates.id::text, candidates.user_id::text, coalesce(candidates.team_id::text, '')
		from candidates
		join public.organization_members om
		  on om.organization_id = candidates.organization_id
		 and om.user_id = candidates.user_id
		 and coalesce(om.is_active, true)
		join public.users user_profile
		  on user_profile.id = candidates.user_id and coalesce(user_profile.is_active, true)
		left join lateral (
			select count(*)::bigint as total
			from public.round_robin_logs log
			where log.organization_id = candidates.organization_id
			  and log.round_robin_id = candidates.round_robin_id
			  and log.assigned_user_id = candidates.user_id
		) user_logs on true
		where (
			candidates.team_member_id is null
			or not exists (
				select 1 from public.member_availability availability
				where availability.organization_id = candidates.organization_id
				  and availability.team_member_id = candidates.team_member_id
			)
			or exists (
				select 1 from public.member_availability availability
				where availability.organization_id = candidates.organization_id
				  and availability.team_member_id = candidates.team_member_id
				  and availability.day_of_week = extract(dow from now() at time zone 'America/Sao_Paulo')::int
				  and coalesce(availability.is_active, true)
				  and (
					coalesce(availability.is_all_day, false)
					or (
						availability.start_time is not null and availability.end_time is not null
						and (
							(availability.start_time <= availability.end_time
							 and (now() at time zone 'America/Sao_Paulo')::time between availability.start_time and availability.end_time)
							or (availability.start_time > availability.end_time
							 and ((now() at time zone 'America/Sao_Paulo')::time >= availability.start_time
							      or (now() at time zone 'America/Sao_Paulo')::time <= availability.end_time))
						)
					)
				)
			)
		)
		order by coalesce(user_logs.total, 0) asc, candidates.position asc,
		         candidates.created_at asc, candidates.team_member_created_at asc nulls last,
		         candidates.user_id asc
		limit 1
	`, organizationID, roundRobinID).Scan(&memberID, &userID, &teamID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", "", nil
	}
	return memberID, userID, teamID, err
}

func recordPortalRoundRobinAssignment(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, destination portalDestination, eventKey string) error {
	metadata, _ := json.Marshal(map[string]any{
		"member_id":      destination.RoundRobinMemberID,
		"origin_lead_id": eventKey,
		"source":         "grupo_olx",
	})
	_, err := tx.Exec(ctx, `
		insert into public.round_robin_logs (
			organization_id, round_robin_id, lead_id, assigned_user_id, reason, metadata
		) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'grupo_olx', $5::jsonb)
	`, organizationID, destination.RoundRobinID, leadID, destination.AssignedUserID, string(metadata))
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		update public.round_robins
		set current_position = coalesce(current_position, 0) + 1, updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, destination.RoundRobinID)
	return err
}

func (repo Repository) ProcessGrupoOLXLead(ctx context.Context, token string, authorization string, payload []byte) (leadWebhookResult, error) {
	integration, err := repo.integrationByPublicToken(ctx, token, "webhook_token")
	if err != nil {
		return leadWebhookResult{}, err
	}
	if !validWebhookAuthorization(authorization, integration.WebhookSecret) {
		return leadWebhookResult{}, ErrUnauthorized
	}

	var body map[string]any
	if err := json.Unmarshal(payload, &body); err != nil {
		return leadWebhookResult{}, ErrInvalidInput
	}
	eventKey := firstText(body, "originLeadId", "leadId", "id")
	if eventKey == "" {
		eventKey = payloadHash(payload)
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return leadWebhookResult{}, err
	}
	defer tx.Rollback(ctx)

	eventID, existingLeadID, duplicate, err := insertWebhookEvent(ctx, tx, integration, "lead", eventKey, payload)
	if err != nil {
		return leadWebhookResult{}, err
	}
	if duplicate {
		if err := tx.Commit(ctx); err != nil {
			return leadWebhookResult{}, err
		}
		return leadWebhookResult{EventID: eventID, LeadID: existingLeadID, Duplicate: true, Linked: existingLeadID != nil}, nil
	}

	clientListingID := strings.TrimSpace(firstText(body, "clientListingId", "listingId", "propertyCode"))
	if clientListingID == "" {
		return leadWebhookResult{}, ErrListingNotFound
	}
	propertyID, propertyCode, err := findPublicationProperty(ctx, tx, integration.ID, clientListingID)
	if err != nil {
		return leadWebhookResult{}, err
	}
	if propertyID == nil {
		return leadWebhookResult{}, ErrListingNotFound
	}
	destination, err := repo.resolvePortalDestination(ctx, tx, integration)
	if err != nil {
		return leadWebhookResult{}, err
	}

	name := strings.TrimSpace(firstText(body, "name", "consumerName", "leadName"))
	if name == "" {
		name = "Lead Grupo OLX"
	}
	email := strings.TrimSpace(firstText(body, "email", "consumerEmail"))
	phone := normalizePhone(firstText(body, "phone", "phoneNumber", "consumerPhone"), firstText(body, "ddd"))
	message := strings.TrimSpace(firstText(body, "message", "messageBody", "description"))
	sourceDetail := strings.TrimSpace(firstText(body, "leadType", "channel"))
	if sourceDetail == "" {
		if extra, ok := body["extraData"].(map[string]any); ok {
			sourceDetail = strings.TrimSpace(firstText(extra, "leadType", "channel"))
		}
	}
	if sourceDetail == "" {
		sourceDetail = "Grupo OLX"
	}

	leadID := ""
	metadataJSON, _ := json.Marshal(map[string]any{
		"provider":          "grupo_olx",
		"origin_lead_id":    eventKey,
		"client_listing_id": clientListingID,
		"origin_listing_id": firstText(body, "originListingId"),
		"temperature":       firstText(body, "temperature"),
		"transaction_type":  firstText(body, "transactionType"),
		"webhook_payload":   body,
	})
	err = tx.QueryRow(ctx, `
		insert into public.leads (
			organization_id,
			pipeline_id,
			stage_id,
			assigned_user_id,
			team_id,
			property_id,
			interest_property_id,
			property_code,
			name,
			email,
			phone,
			source,
			source_detail,
			source_webhook_id,
			message,
			initial_message,
			status,
			deal_status,
			utm_source,
			utm_medium,
			metadata,
			created_by,
			updated_at
		)
		values (
			$1::uuid,
			nullif($2, '')::uuid,
			nullif($3, '')::uuid,
			nullif($4, '')::uuid,
			nullif($5, '')::uuid,
			nullif($6, '')::uuid,
			nullif($6, '')::uuid,
			nullif($7, ''),
			$8,
			nullif($9, ''),
			nullif($10, ''),
			'grupo_olx',
			$11,
			$12::uuid,
			nullif($13, ''),
			nullif($13, ''),
			'new',
			'open',
			'grupo_olx',
			'portal',
			$14::jsonb,
			nullif($15, '')::uuid,
			now()
		)
		returning id::text
	`, integration.OrganizationID, destination.PipelineID, destination.StageID, destination.AssignedUserID,
		destination.TeamID, nullableStringValue(propertyID), nullableStringValue(propertyCode), name, email, phone,
		sourceDetail, eventID, message, string(metadataJSON), destination.AssignedUserID).Scan(&leadID)
	if err != nil {
		return leadWebhookResult{}, err
	}
	if destination.RoundRobinID != "" && destination.AssignedUserID != "" {
		if err := recordPortalRoundRobinAssignment(ctx, tx, integration.OrganizationID, leadID, destination, eventKey); err != nil {
			return leadWebhookResult{}, err
		}
	}

	if _, err := tx.Exec(ctx, `
		insert into public.lead_meta (organization_id, lead_id, platform, form_id, payload)
		values ($1::uuid, $2::uuid, 'grupo_olx', $3, $4::jsonb)
		on conflict (lead_id) do update
		set platform = excluded.platform,
		    form_id = excluded.form_id,
		    payload = excluded.payload,
		    updated_at = now()
	`, integration.OrganizationID, leadID, eventKey, string(metadataJSON)); err != nil {
		return leadWebhookResult{}, err
	}

	_, err = tx.Exec(ctx, `
		update public.portal_webhook_events
		set processing_status = 'processed',
		    lead_id = $2::uuid,
		    property_id = nullif($3, '')::uuid,
		    processed_at = now()
		where id = $1::uuid
	`, eventID, leadID, nullableStringValue(propertyID))
	if err != nil {
		return leadWebhookResult{}, err
	}
	_, err = tx.Exec(ctx, `
		update public.portal_integrations
		set last_lead_received_at = now(),
		    status = 'connected',
		    updated_at = now()
		where id = $1::uuid
	`, integration.ID)
	if err != nil {
		return leadWebhookResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return leadWebhookResult{}, err
	}
	return leadWebhookResult{
		EventID:    eventID,
		LeadID:     &leadID,
		PropertyID: propertyID,
		Linked:     propertyID != nil,
	}, nil
}

func (repo Repository) ReceiveGrupoOLXImportReport(ctx context.Context, token string, authorization string, payload []byte) (map[string]any, error) {
	integration, err := repo.integrationByPublicToken(ctx, token, "webhook_token")
	if err != nil {
		return nil, err
	}
	if !validWebhookAuthorization(authorization, integration.WebhookSecret) {
		return nil, ErrUnauthorized
	}
	var body map[string]any
	if err := json.Unmarshal(payload, &body); err != nil {
		return nil, ErrInvalidInput
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	reportID := firstText(body, "id", "reportId", "importId")
	if reportID == "" {
		reportID = payloadHash(payload)
	}
	details := objectValue(body["details"])
	if len(details) == 0 {
		details = body
	}
	summary := map[string]any{
		"company":   body["company"],
		"type":      body["type"],
		"date":      firstValue(details, "date"),
		"total":     firstValue(details, "total", "totalListings"),
		"created":   firstValue(details, "created", "createdListings"),
		"updated":   firstValue(details, "updated", "updatedListings"),
		"deleted":   firstValue(details, "deleted"),
		"unchanged": firstValue(details, "unchanged"),
		"errors":    firstValue(details, "error", "errors", "errorCount"),
		"warnings":  firstValue(details, "warning", "warnings", "warningCount"),
		"link":      body["link"],
	}
	status := normalizeReportStatus(firstText(body, "status", "importStatus"))
	if numericValue(summary["errors"]) > 0 {
		status = "error"
	} else if numericValue(summary["warnings"]) > 0 {
		status = "warning"
	} else if status == "received" {
		status = "success"
	}
	summaryJSON, _ := json.Marshal(summary)
	errorIssues := reportListingIssues(body["errors"], "errorMessage")
	warningIssues := reportListingIssues(body["warnings"], "message")
	var raw []byte
	err = tx.QueryRow(ctx, `
		insert into public.portal_import_reports (
			integration_id,
			organization_id,
			portal,
			report_id,
			status,
			summary,
			raw_payload
		)
		values ($1::uuid, $2::uuid, 'grupo_olx', $3, $4, $5::jsonb, $6::jsonb)
		on conflict (integration_id, report_id)
		do update set
			status = excluded.status,
			summary = excluded.summary,
			raw_payload = excluded.raw_payload,
			created_at = now()
		returning jsonb_build_object('id', id::text, 'report_id', report_id, 'status', status, 'created_at', created_at)
	`, integration.ID, integration.OrganizationID, reportID, status, string(summaryJSON), string(payload)).Scan(&raw)
	if err != nil {
		return nil, err
	}
	if err := repo.applyReportIssues(ctx, tx, integration.ID, errorIssues, true); err != nil {
		return nil, err
	}
	if err := repo.applyReportIssues(ctx, tx, integration.ID, warningIssues, false); err != nil {
		return nil, err
	}
	description := strings.TrimSpace(firstText(body, "description"))
	if description == "" && status == "error" {
		description = "O Grupo OLX reportou erros na importacao de imoveis."
	}
	if _, err := tx.Exec(ctx, `
		update public.portal_integrations
		set last_import_report_at = now(),
		    last_sync_status = $2,
		    status = case when $2 = 'error' then 'error' else 'connected' end,
		    last_error = nullif($3, ''),
		    updated_at = now()
		where id = $1::uuid
	`, integration.ID, status, description); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return decodeJSONObject(raw)
}

func (repo Repository) applyReportIssues(ctx context.Context, tx pgx.Tx, integrationID string, issues map[string][]string, asError bool) error {
	if len(issues) == 0 {
		return nil
	}
	issuesJSON, _ := json.Marshal(issues)
	status := "exported"
	if asError {
		status = "error"
	}
	_, err := tx.Exec(ctx, `
		update public.portal_listing_publications publication
		set status = case when $3 = 'error' then 'error' else publication.status end,
		    validation_errors = publication.validation_errors || issue.messages,
		    last_error = case when $3 = 'error' then issue.messages->>0 else publication.last_error end,
		    updated_at = now()
		from jsonb_each($2::jsonb) as issue(client_listing_id, messages)
		where publication.integration_id = $1::uuid
		  and publication.client_listing_id = issue.client_listing_id
	`, integrationID, string(issuesJSON), status)
	return err
}

type publicIntegration struct {
	ID                    string
	OrganizationID        string
	Status                string
	IsActive              bool
	WebhookSecret         string
	DefaultPipelineID     string
	DefaultStageID        string
	DefaultAssignedUserID string
	DefaultRoundRobinID   string
	Settings              map[string]any
}

func (repo Repository) integrationByPublicToken(ctx context.Context, token string, column string) (publicIntegration, error) {
	token = strings.TrimSuffix(strings.TrimSpace(token), ".xml")
	if token == "" || (column != "feed_token" && column != "webhook_token") {
		return publicIntegration{}, ErrInvalidInput
	}
	query := fmt.Sprintf(`
		select
			pi.id::text,
			pi.organization_id::text,
			pi.status,
			pi.is_active,
			coalesce(pi.lead_webhook_secret_ref, ''),
			coalesce(pi.default_pipeline_id::text, ''),
			coalesce(pi.default_stage_id::text, ''),
			coalesce(pi.default_assigned_user_id::text, ''),
			coalesce(pi.default_round_robin_id::text, ''),
			pi.settings
		from public.portal_integrations pi
		where pi.%s = $1
		  and pi.portal = 'grupo_olx'
		limit 1
	`, column)
	var integration publicIntegration
	var settingsRaw []byte
	err := repo.db.Pool().QueryRow(ctx, query, token).Scan(
		&integration.ID,
		&integration.OrganizationID,
		&integration.Status,
		&integration.IsActive,
		&integration.WebhookSecret,
		&integration.DefaultPipelineID,
		&integration.DefaultStageID,
		&integration.DefaultAssignedUserID,
		&integration.DefaultRoundRobinID,
		&settingsRaw,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return publicIntegration{}, ErrNotFound
	}
	if err != nil {
		return publicIntegration{}, err
	}
	if !integration.IsActive || integration.Status == "paused" {
		return publicIntegration{}, ErrModuleUnavailable
	}
	if !repo.portalModuleEnabled(ctx, integration.OrganizationID) {
		return publicIntegration{}, ErrModuleUnavailable
	}
	_ = json.Unmarshal(settingsRaw, &integration.Settings)
	return integration, nil
}

func (repo Repository) portalModuleEnabled(ctx context.Context, organizationID string) bool {
	var enabled bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.organization_modules
			where organization_id = $1::uuid
			  and lower(trim(module_name)) = 'portals'
			  and coalesce(is_enabled, false)
		)
	`, organizationID).Scan(&enabled)
	return err == nil && enabled
}

func (repo Repository) getIntegrationJSON(ctx context.Context, organizationID string) (map[string]any, error) {
	var raw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		select jsonb_build_object(
			'id', pi.id::text,
			'organization_id', pi.organization_id::text,
			'portal', pi.portal,
			'status', pi.status,
			'is_active', pi.is_active,
			'feed_token', pi.feed_token,
			'webhook_token', pi.webhook_token,
			'lead_webhook_secret_configured', pi.lead_webhook_secret_ref is not null,
			'default_pipeline_id', pi.default_pipeline_id::text,
			'default_stage_id', pi.default_stage_id::text,
			'default_assigned_user_id', pi.default_assigned_user_id::text,
			'default_round_robin_id', pi.default_round_robin_id::text,
			'settings', pi.settings,
			'last_feed_accessed_at', pi.last_feed_accessed_at,
			'last_lead_received_at', pi.last_lead_received_at,
			'last_import_report_at', pi.last_import_report_at,
			'last_sync_status', pi.last_sync_status,
			'last_error', pi.last_error,
			'created_at', pi.created_at,
			'updated_at', pi.updated_at
		)
		from public.portal_integrations pi
		where pi.organization_id = $1::uuid
		  and pi.portal = 'grupo_olx'
		limit 1
	`, organizationID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return decodeJSONObject(raw)
}

type feedSelection struct {
	Listings []feedListing
	Invalid  map[string][]string
}

func (repo Repository) feedListings(ctx context.Context, integration publicIntegration) (feedSelection, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select jsonb_build_object(
			'publication_id', plp.id::text,
			'client_listing_id', plp.client_listing_id,
			'publication_type', plp.publication_type,
			'property', to_jsonb(p)
		)
		from public.portal_listing_publications plp
		join public.properties p on p.id = plp.property_id
		where plp.integration_id = $1::uuid
		  and plp.portal = 'grupo_olx'
		  and plp.is_enabled = true
		order by p.updated_at desc
		limit 50000
	`, integration.ID)
	if err != nil {
		return feedSelection{}, err
	}
	defer rows.Close()
	selection := feedSelection{Listings: []feedListing{}, Invalid: map[string][]string{}}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return feedSelection{}, err
		}
		var listing feedListing
		if err := json.Unmarshal(raw, &listing); err != nil {
			return feedSelection{}, err
		}
		validationErrors := validateFeedListing(integration, listing)
		if len(validationErrors) == 0 {
			selection.Listings = append(selection.Listings, listing)
		} else {
			selection.Invalid[listing.PublicationID] = validationErrors
		}
	}
	return selection, rows.Err()
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

func insertWebhookEvent(ctx context.Context, tx pgx.Tx, integration publicIntegration, eventType string, eventKey string, payload []byte) (string, *string, bool, error) {
	var eventID string
	var leadID *string
	err := tx.QueryRow(ctx, `
		insert into public.portal_webhook_events (
			integration_id,
			organization_id,
			portal,
			event_type,
			event_key,
			source_id,
			payload
		)
		values ($1::uuid, $2::uuid, 'grupo_olx', $3, $4, $4, $5::jsonb)
		on conflict (integration_id, event_type, event_key)
		do nothing
		returning id::text, lead_id::text
	`, integration.ID, integration.OrganizationID, eventType, eventKey, string(payload)).Scan(&eventID, &leadID)
	if err == nil {
		return eventID, leadID, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", nil, false, err
	}

	err = tx.QueryRow(ctx, `
		select id::text, lead_id::text
		from public.portal_webhook_events
		where integration_id = $1::uuid
		  and event_type = $2
		  and event_key = $3
		limit 1
	`, integration.ID, eventType, eventKey).Scan(&eventID, &leadID)
	if err != nil {
		return "", nil, false, err
	}

	_, _ = tx.Exec(ctx, `
		update public.portal_webhook_events
		set processing_status = case when lead_id is null then 'duplicate' else processing_status end
		where id = $1::uuid
	`, eventID)
	return eventID, leadID, true, nil
}

func findPublicationProperty(ctx context.Context, tx pgx.Tx, integrationID string, clientListingID string) (*string, *string, error) {
	if strings.TrimSpace(clientListingID) == "" {
		return nil, nil, nil
	}
	var propertyID string
	var propertyCode string
	err := tx.QueryRow(ctx, `
		select p.id::text, p.code
		from public.portal_listing_publications plp
		join public.properties p on p.id = plp.property_id
		where plp.integration_id = $1::uuid
		  and plp.client_listing_id = $2
		  and plp.is_enabled = true
		limit 1
	`, integrationID, clientListingID).Scan(&propertyID, &propertyCode)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &clientListingID, nil
	}
	if err != nil {
		return nil, nil, err
	}
	return &propertyID, &propertyCode, nil
}

func scanJSONRows(rows pgx.Rows) ([]map[string]any, error) {
	items := []map[string]any{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		item, err := decodeJSONObject(raw)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func decodeJSONObject(raw []byte) (map[string]any, error) {
	item := map[string]any{}
	if len(raw) == 0 {
		return item, nil
	}
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil, err
	}
	return item, nil
}

func optionalUUIDText(value OptionalString) string {
	if value.Value == nil {
		return ""
	}
	return strings.TrimSpace(*value.Value)
}

func optionalUUIDValue(value OptionalString) any {
	text := optionalUUIDText(value)
	if text == "" {
		return nil
	}
	return text
}

func nonNilMap(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	return value
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

func validWebhookAuthorization(header string, secret string) bool {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return false
	}
	header = strings.TrimSpace(header)
	if header == "" {
		return false
	}
	candidates := []string{}
	if strings.HasPrefix(strings.ToLower(header), "bearer ") {
		candidates = append(candidates, strings.TrimSpace(header[7:]))
	}
	if strings.HasPrefix(strings.ToLower(header), "basic ") {
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(header[6:]))
		if err == nil {
			parts := strings.SplitN(string(decoded), ":", 2)
			candidates = append(candidates, string(decoded))
			if len(parts) == 2 {
				candidates = append(candidates, parts[1])
			}
		}
	}
	for _, candidate := range candidates {
		if webhookSecretMatches(secret, candidate) {
			return true
		}
	}
	return false
}

func webhookSecretDigest(secret string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(secret)))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func webhookSecretMatches(stored string, candidate string) bool {
	stored = strings.TrimSpace(stored)
	candidate = strings.TrimSpace(candidate)
	if stored == "" || candidate == "" {
		return false
	}
	if strings.HasPrefix(stored, "sha256:") {
		candidate = webhookSecretDigest(candidate)
	} else {
		stored = strings.TrimPrefix(stored, "plain:")
	}
	if len(stored) != len(candidate) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(stored), []byte(candidate)) == 1
}

func payloadHash(payload []byte) string {
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func firstText(source map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := source[key]; ok {
			switch typed := value.(type) {
			case string:
				if text := strings.TrimSpace(typed); text != "" {
					return text
				}
			case float64:
				return fmt.Sprintf("%.0f", typed)
			case json.Number:
				return typed.String()
			}
		}
	}
	return ""
}

func firstValue(source map[string]any, keys ...string) any {
	for _, key := range keys {
		if value, ok := source[key]; ok && value != nil {
			return value
		}
	}
	return nil
}

func objectValue(value any) map[string]any {
	if object, ok := value.(map[string]any); ok {
		return object
	}
	return map[string]any{}
}

func numericValue(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		parsed, _ := typed.Float64()
		return parsed
	case string:
		var parsed float64
		_, _ = fmt.Sscanf(strings.TrimSpace(typed), "%f", &parsed)
		return parsed
	default:
		return 0
	}
}

func reportListingIssues(value any, messageKey string) map[string][]string {
	result := map[string][]string{}
	items, ok := value.([]any)
	if !ok {
		return result
	}
	for _, rawItem := range items {
		item := objectValue(rawItem)
		message := strings.TrimSpace(firstText(item, messageKey, "message", "errorMessage"))
		if message == "" {
			continue
		}
		externalIDs, ok := item["externalIds"].([]any)
		if !ok {
			continue
		}
		for _, rawID := range externalIDs {
			listingID := strings.TrimSpace(fmt.Sprint(rawID))
			if listingID == "" {
				continue
			}
			result[listingID] = append(result[listingID], message)
		}
	}
	return result
}

func normalizePhone(phone string, ddd string) string {
	phone = onlyDigits(phone)
	ddd = onlyDigits(ddd)
	if ddd != "" && !strings.HasPrefix(phone, ddd) {
		phone = ddd + phone
	}
	return phone
}

func onlyDigits(value string) string {
	var builder strings.Builder
	for _, r := range value {
		if r >= '0' && r <= '9' {
			builder.WriteRune(r)
		}
	}
	return builder.String()
}

func nullableStringValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func normalizeReportStatus(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	switch normalized {
	case "success", "sucesso", "ok", "done", "completed":
		return "success"
	case "warning", "warnings", "aviso":
		return "warning"
	case "error", "errors", "erro", "failed", "failure":
		return "error"
	default:
		return "received"
	}
}

func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339)
}
