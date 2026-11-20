package leads

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func dashboardHasEntryAttributionFilter(filter DashboardFilter) bool {
	return normalizedLeadAttributionValue(filter.Source) != "" ||
		normalizedLeadAttributionValue(filter.PageID) != "" ||
		len(normalizedLeadAttributionValues(filter.CampaignID, filter.CampaignIDs)) > 0 ||
		normalizedLeadAttributionValue(filter.AdSetID) != "" ||
		normalizedLeadAttributionValue(filter.AdID) != ""
}

// Card metrics count each visible card once if any matching CRM arrival exists.
// Keep first-contact and visit queries on their separate base predicate.
func (repo Repository) buildDashboardCardCohortWhere(tenantContext tenant.Context, filter DashboardFilter, forceStatus string) ([]string, []any, error) {
	if dashboardHasEntryAttributionFilter(filter) {
		cte, entryWhere, args, err := repo.buildDashboardEntriesCTE(tenantContext, filter)
		if err != nil {
			return nil, nil, err
		}
		where := []string{"l.organization_id = $1::uuid", "l.id in (" + cte + " select entry.lead_id from entries entry where " + entryWhere + ")"}
		if forceStatus != "" {
			args = append(args, forceStatus)
			where = append(where, fmt.Sprintf("l.deal_status = $%d", len(args)))
		}
		return where, args, nil
	}
	cardFilter := filter
	cardFilter.DateFrom, cardFilter.DateTo = nil, nil
	where, args, err := repo.buildDashboardLeadWhere(tenantContext, cardFilter, dashboardLeadWhereOptions{ForceDealStatus: forceStatus})
	if err != nil || (filter.DateFrom == nil && filter.DateTo == nil) {
		return where, args, err
	}
	initialDate, reentryDate, args := dashboardRecordingDatePredicates(filter, args)
	where = append(where, "("+initialDate+` or exists (
		select 1 from public.lead_entry_events e
		where e.organization_id = l.organization_id and e.lead_id = l.id
		  and e.entry_type = 'reentry' and e.is_countable = true
		  and `+reentryDate+"))")
	return where, args, nil
}

// Evolution assigns a card to its first matching CRM arrival, never one bucket
// per reentry. The no-attribution path avoids sorting rich initial snapshots.
func (repo Repository) buildDashboardCardCohortCTE(tenantContext tenant.Context, filter DashboardFilter) (string, []any, error) {
	if dashboardHasEntryAttributionFilter(filter) {
		cte, entryWhere, args, err := repo.buildDashboardEntriesCTE(tenantContext, filter)
		return cte + `, card_cohort as (
			select entry.lead_id, min(entry.occurred_at) as entered_at
			from entries entry where ` + entryWhere + ` group by entry.lead_id
		)`, args, err
	}
	cardFilter := filter
	cardFilter.DateFrom, cardFilter.DateTo = nil, nil
	where, args, err := repo.buildDashboardLeadWhere(tenantContext, cardFilter, dashboardLeadWhereOptions{})
	if err != nil {
		return "", nil, err
	}
	if filter.DateFrom == nil && filter.DateTo == nil {
		return "with card_cohort as (select l.id as lead_id, l.created_at as entered_at from public.leads l where " + strings.Join(where, " and ") + ")", args, nil
	}
	initialDate, reentryDate, args := dashboardRecordingDatePredicates(filter, args)
	return `with visible_cards as (
		select l.id, l.organization_id, l.created_at from public.leads l where ` + strings.Join(where, " and ") + `
	), cohort_entries as (
		select l.id as lead_id, l.created_at as entered_at from visible_cards l where ` + initialDate + `
		union all
		select l.id, e.created_at from visible_cards l
		join public.lead_entry_events e on e.organization_id = l.organization_id and e.lead_id = l.id
		where e.entry_type = 'reentry' and e.is_countable = true and ` + reentryDate + `
	), card_cohort as (
		select lead_id, min(entered_at) as entered_at from cohort_entries group by lead_id
	)`, args, nil
}

func dashboardRecordingDatePredicates(filter DashboardFilter, args []any) (string, string, []any) {
	initialDate, reentryDate := []string{"true"}, []string{"true"}
	for _, bound := range []struct {
		operator string
		value    *time.Time
	}{{">=", filter.DateFrom}, {"<=", filter.DateTo}} {
		if bound.value == nil {
			continue
		}
		args = append(args, *bound.value)
		initialDate = append(initialDate, fmt.Sprintf("l.created_at %s $%d::timestamptz", bound.operator, len(args)))
		reentryDate = append(reentryDate, fmt.Sprintf("e.created_at %s $%d::timestamptz", bound.operator, len(args)))
	}
	return strings.Join(initialDate, " and "), strings.Join(reentryDate, " and "), args
}

