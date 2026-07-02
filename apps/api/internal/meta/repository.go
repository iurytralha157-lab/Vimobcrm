package meta

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db     *dbpkg.Postgres
	config Config
	client *http.Client
}

func NewRepository(db *dbpkg.Postgres, config Config) Repository {
	if strings.TrimSpace(config.GraphVersion) == "" {
		config.GraphVersion = "v25.0"
	}
	if strings.TrimSpace(config.GraphBaseURL) == "" {
		config.GraphBaseURL = "https://graph.facebook.com"
	}
	return Repository{
		db:     db,
		config: config,
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

func (repo Repository) InsertWebhookEvent(ctx context.Context, eventContext webhookEventContext, payload map[string]any, signatureValid bool) (string, error) {
	payloadJSON := jsonb(payload)

	var eventID string
	err := repo.db.Pool().QueryRow(ctx, `
		insert into public.meta_webhook_events (
			object,
			page_id,
			form_id,
			leadgen_id,
			raw_payload,
			signature_valid,
			status,
			received_at
		)
		values ($1, $2, $3, $4, $5::jsonb, $6, 'received', now())
		returning id::text
	`, nullableString(eventContext.Object), nullableString(eventContext.PageID), nullableString(eventContext.FormID), nullableString(eventContext.LeadgenID), payloadJSON, signatureValid).Scan(&eventID)
	if err == nil {
		return eventID, nil
	}
	if !isUndefinedColumn(err) {
		return "", err
	}

	err = repo.db.Pool().QueryRow(ctx, `
		insert into public.meta_webhook_events (
			object_type,
			event_type,
			provider_event_id,
			payload,
			created_at
		)
		values ($1, $2, $3, $4::jsonb, now())
		returning id::text
	`, nullableString(eventContext.Object), nullableString(eventContext.EventType), nullableString(eventContext.LeadgenID), payloadJSON).Scan(&eventID)
	return eventID, err
}

func (repo Repository) FinishWebhookEvent(ctx context.Context, eventID string, organizationID string, status string, errorMessage string) error {
	if strings.TrimSpace(eventID) == "" {
		return nil
	}

	_, err := repo.db.Pool().Exec(ctx, `
		update public.meta_webhook_events
		set organization_id = coalesce($2::uuid, organization_id),
		    status = $3,
		    error_message = $4,
		    last_error = $4,
		    processed_at = now(),
		    attempts = coalesce(attempts, 0) + 1
		where id = $1::uuid
	`, eventID, nullableString(organizationID), status, nullableString(errorMessage))
	if err == nil {
		return nil
	}
	if !isUndefinedColumn(err) {
		return err
	}

	_, err = repo.db.Pool().Exec(ctx, `
		update public.meta_webhook_events
		set organization_id = coalesce($2::uuid, organization_id),
		    error_message = $3,
		    processed_at = now()
		where id = $1::uuid
	`, eventID, nullableString(organizationID), nullableString(errorMessage))
	return err
}

func (repo Repository) ProcessWebhookPayload(ctx context.Context, eventID string, payload map[string]any) (WebhookResponse, error) {
	changes := extractLeadgenChanges(payload)
	if len(changes) == 0 {
		_ = repo.FinishWebhookEvent(ctx, eventID, "", "skipped", "No leadgen changes found")
		return WebhookResponse{
			OK:        true,
			EventID:   eventID,
			Processed: 0,
			Warnings:  []string{"no_leadgen_changes"},
		}, nil
	}

	results := make([]LeadgenResult, 0, len(changes))
	for _, change := range changes {
		results = append(results, repo.processLeadgenChange(ctx, payload, change))
	}

	status, organizationID, errorMessage, processed := aggregateResults(results)
	if err := repo.FinishWebhookEvent(ctx, eventID, organizationID, status, errorMessage); err != nil {
		return WebhookResponse{}, err
	}

	return WebhookResponse{
		OK:        true,
		EventID:   eventID,
		Processed: processed,
		Results:   results,
	}, nil
}

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

	integration, err := repo.findIntegrationByPage(ctx, change.PageID)
	if errors.Is(err, pgx.ErrNoRows) {
		result.Status = "skipped"
		result.Error = "connected Meta integration was not found for page"
		return result
	}
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.OrganizationID = integration.OrganizationID

	formConfig, err := repo.findFormConfig(ctx, integration, change.FormID)
	if errors.Is(err, pgx.ErrNoRows) {
		result.Status = "skipped"
		result.Error = "active Meta form config was not found"
		return result
	}
	if err != nil {
		result.Error = err.Error()
		return result
	}

	if duplicateLeadID, err := repo.findLeadByMetaLeadID(ctx, integration.OrganizationID, change.LeadgenID); err != nil {
		result.Error = err.Error()
		return result
	} else if duplicateLeadID != "" {
		result.Status = "duplicate"
		result.LeadID = duplicateLeadID
		return result
	}

	details, err := repo.leadDetails(ctx, change, integration)
	if err != nil {
		result.Error = err.Error()
		return result
	}

	lead := mapLeadData(details, change, integration, formConfig)
	if len([]rune(lead.Name)) < 2 {
		result.Error = "lead name is invalid"
		return result
	}

	leadID, reentry, err := repo.persistLead(ctx, webhookPayload, details, change, integration, formConfig, lead)
	if err != nil {
		result.Error = err.Error()
		return result
	}

	result.Status = "processed"
	result.LeadID = leadID
	result.Reentry = reentry
	result.Error = ""
	return result
}

func (repo Repository) findIntegrationByPage(ctx context.Context, pageID string) (metaIntegration, error) {
	var raw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		select to_jsonb(mi)
		from public.meta_integrations mi
		where mi.page_id = $1
		  and coalesce(mi.is_connected, true) = true
		order by mi.updated_at desc nulls last, mi.created_at desc nulls last
		limit 1
	`, pageID).Scan(&raw)
	if err != nil {
		return metaIntegration{}, err
	}

	var item map[string]any
	if err := json.Unmarshal(raw, &item); err != nil {
		return metaIntegration{}, err
	}

	accessToken := cleanAnyString(item["access_token"])
	if accessToken == nil {
		accessToken = plainSecret(cleanAnyString(item["access_token_secret_ref"]))
	}

	return metaIntegration{
		ID:             stringFromMap(item, "id"),
		OrganizationID: stringFromMap(item, "organization_id"),
		PageID:         cleanAnyString(item["page_id"]),
		PageName:       cleanAnyString(item["page_name"]),
		AccessToken:    accessToken,
		PipelineID:     uuidPointer(item["pipeline_id"]),
		StageID:        uuidPointer(item["stage_id"]),
		AssignedUserID: uuidPointer(item["assigned_user_id"]),
		DefaultStatus:  cleanAnyString(item["default_status"]),
		FieldMapping:   stringMap(item["field_mapping"]),
	}, nil
}

func (repo Repository) findFormConfig(ctx context.Context, integration metaIntegration, formID string) (metaFormConfig, error) {
	var raw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		select to_jsonb(mfc)
		from public.meta_form_configs mfc
		where mfc.organization_id = $1::uuid
		  and mfc.form_id = $2
		  and coalesce(mfc.is_active, true) = true
		  and (mfc.integration_id = $3::uuid or mfc.integration_id is null)
		order by (mfc.integration_id = $3::uuid) desc, mfc.updated_at desc nulls last, mfc.created_at desc nulls last
		limit 1
	`, integration.OrganizationID, formID, integration.ID).Scan(&raw)
	if err != nil {
		return metaFormConfig{}, err
	}

	var item map[string]any
	if err := json.Unmarshal(raw, &item); err != nil {
		return metaFormConfig{}, err
	}

	return metaFormConfig{
		ID:                 stringFromMap(item, "id"),
		OrganizationID:     stringFromMap(item, "organization_id"),
		IntegrationID:      stringFromMap(item, "integration_id"),
		PageID:             cleanAnyString(item["page_id"]),
		FormID:             stringFromMap(item, "form_id"),
		FormName:           cleanAnyString(item["form_name"]),
		PipelineID:         uuidPointer(item["pipeline_id"]),
		StageID:            uuidPointer(item["stage_id"]),
		DefaultStatus:      cleanAnyString(item["default_status"]),
		AssignedUserID:     uuidPointer(item["assigned_user_id"]),
		RoundRobinID:       uuidPointer(item["round_robin_id"]),
		PropertyID:         uuidPointer(item["property_id"]),
		Purpose:            cleanAnyString(item["purpose"]),
		Source:             cleanAnyString(item["source"]),
		SourceDetails:      cleanAnyString(item["source_details"]),
		DefaultValues:      objectMap(item["default_values"]),
		AutoTags:           stringSlice(item["auto_tags"]),
		FieldMapping:       stringMap(item["field_mapping"]),
		CustomFieldsConfig: stringSlice(item["custom_fields_config"]),
	}, nil
}

