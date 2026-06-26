package leads

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var numericMetaFilter = regexp.MustCompile(`^\d+$`)

func (repo Repository) GetPipelineBoard(ctx context.Context, tenantContext tenant.Context, filter PipelineBoardFilter) ([]PipelineBoardStage, error) {
	pipelineID, err := repo.resolvePipelineBoardPipelineID(ctx, tenantContext, filter.PipelineID)
	if err != nil {
		return nil, err
	}
	if pipelineID == "" {
		return []PipelineBoardStage{}, nil
	}

	stages, err := repo.listPipelineBoardStages(ctx, tenantContext, pipelineID)
	if err != nil {
		return nil, err
	}

	allLeads := []*PipelineBoardLead{}
	for index := range stages {
		stageFilter := filter
		stageFilter.PipelineID = pipelineID
		stageFilter.StageID = stages[index].ID
		stageFilter.Offset = 0

		leads, total, err := repo.listPipelineBoardLeads(ctx, tenantContext, stageFilter, true)
		if err != nil {
			return nil, err
		}
		stages[index].Leads = leads
		stages[index].TotalLeadCount = total
		stages[index].HasMore = total > int64(len(leads))
		for leadIndex := range stages[index].Leads {
			allLeads = append(allLeads, &stages[index].Leads[leadIndex])
		}
	}

	if err := repo.attachPipelineBoardLeadEnrichments(ctx, tenantContext, allLeads); err != nil {
		return nil, err
	}

	return stages, nil
}

func (repo Repository) ListPipelineStageLeads(ctx context.Context, tenantContext tenant.Context, filter PipelineBoardFilter) (PipelineStageLeadsResponse, error) {
	stageID, ok := normalizeUUID(filter.StageID)
	if !ok {
		return PipelineStageLeadsResponse{}, ErrInvalidInput
	}
	filter.StageID = stageID

	if strings.TrimSpace(filter.PipelineID) == "" {
		return PipelineStageLeadsResponse{}, ErrInvalidInput
	}
	pipelineID, ok := normalizeUUID(filter.PipelineID)
	if !ok {
		return PipelineStageLeadsResponse{}, ErrInvalidInput
	}
	filter.PipelineID = pipelineID

	leads, _, err := repo.listPipelineBoardLeads(ctx, tenantContext, filter, false)
	if err != nil {
		return PipelineStageLeadsResponse{}, err
	}

	leadPointers := make([]*PipelineBoardLead, 0, len(leads))
	for index := range leads {
		leadPointers = append(leadPointers, &leads[index])
	}
	if err := repo.attachPipelineBoardLeadEnrichments(ctx, tenantContext, leadPointers); err != nil {
		return PipelineStageLeadsResponse{}, err
	}

	return PipelineStageLeadsResponse{
		StageID: stageID,
		Leads:   leads,
	}, nil
}

