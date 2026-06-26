package leads

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type ConversationLeadDetail struct {
	ID                 string                        `json:"id"`
	Name               string                        `json:"name"`
	Phone              *string                       `json:"phone"`
	Email              *string                       `json:"email"`
	Cidade             *string                       `json:"cidade"`
	UF                 *string                       `json:"uf"`
	Source             *string                       `json:"source"`
	CreatedAt          time.Time                     `json:"created_at"`
	ValorInteresse     *float64                      `json:"valor_interesse"`
	PropertyID         *string                       `json:"property_id"`
	InterestPropertyID *string                       `json:"interest_property_id"`
	StageID            *string                       `json:"stage_id"`
	PipelineID         *string                       `json:"pipeline_id"`
	DealStatus         string                        `json:"deal_status"`
	AssignedUserID     *string                       `json:"assigned_user_id"`
	CommissionPercent  *float64                      `json:"commission_percentage"`
	Stage              *ConversationLeadStage        `json:"stage"`
	Pipeline           *ConversationLeadPipeline     `json:"pipeline"`
	Tags               []ConversationLeadTagRelation `json:"tags"`
	Meta               *ConversationLeadMeta         `json:"meta"`
}

type ConversationLeadStage struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Color *string `json:"color"`
}

type ConversationLeadPipeline struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type ConversationLeadTagRelation struct {
	Tag ConversationLeadTag `json:"tag"`
}

type ConversationLeadTag struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type ConversationLeadMeta struct {
	AdName           *string `json:"ad_name"`
	CampaignName     *string `json:"campaign_name"`
	ContactNotes     *string `json:"contact_notes"`
	CreativeURL      *string `json:"creative_url"`
	CreativeVideoURL *string `json:"creative_video_url"`
	FormName         *string `json:"form_name"`
	UTMCampaign      *string `json:"utm_campaign"`
	UTMMedium        *string `json:"utm_medium"`
	UTMSource        *string `json:"utm_source"`
}

func (repo Repository) GetConversationDetail(ctx context.Context, tenantContext tenant.Context, leadID string) (ConversationLeadDetail, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return ConversationLeadDetail{}, ErrLeadNotFound
	}

	query := `
		select
			l.id::text,
			l.name,
			l.phone,
			l.email,
			l.cidade,
			l.uf,
			l.source,
			l.created_at,
			l.valor_interesse::double precision,
			l.property_id::text,
			l.interest_property_id::text,
			l.stage_id::text,
			l.pipeline_id::text,
			l.deal_status,
			l.assigned_user_id::text,
			l.commission_percentage::double precision,
			s.id::text,
			s.name,
			s.color,
			p.id::text,
			p.name,
			coalesce((
				select jsonb_agg(
					jsonb_build_object(
						'tag',
						jsonb_build_object(
							'id', t.id::text,
							'name', t.name,
							'color', coalesce(t.color, '#64748b')
						)
					)
					order by t.name
				)
				from public.lead_tags lt
				join public.tags t
				  on t.id = lt.tag_id
				 and t.organization_id = l.organization_id
				where lt.organization_id = l.organization_id
				  and lt.lead_id = l.id
			), '[]'::jsonb)::text,
			(
				select jsonb_strip_nulls(jsonb_build_object(
					'ad_name', lm.ad_name,
					'campaign_name', lm.campaign_name,
					'contact_notes', lm.contact_notes,
					'creative_url', lm.creative_url,
					'creative_video_url', lm.creative_video_url,
					'form_name', lm.form_name,
					'utm_campaign', lm.utm_campaign,
					'utm_medium', lm.utm_medium,
					'utm_source', lm.utm_source
				))
				from public.lead_meta lm
				where lm.organization_id = l.organization_id
				  and lm.lead_id = l.id
				limit 1
			)::text
		from public.leads l
		left join public.stages s on s.id = l.stage_id
		left join public.pipelines p on p.id = l.pipeline_id
		where l.organization_id = $1::uuid
		  and ` + leadVisibilitySQL("$2", "$3", "$4") + `
		  and l.id = $5::uuid
		limit 1`

	detail, err := scanConversationLeadDetail(repo.db.Pool().QueryRow(
		ctx,
		query,
		tenantContext.OrganizationID,
		canViewAllLeads(tenantContext),
		tenantContext.UserID,
		tenantContext.HasPermission("lead_view_team"),
		leadID,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return ConversationLeadDetail{}, ErrLeadNotFound
	}
	if err != nil {
		return ConversationLeadDetail{}, err
	}

	return detail, nil
}

func scanConversationLeadDetail(row scanner) (ConversationLeadDetail, error) {
	var detail ConversationLeadDetail
	var phone, email, cidade, uf, source pgtype.Text
	var valorInteresse, commissionPercentage pgtype.Float8
	var propertyID, interestPropertyID, stageID, pipelineID, assignedUserID pgtype.Text
	var stageRefID, stageName, stageColor, pipelineRefID, pipelineName pgtype.Text
	var tagsJSON, metaJSON pgtype.Text

	err := row.Scan(
		&detail.ID,
		&detail.Name,
		&phone,
		&email,
		&cidade,
		&uf,
		&source,
		&detail.CreatedAt,
		&valorInteresse,
		&propertyID,
		&interestPropertyID,
		&stageID,
		&pipelineID,
		&detail.DealStatus,
		&assignedUserID,
		&commissionPercentage,
		&stageRefID,
		&stageName,
		&stageColor,
		&pipelineRefID,
		&pipelineName,
		&tagsJSON,
		&metaJSON,
	)
	if err != nil {
		return ConversationLeadDetail{}, err
	}

	detail.Phone = textPtr(phone)
	detail.Email = textPtr(email)
	detail.Cidade = textPtr(cidade)
	detail.UF = textPtr(uf)
	detail.Source = textPtr(source)
	detail.PropertyID = textPtr(propertyID)
	detail.InterestPropertyID = textPtr(interestPropertyID)
	detail.StageID = textPtr(stageID)
	detail.PipelineID = textPtr(pipelineID)
	detail.AssignedUserID = textPtr(assignedUserID)
	if valorInteresse.Valid {
		detail.ValorInteresse = &valorInteresse.Float64
	}
	if commissionPercentage.Valid {
		detail.CommissionPercent = &commissionPercentage.Float64
	}
	if stageRefID.Valid {
		detail.Stage = &ConversationLeadStage{
			ID:    stageRefID.String,
			Name:  textValue(stageName),
			Color: textPtr(stageColor),
		}
	}
	if pipelineRefID.Valid {
		detail.Pipeline = &ConversationLeadPipeline{
			ID:   pipelineRefID.String,
			Name: textValue(pipelineName),
		}
	}
	if tagsJSON.Valid && tagsJSON.String != "" {
		if err := json.Unmarshal([]byte(tagsJSON.String), &detail.Tags); err != nil {
			return ConversationLeadDetail{}, err
		}
	}
	if detail.Tags == nil {
		detail.Tags = []ConversationLeadTagRelation{}
	}
	if metaJSON.Valid && metaJSON.String != "" {
		var meta ConversationLeadMeta
		if err := json.Unmarshal([]byte(metaJSON.String), &meta); err != nil {
			return ConversationLeadDetail{}, err
		}
		detail.Meta = &meta
	}

	return detail, nil
}