func (repo Repository) leadDetails(ctx context.Context, change leadgenChange, integration metaIntegration) (map[string]any, error) {
	if hasFieldData(change.Raw) {
		return cloneObject(change.Raw), nil
	}
	if integration.AccessToken == nil || strings.TrimSpace(*integration.AccessToken) == "" {
		return nil, errors.New("Meta page access token is missing")
	}

	endpoint, err := url.Parse(strings.TrimRight(repo.config.GraphBaseURL, "/") + "/" + strings.Trim(strings.TrimSpace(repo.config.GraphVersion), "/") + "/" + url.PathEscape(change.LeadgenID))
	if err != nil {
		return nil, err
	}

	query := endpoint.Query()
	query.Set("access_token", *integration.AccessToken)
	query.Set("fields", "id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform")
	endpoint.RawQuery = query.Encode()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}

	response, err := repo.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	var body map[string]any
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&body); err != nil {
		return nil, err
	}
	if response.StatusCode >= 400 {
		return nil, fmt.Errorf("Meta Graph returned HTTP %d: %s", response.StatusCode, metaGraphErrorMessage(body))
	}

	for key, value := range change.Raw {
		if _, exists := body[key]; !exists {
			body[key] = value
		}
	}
	return body, nil
}

func (repo Repository) persistLead(ctx context.Context, webhookPayload map[string]any, details map[string]any, change leadgenChange, integration metaIntegration, formConfig metaFormConfig, lead leadData) (string, bool, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return "", false, err
	}
	defer tx.Rollback(ctx)

	destination, err := repo.resolveDestination(ctx, tx, integration, formConfig)
	if err != nil {
		return "", false, err
	}

	propertyID := resolvePropertyID(formConfig)
	if err := repo.validateProperty(ctx, tx, integration.OrganizationID, propertyID); err != nil {
		return "", false, err
	}

	existingLeadID, err := repo.findExistingLeadByPhone(ctx, tx, integration.OrganizationID, lead.Phone)
	if err != nil {
		return "", false, err
	}

	source := coalesceText(formConfig.Source, "meta")
	sourceDetail := sourceDetail(integration, formConfig)
	interestValue := interestValue(formConfig.DefaultValues)
	status := coalesceText(formConfig.DefaultStatus, coalesceText(integration.DefaultStatus, "new"))
	metadata := buildLeadMetadata(webhookPayload, details, change, integration, formConfig, lead)
	metadata["source_detail"] = sourceDetail
	payloadJSON := jsonb(map[string]any{
		"webhook_payload": webhookPayload,
		"lead_details":    details,
		"fields":          lead.RawFields,
	})

	leadID := existingLeadID
	reentry := existingLeadID != ""
	if reentry {
		_, err = tx.Exec(ctx, `
			update public.leads
			set name = $3,
			    email = coalesce($4, email),
			    phone = coalesce($5, phone),
			    source = $6,
			    message = coalesce($7, message),
			    cargo = coalesce($8, cargo),
			    empresa = coalesce($9, empresa),
			    cidade = coalesce($10, cidade),
			    bairro = coalesce($11, bairro),
			    meta_lead_id = coalesce($12, meta_lead_id),
			    meta_form_id = coalesce($13, meta_form_id),
			    meta_campaign_id = coalesce($14, meta_campaign_id),
			    meta_adset_id = coalesce($15, meta_adset_id),
			    meta_ad_id = coalesce($16, meta_ad_id),
			    utm_source = coalesce($17, utm_source),
			    utm_medium = coalesce($18, utm_medium),
			    utm_campaign = coalesce($19, utm_campaign),
			    pipeline_id = coalesce($20::uuid, pipeline_id),
			    stage_entered_at = case
			      when $21::uuid is null or stage_id is not distinct from $21::uuid then stage_entered_at
			      else now()
			    end,
			    stage_id = coalesce($21::uuid, stage_id),
			    property_id = coalesce($22::uuid, property_id),
			    interest_property_id = coalesce($22::uuid, interest_property_id),
			    valor_interesse = coalesce($23::numeric, valor_interesse),
			    last_entry_at = now(),
			    reentry_count = coalesce(reentry_count, 0) + 1,
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
		`, integration.OrganizationID, leadID, lead.Name, nullablePointer(lead.Email), nullablePointer(lead.Phone), source, nullablePointer(lead.Message), nullablePointer(lead.Cargo), nullablePointer(lead.Empresa), nullablePointer(lead.Cidade), nullablePointer(lead.Bairro), change.LeadgenID, change.FormID, nullableString(metaText(details, change.Raw, "campaign_id")), nullableString(metaText(details, change.Raw, "adset_id")), nullableString(metaText(details, change.Raw, "ad_id")), "facebook", "lead_ads", nullableString(metaText(details, change.Raw, "campaign_name")), nullablePointer(destination.PipelineID), nullablePointer(destination.StageID), nullablePointer(propertyID), nullablePointer(interestValue))
	} else {
		err = tx.QueryRow(ctx, `
			insert into public.leads (
				organization_id,
				pipeline_id,
				stage_id,
				assigned_user_id,
				assigned_at,
				property_id,
				interest_property_id,
				name,
				email,
				phone,
				source,
				message,
				status,
				cargo,
				empresa,
				cidade,
				bairro,
				finalidade_compra,
				meta_lead_id,
				meta_form_id,
				meta_campaign_id,
				meta_adset_id,
				meta_ad_id,
				utm_source,
				utm_medium,
				utm_campaign,
				valor_interesse,
				stage_entered_at,
				last_entry_at
			)
			values (
				$1::uuid,
				$2::uuid,
				$3::uuid,
				$4::uuid,
				case when $4::uuid is null then null else now() end,
				$5::uuid,
				$5::uuid,
				$6,
				$7,
				$8,
				$9,
				$10,
				$11,
				$12,
				$13,
				$14,
				$15,
				$16,
				$17,
				$18,
				$19,
				$20,
				$21,
				'facebook',
				'lead_ads',
				$22,
				$23::numeric,
				case when $3::uuid is null then null else now() end,
				now()
			)
			returning id::text
		`, integration.OrganizationID, nullablePointer(destination.PipelineID), nullablePointer(destination.StageID), nullablePointer(destination.AssignedUserID), nullablePointer(propertyID), lead.Name, nullablePointer(lead.Email), nullablePointer(lead.Phone), source, nullablePointer(lead.Message), status, nullablePointer(lead.Cargo), nullablePointer(lead.Empresa), nullablePointer(lead.Cidade), nullablePointer(lead.Bairro), nullablePointer(formConfig.Purpose), change.LeadgenID, change.FormID, nullableString(metaText(details, change.Raw, "campaign_id")), nullableString(metaText(details, change.Raw, "adset_id")), nullableString(metaText(details, change.Raw, "ad_id")), nullableString(metaText(details, change.Raw, "campaign_name")), nullablePointer(interestValue)).Scan(&leadID)
	}
	if err != nil {
		return "", false, err
	}

	if err := repo.insertLeadMeta(ctx, tx, integration.OrganizationID, leadID, details, change, formConfig, payloadJSON); err != nil {
		return "", false, err
	}
	if err := repo.insertLeadTags(ctx, tx, integration.OrganizationID, leadID, tagIDs(formConfig)); err != nil {
		return "", false, err
	}
	if err := repo.insertLeadEntry(ctx, tx, integration.OrganizationID, leadID, details, change, propertyID, interestValue, metadata, reentry); err != nil {
		return "", false, err
	}
	if !reentry && destination.RoundRobinID != nil && destination.AssignedUserID != nil {
		if err := repo.insertRoundRobinLog(ctx, tx, integration.OrganizationID, leadID, destination, change); err != nil {
			return "", false, err
		}
	}
	if err := repo.insertActivity(ctx, tx, integration.OrganizationID, leadID, lead.Name, reentry, metadata); err != nil {
		return "", false, err
	}
	if err := repo.incrementStats(ctx, tx, integration.ID, formConfig.ID); err != nil {
		return "", false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", false, err
	}

	return leadID, reentry, nil
}