func (repo Repository) CountPipelineStageLeads(ctx context.Context, tenantContext tenant.Context, filter PipelineBoardFilter) (map[string]int64, error) {
	if strings.TrimSpace(filter.PipelineID) == "" || len(filter.StageIDs) == 0 {
		return map[string]int64{}, nil
	}

	pipelineID, ok := normalizeUUID(filter.PipelineID)
	if !ok {
		return nil, ErrInvalidInput
	}
	filter.PipelineID = pipelineID

	normalizedStageIDs := make([]string, 0, len(filter.StageIDs))
	for _, stageID := range filter.StageIDs {
		normalized, ok := normalizeUUID(stageID)
		if !ok {
			continue
		}
		normalizedStageIDs = appendUniqueString(normalizedStageIDs, normalized)
	}
	filter.StageIDs = normalizedStageIDs
	if len(filter.StageIDs) == 0 {
		return map[string]int64{}, nil
	}

	where, args, err := buildPipelineLeadWhere(tenantContext, filter)
	if err != nil {
		return nil, err
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select l.stage_id::text, count(*)::bigint
		from public.leads l
		where `+strings.Join(where, " and ")+`
		group by l.stage_id
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	counts := map[string]int64{}
	for _, stageID := range filter.StageIDs {
		counts[stageID] = 0
	}
	for rows.Next() {
		var stageID string
		var count int64
		if err := rows.Scan(&stageID, &count); err != nil {
			return nil, err
		}
		counts[stageID] = count
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return counts, nil
}

func (repo Repository) ListLeadMetaFilters(ctx context.Context, tenantContext tenant.Context, filter PipelineBoardFilter) (LeadMetaFilters, error) {
	where, args, err := buildPipelineLeadWhere(tenantContext, PipelineBoardFilter{
		DateFrom: filter.DateFrom,
		DateTo:   filter.DateTo,
	})
	if err != nil {
		return LeadMetaFilters{}, err
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			lm.campaign_name,
			lm.campaign_id,
			lm.adset_name,
			lm.adset_id,
			lm.ad_name,
			lm.ad_id
		from public.lead_meta lm
		join public.leads l on l.id = lm.lead_id
		where lm.organization_id = $1::uuid
		  and `+strings.Join(where, " and ")+`
	`, args...)
	if err != nil {
		return LeadMetaFilters{}, err
	}
	defer rows.Close()

	filters := LeadMetaFilters{
		Campaigns: []LeadMetaCampaignOption{},
		Adsets:    []LeadMetaAdsetOption{},
		Ads:       []LeadMetaAdOption{},
	}
	campaigns := map[string]LeadMetaCampaignOption{}
	adsets := map[string]LeadMetaAdsetOption{}
	ads := map[string]LeadMetaAdOption{}

	for rows.Next() {
		var campaignName, campaignID, adsetName, adsetID, adName, adID pgtype.Text
		if err := rows.Scan(&campaignName, &campaignID, &adsetName, &adsetID, &adName, &adID); err != nil {
			return LeadMetaFilters{}, err
		}

		campaignKey := firstNonEmpty(textValue(campaignID), textValue(campaignName))
		if campaignKey != "" && textValue(campaignName) != "" {
			campaigns[campaignKey] = LeadMetaCampaignOption{ID: campaignKey, Name: textValue(campaignName)}
		}

		adsetKey := firstNonEmpty(textValue(adsetID), textValue(adsetName))
		if adsetKey != "" && textValue(adsetName) != "" {
			adsets[campaignKey+"-"+adsetKey] = LeadMetaAdsetOption{
				ID:         adsetKey,
				Name:       textValue(adsetName),
				CampaignID: campaignKey,
			}
		}

		adKey := firstNonEmpty(textValue(adID), textValue(adName))
		if adKey != "" && textValue(adName) != "" {
			ads[campaignKey+"-"+adsetKey+"-"+adKey] = LeadMetaAdOption{
				ID:         adKey,
				Name:       textValue(adName),
				AdsetID:    adsetKey,
				CampaignID: campaignKey,
			}
		}
	}
	if err := rows.Err(); err != nil {
		return LeadMetaFilters{}, err
	}

	for _, item := range campaigns {
		filters.Campaigns = append(filters.Campaigns, item)
	}
	for _, item := range adsets {
		filters.Adsets = append(filters.Adsets, item)
	}
	for _, item := range ads {
		filters.Ads = append(filters.Ads, item)
	}
	sortLeadMetaOptions(&filters)

	return filters, nil
}

func (repo Repository) resolvePipelineBoardPipelineID(ctx context.Context, tenantContext tenant.Context, pipelineID string) (string, error) {
	if strings.TrimSpace(pipelineID) != "" {
		normalized, ok := normalizeUUID(pipelineID)
		if !ok {
			return "", ErrInvalidInput
		}

		var id string
		err := repo.db.Pool().QueryRow(ctx, `
			select id::text
			from public.pipelines
			where id = $1::uuid
			  and organization_id = $2::uuid
			limit 1
		`, normalized, tenantContext.OrganizationID).Scan(&id)
		if err == nil {
			return id, nil
		}
		if err == pgx.ErrNoRows {
			return "", ErrInvalidReference
		}
		return "", err
	}

	var id string
	err := repo.db.Pool().QueryRow(ctx, `
		select id::text
		from public.pipelines
		where organization_id = $1::uuid
		  and is_default = true
		order by position asc, created_at asc
		limit 1
	`, tenantContext.OrganizationID).Scan(&id)
	if err == nil {
		return id, nil
	}
	if err != pgx.ErrNoRows {
		return "", err
	}

	err = repo.db.Pool().QueryRow(ctx, `
		select id::text
		from public.pipelines
		where organization_id = $1::uuid
		order by position asc, created_at asc
		limit 1
	`, tenantContext.OrganizationID).Scan(&id)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}

	return id, nil
}

func (repo Repository) listPipelineBoardStages(ctx context.Context, tenantContext tenant.Context, pipelineID string) ([]PipelineBoardStage, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select
			id::text,
			organization_id::text,
			pipeline_id::text,
			name,
			color,
			stage_key,
			position,
			is_won,
			is_lost,
			sla_hours,
			is_active,
			created_at,
			updated_at
		from public.stages
		where organization_id = $1::uuid
		  and pipeline_id = $2::uuid
		order by position asc, created_at asc
	`, tenantContext.OrganizationID, pipelineID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	stages := []PipelineBoardStage{}
	for rows.Next() {
		var stage PipelineBoardStage
		var color, stageKey pgtype.Text
		var slaHours pgtype.Int4
		if err := rows.Scan(
			&stage.ID,
			&stage.OrganizationID,
			&stage.PipelineID,
			&stage.Name,
			&color,
			&stageKey,
			&stage.Position,
			&stage.IsWon,
			&stage.IsLost,
			&slaHours,
			&stage.IsActive,
			&stage.CreatedAt,
			&stage.UpdatedAt,
		); err != nil {
			return nil, err
		}
		stage.Color = pipelineTextPtr(color)
		stage.StageKey = pipelineTextPtr(stageKey)
		stage.SLAHours = pipelineIntPtr(slaHours)
		stage.Leads = []PipelineBoardLead{}
		stages = append(stages, stage)
	}

	return stages, rows.Err()
}

func (repo Repository) listPipelineBoardLeads(ctx context.Context, tenantContext tenant.Context, filter PipelineBoardFilter, includeTotal bool) ([]PipelineBoardLead, int64, error) {
	where, args, err := buildPipelineLeadWhere(tenantContext, filter)
	if err != nil {
		return nil, 0, err
	}

	args = append(args, filter.Limit, filter.Offset)
	limitIndex := len(args) - 1
	offsetIndex := len(args)

	totalSelect := ""
	if includeTotal {
		totalSelect = "count(*) over() as total_count,"
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			`+totalSelect+`
			`+pipelineBoardLeadSelectFields()+`
		from public.leads l
		where `+strings.Join(where, " and ")+`
		order by coalesce(l.last_entry_at, l.stage_entered_at, l.updated_at, l.created_at) desc, l.id desc
		limit $`+fmt.Sprint(limitIndex)+`
		offset $`+fmt.Sprint(offsetIndex)+`
	`, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	leads := make([]PipelineBoardLead, 0, filter.Limit)
	var total int64
	for rows.Next() {
		lead, rowTotal, err := scanPipelineBoardLead(rows, includeTotal)
		if err != nil {
			return nil, 0, err
		}
		if includeTotal {
			total = rowTotal
		}
		leads = append(leads, lead)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	return leads, total, nil
}

func buildPipelineLeadWhere(tenantContext tenant.Context, filter PipelineBoardFilter) ([]string, []any, error) {
	args := []any{
		tenantContext.OrganizationID,
		canViewAllLeads(tenantContext),
		tenantContext.UserID,
		tenantContext.HasPermission("lead_view_team"),
	}
	where := []string{
		"l.organization_id = $1::uuid",
		leadVisibilitySQL("$2", "$3", "$4"),
	}

	add := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}

	if strings.TrimSpace(filter.PipelineID) != "" {
		value, ok := normalizeUUID(filter.PipelineID)
		if !ok {
			return nil, nil, ErrInvalidInput
		}
		add("l.pipeline_id = $%d::uuid", value)
	}
	if strings.TrimSpace(filter.StageID) != "" {
		value, ok := normalizeUUID(filter.StageID)
		if !ok {
			return nil, nil, ErrInvalidInput
		}
		add("l.stage_id = $%d::uuid", value)
	}
	if len(filter.StageIDs) > 0 {
		normalized := []string{}
		for _, stageID := range filter.StageIDs {
			value, ok := normalizeUUID(stageID)
			if !ok {
				continue
			}
			normalized = appendUniqueString(normalized, value)
		}
		if len(normalized) == 0 {
			where = append(where, "false")
		} else {
			start := len(args) + 1
			for _, id := range normalized {
				args = append(args, id)
			}
			where = append(where, "l.stage_id in ("+uuidPlaceholders(start, normalized)+")")
		}
	}
	if filter.FilterUserID != "" && filter.FilterUserID != "all" {
		value, ok := normalizeUUID(filter.FilterUserID)
		if !ok {
			return nil, nil, ErrInvalidInput
		}
		add("l.assigned_user_id = $%d::uuid", value)
	} else if filter.FilterUserIDsSet {
		if len(filter.FilterUserIDs) == 0 {
			where = append(where, "false")
		} else {
			normalized := []string{}
			for _, userID := range filter.FilterUserIDs {
				value, ok := normalizeUUID(userID)
				if !ok {
					continue
				}
				normalized = appendUniqueString(normalized, value)
			}
			if len(normalized) == 0 {
				where = append(where, "false")
			} else {
				start := len(args) + 1
				for _, id := range normalized {
					args = append(args, id)
				}
				where = append(where, "l.assigned_user_id in ("+uuidPlaceholders(start, normalized)+")")
			}
		}
	}
	if filter.FilterDealStatus != "" && filter.FilterDealStatus != "all" {
		add("l.deal_status = $%d", filter.FilterDealStatus)
	}
	if filter.DateFrom != nil {
		add("l.created_at >= $%d", *filter.DateFrom)
	}
	if filter.DateTo != nil {
		add("l.created_at <= $%d", *filter.DateTo)
	}
	if filter.FilterSource != "" && filter.FilterSource != "all" {
		add("l.source = $%d", filter.FilterSource)
	}
	if strings.TrimSpace(filter.Search) != "" {
		value := "%" + strings.TrimSpace(filter.Search) + "%"
		args = append(args, value)
		index := len(args)
		where = append(where, fmt.Sprintf("(l.name ilike $%d or l.phone ilike $%d or l.email ilike $%d)", index, index, index))
	}
	if filter.FilterTag != "" && filter.FilterTag != "all" {
		tagID, ok := normalizeUUID(filter.FilterTag)
		if !ok {
			return nil, nil, ErrInvalidInput
		}
		add(`exists (
			select 1
			from public.lead_tags lt
			where lt.organization_id = $1::uuid
			  and lt.lead_id = l.id
			  and lt.tag_id = $%d::uuid
		)`, tagID)
	}

	metaConditions := []string{}
	addMetaCondition := func(idColumn string, nameColumn string, value string) {
		value = strings.TrimSpace(value)
		if value == "" || value == "all" {
			return
		}
		args = append(args, value)
		index := len(args)
		column := nameColumn
		if numericMetaFilter.MatchString(value) {
			column = idColumn
		}
		metaConditions = append(metaConditions, fmt.Sprintf("lm.%s = $%d", column, index))
	}
	addMetaCondition("campaign_id", "campaign_name", filter.FilterCampaign)
	addMetaCondition("adset_id", "adset_name", filter.FilterAdSet)
	addMetaCondition("ad_id", "ad_name", filter.FilterAd)
	if len(metaConditions) > 0 {
		where = append(where, `exists (
			select 1
			from public.lead_meta lm
			where lm.organization_id = $1::uuid
			  and lm.lead_id = l.id
			  and `+strings.Join(metaConditions, " and ")+`
		)`)
	}

	return where, args, nil
}

func pipelineBoardLeadSelectFields() string {
	return `
		l.id::text,
		l.name,
		l.phone,
		l.email,
		l.source,
		l.created_at,
		l.updated_at,
		l.stage_id::text,
		l.assigned_user_id::text,
		l.pipeline_id::text,
		l.message,
		l.stage_entered_at,
		l.organization_id::text,
		l.last_entry_at,
		l.reentry_count,
		l.whatsapp_avatar_url,
		l.deal_status,
		l.valor_interesse::double precision,
		l.property_id::text,
		l.lost_reason,
		l.won_at,
		l.lost_at,
		l.interest_property_id::text,
		l.first_response_at,
		l.first_response_seconds,
		l.first_response_is_automation`
}

func scanPipelineBoardLead(row scanner, withTotal bool) (PipelineBoardLead, int64, error) {
	var lead PipelineBoardLead
	var total int64
	var phone, email, stageID, assignedUserID, pipelineID, message, organizationID pgtype.Text
	var lastEntryAt, stageEnteredAt, wonAt, lostAt, firstResponseAt pgtype.Timestamptz
	var whatsappAvatarURL, propertyID, lostReason, interestPropertyID pgtype.Text
	var interestValue pgtype.Float8
	var firstResponseSeconds pgtype.Int4
	var firstResponseIsAutomation pgtype.Bool

	dest := []any{
		&lead.ID,
		&lead.Name,
		&phone,
		&email,
		&lead.Source,
		&lead.CreatedAt,
		&lead.UpdatedAt,
		&stageID,
		&assignedUserID,
		&pipelineID,
		&message,
		&stageEnteredAt,
		&organizationID,
		&lastEntryAt,
		&lead.ReentryCount,
		&whatsappAvatarURL,
		&lead.DealStatus,
		&interestValue,
		&propertyID,
		&lostReason,
		&wonAt,
		&lostAt,
		&interestPropertyID,
		&firstResponseAt,
		&firstResponseSeconds,
		&firstResponseIsAutomation,
	}
	if withTotal {
		dest = append([]any{&total}, dest...)
	}
	if err := row.Scan(dest...); err != nil {
		return PipelineBoardLead{}, 0, err
	}

	lead.Phone = pipelineTextPtr(phone)
	lead.Email = pipelineTextPtr(email)
	lead.StageID = pipelineTextPtr(stageID)
	lead.AssignedUserID = pipelineTextPtr(assignedUserID)
	lead.PipelineID = pipelineTextPtr(pipelineID)
	lead.Message = pipelineTextPtr(message)
	lead.OrganizationID = textValue(organizationID)
	lead.StageEnteredAt = pipelineTimePtr(stageEnteredAt)
	lead.LastEntryAt = pipelineTimePtr(lastEntryAt)
	lead.WhatsAppAvatarURL = pipelineTextPtr(whatsappAvatarURL)
	lead.PropertyID = pipelineTextPtr(propertyID)
	lead.LostReason = pipelineTextPtr(lostReason)
	lead.WonAt = pipelineTimePtr(wonAt)
	lead.LostAt = pipelineTimePtr(lostAt)
	lead.InterestPropertyID = pipelineTextPtr(interestPropertyID)
	lead.FirstResponseAt = pipelineTimePtr(firstResponseAt)
	lead.FirstResponseSeconds = pipelineIntPtr(firstResponseSeconds)
	lead.FirstResponseIsAutomation = pipelineBoolPtr(firstResponseIsAutomation)
	if interestValue.Valid {
		value := interestValue.Float64
		lead.InterestValue = &value
	}
	lead.LeadMeta = []LeadEnrichmentMeta{}
	lead.Tags = []LeadEnrichmentTag{}
	lead.TasksCount = LeadEnrichmentTaskCount{}

	return lead, total, nil
}

func (repo Repository) attachPipelineBoardLeadEnrichments(ctx context.Context, tenantContext tenant.Context, leads []*PipelineBoardLead) error {
	if len(leads) == 0 {
		return nil
	}

	leadIDs := make([]string, 0, len(leads))
	for _, lead := range leads {
		leadIDs = append(leadIDs, lead.ID)
	}

	enrichments, err := repo.ListEnrichments(ctx, tenantContext, leadIDs)
	if err != nil {
		return err
	}
	enrichmentsByLead := map[string]LeadEnrichment{}
	for _, enrichment := range enrichments {
		enrichmentsByLead[enrichment.LeadID] = enrichment
	}

	for _, lead := range leads {
		enrichment, ok := enrichmentsByLead[lead.ID]
		if !ok {
			continue
		}
		lead.Assignee = enrichment.Assignee
		lead.InterestProperty = enrichment.InterestProperty
		lead.LeadMeta = enrichment.LeadMeta
		lead.Tags = enrichment.Tags
		lead.TasksCount = enrichment.TasksCount
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
