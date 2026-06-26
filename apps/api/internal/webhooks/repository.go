package webhooks

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db *dbpkg.Postgres
}

func NewRepository(db *dbpkg.Postgres) Repository {
	return Repository{db: db}
}

func (repo Repository) List(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select jsonb_build_object(
			'id', w.id::text,
			'organization_id', w.organization_id::text,
			'name', w.name,
			'type', w.type,
			'api_token', w.api_token,
			'webhook_url', w.webhook_url,
			'target_pipeline_id', w.target_pipeline_id::text,
			'target_team_id', w.target_team_id::text,
			'target_stage_id', w.target_stage_id::text,
			'target_tag_ids', w.target_tag_ids,
			'target_property_id', w.target_property_id::text,
			'field_mapping', w.field_mapping,
			'is_active', w.is_active,
			'leads_received', w.leads_received,
			'last_lead_at', w.last_lead_at,
			'last_triggered_at', w.last_triggered_at,
			'trigger_events', w.trigger_events,
			'created_at', w.created_at,
			'updated_at', w.updated_at,
			'created_by', w.created_by::text,
			'pipeline', case when p.id is null then null else jsonb_build_object('id', p.id::text, 'name', p.name) end,
			'team', case when t.id is null then null else jsonb_build_object('id', t.id::text, 'name', t.name) end,
			'stage', case when s.id is null then null else jsonb_build_object('id', s.id::text, 'name', s.name, 'color', s.color) end,
			'property', case when pr.id is null then null else jsonb_build_object('id', pr.id::text, 'code', pr.code, 'title', pr.title) end,
			'creator', case when u.id is null then null else jsonb_build_object('id', u.id::text, 'name', u.name) end
		)
		from public.webhooks_integrations w
		left join public.pipelines p on p.id = w.target_pipeline_id
		left join public.teams t on t.id = w.target_team_id
		left join public.stages s on s.id = w.target_stage_id
		left join public.properties pr on pr.id = w.target_property_id
		left join public.users u on u.id = w.created_by
		where w.organization_id = $1::uuid
		order by w.created_at desc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []map[string]any{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var item map[string]any
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (repo Repository) Create(ctx context.Context, tenantContext tenant.Context, request WebhookRequest) (map[string]any, error) {
	name := cleanString(request.Name)
	webhookType := cleanString(request.Type)
	if name == nil || webhookType == nil {
		return nil, ErrInvalidInput
	}
	if *webhookType != "incoming" && *webhookType != "outgoing" {
		return nil, ErrInvalidInput
	}
	token, err := generateToken()
	if err != nil {
		return nil, err
	}
	fieldMapping, _ := json.Marshal(emptyMapIfNil(request.FieldMapping))
	targetTags := request.TargetTagIDs
	if targetTags == nil {
		targetTags = []string{}
	}
	triggerEvents := request.TriggerEvents
	if triggerEvents == nil {
		triggerEvents = []string{}
	}

	var id string
	err = repo.db.Pool().QueryRow(ctx, `
		insert into public.webhooks_integrations (
			organization_id, name, type, api_token, target_pipeline_id, target_team_id,
			target_stage_id, target_tag_ids, target_property_id, field_mapping,
			webhook_url, trigger_events, created_by
		)
		values ($1::uuid, $2, $3, $4, $5::uuid, $6::uuid, $7::uuid, $8, $9::uuid, $10::jsonb, $11, $12, $13::uuid)
		returning id::text
	`, tenantContext.OrganizationID, *name, *webhookType, token, cleanString(request.TargetPipelineID), cleanString(request.TargetTeamID), cleanString(request.TargetStageID), targetTags, cleanString(request.TargetPropertyID), string(fieldMapping), cleanString(request.WebhookURL), triggerEvents, tenantContext.UserID).Scan(&id)
	if err != nil {
		return nil, err
	}
	return repo.Get(ctx, tenantContext, id)
}

func (repo Repository) Get(ctx context.Context, tenantContext tenant.Context, id string) (map[string]any, error) {
	items, err := repo.List(ctx, tenantContext)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		if item["id"] == id {
			return item, nil
		}
	}
	return nil, ErrWebhookNotFound
}

func (repo Repository) Update(ctx context.Context, tenantContext tenant.Context, id string, request WebhookRequest) (map[string]any, error) {
	id, ok := normalizeUUID(id)
	if !ok {
		return nil, ErrInvalidInput
	}
	var fieldMappingValue *string
	if request.FieldMapping != nil {
		fieldMapping, _ := json.Marshal(request.FieldMapping)
		value := string(fieldMapping)
		fieldMappingValue = &value
	}
	_, err := repo.db.Pool().Exec(ctx, `
		update public.webhooks_integrations
		set
			name = coalesce($3, name),
			is_active = coalesce($4, is_active),
			target_pipeline_id = coalesce($5::uuid, target_pipeline_id),
			target_team_id = coalesce($6::uuid, target_team_id),
			target_stage_id = coalesce($7::uuid, target_stage_id),
			target_tag_ids = coalesce($8, target_tag_ids),
			target_property_id = coalesce($9::uuid, target_property_id),
			field_mapping = coalesce($10::jsonb, field_mapping),
			webhook_url = coalesce($11, webhook_url),
			trigger_events = coalesce($12, trigger_events),
			updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, id, cleanString(request.Name), request.IsActive, cleanString(request.TargetPipelineID), cleanString(request.TargetTeamID), cleanString(request.TargetStageID), request.TargetTagIDs, cleanString(request.TargetPropertyID), fieldMappingValue, cleanString(request.WebhookURL), request.TriggerEvents)
	if err != nil {
		return nil, err
	}
	return repo.Get(ctx, tenantContext, id)
}

func (repo Repository) Delete(ctx context.Context, tenantContext tenant.Context, id string) error {
	id, ok := normalizeUUID(id)
	if !ok {
		return ErrInvalidInput
	}
	tag, err := repo.db.Pool().Exec(ctx, `delete from public.webhooks_integrations where organization_id = $1::uuid and id = $2::uuid`, tenantContext.OrganizationID, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrWebhookNotFound
	}
	return nil
}

func (repo Repository) RegenerateToken(ctx context.Context, tenantContext tenant.Context, id string) (map[string]any, error) {
	id, ok := normalizeUUID(id)
	if !ok {
		return nil, ErrInvalidInput
	}
	token, err := generateToken()
	if err != nil {
		return nil, err
	}
	tag, err := repo.db.Pool().Exec(ctx, `
		update public.webhooks_integrations
		set api_token = $3,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, id, token)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrWebhookNotFound
	}
	return repo.Get(ctx, tenantContext, id)
}

