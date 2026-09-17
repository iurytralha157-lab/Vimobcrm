package leads

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/searchtext"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type ContactTag struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type Contact struct {
	ID                     string       `json:"id"`
	Name                   string       `json:"name"`
	Phone                  *string      `json:"phone"`
	Email                  *string      `json:"email"`
	WhatsApp               *string      `json:"whatsapp"`
	WhatsAppAvatarURL      *string      `json:"whatsapp_avatar_url"`
	PipelineID             *string      `json:"pipeline_id"`
	PipelineName           *string      `json:"pipeline_name"`
	StageID                *string      `json:"stage_id"`
	StageName              *string      `json:"stage_name"`
	StageColor             *string      `json:"stage_color"`
	AssignedUserID         *string      `json:"assigned_user_id"`
	AssigneeName           *string      `json:"assignee_name"`
	AssigneeAvatar         *string      `json:"assignee_avatar"`
	Source                 string       `json:"source"`
	SourceDetail           *string      `json:"source_detail"`
	SourceSessionID        *string      `json:"source_session_id"`
	SourceWebhookID        *string      `json:"source_webhook_id"`
	VisitorSessionID       *string      `json:"visitor_session_id"`
	Status                 string       `json:"status"`
	Priority               *string      `json:"priority"`
	Message                *string      `json:"message"`
	InitialMessage         *string      `json:"initial_message"`
	PropertyCode           *string      `json:"property_code"`
	PropertyID             *string      `json:"property_id"`
	InterestPropertyID     *string      `json:"interest_property_id"`
	InterestPlanID         *string      `json:"interest_plan_id"`
	CreatedAt              time.Time    `json:"created_at"`
	UpdatedAt              time.Time    `json:"updated_at"`
	SLAStatus              *string      `json:"sla_status"`
	LastInteractionAt      *time.Time   `json:"last_interaction_at"`
	LastInteractionPreview *string      `json:"last_interaction_preview"`
	LastInteractionChannel *string      `json:"last_interaction_channel"`
	Tags                   []ContactTag `json:"tags"`
	TotalCount             int64        `json:"total_count"`
	DealStatus             *string      `json:"deal_status"`
	LostReason             *string      `json:"lost_reason"`
	Feedback               *string      `json:"feedback"`
	InterestValue          *string      `json:"valor_interesse"`
	CommissionPercentage   *string      `json:"commission_percentage"`
	PriceRange             *string      `json:"faixa_valor_imovel"`
	FamilyIncome           *string      `json:"renda_familiar"`
	PurchasePurpose        *string      `json:"finalidade_compra"`
	SeekingFinancing       *bool        `json:"procura_financiamento"`
	Works                  *bool        `json:"trabalha"`
	Role                   *string      `json:"cargo"`
	Company                *string      `json:"empresa"`
	Profession             *string      `json:"profissao"`
	PostalCode             *string      `json:"cep"`
	Address                *string      `json:"endereco"`
	AddressNumber          *string      `json:"numero"`
	AddressComplement      *string      `json:"complemento"`
	Neighborhood           *string      `json:"bairro"`
	City                   *string      `json:"cidade"`
	State                  *string      `json:"uf"`
	IsOwnResource          *bool        `json:"is_own_resource"`
	FirstTouchAt           *time.Time   `json:"first_touch_at"`
	FirstTouchSeconds      *int32       `json:"first_touch_seconds"`
	FirstTouchChannel      *string      `json:"first_touch_channel"`
	FirstTouchActorUserID  *string      `json:"first_touch_actor_user_id"`
	FirstResponseAt        *time.Time   `json:"first_response_at"`
	FirstResponseSeconds   *int32       `json:"first_response_seconds"`
	FirstResponseChannel   *string      `json:"first_response_channel"`
	FirstResponseAuto      *bool        `json:"first_response_is_automation"`
	FirstResponseActorID   *string      `json:"first_response_actor_user_id"`
	StageEnteredAt         *time.Time   `json:"stage_entered_at"`
	LastEntryAt            *time.Time   `json:"last_entry_at"`
	ReentryCount           int          `json:"reentry_count"`
	RedistributionCount    int          `json:"redistribution_count"`
	LastContactAt          *time.Time   `json:"last_contact_at"`
	NextFollowUpAt         *time.Time   `json:"next_follow_up_at"`
	WonAt                  *time.Time   `json:"won_at"`
	LostAt                 *time.Time   `json:"lost_at"`
	CreatedBy              *string      `json:"created_by"`
	MetadataJSON           *string      `json:"metadata_json"`
	MetaLeadID             *string      `json:"meta_lead_id"`
	MetaFormID             *string      `json:"meta_form_id"`
	MetaCampaignID         *string      `json:"meta_campaign_id"`
	MetaAdsetID            *string      `json:"meta_adset_id"`
	MetaAdID               *string      `json:"meta_ad_id"`
	MetaClickID            *string      `json:"meta_click_id"`
	CampaignID             *string      `json:"campaign_id"`
	CampaignName           *string      `json:"campaign_name"`
	AdsetID                *string      `json:"adset_id"`
	AdsetName              *string      `json:"adset_name"`
	AdID                   *string      `json:"ad_id"`
	AdName                 *string      `json:"ad_name"`
	FormID                 *string      `json:"form_id"`
	FormName               *string      `json:"form_name"`
	Platform               *string      `json:"platform"`
	UTMSource              *string      `json:"utm_source"`
	UTMMedium              *string      `json:"utm_medium"`
	UTMCampaign            *string      `json:"utm_campaign"`
	UTMContent             *string      `json:"utm_content"`
	UTMTerm                *string      `json:"utm_term"`
	CreativeURL            *string      `json:"creative_url"`
	CreativeVideoURL       *string      `json:"creative_video_url"`
	CreativeInstagramURL   *string      `json:"creative_instagram_url"`
	MetaPayloadJSON        *string      `json:"meta_payload_json"`
	MetaRawPayloadJSON     *string      `json:"meta_raw_payload_json"`
}