func (repo Repository) resolveDestination(ctx context.Context, tx pgx.Tx, integration metaIntegration, formConfig metaFormConfig) (resolvedDestination, error) {
	assignedUserID := firstUUID(formConfig.AssignedUserID, integration.AssignedUserID)
	destination := resolvedDestination{AssignedUserID: assignedUserID}

	if formConfig.StageID != nil {
		pipelineID, stageID, err := repo.resolveStage(ctx, tx, formConfig.OrganizationID, *formConfig.StageID)
		if err != nil {
			return resolvedDestination{}, err
		}
		if stageID != nil {
			destination.PipelineID = pipelineID
			destination.StageID = stageID
			return destination, nil
		}
	}

	if formConfig.RoundRobinID != nil {
		roundRobin, err := repo.resolveRoundRobin(ctx, tx, formConfig.OrganizationID, *formConfig.RoundRobinID)
		if err != nil {
			return resolvedDestination{}, err
		}
		destination.RoundRobinID = roundRobin.RoundRobinID
		destination.RoundRobinMemberID = roundRobin.RoundRobinMemberID
		if roundRobin.AssignedUserID != nil {
			destination.AssignedUserID = roundRobin.AssignedUserID
		}
		if roundRobin.PipelineID != nil || roundRobin.StageID != nil {
			destination.PipelineID = roundRobin.PipelineID
			destination.StageID = roundRobin.StageID
			return destination, nil
		}
	}

	if formConfig.PipelineID != nil {
		pipelineID, stageID, err := repo.resolvePipeline(ctx, tx, formConfig.OrganizationID, *formConfig.PipelineID)
		if err != nil {
			return resolvedDestination{}, err
		}
		if pipelineID != nil {
			destination.PipelineID = pipelineID
			destination.StageID = stageID
			return destination, nil
		}
	}

	if integration.StageID != nil {
		pipelineID, stageID, err := repo.resolveStage(ctx, tx, integration.OrganizationID, *integration.StageID)
		if err != nil {
			return resolvedDestination{}, err
		}
		if stageID != nil {
			destination.PipelineID = pipelineID
			destination.StageID = stageID
			return destination, nil
		}
	}

	if integration.PipelineID != nil {
		pipelineID, stageID, err := repo.resolvePipeline(ctx, tx, integration.OrganizationID, *integration.PipelineID)
		if err != nil {
			return resolvedDestination{}, err
		}
		if pipelineID != nil {
			destination.PipelineID = pipelineID
			destination.StageID = stageID
			return destination, nil
		}
	}

	pipelineID, stageID, err := repo.defaultDestination(ctx, tx, integration.OrganizationID)
	if err != nil {
		return resolvedDestination{}, err
	}
	destination.PipelineID = pipelineID
	destination.StageID = stageID
	return destination, nil
}

