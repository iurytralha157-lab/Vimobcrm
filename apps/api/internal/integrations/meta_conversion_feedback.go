package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	metaDatasetTokenMaximumBytes  = 8192
	metaTestEventCodeMaximumBytes = 255
)

func (repo Repository) SaveMetaConversionFeedback(
	ctx context.Context,
	tenantContext tenant.Context,
	request MetaConversionFeedbackRequest,
) (map[string]any, error) {
	if !canManageMetaIntegrations(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	integrationID, ok := validIntegrationUUID(request.IntegrationID)
	if !ok {
		return nil, ErrInvalidInput
	}
	datasetID := cleanMetaDatasetValue(request.DatasetID)
	datasetName := cleanMetaDatasetValue(request.DatasetName)
	datasetToken := cleanMetaDatasetValue(request.DatasetAccessToken)
	testEventCode := cleanMetaDatasetValue(request.TestEventCode)
	if !validMetaDatasetName(datasetName) || !validMetaDatasetToken(datasetToken) {
		return nil, ErrInvalidInput
	}
	if !validMetaTestEventCode(testEventCode) || (testEventCode != "" && !request.ReplayRecentFacts) {
		return nil, ErrInvalidInput
	}
	if request.ReplayRecentFacts && !request.Enabled {
		return nil, ErrInvalidInput
	}
	if datasetID != "" && !isDecimalMetaDatasetID(datasetID) {
		return nil, ErrInvalidInput
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var currentDatasetID *string
	var currentSecretRef *string
	var connected bool
	var marketingEnabled bool
	err = tx.QueryRow(ctx, `
		select
		  integration.crm_dataset_id,
		  integration.crm_dataset_access_token_secret_ref::text,
		  coalesce(integration.is_connected, false),
		  exists (
		    select 1
		    from public.organization_modules as module_access
		    where module_access.organization_id = integration.organization_id
		      and lower(btrim(module_access.module_name)) = 'campaigns'
		      and module_access.is_enabled = true
		  )
		from public.meta_integrations as integration
		where integration.organization_id = $1::uuid
		  and integration.id = $2::uuid
		for update
	`, tenantContext.OrganizationID, integrationID).Scan(
		&currentDatasetID,
		&currentSecretRef,
		&connected,
		&marketingEnabled,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrIntegrationNotFound
	}
	if err != nil {
		return nil, err
	}
	if !marketingEnabled {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	currentDataset := cleanMetaDatasetValue(currentDatasetID)
	if datasetID != "" && datasetID != currentDataset && datasetToken == "" {
		// CRM Dataset credentials are destination-specific. A dataset change,
		// even while feedback is paused, must rotate the token in the same
		// transaction so a later re-enable cannot reuse the previous secret.
		return nil, ErrInvalidInput
	}
	if request.Enabled {
		if !connected || datasetID == "" {
			return nil, ErrInvalidInput
		}
		if datasetToken == "" && cleanMetaDatasetValue(currentSecretRef) == "" {
			return nil, ErrInvalidInput
		}
	} else {
		if datasetID == "" {
			datasetID = currentDataset
		}
	}

	status := "paused"
	if request.Enabled {
		status = "active"
	} else if datasetID == "" && cleanMetaDatasetValue(currentSecretRef) == "" {
		status = "not_configured"
	}

	var raw []byte
	err = tx.QueryRow(ctx, `
		update public.meta_integrations as integration
		set crm_dataset_id = nullif($3, ''),
		    crm_dataset_name = case
		      when $4 = '' then crm_dataset_name
		      else $4
		    end,
		    crm_dataset_access_token = nullif($5, ''),
		    conversion_feedback_enabled = $6,
		    conversion_feedback_status = $7,
		    conversion_feedback_activated_at = case
		      when $6 and (
		        coalesce(integration.conversion_feedback_enabled, false) = false
		        or integration.crm_dataset_id is distinct from nullif($3, '')
		        or integration.conversion_feedback_activated_at is null
		      ) then clock_timestamp()
		      else integration.conversion_feedback_activated_at
		    end,
		    conversion_feedback_last_error = null,
		    updated_at = now()
		where integration.organization_id = $1::uuid
		  and integration.id = $2::uuid
		returning jsonb_strip_nulls(jsonb_build_object(
		  'id', integration.id::text,
		  'organization_id', integration.organization_id::text,
		  'page_id', integration.page_id,
		  'crm_dataset_id', integration.crm_dataset_id,
		  'crm_dataset_name', integration.crm_dataset_name,
		  'conversion_feedback_enabled', integration.conversion_feedback_enabled,
		  'conversion_feedback_status', integration.conversion_feedback_status,
		  'conversion_feedback_last_sent_at', integration.conversion_feedback_last_sent_at,
		  'conversion_feedback_last_validated_at', integration.conversion_feedback_last_validated_at,
		  'conversion_feedback_last_error', integration.conversion_feedback_last_error
		))
	`,
		tenantContext.OrganizationID,
		integrationID,
		datasetID,
		datasetName,
		datasetToken,
		request.Enabled,
		status,
	).Scan(&raw)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	if request.ReplayRecentFacts {
		// Replay is deliberately post-commit. Keeping it out of the integration
		// row lock avoids a lock-order cycle with workers, while the unique
		// funnel_event_id makes a repeated PUT safe after an ambiguous response.
		queued, err := repo.replayRecentMetaCRMFacts(
			ctx,
			tenantContext.OrganizationID,
			integrationID,
			testEventCode,
		)
		if err != nil {
			return nil, err
		}
		result["recent_facts_replay_requested"] = true
		result["recent_facts_queued"] = queued
	}
	return result, nil
}

// replayRecentMetaCRMFacts queues every real, contiguous funnel fact whose
// Meta acquisition entry is still inside the seven-day window. The SQL
// function rechecks the exact organization and integration and preserves the
// original fact timestamps; it never fabricates transitions for testing.
func (repo Repository) replayRecentMetaCRMFacts(
	ctx context.Context,
	organizationID string,
	integrationID string,
	testEventCode string,
) (int, error) {
	var queued int
	err := repo.db.Pool().QueryRow(ctx, `
		select private.enqueue_recent_meta_crm_facts(
		  $1::uuid,
		  $2::uuid,
		  nullif($3, '')
		)
	`, organizationID, integrationID, testEventCode).Scan(&queued)
	if err != nil {
		return 0, err
	}
	return queued, nil
}

func validIntegrationUUID(value string) (string, bool) {
	var id pgtype.UUID
	if err := id.Scan(strings.TrimSpace(value)); err != nil || !id.Valid {
		return "", false
	}
	return id.String(), true
}

func cleanMetaDatasetValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func isDecimalMetaDatasetID(value string) bool {
	if len(value) < 5 || len(value) > 30 {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func validMetaDatasetName(value string) bool {
	return len(value) <= 160 && !containsMetaControl(value)
}

func validMetaDatasetToken(value string) bool {
	return len(value) <= metaDatasetTokenMaximumBytes && !containsMetaControl(value)
}

func validMetaTestEventCode(value string) bool {
	return len(value) <= metaTestEventCodeMaximumBytes && !containsMetaControl(value)
}

func containsMetaControl(value string) bool {
	if !utf8.ValidString(value) {
		return true
	}
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			return true
		}
	}
	return false
}
