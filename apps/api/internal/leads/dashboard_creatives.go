package leads

import (
	"context"
	"net/url"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// DashboardCreativePoint ranks a recorded Meta creative, or an ad when the
// creative ID was unavailable at intake. URLs come from the recorded arrival.
type DashboardCreativePoint struct {
	Key              string  `json:"key"`
	AttributionLevel string  `json:"attributionLevel"`
	CreativeID       *string `json:"creativeId"`
	AdID             *string `json:"adId"`
	Name             string  `json:"name"`
	CampaignName     *string `json:"campaignName"`
	CampaignCount    int64   `json:"campaignCount"`
	LeadCount        int64   `json:"leadCount"`
	EntryCount       int64   `json:"entryCount"`
	ThumbnailURL     *string `json:"thumbnailUrl"`
	ImageURL         *string `json:"imageUrl"`
	VideoURL         *string `json:"videoUrl"`
	InstagramURL     *string `json:"instagramUrl"`
	PermalinkURL     *string `json:"permalinkUrl"`
	IsVideo          bool    `json:"isVideo"`
}

type DashboardCreatives struct {
	Creatives []DashboardCreativePoint `json:"creatives"`
}

func (repo Repository) GetDashboardCreatives(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) (DashboardCreatives, error) {
	result := DashboardCreatives{Creatives: []DashboardCreativePoint{}}
	query, args, err := repo.buildDashboardCreativesQuery(tenantContext, filter)
	if err != nil {
		return result, err
	}
	rows, err := repo.db.Pool().Query(ctx, query, args...)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var point DashboardCreativePoint
		var creativeID, adID, campaignName, thumbnailURL, imageURL, videoURL, instagramURL, permalinkURL pgtype.Text
		if err := rows.Scan(&point.Key, &creativeID, &adID, &point.Name, &campaignName,
			&point.CampaignCount, &point.LeadCount, &point.EntryCount, &thumbnailURL, &imageURL,
			&videoURL, &instagramURL, &permalinkURL, &point.IsVideo); err != nil {
			return result, err
		}
		point.CreativeID = pipelineTextPtr(creativeID)
		point.AdID = pipelineTextPtr(adID)
		point.CampaignName = pipelineTextPtr(campaignName)
		point.ThumbnailURL = dashboardBestThumbnailURL(pipelineTextPtr(thumbnailURL), pipelineTextPtr(imageURL))
		point.ImageURL = dashboardSafeCreativeURL(pipelineTextPtr(imageURL))
		point.VideoURL = dashboardSafeCreativeURL(pipelineTextPtr(videoURL))
		point.InstagramURL = dashboardSafeCreativeURL(pipelineTextPtr(instagramURL))
		point.PermalinkURL = dashboardSafeCreativeURL(pipelineTextPtr(permalinkURL))
		point.AttributionLevel = "ad"
		if point.CreativeID != nil {
			point.AttributionLevel = "creative"
		}
		result.Creatives = append(result.Creatives, point)
	}
	return result, rows.Err()
}

// Reject local/relative URLs, script schemes, credentials and oversized
// provider values before returning links or media URLs to the browser.
func dashboardSafeCreativeURL(raw *string) *string {
	if raw == nil {
		return nil
	}
	value := strings.TrimSpace(*raw)
	if len(value) == 0 || len(value) > 4096 {
		return nil
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
		return nil
	}
	return &value
}

func dashboardSafeThumbnailURL(raw *string) *string {
	return dashboardSafeCreativeURL(raw)
}

func dashboardBestThumbnailURL(values ...*string) *string {
	for _, value := range values {
		if safe := dashboardSafeThumbnailURL(value); safe != nil {
			return safe
		}
	}
	return nil
}