type ContactListFilter struct {
	Search      string
	TeamID      string
	PipelineID  string
	StageID     string
	AssigneeID  string
	Unassigned  bool
	TagID       string
	TagIDs      []string
	Source      string
	CampaignID  string
	AdSetID     string
	AdID        string
	DealStatus  string
	CreatedFrom string
	CreatedTo   string
	SortBy      string
	SortDir     string
	Page        int
	Limit       int
	Mode        string
}

type LeadVisibility struct {
	CanViewAll    bool     `json:"canViewAll"`
	TeamMemberIDs []string `json:"teamMemberIds,omitempty"`
	UserID        string   `json:"userId,omitempty"`
}

func ParseContactListFilter(values url.Values) (ContactListFilter, error) {
	limit, err := parseBoundedInt(values.Get("limit"), 25, 1, 500)
	if err != nil {
		return ContactListFilter{}, err
	}

	page, err := parseBoundedInt(values.Get("page"), 1, 1, 10_000)
	if err != nil {
		return ContactListFilter{}, err
	}
	tagID, tagIDs, err := normalizeLeadTagFilterIDs(
		cleanContactFilterValue(values.Get("tagId")),
		splitLeadTagFilterValues(values["tagIds"]),
	)
	if err != nil {
		return ContactListFilter{}, err
	}

	filter := ContactListFilter{
		Search:      trimMax(cleanContactFilterValue(values.Get("search")), 100),
		TeamID:      cleanContactFilterValue(values.Get("teamId")),
		PipelineID:  cleanContactFilterValue(values.Get("pipelineId")),
		StageID:     cleanContactFilterValue(values.Get("stageId")),
		AssigneeID:  cleanContactFilterValue(values.Get("assigneeId")),
		Unassigned:  strings.EqualFold(values.Get("unassigned"), "true"),
		TagID:       tagID,
		TagIDs:      tagIDs,
		Source:      trimMax(cleanContactFilterValue(values.Get("source")), 80),
		CampaignID:  trimMax(cleanContactFilterValue(values.Get("campaignId")), 120),
		AdSetID:     trimMax(cleanContactFilterValue(values.Get("adSetId")), 120),
		AdID:        trimMax(cleanContactFilterValue(values.Get("adId")), 120),
		DealStatus:  cleanContactFilterValue(values.Get("dealStatus")),
		CreatedFrom: cleanContactFilterValue(values.Get("createdFrom")),
		CreatedTo:   cleanContactFilterValue(values.Get("createdTo")),
		SortBy:      cleanContactFilterValue(values.Get("sortBy")),
		SortDir:     cleanContactFilterValue(values.Get("sortDir")),
		Page:        page,
		Limit:       limit,
		Mode:        strings.ToLower(cleanContactFilterValue(values.Get("mode"))),
	}

	for _, item := range []struct {
		name  string
		value string
	}{
		{name: "teamId", value: filter.TeamID},
		{name: "pipelineId", value: filter.PipelineID},
		{name: "stageId", value: filter.StageID},
		{name: "assigneeId", value: filter.AssigneeID},
	} {
		if item.value != "" && !isUUID(item.value) {
			return ContactListFilter{}, fmt.Errorf("%w: %s is invalid", ErrInvalidInput, item.name)
		}
	}

	if filter.DealStatus != "" && !validEnum(filter.DealStatus, "open", "won", "lost") {
		return ContactListFilter{}, fmt.Errorf("%w: dealStatus is invalid", ErrInvalidInput)
	}
	if filter.SortBy == "" {
		filter.SortBy = "created_at"
	}
	if !validEnum(filter.SortBy, "created_at", "name", "last_interaction_at", "stage") {
		return ContactListFilter{}, fmt.Errorf("%w: sortBy is invalid", ErrInvalidInput)
	}
	if filter.SortDir == "" {
		filter.SortDir = "desc"
	}
	if !validEnum(filter.SortDir, "asc", "desc") {
		return ContactListFilter{}, fmt.Errorf("%w: sortDir is invalid", ErrInvalidInput)
	}
	if filter.Mode == "" {
		filter.Mode = "compact"
	}
	if filter.Mode == "export" {
		filter.Mode = "full"
	}
	if !validEnum(filter.Mode, "compact", "full") {
		return ContactListFilter{}, fmt.Errorf("%w: mode is invalid", ErrInvalidInput)
	}

	return filter, nil
}