// dashboardEntryCounts measures arrivals, while the existing dashboard card,
// deal, funnel, and first-contact metrics continue to measure unique leads.
// One initial arrival is synthesized from each visible lead. This intentionally
// ignores duplicate historical initial events, and also covers old leads whose
// initial entry event was never recorded. Reentries come only from the
// idempotent, countable entry ledger.
type dashboardEntryCounts struct {
	UniqueLeads  int64
	Reentries    int64
	TotalEntries int64
}

func (repo Repository) dashboardEntryCounts(ctx context.Context, queryer dashboardQueryer, tenantContext tenant.Context, filter DashboardFilter) (dashboardEntryCounts, error) {
	query, args, err := repo.buildDashboardEntryCountsQuery(tenantContext, filter)
	if err != nil {
		return dashboardEntryCounts{}, err
	}
	var result dashboardEntryCounts
	err = queryer.QueryRow(ctx, query, args...).Scan(&result.UniqueLeads, &result.Reentries, &result.TotalEntries)
	if err != nil {
		return dashboardEntryCounts{}, err
	}
	return result, nil
}

func (repo Repository) buildDashboardEntryCountsQuery(tenantContext tenant.Context, filter DashboardFilter) (string, []any, error) {
	cte, entryWhere, args, err := repo.buildDashboardEntriesCTE(tenantContext, filter)
	if err != nil {
		return "", nil, err
	}
	return cte + `
		select count(*) filter (where not entry.is_reentry)::bigint,
			count(*) filter (where entry.is_reentry)::bigint,
			count(*)::bigint
		from entries entry
		where ` + entryWhere, args, nil
}