func (repo Repository) ReceiveLead(ctx context.Context, token string, payload map[string]any) (IncomingLeadResult, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return IncomingLeadResult{}, ErrInvalidToken
	}

	webhook, err := repo.findIncomingWebhookByToken(ctx, token)
	if err != nil {
		return IncomingLeadResult{}, err
	}

	name := mappedPayloadString(webhook, payload, "name", "name", "nome", "full_name", "fullName")
	if name == nil || len([]rune(*name)) < 2 {
		return IncomingLeadResult{}, ErrInvalidInput
	}

	email := mappedPayloadString(webhook, payload, "email", "email")
	phone := mappedPayloadString(webhook, payload, "phone", "phone", "telefone", "whatsapp")
	message := mappedPayloadString(webhook, payload, "message", "message", "mensagem", "contact_notes", "notes")
	propertyCode := mappedPayloadString(webhook, payload, "property_code", "property_code", "propertyCode", "codigo_imovel")
	sourceDetail := mappedPayloadString(webhook, payload, "form_name", "form_name", "formName", "source_detail")
	if sourceDetail == nil {
		sourceDetail = &webhook.Name
	}
	propertyID := resolveWebhookPropertyID(webhook, payload)

	campaignID := payloadString(payload, "campaign_id", "campaignId")
	campaignName := payloadString(payload, "campaign_name", "campaignName")
	adsetID := payloadString(payload, "adset_id", "adsetId")
	adsetName := payloadString(payload, "adset_name", "adsetName")
	adID := payloadString(payload, "ad_id", "adId")
	adName := payloadString(payload, "ad_name", "adName")
	formID := payloadString(payload, "form_id", "formId")
	utmSource := payloadString(payload, "utm_source", "utmSource")
	utmMedium := payloadString(payload, "utm_medium", "utmMedium")
	utmCampaign := payloadString(payload, "utm_campaign", "utmCampaign")
	utmTerm := payloadString(payload, "utm_term", "utmTerm")
	utmContent := payloadString(payload, "utm_content", "utmContent")

	metadata := map[string]any{
		"source":       "generic_webhook",
		"webhook_id":   webhook.ID,
		"webhook_name": webhook.Name,
		"payload":      payload,
	}
	metadataJSON, _ := json.Marshal(metadata)
	payloadJSON, _ := json.Marshal(payload)

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return IncomingLeadResult{}, err
	}
	defer tx.Rollback(ctx)

	pipelineID, stageID, err := repo.resolveWebhookDestination(ctx, tx, webhook)
	if err != nil {
		return IncomingLeadResult{}, err
	}

	existingLeadID, err := repo.findExistingLeadByPhone(ctx, tx, webhook.OrganizationID, phone)
	if err != nil {
		return IncomingLeadResult{}, err
	}

	reentry := existingLeadID != ""
	leadID := existingLeadID
	if reentry {
		_, err = tx.Exec(ctx, `
			update public.leads
			set name = $3,
			    email = coalesce($4, email),
			    phone = coalesce($5, phone),
			    source = 'webhook',
			    source_detail = $6,
			    source_webhook_id = $7::uuid,
			    message = coalesce($8, message),
			    property_code = coalesce($9, property_code),
			    property_id = coalesce($10::uuid, property_id),
			    interest_property_id = coalesce($10::uuid, interest_property_id),
			    meta_campaign_id = coalesce($11, meta_campaign_id),
			    meta_adset_id = coalesce($12, meta_adset_id),
			    meta_ad_id = coalesce($13, meta_ad_id),
			    meta_form_id = coalesce($14, meta_form_id),
			    utm_source = coalesce($15, utm_source),
			    utm_medium = coalesce($16, utm_medium),
			    utm_campaign = coalesce($17, utm_campaign),
			    utm_term = coalesce($18, utm_term),
			    utm_content = coalesce($19, utm_content),
			    pipeline_id = coalesce($20::uuid, pipeline_id),
			    stage_id = coalesce($21::uuid, stage_id),
			    stage_entered_at = case
			      when $21::uuid is null or stage_id is not distinct from $21::uuid then stage_entered_at
			      else now()
			    end,
			    metadata = coalesce(metadata, '{}'::jsonb) || $22::jsonb,
			    last_entry_at = now(),
			    reentry_count = coalesce(reentry_count, 0) + 1,
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
		`, webhook.OrganizationID, leadID, *name, nullableString(email), nullableString(phone), nullableString(sourceDetail), webhook.ID, nullableString(message), nullableString(propertyCode), nullableString(propertyID), nullableString(campaignID), nullableString(adsetID), nullableString(adID), nullableString(formID), nullableString(utmSource), nullableString(utmMedium), nullableString(utmCampaign), nullableString(utmTerm), nullableString(utmContent), nullableString(pipelineID), nullableString(stageID), string(metadataJSON))
	} else {
		err = tx.QueryRow(ctx, `
			insert into public.leads (
				organization_id,
				pipeline_id,
				stage_id,
				property_id,
				interest_property_id,
				name,
				email,
				phone,
				source,
				source_detail,
				source_webhook_id,
				message,
				property_code,
				meta_campaign_id,
				meta_adset_id,
				meta_ad_id,
				meta_form_id,
				utm_source,
				utm_medium,
				utm_campaign,
				utm_term,
				utm_content,
				metadata,
				stage_entered_at,
				last_entry_at
			)
			values (
				$1::uuid,
				$2::uuid,
				$3::uuid,
				$4::uuid,
				$4::uuid,
				$5,
				$6,
				$7,
				'webhook',
				$8,
				$9::uuid,
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
				$21::jsonb,
				case when $3::uuid is null then null else now() end,
				now()
			)
			returning id::text
		`, webhook.OrganizationID, nullableString(pipelineID), nullableString(stageID), nullableString(propertyID), *name, nullableString(email), nullableString(phone), nullableString(sourceDetail), webhook.ID, nullableString(message), nullableString(propertyCode), nullableString(campaignID), nullableString(adsetID), nullableString(adID), nullableString(formID), nullableString(utmSource), nullableString(utmMedium), nullableString(utmCampaign), nullableString(utmTerm), nullableString(utmContent), string(metadataJSON)).Scan(&leadID)
	}
	if err != nil {
		return IncomingLeadResult{}, err
	}

	if err := repo.insertLeadMeta(ctx, tx, webhook.OrganizationID, leadID, campaignID, campaignName, adsetID, adsetName, adID, adName, formID, payloadJSON); err != nil {
		return IncomingLeadResult{}, err
	}
	if err := repo.insertLeadTags(ctx, tx, webhook.OrganizationID, leadID, webhook.TargetTagIDs); err != nil {
		return IncomingLeadResult{}, err
	}
	if err := repo.insertWebhookLeadEntry(ctx, tx, webhook, leadID, propertyID, payloadJSON); err != nil {
		return IncomingLeadResult{}, err
	}
	if err := repo.insertWebhookActivity(ctx, tx, webhook, leadID, *name, reentry, metadata); err != nil {
		return IncomingLeadResult{}, err
	}
	if err := repo.incrementWebhookStats(ctx, tx, webhook.ID); err != nil {
		return IncomingLeadResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return IncomingLeadResult{}, err
	}

	messageText := "Lead criado com sucesso"
	if reentry {
		messageText = "Reentrada registrada com sucesso"
	}
	return IncomingLeadResult{
		OK:             true,
		OrganizationID: webhook.OrganizationID,
		LeadID:         leadID,
		Reentry:        reentry,
		Message:        messageText,
	}, nil
}

