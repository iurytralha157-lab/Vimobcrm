package leads

import (
	"context"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// ListDashboardEntryFilterOptions keeps the existing lead-meta-filters response
// shape while deriving values from the same visible, dated arrivals as the
// dashboard's entry KPI. Only the selected page narrows its descendant options.
func (repo Repository) ListDashboardEntryFilterOptions(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) (LeadMetaFilters, error) {
	query, args, err := repo.buildDashboardEntryFilterOptionsQuery(tenantContext, filter)
	if err != nil {
		return LeadMetaFilters{}, err
	}
	rows, err := repo.db.Pool().Query(ctx, query, args...)
	if err != nil {
		return LeadMetaFilters{}, err
	}
	defer rows.Close()

	result := LeadMetaFilters{
		Sources: []string{}, Pages: []LeadMetaPageOption{},
		Campaigns: []LeadMetaCampaignOption{}, Adsets: []LeadMetaAdsetOption{}, Ads: []LeadMetaAdOption{},
	}
	sources := map[string]struct{}{}
	pages := map[string]LeadMetaPageOption{}
	campaigns := map[string]LeadMetaCampaignOption{}
	adsets := map[string]LeadMetaAdsetOption{}
	ads := map[string]LeadMetaAdOption{}
	selectedPageID := normalizedLeadAttributionValue(filter.PageID)

	for rows.Next() {
		var source, pageID, pageName, campaignID, campaignName, utmCampaign pgtype.Text
		var adsetID, adsetName, adID, adName pgtype.Text
		if err := rows.Scan(&source, &pageID, &pageName, &campaignID, &campaignName, &utmCampaign, &adsetID, &adsetName, &adID, &adName); err != nil {
			return LeadMetaFilters{}, err
		}
		collectDashboardEntryOptionRow(
			dashboardEntryOptionRow{
				Source: textValue(source), PageID: textValue(pageID), PageName: textValue(pageName),
				CampaignID: textValue(campaignID), CampaignName: textValue(campaignName), UTMCampaign: textValue(utmCampaign),
				AdsetID: textValue(adsetID), AdsetName: textValue(adsetName), AdID: textValue(adID), AdName: textValue(adName),
			}, selectedPageID, sources, pages, campaigns, adsets, ads,
		)
	}
	if err := rows.Err(); err != nil {
		return LeadMetaFilters{}, err
	}
	for source := range sources {
		result.Sources = append(result.Sources, source)
	}
	for _, page := range pages {
		result.Pages = append(result.Pages, page)
	}
	for _, campaign := range campaigns {
		result.Campaigns = append(result.Campaigns, campaign)
	}
	for _, adset := range adsets {
		result.Adsets = append(result.Adsets, adset)
	}
	for _, ad := range ads {
		result.Ads = append(result.Ads, ad)
	}
	sort.Strings(result.Sources)
	sortLeadMetaOptions(&result)
	return result, nil
}

type dashboardEntryOptionRow struct {
	Source, PageID, PageName              string
	CampaignID, CampaignName, UTMCampaign string
	AdsetID, AdsetName, AdID, AdName      string
}

func collectDashboardEntryOptionRow(
	row dashboardEntryOptionRow, selectedPageID string,
	sources map[string]struct{}, pages map[string]LeadMetaPageOption,
	campaigns map[string]LeadMetaCampaignOption,
	adsets map[string]LeadMetaAdsetOption, ads map[string]LeadMetaAdOption,
) {
	if value := strings.TrimSpace(row.Source); value != "" {
		sources[value] = struct{}{}
	}
	pageKey := strings.TrimSpace(row.PageID)
	if pageKey != "" {
		name := firstNonEmpty(row.PageName, pageKey)
		current, exists := pages[pageKey]
		if !exists || current.Name == pageKey || (name != pageKey && name < current.Name) {
			collectLeadMetaPageOption(pages, name, pageKey)
		}
	}
	if selectedPageID != "" && pageKey != selectedPageID {
		return
	}
	campaignKey := firstNonEmpty(row.CampaignID, row.CampaignName, row.UTMCampaign)
	collectLeadMetaFilterOptions(
		campaigns, adsets, ads,
		firstNonEmpty(row.CampaignName, row.UTMCampaign, campaignKey), row.CampaignID,
		firstNonEmpty(row.AdsetName, row.AdsetID), row.AdsetID,
		firstNonEmpty(row.AdName, row.AdID), row.AdID,
	)
}

func (repo Repository) buildDashboardEntryFilterOptionsQuery(tenantContext tenant.Context, filter DashboardFilter) (string, []any, error) {
	// Source and Meta selections are entry predicates. Clearing them here keeps
	// the list of possible options stable while the date and current card scope
	// still exactly match the KPI. Page is applied to descendants after scanning.
	optionsFilter := filter
	optionsFilter.Source, optionsFilter.PageID = "", ""
	optionsFilter.CampaignID, optionsFilter.CampaignIDs = "", nil
	optionsFilter.AdSetID, optionsFilter.AdID = "", ""
	cte, entryWhere, args, err := repo.buildDashboardEntriesCTE(tenantContext, optionsFilter)
	if err != nil {
		return "", nil, err
	}
	query := cte + `,
		entry_options as materialized (
			select distinct
				nullif(btrim(entry.source), '') as source,
				nullif(btrim(entry.page_id), '') as page_id,
				nullif(btrim(entry.page_name), '') as page_name,
				nullif(btrim(entry.campaign_id), '') as campaign_id,
				nullif(btrim(entry.campaign_name), '') as campaign_name,
				nullif(btrim(entry.utm_campaign), '') as utm_campaign,
				nullif(btrim(entry.adset_id), '') as adset_id,
				nullif(btrim(entry.adset_name), '') as adset_name,
				nullif(btrim(entry.ad_id), '') as ad_id,
				nullif(btrim(entry.ad_name), '') as ad_name
			from entries entry
			where ` + entryWhere + `
		)
		select entry.source, entry.page_id,
			coalesce(catalog.page_name, entry.page_name, entry.page_id) as page_name,
			entry.campaign_id, entry.campaign_name, entry.utm_campaign,
			entry.adset_id, entry.adset_name, entry.ad_id, entry.ad_name
		from entry_options entry
		left join lateral (
			select max(nullif(btrim(integration.page_name), '')) as page_name
			from public.meta_integrations integration
			where integration.organization_id = $1::uuid
			  and integration.page_id = entry.page_id
		) catalog on true`
	return query, args, nil
}