// buildDashboardEntriesCTE is shared by the aggregate and the bounded entry
// drill-down. The caller must query `entries entry` and append entryWhere.
func (repo Repository) buildDashboardEntriesCTE(tenantContext tenant.Context, filter DashboardFilter) (string, string, []any, error) {
	// Current visibility, ownership/team, pipeline, status, tags, and search
	// belong to the card. CRM recording date, source, and Meta attribution belong to each
	// arrival; applying them to leads here would discard later reentries or
	// give a reentry attribution from a different arrival.
	cardFilter := filter
	cardFilter.DateFrom, cardFilter.DateTo = nil, nil
	cardFilter.Source = ""
	cardFilter.PageID, cardFilter.CampaignID, cardFilter.CampaignIDs = "", "", nil
	cardFilter.AdSetID, cardFilter.AdID = "", ""
	cardWhere, args, err := repo.buildDashboardLeadWhere(tenantContext, cardFilter, dashboardLeadWhereOptions{})
	if err != nil {
		return "", "", nil, err
	}

	entryWhere := []string{"true"}
	add := func(clause string, value any) {
		args = append(args, value)
		entryWhere = append(entryWhere, fmt.Sprintf(clause, len(args)))
	}
	if filter.DateFrom != nil {
		add("entry.occurred_at >= $%d::timestamptz", *filter.DateFrom)
	}
	if filter.DateTo != nil {
		add("entry.occurred_at <= $%d::timestamptz", *filter.DateTo)
	}
	if value := normalizedLeadAttributionValue(filter.Source); value != "" {
		add("btrim(entry.source) = $%d", value)
	}
	if value := normalizedLeadAttributionValue(filter.PageID); value != "" {
		add("btrim(entry.page_id) = $%d", value)
	}
	campaignIDs, err := normalizeDashboardCampaignFilterIDs(filter.CampaignID, filter.CampaignIDs)
	if err != nil {
		return "", "", nil, err
	}
	if len(campaignIDs) == 1 {
		add("(btrim(entry.campaign_id) = $%[1]d or btrim(entry.campaign_name) = $%[1]d or btrim(entry.utm_campaign) = $%[1]d)", campaignIDs[0])
	} else if len(campaignIDs) > 1 {
		add("(btrim(entry.campaign_id) = any($%[1]d::text[]) or btrim(entry.campaign_name) = any($%[1]d::text[]) or btrim(entry.utm_campaign) = any($%[1]d::text[]))", campaignIDs)
	}
	if value := normalizedLeadAttributionValue(filter.AdSetID); value != "" {
		add("(btrim(entry.adset_id) = $%[1]d or btrim(entry.adset_name) = $%[1]d)", value)
	}
	if value := normalizedLeadAttributionValue(filter.AdID); value != "" {
		add("(btrim(entry.ad_id) = $%[1]d or btrim(entry.ad_name) = $%[1]d)", value)
	}

	cte := `
		with visible_cards as (
			select l.id, l.organization_id, l.created_at
			from public.leads l
			where ` + strings.Join(cardWhere, " and ") + `
		), initial_entries as (
			-- Select first-arrival facts together. A per-card lateral sort makes
			-- a broad dashboard do thousands of index probes and can trigger JIT.
			-- Non-countable initial events still participate in the first fact.
			select distinct on (e.lead_id) e.organization_id, e.lead_id,
				e.id, e.occurred_at, e.source, e.page_id, e.page_name, e.campaign_id, e.campaign_name,
				e.utm_campaign, e.adset_id, e.adset_name, e.ad_id, e.ad_name, e.provider, e.metadata
			from public.lead_entry_events e
			join visible_cards l on e.organization_id = l.organization_id and e.lead_id = l.id
			where e.entry_type = 'initial'
			order by e.lead_id, e.occurred_at, e.created_at, e.id
		), entries as (
			select coalesce(initial.id::text, 'initial:' || l.id::text) as entry_id,
				l.id as lead_id, false as is_reentry,
				l.created_at as occurred_at,
				nullif(initial.source, '') as source,
				nullif(initial.page_id, '') as page_id,
				nullif(initial.page_name, '') as page_name,
				nullif(initial.campaign_id, '') as campaign_id,
				nullif(initial.campaign_name, '') as campaign_name,
				nullif(initial.utm_campaign, '') as utm_campaign,
				nullif(initial.adset_id, '') as adset_id,
				nullif(initial.adset_name, '') as adset_name,
				nullif(initial.ad_id, '') as ad_id,
				nullif(initial.ad_name, '') as ad_name,
				nullif(btrim(initial.provider), '') as provider,
				nullif(btrim(initial.metadata->>'source_type'), '') as meta_source_type,
				nullif(btrim(initial.metadata->>'leadgen_id'), '') as meta_leadgen_id,
				nullif(btrim(initial.metadata->>'creative_id'), '') as creative_id,
				nullif(btrim(initial.metadata->>'creative_name'), '') as creative_name,
				nullif(btrim(initial.metadata->>'creative_type'), '') as creative_type,
				nullif(btrim(initial.metadata->>'creative_thumbnail_url'), '') as creative_thumbnail_url,
				nullif(btrim(initial.metadata->>'creative_url'), '') as creative_url,
				nullif(btrim(initial.metadata->>'creative_video_url'), '') as creative_video_url,
				nullif(btrim(initial.metadata->>'creative_instagram_url'), '') as creative_instagram_url,
				nullif(btrim(initial.metadata->>'creative_permalink_url'), '') as creative_permalink_url
			from visible_cards l
			-- The earliest initial event is the first-arrival fact even when a
			-- duplicate provider delivery marked it non-countable. If it is
			-- absent, attribution stays unknown: current lead and lead_meta
			-- attribution may belong to a later reentry. Dashboard dates always
			-- measure CRM recording time; provider occurred_at stays unchanged.
			left join initial_entries initial on initial.organization_id = l.organization_id and initial.lead_id = l.id
			union all
			select e.id::text as entry_id, l.id as lead_id,
				true as is_reentry, e.created_at as occurred_at,
				nullif(e.source, '') as source,
				nullif(e.page_id, '') as page_id,
				nullif(e.page_name, '') as page_name,
				nullif(e.campaign_id, '') as campaign_id,
				nullif(e.campaign_name, '') as campaign_name,
				nullif(e.utm_campaign, '') as utm_campaign,
				nullif(e.adset_id, '') as adset_id,
				nullif(e.adset_name, '') as adset_name,
				nullif(e.ad_id, '') as ad_id,
				nullif(e.ad_name, '') as ad_name,
				nullif(btrim(e.provider), '') as provider,
				nullif(btrim(e.metadata->>'source_type'), '') as meta_source_type,
				nullif(btrim(e.metadata->>'leadgen_id'), '') as meta_leadgen_id,
				nullif(btrim(e.metadata->>'creative_id'), '') as creative_id,
				nullif(btrim(e.metadata->>'creative_name'), '') as creative_name,
				nullif(btrim(e.metadata->>'creative_type'), '') as creative_type,
				nullif(btrim(e.metadata->>'creative_thumbnail_url'), '') as creative_thumbnail_url,
				nullif(btrim(e.metadata->>'creative_url'), '') as creative_url,
				nullif(btrim(e.metadata->>'creative_video_url'), '') as creative_video_url,
				nullif(btrim(e.metadata->>'creative_instagram_url'), '') as creative_instagram_url,
				nullif(btrim(e.metadata->>'creative_permalink_url'), '') as creative_permalink_url
			from visible_cards l
			join public.lead_entry_events e
			  on e.organization_id = l.organization_id and e.lead_id = l.id
			 and e.entry_type = 'reentry' and e.is_countable = true
		)
	`
	return cte, strings.Join(entryWhere, " and "), args, nil
}