func (repo Repository) resolveRoundRobin(ctx context.Context, tx pgx.Tx, organizationID string, roundRobinID string) (resolvedDestination, error) {
	var raw []byte
	err := tx.QueryRow(ctx, `
		select to_jsonb(rr)
		from public.round_robins rr
		where rr.organization_id = $1::uuid
		  and rr.id = $2::uuid
		  and coalesce(rr.is_active, true) = true
		limit 1
	`, organizationID, roundRobinID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return resolvedDestination{}, nil
	}
	if err != nil {
		return resolvedDestination{}, err
	}

	var item map[string]any
	if err := json.Unmarshal(raw, &item); err != nil {
		return resolvedDestination{}, err
	}

	destination := resolvedDestination{
		RoundRobinID: uuidPointer(item["id"]),
		PipelineID:   firstUUID(uuidPointer(item["target_pipeline_id"]), uuidPointer(item["pipeline_id"])),
		StageID:      firstUUID(uuidPointer(item["target_stage_id"]), uuidPointer(objectMap(item["rules"])["target_stage_id"])),
	}
	if destination.StageID != nil {
		pipelineID, stageID, err := repo.resolveStage(ctx, tx, organizationID, *destination.StageID)
		if err != nil {
			return resolvedDestination{}, err
		}
		destination.PipelineID = pipelineID
		destination.StageID = stageID
	} else if destination.PipelineID != nil {
		pipelineID, stageID, err := repo.resolvePipeline(ctx, tx, organizationID, *destination.PipelineID)
		if err != nil {
			return resolvedDestination{}, err
		}
		destination.PipelineID = pipelineID
		destination.StageID = stageID
	}

	memberID, userID, err := repo.selectRoundRobinMember(ctx, tx, organizationID, roundRobinID)
	if err != nil {
		return resolvedDestination{}, err
	}
	destination.RoundRobinMemberID = memberID
	destination.AssignedUserID = userID
	return destination, nil
}

