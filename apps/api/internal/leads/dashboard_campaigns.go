package leads

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// GetDashboardCampaigns counts distinct visible leads for each campaign that
// received an arrival in the selected period. Entries are also returned so
// repeated arrivals can be distinguished from unique leads.
func (repo Repository) GetDashboardCampaigns(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) (DashboardCampaigns, error) {
	result := DashboardCampaigns{Campaigns: []DashboardCampaignPoint{}}
	query, args, err := repo.buildDashboardCampaignsQuery(tenantContext, filter)
	if err != nil {
		return result, err
	}

	rows, err := repo.db.Pool().Query(ctx, query, args...)
	if err != nil {
		return result, err
	}
	defer rows.Close()

	for rows.Next() {
		var key, campaignID pgtype.Text
		var name string
		var leadCount, entryCount int64
		if err := rows.Scan(&key, &campaignID, &name, &leadCount, &entryCount); err != nil {
			return result, err
		}
		if !key.Valid {
			result.Unattributed = DashboardCampaignCount{LeadCount: leadCount, EntryCount: entryCount}
			continue
		}
		result.Campaigns = append(result.Campaigns, DashboardCampaignPoint{
			Key: key.String, CampaignID: pipelineTextPtr(campaignID), Name: name,
			LeadCount: leadCount, EntryCount: entryCount,
		})
	}
	return result, rows.Err()
}

func (repo Repository) buildDashboardCampaignsQuery(tenantContext tenant.Context, filter DashboardFilter) (string, []any, error) {
	cte, entryWhere, args, err := repo.buildDashboardEntriesCTE(tenantContext, filter)
	if err != nil {
		return "", nil, err
	}
	// A campaign ID is authoritative. Without one, names and UTM campaign
	// values share a text key, matching the dashboard filter's fallback.
	// If an ID has several recorded names, max() picks a stable label without
	// an additional per-entry sort; it is not necessarily the newest name.
	// The missing-attribution group is returned separately from campaign bars.
	query := cte + `,
		campaign_entries as (
			select entry.lead_id,
				nullif(btrim(entry.campaign_id), '') as campaign_id,
				nullif(btrim(entry.campaign_name), '') as campaign_name,
				nullif(btrim(entry.utm_campaign), '') as utm_campaign
			from entries entry
			where ` + entryWhere + `
		), campaign_groups as (
			select
				case
					when campaign_id is not null then 'id:' || campaign_id
					when coalesce(campaign_name, utm_campaign) is not null
						then 'text:' || coalesce(campaign_name, utm_campaign)
				end as campaign_key,
				max(campaign_id) as campaign_id,
				coalesce(max(campaign_name), max(utm_campaign), max(campaign_id), '') as name,
				count(distinct lead_id)::bigint as lead_count,
				count(*)::bigint as entry_count
			from campaign_entries
			group by 1
		)
		select campaign_key, campaign_id, name, lead_count, entry_count
		from campaign_groups
		order by campaign_key is null, lead_count desc, lower(name), campaign_key
	`
	return query, args, nil
}
