package portals

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/mail"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/publicingress"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db                         *dbpkg.Postgres
	webhookSecret              string
	importReportWorkerEnabled  bool
	importReportWorkerInterval time.Duration
	importReportWorkerBatch    int
}

type portalQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

type Config struct {
	// WebhookSecret is the CRM-wide Grupo OLX SECRET_KEY. Grupo OLX provisions
	// one credential per CRM, not per customer account.
	WebhookSecret              string
	ImportReportWorkerEnabled  bool
	ImportReportWorkerInterval time.Duration
	ImportReportWorkerBatch    int
}

func NewRepository(db *dbpkg.Postgres, configs ...Config) Repository {
	var config Config
	if len(configs) > 0 {
		config = configs[0]
	}
	if config.ImportReportWorkerInterval <= 0 {
		config.ImportReportWorkerInterval = 2 * time.Second
	}
	if config.ImportReportWorkerBatch < 1 {
		config.ImportReportWorkerBatch = 25
	}
	if config.ImportReportWorkerBatch > 500 {
		config.ImportReportWorkerBatch = 500
	}
	return Repository{
		db: db, webhookSecret: strings.TrimSpace(config.WebhookSecret),
		importReportWorkerEnabled:  config.ImportReportWorkerEnabled,
		importReportWorkerInterval: config.ImportReportWorkerInterval,
		importReportWorkerBatch:    config.ImportReportWorkerBatch,
	}
}

func (repo Repository) ValidGrupoOLXWebhookAuthorization(authorization string) bool {
	return validWebhookAuthorization(authorization, repo.webhookSecret)
}

func (repo Repository) allowGrupoOLXPublicIngress(ctx context.Context, scope string, clientIP string, token string, limit int) error {
	// The path token is included only in the one-way limiter digest. This keeps
	// tenants behind the same Grupo OLX NAT isolated without logging credentials.
	allowed, err := publicingress.Allow(ctx, repo.db.Pool(), scope, []string{clientIP, token}, limit, time.Minute)
	if err != nil {
		return err
	}
	if !allowed {
		return ErrRateLimited
	}
	return nil
}

func (repo Repository) GetGrupoOLX(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
	return repo.getIntegrationJSON(ctx, tenantContext.OrganizationID)
}