func (repo Repository) resolveStage(ctx context.Context, tx pgx.Tx, organizationID string, stageID string) (*string, *string, error) {
	var resolvedStageID string
	var pipelineID string
	err := tx.QueryRow(ctx, `
		select s.pipeline_id::text, s.id::text
		from public.stages s
		where s.organization_id = $1::uuid
		  and s.id = $2::uuid
		  and coalesce(s.is_active, true) = true
		limit 1
	`, organizationID, stageID).Scan(&pipelineID, &resolvedStageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	return &pipelineID, &resolvedStageID, nil
}

func (repo Repository) resolvePipeline(ctx context.Context, tx pgx.Tx, organizationID string, pipelineID string) (*string, *string, error) {
	var resolvedPipelineID string
	var stageID pgtype.Text
	err := tx.QueryRow(ctx, `
		select p.id::text, (
			select s.id::text
			from public.stages s
			where s.organization_id = p.organization_id
			  and s.pipeline_id = p.id
			  and coalesce(s.is_active, true) = true
			order by s.position asc nulls last, s.created_at asc
			limit 1
		)
		from public.pipelines p
		where p.organization_id = $1::uuid
		  and p.id = $2::uuid
		  and coalesce(p.is_active, true) = true
		limit 1
	`, organizationID, pipelineID).Scan(&resolvedPipelineID, &stageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	return &resolvedPipelineID, textPointer(stageID), nil
}

func (repo Repository) defaultDestination(ctx context.Context, tx pgx.Tx, organizationID string) (*string, *string, error) {
	var pipelineID pgtype.Text
	var stageID pgtype.Text
	err := tx.QueryRow(ctx, `
		select p.id::text, (
			select s.id::text
			from public.stages s
			where s.organization_id = p.organization_id
			  and s.pipeline_id = p.id
			  and coalesce(s.is_active, true) = true
			order by s.position asc nulls last, s.created_at asc
			limit 1
		)
		from public.pipelines p
		where p.organization_id = $1::uuid
		  and coalesce(p.is_active, true) = true
		order by coalesce(p.is_default, false) desc, p.position asc nulls last, p.created_at asc
		limit 1
	`, organizationID).Scan(&pipelineID, &stageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	return textPointer(pipelineID), textPointer(stageID), nil
}

func (repo Repository) selectRoundRobinMember(ctx context.Context, tx pgx.Tx, organizationID string, roundRobinID string) (*string, *string, error) {
	var memberID pgtype.Text
	var userID pgtype.Text
	err := tx.QueryRow(ctx, `
		select rrm.id::text, rrm.user_id::text
		from public.round_robin_members rrm
		join public.organization_members om
		  on om.organization_id = rrm.organization_id
		 and om.user_id = rrm.user_id
		 and coalesce(om.is_active, true) = true
		join public.users u
		  on u.id = rrm.user_id
		 and coalesce(u.is_active, true) = true
		left join lateral (
			select count(*)::bigint as total
			from public.round_robin_logs rrl
			where rrl.organization_id = rrm.organization_id
			  and rrl.round_robin_id = rrm.round_robin_id
			  and rrl.assigned_user_id = rrm.user_id
		) logs on true
		where rrm.organization_id = $1::uuid
		  and rrm.round_robin_id = $2::uuid
		  and coalesce(rrm.is_active, true) = true
		order by coalesce(logs.total, 0) asc, coalesce(rrm.position, 0) asc, rrm.created_at asc
		limit 1
	`, organizationID, roundRobinID).Scan(&memberID, &userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	return textPointer(memberID), textPointer(userID), nil
}

func (repo Repository) findLeadByMetaLeadID(ctx context.Context, organizationID string, leadgenID string) (string, error) {
	var leadID string
	err := repo.db.Pool().QueryRow(ctx, `
		select id::text
		from public.leads
		where organization_id = $1::uuid
		  and meta_lead_id = $2
		order by created_at desc
		limit 1
	`, organizationID, leadgenID).Scan(&leadID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return leadID, err
}

func (repo Repository) findExistingLeadByPhone(ctx context.Context, tx pgx.Tx, organizationID string, phone *string) (string, error) {
	normalizedPhone := digitsOnly(phone)
	if normalizedPhone == "" {
		return "", nil
	}

	var leadID string
	err := tx.QueryRow(ctx, `
		select id::text
		from public.leads
		where organization_id = $1::uuid
		  and regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = $2
		order by created_at desc
		limit 1
	`, organizationID, normalizedPhone).Scan(&leadID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return leadID, err
}

func (repo Repository) validateProperty(ctx context.Context, tx pgx.Tx, organizationID string, propertyID *string) error {
	if propertyID == nil {
		return nil
	}

	var exists bool
	err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.properties
			where organization_id = $1::uuid
			  and id = $2::uuid
		)
	`, organizationID, *propertyID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalidInput
	}
	return nil
}

func (repo Repository) insertLeadMeta(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, details map[string]any, change leadgenChange, formConfig metaFormConfig, payload string) error {
	tag, err := tx.Exec(ctx, `
		update public.lead_meta
		set platform = 'meta',
		    campaign_id = coalesce($3, campaign_id),
		    campaign_name = coalesce($4, campaign_name),
		    adset_id = coalesce($5, adset_id),
		    adset_name = coalesce($6, adset_name),
		    ad_id = coalesce($7, ad_id),
		    ad_name = coalesce($8, ad_name),
		    form_id = coalesce($9, form_id),
		    payload = $10::jsonb,
		    updated_at = now()
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
	`, organizationID, leadID, nullableString(metaText(details, change.Raw, "campaign_id")), nullableString(metaText(details, change.Raw, "campaign_name")), nullableString(metaText(details, change.Raw, "adset_id")), nullableString(metaText(details, change.Raw, "adset_name")), nullableString(metaText(details, change.Raw, "ad_id")), nullableString(metaText(details, change.Raw, "ad_name")), change.FormID, payload)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		return nil
	}

	_, err = tx.Exec(ctx, `
		insert into public.lead_meta (
			organization_id,
			lead_id,
			platform,
			campaign_id,
			campaign_name,
			adset_id,
			adset_name,
			ad_id,
			ad_name,
			form_id,
			payload
		)
		values ($1::uuid, $2::uuid, 'meta', $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
	`, organizationID, leadID, nullableString(metaText(details, change.Raw, "campaign_id")), nullableString(metaText(details, change.Raw, "campaign_name")), nullableString(metaText(details, change.Raw, "adset_id")), nullableString(metaText(details, change.Raw, "adset_name")), nullableString(metaText(details, change.Raw, "ad_id")), nullableString(metaText(details, change.Raw, "ad_name")), change.FormID, payload)
	return err
}

func (repo Repository) insertLeadTags(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, tagIDs []string) error {
	for _, tagID := range tagIDs {
		normalizedTagID, ok := normalizeUUID(tagID)
		if !ok {
			continue
		}
		if _, err := tx.Exec(ctx, `
			insert into public.lead_tags (organization_id, lead_id, tag_id)
			select $1::uuid, $2::uuid, $3::uuid
			where exists (
				select 1
				from public.tags
				where organization_id = $1::uuid
				  and id = $3::uuid
			)
			on conflict do nothing
		`, organizationID, leadID, normalizedTagID); err != nil {
			return err
		}
	}
	return nil
}

func (repo Repository) insertLeadEntry(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, details map[string]any, change leadgenChange, propertyID *string, interestValue *string, metadata map[string]any, reentry bool) error {
	jsonColumn, err := repo.leadEntryJSONColumn(ctx, tx)
	if err != nil {
		return err
	}
	entryType := "initial"
	if reentry {
		entryType = "reentry"
	}
	if !reentry {
		updateQuery := fmt.Sprintf(`
			update public.lead_entry_events
			set source = 'meta',
			    property_id = coalesce($3::uuid, property_id),
			    valor_interesse = coalesce($4::numeric, valor_interesse),
			    campaign_name = coalesce($5, campaign_name),
			    utm_source = 'facebook',
			    utm_medium = 'lead_ads',
			    utm_campaign = coalesce($6, utm_campaign),
			    %s = coalesce(%s, '{}'::jsonb) || $7::jsonb
			where organization_id = $1::uuid
			  and lead_id = $2::uuid
			  and entry_type = 'initial'
		`, jsonColumn, jsonColumn)
		tag, err := tx.Exec(ctx, updateQuery, organizationID, leadID, nullablePointer(propertyID), nullablePointer(interestValue), nullableString(metaText(details, change.Raw, "campaign_name")), nullableString(metaText(details, change.Raw, "campaign_name")), jsonb(metadata))
		if err != nil {
			return err
		}
		if tag.RowsAffected() > 0 {
			return nil
		}
	}

	query := fmt.Sprintf(`
		insert into public.lead_entry_events (
			organization_id,
			lead_id,
			source,
			entry_type,
			property_id,
			valor_interesse,
			campaign_name,
			utm_source,
			utm_medium,
			utm_campaign,
			%s
		)
		values (
			$1::uuid,
			$2::uuid,
			'meta',
			$3,
			$4::uuid,
			$5::numeric,
			$6,
			'facebook',
			'lead_ads',
			$7,
			$8::jsonb
		)
	`, jsonColumn)

	_, err = tx.Exec(ctx, query, organizationID, leadID, entryType, nullablePointer(propertyID), nullablePointer(interestValue), nullableString(metaText(details, change.Raw, "campaign_name")), nullableString(metaText(details, change.Raw, "campaign_name")), jsonb(metadata))
	return err
}

func (repo Repository) leadEntryJSONColumn(ctx context.Context, tx pgx.Tx) (string, error) {
	var column string
	err := tx.QueryRow(ctx, `
		select case
			when exists (
				select 1
				from information_schema.columns
				where table_schema = 'public'
				  and table_name = 'lead_entry_events'
				  and column_name = 'metadata'
			) then 'metadata'
			when exists (
				select 1
				from information_schema.columns
				where table_schema = 'public'
				  and table_name = 'lead_entry_events'
				  and column_name = 'payload'
			) then 'payload'
			else ''
		end
	`).Scan(&column)
	if err != nil {
		return "", err
	}
	if column != "metadata" && column != "payload" {
		return "", errors.New("lead_entry_events JSON column was not found")
	}
	return column, nil
}

func (repo Repository) insertRoundRobinLog(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, destination resolvedDestination, change leadgenChange) error {
	_, err := tx.Exec(ctx, `
		insert into public.round_robin_logs (
			organization_id,
			round_robin_id,
			lead_id,
			assigned_user_id,
			reason,
			metadata
		)
		values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'meta_lead_ads', $5::jsonb)
	`, organizationID, nullablePointer(destination.RoundRobinID), leadID, nullablePointer(destination.AssignedUserID), jsonb(map[string]any{
		"leadgen_id": change.LeadgenID,
		"form_id":    change.FormID,
		"page_id":    change.PageID,
		"member_id":  nullablePointer(destination.RoundRobinMemberID),
	}))
	if err != nil {
		return err
	}
	_, _ = tx.Exec(ctx, `
		update public.round_robins
		set current_position = coalesce(current_position, 0) + 1,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, organizationID, nullablePointer(destination.RoundRobinID))
	return nil
}

func (repo Repository) insertActivity(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, leadName string, reentry bool, metadata map[string]any) error {
	activityType := "lead_created"
	content := fmt.Sprintf(`Lead "%s" foi criado pela Meta`, leadName)
	if reentry {
		activityType = "lead_reentry"
		content = fmt.Sprintf(`Lead "%s" retornou pela Meta`, leadName)
	}

	_, err := tx.Exec(ctx, `
		insert into public.activities (
			organization_id,
			lead_id,
			user_id,
			type,
			content,
			metadata
		)
		values ($1::uuid, $2::uuid, null, $3, $4, $5::jsonb)
	`, organizationID, leadID, activityType, content, jsonb(metadata))
	return err
}

func (repo Repository) incrementStats(ctx context.Context, tx pgx.Tx, integrationID string, formConfigID string) error {
	if _, err := tx.Exec(ctx, `
		update public.meta_integrations
		set leads_received = coalesce(leads_received, 0) + 1,
		    last_lead_at = now(),
		    last_sync_at = now(),
		    health_status = 'ok',
		    last_error = null,
		    updated_at = now()
		where id = $1::uuid
	`, integrationID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		update public.meta_form_configs
		set leads_received = coalesce(leads_received, 0) + 1,
		    last_lead_at = now(),
		    updated_at = now()
		where id = $1::uuid
	`, formConfigID)
	return err
}

func extractWebhookEventContext(payload map[string]any) webhookEventContext {
	context := webhookEventContext{
		Object: textFromAny(payload["object"]),
	}
	for _, change := range extractLeadgenChanges(payload) {
		context.EventType = "leadgen"
		context.PageID = change.PageID
		context.FormID = change.FormID
		context.LeadgenID = change.LeadgenID
		return context
	}
	return context
}

func extractLeadgenChanges(payload map[string]any) []leadgenChange {
	entries, _ := payload["entry"].([]any)
	out := []leadgenChange{}
	for _, entryValue := range entries {
		entry, ok := entryValue.(map[string]any)
		if !ok {
			continue
		}
		entryID := textFromAny(entry["id"])
		changes, _ := entry["changes"].([]any)
		for _, changeValue := range changes {
			change, ok := changeValue.(map[string]any)
			if !ok || !strings.EqualFold(textFromAny(change["field"]), "leadgen") {
				continue
			}
			value, ok := change["value"].(map[string]any)
			if !ok {
				continue
			}
			item := leadgenChange{
				PageID:      firstNonEmpty(textFromAny(value["page_id"]), entryID),
				FormID:      firstNonEmpty(textFromAny(value["form_id"]), textFromAny(value["formID"])),
				LeadgenID:   firstNonEmpty(textFromAny(value["leadgen_id"]), textFromAny(value["lead_id"]), textFromAny(value["id"])),
				CreatedTime: textFromAny(value["created_time"]),
				Raw:         cloneObject(value),
			}
			out = append(out, item)
		}
	}
	return out
}

func mapLeadData(details map[string]any, change leadgenChange, integration metaIntegration, formConfig metaFormConfig) leadData {
	fields := extractFieldData(details)
	if len(fields) == 0 {
		fields = extractFieldData(change.Raw)
	}

	lead := leadData{
		Name:      "Lead Meta",
		Custom:    map[string]any{},
		RawFields: map[string]any{},
		Meta: map[string]any{
			"leadgen_id":    change.LeadgenID,
			"form_id":       change.FormID,
			"page_id":       change.PageID,
			"campaign_id":   metaText(details, change.Raw, "campaign_id"),
			"campaign_name": metaText(details, change.Raw, "campaign_name"),
			"adset_id":      metaText(details, change.Raw, "adset_id"),
			"adset_name":    metaText(details, change.Raw, "adset_name"),
			"ad_id":         metaText(details, change.Raw, "ad_id"),
			"ad_name":       metaText(details, change.Raw, "ad_name"),
		},
	}

	mapping := map[string]string{}
	for key, value := range integration.FieldMapping {
		mapping[strings.ToLower(strings.TrimSpace(key))] = strings.TrimSpace(value)
	}
	for key, value := range formConfig.FieldMapping {
		mapping[strings.ToLower(strings.TrimSpace(key))] = strings.TrimSpace(value)
	}

	customFields := map[string]struct{}{}
	for _, field := range formConfig.CustomFieldsConfig {
		customFields[strings.ToLower(strings.TrimSpace(field))] = struct{}{}
	}

	for _, field := range fields {
		if len(field.Values) == 0 {
			continue
		}
		value := strings.TrimSpace(field.Values[0])
		if value == "" {
			continue
		}
		key := strings.TrimSpace(field.Name)
		lowerKey := strings.ToLower(key)
		lead.RawFields[key] = field.Values

		target := strings.TrimSpace(mapping[lowerKey])
		if target == "" {
			target = guessLeadTarget(lowerKey)
		}
		if _, isCustom := customFields[lowerKey]; isCustom && target == "" {
			target = "custom"
		}

		switch target {
		case "_ignore":
			continue
		case "name":
			lead.Name = value
		case "email":
			lead.Email = &value
		case "phone":
			lead.Phone = &value
		case "message":
			lead.Message = &value
		case "cargo":
			lead.Cargo = &value
		case "empresa":
			lead.Empresa = &value
		case "cidade":
			lead.Cidade = &value
		case "bairro":
			lead.Bairro = &value
		case "custom":
			lead.Custom[key] = value
		default:
			if target == "" {
				lead.Custom[key] = value
			}
		}
	}

	if name := cleanAnyString(formConfig.DefaultValues["name"]); name != nil && lead.Name == "Lead Meta" {
		lead.Name = *name
	}
	return lead
}

func extractFieldData(payload map[string]any) []fieldData {
	raw := payload["field_data"]
	if raw == nil {
		if nested, ok := payload["lead_data"].(map[string]any); ok {
			raw = nested["field_data"]
		}
	}

	items, ok := raw.([]any)
	if !ok {
		return nil
	}

	out := []fieldData{}
	for _, itemValue := range items {
		item, ok := itemValue.(map[string]any)
		if !ok {
			continue
		}
		field := fieldData{Name: textFromAny(item["name"])}
		switch values := item["values"].(type) {
		case []any:
			for _, value := range values {
				if text := textFromAny(value); text != "" {
					field.Values = append(field.Values, text)
				}
			}
		case []string:
			field.Values = append(field.Values, values...)
		case string:
			if strings.TrimSpace(values) != "" {
				field.Values = append(field.Values, strings.TrimSpace(values))
			}
		}
		if len(field.Values) > 0 {
			out = append(out, field)
		}
	}
	return out
}

func aggregateResults(results []LeadgenResult) (string, string, string, int) {
	status := "skipped"
	organizationID := ""
	errorMessage := ""
	processed := 0
	for _, result := range results {
		if organizationID == "" {
			organizationID = result.OrganizationID
		}
		if result.Error != "" && errorMessage == "" {
			errorMessage = result.Error
		}
		switch result.Status {
		case "failed":
			status = "failed"
		case "processed":
			processed++
			if status != "failed" {
				status = "processed"
			}
		case "duplicate":
			if status != "failed" && status != "processed" {
				status = "duplicate"
			}
		}
	}
	return status, organizationID, errorMessage, processed
}

func buildLeadMetadata(webhookPayload map[string]any, details map[string]any, change leadgenChange, integration metaIntegration, formConfig metaFormConfig, lead leadData) map[string]any {
	return map[string]any{
		"source":          "meta",
		"source_type":     "meta_lead_ads",
		"integration_id":  integration.ID,
		"form_config_id":  formConfig.ID,
		"page_id":         change.PageID,
		"page_name":       nullablePointer(integration.PageName),
		"form_id":         change.FormID,
		"form_name":       nullablePointer(formConfig.FormName),
		"leadgen_id":      change.LeadgenID,
		"created_time":    change.CreatedTime,
		"campaign_id":     metaText(details, change.Raw, "campaign_id"),
		"campaign_name":   metaText(details, change.Raw, "campaign_name"),
		"adset_id":        metaText(details, change.Raw, "adset_id"),
		"adset_name":      metaText(details, change.Raw, "adset_name"),
		"ad_id":           metaText(details, change.Raw, "ad_id"),
		"ad_name":         metaText(details, change.Raw, "ad_name"),
		"field_data":      lead.RawFields,
		"custom_fields":   lead.Custom,
		"webhook_payload": webhookPayload,
	}
}

func sourceDetail(integration metaIntegration, formConfig metaFormConfig) string {
	for _, value := range []*string{
		formConfig.SourceDetails,
		formConfig.FormName,
		integration.PageName,
	} {
		if value != nil && strings.TrimSpace(*value) != "" {
			return strings.TrimSpace(*value)
		}
	}
	return "Meta Lead Ads"
}

func resolvePropertyID(formConfig metaFormConfig) *string {
	for _, value := range []*string{
		formConfig.PropertyID,
		uuidPointer(formConfig.DefaultValues["property_id"]),
		uuidPointer(formConfig.DefaultValues["interest_property_id"]),
	} {
		if value != nil {
			return value
		}
	}
	return nil
}

func interestValue(defaults map[string]any) *string {
	for _, key := range []string{"valor_interesse", "interest_value", "valor", "value"} {
		value := textFromAny(defaults[key])
		if value != "" {
			return &value
		}
	}
	return nil
}

func tagIDs(formConfig metaFormConfig) []string {
	ids := []string{}
	for _, tagID := range formConfig.AutoTags {
		if !slices.Contains(ids, tagID) {
			ids = append(ids, tagID)
		}
	}
	for _, tagID := range stringSlice(formConfig.DefaultValues["auto_tags"]) {
		if !slices.Contains(ids, tagID) {
			ids = append(ids, tagID)
		}
	}
	return ids
}

func metaText(primary map[string]any, fallback map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := textFromAny(primary[key]); value != "" {
			return value
		}
		if value := textFromAny(fallback[key]); value != "" {
			return value
		}
	}
	return ""
}

func hasFieldData(payload map[string]any) bool {
	if _, ok := payload["field_data"]; ok {
		return true
	}
	if nested, ok := payload["lead_data"].(map[string]any); ok {
		_, ok := nested["field_data"]
		return ok
	}
	return false
}

func guessLeadTarget(key string) string {
	switch {
	case strings.Contains(key, "nome") || strings.Contains(key, "name"):
		return "name"
	case strings.Contains(key, "email") || strings.Contains(key, "e-mail"):
		return "email"
	case strings.Contains(key, "phone") || strings.Contains(key, "fone") || strings.Contains(key, "telefone") || strings.Contains(key, "whatsapp"):
		return "phone"
	case strings.Contains(key, "mensagem") || strings.Contains(key, "message") || strings.Contains(key, "observ"):
		return "message"
	case strings.Contains(key, "cargo"):
		return "cargo"
	case strings.Contains(key, "empresa") || strings.Contains(key, "company"):
		return "empresa"
	case strings.Contains(key, "cidade") || strings.Contains(key, "city"):
		return "cidade"
	case strings.Contains(key, "bairro") || strings.Contains(key, "neighborhood"):
		return "bairro"
	default:
		return ""
	}
}

func metaGraphErrorMessage(body map[string]any) string {
	if errorObject, ok := body["error"].(map[string]any); ok {
		if message := textFromAny(errorObject["message"]); message != "" {
			return message
		}
	}
	return "unknown error"
}

func cloneObject(value map[string]any) map[string]any {
	out := map[string]any{}
	for key, item := range value {
		out[key] = item
	}
	return out
}

func objectMap(value any) map[string]any {
	switch typed := value.(type) {
	case nil:
		return map[string]any{}
	case map[string]any:
		return typed
	case string:
		var out map[string]any
		if err := json.Unmarshal([]byte(typed), &out); err == nil && out != nil {
			return out
		}
	case []byte:
		var out map[string]any
		if err := json.Unmarshal(typed, &out); err == nil && out != nil {
			return out
		}
	}
	return map[string]any{}
}

func stringMap(value any) map[string]string {
	out := map[string]string{}
	switch typed := value.(type) {
	case map[string]any:
		for key, item := range typed {
			if text := textFromAny(item); text != "" {
				out[key] = text
			}
		}
	case map[string]string:
		return typed
	case string:
		var parsed map[string]string
		if err := json.Unmarshal([]byte(typed), &parsed); err == nil && parsed != nil {
			return parsed
		}
	case []byte:
		var parsed map[string]string
		if err := json.Unmarshal(typed, &parsed); err == nil && parsed != nil {
			return parsed
		}
	}
	return out
}

func stringSlice(value any) []string {
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		out := []string{}
		for _, item := range typed {
			if text := textFromAny(item); text != "" {
				out = append(out, text)
			}
		}
		return out
	case string:
		var parsed []string
		if err := json.Unmarshal([]byte(typed), &parsed); err == nil && parsed != nil {
			return parsed
		}
	case []byte:
		var parsed []string
		if err := json.Unmarshal(typed, &parsed); err == nil && parsed != nil {
			return parsed
		}
	}
	return []string{}
}

func stringFromMap(item map[string]any, key string) string {
	return textFromAny(item[key])
}

func cleanAnyString(value any) *string {
	text := textFromAny(value)
	if text == "" {
		return nil
	}
	return &text
}

func textFromAny(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	case float64:
		if typed == float64(int64(typed)) {
			return fmt.Sprintf("%.0f", typed)
		}
		return strings.TrimSpace(fmt.Sprint(typed))
	case int:
		return fmt.Sprint(typed)
	case int64:
		return fmt.Sprint(typed)
	case bool:
		return fmt.Sprint(typed)
	default:
		return ""
	}
}

func uuidPointer(value any) *string {
	text := textFromAny(value)
	if text == "" {
		return nil
	}
	normalized, ok := normalizeUUID(text)
	if !ok {
		return nil
	}
	return &normalized
}

func plainSecret(value *string) *string {
	if value == nil {
		return nil
	}
	text := strings.TrimSpace(*value)
	text = strings.TrimPrefix(text, "plain:")
	if text == "" {
		return nil
	}
	return &text
}

func firstUUID(values ...*string) *string {
	for _, value := range values {
		if value == nil {
			continue
		}
		normalized, ok := normalizeUUID(*value)
		if ok {
			return &normalized
		}
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func coalesceText(value *string, fallback string) string {
	if value != nil && strings.TrimSpace(*value) != "" {
		return strings.TrimSpace(*value)
	}
	return fallback
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return strings.TrimSpace(value)
}

func nullablePointer(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return strings.TrimSpace(*value)
}

func textPointer(value pgtype.Text) *string {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return nil
	}
	text := strings.TrimSpace(value.String)
	return &text
}

func jsonb(value any) string {
	payload, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(payload)
}

func normalizeUUID(value string) (string, bool) {
	var uuid pgtype.UUID
	if err := uuid.Scan(strings.TrimSpace(value)); err != nil {
		return "", false
	}
	if !uuid.Valid {
		return "", false
	}
	return uuid.String(), true
}

func digitsOnly(value *string) string {
	if value == nil {
		return ""
	}
	var builder strings.Builder
	for _, char := range *value {
		if char >= '0' && char <= '9' {
			builder.WriteRune(char)
		}
	}
	return builder.String()
}

func isUndefinedColumn(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "42703"
	}
	return strings.Contains(err.Error(), "does not exist")
}