func (repo Repository) findIncomingWebhookByToken(ctx context.Context, token string) (incomingWebhook, error) {
	var raw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		select jsonb_build_object(
			'id', w.id::text,
			'organization_id', w.organization_id::text,
			'name', w.name,
			'target_pipeline_id', w.target_pipeline_id::text,
			'target_stage_id', w.target_stage_id::text,
			'target_tag_ids', coalesce((
				select jsonb_agg(tag_id::text)
				from unnest(w.target_tag_ids) as tag_id
			), '[]'::jsonb),
			'target_property_id', w.target_property_id::text,
			'field_mapping', w.field_mapping
		)
		from public.webhooks_integrations w
		where w.api_token = $1
		  and w.type = 'incoming'
		  and w.is_active = true
		limit 1
	`, token).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return incomingWebhook{}, ErrInvalidToken
	}
	if err != nil {
		return incomingWebhook{}, err
	}

	var webhook incomingWebhook
	if err := json.Unmarshal(raw, &webhook); err != nil {
		return incomingWebhook{}, err
	}
	if webhook.FieldMapping == nil {
		webhook.FieldMapping = map[string]string{}
	}
	return webhook, nil
}

func (repo Repository) resolveWebhookDestination(ctx context.Context, tx pgx.Tx, webhook incomingWebhook) (*string, *string, error) {
	if webhook.TargetStageID != nil {
		var stageID string
		var pipelineID string
		err := tx.QueryRow(ctx, `
			select s.id::text, s.pipeline_id::text
			from public.stages s
			where s.organization_id = $1::uuid
			  and s.id = $2::uuid
			  and s.is_active = true
			limit 1
		`, webhook.OrganizationID, *webhook.TargetStageID).Scan(&stageID, &pipelineID)
		if err == nil {
			return &pipelineID, &stageID, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, err
		}
	}

	if webhook.TargetPipelineID != nil {
		var pipelineID string
		var stageID pgtype.Text
		err := tx.QueryRow(ctx, `
			select p.id::text, (
				select s.id::text
				from public.stages s
				where s.organization_id = p.organization_id
				  and s.pipeline_id = p.id
				  and s.is_active = true
				order by s.position asc, s.created_at asc
				limit 1
			)
			from public.pipelines p
			where p.organization_id = $1::uuid
			  and p.id = $2::uuid
			  and p.is_active = true
			limit 1
		`, webhook.OrganizationID, *webhook.TargetPipelineID).Scan(&pipelineID, &stageID)
		if err == nil {
			return &pipelineID, textPointer(stageID), nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, err
		}
	}

	var pipelineID pgtype.Text
	var stageID pgtype.Text
	err := tx.QueryRow(ctx, `
		select p.id::text, (
			select s.id::text
			from public.stages s
			where s.organization_id = p.organization_id
			  and s.pipeline_id = p.id
			  and s.is_active = true
			order by s.position asc, s.created_at asc
			limit 1
		)
		from public.pipelines p
		where p.organization_id = $1::uuid
		  and p.is_active = true
		order by p.is_default desc, p.position asc, p.created_at asc
		limit 1
	`, webhook.OrganizationID).Scan(&pipelineID, &stageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	return textPointer(pipelineID), textPointer(stageID), nil
}

func (repo Repository) findExistingLeadByPhone(ctx context.Context, tx pgx.Tx, organizationID string, phone *string) (string, error) {
	normalizedPhone := digitsOnly(nullableString(phone))
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

func (repo Repository) insertLeadMeta(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, campaignID *string, campaignName *string, adsetID *string, adsetName *string, adID *string, adName *string, formID *string, payload []byte) error {
	_, err := tx.Exec(ctx, `
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
		values ($1::uuid, $2::uuid, 'webhook', $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
		on conflict (lead_id) do update
		set platform = excluded.platform,
		    campaign_id = coalesce(excluded.campaign_id, public.lead_meta.campaign_id),
		    campaign_name = coalesce(excluded.campaign_name, public.lead_meta.campaign_name),
		    adset_id = coalesce(excluded.adset_id, public.lead_meta.adset_id),
		    adset_name = coalesce(excluded.adset_name, public.lead_meta.adset_name),
		    ad_id = coalesce(excluded.ad_id, public.lead_meta.ad_id),
		    ad_name = coalesce(excluded.ad_name, public.lead_meta.ad_name),
		    form_id = coalesce(excluded.form_id, public.lead_meta.form_id),
		    payload = excluded.payload,
		    updated_at = now()
	`, organizationID, leadID, nullableString(campaignID), nullableString(campaignName), nullableString(adsetID), nullableString(adsetName), nullableString(adID), nullableString(adName), nullableString(formID), string(payload))
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

func (repo Repository) insertWebhookLeadEntry(ctx context.Context, tx pgx.Tx, webhook incomingWebhook, leadID string, propertyID *string, payload []byte) error {
	_, err := tx.Exec(ctx, `
		insert into public.lead_entry_events (
			organization_id,
			lead_id,
			source,
			entry_type,
			property_id,
			payload
		)
		values ($1::uuid, $2::uuid, 'webhook', 'webhook', $3::uuid, $4::jsonb)
	`, webhook.OrganizationID, leadID, nullableString(propertyID), string(payload))
	return err
}

func (repo Repository) insertWebhookActivity(ctx context.Context, tx pgx.Tx, webhook incomingWebhook, leadID string, leadName string, reentry bool, metadata map[string]any) error {
	activityType := "lead_created"
	content := fmt.Sprintf(`Lead "%s" foi criado por webhook`, leadName)
	if reentry {
		activityType = "lead_reentry"
		content = fmt.Sprintf(`Lead "%s" retornou por webhook`, leadName)
	}
	metadataJSON, _ := json.Marshal(metadata)
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
	`, webhook.OrganizationID, leadID, activityType, content, string(metadataJSON))
	return err
}

