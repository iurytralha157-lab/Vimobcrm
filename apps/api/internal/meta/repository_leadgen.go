package meta

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

func (repo Repository) processLeadgenChange(ctx context.Context, webhookPayload map[string]any, change leadgenChange) LeadgenResult {
	result := LeadgenResult{
		Status:    "failed",
		LeadgenID: change.LeadgenID,
		FormID:    change.FormID,
		PageID:    change.PageID,
	}
	if strings.TrimSpace(change.PageID) == "" || strings.TrimSpace(change.FormID) == "" || strings.TrimSpace(change.LeadgenID) == "" {
		result.Error = "leadgen payload is missing page_id, form_id or leadgen_id"
		return result
	}

	integration, formConfig, err := repo.findLeadgenRoute(ctx, change.PageID, change.FormID)
	if errors.Is(err, pgx.ErrNoRows) {
		result.Status = "skipped"
		result.Error = "active Meta form route was not found for page and form"
		return result
	}
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.OrganizationID = integration.OrganizationID

	leadMatch, err := repo.findLeadByMetaLeadID(ctx, integration.OrganizationID, change.LeadgenID)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	if leadMatch.LeadID != "" && !leadMatch.DetailsPending {
		result.Status = "duplicate"
		result.LeadID = leadMatch.LeadID
		return result
	}

	details, err := repo.leadDetails(ctx, change, integration)
	if err != nil {
		result.Error = err.Error()
		result.DetailsPending = true
		if leadMatch.LeadID != "" {
			result.Status = "duplicate"
			result.LeadID = leadMatch.LeadID
			return result
		}
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return result
		}

		// Keep the signed provider event durable and retryable, but never expose a
		// synthetic CRM contact while Meta has not returned the real field_data.
		result.Status = "skipped"
		return result
	}

	lead := mapLeadData(details, change, integration, formConfig)
	switch classifyMetaLeadIntake(details, change.Raw, lead) {
	case metaLeadIntakeIgnoreTest:
		result.Status = "skipped"
		result.Error = ""
		return result
	case metaLeadIntakeWaitForIdentity:
		result.Status = "skipped"
		result.DetailsPending = true
		result.Error = "Meta lead details are incomplete: a non-empty provider field mapped to name is required"
		return result
	}
	var pendingReentry *pendingMetaLeadReentry
	if leadMatch.LeadID != "" {
		pendingReentry, err = repo.prepareUntouchedPendingMetaLeadForReentry(
			ctx,
			integration,
			change.LeadgenID,
			leadMatch.LeadID,
			lead.Phone,
		)
		if err != nil {
			result.Error = err.Error()
			return result
		}
		if pendingReentry != nil {
			leadMatch = metaLeadMatch{}
		}
	}
	if leadMatch.LeadID != "" {
		if err := repo.enrichPendingMetaLead(ctx, webhookPayload, details, change, integration, formConfig, leadMatch.LeadID, lead); err != nil {
			result.Error = err.Error()
			return result
		}
		result.Status = "processed"
		result.LeadID = leadMatch.LeadID
		result.Error = ""
		return result
	}

	leadID, reentry, err := repo.persistLead(ctx, webhookPayload, details, change, integration, formConfig, lead, "", pendingReentry)
	if err != nil {
		var duplicateErr duplicateLeadgenError
		if errors.As(err, &duplicateErr) {
			result.Status = "duplicate"
			result.LeadID = duplicateErr.leadID
			result.Error = ""
			return result
		}
		result.Error = err.Error()
		return result
	}

	result.Status = "processed"
	result.LeadID = leadID
	result.Reentry = reentry
	result.Error = ""
	return result
}

// findLeadgenRouteQuery resolves a signed Lead Ads event by the provider
// identifiers that Meta actually sends: page_id + form_id. The Page alone is
// intentionally not an ownership key because agencies can connect the same
// Page to more than one CRM organization while assigning distinct forms.
//
// Candidate counting and credential loading happen in one database snapshot.
// The lateral branch decrypts a Page token only when exactly one active route
// exists, so an ambiguous provider payload never selects either tenant.
const findLeadgenRouteQuery = `
	with route_candidates as (
		select
		  integration.id as integration_id,
		  integration.organization_id,
		  form_config.id as form_config_id
		from public.meta_integrations as integration
		join public.meta_form_configs as form_config
		  on form_config.organization_id = integration.organization_id
		 and form_config.integration_id = integration.id
		where btrim(integration.page_id) = btrim($1)
		  and btrim(form_config.form_id) = btrim($2)
		  and coalesce(integration.is_connected, false) = true
		  and coalesce(form_config.is_active, true) = true
	), route_decision as (
		select count(*)::bigint as matching_routes
		from route_candidates
	)
	select
	  route_decision.matching_routes,
	  coalesce(route.integration, '{}'::jsonb),
	  coalesce(route.form_config, '{}'::jsonb)
	from route_decision
	left join lateral (
		select
		  to_jsonb(integration) || jsonb_build_object(
		    'access_token',
		    coalesce(nullif(integration.access_token, ''), secret.decrypted_secret)
		  ) as integration,
		  to_jsonb(form_config) as form_config
		from route_candidates as candidate
		join public.meta_integrations as integration
		  on integration.id = candidate.integration_id
		 and integration.organization_id = candidate.organization_id
		join public.meta_form_configs as form_config
		  on form_config.id = candidate.form_config_id
		 and form_config.organization_id = candidate.organization_id
		left join vault.decrypted_secrets as secret
		  on secret.id = integration.access_token_secret_ref
		where route_decision.matching_routes = 1
		limit 1
	) as route on true
	`

type leadgenRouteQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (repo Repository) findLeadgenRoute(ctx context.Context, pageID string, formID string) (metaIntegration, metaFormConfig, error) {
	return resolveLeadgenRoute(ctx, repo.db.Pool(), pageID, formID)
}

func resolveLeadgenRoute(ctx context.Context, queryer leadgenRouteQueryer, pageID string, formID string) (metaIntegration, metaFormConfig, error) {
	var (
		matchCount     int64
		integrationRaw []byte
		formConfigRaw  []byte
	)
	err := queryer.QueryRow(ctx, findLeadgenRouteQuery, pageID, formID).Scan(&matchCount, &integrationRaw, &formConfigRaw)
	if err != nil {
		return metaIntegration{}, metaFormConfig{}, err
	}
	if matchCount == 0 {
		return metaIntegration{}, metaFormConfig{}, pgx.ErrNoRows
	}
	if err := requireUniqueLeadgenRoute(pageID, formID, matchCount); err != nil {
		return metaIntegration{}, metaFormConfig{}, err
	}

	var integrationItem map[string]any
	if err := json.Unmarshal(integrationRaw, &integrationItem); err != nil {
		return metaIntegration{}, metaFormConfig{}, err
	}
	var formConfigItem map[string]any
	if err := json.Unmarshal(formConfigRaw, &formConfigItem); err != nil {
		return metaIntegration{}, metaFormConfig{}, err
	}

	integration := metaIntegration{
		ID:             stringFromMap(integrationItem, "id"),
		OrganizationID: stringFromMap(integrationItem, "organization_id"),
		PageID:         cleanAnyString(integrationItem["page_id"]),
		PageName:       cleanAnyString(integrationItem["page_name"]),
		AccessToken:    cleanAnyString(integrationItem["access_token"]),
		PipelineID:     uuidPointer(integrationItem["pipeline_id"]),
		StageID:        uuidPointer(integrationItem["stage_id"]),
		AssignedUserID: uuidPointer(integrationItem["assigned_user_id"]),
		DefaultStatus:  cleanAnyString(integrationItem["default_status"]),
		FieldMapping:   stringMap(integrationItem["field_mapping"]),
	}
	formConfig := metaFormConfig{
		ID:                 stringFromMap(formConfigItem, "id"),
		OrganizationID:     stringFromMap(formConfigItem, "organization_id"),
		IntegrationID:      stringFromMap(formConfigItem, "integration_id"),
		PageID:             cleanAnyString(formConfigItem["page_id"]),
		FormID:             stringFromMap(formConfigItem, "form_id"),
		FormName:           cleanAnyString(formConfigItem["form_name"]),
		PipelineID:         uuidPointer(formConfigItem["pipeline_id"]),
		StageID:            uuidPointer(formConfigItem["stage_id"]),
		DefaultStatus:      cleanAnyString(formConfigItem["default_status"]),
		AssignedUserID:     uuidPointer(formConfigItem["assigned_user_id"]),
		RoundRobinID:       uuidPointer(formConfigItem["round_robin_id"]),
		PropertyID:         uuidPointer(formConfigItem["property_id"]),
		Purpose:            cleanAnyString(formConfigItem["purpose"]),
		Source:             cleanAnyString(formConfigItem["source"]),
		SourceDetails:      cleanAnyString(formConfigItem["source_details"]),
		DefaultValues:      objectMap(formConfigItem["default_values"]),
		AutoTags:           stringSlice(formConfigItem["auto_tags"]),
		FieldMapping:       stringMap(formConfigItem["field_mapping"]),
		CustomFieldsConfig: stringSlice(formConfigItem["custom_fields_config"]),
	}
	if integration.ID == "" || integration.OrganizationID == "" || formConfig.ID == "" ||
		formConfig.OrganizationID != integration.OrganizationID || formConfig.IntegrationID != integration.ID {
		return metaIntegration{}, metaFormConfig{}, errors.New("resolved Meta leadgen route is incomplete")
	}
	return integration, formConfig, nil
}

func requireUniqueLeadgenRoute(pageID string, formID string, matchCount int64) error {
	if matchCount <= 1 {
		return nil
	}
	return fmt.Errorf(
		"%w: page_id %q and form_id %q match %d active routes",
		ErrAmbiguousLeadgenRoute,
		pageID,
		formID,
		matchCount,
	)
}
