package portals

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
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

func (repo Repository) SaveGrupoOLX(ctx context.Context, tenantContext tenant.Context, request GrupoOLXSettingsRequest) (map[string]any, error) {
	isActive := false
	if request.IsActive != nil {
		isActive = *request.IsActive
	}
	status := "paused"
	if isActive {
		status = "pending_setup"
	}
	settingsJSON, _ := json.Marshal(nonNilMap(request.Settings))
	secretRef := (*string)(nil)
	if request.LeadWebhookSecret != nil {
		secret := strings.TrimSpace(*request.LeadWebhookSecret)
		if secret != "" {
			value := "plain:" + secret
			secretRef = &value
		}
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
				when excluded.is_active = false then 'paused'
				when portal_integrations.status = 'connected' then 'connected'
				else excluded.status
			end,
			is_active = excluded.is_active,
			lead_webhook_secret_ref = coalesce(excluded.lead_webhook_secret_ref, portal_integrations.lead_webhook_secret_ref),
			default_pipeline_id = coalesce(excluded.default_pipeline_id, portal_integrations.default_pipeline_id),
			default_stage_id = coalesce(excluded.default_stage_id, portal_integrations.default_stage_id),
			default_assigned_user_id = coalesce(excluded.default_assigned_user_id, portal_integrations.default_assigned_user_id),
			default_round_robin_id = coalesce(excluded.default_round_robin_id, portal_integrations.default_round_robin_id),
			settings = excluded.settings,
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
	`, tenantContext.OrganizationID, status, isActive, secretRef, cleanUUID(request.DefaultPipelineID), cleanUUID(request.DefaultStageID), cleanUUID(request.DefaultAssignedUserID), cleanUUID(request.DefaultRoundRobinID), string(settingsJSON), tenantContext.UserID).Scan(&raw)
	if err != nil {
		return nil, err
	}
	return decodeJSONObject(raw)
}

func (repo Repository) ActivateGrupoOLX(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
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
		if propertyID == "" {
			return nil, ErrInvalidInput
		}
		isEnabled := true
		if item.IsEnabled != nil {
			isEnabled = *item.IsEnabled
		}
		publicationType := normalizePublicationType(item.PublicationType)
		clientListingID := strings.TrimSpace(item.ClientListingID)
		if clientListingID == "" {
			var code string
			if err := tx.QueryRow(ctx, `
				select code
				from public.properties
				where id = $1::uuid
				  and organization_id = $2::uuid
			`, propertyID, tenantContext.OrganizationID).Scan(&code); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return nil, ErrInvalidInput
				}
				return nil, err
			}
			clientListingID = normalizeClientListingID(code, propertyID)
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
	items, err := repo.feedListings(ctx, integration.ID)
	if err != nil {
		return nil, err
	}
	xmlBytes, err := buildVRSyncFeed(integration, items)
	if err != nil {
		return nil, err
	}
	_, _ = repo.db.Pool().Exec(ctx, `
		update public.portal_integrations
		set last_feed_accessed_at = now(),
		    last_sync_status = 'feed_served',
		    status = case when status in ('draft', 'pending_setup') then 'connected' else status end,
		    updated_at = now()
		where id = $1::uuid
	`, integration.ID)
	if len(items) > 0 {
		_, _ = repo.db.Pool().Exec(ctx, `
			update public.portal_listing_publications
			set status = 'exported',
			    last_exported_at = now(),
			    last_seen_in_feed_at = now(),
			    validation_errors = '[]'::jsonb,
			    last_error = null,
			    updated_at = now()
			where integration_id = $1::uuid
			  and is_enabled = true
		`, integration.ID)
	}
	return xmlBytes, nil
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
	propertyID, propertyCode, _ := findPublicationProperty(ctx, tx, integration.ID, clientListingID)

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
			nullif($5, '')::uuid,
			nullif($6, ''),
			$7,
			nullif($8, ''),
			nullif($9, ''),
			'grupo_olx',
			$10,
			$11::uuid,
			nullif($12, ''),
			nullif($12, ''),
			'new',
			'open',
			'grupo_olx',
			'portal',
			$13::jsonb,
			nullif($14, '')::uuid,
			now()
		)
		returning id::text
	`, integration.OrganizationID, integration.DefaultPipelineID, integration.DefaultStageID, integration.DefaultAssignedUserID, nullableStringValue(propertyID), nullableStringValue(propertyCode), name, email, phone, sourceDetail, eventID, message, string(metadataJSON), integration.DefaultAssignedUserID).Scan(&leadID)
	if err != nil {
		return leadWebhookResult{}, err
	}

	_, _ = tx.Exec(ctx, `
		insert into public.lead_meta (organization_id, lead_id, platform, form_id, payload)
		values ($1::uuid, $2::uuid, 'grupo_olx', $3, $4::jsonb)
		on conflict (lead_id) do update
		set platform = excluded.platform,
		    form_id = excluded.form_id,
		    payload = excluded.payload,
		    updated_at = now()
	`, integration.OrganizationID, leadID, eventKey, string(metadataJSON))

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

func (repo Repository) ReceiveGrupoOLXImportReport(ctx context.Context, token string, payload []byte) (map[string]any, error) {
	integration, err := repo.integrationByPublicToken(ctx, token, "webhook_token")
	if err != nil {
		return nil, err
	}
	var body map[string]any
	if err := json.Unmarshal(payload, &body); err != nil {
		return nil, ErrInvalidInput
	}
	reportID := firstText(body, "id", "reportId", "importId")
	if reportID == "" {
		reportID = payloadHash(payload)
	}
	status := normalizeReportStatus(firstText(body, "status", "importStatus"))
	summaryJSON, _ := json.Marshal(map[string]any{
		"total":    firstText(body, "total", "totalListings"),
		"created":  firstText(body, "created", "createdListings"),
		"updated":  firstText(body, "updated", "updatedListings"),
		"errors":   firstText(body, "errors", "errorCount"),
		"warnings": firstText(body, "warnings", "warningCount"),
	})
	var raw []byte
	err = repo.db.Pool().QueryRow(ctx, `
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
	_, _ = repo.db.Pool().Exec(ctx, `
		update public.portal_integrations
		set last_import_report_at = now(),
		    last_sync_status = $2,
		    status = case when $2 = 'error' then 'error' else 'connected' end,
		    updated_at = now()
		where id = $1::uuid
	`, integration.ID, status)
	return decodeJSONObject(raw)
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
	integration.WebhookSecret = strings.TrimPrefix(integration.WebhookSecret, "plain:")
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

func (repo Repository) feedListings(ctx context.Context, integrationID string) ([]feedListing, error) {
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
	`, integrationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	listings := []feedListing{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var listing feedListing
		if err := json.Unmarshal(raw, &listing); err != nil {
			return nil, err
		}
		if len(validateFeedListing(listing)) == 0 {
			listings = append(listings, listing)
		}
	}
	return listings, rows.Err()
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
		values ($1::uuid, 'grupo_olx', 'pending_setup', true, $2::uuid, now())
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

func cleanUUID(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
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
		return true
	}
	header = strings.TrimSpace(header)
	if header == "" {
		return false
	}
	if strings.EqualFold(header, "Bearer "+secret) || strings.EqualFold(header, "Basic "+secret) {
		return true
	}
	if strings.HasPrefix(strings.ToLower(header), "basic ") {
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(header[6:]))
		if err == nil {
			parts := strings.SplitN(string(decoded), ":", 2)
			if len(parts) == 1 {
				return parts[0] == secret
			}
			return parts[0] == secret || parts[1] == secret || string(decoded) == secret
		}
	}
	return false
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