func (repo Repository) incrementWebhookStats(ctx context.Context, tx pgx.Tx, webhookID string) error {
	_, err := tx.Exec(ctx, `
		update public.webhooks_integrations
		set leads_received = coalesce(leads_received, 0) + 1,
		    last_lead_at = now(),
		    last_triggered_at = now(),
		    updated_at = now()
		where id = $1::uuid
	`, webhookID)
	return err
}

func generateToken() (string, error) {
	var bytes [32]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes[:]), nil
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

func cleanString(value *string) *string {
	if value == nil {
		return nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil
	}
	return &cleaned
}

func emptyMapIfNil(value map[string]string) map[string]string {
	if value == nil {
		return map[string]string{}
	}
	return value
}

func mappedPayloadString(webhook incomingWebhook, payload map[string]any, target string, keys ...string) *string {
	if sourceKey := strings.TrimSpace(webhook.FieldMapping[target]); sourceKey != "" {
		if value := payloadText(payload[sourceKey]); value != nil {
			return value
		}
	}
	return payloadString(payload, keys...)
}

func payloadString(payload map[string]any, keys ...string) *string {
	for _, key := range keys {
		if value := payloadText(payload[key]); value != nil {
			return value
		}
	}
	return nil
}

func payloadText(value any) *string {
	switch typed := value.(type) {
	case nil:
		return nil
	case string:
		cleaned := strings.TrimSpace(typed)
		if cleaned == "" {
			return nil
		}
		return &cleaned
	case float64:
		cleaned := strings.TrimSpace(fmt.Sprint(typed))
		return &cleaned
	case bool:
		cleaned := fmt.Sprint(typed)
		return &cleaned
	default:
		return nil
	}
}

func resolveWebhookPropertyID(webhook incomingWebhook, payload map[string]any) *string {
	fieldMappingPropertyID := cleanString(valuePointer(webhook.FieldMapping["interest_property_id"]))
	for _, candidate := range []*string{
		payloadString(payload, "property_id", "propertyId", "interest_property_id", "interestPropertyId"),
		webhook.TargetPropertyID,
		fieldMappingPropertyID,
	} {
		if candidate == nil {
			continue
		}
		if value, ok := normalizeUUID(*candidate); ok {
			return &value
		}
	}
	return nil
}

func valuePointer(value string) *string {
	return &value
}

func nullableString(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func textPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func digitsOnly(value any) string {
	raw, ok := value.(string)
	if !ok {
		return ""
	}
	var builder strings.Builder
	for _, char := range raw {
		if char >= '0' && char <= '9' {
			builder.WriteRune(char)
		}
	}
	return builder.String()
}
