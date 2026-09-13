package portals

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

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