func cleanContactFilterValue(value string) string {
	value = strings.TrimSpace(value)
	switch strings.ToLower(value) {
	case "", "all", "__all__", "none", "__none__", "null", "undefined":
		return ""
	default:
		return value
	}
}

func (repo Repository) ListContacts(ctx context.Context, tenantContext tenant.Context, filter ContactListFilter) ([]Contact, error) {
	if filter.Mode == "compact" {
		return repo.listContactsCompact(ctx, tenantContext, filter)
	}
	return repo.listContactsFull(ctx, tenantContext, filter)
}

func (repo Repository) countContacts(ctx context.Context, tenantContext tenant.Context, filter ContactListFilter) (int64, error) {
	where, args, err := buildContactWhere(tenantContext, filter)
	if err != nil {
		return 0, err
	}

	var total int64
	err = repo.db.Pool().QueryRow(ctx, `
		select count(*)::bigint
		from public.leads l
		where `+strings.Join(where, " and "),
		args...,
	).Scan(&total)
	if err != nil {
		return 0, err
	}
	return total, nil
}

func (repo Repository) listContactsFull(ctx context.Context, tenantContext tenant.Context, filter ContactListFilter) ([]Contact, error) {
	where, args, err := buildContactWhere(tenantContext, filter)
	if err != nil {
		return nil, err
	}
	countResult := make(chan struct {
		total int64
		err   error
	}, 1)
	go func() {
		total, countErr := repo.countContacts(ctx, tenantContext, filter)
		countResult <- struct {
			total int64
			err   error
		}{total: total, err: countErr}
	}()

	offset := (filter.Page - 1) * filter.Limit
	args = append(args, filter.Limit, offset)
	limitIndex := len(args) - 1
	offsetIndex := len(args)

	rows, err := repo.db.Pool().Query(ctx, `
		select
			0::bigint as total_count,
			l.id::text,
			l.name,
			l.phone,
			l.email,
			coalesce(to_jsonb(l)->>'whatsapp', l.phone),
			l.whatsapp_avatar_url,
			l.pipeline_id::text,
			p.name,
			l.stage_id::text,
			s.name,
			s.color,
			l.assigned_user_id::text,
			u.name,
			u.avatar_url,
			l.source,
			to_jsonb(l)->>'source_detail',
			l.source_session_id,
			l.source_webhook_id::text,
			l.visitor_session_id,
			l.status,
			l.priority,
			l.message,
			l.initial_message,
			l.property_code,
			l.property_id::text,
			l.interest_property_id::text,
			l.interest_plan_id::text,
			l.created_at,
			l.updated_at,
			null::text as sla_status,
			l.last_entry_at,
			null::text as last_interaction_preview,
			null::text as last_interaction_channel,
			coalesce(tags.tags, '[]'::json)::text,
			l.deal_status,
			l.lost_reason,
			l.feedback,
			l.valor_interesse::text,
			l.commission_percentage::text,
			l.faixa_valor_imovel,
			l.renda_familiar,
			l.finalidade_compra,
			l.procura_financiamento,
			l.trabalha,
			l.cargo,
			l.empresa,
			l.profissao,
			l.cep,
			l.endereco,
			l.numero,
			l.complemento,
			l.bairro,
			l.cidade,
			l.uf,
			l.is_own_resource,
			l.first_touch_at,
			l.first_touch_seconds,
			l.first_touch_channel,
			l.first_touch_actor_user_id::text,
			l.first_response_at,
			l.first_response_seconds,
			l.first_response_channel,
			l.first_response_is_automation,
			l.first_response_actor_user_id::text,
			l.stage_entered_at,
			l.last_entry_at,
			l.reentry_count,
			l.redistribution_count,
			l.last_contact_at,
			l.next_follow_up_at,
			l.won_at,
			l.lost_at,
			l.created_by::text,
			coalesce(to_jsonb(l)->'metadata', '{}'::jsonb)::text,
			l.meta_lead_id,
			l.meta_form_id,
			l.meta_campaign_id,
			l.meta_adset_id,
			l.meta_ad_id,
			l.meta_click_id,
			coalesce(lm.campaign_id, l.meta_campaign_id),
			coalesce(
				nullif(lm.campaign_name, ''),
				nullif(l.utm_campaign, ''),
				nullif(lm.raw_payload->>'campaign_name', ''),
				nullif(lm.raw_payload->>'campaignName', ''),
				nullif(lm.raw_payload#>>'{campaign,name}', ''),
				nullif(lm.payload->>'campaign_name', ''),
				nullif(lm.payload->>'campaignName', ''),
				nullif(lm.payload#>>'{campaign,name}', ''),
				nullif(mci.campaign_name, '')
			),
			coalesce(lm.adset_id, l.meta_adset_id),
			lm.adset_name,
			coalesce(lm.ad_id, l.meta_ad_id),
			coalesce(lm.ad_name, l.utm_content),
			coalesce(lm.form_id, l.meta_form_id),
			coalesce(lm.form_name, l.utm_term),
			coalesce(lm.platform, l.utm_medium),
			coalesce(lm.utm_source, l.utm_source),
			coalesce(lm.utm_medium, l.utm_medium),
			coalesce(lm.utm_campaign, l.utm_campaign),
			coalesce(lm.utm_content, l.utm_content),
			coalesce(lm.utm_term, l.utm_term),
			lm.creative_url,
			lm.creative_video_url,
			lm.creative_instagram_url,
			lm.payload::text,
			lm.raw_payload::text
		from public.leads l
		left join public.pipelines p on p.id = l.pipeline_id and p.organization_id = l.organization_id
		left join public.stages s on s.id = l.stage_id and s.organization_id = l.organization_id
		left join public.users u on u.id = l.assigned_user_id
		left join lateral (
			select lm.*
			from public.lead_meta lm
			where lm.organization_id = l.organization_id
			  and lm.lead_id = l.id
			order by lm.updated_at desc nulls last, lm.created_at desc nulls last
			limit 1
		) lm on true
		left join lateral (
			select max(nullif(mi.campaign_name, '')) as campaign_name
			from public.meta_campaign_insights mi
			where mi.organization_id = l.organization_id
			  and mi.campaign_id = coalesce(nullif(lm.campaign_id, ''), nullif(l.meta_campaign_id, ''))
		) mci on true
		left join lateral (
			select json_agg(json_build_object('id', t.id::text, 'name', t.name, 'color', t.color) order by t.name) as tags
			from public.lead_tags lt
			join public.tags t on t.id = lt.tag_id
			where lt.lead_id = l.id
			  and t.organization_id = l.organization_id
		) tags on true
		where `+strings.Join(where, " and ")+`
		`+contactOrderBy(filter)+`
		limit $`+fmt.Sprint(limitIndex)+`
		offset $`+fmt.Sprint(offsetIndex),
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	contacts := make([]Contact, 0, filter.Limit)
	for rows.Next() {
		contact, err := scanContact(rows)
		if err != nil {
			return nil, err
		}
		contacts = append(contacts, contact)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	count := <-countResult
	if count.err != nil {
		return nil, count.err
	}
	for index := range contacts {
		contacts[index].TotalCount = count.total
	}
	return contacts, nil
}

func (repo Repository) listContactsCompact(ctx context.Context, tenantContext tenant.Context, filter ContactListFilter) ([]Contact, error) {
	where, args, err := buildContactWhere(tenantContext, filter)
	if err != nil {
		return nil, err
	}
	countResult := make(chan struct {
		total int64
		err   error
	}, 1)
	go func() {
		total, countErr := repo.countContacts(ctx, tenantContext, filter)
		countResult <- struct {
			total int64
			err   error
		}{total: total, err: countErr}
	}()

	offset := (filter.Page - 1) * filter.Limit
	args = append(args, filter.Limit, offset)
	limitIndex := len(args) - 1
	offsetIndex := len(args)

	rows, err := repo.db.Pool().Query(ctx, `
		select
			0::bigint as total_count,
			l.id::text,
			l.name,
			l.phone,
			l.email,
			coalesce(to_jsonb(l)->>'whatsapp', l.phone),
			l.whatsapp_avatar_url,
			l.pipeline_id::text,
			p.name,
			l.stage_id::text,
			s.name,
			s.color,
			l.assigned_user_id::text,
			u.name,
			u.avatar_url,
			l.source,
			null::text as source_detail,
			l.source_session_id,
			l.source_webhook_id::text,
			l.visitor_session_id,
			coalesce(l.status, 'new'),
			l.priority,
			null::text as message,
			null::text as initial_message,
			l.property_code,
			l.property_id::text,
			l.interest_property_id::text,
			l.interest_plan_id::text,
			l.created_at,
			l.updated_at,
			null::text as sla_status,
			l.last_entry_at,
			null::text as last_interaction_preview,
			null::text as last_interaction_channel,
			coalesce(tags.tags, '[]'::json)::text,
			l.deal_status,
			l.lost_reason,
			null::text as feedback,
			null::text as valor_interesse,
			null::text as commission_percentage,
			null::text as faixa_valor_imovel,
			null::text as renda_familiar,
			null::text as finalidade_compra,
			null::boolean as procura_financiamento,
			null::boolean as trabalha,
			null::text as cargo,
			null::text as empresa,
			null::text as profissao,
			null::text as cep,
			null::text as endereco,
			null::text as numero,
			null::text as complemento,
			null::text as bairro,
			null::text as cidade,
			null::text as uf,
			l.is_own_resource,
			l.first_touch_at,
			l.first_touch_seconds,
			l.first_touch_channel,
			l.first_touch_actor_user_id::text,
			l.first_response_at,
			l.first_response_seconds,
			l.first_response_channel,
			l.first_response_is_automation,
			l.first_response_actor_user_id::text,
			l.stage_entered_at,
			l.last_entry_at,
			coalesce(l.reentry_count, 0),
			coalesce(l.redistribution_count, 0),
			l.last_contact_at,
			l.next_follow_up_at,
			l.won_at,
			l.lost_at,
			l.created_by::text,
			null::text as metadata_json,
			l.meta_lead_id,
			l.meta_form_id,
			l.meta_campaign_id,
			l.meta_adset_id,
			l.meta_ad_id,
			l.meta_click_id,
			null::text as campaign_id,
			null::text as campaign_name,
			null::text as adset_id,
			null::text as adset_name,
			null::text as ad_id,
			null::text as ad_name,
			null::text as form_id,
			null::text as form_name,
			null::text as platform,
			null::text as utm_source,
			null::text as utm_medium,
			null::text as utm_campaign,
			null::text as utm_content,
			null::text as utm_term,
			null::text as creative_url,
			null::text as creative_video_url,
			null::text as creative_instagram_url,
			null::text as meta_payload_json,
			null::text as meta_raw_payload_json
		from public.leads l
		left join public.pipelines p on p.id = l.pipeline_id and p.organization_id = l.organization_id
		left join public.stages s on s.id = l.stage_id and s.organization_id = l.organization_id
		left join public.users u on u.id = l.assigned_user_id
		left join lateral (
			select json_agg(json_build_object('id', t.id::text, 'name', t.name, 'color', t.color) order by t.name) as tags
			from public.lead_tags lt
			join public.tags t on t.id = lt.tag_id
			where lt.lead_id = l.id
			  and t.organization_id = l.organization_id
		) tags on true
		where `+strings.Join(where, " and ")+`
		`+contactOrderBy(filter)+`
		limit $`+fmt.Sprint(limitIndex)+`
		offset $`+fmt.Sprint(offsetIndex),
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	contacts := make([]Contact, 0, filter.Limit)
	for rows.Next() {
		contact, err := scanContact(rows)
		if err != nil {
			return nil, err
		}
		contacts = append(contacts, contact)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	count := <-countResult
	if count.err != nil {
		return nil, count.err
	}
	for index := range contacts {
		contacts[index].TotalCount = count.total
	}
	return contacts, nil
}

func (repo Repository) GetLeadVisibility(ctx context.Context, tenantContext tenant.Context) (LeadVisibility, error) {
	if canViewAllLeads(tenantContext) {
		return LeadVisibility{CanViewAll: true}, nil
	}

	if tenantContext.HasPermission("lead_view_team") {
		rows, err := repo.db.Pool().Query(ctx, `
			select distinct member.user_id::text
			from public.team_members leader
			join public.team_members member
			  on member.organization_id = leader.organization_id
			 and member.team_id = leader.team_id
			 and member.is_active = true
			where leader.organization_id = $1::uuid
			  and leader.user_id = $2::uuid
			  and leader.is_active = true
			  and leader.is_leader = true
			order by member.user_id::text
		`, tenantContext.OrganizationID, tenantContext.UserID)
		if err != nil {
			return LeadVisibility{}, err
		}
		defer rows.Close()

		memberIDs := []string{tenantContext.UserID}
		seen := map[string]bool{tenantContext.UserID: true}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return LeadVisibility{}, err
			}
			if !seen[id] {
				memberIDs = append(memberIDs, id)
				seen[id] = true
			}
		}
		if err := rows.Err(); err != nil {
			return LeadVisibility{}, err
		}
		if len(memberIDs) > 1 {
			return LeadVisibility{CanViewAll: false, TeamMemberIDs: memberIDs}, nil
		}
	}

	return LeadVisibility{CanViewAll: false, UserID: tenantContext.UserID}, nil
}

func buildContactWhere(tenantContext tenant.Context, filter ContactListFilter) ([]string, []any, error) {
	args := []any{
		tenantContext.OrganizationID,
		canViewAllLeads(tenantContext),
		tenantContext.UserID,
		tenantContext.HasPermission("lead_view_team"),
	}
	where := []string{
		"l.organization_id = $1::uuid",
		leadVisibilitySQL("$2", "$3", "$4", tenantContext.HasPermission(permissions.LeadViewOwn)),
	}

	add := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}

	if filter.Search != "" {
		args = append(args, searchtext.Pattern(filter.Search))
		index := len(args)
		where = append(where, searchtext.AnySQL([]string{"l.name", "l.phone", "l.email"}, fmt.Sprintf("$%d", index)))
	}
	if strings.TrimSpace(filter.TeamID) != "" {
		teamID, ok := normalizeUUID(filter.TeamID)
		if !ok {
			return nil, nil, fmt.Errorf("%w: teamId is invalid", ErrInvalidInput)
		}
		args = append(args, teamID)
		index := len(args)
		where = append(where, fmt.Sprintf(`(
			nullif(to_jsonb(l)->>'team_id', '') = $%d::text
			or (
				nullif(to_jsonb(l)->>'team_id', '') is null
				and exists (
					select 1 from public.team_members tm
					where tm.team_id = $%d::uuid
					  and tm.user_id = l.assigned_user_id
				)
			)
		)`, index, index))
	}
	if strings.TrimSpace(filter.PipelineID) != "" {
		pipelineID, ok := normalizeUUID(filter.PipelineID)
		if !ok {
			return nil, nil, fmt.Errorf("%w: pipelineId is invalid", ErrInvalidInput)
		}
		add("l.pipeline_id = $%d::uuid", pipelineID)
	}
	if strings.TrimSpace(filter.StageID) != "" {
		stageID, ok := normalizeUUID(filter.StageID)
		if !ok {
			return nil, nil, fmt.Errorf("%w: stageId is invalid", ErrInvalidInput)
		}
		add("l.stage_id = $%d::uuid", stageID)
	}
	if filter.Unassigned {
		where = append(where, "l.assigned_user_id is null")
	} else if strings.TrimSpace(filter.AssigneeID) != "" {
		assigneeID, ok := normalizeUUID(filter.AssigneeID)
		if !ok {
			return nil, nil, fmt.Errorf("%w: assigneeId is invalid", ErrInvalidInput)
		}
		add("l.assigned_user_id = $%d::uuid", assigneeID)
	}
	_, tagIDs, err := normalizeLeadTagFilterIDs(filter.TagID, filter.TagIDs)
	if err != nil {
		return nil, nil, err
	}
	if len(tagIDs) > 0 {
		add(`exists (
			select 1 from public.lead_tags lt
			where lt.organization_id = $1::uuid
			  and lt.lead_id = l.id
			  and lt.tag_id = any($%d::uuid[])
		)`, tagIDs)
	}
	if filter.Source != "" {
		add("l.source = $%d", filter.Source)
	}
	if filter.DealStatus != "" {
		add("l.deal_status = $%d", filter.DealStatus)
	}
	var occurredFrom any
	var occurredTo any
	if filter.CreatedFrom != "" {
		occurredFrom = filter.CreatedFrom
	}
	if filter.CreatedTo != "" {
		occurredTo = filter.CreatedTo
	}
	hasAttributionFilter := addLeadAttributionFilterCondition(&args, &where, "l", "lm", leadAttributionFilter{
		Campaign:     filter.CampaignID,
		AdSet:        filter.AdSetID,
		Ad:           filter.AdID,
		OccurredFrom: occurredFrom,
		OccurredTo:   occurredTo,
		DateCast:     "::timestamptz",
	})
	if !hasAttributionFilter {
		if filter.CreatedFrom != "" {
			add("l.created_at >= $%d::timestamptz", filter.CreatedFrom)
		}
		if filter.CreatedTo != "" {
			add("l.created_at <= $%d::timestamptz", filter.CreatedTo)
		}
	}

	return where, args, nil
}

func contactOrderBy(filter ContactListFilter) string {
	direction := "desc"
	if filter.SortDir == "asc" {
		direction = "asc"
	}
	switch filter.SortBy {
	case "name":
		return "order by l.name " + direction + ", l.id desc"
	case "last_interaction_at":
		return "order by coalesce(l.last_entry_at, l.updated_at, l.created_at) " + direction + ", l.id desc"
	case "stage":
		return "order by s.position " + direction + " nulls last, l.created_at desc, l.id desc"
	default:
		return "order by l.created_at " + direction + ", l.id desc"
	}
}

func scanContact(row scanner) (Contact, error) {
	var contact Contact
	var phone, email, whatsApp, avatar, pipelineID, pipelineName, stageID, stageName, stageColor pgtype.Text
	var assignedUserID, assigneeName, assigneeAvatar, slaStatus, preview, channel pgtype.Text
	var sourceDetail, sourceSessionID, sourceWebhookID, visitorSessionID pgtype.Text
	var priority, message, initialMessage, propertyCode, propertyID, interestPropertyID, interestPlanID pgtype.Text
	var dealStatus, lostReason, feedback, interestValue, commissionPercentage pgtype.Text
	var priceRange, familyIncome, purchasePurpose, role, company, profession pgtype.Text
	var postalCode, address, addressNumber, addressComplement, neighborhood, city, state pgtype.Text
	var createdBy, metadataJSON pgtype.Text
	var firstTouchChannel, firstTouchActorUserID, firstResponseChannel, firstResponseActorUserID pgtype.Text
	var metaLeadID, campaignID, campaignName, adsetID, adsetName, adID, adName pgtype.Text
	var formID, formName, platform, utmSource, utmMedium, utmCampaign, utmContent, utmTerm pgtype.Text
	var metaFormID, metaCampaignID, metaAdsetID, metaAdID, metaClickID pgtype.Text
	var creativeURL, creativeVideoURL, creativeInstagramURL, metaPayloadJSON, metaRawPayloadJSON pgtype.Text
	var seekingFinancing, works, isOwnResource, firstResponseAuto pgtype.Bool
	var firstTouchSeconds, firstResponseSeconds pgtype.Int4
	var lastInteraction, firstTouchAt, firstResponseAt, stageEnteredAt, lastEntry pgtype.Timestamptz
	var lastContactAt, nextFollowUpAt, wonAt, lostAt pgtype.Timestamptz
	var tagsJSON string
	if err := row.Scan(
		&contact.TotalCount,
		&contact.ID,
		&contact.Name,
		&phone,
		&email,
		&whatsApp,
		&avatar,
		&pipelineID,
		&pipelineName,
		&stageID,
		&stageName,
		&stageColor,
		&assignedUserID,
		&assigneeName,
		&assigneeAvatar,
		&contact.Source,
		&sourceDetail,
		&sourceSessionID,
		&sourceWebhookID,
		&visitorSessionID,
		&contact.Status,
		&priority,
		&message,
		&initialMessage,
		&propertyCode,
		&propertyID,
		&interestPropertyID,
		&interestPlanID,
		&contact.CreatedAt,
		&contact.UpdatedAt,
		&slaStatus,
		&lastInteraction,
		&preview,
		&channel,
		&tagsJSON,
		&dealStatus,
		&lostReason,
		&feedback,
		&interestValue,
		&commissionPercentage,
		&priceRange,
		&familyIncome,
		&purchasePurpose,
		&seekingFinancing,
		&works,
		&role,
		&company,
		&profession,
		&postalCode,
		&address,
		&addressNumber,
		&addressComplement,
		&neighborhood,
		&city,
		&state,
		&isOwnResource,
		&firstTouchAt,
		&firstTouchSeconds,
		&firstTouchChannel,
		&firstTouchActorUserID,
		&firstResponseAt,
		&firstResponseSeconds,
		&firstResponseChannel,
		&firstResponseAuto,
		&firstResponseActorUserID,
		&stageEnteredAt,
		&lastEntry,
		&contact.ReentryCount,
		&contact.RedistributionCount,
		&lastContactAt,
		&nextFollowUpAt,
		&wonAt,
		&lostAt,
		&createdBy,
		&metadataJSON,
		&metaLeadID,
		&metaFormID,
		&metaCampaignID,
		&metaAdsetID,
		&metaAdID,
		&metaClickID,
		&campaignID,
		&campaignName,
		&adsetID,
		&adsetName,
		&adID,
		&adName,
		&formID,
		&formName,
		&platform,
		&utmSource,
		&utmMedium,
		&utmCampaign,
		&utmContent,
		&utmTerm,
		&creativeURL,
		&creativeVideoURL,
		&creativeInstagramURL,
		&metaPayloadJSON,
		&metaRawPayloadJSON,
	); err != nil {
		return Contact{}, err
	}
	contact.Phone = textPtr(phone)
	contact.Email = textPtr(email)
	contact.WhatsApp = textPtr(whatsApp)
	contact.WhatsAppAvatarURL = textPtr(avatar)
	contact.PipelineID = textPtr(pipelineID)
	contact.PipelineName = textPtr(pipelineName)
	contact.StageID = textPtr(stageID)
	contact.StageName = textPtr(stageName)
	contact.StageColor = textPtr(stageColor)
	contact.AssignedUserID = textPtr(assignedUserID)
	contact.AssigneeName = textPtr(assigneeName)
	contact.AssigneeAvatar = textPtr(assigneeAvatar)
	contact.SourceDetail = textPtr(sourceDetail)
	contact.SourceSessionID = textPtr(sourceSessionID)
	contact.SourceWebhookID = textPtr(sourceWebhookID)
	contact.VisitorSessionID = textPtr(visitorSessionID)
	contact.Priority = textPtr(priority)
	contact.Message = textPtr(message)
	contact.InitialMessage = textPtr(initialMessage)
	contact.PropertyCode = textPtr(propertyCode)
	contact.PropertyID = textPtr(propertyID)
	contact.InterestPropertyID = textPtr(interestPropertyID)
	contact.InterestPlanID = textPtr(interestPlanID)
	contact.SLAStatus = textPtr(slaStatus)
	contact.LastInteractionAt = timePtr(lastInteraction)
	contact.LastInteractionPreview = textPtr(preview)
	contact.LastInteractionChannel = textPtr(channel)
	contact.DealStatus = textPtr(dealStatus)
	contact.LostReason = textPtr(lostReason)
	contact.Feedback = textPtr(feedback)
	contact.InterestValue = textPtr(interestValue)
	contact.CommissionPercentage = textPtr(commissionPercentage)
	contact.PriceRange = textPtr(priceRange)
	contact.FamilyIncome = textPtr(familyIncome)
	contact.PurchasePurpose = textPtr(purchasePurpose)
	contact.SeekingFinancing = boolPtr(seekingFinancing)
	contact.Works = boolPtr(works)
	contact.Role = textPtr(role)
	contact.Company = textPtr(company)
	contact.Profession = textPtr(profession)
	contact.PostalCode = textPtr(postalCode)
	contact.Address = textPtr(address)
	contact.AddressNumber = textPtr(addressNumber)
	contact.AddressComplement = textPtr(addressComplement)
	contact.Neighborhood = textPtr(neighborhood)
	contact.City = textPtr(city)
	contact.State = textPtr(state)
	contact.IsOwnResource = boolPtr(isOwnResource)
	contact.FirstTouchAt = timePtr(firstTouchAt)
	contact.FirstTouchSeconds = int32Ptr(firstTouchSeconds)
	contact.FirstTouchChannel = textPtr(firstTouchChannel)
	contact.FirstTouchActorUserID = textPtr(firstTouchActorUserID)
	contact.FirstResponseAt = timePtr(firstResponseAt)
	contact.FirstResponseSeconds = int32Ptr(firstResponseSeconds)
	contact.FirstResponseChannel = textPtr(firstResponseChannel)
	contact.FirstResponseAuto = boolPtr(firstResponseAuto)
	contact.FirstResponseActorID = textPtr(firstResponseActorUserID)
	contact.StageEnteredAt = timePtr(stageEnteredAt)
	contact.LastEntryAt = timePtr(lastEntry)
	contact.LastContactAt = timePtr(lastContactAt)
	contact.NextFollowUpAt = timePtr(nextFollowUpAt)
	contact.WonAt = timePtr(wonAt)
	contact.LostAt = timePtr(lostAt)
	contact.CreatedBy = textPtr(createdBy)
	contact.MetadataJSON = sanitizedLeadMetadataJSON(metadataJSON)
	contact.MetaLeadID = textPtr(metaLeadID)
	contact.MetaFormID = textPtr(metaFormID)
	contact.MetaCampaignID = textPtr(metaCampaignID)
	contact.MetaAdsetID = textPtr(metaAdsetID)
	contact.MetaAdID = textPtr(metaAdID)
	contact.MetaClickID = textPtr(metaClickID)
	contact.CampaignID = textPtr(campaignID)
	contact.CampaignName = textPtr(campaignName)
	contact.AdsetID = textPtr(adsetID)
	contact.AdsetName = textPtr(adsetName)
	contact.AdID = textPtr(adID)
	contact.AdName = textPtr(adName)
	contact.FormID = textPtr(formID)
	contact.FormName = textPtr(formName)
	contact.Platform = textPtr(platform)
	contact.UTMSource = textPtr(utmSource)
	contact.UTMMedium = textPtr(utmMedium)
	contact.UTMCampaign = textPtr(utmCampaign)
	contact.UTMContent = textPtr(utmContent)
	contact.UTMTerm = textPtr(utmTerm)
	contact.CreativeURL = textPtr(creativeURL)
	contact.CreativeVideoURL = textPtr(creativeVideoURL)
	contact.CreativeInstagramURL = textPtr(creativeInstagramURL)
	contact.MetaPayloadJSON = textPtr(metaPayloadJSON)
	contact.MetaRawPayloadJSON = textPtr(metaRawPayloadJSON)
	contact.Tags = []ContactTag{}
	if strings.TrimSpace(tagsJSON) != "" {
		_ = json.Unmarshal([]byte(tagsJSON), &contact.Tags)
	}
	return contact, nil
}

func sanitizedLeadMetadataJSON(raw pgtype.Text) *string {
	if !raw.Valid || strings.TrimSpace(raw.String) == "" {
		return nil
	}

	metadata := map[string]any{}
	if err := json.Unmarshal([]byte(raw.String), &metadata); err != nil {
		empty := "{}"
		return &empty
	}

	sanitize := func(values map[string]any) {
		if value, exists := values["cpf"]; exists {
			values["hasCPF"] = strings.TrimSpace(fmt.Sprint(value)) != ""
			delete(values, "cpf")
		}
		if value, exists := values["rg"]; exists {
			values["hasRG"] = strings.TrimSpace(fmt.Sprint(value)) != ""
			delete(values, "rg")
		}
	}

	sanitize(metadata)
	if profile, ok := metadata["profile"].(map[string]any); ok {
		sanitize(profile)
	}

	payload, err := json.Marshal(metadata)
	if err != nil {
		empty := "{}"
		return &empty
	}
	value := string(payload)
	return &value
}

func int32Ptr(value pgtype.Int4) *int32 {
	if !value.Valid {
		return nil
	}
	v := value.Int32
	return &v
}
