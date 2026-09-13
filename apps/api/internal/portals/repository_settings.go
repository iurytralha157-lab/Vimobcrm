package portals

import (
	"context"
	"encoding/json"
	"errors"
	"net/mail"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/jsonvalue"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

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
	item, err := jsonvalue.DecodeObjectAllowBlank(raw)
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
