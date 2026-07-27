package leads

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/searchtext"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type leadAttributionFilter struct {
	Campaign     string
	AdSet        string
	Ad           string
	OccurredFrom any
	OccurredTo   any
	DateCast     string
}

func normalizedLeadAttributionValue(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || value == "all" {
		return ""
	}
	return value
}

// addLeadAttributionFilterCondition keeps one CRM contact per person while
// matching the exact historical entry that carried the selected attribution.
// The current lead/lead_meta projection remains as a compatibility fallback for
// old rows that predate entry-event enrichment.
func addLeadAttributionFilterCondition(args *[]any, conditions *[]string, leadAlias string, metaAlias string, filter leadAttributionFilter) bool {
	filter.Campaign = normalizedLeadAttributionValue(filter.Campaign)
	filter.AdSet = normalizedLeadAttributionValue(filter.AdSet)
	filter.Ad = normalizedLeadAttributionValue(filter.Ad)
	if filter.Campaign == "" && filter.AdSet == "" && filter.Ad == "" {
		return false
	}

	eventConditions := []string{
		"entry.organization_id = $1::uuid",
		fmt.Sprintf("entry.lead_id = %s.id", leadAlias),
		"entry.is_countable = true",
	}
	legacyConditions := []string{}

	addValue := func(value string, eventColumns []string, leadColumns []string, metaColumns []string) {
		if value == "" {
			return
		}
		*args = append(*args, value)
		index := len(*args)

		eventMatches := make([]string, 0, len(eventColumns))
		for _, column := range eventColumns {
			eventMatches = append(eventMatches, fmt.Sprintf("entry.%s = $%d", column, index))
		}
		eventConditions = append(eventConditions, "("+strings.Join(eventMatches, " or ")+")")

		legacyMatches := make([]string, 0, len(leadColumns)+1)
		for _, column := range leadColumns {
			legacyMatches = append(legacyMatches, fmt.Sprintf("%s.%s = $%d", leadAlias, column, index))
		}
		metaMatches := make([]string, 0, len(metaColumns))
		for _, column := range metaColumns {
			metaMatches = append(metaMatches, fmt.Sprintf("%s.%s = $%d", metaAlias, column, index))
		}
		legacyMatches = append(legacyMatches, fmt.Sprintf(`exists (
			select 1
			from public.lead_meta %s
			where %s.organization_id = $1::uuid
			  and %s.lead_id = %s.id
			  and (%s)
		)`, metaAlias, metaAlias, metaAlias, leadAlias, strings.Join(metaMatches, " or ")))
		legacyConditions = append(legacyConditions, "("+strings.Join(legacyMatches, " or ")+")")
	}

	addValue(filter.Campaign,
		[]string{"campaign_id", "campaign_name", "utm_campaign"},
		[]string{"meta_campaign_id", "utm_campaign"},
		[]string{"campaign_id", "campaign_name"},
	)
	addValue(filter.AdSet,
		[]string{"adset_id", "adset_name"},
		[]string{"meta_adset_id"},
		[]string{"adset_id", "adset_name"},
	)
	addValue(filter.Ad,
		[]string{"ad_id", "ad_name"},
		[]string{"meta_ad_id"},
		[]string{"ad_id", "ad_name"},
	)

	addDate := func(value any, operator string) {
		if value == nil {
			return
		}
		*args = append(*args, value)
		index := len(*args)
		placeholder := fmt.Sprintf("$%d%s", index, filter.DateCast)
		eventConditions = append(eventConditions, "entry.occurred_at "+operator+" "+placeholder)
		legacyConditions = append(legacyConditions, leadAlias+".created_at "+operator+" "+placeholder)
	}
	addDate(filter.OccurredFrom, ">=")
	addDate(filter.OccurredTo, "<=")

	*conditions = append(*conditions, fmt.Sprintf(`(
		exists (
			select 1
			from public.lead_entry_events entry
			where %s
		)
		or (%s)
	)`, strings.Join(eventConditions, " and "), strings.Join(legacyConditions, " and ")))
	return true
}

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

	stageIDs := make([]string, 0, len(stages))
	for _, stage := range stages {
		stageIDs = append(stageIDs, stage.ID)
	}

	boardFilter := filter
	boardFilter.PipelineID = pipelineID
	boardFilter.StageID = ""
	boardFilter.StageIDs = stageIDs
	boardFilter.Offset = 0
	leadsByStage, counts, err := repo.listPipelineBoardLeadsByStage(ctx, tenantContext, boardFilter)
	if err != nil {
		return nil, err
	}
	valueTotals, err := repo.listPipelineBoardStageValueTotals(ctx, tenantContext, boardFilter)
	if err != nil {
		return nil, err
	}

	allLeads := []*PipelineBoardLead{}
	for index := range stages {
		total := counts[stages[index].ID]
		stages[index].Leads = leadsByStage[stages[index].ID]
		stages[index].TotalLeadCount = total
		stages[index].TotalValue = valueTotals[stages[index].ID]
		stages[index].HasMore = total > int64(len(stages[index].Leads))
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
		PipelineID: filter.PipelineID,
	})
	if err != nil {
		return LeadMetaFilters{}, err
	}

	entryDateConditions := []string{}
	if filter.DateFrom != nil {
		args = append(args, *filter.DateFrom)
		entryDateConditions = append(entryDateConditions, fmt.Sprintf("lee.occurred_at >= $%d", len(args)))
	}
	if filter.DateTo != nil {
		args = append(args, *filter.DateTo)
		entryDateConditions = append(entryDateConditions, fmt.Sprintf("lee.occurred_at <= $%d", len(args)))
	}
	entryJoinConditions := []string{
		"lee.organization_id = l.organization_id",
		"lee.lead_id = l.id",
		"lee.is_countable = true",
	}
	entryJoinConditions = append(entryJoinConditions, entryDateConditions...)
	if len(entryDateConditions) > 0 {
		where = append(where, "lee.id is not null")
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			coalesce(
				nullif(lee.campaign_name, ''),
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
			coalesce(nullif(lee.campaign_id, ''), nullif(lm.campaign_id, ''), nullif(l.meta_campaign_id, ''), nullif(lee.campaign_name, ''), nullif(lm.campaign_name, ''), nullif(l.utm_campaign, '')),
			coalesce(nullif(lee.adset_name, ''), nullif(lm.adset_name, ''), nullif(l.meta_adset_id, '')),
			coalesce(nullif(lee.adset_id, ''), nullif(lm.adset_id, ''), nullif(l.meta_adset_id, ''), nullif(lee.adset_name, ''), nullif(lm.adset_name, '')),
			coalesce(nullif(lee.ad_name, ''), nullif(lm.ad_name, ''), nullif(l.meta_ad_id, '')),
			coalesce(nullif(lee.ad_id, ''), nullif(lm.ad_id, ''), nullif(l.meta_ad_id, ''), nullif(lee.ad_name, ''), nullif(lm.ad_name, ''))
		from public.leads l
		left join public.lead_entry_events lee on `+strings.Join(entryJoinConditions, " and ")+`
		left join public.lead_meta lm on lm.lead_id = l.id and lm.organization_id = l.organization_id
		left join lateral (
			select max(nullif(mi.campaign_name, '')) as campaign_name
			from public.meta_campaign_insights mi
			where mi.organization_id = l.organization_id
			  and mi.campaign_id = coalesce(nullif(lee.campaign_id, ''), nullif(lm.campaign_id, ''), nullif(l.meta_campaign_id, ''))
		) mci on true
		where `+strings.Join(where, " and ")+`
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
		order by coalesce(l.board_order_at, l.stage_entered_at, l.created_at) desc, l.id desc
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

func (repo Repository) listPipelineBoardLeadsByStage(ctx context.Context, tenantContext tenant.Context, filter PipelineBoardFilter) (map[string][]PipelineBoardLead, map[string]int64, error) {
	leadsByStage := map[string][]PipelineBoardLead{}
	counts := map[string]int64{}
	for _, stageID := range filter.StageIDs {
		leadsByStage[stageID] = []PipelineBoardLead{}
		counts[stageID] = 0
	}
	if strings.TrimSpace(filter.PipelineID) == "" || len(filter.StageIDs) == 0 {
		return leadsByStage, counts, nil
	}

	limit := filter.Limit
	if limit <= 0 {
		limit = defaultPipelineBoardLimit
	}
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}

	where, args, err := buildPipelineLeadWhere(tenantContext, filter)
	if err != nil {
		return nil, nil, err
	}

	args = append(args, offset, offset+limit)
	offsetIndex := len(args) - 1
	endIndex := len(args)

	rows, err := repo.db.Pool().Query(ctx, `
		with ranked as (
			select
				count(*) over(partition by l.stage_id) as stage_total_count,
				row_number() over(
					partition by l.stage_id
					order by coalesce(l.board_order_at, l.stage_entered_at, l.created_at) desc, l.id desc
				) as stage_rank,
				`+pipelineBoardLeadSelectFields()+`
			from public.leads l
			where `+strings.Join(where, " and ")+`
		)
		select
			stage_total_count,
			`+pipelineBoardLeadColumnFields()+`
		from ranked
		where stage_rank > $`+fmt.Sprint(offsetIndex)+`
		  and stage_rank <= $`+fmt.Sprint(endIndex)+`
		order by stage_id, stage_rank
	`, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	for rows.Next() {
		lead, rowTotal, err := scanPipelineBoardLead(rows, true)
		if err != nil {
			return nil, nil, err
		}
		if lead.StageID == nil || *lead.StageID == "" {
			continue
		}
		stageID := *lead.StageID
		leadsByStage[stageID] = append(leadsByStage[stageID], lead)
		counts[stageID] = rowTotal
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}

	return leadsByStage, counts, nil
}

func (repo Repository) listPipelineBoardStageValueTotals(ctx context.Context, tenantContext tenant.Context, filter PipelineBoardFilter) (map[string]float64, error) {
	totals := map[string]float64{}
	for _, stageID := range filter.StageIDs {
		totals[stageID] = 0
	}
	if strings.TrimSpace(filter.PipelineID) == "" || len(filter.StageIDs) == 0 {
		return totals, nil
	}

	where, args, err := buildPipelineLeadWhere(tenantContext, filter)
	if err != nil {
		return nil, err
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			l.stage_id::text,
			coalesce(sum(
				coalesce(
					nullif(l.valor_interesse::double precision, 0),
					nullif(p.preco::double precision, 0),
					0
				)
			), 0)::double precision as total_value
		from public.leads l
		left join public.properties p
		  on p.id = l.interest_property_id
		 and p.organization_id = l.organization_id
		where `+strings.Join(where, " and ")+`
		group by l.stage_id
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var stageID string
		var total float64
		if err := rows.Scan(&stageID, &total); err != nil {
			return nil, err
		}
		totals[stageID] = total
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return totals, nil
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
		leadVisibilitySQL("$2", "$3", "$4", tenantContext.HasPermission(permissions.LeadViewOwn)),
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
	hasSearch := strings.TrimSpace(filter.Search) != ""
	if filter.FilterSource != "" && filter.FilterSource != "all" {
		add("l.source = $%d", filter.FilterSource)
	}
	if hasSearch {
		value := searchtext.Pattern(filter.Search)
		args = append(args, value)
		index := len(args)
		where = append(where, searchtext.AnySQL([]string{"l.name", "l.phone", "l.email"}, fmt.Sprintf("$%d", index)))
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

	var occurredFrom any
	var occurredTo any
	if !hasSearch && filter.DateFrom != nil {
		occurredFrom = *filter.DateFrom
	}
	if !hasSearch && filter.DateTo != nil {
		occurredTo = *filter.DateTo
	}
	hasAttributionFilter := addLeadAttributionFilterCondition(&args, &where, "l", "lm", leadAttributionFilter{
		Campaign:     filter.FilterCampaign,
		AdSet:        filter.FilterAdSet,
		Ad:           filter.FilterAd,
		OccurredFrom: occurredFrom,
		OccurredTo:   occurredTo,
	})
	if !hasSearch && !hasAttributionFilter {
		if filter.DateFrom != nil {
			add("l.created_at >= $%d", *filter.DateFrom)
		}
		if filter.DateTo != nil {
			add("l.created_at <= $%d", *filter.DateTo)
		}
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
		l.board_order_at,
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

func pipelineBoardLeadColumnFields() string {
	return `
		id,
		name,
		phone,
		email,
		source,
		created_at,
		updated_at,
		stage_id,
		assigned_user_id,
		pipeline_id,
		message,
		stage_entered_at,
		board_order_at,
		organization_id,
		last_entry_at,
		reentry_count,
		whatsapp_avatar_url,
		deal_status,
		valor_interesse,
		property_id,
		lost_reason,
		won_at,
		lost_at,
		interest_property_id,
		first_response_at,
		first_response_seconds,
		first_response_is_automation`
}

func scanPipelineBoardLead(row scanner, withTotal bool) (PipelineBoardLead, int64, error) {
	var lead PipelineBoardLead
	var total int64
	var phone, email, stageID, assignedUserID, pipelineID, message, organizationID pgtype.Text
	var lastEntryAt, stageEnteredAt, boardOrderAt, wonAt, lostAt, firstResponseAt pgtype.Timestamptz
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
		&boardOrderAt,
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
	lead.BoardOrderAt = pipelineTimePtr(boardOrderAt)
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