func (repo Repository) validateIntegrationReferences(ctx context.Context, queryer portalQueryer, organizationID string, request GrupoOLXSettingsRequest) error {
	pipelineID := optionalUUIDText(request.DefaultPipelineID)
	stageID := optionalUUIDText(request.DefaultStageID)
	assignedUserID := optionalUUIDText(request.DefaultAssignedUserID)
	roundRobinID := optionalUUIDText(request.DefaultRoundRobinID)

	var valid bool
	err := queryer.QueryRow(ctx, `
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

func (repo Repository) hydrateExistingReferences(ctx context.Context, queryer portalQueryer, organizationID string, request *GrupoOLXSettingsRequest) error {
	var pipelineID, stageID, assignedUserID, roundRobinID string
	err := queryer.QueryRow(ctx, `
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

var grupoOLXSettingLimits = map[string]int{
	"contact_name":    200,
	"contact_email":   320,
	"contact_phone":   80,
	"detail_base_url": 2048,
}

func normalizeGrupoOLXSettings(settings map[string]any, rejectUnknown bool) (map[string]any, error) {
	if settings == nil {
		return nil, nil
	}
	normalized := make(map[string]any, len(settings))
	for key, raw := range settings {
		limit, allowed := grupoOLXSettingLimits[key]
		if !allowed {
			if rejectUnknown {
				return nil, ErrInvalidInput
			}
			continue
		}
		value, ok := raw.(string)
		if !ok {
			return nil, ErrInvalidInput
		}
		value = strings.TrimSpace(value)
		if !utf8.ValidString(value) || utf8.RuneCountInString(value) > limit || strings.IndexFunc(value, unicode.IsControl) >= 0 {
			return nil, ErrInvalidInput
		}
		normalized[key] = value
	}
	if email := textFromSettings(normalized, "contact_email"); email != "" {
		address, err := mail.ParseAddress(email)
		if err != nil || !strings.EqualFold(address.Address, email) {
			return nil, ErrInvalidInput
		}
	}
	if detailURL := textFromSettings(normalized, "detail_base_url"); detailURL != "" {
		parsed, err := url.ParseRequestURI(detailURL)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
			return nil, ErrInvalidInput
		}
	}
	return normalized, nil
}

func sanitizeGrupoOLXIntegration(item map[string]any) map[string]any {
	settings, _ := item["settings"].(map[string]any)
	normalized, err := normalizeGrupoOLXSettings(settings, false)
	if err != nil || normalized == nil {
		normalized = map[string]any{}
	}
	item["settings"] = normalized
	return item
}

func decodeGrupoOLXIntegration(raw []byte) (map[string]any, error) {
	item, err := decodeJSONObject(raw)
	if err != nil {
		return nil, err
	}
	return sanitizeGrupoOLXIntegration(item), nil
}

func (repo Repository) validateActivationSettings(ctx context.Context, queryer portalQueryer, organizationID string, request GrupoOLXSettingsRequest, lock bool) error {
	if strings.TrimSpace(repo.webhookSecret) == "" {
		return ErrWebhookSecretUnavailable
	}
	settings := map[string]any{}
	var raw []byte
	lockSQL := ""
	if lock {
		lockSQL = " for update"
	}
	err := queryer.QueryRow(ctx, `
		select settings
		from public.portal_integrations
		where organization_id = $1::uuid and portal = 'grupo_olx'
	`+lockSQL, organizationID).Scan(&raw)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if err == nil {
		_ = json.Unmarshal(raw, &settings)
		settings, _ = normalizeGrupoOLXSettings(settings, false)
	}
	if request.Settings != nil {
		settings = request.Settings
	}
	name := strings.TrimSpace(textFromSettings(settings, "contact_name"))
	email := strings.TrimSpace(textFromSettings(settings, "contact_email"))
	if name == "" || email == "" {
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
	settings, err := normalizeGrupoOLXSettings(request.Settings, true)
	if err != nil {
		return nil, err
	}
	request.Settings = settings
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		insert into public.portal_integrations (organization_id, portal, status, is_active, created_by, updated_at)
		values ($1::uuid, 'grupo_olx', 'draft', false, $2::uuid, now())
		on conflict (organization_id, portal) do nothing
	`, tenantContext.OrganizationID, tenantContext.UserID); err != nil {
		return nil, err
	}
	var existingActive bool
	var existingStatus string
	if err := tx.QueryRow(ctx, `
		select is_active, status
		from public.portal_integrations
		where organization_id = $1::uuid and portal = 'grupo_olx'
		for update
	`, tenantContext.OrganizationID).Scan(&existingActive, &existingStatus); err != nil {
		return nil, err
	}

	settingsJSON, _ := json.Marshal(nonNilMap(request.Settings))
	if err := repo.hydrateExistingReferences(ctx, tx, tenantContext.OrganizationID, &request); err != nil {
		return nil, err
	}
	if err := repo.validateIntegrationReferences(ctx, tx, tenantContext.OrganizationID, request); err != nil {
		return nil, err
	}
	// A paused account still has to serve a valid empty drain feed through its
	// preserved token, so its required VRSync header cannot be cleared.
	if existingActive || existingStatus == "paused" {
		if err := repo.validateActivationSettings(ctx, tx, tenantContext.OrganizationID, request, false); err != nil {
			return nil, err
		}
	}
	var raw []byte
	err = tx.QueryRow(ctx, `
		insert into public.portal_integrations (
			organization_id,
			portal,
			status,
			is_active,
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
			'draft',
			false,
			nullif($2, '')::uuid,
			nullif($3, '')::uuid,
			nullif($4, '')::uuid,
			nullif($5, '')::uuid,
			$6::jsonb,
			$7::uuid,
			now()
		)
		on conflict (organization_id, portal)
		do update set
			default_pipeline_id = case when $8 then excluded.default_pipeline_id else portal_integrations.default_pipeline_id end,
			default_stage_id = case when $9 then excluded.default_stage_id else portal_integrations.default_stage_id end,
			default_assigned_user_id = case when $10 then excluded.default_assigned_user_id else portal_integrations.default_assigned_user_id end,
			default_round_robin_id = case when $11 then excluded.default_round_robin_id else portal_integrations.default_round_robin_id end,
			settings = case when $12 then excluded.settings else portal_integrations.settings end,
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
	`, tenantContext.OrganizationID,
		optionalUUIDValue(request.DefaultPipelineID), optionalUUIDValue(request.DefaultStageID),
		optionalUUIDValue(request.DefaultAssignedUserID), optionalUUIDValue(request.DefaultRoundRobinID),
		string(settingsJSON), tenantContext.UserID,
		request.DefaultPipelineID.Set, request.DefaultStageID.Set,
		request.DefaultAssignedUserID.Set, request.DefaultRoundRobinID.Set,
		request.Settings != nil).Scan(&raw)
	if err != nil {
		return nil, err
	}
	item, err := decodeGrupoOLXIntegration(raw)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return item, nil
}

func (repo Repository) ActivateGrupoOLX(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		insert into public.portal_integrations (organization_id, portal, status, is_active, created_by, updated_at)
		values ($1::uuid, 'grupo_olx', 'draft', false, $2::uuid, now())
		on conflict (organization_id, portal) do nothing
	`, tenantContext.OrganizationID, tenantContext.UserID); err != nil {
		return nil, err
	}
	if err := repo.validateActivationSettings(ctx, tx, tenantContext.OrganizationID, GrupoOLXSettingsRequest{}, true); err != nil {
		return nil, err
	}
	var raw []byte
	err = tx.QueryRow(ctx, `
		update public.portal_integrations
		set status = case when status = 'connected' then 'connected' else 'pending_setup' end,
		    is_active = true,
		    last_error = null,
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
	if err != nil {
		return nil, err
	}
	item, err := decodeGrupoOLXIntegration(raw)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return item, nil
}

func (repo Repository) PauseGrupoOLX(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
	command, err := repo.db.Pool().Exec(ctx, `
		update public.portal_integrations
		set status = 'paused',
		    is_active = false,
		    last_error = null,
		    updated_at = clock_timestamp()
		where organization_id = $1::uuid
		  and portal = 'grupo_olx'
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	if command.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	// Tokens are deliberately preserved: Grupo OLX can consume an empty feed
	// and drain in-flight lead/report deliveries after the account is paused.
	return repo.getIntegrationJSON(ctx, tenantContext.OrganizationID)
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
	return decodeGrupoOLXIntegration(raw)
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

func (repo Repository) ListGrupoOLXImportReports(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select jsonb_build_object(
		  'id', report.id::text,
		  'report_id', report.report_id,
		  'status', report.status,
		  'annotation_status', report.annotation_status,
		  'annotation_attempts', report.annotation_attempts,
		  'annotation_next_attempt_at', report.annotation_next_attempt_at,
		  'annotation_processed_at', report.annotation_processed_at,
		  'annotation_last_error', report.annotation_last_error,
		  'provider_occurred_at', report.provider_occurred_at,
		  'created_at', report.created_at
		)
		from public.portal_import_reports report
		join public.portal_integrations integration on integration.id = report.integration_id
		where integration.organization_id = $1::uuid
		  and integration.portal = 'grupo_olx'
		order by case when report.annotation_status = 'succeeded' then 1 else 0 end,
		         report.created_at desc, report.id desc
		limit 100
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanJSONRows(rows)
}

func (repo Repository) ReplayGrupoOLXImportReport(ctx context.Context, tenantContext tenant.Context, reportID string) (map[string]any, error) {
	reportID = strings.TrimSpace(reportID)
	var reportUUID pgtype.UUID
	if err := reportUUID.Scan(reportID); err != nil || !reportUUID.Valid {
		return nil, ErrNotFound
	}
	var raw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		update public.portal_import_reports report
		set annotation_status = 'pending',
		    annotation_attempts = 0,
		    annotation_next_attempt_at = clock_timestamp(),
		    annotation_processed_at = null,
		    annotation_last_error = null
		from public.portal_integrations integration
		where report.id = $1::uuid
		  and report.integration_id = integration.id
		  and integration.organization_id = $2::uuid
		  and integration.portal = 'grupo_olx'
		  and report.annotation_status = 'dead'
		returning jsonb_build_object(
		  'id', report.id::text,
		  'report_id', report.report_id,
		  'status', report.status,
		  'annotation_status', report.annotation_status,
		  'annotation_attempts', report.annotation_attempts,
		  'created_at', report.created_at
		)
	`, reportID, tenantContext.OrganizationID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	item, err := decodeJSONObject(raw)
	if err != nil {
		return nil, err
	}
	wakeImportReportWorker()
	return item, nil
}

func (repo Repository) ListPublications(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
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
		left join canonical on canonical.property_id = scope.property_id
		left join legacy on legacy.property_id = scope.property_id
		order by coalesce(canonical.updated_at, legacy.updated_at) desc, property.id
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

func (repo Repository) BuildGrupoOLXFeed(ctx context.Context, token string) ([]byte, error) {
	integration, err := repo.integrationByPublicToken(ctx, token, "feed_token", false)
	if err != nil {
		return nil, err
	}
	if (integration.Status == "draft" || (!integration.IsActive && integration.Status != "paused")) ||
		strings.TrimSpace(textFromSettings(integration.Settings, "contact_name")) == "" ||
		strings.TrimSpace(textFromSettings(integration.Settings, "contact_email")) == "" {
		return nil, ErrFeedNotActivated
	}
	selection := feedSelection{
		Listings:         []feedListing{},
		Invalid:          map[string][]string{},
		InvalidLegacy:    map[string][]string{},
		InvalidCanonical: map[string]canonicalFeedValidationIssue{},
		ValidCanonical:   map[string]canonicalFeedValidationIssue{},
	}
	feedActive := integration.IsActive && integration.Status != "paused" && integration.ModuleEnabled
	if feedActive {
		selection, err = repo.feedListings(ctx, integration)
		if err != nil {
			return nil, err
		}
	}
	xmlBytes, err := buildVRSyncFeed(integration, selection.Listings)
	if err != nil {
		return nil, err
	}
	if len(xmlBytes) > 30*1024*1024 {
		return nil, fmt.Errorf("grupo olx feed exceeds 30MB")
	}

	legacyValidIDs := make([]string, 0, len(selection.Listings))
	for _, listing := range selection.Listings {
		if listing.Source == "legacy" {
			legacyValidIDs = append(legacyValidIDs, listing.PublicationID)
		}
	}
	invalidJSON, err := json.Marshal(selection.InvalidLegacy)
	if err != nil {
		return nil, err
	}
	syncStatus := fmt.Sprintf("feed_served:valid=%d:invalid=%d", len(selection.Listings), len(selection.Invalid))
	lastError := ""
	if !feedActive {
		syncStatus = "feed_draining:integration_inactive"
	} else if len(selection.Listings) == 0 && len(selection.Invalid) > 0 {
		lastError = "Todos os imoveis habilitados possuem erros de validacao."
	}
	integrationStatus := "connected"
	if feedActive && len(selection.Listings) == 0 && len(selection.Invalid) > 0 {
		integrationStatus = "error"
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
		    status = case
		      when $5::boolean and portal_integrations.is_active and portal_integrations.status <> 'paused' then $3
		      else portal_integrations.status
		    end,
		    last_error = nullif($4, '')
		where id = $1::uuid
	`, integration.ID, syncStatus, integrationStatus, lastError, feedActive); err != nil {
		return nil, err
	}
	if len(legacyValidIDs) > 0 {
		if _, err := tx.Exec(ctx, `
			update public.portal_listing_publications
			set status = 'exported',
			    last_exported_at = now(),
			    last_seen_in_feed_at = now(),
			    validation_errors = '[]'::jsonb,
			    last_error = null
			where integration_id = $1::uuid
			  and id = any($2::uuid[])
		`, integration.ID, legacyValidIDs); err != nil {
			return nil, err
		}
	}
	if len(selection.InvalidLegacy) > 0 {
		if _, err := tx.Exec(ctx, `
			update public.portal_listing_publications publication
			set status = 'invalid',
			    validation_errors = invalid.errors,
			    last_error = invalid.errors->>0
			from jsonb_each($2::jsonb) as invalid(publication_id, errors)
			where publication.integration_id = $1::uuid
			  and publication.id = invalid.publication_id::uuid
		`, integration.ID, string(invalidJSON)); err != nil {
			return nil, err
		}
	}
	if err := applyCanonicalFeedValidationIssues(ctx, tx, integration.ID, selection.InvalidCanonical); err != nil {
		return nil, err
	}
	if err := clearCanonicalFeedValidationIssues(ctx, tx, integration.ID, selection.ValidCanonical); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return xmlBytes, nil
}

func clearCanonicalFeedValidationIssues(
	ctx context.Context,
	tx pgx.Tx,
	integrationID string,
	valid map[string]canonicalFeedValidationIssue,
) error {
	if len(valid) == 0 {
		return nil
	}
	type validInput struct {
		PublicationID    string `json:"publication_id"`
		PublishedVersion int64  `json:"published_version"`
		VersionID        string `json:"version_id"`
		PayloadHash      string `json:"payload_hash"`
	}
	publicationIDs := make([]string, 0, len(valid))
	for publicationID := range valid {
		publicationIDs = append(publicationIDs, publicationID)
	}
	sort.Strings(publicationIDs)
	payload := make([]validInput, 0, len(publicationIDs))
	for _, publicationID := range publicationIDs {
		item := valid[publicationID]
		payload = append(payload, validInput{
			PublicationID: publicationID, PublishedVersion: item.PublishedVersion,
			VersionID: item.VersionID, PayloadHash: item.PayloadHash,
		})
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	// Feed validation is derived telemetry. Clear the adapter-owned checks for
	// every exact delivered version in one statement and never touch updated_at,
	// which is the optimistic-concurrency token for publication commands.
	_, err = tx.Exec(ctx, `
		with input as (
		  select *
		  from jsonb_to_recordset($2::jsonb) as item(
		    publication_id uuid,
		    published_version bigint,
		    version_id uuid,
		    payload_hash text
		  )
		), eligible as (
		  select publication.id,
		         coalesce((
		           select jsonb_agg(entry.value order by entry.ordinality)
		           from jsonb_array_elements(
		             case when jsonb_typeof(publication.validation_errors) = 'array'
		               then publication.validation_errors else '[]'::jsonb end
		           ) with ordinality as entry(value, ordinality)
		           where strpos(coalesce(entry.value->>'code', ''), 'grupo_olx_feed_validation') <> 1
		         ), '[]'::jsonb) as cleaned_validation_errors
		  from public.property_channel_publications publication
		  join input on input.publication_id = publication.id
		  where publication.channel = 'grupo_olx'
		    and publication.channel_account_key = $1
		    and publication.published_version = input.published_version
		    and exists (
		      select 1
		      from public.property_channel_publication_versions version
		      where version.id = input.version_id
		        and version.publication_id = publication.id
		        and version.version = publication.published_version
		        and version.payload_hash = input.payload_hash
		    )
		)
		update public.property_channel_publications publication
		set validation_errors = eligible.cleaned_validation_errors,
		    last_error_code = case
		      when publication.last_error_code = 'grupo_olx_feed_validation' then null
		      else publication.last_error_code end,
		    last_error_message = case
		      when publication.last_error_code = 'grupo_olx_feed_validation' then null
		      else publication.last_error_message end
		from eligible
		where publication.id = eligible.id
		  and (
		    publication.validation_errors is distinct from eligible.cleaned_validation_errors
		    or publication.last_error_code = 'grupo_olx_feed_validation'
		  )
	`, integrationID, string(encoded))
	return err
}

func removePortalChecksByPrefix(checks []portalPublicationCheck, prefix string) []portalPublicationCheck {
	result := make([]portalPublicationCheck, 0, len(checks))
	for _, check := range checks {
		if strings.HasPrefix(check.Code, prefix) {
			continue
		}
		result = append(result, check)
	}
	return result
}

func applyCanonicalFeedValidationIssues(
	ctx context.Context,
	tx pgx.Tx,
	integrationID string,
	issues map[string]canonicalFeedValidationIssue,
) error {
	if len(issues) == 0 {
		return nil
	}
	type invalidInput struct {
		PublicationID    string   `json:"publication_id"`
		PublishedVersion int64    `json:"published_version"`
		VersionID        string   `json:"version_id"`
		PayloadHash      string   `json:"payload_hash"`
		Messages         []string `json:"messages"`
	}
	publicationIDs := make([]string, 0, len(issues))
	for publicationID := range issues {
		publicationIDs = append(publicationIDs, publicationID)
	}
	sort.Strings(publicationIDs)
	payload := make([]invalidInput, 0, len(publicationIDs))
	for _, publicationID := range publicationIDs {
		issue := issues[publicationID]
		messages := uniqueNonEmptyStrings(issue.Messages)
		if len(messages) == 0 {
			continue
		}
		bounded := make([]string, 0, len(messages))
		for _, message := range messages {
			bounded = append(bounded, truncatePortalRunes(message, 1000))
		}
		payload = append(payload, invalidInput{
			PublicationID: publicationID, PublishedVersion: issue.PublishedVersion,
			VersionID: issue.VersionID, PayloadHash: issue.PayloadHash, Messages: bounded,
		})
	}
	if len(payload) == 0 {
		return nil
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	// Replace all adapter-owned checks in one fenced update. Repeated feed reads
	// with identical errors become zero-write operations and cannot invalidate a
	// concurrent publish/unpublish If-Match token through updated_at churn.
	_, err = tx.Exec(ctx, `
		with input as (
		  select *
		  from jsonb_to_recordset($2::jsonb) as item(
		    publication_id uuid,
		    published_version bigint,
		    version_id uuid,
		    payload_hash text,
		    messages jsonb
		  )
		), eligible as (
		  select publication.id,
		         input.messages->>0 as first_message,
		         coalesce((
		           select jsonb_agg(entry.value order by entry.ordinality)
		           from jsonb_array_elements(
		             case when jsonb_typeof(publication.validation_errors) = 'array'
		               then publication.validation_errors else '[]'::jsonb end
		           ) with ordinality as entry(value, ordinality)
		           where strpos(coalesce(entry.value->>'code', ''), 'grupo_olx_feed_validation') <> 1
		         ), '[]'::jsonb) || coalesce((
		           select jsonb_agg(jsonb_build_object(
		             'code', 'grupo_olx_feed_validation_' || substr(md5(message.value), 1, 12),
		             'label', 'Validacao do adaptador VRSync',
		             'severity', 'error',
		             'resolved', false,
		             'message', message.value
		           ) order by message.ordinality)
		           from jsonb_array_elements_text(input.messages) with ordinality as message(value, ordinality)
		         ), '[]'::jsonb) as next_validation_errors
		  from public.property_channel_publications publication
		  join input on input.publication_id = publication.id
		  where publication.channel = 'grupo_olx'
		    and publication.channel_account_key = $1
		    and publication.published_version = input.published_version
		    and jsonb_array_length(input.messages) > 0
		    and exists (
		      select 1
		      from public.property_channel_publication_versions version
		      where version.id = input.version_id
		        and version.publication_id = publication.id
		        and version.version = publication.published_version
		        and version.payload_hash = input.payload_hash
		    )
		)
		update public.property_channel_publications publication
		set validation_errors = eligible.next_validation_errors,
		    last_error_code = 'grupo_olx_feed_validation',
		    last_error_message = left(eligible.first_message, 4000),
		    last_attempt_at = clock_timestamp()
		from eligible
		where publication.id = eligible.id
		  and (
		    publication.validation_errors is distinct from eligible.next_validation_errors
		    or publication.last_error_code is distinct from 'grupo_olx_feed_validation'
		    or publication.last_error_message is distinct from left(eligible.first_message, 4000)
		  )
	`, integrationID, string(encoded))
	return err
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
	fallbackUsed := false

	if integration.DefaultRoundRobinID != "" {
		var queuePipelineID, queueStageID string
		err := tx.QueryRow(ctx, `
			select coalesce(target_pipeline_id::text, ''), coalesce(target_stage_id::text, '')
			from public.round_robins
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and coalesce(is_active, true)
		`, integration.OrganizationID, integration.DefaultRoundRobinID).Scan(&queuePipelineID, &queueStageID)
		if errors.Is(err, pgx.ErrNoRows) {
			fallbackUsed = true
			destination.RoundRobinID = ""
		} else if err != nil {
			return portalDestination{}, err
		} else {
			destination.RoundRobinID = integration.DefaultRoundRobinID
			if destination.PipelineID == "" {
				destination.PipelineID = queuePipelineID
			}
			if destination.StageID == "" {
				destination.StageID = queueStageID
			}
		}
	}

	if destination.StageID != "" {
		var pipelineID string
		err := tx.QueryRow(ctx, `
			select pipeline_id::text
			from public.stages
			where organization_id = $1::uuid and id = $2::uuid and coalesce(is_active, true)
		`, integration.OrganizationID, destination.StageID).Scan(&pipelineID)
		if errors.Is(err, pgx.ErrNoRows) {
			fallbackUsed = true
			destination.StageID = ""
		} else if err != nil {
			return portalDestination{}, err
		} else {
			destination.PipelineID = pipelineID
		}
	}
	if destination.PipelineID != "" {
		var pipelineActive bool
		if err := tx.QueryRow(ctx, `
			select exists (
			  select 1 from public.pipelines
			  where organization_id = $1::uuid and id = $2::uuid and coalesce(is_active, true)
			)
		`, integration.OrganizationID, destination.PipelineID).Scan(&pipelineActive); err != nil {
			return portalDestination{}, err
		}
		if !pipelineActive {
			fallbackUsed = true
			destination.PipelineID = ""
			destination.StageID = ""
		}
	}
	if destination.AssignedUserID != "" {
		var assigneeActive bool
		if err := tx.QueryRow(ctx, `
			select exists (
			  select 1
			  from public.organization_members member
			  join public.users user_profile on user_profile.id = member.user_id
			  where member.organization_id = $1::uuid
			    and member.user_id = $2::uuid
			    and coalesce(member.is_active, true)
			    and coalesce(user_profile.is_active, true)
			)
		`, integration.OrganizationID, destination.AssignedUserID).Scan(&assigneeActive); err != nil {
			return portalDestination{}, err
		}
		if !assigneeActive {
			fallbackUsed = true
			destination.AssignedUserID = ""
		}
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
		if errors.Is(err, pgx.ErrNoRows) {
			destination.PipelineID = ""
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
		if errors.Is(err, pgx.ErrNoRows) {
			destination.StageID = ""
		}
	}
	if fallbackUsed {
		// Configuration drift must never drop an authenticated provider lead.
		// Record a stable operational signal and continue with the active fallback.
		_, _ = tx.Exec(ctx, `
			update public.portal_integrations
			set last_sync_status = 'lead_destination_fallback',
			    last_error = 'Destino de leads inativo; fallback ativo aplicado.'
			where id = $1::uuid
		`, integration.ID)
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
			left join public.teams direct_team
			  on direct_team.id = entries.team_id
			 and direct_team.organization_id = entries.organization_id
			 and coalesce(direct_team.is_active, true)
			left join public.team_members tm
			  on tm.organization_id = entries.organization_id
			 and tm.team_id = entries.team_id
			 and tm.user_id = entries.user_id
			 and coalesce(tm.is_active, true)
			where entries.user_id is not null
			  and (entries.team_id is null or (direct_team.id is not null and tm.id is not null))
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
		where `+distribution.RoundRobinAvailabilityPredicateSQL+`
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
	if !validWebhookAuthorization(authorization, repo.webhookSecret) {
		return leadWebhookResult{}, ErrUnauthorized
	}
	// A paused account can remain advertised by Grupo OLX for hours. Keep the
	// authenticated drain path accepting leads until the provider removes it.
	integration, err := repo.integrationByPublicToken(ctx, token, "webhook_token", false)
	if err != nil {
		return leadWebhookResult{}, err
	}
	var body map[string]any
	if err := json.Unmarshal(payload, &body); err != nil {
		return leadWebhookResult{}, ErrInvalidInput
	}
	rawEventKey := strings.TrimSpace(firstText(body, "originLeadId", "leadId", "id"))
	if rawEventKey == "" {
		return leadWebhookResult{}, ErrInvalidInput
	}
	eventKey := normalizeGrupoOLXLeadEventKey(rawEventKey, payload)
	rawClientListingID := strings.TrimSpace(firstText(body, "clientListingId", "listingId", "propertyCode"))
	isMCMVLead := isGrupoOLXMCMVLead(body)
	if !isMCMVLead && (rawClientListingID == "" || utf8.RuneCountInString(rawClientListingID) > 50) {
		return leadWebhookResult{}, ErrInvalidInput
	}
	clientListingID := truncatePortalRunes(rawClientListingID, 80)
	lookupListingID := rawClientListingID
	if utf8.RuneCountInString(lookupListingID) > 50 {
		lookupListingID = ""
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return leadWebhookResult{}, err
	}
	defer tx.Rollback(ctx)

	eventID, existingLeadID, existingPropertyID, duplicate, err := insertWebhookEvent(ctx, tx, integration, "lead", eventKey, payload)
	if err != nil {
		return leadWebhookResult{}, err
	}
	if duplicate {
		if err := tx.Commit(ctx); err != nil {
			return leadWebhookResult{}, err
		}
		return leadWebhookResult{
			EventID: eventID, LeadID: existingLeadID, PropertyID: existingPropertyID,
			Duplicate: true, Linked: existingPropertyID != nil,
		}, nil
	}

	var propertyID, propertyCode *string
	if lookupListingID != "" {
		propertyID, propertyCode, err = findPublicationProperty(ctx, tx, integration.ID, lookupListingID)
		if err != nil {
			return leadWebhookResult{}, err
		}
	}
	unlinkedOrdinaryLead := !isMCMVLead && propertyID == nil
	destination, err := repo.resolvePortalDestination(ctx, tx, integration)
	if err != nil {
		return leadWebhookResult{}, err
	}

	name := truncatePortalRunes(firstText(body, "name", "consumerName", "leadName"), 180)
	email := normalizeGrupoOLXLeadEmail(firstText(body, "email", "consumerEmail"))
	phone := normalizeGrupoOLXLeadPhone(body)
	message := truncatePortalRunes(firstText(body, "message", "messageBody", "description"), 2000)
	leadOrigin, leadType, providerOccurredAt, mcmv := grupoOLXLeadAnalytics(body)
	leadOrigin = truncatePortalRunes(leadOrigin, 80)
	leadType = truncatePortalRunes(leadType, 80)
	sourceDetail := leadType
	if isMCMVLead {
		sourceDetail = "MCMV_OLX"
	}
	if sourceDetail == "" {
		sourceDetail = "Grupo OLX"
	}

	leadID := ""
	leadMetadata := map[string]any{
		"provider":              "grupo_olx",
		"origin_lead_id":        eventKey,
		"client_listing_id":     clientListingID,
		"property_code":         clientListingID,
		"origin_listing_id":     truncatePortalRunes(firstText(body, "originListingId"), 80),
		"temperature":           truncatePortalRunes(firstText(body, "temperature"), 80),
		"transaction_type":      truncatePortalRunes(firstText(body, "transactionType"), 80),
		"lead_origin":           leadOrigin,
		"lead_type":             leadType,
		"provider_occurred_at":  providerOccurredAt,
		"webhook_payload":       body,
		"distribution_deferred": true,
	}
	if unlinkedOrdinaryLead {
		leadMetadata["unlinked_reason"] = "listing_not_found"
	}
	if mcmv != nil {
		leadMetadata["mcmv"] = mcmv
	}
	metadataJSON, _ := json.Marshal(leadMetadata)
	leadID, _, err = repo.persistGrupoOLXLead(
		ctx, tx, integration, destination, eventKey, name, email, phone,
		sourceDetail, message, providerOccurredAt, propertyID, propertyCode, metadataJSON,
	)
	if err != nil {
		return leadWebhookResult{}, err
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
	var roundRobinID *string
	if destination.RoundRobinID != "" {
		roundRobinID = &destination.RoundRobinID
	}
	distributionSource := "grupo_olx"
	if _, err := distribution.Distribute(ctx, tx, distribution.Request{
		OrganizationID:   integration.OrganizationID,
		LeadID:           leadID,
		IdempotencyKey:   "portal:" + eventID,
		RoundRobinID:     roundRobinID,
		PreserveAssignee: true,
		Source:           &distributionSource,
		OccurredAt:       time.Now().UTC(),
	}); err != nil {
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
		    status = case when is_active and status <> 'paused' then 'connected' else status end,
		    last_sync_status = case when $2::boolean then 'lead_received_unlinked' else last_sync_status end,
		    last_error = case when $2::boolean
		      then left('Lead recebido sem vínculo para ListingID ' || $3, 4000)
		      else last_error end,
		    updated_at = now()
		where id = $1::uuid
	`, integration.ID, unlinkedOrdinaryLead, clientListingID)
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

func (repo Repository) persistGrupoOLXLead(
	ctx context.Context,
	tx pgx.Tx,
	integration publicIntegration,
	destination portalDestination,
	eventKey string,
	name string,
	email string,
	phone string,
	sourceDetail string,
	message string,
	providerOccurredAt string,
	propertyID *string,
	propertyCode *string,
	metadataJSON []byte,
) (string, bool, error) {
	leadID := ""
	reentry := false
	if phone != "" {
		if _, err := tx.Exec(ctx, `
			select pg_advisory_xact_lock(
			  hashtextextended('lead-phone:' || $1 || ':' || normalize_phone($2), 0)
			)
		`, integration.OrganizationID, phone); err != nil {
			return "", false, err
		}
		err := tx.QueryRow(ctx, `
			select id::text
			from public.leads
			where organization_id = $1::uuid
			  and normalize_phone(phone) = normalize_phone($2)
			order by created_at, id
			limit 1
			for update
		`, integration.OrganizationID, phone).Scan(&leadID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return "", false, err
		}
		reentry = err == nil
	}

	if reentry {
		// The entry is written before moving the lead so funnel triggers attribute
		// any state transition to this provider event, not the previous contact.
		if _, err := tx.Exec(ctx, `
			insert into public.lead_entry_events (
			  lead_id, organization_id, entry_type, source, source_detail,
			  provider, provider_event_id, occurred_at, property_id,
			  pipeline_id, stage_id, metadata, payload, created_at
			) values (
			  $1::uuid, $2::uuid, 'reentry', 'grupo_olx', $3,
			  'grupo_olx', $4, coalesce(nullif($5, '')::timestamptz, clock_timestamp()),
			  nullif($6, '')::uuid, nullif($7, '')::uuid, nullif($8, '')::uuid,
			  $9::jsonb, $9::jsonb, clock_timestamp()
			)
		`, leadID, integration.OrganizationID, sourceDetail, eventKey, providerOccurredAt,
			nullableStringValue(propertyID), destination.PipelineID, destination.StageID, string(metadataJSON)); err != nil {
			return "", false, err
		}
		if _, err := tx.Exec(ctx, `
			update public.leads
			set name = coalesce(nullif($3, ''), name),
			    email = coalesce(nullif($4, ''), email),
			    phone = coalesce(nullif($5, ''), phone),
			    source = coalesce(nullif(source, ''), 'grupo_olx'),
			    source_detail = coalesce(nullif($6, ''), source_detail),
			    message = coalesce(nullif($7, ''), message),
			    initial_message = coalesce(initial_message, nullif($7, '')),
			    pipeline_id = coalesce(nullif($8, '')::uuid, pipeline_id),
			    stage_entered_at = case
			      when nullif($9, '')::uuid is null or stage_id is not distinct from nullif($9, '')::uuid then stage_entered_at
			      else clock_timestamp() end,
			    board_order_at = case
			      when nullif($9, '')::uuid is null or stage_id is not distinct from nullif($9, '')::uuid then coalesce(board_order_at, stage_entered_at, created_at)
			      else clock_timestamp() end,
			    stage_id = coalesce(nullif($9, '')::uuid, stage_id),
			    property_id = coalesce(nullif($10, '')::uuid, property_id),
			    interest_property_id = coalesce(nullif($10, '')::uuid, interest_property_id),
			    property_code = coalesce(nullif($11, ''), property_code),
			    last_entry_at = clock_timestamp(),
			    reentry_count = coalesce(reentry_count, 0) + 1,
			    metadata = coalesce(metadata, '{}'::jsonb) || $12::jsonb,
			    updated_at = clock_timestamp()
			where organization_id = $1::uuid and id = $2::uuid
		`, integration.OrganizationID, leadID, name, email, phone, sourceDetail, message,
			destination.PipelineID, destination.StageID, nullableStringValue(propertyID), nullableStringValue(propertyCode), string(metadataJSON)); err != nil {
			return "", false, err
		}
	} else {
		err := tx.QueryRow(ctx, `
			insert into public.leads (
			  organization_id, pipeline_id, stage_id, assigned_user_id, team_id,
			  property_id, interest_property_id, property_code, name, email, phone,
			  source, source_detail, message, initial_message, status, deal_status,
			  utm_source, utm_medium, metadata, created_by, last_entry_at, updated_at
			) values (
			  $1::uuid, nullif($2, '')::uuid, nullif($3, '')::uuid,
			  nullif($4, '')::uuid, nullif($5, '')::uuid,
			  nullif($6, '')::uuid, nullif($6, '')::uuid, nullif($7, ''),
			  coalesce(nullif($8, ''), 'Lead Grupo OLX'), nullif($9, ''), nullif($10, ''), 'grupo_olx', $11,
			  nullif($12, ''), nullif($12, ''), 'new', 'open',
			  'grupo_olx', 'portal', $13::jsonb, nullif($14, '')::uuid,
			  clock_timestamp(), clock_timestamp()
			)
			returning id::text
		`, integration.OrganizationID, destination.PipelineID, destination.StageID,
			destination.AssignedUserID, destination.TeamID, nullableStringValue(propertyID),
			nullableStringValue(propertyCode), name, email, phone, sourceDetail, message,
			string(metadataJSON), destination.AssignedUserID).Scan(&leadID)
		if err != nil {
			return "", false, err
		}
		// Enrich the trigger-created initial entry instead of creating a second
		// countable row for the same first provider contact.
		if _, err := tx.Exec(ctx, `
			update public.lead_entry_events entry
			set provider = 'grupo_olx',
			    provider_event_id = $3,
			    source_detail = $4,
			    occurred_at = coalesce(nullif($5, '')::timestamptz, entry.occurred_at, clock_timestamp()),
			    property_id = nullif($6, '')::uuid,
			    pipeline_id = nullif($7, '')::uuid,
			    stage_id = nullif($8, '')::uuid,
			    metadata = coalesce(entry.metadata, '{}'::jsonb) || $9::jsonb,
			    payload = $9::jsonb
			where entry.id = (
			  select initial.id
			  from public.lead_entry_events initial
			  where initial.organization_id = $1::uuid
			    and initial.lead_id = $2::uuid
			    and initial.entry_type = 'initial'
			  order by initial.created_at desc, initial.id desc
			  limit 1
			)
		`, integration.OrganizationID, leadID, eventKey, sourceDetail, providerOccurredAt,
			nullableStringValue(propertyID), destination.PipelineID, destination.StageID, string(metadataJSON)); err != nil {
			return "", false, err
		}
	}

	if propertyID != nil {
		if _, err := tx.Exec(ctx, `
			insert into public.lead_property_interests (lead_id, property_id, interest_level, notes)
			values ($1::uuid, $2::uuid, 'high', 'Interesse recebido pelo Grupo OLX')
			on conflict (lead_id, property_id) do update
			set interest_level = 'high'
		`, leadID, *propertyID); err != nil {
			return "", false, err
		}
	}
	return leadID, reentry, nil
}

func isGrupoOLXMCMVLead(body map[string]any) bool {
	origin, _, _, _ := grupoOLXLeadAnalytics(body)
	return origin == "mcmv_olx"
}

func grupoOLXLeadAnalytics(body map[string]any) (string, string, string, any) {
	leadOrigin := strings.ToLower(strings.TrimSpace(firstText(body, "leadOrigin", "lead_origin")))
	extra := objectValue(body["extraData"])
	leadType := strings.TrimSpace(firstText(body, "leadType", "channel"))
	if leadType == "" {
		leadType = strings.TrimSpace(firstText(extra, "leadType", "channel"))
	}
	providerOccurredAt := ""
	if occurredAt := parsePortalReportTimestamp(firstValue(body, "timestamp", "createdAt", "created_at", "leadCreatedAt", "date")); occurredAt != nil {
		providerOccurredAt = occurredAt.UTC().Format(time.RFC3339Nano)
	}
	return leadOrigin, leadType, providerOccurredAt, extra["mcmv"]
}

func (repo Repository) ReceiveGrupoOLXImportReport(ctx context.Context, token string, authorization string, payload []byte) (map[string]any, error) {
	if !validWebhookAuthorization(authorization, repo.webhookSecret) {
		return nil, ErrUnauthorized
	}
	integration, err := repo.integrationByPublicToken(ctx, token, "webhook_token", false)
	if err != nil {
		return nil, err
	}
	if !json.Valid(payload) {
		return nil, ErrInvalidInput
	}
	decoded, err := decodePortalJSONUseNumber(payload)
	if err != nil {
		return nil, ErrInvalidInput
	}
	body, _ := decoded.(map[string]any)
	reportID := normalizeGrupoOLXReportID(firstText(body, "id", "reportId", "importId"), payload)
	var raw []byte
	err = repo.db.Pool().QueryRow(ctx, `
		insert into public.portal_import_reports (
			integration_id,
			organization_id,
			portal,
			report_id,
			status,
			summary,
			raw_payload,
			raw_body,
			error,
			annotation_status,
			annotation_attempts,
			annotation_next_attempt_at
		)
		values ($1::uuid, $2::uuid, 'grupo_olx', $3, 'received', '{}'::jsonb, '{}'::jsonb, $4::bytea, null, 'pending', 0, now())
		on conflict (integration_id, report_id) where report_id is not null
		do update set report_id = portal_import_reports.report_id
		returning jsonb_build_object(
		  'id', id::text,
		  'report_id', report_id,
		  'status', status,
		  'annotation_status', annotation_status,
		  'annotation_attempts', annotation_attempts,
		  'created_at', created_at
		)
	`, integration.ID, integration.OrganizationID, reportID, payload).Scan(&raw)
	if err != nil {
		return nil, err
	}
	// The inbox INSERT above is already committed and must never be rolled back
	// by telemetry contention. Refresh the panel immediately on a separate,
	// bounded best-effort statement; the worker also reconciles this timestamp.
	receiptCtx, cancelReceipt := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	_, _ = repo.db.Pool().Exec(receiptCtx, `
		update public.portal_integrations
		set last_import_report_at = greatest(coalesce(last_import_report_at, '-infinity'::timestamptz), clock_timestamp()),
		    updated_at = clock_timestamp()
		where id = $1::uuid
	`, integration.ID)
	cancelReceipt()
	item, err := decodeJSONObject(raw)
	if err != nil {
		return nil, err
	}
	wakeImportReportWorker()
	return item, nil
}

func (repo Repository) markImportReportAnnotationFailure(ctx context.Context, integrationID string, reportID string, cause error) {
	if cause == nil {
		return
	}
	markCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	_, _ = repo.db.Pool().Exec(markCtx, `
		update public.portal_import_reports
		set annotation_attempts = least(annotation_attempts + 1, 12),
		    annotation_status = case when annotation_attempts + 1 >= 12 then 'dead' else 'retry' end,
		    annotation_next_attempt_at = case
		      when annotation_attempts + 1 >= 12 then clock_timestamp()
		      else clock_timestamp() + least(
		        interval '10 seconds' * power(2::double precision, least(annotation_attempts, 9)::double precision),
		        interval '1 hour'
		      )
		    end,
		    annotation_processed_at = case when annotation_attempts + 1 >= 12 then clock_timestamp() else null end,
		    annotation_last_error = left($3, 4000)
		where integration_id = $1::uuid
		  and report_id = $2
		  and annotation_status in ('pending', 'retry')
	`, integrationID, reportID, "annotation_processing_failed")
}

func importReportRetryDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	delay := 10 * time.Second
	for current := 1; current < attempt && delay < time.Hour; current++ {
		delay *= 2
	}
	if delay > time.Hour {
		return time.Hour
	}
	return delay
}

func (repo Repository) applyReportIssues(
	ctx context.Context,
	tx pgx.Tx,
	integrationID string,
	issues map[string][]string,
	asError bool,
	reportOccurredAt *time.Time,
) error {
	if len(issues) == 0 || reportOccurredAt == nil {
		// Without a provider timestamp there is no safe fence against a later
		// legacy re-export. Raw/provider feedback remains available in the inbox.
		return nil
	}
	normalized := make(map[string][]string, len(issues))
	for listingID, issueMessages := range issues {
		messages := uniqueNonEmptyStrings(issueMessages)
		for index := range messages {
			messages[index] = truncatePortalRunes(messages[index], 1000)
		}
		messages = uniqueNonEmptyStrings(messages)
		if len(messages) > 0 {
			normalized[listingID] = messages
		}
	}
	if len(normalized) == 0 {
		return nil
	}
	issuesJSON, err := json.Marshal(normalized)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		update public.portal_listing_publications publication
		set status = case when $4::boolean then 'error' else publication.status end,
		    validation_errors = (
		      select coalesce(jsonb_agg(message order by message), '[]'::jsonb)
		      from (
		        select distinct jsonb_array_elements_text(coalesce(publication.validation_errors, '[]'::jsonb)) as message
		        union
		        select distinct jsonb_array_elements_text(issue.messages) as message
		      ) merged
		    ),
		    last_error = case when $4::boolean then issue.messages->>0 else publication.last_error end,
		    updated_at = clock_timestamp()
		from jsonb_each($2::jsonb) as issue(listing_id, messages)
		where publication.integration_id = $1::uuid
		  and publication.client_listing_id = issue.listing_id
		  and (publication.last_exported_at is null or publication.last_exported_at <= $3::timestamptz)
		  and not exists (
		    select 1
		    from public.property_channel_publications canonical
		    where canonical.channel = 'grupo_olx'
		      and canonical.channel_account_key = $1
		      and canonical.provider_listing_id = issue.listing_id
		  )
	`, integrationID, string(issuesJSON), *reportOccurredAt, asError)
	return err
}

type portalPublicationCheck struct {
	Code     string  `json:"code"`
	Label    string  `json:"label"`
	Severity string  `json:"severity"`
	Resolved bool    `json:"resolved"`
	Message  *string `json:"message,omitempty"`
}

func reportCanAnnotateCanonical(reportOccurredAt *time.Time, currentPublishedAt time.Time) bool {
	if reportOccurredAt == nil || currentPublishedAt.IsZero() {
		return false
	}
	return !reportOccurredAt.Before(currentPublishedAt)
}

func parsePortalReportTimestamp(value any) *time.Time {
	if value == nil {
		return nil
	}
	if raw, ok := value.(string); ok {
		raw = strings.TrimSpace(raw)
		// Grupo OLX's official example omits an offset. Interpret that layout as
		// UTC only for the conservative annotation fence: this can defer an
		// annotation, but cannot shift a Brazilian local time into the future and
		// accidentally annotate a newer publication version. Raw inbox storage is
		// independent from this best-effort timestamp.
		for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05Z07:00", "2006-01-02T15:04:05", "2006-01-02 15:04:05"} {
			parsed, err := time.Parse(layout, raw)
			if err == nil {
				parsed = parsed.UTC()
				return &parsed
			}
		}
		numeric, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			return nil
		}
		return portalEpochTimestamp(numeric)
	}
	switch typed := value.(type) {
	case float64:
		return portalEpochTimestamp(typed)
	case float32:
		return portalEpochTimestamp(float64(typed))
	case int:
		return portalEpochTimestamp(float64(typed))
	case int64:
		return portalEpochTimestamp(float64(typed))
	case json.Number:
		numeric, err := typed.Float64()
		if err == nil {
			return portalEpochTimestamp(numeric)
		}
	}
	return nil
}

func portalEpochTimestamp(numeric float64) *time.Time {
	if numeric <= 0 {
		return nil
	}
	seconds := int64(numeric)
	if seconds > 10_000_000_000 {
		seconds /= 1000
	}
	parsed := time.Unix(seconds, 0).UTC()
	return &parsed
}

func decodeStrictPortalChecks(raw []byte) []portalPublicationCheck {
	var candidates []json.RawMessage
	if err := json.Unmarshal(raw, &candidates); err != nil {
		return []portalPublicationCheck{}
	}
	checks := make([]portalPublicationCheck, 0, len(candidates))
	for _, candidate := range candidates {
		var check portalPublicationCheck
		if err := json.Unmarshal(candidate, &check); err != nil {
			continue
		}
		if strings.TrimSpace(check.Code) == "" || strings.TrimSpace(check.Label) == "" ||
			(check.Severity != "info" && check.Severity != "warning" && check.Severity != "error") {
			continue
		}
		if check.Message != nil {
			message := truncatePortalRunes(*check.Message, 1000)
			check.Message = &message
		}
		checks = append(checks, check)
	}
	return checks
}

func mergePortalIssueChecks(
	checks []portalPublicationCheck,
	messages []string,
	severity string,
	codePrefix string,
	label string,
) []portalPublicationCheck {
	existing := make(map[string]bool, len(checks))
	for _, check := range checks {
		existing[check.Severity+"\x00"+strings.TrimSpace(pointerString(check.Message))] = true
	}
	for _, message := range uniqueNonEmptyStrings(messages) {
		message = truncatePortalRunes(message, 1000)
		if message == "" {
			continue
		}
		key := severity + "\x00" + message
		if existing[key] {
			continue
		}
		digest := sha256.Sum256([]byte(key))
		messageCopy := message
		checks = append(checks, portalPublicationCheck{
			Code:     codePrefix + "_" + hex.EncodeToString(digest[:6]),
			Label:    label,
			Severity: severity,
			Resolved: false,
			Message:  &messageCopy,
		})
		existing[key] = true
	}
	return checks
}

func uniqueNonEmptyStrings(values []string) []string {
	result := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func pointerString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func truncatePortalRunes(value string, maximum int) string {
	value = strings.ReplaceAll(value, "\x00", "")
	value = strings.TrimSpace(value)
	if maximum < 1 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= maximum {
		return value
	}
	return strings.TrimSpace(string(runes[:maximum]))
}

type publicIntegration struct {
	ID                    string
	OrganizationID        string
	Status                string
	IsActive              bool
	DefaultPipelineID     string
	DefaultStageID        string
	DefaultAssignedUserID string
	DefaultRoundRobinID   string
	Settings              map[string]any
	ModuleEnabled         bool
	FeedPublishedAt       time.Time
}

func (repo Repository) integrationByPublicToken(ctx context.Context, token string, column string, requireActive bool) (publicIntegration, error) {
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
			coalesce(pi.default_pipeline_id::text, ''),
			coalesce(pi.default_stage_id::text, ''),
			coalesce(pi.default_assigned_user_id::text, ''),
			coalesce(pi.default_round_robin_id::text, ''),
			pi.settings,
			-- Access telemetry updates both portal tables and their legacy triggers
			-- always rewrite updated_at. PublishDate therefore uses the immutable
			-- integration creation time; the strong ETag still hashes every actual
			-- representation field and changes whenever the XML changes.
			pi.created_at
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
		&integration.DefaultPipelineID,
		&integration.DefaultStageID,
		&integration.DefaultAssignedUserID,
		&integration.DefaultRoundRobinID,
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
	if requireActive && (!integration.IsActive || integration.Status == "paused" || !integration.ModuleEnabled) {
		return publicIntegration{}, ErrModuleUnavailable
	}
	return integration, nil
}

func (repo Repository) portalModuleEnabled(ctx context.Context, organizationID string) (bool, error) {
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
	return enabled, err
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
	return decodeGrupoOLXIntegration(raw)
}

type feedSelection struct {
	Listings         []feedListing
	Invalid          map[string][]string
	InvalidLegacy    map[string][]string
	InvalidCanonical map[string]canonicalFeedValidationIssue
	ValidCanonical   map[string]canonicalFeedValidationIssue
}

type canonicalFeedValidationIssue struct {
	Messages         []string
	PublishedVersion int64
	VersionID        string
	PayloadHash      string
}

func (repo Repository) feedListings(ctx context.Context, integration publicIntegration) (feedSelection, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		with canonical_scope as (
		  select publication.property_id, publication.provider_listing_id
		  from public.property_channel_publications publication
		  where publication.organization_id = $2::uuid
		    and publication.channel = 'grupo_olx'
		    and publication.channel_account_key = $1
		), feed_rows as (
		  select publication.id::text as publication_id,
		         publication.property_id::text as property_id,
		         'canonical'::text as source,
		         version.id::text as version_id,
		         version.version as published_version,
		         version.payload_hash,
		         version.payload->'channel_config'->>'client_listing_id' as client_listing_id,
		         version.payload->'channel_config'->>'publication_type' as publication_type,
		         version.payload->'property' as property,
		         version.payload->'media' as media,
		         publication.updated_at as sort_at
		  from public.property_channel_publications publication
		  join public.property_channel_publication_versions version
		    on version.publication_id = publication.id
		   and version.organization_id = publication.organization_id
		   and version.property_id = publication.property_id
		   and version.channel = publication.channel
		   and version.channel_account_key = publication.channel_account_key
		   and version.version = publication.published_version
		  where publication.organization_id = $2::uuid
		    and publication.channel = 'grupo_olx'
		    and publication.channel_account_key = $1
		    and publication.desired_state = 'published'
		    and publication.observed_state in ('published', 'queued', 'publishing')
		    and publication.published_version is not null
		    and jsonb_typeof(version.payload->'property') = 'object'
		    and jsonb_typeof(version.payload->'channel_config') = 'object'

		  union all

		  select legacy.id::text,
		         legacy.property_id::text,
		         'legacy'::text,
		         ''::text,
		         0::bigint,
		         ''::text,
		         legacy.client_listing_id,
		         legacy.publication_type,
		         to_jsonb(property),
		         '[]'::jsonb,
		         property.updated_at
		  from public.portal_listing_publications legacy
		  join public.properties property
		    on property.organization_id = legacy.organization_id
		   and property.id = legacy.property_id
		  where legacy.integration_id = $1::uuid
		    and legacy.organization_id = $2::uuid
		    and legacy.portal = 'grupo_olx'
		    and legacy.is_enabled = true
		    and not exists (
		      select 1
		      from canonical_scope canonical
		      where canonical.property_id = legacy.property_id
		         or canonical.provider_listing_id = legacy.client_listing_id
		    )
		)
		select jsonb_build_object(
		  'publication_id', publication_id,
		  'property_id', property_id,
		  'source', source,
		  'version_id', version_id,
		  'published_version', published_version,
		  'payload_hash', payload_hash,
		  'client_listing_id', client_listing_id,
		  'publication_type', publication_type,
		  'property', property,
		  'media', media
		)
		from feed_rows
		order by sort_at desc, publication_id
		limit 50001
	`, integration.ID, integration.OrganizationID)
	if err != nil {
		return feedSelection{}, err
	}
	defer rows.Close()
	selection := feedSelection{
		Listings:         []feedListing{},
		Invalid:          map[string][]string{},
		InvalidLegacy:    map[string][]string{},
		InvalidCanonical: map[string]canonicalFeedValidationIssue{},
		ValidCanonical:   map[string]canonicalFeedValidationIssue{},
	}
	candidateCount := 0
	for rows.Next() {
		candidateCount++
		if err := ensureFeedListingLimit(candidateCount); err != nil {
			return feedSelection{}, err
		}
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
			if listing.Source == "canonical" {
				selection.ValidCanonical[listing.PublicationID] = canonicalFeedValidationIssue{
					PublishedVersion: listing.PublishedVersion,
					VersionID:        listing.VersionID, PayloadHash: listing.PayloadHash,
				}
			}
		} else {
			selection.Invalid[listing.PublicationID] = validationErrors
			if listing.Source == "canonical" {
				selection.InvalidCanonical[listing.PublicationID] = canonicalFeedValidationIssue{
					Messages: validationErrors, PublishedVersion: listing.PublishedVersion,
					VersionID: listing.VersionID, PayloadHash: listing.PayloadHash,
				}
			} else {
				selection.InvalidLegacy[listing.PublicationID] = validationErrors
			}
		}
	}
	return selection, rows.Err()
}

func ensureFeedListingLimit(candidateCount int) error {
	if candidateCount > maxGrupoOLXFeedListings {
		return ErrFeedListingLimit
	}
	return nil
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

func insertWebhookEvent(ctx context.Context, tx pgx.Tx, integration publicIntegration, eventType string, eventKey string, payload []byte) (string, *string, *string, bool, error) {
	var eventID string
	var leadID *string
	var propertyID *string
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
		on conflict (integration_id, event_type, event_key) where event_key is not null
		do nothing
		returning id::text, lead_id::text, property_id::text
	`, integration.ID, integration.OrganizationID, eventType, eventKey, string(payload)).Scan(&eventID, &leadID, &propertyID)
	if err == nil {
		return eventID, leadID, propertyID, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", nil, nil, false, err
	}

	err = tx.QueryRow(ctx, `
		select id::text, lead_id::text, property_id::text
		from public.portal_webhook_events
		where integration_id = $1::uuid
		  and event_type = $2
		  and event_key = $3
		limit 1
	`, integration.ID, eventType, eventKey).Scan(&eventID, &leadID, &propertyID)
	if err != nil {
		return "", nil, nil, false, err
	}

	_, _ = tx.Exec(ctx, `
		update public.portal_webhook_events
		set processing_status = case when lead_id is null then 'duplicate' else processing_status end
		where id = $1::uuid
	`, eventID)
	return eventID, leadID, propertyID, true, nil
}

func findPublicationProperty(ctx context.Context, tx pgx.Tx, integrationID string, clientListingID string) (*string, *string, error) {
	if strings.TrimSpace(clientListingID) == "" {
		return nil, nil, nil
	}
	var propertyID string
	var propertyCode string
	err := tx.QueryRow(ctx, `
		select property.id::text, property.code
		from public.property_channel_publications publication
		join public.properties property
		  on property.organization_id = publication.organization_id
		 and property.id = publication.property_id
		where publication.channel = 'grupo_olx'
		  and publication.channel_account_key = $1
		  and publication.provider_listing_id = $2
		order by (publication.observed_state = 'published') desc, publication.updated_at desc
		limit 1
	`, integrationID, clientListingID).Scan(&propertyID, &propertyCode)
	if err == nil {
		return &propertyID, &propertyCode, nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, err
	}

	err = tx.QueryRow(ctx, `
		select property.id::text, property.code
		from public.portal_listing_publications publication
		join public.properties property
		  on property.organization_id = publication.organization_id
		 and property.id = publication.property_id
		where publication.integration_id = $1::uuid
		  and publication.client_listing_id = $2
		  and publication.is_enabled = true
		  and not exists (
		    select 1
		    from public.property_channel_publications canonical
		    where canonical.channel = 'grupo_olx'
		      and canonical.channel_account_key = $1
		      and canonical.provider_listing_id = $2
		  )
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
	if header == "" || !strings.HasPrefix(strings.ToLower(header), "basic ") {
		return false
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(header[6:]))
	if err != nil {
		return false
	}
	parts := strings.SplitN(string(decoded), ":", 2)
	candidates := []string{string(decoded)}
	if len(parts) == 2 {
		candidates = append(candidates, parts[1])
	}
	for _, candidate := range candidates {
		if webhookSecretMatches(secret, candidate) {
			return true
		}
	}
	return false
}

func webhookSecretMatches(stored string, candidate string) bool {
	stored = strings.TrimSpace(stored)
	candidate = strings.TrimSpace(candidate)
	if stored == "" || candidate == "" {
		return false
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

func decodePortalJSONUseNumber(payload []byte) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()
	var decoded any
	if err := decoder.Decode(&decoded); err != nil {
		return nil, err
	}
	return decoded, nil
}

const maxGrupoOLXProviderIDRunes = 512

func normalizeGrupoOLXLeadEventKey(value string, payload []byte) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "sha256:" + payloadHash(payload)
	}
	if utf8.RuneCountInString(value) > maxGrupoOLXProviderIDRunes {
		return "sha256:" + payloadHash(payload)
	}
	return value
}

func normalizeGrupoOLXReportID(value string, payload []byte) string {
	value = strings.TrimSpace(value)
	if value == "" || strings.ContainsRune(value, '\x00') || !utf8.ValidString(value) ||
		utf8.RuneCountInString(value) > maxGrupoOLXProviderIDRunes {
		return payloadHash(payload)
	}
	return value
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

const (
	maxGrupoOLXReportListings           = 50000
	maxGrupoOLXReportMessagesPerListing = 20
)

func reportListingIssues(value any, messageKey string) (map[string][]string, error) {
	result := map[string][]string{}
	items, ok := value.([]any)
	if !ok {
		return result, nil
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
			listingID := truncatePortalRunes(fmt.Sprint(rawID), maxGrupoOLXProviderIDRunes)
			if listingID == "" {
				continue
			}
			if _, exists := result[listingID]; !exists && len(result) >= maxGrupoOLXReportListings {
				return nil, fmt.Errorf("grupo olx report exceeds %d unique ListingIDs", maxGrupoOLXReportListings)
			}
			if len(result[listingID]) < maxGrupoOLXReportMessagesPerListing {
				result[listingID] = append(result[listingID], message)
			}
		}
	}
	for listingID, messages := range result {
		result[listingID] = uniqueNonEmptyStrings(messages)
	}
	return result, nil
}

func normalizePhone(phone string, ddd string) string {
	phone = onlyDigits(phone)
	ddd = onlyDigits(ddd)
	if ddd != "" && !strings.HasPrefix(phone, ddd) {
		phone = ddd + phone
	}
	return phone
}

func normalizeGrupoOLXLeadPhone(body map[string]any) string {
	ddd := onlyDigits(firstText(body, "ddd"))
	phone := ""
	if officialPhone := onlyDigits(firstText(body, "phone")); officialPhone != "" {
		// In the official Grupo OLX contract `phone` excludes DDD. Do not use a
		// prefix heuristic: subscriber numbers can legitimately start with it.
		phone = ddd + officialPhone
	} else {
		phone = normalizePhone(firstText(body, "phoneNumber", "consumerPhone"), ddd)
	}
	if len(phone) < 8 || len(phone) > 40 {
		return ""
	}
	return phone
}

func normalizeGrupoOLXLeadEmail(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" || utf8.RuneCountInString(value) > 254 {
		return ""
	}
	address, err := mail.ParseAddress(value)
	if err != nil || !strings.EqualFold(address.Address, value) {
		return ""
	}
	return value
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

func validGrupoOLXImportReportPayload(body map[string]any) bool {
	if body == nil || !strings.EqualFold(strings.TrimSpace(firstText(body, "type")), "FEEDS_INTEGRATION_REPORT") {
		return false
	}
	details := objectValue(body["details"])
	if len(details) == 0 || parsePortalReportTimestamp(firstValue(details, "date")) == nil {
		return false
	}
	for _, aliases := range [][]string{
		{"total", "totalListings"}, {"created", "createdListings"},
		{"updated", "updatedListings"}, {"deleted"}, {"unchanged"},
		{"error", "errors", "errorCount"}, {"warning", "warnings", "warningCount"},
	} {
		value := firstValue(details, aliases...)
		if _, valid := grupoOLXReportCount(value); !valid {
			return false
		}
	}
	return true
}

func grupoOLXReportCount(value any) (int64, bool) {
	var number float64
	switch typed := value.(type) {
	case float64:
		number = typed
	case float32:
		number = float64(typed)
	case int:
		return int64(typed), typed >= 0
	case int32:
		return int64(typed), typed >= 0
	case int64:
		return typed, typed >= 0
	case json.Number:
		parsed, err := typed.Int64()
		return parsed, err == nil && parsed >= 0
	default:
		return 0, false
	}
	if math.IsNaN(number) || math.IsInf(number, 0) || number < 0 || math.Trunc(number) != number || number > math.MaxInt64 {
		return 0, false
	}
	return int64(number), true
}

func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339)
}