func (repo Repository) buildDashboardCreativesQuery(tenantContext tenant.Context, filter DashboardFilter) (string, []any, error) {
	cte, entryWhere, args, err := repo.buildDashboardEntriesCTE(tenantContext, filter)
	if err != nil {
		return "", nil, err
	}
	// Aggregate every filtered arrival before LIMIT 10. The lateral lookup then
	// selects one coherent, preferably previewable media snapshot for each winner.
	// The title is grouped separately so a previewable event without a name does
	// not force an internal ID into the display label.
	// Campaign identity matches the campaigns chart: ID first, then name/UTM.
	query := cte + `,
		creative_entries as (
			select entry.entry_id, entry.lead_id, entry.occurred_at,
				case when entry.creative_id is not null then 'creative:' || entry.creative_id
					else 'ad:' || entry.ad_id end as creative_key,
				entry.creative_id, entry.creative_name, entry.creative_type,
				entry.creative_thumbnail_url, entry.creative_url, entry.creative_video_url,
				entry.creative_instagram_url, entry.creative_permalink_url,
				case
					when entry.creative_thumbnail_url ~* '^https://[a-z0-9][a-z0-9.-]*(:[0-9]{1,5})?([/?#]|$)'
						then entry.creative_thumbnail_url
					when entry.creative_url ~* '^https://[a-z0-9][a-z0-9.-]*(:[0-9]{1,5})?([/?#]|$)'
						then entry.creative_url
				end as preview_url,
				entry.ad_id, entry.ad_name,
				entry.campaign_id, entry.campaign_name, entry.utm_campaign,
				case when entry.campaign_id is not null then 'id:' || entry.campaign_id
					when coalesce(entry.campaign_name, entry.utm_campaign) is not null
					then 'text:' || coalesce(entry.campaign_name, entry.utm_campaign) end as campaign_key
			from entries entry
			where ` + entryWhere + `
			  and (lower(entry.provider) = 'meta'
			       or (lower(entry.meta_source_type) = 'meta_lead_ads' and entry.meta_leadgen_id is not null))
			  and (entry.creative_id is not null or entry.ad_id is not null)
		), creative_groups as (
			select creative_key, max(creative_id) as creative_id,
				case when count(distinct ad_id) = 1 then max(ad_id) end as ad_id,
				max(creative_name) as creative_name, max(ad_name) as ad_name,
				count(distinct campaign_key)::bigint as campaign_count,
				coalesce(max(campaign_name), max(utm_campaign)) as campaign_name,
				count(distinct lead_id)::bigint as lead_count,
				count(*)::bigint as entry_count
			from creative_entries
			group by creative_key
		), top_creatives as (
			select * from creative_groups
			order by lead_count desc, entry_count desc, creative_key
			limit 10
		)
		select ranked.creative_key, ranked.creative_id, ranked.ad_id,
			case when ranked.creative_id is null
				then coalesce(ranked.ad_name, ranked.creative_name, 'Anúncio sem título')
				else coalesce(ranked.creative_name, ranked.ad_name, 'Criativo sem título') end as name,
			ranked.campaign_name, ranked.campaign_count, ranked.lead_count, ranked.entry_count,
			snapshot.creative_thumbnail_url as thumbnail_url, snapshot.creative_url as image_url,
			snapshot.creative_video_url as video_url,
			snapshot.creative_instagram_url as instagram_url,
			snapshot.creative_permalink_url as permalink_url,
			(lower(coalesce(snapshot.creative_type, '')) like '%video%' or snapshot.creative_video_url is not null) as is_video
		from top_creatives ranked
		left join lateral (
			select creative_type, creative_thumbnail_url, creative_url, creative_video_url,
				creative_instagram_url, creative_permalink_url
			from creative_entries candidate
			where candidate.creative_key = ranked.creative_key
			order by (candidate.preview_url is not null) desc,
				(candidate.creative_video_url is not null or candidate.creative_permalink_url is not null or candidate.creative_instagram_url is not null) desc,
				candidate.occurred_at desc, candidate.entry_id desc
			limit 1
		) snapshot on true
		order by ranked.lead_count desc, ranked.entry_count desc, ranked.creative_key
	`
	return query, args, nil
}
