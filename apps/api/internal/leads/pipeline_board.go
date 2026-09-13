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
	leadsByStage, err := repo.listInitialPipelineBoardLeadsByStage(ctx, tenantContext, boardFilter)
	if err != nil {
		return nil, err
	}
	metrics, err := repo.listPipelineBoardStageMetrics(ctx, tenantContext, boardFilter)
	if err != nil {
		return nil, err
	}

	allLeads := []*PipelineBoardLead{}
	for index := range stages {
		metric := metrics[stages[index].ID]
		stages[index].Leads = leadsByStage[stages[index].ID]
		stages[index].TotalLeadCount = metric.LeadCount
		stages[index].TotalValue = metric.TotalValue
		stages[index].HasMore = metric.LeadCount > int64(len(stages[index].Leads))
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

	leads, err := repo.listPipelineBoardLeads(ctx, tenantContext, filter)
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
	where, args, err := buildPipelineLeadWhere(tenantContext, filter)
	if err != nil {
		return LeadMetaFilters{}, err
	}

	rows, err := repo.db.Pool().Query(ctx, `
		with visible_leads as (
			select
				l.id,
				l.organization_id,
				l.utm_campaign,
				l.meta_campaign_id,
				l.meta_adset_id,
				l.meta_ad_id
			from public.leads l
			where `+strings.Join(where, " and ")+`
		)
		select distinct
			coalesce(
				nullif(raw_attribution.campaign_name, ''),
				nullif(l.utm_campaign, ''),
				nullif(mci.campaign_name, '')
			),
			coalesce(nullif(raw_attribution.campaign_id, ''), nullif(l.meta_campaign_id, ''), nullif(raw_attribution.campaign_name, ''), nullif(l.utm_campaign, '')),
			coalesce(nullif(raw_attribution.adset_name, ''), nullif(l.meta_adset_id, '')),
			coalesce(nullif(raw_attribution.adset_id, ''), nullif(l.meta_adset_id, ''), nullif(raw_attribution.adset_name, '')),
			coalesce(nullif(raw_attribution.ad_name, ''), nullif(l.meta_ad_id, '')),
			coalesce(nullif(raw_attribution.ad_id, ''), nullif(l.meta_ad_id, ''), nullif(raw_attribution.ad_name, ''))
		from visible_leads l
		left join lateral (
			select
				entry.campaign_name,
				entry.campaign_id,
				entry.adset_name,
				entry.adset_id,
				entry.ad_name,
				entry.ad_id
			from public.lead_entry_events entry
			where entry.organization_id = l.organization_id
			  and entry.lead_id = l.id
			  and entry.is_countable = true
			union all
			select
				coalesce(
					nullif(meta.campaign_name, ''),
					nullif(meta.raw_payload->>'campaign_name', ''),
					nullif(meta.raw_payload->>'campaignName', ''),
					nullif(meta.raw_payload#>>'{campaign,name}', ''),
					nullif(meta.payload->>'campaign_name', ''),
					nullif(meta.payload->>'campaignName', ''),
					nullif(meta.payload#>>'{campaign,name}', '')
				),
				meta.campaign_id,
				meta.adset_name,
				meta.adset_id,
				meta.ad_name,
				meta.ad_id
			from public.lead_meta meta
			where meta.organization_id = l.organization_id
			  and meta.lead_id = l.id
			union all
			select null::text, null::text, null::text, null::text, null::text, null::text
		) raw_attribution on true
		left join lateral (
			select max(nullif(mi.campaign_name, '')) as campaign_name
			from public.meta_campaign_insights mi
			where mi.organization_id = l.organization_id
			  and mi.campaign_id = coalesce(nullif(raw_attribution.campaign_id, ''), nullif(l.meta_campaign_id, ''))
		) mci on true
	`, args...)
	if err != nil {
		return LeadMetaFilters{}, err
	}
	defer rows.Close()

	filters := LeadMetaFilters{
		Campaigns: []LeadMetaCampaignOption{},
		Adsets:    []LeadMetaAdsetOption{},
		Ads:       []LeadMetaAdOption{},
		Sources:   []string{},
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
	rows.Close()

	sourceArgs := append([]any{}, args...)
	sourceArgs = append(sourceArgs, maxPipelineBoardSources)
	sourceLimitIndex := len(sourceArgs)
	sourceRows, err := repo.db.Pool().Query(ctx, `
		with visible_leads as (
			select l.source
			from public.leads l
			where `+strings.Join(where, " and ")+`
		)
		select distinct nullif(btrim(l.source), '') as source
		from visible_leads l
		where nullif(btrim(l.source), '') is not null
		order by source
		limit $`+fmt.Sprint(sourceLimitIndex)+`
	`, sourceArgs...)
	if err != nil {
		return LeadMetaFilters{}, err
	}
	defer sourceRows.Close()
	for sourceRows.Next() {
		var source string
		if err := sourceRows.Scan(&source); err != nil {
			return LeadMetaFilters{}, err
		}
		filters.Sources = append(filters.Sources, source)
	}
	if err := sourceRows.Err(); err != nil {
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
			coalesce((to_jsonb(s)->>'is_qualified')::boolean, false),
			sla_hours,
			is_active,
			created_at,
			updated_at
		from public.stages as s
		where s.organization_id = $1::uuid
		  and s.pipeline_id = $2::uuid
		  and s.is_active = true
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
			&stage.IsQualified,
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

func (repo Repository) listPipelineBoardLeads(ctx context.Context, tenantContext tenant.Context, filter PipelineBoardFilter) ([]PipelineBoardLead, error) {
	where, args, err := buildPipelineLeadWhere(tenantContext, filter)
	if err != nil {
		return nil, err
	}
	args, propertyVisibility := appendCanonicalPropertyVisibility(args, tenantContext, "visible_property")
	boardSortExpression := pipelineBoardSortExpression("l")

	paginationSQL := ""
	if filter.CursorBefore != nil {
		args = append(args, *filter.CursorBefore, filter.CursorBeforeID)
		cursorBeforeIndex := len(args) - 1
		cursorBeforeIDIndex := len(args)
		where = append(where, fmt.Sprintf(
			"("+boardSortExpression+", l.id) < ($%d::timestamptz, $%d::uuid)",
			cursorBeforeIndex,
			cursorBeforeIDIndex,
		))
	}
	args = append(args, filter.Limit)
	limitIndex := len(args)
	if filter.CursorBefore == nil {
		args = append(args, filter.Offset)
		paginationSQL = " offset $" + fmt.Sprint(len(args))
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			`+pipelineBoardLeadSelectFields(propertyVisibility)+`
		from public.leads l
		where `+strings.Join(where, " and ")+`
		order by `+boardSortExpression+` desc, l.id desc
		limit $`+fmt.Sprint(limitIndex)+paginationSQL+`
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	leads := make([]PipelineBoardLead, 0, filter.Limit)
	for rows.Next() {
		lead, _, err := scanPipelineBoardLead(rows, false)
		if err != nil {
			return nil, err
		}
		leads = append(leads, lead)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return leads, nil
}

func (repo Repository) listInitialPipelineBoardLeadsByStage(ctx context.Context, tenantContext tenant.Context, filter PipelineBoardFilter) (map[string][]PipelineBoardLead, error) {
	leadsByStage := map[string][]PipelineBoardLead{}
	for _, stageID := range filter.StageIDs {
		leadsByStage[stageID] = []PipelineBoardLead{}
	}
	if strings.TrimSpace(filter.PipelineID) == "" || len(filter.StageIDs) == 0 {
		return leadsByStage, nil
	}

	limit := filter.Limit
	if limit <= 0 {
		limit = defaultPipelineBoardLimit
	}
	where, args, err := buildPipelineLeadWhere(tenantContext, filter)
	if err != nil {
		return nil, err
	}
	args, propertyVisibility := appendCanonicalPropertyVisibility(args, tenantContext, "visible_property")

	requestedStageValues := make([]string, 0, len(filter.StageIDs))
	for _, rawStageID := range filter.StageIDs {
		stageID, ok := normalizeUUID(rawStageID)
		if !ok {
			continue
		}
		args = append(args, stageID)
		requestedStageValues = append(requestedStageValues, fmt.Sprintf("($%d::uuid)", len(args)))
	}
	if len(requestedStageValues) == 0 {
		return leadsByStage, nil
	}
	args = append(args, limit)
	limitIndex := len(args)
	boardSortExpression := pipelineBoardSortExpression("l")
	outerBoardSortExpression := pipelineBoardSortExpression("stage_lead")

	rows, err := repo.db.Pool().Query(ctx, `
		with requested_stages(stage_id) as (
			values `+strings.Join(requestedStageValues, ", ")+`
		)
		select stage_lead.*
		from requested_stages requested_stage
		cross join lateral (
			select
				`+pipelineBoardLeadSelectFields(propertyVisibility)+`
			from public.leads l
			where `+strings.Join(where, " and ")+`
			  and l.stage_id = requested_stage.stage_id
			order by `+boardSortExpression+` desc, l.id desc
			limit $`+fmt.Sprint(limitIndex)+`
		) stage_lead
		order by stage_lead.stage_id, `+outerBoardSortExpression+` desc, stage_lead.id desc
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		lead, _, err := scanPipelineBoardLead(rows, false)
		if err != nil {
			return nil, err
		}
		if lead.StageID == nil || *lead.StageID == "" {
			continue
		}
		stageID := *lead.StageID
		leadsByStage[stageID] = append(leadsByStage[stageID], lead)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return leadsByStage, nil
}

type pipelineBoardStageMetric struct {
	LeadCount  int64
	TotalValue float64
}

// listPipelineBoardStageMetrics deliberately aggregates every matching lead
// separately from the card preview query. This keeps stage totals exact while
// allowing the initial board to fetch only the first page from each stage.
func (repo Repository) listPipelineBoardStageMetrics(ctx context.Context, tenantContext tenant.Context, filter PipelineBoardFilter) (map[string]pipelineBoardStageMetric, error) {
	metrics := map[string]pipelineBoardStageMetric{}
	for _, stageID := range filter.StageIDs {
		metrics[stageID] = pipelineBoardStageMetric{}
	}
	if strings.TrimSpace(filter.PipelineID) == "" || len(filter.StageIDs) == 0 {
		return metrics, nil
	}

	where, args, err := buildPipelineLeadWhere(tenantContext, filter)
	if err != nil {
		return nil, err
	}
	args, propertyVisibility := appendCanonicalPropertyVisibility(args, tenantContext, "p")

	rows, err := repo.db.Pool().Query(ctx, `
		select
			l.stage_id::text,
			count(*)::bigint as lead_count,
			coalesce(sum(
				coalesce(
					nullif(l.valor_interesse::double precision, 0),
					nullif(p.preco::double precision, 0),
					0
				)
			), 0)::double precision as total_value
		from public.leads l
		left join public.properties p
		  on p.id = coalesce(l.interest_property_id, l.property_id)
		 and p.organization_id = l.organization_id
		 and `+propertyVisibility+`
		where `+strings.Join(where, " and ")+`
		group by l.stage_id
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var stageID string
		var metric pipelineBoardStageMetric
		if err := rows.Scan(&stageID, &metric.LeadCount, &metric.TotalValue); err != nil {
			return nil, err
		}
		metrics[stageID] = metric
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return metrics, nil
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
	if filter.FilterSource != "" && filter.FilterSource != "all" {
		add("l.source = $%d", filter.FilterSource)
	}
	if strings.TrimSpace(filter.Search) != "" {
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

	addLeadAttributionFilterCondition(&args, &where, "l", "lm", leadAttributionFilter{
		Campaign: filter.FilterCampaign,
		AdSet:    filter.FilterAdSet,
		Ad:       filter.FilterAd,
	})

	dateMode := filter.DateMode
	if dateMode == "" {
		dateMode = PipelineBoardDateModeOperational
	}
	if dateMode != PipelineBoardDateModeOperational && dateMode != PipelineBoardDateModeOrigin {
		return nil, nil, ErrInvalidInput
	}
	createdAtClauses := []string{}
	terminalAtClauses := []string{}
	if filter.DateFrom != nil {
		args = append(args, *filter.DateFrom)
		createdAtClauses = append(createdAtClauses, fmt.Sprintf("l.created_at >= $%d", len(args)))
		terminalAtClauses = append(terminalAtClauses, fmt.Sprintf("terminal_at >= $%d", len(args)))
	}
	if filter.DateTo != nil {
		args = append(args, *filter.DateTo)
		createdAtClauses = append(createdAtClauses, fmt.Sprintf("l.created_at <= $%d", len(args)))
		terminalAtClauses = append(terminalAtClauses, fmt.Sprintf("terminal_at <= $%d", len(args)))
	}
	if len(createdAtClauses) > 0 {
		createdInPeriod := "(" + strings.Join(createdAtClauses, " and ") + ")"
		if dateMode == PipelineBoardDateModeOperational {
			terminalInPeriod := strings.ReplaceAll(strings.Join(terminalAtClauses, " and "), "terminal_at", `case
				when l.deal_status = 'won' then l.won_at
				when l.deal_status = 'lost' then l.lost_at
			end`)
			stageEnteredInPeriod := strings.ReplaceAll(strings.Join(terminalAtClauses, " and "), "terminal_at", "l.stage_entered_at")
			where = append(where, `(
				coalesce(l.deal_status, 'open') = 'open'
				or `+createdInPeriod+`
				or (l.deal_status in ('won', 'lost') and (`+terminalInPeriod+`))
				or (
					l.deal_status in ('won', 'lost')
					and (`+stageEnteredInPeriod+`)
					and exists (
						select 1
						from public.stages terminal_stage
						where terminal_stage.id = l.stage_id
						  and terminal_stage.organization_id = l.organization_id
						  and terminal_stage.is_active = true
						  and (
							(l.deal_status = 'won' and terminal_stage.is_won = true)
							or (l.deal_status = 'lost' and terminal_stage.is_lost = true)
						  )
					)
				)
			)`)
		} else {
			where = append(where, createdInPeriod)
		}
	}

	return where, args, nil
}

func pipelineBoardSortExpression(alias string) string {
	// The lead clock trigger initializes board_order_at for every lead attached
	// to a stage, and operational mutations advance it. Keeping this expression
	// to the bare column lets Postgres use idx_leads_board_order for both the
	// initial page and the keyset continuation.
	return alias + ".board_order_at"
}

func pipelineBoardLeadSelectFields(propertyVisibility string) string {
	propertyID := pipelineBoardVisiblePropertyIDSQL("property_id", propertyVisibility)
	interestPropertyID := pipelineBoardVisiblePropertyIDSQL("interest_property_id", propertyVisibility)
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
		` + propertyID + ` as property_id,
		l.lost_reason,
		l.won_at,
		l.lost_at,
		` + interestPropertyID + ` as interest_property_id,
		l.first_response_at,
		l.first_response_seconds,
		l.first_response_is_automation`
}

func pipelineBoardVisiblePropertyIDSQL(column string, propertyVisibility string) string {
	return `(select visible_property.id::text
		from public.properties visible_property
		where visible_property.organization_id = l.organization_id
		  and visible_property.id = l.` + column + `
		  and ` + propertyVisibility + `
		limit 1)`
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
	var phone, email, source, stageID, assignedUserID, pipelineID, message, organizationID pgtype.Text
	var lastEntryAt, stageEnteredAt, boardOrderAt, wonAt, lostAt, firstResponseAt pgtype.Timestamptz
	var whatsappAvatarURL, dealStatus, propertyID, lostReason, interestPropertyID pgtype.Text
	var interestValue pgtype.Float8
	var firstResponseSeconds pgtype.Int4
	var firstResponseIsAutomation pgtype.Bool

	dest := []any{
		&lead.ID,
		&lead.Name,
		&phone,
		&email,
		&source,
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
		&dealStatus,
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
	lead.Source = textValueWithDefault(source, "manual")
	lead.StageID = pipelineTextPtr(stageID)
	lead.AssignedUserID = pipelineTextPtr(assignedUserID)
	lead.PipelineID = pipelineTextPtr(pipelineID)
	lead.Message = pipelineTextPtr(message)
	lead.OrganizationID = textValue(organizationID)
	lead.StageEnteredAt = pipelineTimePtr(stageEnteredAt)
	lead.BoardOrderAt = pipelineTimePtr(boardOrderAt)
	lead.LastEntryAt = pipelineTimePtr(lastEntryAt)
	lead.WhatsAppAvatarURL = pipelineTextPtr(whatsappAvatarURL)
	lead.DealStatus = textValueWithDefault(dealStatus, "open")
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
