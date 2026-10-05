package leads

import (
	"context"
	"fmt"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

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
	// belong to the card. Date, source, and Meta attribution belong to each
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
		), entries as (
			select coalesce(initial.id::text, 'initial:' || l.id::text) as entry_id,
				l.id as lead_id, false as is_reentry,
				coalesce(initial.occurred_at, l.created_at) as occurred_at,
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
			-- absent, only the card creation time is safe to synthesize: current
			-- lead and lead_meta attribution may belong to a later reentry.
			left join lateral (
				select e.id, e.occurred_at, e.source, e.page_id, e.page_name, e.campaign_id, e.campaign_name,
					e.utm_campaign, e.adset_id, e.adset_name, e.ad_id, e.ad_name, e.provider, e.metadata
				from public.lead_entry_events e
				where e.organization_id = l.organization_id
				  and e.lead_id = l.id
				  and e.entry_type = 'initial'
				order by e.occurred_at, e.created_at, e.id
				limit 1
			) initial on true
			union all
			select e.id::text as entry_id, l.id as lead_id,
				true as is_reentry, e.occurred_at,
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
