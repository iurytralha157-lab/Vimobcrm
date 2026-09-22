package analytics

import (
	"context"
	"net/url"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) MetaInsights(ctx context.Context, tenantContext tenant.Context, values url.Values) ([]map[string]any, error) {
	return repo.queryJSONRows(ctx, `
		select to_jsonb(mi)
		from public.meta_campaign_insights mi
		where mi.organization_id = $1::uuid
		  and ($2 = '' or mi.date_start >= nullif($2, '')::date)
		  and ($3 = '' or mi.date_stop <= nullif($3, '')::date)
		  and ($4 = '' or mi.campaign_id = $4)
		  and ($5 = '' or mi.adset_id = $5)
		  and ($6 = '' or mi.ad_id = $6)
		order by mi.date_start desc
		limit 2000
	`, tenantContext.OrganizationID, dateOnly(values, "dateFrom"), dateOnly(values, "dateTo"), values.Get("campaignId"), values.Get("adSetId"), values.Get("adId"))
}

func (repo Repository) CampaignInsights(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
	if err := validateCampaignInsightsValues(values); err != nil {
		return nil, err
	}
	tagIDs, err := normalizeCampaignInsightTagIDs(values.Get("tagIds"))
	if err != nil {
		return nil, err
	}
	if tagIDs == "" {
		tagIDs, err = normalizeCampaignInsightTagIDs(values.Get("tagId"))
		if err != nil {
			return nil, err
		}
	}

	return repo.queryJSONObject(ctx, `
		with params as (
			select
				nullif($2, '')::date as date_from,
				nullif($3, '')::date as date_to,
				nullif($4, '') as campaign_id,
				nullif($5, '') as adset_id,
				nullif($6, '') as ad_id,
				nullif($7, '')::uuid as team_id,
				nullif($8, '')::uuid as user_id,
				lower(nullif($9, '')) as source,
				case
					when nullif($10, '') is null then null::uuid[]
					else string_to_array($10, ',')::uuid[]
				end as tag_ids,
				nullif($11, '') as deal_status,
				nullif($12, '') as account_id,
				nullif($13, '') as objective,
				nullif($14, '') as page_id,
				(
					nullif($14, '') is not null
					or
					nullif($7, '') is not null
					or nullif($8, '') is not null
					or nullif($10, '') is not null
					or nullif($11, '') is not null
				) as has_crm_scope_filter
		),
		report_settings as (
			select coalesce(
				(
					select nullif(btrim(settings.timezone), '')
					from public.organization_attention_settings as settings
					where settings.organization_id = $1::uuid
				),
				'America/Sao_Paulo'
			) as timezone_name
		),
		time_bounds as (
			select
				case
					when params.date_from is null then null
					else params.date_from::timestamp at time zone report_settings.timezone_name
				end as starts_at,
				case
					when params.date_to is null then null
					else (params.date_to + 1)::timestamp at time zone report_settings.timezone_name
				end as ends_at,
				report_settings.timezone_name
			from params
			cross join report_settings
		),
		paid as (
			select metric.*
			from public.marketing_performance_daily as metric
			cross join params
			where metric.organization_id = $1::uuid
			  and metric.provider = 'meta'
			  and (params.date_from is null or metric.metric_date >= params.date_from)
			  and (params.date_to is null or metric.metric_date <= params.date_to)
			  and (params.account_id is null or metric.external_account_id = params.account_id)
			  and (params.objective is null or metric.objective = params.objective)
			  and (params.campaign_id is null or metric.campaign_id = params.campaign_id)
			  and (
			    params.page_id is null
			    or (
			      metric.level = 'ad'
			      and metric.raw_actions->>'vimob_page_id' = params.page_id
			    )
			  )
			  and (
			    params.source is null
			    or params.source in ('meta', 'meta_ads', 'facebook', 'instagram')
			  )
		),
		paid_campaigns as (
			select
				campaign_id,
				max(campaign_name) as campaign_name,
				sum(spend) as spend,
				sum(impressions) as impressions,
				sum(reach) as reach,
				sum(clicks) as clicks,
				sum(link_clicks) as link_clicks,
				sum(leads_reported) as leads_reported,
				sum(conversations_reported) as conversations_reported,
				sum(conversions_reported) as conversions_reported,
				case when sum(impressions) > 0 then sum(clicks)::numeric * 100 / sum(impressions) else null end as ctr,
				case when sum(clicks) > 0 then sum(spend) / sum(clicks) else null end as cpc,
				case when sum(impressions) > 0 then sum(spend) * 1000 / sum(impressions) else null end as cpm,
				case when sum(leads_reported) > 0 then sum(spend) / sum(leads_reported) else null end as reported_cpl,
				case when sum(reach) > 0 then sum(impressions)::numeric / sum(reach) else null end as frequency,
				case
					when sum(impressions) > 0
						then sum(video_three_second_views)::numeric * 100 / sum(impressions)
					else null
				end as hook_rate,
				max(status) as status,
				max(budget) as budget,
				max(budget_type) as budget_type,
				max(objective) as objective,
				max(currency) as currency,
				max(fetched_at) as fetched_at
			from paid
			cross join (
				select adset_id as selected_adset_id, ad_id as selected_ad_id
				from params
			) as scope
			where campaign_id is not null
			  and (
			    (
			      scope.selected_ad_id is not null
			      and level = 'ad'
			      and ad_id = scope.selected_ad_id
			      and (scope.selected_adset_id is null or adset_id = scope.selected_adset_id)
			    )
			    or (
			      scope.selected_ad_id is null
			      and scope.selected_adset_id is not null
			      and adset_id = scope.selected_adset_id
			      and (
			        level = 'adset'
			        or (
			          level = 'ad'
			          and not exists (
			            select 1
			            from paid as preferred_adset
			            where preferred_adset.level = 'adset'
			              and preferred_adset.external_account_id = paid.external_account_id
			              and preferred_adset.metric_date = paid.metric_date
			              and preferred_adset.adset_id = paid.adset_id
			          )
			        )
			      )
			    )
			    or (
			      scope.selected_ad_id is null
			      and scope.selected_adset_id is null
			      and (
			        level = 'campaign'
			        or (
			          level = 'adset'
			          and not exists (
			            select 1
			            from paid as preferred_campaign
			            where preferred_campaign.level = 'campaign'
			              and preferred_campaign.external_account_id = paid.external_account_id
			              and preferred_campaign.metric_date = paid.metric_date
			              and preferred_campaign.campaign_id = paid.campaign_id
			          )
			        )
			        or (
			          level = 'ad'
			          and not exists (
			            select 1
			            from paid as preferred_campaign
			            where preferred_campaign.level = 'campaign'
			              and preferred_campaign.external_account_id = paid.external_account_id
			              and preferred_campaign.metric_date = paid.metric_date
			              and preferred_campaign.campaign_id = paid.campaign_id
			          )
			          and not exists (
			            select 1
			            from paid as preferred_adset
			            where preferred_adset.level = 'adset'
			              and preferred_adset.external_account_id = paid.external_account_id
			              and preferred_adset.metric_date = paid.metric_date
			              and preferred_adset.adset_id = paid.adset_id
			          )
			        )
			      )
			    )
			  )
			group by campaign_id
		),
		paid_adsets as (
			select
				campaign_id,
				adset_id,
				max(adset_name) as adset_name,
				sum(spend) as spend,
				sum(impressions) as impressions,
				sum(reach) as reach,
				sum(clicks) as clicks,
				sum(link_clicks) as link_clicks,
				sum(leads_reported) as leads_reported,
				sum(conversations_reported) as conversations_reported,
				case when sum(impressions) > 0 then sum(clicks)::numeric * 100 / sum(impressions) else null end as ctr,
				case when sum(clicks) > 0 then sum(spend) / sum(clicks) else null end as cpc,
				case when sum(leads_reported) > 0 then sum(spend) / sum(leads_reported) else null end as reported_cpl,
				case
					when sum(impressions) > 0
						then sum(video_three_second_views)::numeric * 100 / sum(impressions)
					else null
				end as hook_rate,
				max(status) as status,
				max(budget) as budget,
				max(budget_type) as budget_type,
				max(optimization_goal) as optimization_goal,
				max(currency) as currency
			from paid
			cross join (
				select adset_id as selected_adset_id, ad_id as selected_ad_id
				from params
			) as scope
			where adset_id is not null
			  and (
			    (
			      scope.selected_ad_id is not null
			      and level = 'ad'
			      and ad_id = scope.selected_ad_id
			    )
			    or (
			      scope.selected_ad_id is null
			      and (scope.selected_adset_id is null or adset_id = scope.selected_adset_id)
			      and (
			        level = 'adset'
			        or (
			          level = 'ad'
			          and not exists (
			            select 1
			            from paid as preferred_adset
			            where preferred_adset.level = 'adset'
			              and preferred_adset.external_account_id = paid.external_account_id
			              and preferred_adset.metric_date = paid.metric_date
			              and preferred_adset.adset_id = paid.adset_id
			          )
			        )
			      )
			    )
			  )
			group by campaign_id, adset_id
		),
		paid_ads as (
			select
				campaign_id,
				max(campaign_name) as campaign_name,
				adset_id,
				max(adset_name) as adset_name,
				ad_id,
				max(ad_name) as ad_name,
				sum(spend) as spend,
				sum(impressions) as impressions,
				sum(reach) as reach,
				sum(clicks) as clicks,
				sum(link_clicks) as link_clicks,
				sum(leads_reported) as leads_reported,
				sum(conversations_reported) as conversations_reported,
				sum(conversions_reported) as conversions_reported,
				case when sum(impressions) > 0 then sum(clicks)::numeric * 100 / sum(impressions) else null end as ctr,
				case when sum(clicks) > 0 then sum(spend) / sum(clicks) else null end as cpc,
				case when sum(leads_reported) > 0 then sum(spend) / sum(leads_reported) else null end as reported_cpl,
				case
					when sum(impressions) > 0
						then sum(video_three_second_views)::numeric * 100 / sum(impressions)
					else null
				end as hook_rate,
				max(status) as status,
				max(creative_id) as creative_id,
				max(creative_url) as creative_url,
				max(creative_video_url) as creative_video_url,
				max(creative_permalink_url) as creative_permalink_url,
				max(thumbnail_url) as thumbnail_url,
				max(currency) as currency
			from paid
			cross join (
				select adset_id as selected_adset_id, ad_id as selected_ad_id
				from params
			) as scope
			where level = 'ad'
			  and ad_id is not null
			  and (scope.selected_adset_id is null or adset_id = scope.selected_adset_id)
			  and (scope.selected_ad_id is null or ad_id = scope.selected_ad_id)
			group by campaign_id, adset_id, ad_id
		),
		entry_candidates as (
			select
				entry.id,
				entry.lead_id,
				entry.occurred_at,
				entry.created_at,
				lower(nullif(entry.provider, '')) as provider,
				lower(nullif(entry.source, '')) as source,
				nullif(entry.campaign_id, '') as campaign_id,
				nullif(entry.campaign_name, '') as campaign_name,
				nullif(entry.adset_id, '') as adset_id,
				nullif(entry.adset_name, '') as adset_name,
				nullif(entry.ad_id, '') as ad_id,
				nullif(entry.ad_name, '') as ad_name,
				nullif(entry.page_id, '') as page_id
			from public.lead_entry_events as entry
			cross join time_bounds
			where entry.organization_id = $1::uuid
			  and coalesce(entry.is_countable, true) = true
			  and (
			    lower(coalesce(entry.provider, '')) = 'meta'
			    or lower(coalesce(entry.source, '')) in ('meta', 'meta_ads', 'facebook', 'instagram')
			  )
			  and (time_bounds.starts_at is null or entry.occurred_at >= time_bounds.starts_at)
			  and (time_bounds.ends_at is null or entry.occurred_at < time_bounds.ends_at)
		),
		attributed_entries as (
			-- Establish the canonical last Meta touch before applying any
			-- dimension or CRM filter. Filtering earlier would resurrect an
			-- older campaign touch when a lead later touched another campaign.
			select distinct on (candidate.lead_id)
				candidate.*
			from entry_candidates as candidate
			order by
				candidate.lead_id,
				candidate.occurred_at desc,
				candidate.created_at desc,
				candidate.id desc
		),
		filtered_attributions as (
			select attribution.*
			from attributed_entries as attribution
			join public.leads as lead
			  on lead.id = attribution.lead_id
			 and lead.organization_id = $1::uuid
			cross join params
			where (
			    params.page_id is null
			    or attribution.page_id = params.page_id
			  )
			  and (
			    params.campaign_id is null
			    or attribution.campaign_id = params.campaign_id
			  )
			  and (
			    params.adset_id is null
			    or attribution.adset_id = params.adset_id
			  )
			  and (
			    params.ad_id is null
			    or attribution.ad_id = params.ad_id
			  )
			  and (
			    (params.account_id is null and params.objective is null)
			    or exists (
			      select 1
			      from paid as matching_paid_campaign
			      where matching_paid_campaign.campaign_id = attribution.campaign_id
			    )
			  )
			  and (params.team_id is null or lead.team_id = params.team_id)
			  and (params.user_id is null or lead.assigned_user_id = params.user_id)
			  and (
			    params.source is null
			    or params.source in ('meta', 'meta_ads', 'facebook', 'instagram')
			  )
			  and (params.deal_status is null or lead.deal_status = params.deal_status)
			  and (
			    params.tag_ids is null
			    or exists (
			      select 1
			      from public.lead_tags as lead_tag
			      where lead_tag.organization_id = $1::uuid
			        and lead_tag.lead_id = lead.id
			        and lead_tag.tag_id = any(params.tag_ids)
			    )
			  )
		),
		outcomes as (
			select
				attribution.*,
				exists (
					select 1
					from public.lead_action_facts as fact
					where fact.organization_id = $1::uuid
					  and fact.lead_id = attribution.lead_id
					  and fact.qualifies_first_outreach = true
					  and fact.is_automated = false
					  and fact.occurred_at >= attribution.occurred_at
					  and (
					    time_bounds.ends_at is null
					    or fact.occurred_at < time_bounds.ends_at
					  )
				) as contacted,
				exists (
					select 1
					from public.lead_action_facts as fact
					where fact.organization_id = $1::uuid
					  and fact.lead_id = attribution.lead_id
					  and fact.is_inbound = true
					  and fact.is_effective_contact = true
					  and fact.occurred_at >= attribution.occurred_at
					  and (
					    time_bounds.ends_at is null
					    or fact.occurred_at < time_bounds.ends_at
					  )
				) as responded,
				exists (
					select 1
					from public.lead_funnel_events as funnel
					where funnel.organization_id = $1::uuid
					  and funnel.lead_entry_event_id = attribution.id
					  and funnel.event_kind = 'qualified'
					  and funnel.occurred_at >= attribution.occurred_at
					  and (
					    time_bounds.ends_at is null
					    or funnel.occurred_at < time_bounds.ends_at
					  )
				) as qualified,
				exists (
					select 1
					from public.lead_funnel_events as funnel
					where funnel.organization_id = $1::uuid
					  and funnel.lead_entry_event_id = attribution.id
					  and funnel.event_kind = 'converted'
					  and funnel.occurred_at >= attribution.occurred_at
					  and (
					    time_bounds.ends_at is null
					    or funnel.occurred_at < time_bounds.ends_at
					  )
				) as won,
				(
					lead.deal_status = 'lost'
					and lead.lost_at is not null
					and lead.lost_at >= attribution.occurred_at
					and (
						time_bounds.ends_at is null
						or lead.lost_at < time_bounds.ends_at
					)
				) as lost,
				not exists (
					select 1
					from public.lead_funnel_events as funnel
					where funnel.organization_id = $1::uuid
					  and funnel.lead_entry_event_id = attribution.id
					  and funnel.event_kind = 'converted'
					  and funnel.occurred_at >= attribution.occurred_at
					  and (
					    time_bounds.ends_at is null
					    or funnel.occurred_at < time_bounds.ends_at
					  )
				)
				and not (
					lead.deal_status = 'lost'
					and lead.lost_at is not null
					and lead.lost_at >= attribution.occurred_at
					and (
						time_bounds.ends_at is null
						or lead.lost_at < time_bounds.ends_at
					)
				) as open,
				coalesce((
					select case
						when jsonb_typeof(funnel.metadata->'value_snapshot') = 'number'
							then (funnel.metadata->>'value_snapshot')::numeric
						else 0
					end
					from public.lead_funnel_events as funnel
					where funnel.organization_id = $1::uuid
					  and funnel.lead_entry_event_id = attribution.id
					  and funnel.event_kind = 'converted'
					  and funnel.occurred_at >= attribution.occurred_at
					  and (
					    time_bounds.ends_at is null
					    or funnel.occurred_at < time_bounds.ends_at
					  )
					order by funnel.occurred_at desc, funnel.id desc
					limit 1
				), 0) as revenue
			from filtered_attributions as attribution
			join public.leads as lead
			  on lead.id = attribution.lead_id
			 and lead.organization_id = $1::uuid
			cross join params
			cross join time_bounds
		),
		crm_campaigns as (
			select
				coalesce(campaign_id, 'unattributed') as campaign_id,
				max(coalesce(campaign_name, 'Sem campanha atribuida')) as campaign_name,
				count(*)::int as leads_count,
				count(*) filter (where contacted)::int as contacted_count,
				count(*) filter (where responded)::int as responded_count,
				count(*) filter (where qualified)::int as qualified_count,
				count(*) filter (where won)::int as won_count,
				count(*) filter (where lost)::int as lost_count,
				count(*) filter (where open)::int as open_count,
				coalesce(sum(revenue), 0) as revenue
			from outcomes
			group by coalesce(campaign_id, 'unattributed')
		),
		crm_adsets as (
			select
				coalesce(campaign_id, 'unattributed') as campaign_id,
				coalesce(adset_id, 'unattributed') as adset_id,
				max(coalesce(adset_name, 'Sem conjunto atribuido')) as adset_name,
				count(*)::int as leads_count,
				count(*) filter (where contacted)::int as contacted_count,
				count(*) filter (where responded)::int as responded_count,
				count(*) filter (where qualified)::int as qualified_count,
				count(*) filter (where won)::int as won_count,
				count(*) filter (where lost)::int as lost_count,
				count(*) filter (where open)::int as open_count,
				coalesce(sum(revenue), 0) as revenue
			from outcomes
			group by
				coalesce(campaign_id, 'unattributed'),
				coalesce(adset_id, 'unattributed')
		),
		crm_ads as (
			select
				coalesce(campaign_id, 'unattributed') as campaign_id,
				coalesce(adset_id, 'unattributed') as adset_id,
				coalesce(ad_id, 'unattributed') as ad_id,
				max(coalesce(ad_name, 'Sem anuncio atribuido')) as ad_name,
				count(*)::int as leads_count,
				count(*) filter (where contacted)::int as contacted_count,
				count(*) filter (where responded)::int as responded_count,
				count(*) filter (where qualified)::int as qualified_count,
				count(*) filter (where won)::int as won_count,
				count(*) filter (where lost)::int as lost_count,
				count(*) filter (where open)::int as open_count,
				coalesce(sum(revenue), 0) as revenue
			from outcomes
			group by
				coalesce(campaign_id, 'unattributed'),
				coalesce(adset_id, 'unattributed'),
				coalesce(ad_id, 'unattributed')
		),
		campaign_keys as (
			select campaign_id from paid_campaigns
			union
			select campaign_id from crm_campaigns
		),
		campaigns as (
			select
				key.campaign_id,
				coalesce(paid_campaign.campaign_name, crm_campaign.campaign_name, 'Campanha') as campaign_name,
				coalesce(paid_campaign.spend, 0) as spend,
				coalesce(paid_campaign.impressions, 0) as impressions,
				coalesce(paid_campaign.reach, 0) as reach,
				coalesce(paid_campaign.clicks, 0) as clicks,
				coalesce(paid_campaign.link_clicks, 0) as link_clicks,
				coalesce(paid_campaign.leads_reported, 0)::int as leads_reported,
				coalesce(crm_campaign.leads_count, 0)::int as leads_count,
				coalesce(crm_campaign.contacted_count, 0)::int as contacted_count,
				coalesce(crm_campaign.responded_count, 0)::int as responded_count,
				coalesce(crm_campaign.qualified_count, 0)::int as qualified_count,
				coalesce(crm_campaign.won_count, 0)::int as won_count,
				coalesce(crm_campaign.lost_count, 0)::int as lost_count,
				coalesce(crm_campaign.open_count, 0)::int as open_count,
				coalesce(crm_campaign.revenue, 0) as revenue,
				coalesce(paid_campaign.conversations_reported, 0)::int as conversations_count,
				coalesce(paid_campaign.conversions_reported, 0)::int as conversions_reported,
				case
					when not (select has_crm_scope_filter from params)
					 and coalesce(crm_campaign.leads_count, 0) > 0
						then paid_campaign.spend / crm_campaign.leads_count
					else null
				end as cpl,
				case
					when not (select has_crm_scope_filter from params)
					 and coalesce(crm_campaign.qualified_count, 0) > 0
						then paid_campaign.spend / crm_campaign.qualified_count
					else null
				end as cpql,
				case
					when not (select has_crm_scope_filter from params)
					 and coalesce(crm_campaign.won_count, 0) > 0
						then paid_campaign.spend / crm_campaign.won_count
					else null
				end as cac,
				paid_campaign.reported_cpl,
				paid_campaign.ctr,
				paid_campaign.cpc,
				paid_campaign.cpm,
				paid_campaign.frequency,
				paid_campaign.hook_rate,
				paid_campaign.status,
				paid_campaign.budget,
				paid_campaign.budget_type,
				paid_campaign.objective,
				paid_campaign.currency,
				paid_campaign.fetched_at
			from campaign_keys as key
			left join paid_campaigns as paid_campaign
			  on paid_campaign.campaign_id = key.campaign_id
			left join crm_campaigns as crm_campaign
			  on crm_campaign.campaign_id = key.campaign_id
		),
		paid_selected as (
			select metric.*
			from paid as metric
			cross join params
			where
			  (
			    params.ad_id is not null
			    and metric.level = 'ad'
			    and metric.ad_id = params.ad_id
			    and (params.adset_id is null or metric.adset_id = params.adset_id)
			  )
			  or (
			    params.ad_id is null
			    and params.adset_id is not null
			    and metric.adset_id = params.adset_id
			    and (
			      metric.level = 'adset'
			      or (
			        metric.level = 'ad'
			        and not exists (
			          select 1
			          from paid as preferred_adset
			          where preferred_adset.level = 'adset'
			            and preferred_adset.external_account_id = metric.external_account_id
			            and preferred_adset.metric_date = metric.metric_date
			            and preferred_adset.adset_id = metric.adset_id
			        )
			      )
			    )
			  )
			  or (
			    params.ad_id is null
			    and params.adset_id is null
			    and params.campaign_id is not null
			    and (
			      metric.level = 'campaign'
			      or (
			        metric.level = 'adset'
			        and not exists (
			          select 1
			          from paid as preferred_campaign
			          where preferred_campaign.level = 'campaign'
			            and preferred_campaign.external_account_id = metric.external_account_id
			            and preferred_campaign.metric_date = metric.metric_date
			            and preferred_campaign.campaign_id = metric.campaign_id
			        )
			      )
			      or (
			        metric.level = 'ad'
			        and not exists (
			          select 1
			          from paid as preferred_campaign
			          where preferred_campaign.level = 'campaign'
			            and preferred_campaign.external_account_id = metric.external_account_id
			            and preferred_campaign.metric_date = metric.metric_date
			            and preferred_campaign.campaign_id = metric.campaign_id
			        )
			        and not exists (
			          select 1
			          from paid as preferred_adset
			          where preferred_adset.level = 'adset'
			            and preferred_adset.external_account_id = metric.external_account_id
			            and preferred_adset.metric_date = metric.metric_date
			            and preferred_adset.adset_id = metric.adset_id
			        )
			      )
			    )
			  )
			  or (
			    params.ad_id is null
			    and params.adset_id is null
			    and params.campaign_id is null
			    and (
			      metric.level = 'campaign'
			      or (
			        metric.level = 'account'
			        and not exists (
			          select 1
			          from paid as campaign_metric
			          where campaign_metric.level = 'campaign'
			            and campaign_metric.external_account_id = metric.external_account_id
			            and campaign_metric.metric_date = metric.metric_date
			        )
			      )
			      or (
			        metric.level = 'adset'
			        and not exists (
			          select 1
			          from paid as campaign_metric
			          where campaign_metric.level = 'campaign'
			            and campaign_metric.external_account_id = metric.external_account_id
			            and campaign_metric.metric_date = metric.metric_date
			        )
			        and not exists (
			          select 1
			          from paid as account_metric
			          where account_metric.level = 'account'
			            and account_metric.external_account_id = metric.external_account_id
			            and account_metric.metric_date = metric.metric_date
			        )
			      )
			      or (
			        metric.level = 'ad'
			        and not exists (
			          select 1
			          from paid as campaign_metric
			          where campaign_metric.level = 'campaign'
			            and campaign_metric.external_account_id = metric.external_account_id
			            and campaign_metric.metric_date = metric.metric_date
			        )
			        and not exists (
			          select 1
			          from paid as account_metric
			          where account_metric.level = 'account'
			            and account_metric.external_account_id = metric.external_account_id
			            and account_metric.metric_date = metric.metric_date
			        )
			        and not exists (
			          select 1
			          from paid as adset_metric
			          where adset_metric.level = 'adset'
			            and adset_metric.external_account_id = metric.external_account_id
			            and adset_metric.metric_date = metric.metric_date
			        )
			      )
			    )
			  )
		),
		paid_daily as (
			select
				metric_date,
				sum(spend) as spend,
				sum(impressions) as impressions,
				sum(reach) as reach,
				sum(clicks) as clicks,
				sum(link_clicks) as link_clicks,
				sum(leads_reported)::int as leads_reported,
				sum(conversations_reported)::int as conversations_reported
			from paid_selected
			group by metric_date
		),
		currency_totals as (
			select
				coalesce(nullif(currency, ''), 'UNKNOWN') as currency,
				sum(spend) as spend
			from paid_selected
			group by coalesce(nullif(currency, ''), 'UNKNOWN')
		),
		currency_state as (
			select
				count(*)::int as currency_count,
				max(currency) as currency,
				coalesce(
					jsonb_agg(
						jsonb_build_object(
							'currency', currency,
							'spend', spend
						)
						order by currency
					),
					'[]'::jsonb
				) as breakdown
			from currency_totals
		),
		crm_daily as (
			select
				(occurred_at at time zone time_bounds.timezone_name)::date as metric_date,
				count(*)::int as leads,
				count(*) filter (where contacted)::int as contacted,
				count(*) filter (where responded)::int as responded,
				count(*) filter (where qualified)::int as qualified,
				count(*) filter (where won)::int as won,
				count(*) filter (where lost)::int as lost,
				coalesce(sum(revenue), 0) as revenue
			from outcomes
			cross join time_bounds
			group by (occurred_at at time zone time_bounds.timezone_name)::date
		),
		daily_keys as (
			select metric_date from paid_daily
			union
			select metric_date from crm_daily
		),
		daily as (
			select
				key.metric_date,
				coalesce(paid_day.spend, 0) as spend,
				coalesce(paid_day.impressions, 0) as impressions,
				coalesce(paid_day.reach, 0) as reach,
				coalesce(paid_day.clicks, 0) as clicks,
				coalesce(paid_day.link_clicks, 0) as link_clicks,
				coalesce(paid_day.leads_reported, 0) as leads_reported,
				coalesce(paid_day.conversations_reported, 0) as conversations,
				coalesce(crm_day.leads, 0) as leads,
				coalesce(crm_day.contacted, 0) as contacted,
				coalesce(crm_day.responded, 0) as responded,
				coalesce(crm_day.qualified, 0) as qualified,
				coalesce(crm_day.won, 0) as won,
				coalesce(crm_day.lost, 0) as lost,
				coalesce(crm_day.revenue, 0) as revenue
			from daily_keys as key
			left join paid_daily as paid_day using (metric_date)
			left join crm_daily as crm_day using (metric_date)
			order by key.metric_date
		),
		summary as (
			select
				coalesce((select sum(spend) from paid_daily), 0) as spend,
				coalesce((select sum(impressions) from paid_daily), 0) as impressions,
				coalesce((select sum(reach) from paid_daily), 0) as reach,
				coalesce((select sum(clicks) from paid_daily), 0) as clicks,
				coalesce((select sum(link_clicks) from paid_daily), 0) as link_clicks,
				coalesce((select sum(leads_reported) from paid_daily), 0) as leads_reported,
				(select count(*)::int from outcomes) as leads,
				(select count(*) filter (where contacted)::int from outcomes) as contacted,
				(select count(*) filter (where responded)::int from outcomes) as responded,
				(select count(*) filter (where qualified)::int from outcomes) as qualified,
				(select count(*) filter (where won)::int from outcomes) as won,
				(select count(*) filter (where lost)::int from outcomes) as lost,
				(select count(*) filter (where open)::int from outcomes) as open,
				coalesce((select sum(revenue) from outcomes), 0) as revenue,
				coalesce((select sum(conversations_reported) from paid_daily), 0) as conversations
		),
		social as (
			select
				coalesce(sum(follower_growth), 0) as follower_growth,
				coalesce(sum(posts), 0) as posts,
				coalesce(sum(impressions), 0) as impressions,
				coalesce(sum(reach), 0) as reach,
				coalesce(sum(interactions), 0) as interactions,
				coalesce(sum(likes), 0) as likes,
				coalesce(sum(comments), 0) as comments,
				coalesce(sum(saves), 0) as saves,
				coalesce(sum(shares), 0) as shares,
				coalesce(sum(profile_views), 0) as profile_views,
				coalesce(sum(website_clicks), 0) as website_clicks,
				coalesce(sum(video_views), 0) as video_views
			from public.marketing_social_daily as social_day
			cross join params
			where social_day.organization_id = $1::uuid
			  and (params.date_from is null or social_day.metric_date >= params.date_from)
			  and (params.date_to is null or social_day.metric_date <= params.date_to)
			  and (
			    params.page_id is null
			    or exists (
			      select 1 from public.meta_integrations as integration
			      where integration.organization_id = $1::uuid
			        and integration.id = social_day.integration_id
			        and integration.page_id = params.page_id
			    )
			  )
		),
		latest_social_profiles as (
			select distinct on (social_day.provider, social_day.profile_id)
				social_day.provider,
				social_day.profile_id,
				social_day.profile_name,
				(
					select follower_day.followers
					from public.marketing_social_daily as follower_day
					where follower_day.organization_id = social_day.organization_id
					  and follower_day.provider = social_day.provider
					  and follower_day.profile_id = social_day.profile_id
					  and follower_day.followers is not null
					  and (params.date_to is null or follower_day.metric_date <= params.date_to)
					order by follower_day.metric_date desc, follower_day.fetched_at desc
					limit 1
				) as followers,
				social_day.metric_date,
				social_day.fetched_at
			from public.marketing_social_daily as social_day
			cross join params
			where social_day.organization_id = $1::uuid
			  and (params.date_to is null or social_day.metric_date <= params.date_to)
			  and (
			    params.page_id is null
			    or exists (
			      select 1 from public.meta_integrations as integration
			      where integration.organization_id = $1::uuid
			        and integration.id = social_day.integration_id
			        and integration.page_id = params.page_id
			    )
			  )
			order by
				social_day.provider,
				social_day.profile_id,
				social_day.metric_date desc,
				social_day.fetched_at desc
		),
		latest_social as (
			select
				case
					when count(distinct provider) = 0 then null
					when count(distinct provider) = 1 then max(provider)
					else 'multiple'
				end as provider,
				case
					when count(*) = 0 then null
					when count(*) = 1 then max(profile_name)
					else count(*)::text || ' perfis conectados'
				end as profile_name,
				count(*)::int as profile_count,
				case
					when count(*) > 0 and count(followers) = count(*) then sum(followers)
					else null
				end as followers,
				max(metric_date) as metric_date,
				max(fetched_at) as fetched_at
			from latest_social_profiles
		),
		healthy_meta_integrations as (
			select
				integration.*,
				exists (
					select 1
					from vault.decrypted_secrets as user_secret
					where user_secret.id = integration.user_access_token_secret_ref
					  and nullif(user_secret.decrypted_secret, '') is not null
				)
				and (
					integration.token_expires_at is null
					or integration.token_expires_at > now() + interval '5 minutes'
				)
				and coalesce(integration.granted_scopes, array[]::text[])
					@> array['ads_read']::text[] as marketing_token_available,
				nullif(btrim(integration.instagram_business_account_id), '') is not null
				and exists (
					select 1
					from vault.decrypted_secrets as user_secret
					where user_secret.id = integration.user_access_token_secret_ref
					  and nullif(user_secret.decrypted_secret, '') is not null
				)
				and (
					integration.token_expires_at is null
					or integration.token_expires_at > now() + interval '5 minutes'
				)
				and coalesce(integration.granted_scopes, array[]::text[])
					@> array[
						'instagram_basic',
						'instagram_manage_insights',
						'pages_read_engagement'
					]::text[] as instagram_insights_available
			from public.meta_integrations as integration
			join vault.decrypted_secrets as page_secret
			  on page_secret.id = integration.access_token_secret_ref
			 and nullif(page_secret.decrypted_secret, '') is not null
			where integration.organization_id = $1::uuid
			  and coalesce(integration.is_connected, false) = true
			  and coalesce(integration.token_status, 'active') = 'active'
		),
		selected_meta_ad_accounts as (
			select distinct selection.account_id
			from healthy_meta_integrations as integration
			cross join lateral (
				select nullif(btrim(
					case
						when jsonb_typeof(item.value) = 'string'
							then trim(both '"' from item.value::text)
						when jsonb_typeof(item.value) = 'object'
							then item.value->>'id'
						else null
					end
				), '') as account_id
				from jsonb_array_elements(
					case
						when jsonb_typeof(integration.selected_ad_accounts) = 'array'
							then integration.selected_ad_accounts
						else '[]'::jsonb
					end
				) as item(value)
				union
				select nullif(btrim(integration.ad_account_id), '')
			) as selection
			where selection.account_id is not null
		),
		connection as (
			select
				count(*)::int as connected_pages,
				(select count(*)::int from selected_meta_ad_accounts) as ad_accounts,
				count(*) filter (where instagram_business_account_id is not null)::int as instagram_accounts,
				coalesce(bool_or(marketing_token_available), false) as marketing_token_available,
				coalesce(bool_or(instagram_insights_available), false) as instagram_insights_available,
				max(last_sync_at) as last_sync_at,
				count(*) > 0 as connected
			from healthy_meta_integrations
		),
		available_account_ids as (
			select account.external_account_id as id
			from public.marketing_accounts as account
			where account.organization_id = $1::uuid
			  and account.provider = 'meta'
			union
			select distinct metric.external_account_id as id
			from public.marketing_performance_daily as metric
			cross join params
			where metric.organization_id = $1::uuid
			  and metric.provider = 'meta'
			  and (params.date_from is null or metric.metric_date >= params.date_from)
			  and (params.date_to is null or metric.metric_date <= params.date_to)
		),
		available_accounts as (
			select
				account_id.id,
				coalesce(nullif(max(account.name), ''), account_id.id) as name,
				nullif(max(account.currency), '') as currency
			from available_account_ids as account_id
			left join public.marketing_accounts as account
			  on account.organization_id = $1::uuid
			 and account.provider = 'meta'
			 and account.external_account_id = account_id.id
			group by account_id.id
		),
		available_objectives as (
			select distinct btrim(metric.objective) as value
			from public.marketing_performance_daily as metric
			cross join params
			where metric.organization_id = $1::uuid
			  and metric.provider = 'meta'
			  and nullif(btrim(metric.objective), '') is not null
			  and (params.date_from is null or metric.metric_date >= params.date_from)
			  and (params.date_to is null or metric.metric_date <= params.date_to)
		)
		select jsonb_build_object(
			'filterOptions', jsonb_build_object(
				'accounts', coalesce((
					select jsonb_agg(
						jsonb_build_object(
							'id', account.id,
							'name', account.name,
							'currency', account.currency
						)
						order by account.name, account.id
					)
					from available_accounts as account
				), '[]'::jsonb),
				'objectives', coalesce((
					select jsonb_agg(
						jsonb_build_object(
							'value', objective.value,
							'label', initcap(replace(lower(objective.value), '_', ' '))
						)
						order by objective.value
					)
					from available_objectives as objective
				), '[]'::jsonb)
			),
			'campaigns', coalesce((
				select jsonb_agg(
					jsonb_build_object(
						'campaign_id', campaign.campaign_id,
						'campaign_name', campaign.campaign_name,
						'spend', campaign.spend,
						'impressions', campaign.impressions,
						'reach', campaign.reach,
						'clicks', campaign.clicks,
						'link_clicks', campaign.link_clicks,
						'leads_reported', campaign.leads_reported,
						'leads_count', campaign.leads_count,
						'meta_reported_leads', campaign.leads_reported,
						'meta_reported_conversations', campaign.conversations_count,
						'reported_results', campaign.leads_reported + campaign.conversations_count,
						'crm_attributed_leads', campaign.leads_count,
						'capture_gap', campaign.leads_reported + campaign.conversations_count - campaign.leads_count,
						'capture_rate', case
							when campaign.leads_reported + campaign.conversations_count > 0
								then campaign.leads_count::numeric * 100
									/ (campaign.leads_reported + campaign.conversations_count)
							else null
						end,
						'contacted_count', campaign.contacted_count,
						'responded_count', campaign.responded_count,
						'qualified_count', campaign.qualified_count,
						'won_count', campaign.won_count,
						'lost_count', campaign.lost_count,
						'open_count', campaign.open_count,
						'revenue', campaign.revenue,
						'conversations_count', campaign.conversations_count,
						'conversions_reported', campaign.conversions_reported,
						'cpl', campaign.cpl,
						'cpql', campaign.cpql,
						'cac', campaign.cac,
						'reported_cpl', campaign.reported_cpl,
						'ctr', campaign.ctr,
						'cpc', campaign.cpc,
						'cpm', campaign.cpm,
						'frequency', campaign.frequency,
						'hook_rate', campaign.hook_rate,
						'status', campaign.status,
						'budget', campaign.budget,
						'budget_type', campaign.budget_type,
						'objective', campaign.objective,
						'currency', campaign.currency,
						'adsets', coalesce((
							select jsonb_agg(
								jsonb_build_object(
									'adset_id', adset_key.adset_id,
									'adset_name', coalesce(paid_adset.adset_name, crm_adset.adset_name, 'Conjunto'),
									'spend', coalesce(paid_adset.spend, 0),
									'impressions', coalesce(paid_adset.impressions, 0),
									'reach', coalesce(paid_adset.reach, 0),
									'clicks', coalesce(paid_adset.clicks, 0),
									'link_clicks', coalesce(paid_adset.link_clicks, 0),
									'leads_reported', coalesce(paid_adset.leads_reported, 0),
									'leads_count', coalesce(crm_adset.leads_count, 0),
									'contacted_count', coalesce(crm_adset.contacted_count, 0),
									'responded_count', coalesce(crm_adset.responded_count, 0),
									'qualified_count', coalesce(crm_adset.qualified_count, 0),
									'won_count', coalesce(crm_adset.won_count, 0),
									'lost_count', coalesce(crm_adset.lost_count, 0),
									'open_count', coalesce(crm_adset.open_count, 0),
									'revenue', coalesce(crm_adset.revenue, 0),
									'conversations_count', coalesce(paid_adset.conversations_reported, 0),
									'cpl', case
										when not (select has_crm_scope_filter from params)
										 and coalesce(crm_adset.leads_count, 0) > 0
											then paid_adset.spend / crm_adset.leads_count
										else null
									end,
									'ctr', paid_adset.ctr,
									'cpc', paid_adset.cpc,
									'hook_rate', paid_adset.hook_rate,
									'status', paid_adset.status,
									'budget', paid_adset.budget,
									'budget_type', paid_adset.budget_type,
									'optimization_goal', paid_adset.optimization_goal,
									'currency', paid_adset.currency,
									'ads', coalesce((
										select jsonb_agg(
											jsonb_build_object(
												'ad_id', ad_key.ad_id,
												'ad_name', coalesce(paid_ad.ad_name, crm_ad.ad_name, 'Anuncio'),
												'spend', coalesce(paid_ad.spend, 0),
												'impressions', coalesce(paid_ad.impressions, 0),
												'reach', coalesce(paid_ad.reach, 0),
												'clicks', coalesce(paid_ad.clicks, 0),
												'link_clicks', coalesce(paid_ad.link_clicks, 0),
												'leads_reported', coalesce(paid_ad.leads_reported, 0),
												'leads_count', coalesce(crm_ad.leads_count, 0),
												'contacted_count', coalesce(crm_ad.contacted_count, 0),
												'responded_count', coalesce(crm_ad.responded_count, 0),
												'qualified_count', coalesce(crm_ad.qualified_count, 0),
												'won_count', coalesce(crm_ad.won_count, 0),
												'lost_count', coalesce(crm_ad.lost_count, 0),
												'open_count', coalesce(crm_ad.open_count, 0),
												'revenue', coalesce(crm_ad.revenue, 0),
												'conversations_count', coalesce(paid_ad.conversations_reported, 0),
												'cpl', case
													when not (select has_crm_scope_filter from params)
													 and coalesce(crm_ad.leads_count, 0) > 0
														then paid_ad.spend / crm_ad.leads_count
													else null
												end,
												'ctr', paid_ad.ctr,
												'cpc', paid_ad.cpc,
												'hook_rate', paid_ad.hook_rate,
												'status', paid_ad.status,
												'creative_id', paid_ad.creative_id,
												'creative_url', paid_ad.creative_url,
												'creative_video_url', paid_ad.creative_video_url,
												'creative_permalink_url', paid_ad.creative_permalink_url,
												'thumbnail_url', paid_ad.thumbnail_url,
												'currency', paid_ad.currency
											)
											order by
												coalesce(crm_ad.leads_count, 0) desc,
												coalesce(paid_ad.spend, 0) desc
										)
										from (
											select ad_id
											from paid_ads
											where coalesce(campaign_id, 'unattributed') = campaign.campaign_id
											  and coalesce(adset_id, 'unattributed') = adset_key.adset_id
											union
											select ad_id
											from crm_ads
											where campaign_id = campaign.campaign_id
											  and adset_id = adset_key.adset_id
										) as ad_key
										left join paid_ads as paid_ad
										  on paid_ad.ad_id = ad_key.ad_id
										 and coalesce(paid_ad.campaign_id, 'unattributed') = campaign.campaign_id
										 and coalesce(paid_ad.adset_id, 'unattributed') = adset_key.adset_id
										left join crm_ads as crm_ad
										  on crm_ad.ad_id = ad_key.ad_id
										 and crm_ad.campaign_id = campaign.campaign_id
										 and crm_ad.adset_id = adset_key.adset_id
									), '[]'::jsonb)
								)
								order by
									coalesce(crm_adset.leads_count, 0) desc,
									coalesce(paid_adset.spend, 0) desc
							)
							from (
								select coalesce(adset_id, 'unattributed') as adset_id
								from paid_adsets
								where coalesce(campaign_id, 'unattributed') = campaign.campaign_id
								union
								select adset_id
								from crm_adsets
								where campaign_id = campaign.campaign_id
							) as adset_key
							left join paid_adsets as paid_adset
							  on coalesce(paid_adset.adset_id, 'unattributed') = adset_key.adset_id
							 and coalesce(paid_adset.campaign_id, 'unattributed') = campaign.campaign_id
							left join crm_adsets as crm_adset
							  on crm_adset.adset_id = adset_key.adset_id
							 and crm_adset.campaign_id = campaign.campaign_id
						), '[]'::jsonb)
					)
					order by campaign.leads_count desc, campaign.spend desc
				)
				from campaigns as campaign
			), '[]'::jsonb),
			'topCreatives', coalesce((
				select jsonb_agg(creative)
				from (
					select jsonb_build_object(
						'ad_id', paid_ad.ad_id,
						'ad_name', paid_ad.ad_name,
						'campaign_name', paid_ad.campaign_name,
						'leads_reported', paid_ad.leads_reported,
						'leads_count', coalesce(crm_ad.leads_count, 0),
						'contacted_count', coalesce(crm_ad.contacted_count, 0),
						'responded_count', coalesce(crm_ad.responded_count, 0),
						'qualified_count', coalesce(crm_ad.qualified_count, 0),
						'won_count', coalesce(crm_ad.won_count, 0),
						'lost_count', coalesce(crm_ad.lost_count, 0),
						'revenue', coalesce(crm_ad.revenue, 0),
						'score',
							coalesce(crm_ad.leads_count, 0)
							+ coalesce(crm_ad.qualified_count, 0) * 3
							+ coalesce(crm_ad.won_count, 0) * 10,
						'creative_url', paid_ad.creative_url,
						'creative_video_url', paid_ad.creative_video_url,
						'creative_permalink_url', paid_ad.creative_permalink_url,
						'thumbnail_url', paid_ad.thumbnail_url,
						'spend', paid_ad.spend,
						'cpl', case
							when not (select has_crm_scope_filter from params)
							 and coalesce(crm_ad.leads_count, 0) > 0
								then paid_ad.spend / crm_ad.leads_count
							else null
						end,
						'ctr', paid_ad.ctr,
						'cpc', paid_ad.cpc,
						'hook_rate', paid_ad.hook_rate,
						'currency', paid_ad.currency
					) as creative
					from paid_ads as paid_ad
					left join crm_ads as crm_ad
					  on crm_ad.ad_id = paid_ad.ad_id
					 and crm_ad.campaign_id = coalesce(paid_ad.campaign_id, 'unattributed')
					 and crm_ad.adset_id = coalesce(paid_ad.adset_id, 'unattributed')
					order by
						coalesce(crm_ad.won_count, 0) desc,
						coalesce(crm_ad.qualified_count, 0) desc,
						coalesce(crm_ad.leads_count, 0) desc,
						paid_ad.spend desc
					limit 24
				) as ranked_creatives
			), '[]'::jsonb),
			'dailyData', coalesce((
				select jsonb_agg(
					jsonb_build_object(
						'date', day.metric_date::text,
						'spend', day.spend,
						'impressions', day.impressions,
						'reach', day.reach,
						'clicks', day.clicks,
						'linkClicks', day.link_clicks,
						'leadsReported', day.leads_reported,
						'leads', day.leads,
						'metaReportedLeads', day.leads_reported,
						'metaReportedConversations', day.conversations,
						'reportedResults', day.leads_reported + day.conversations,
						'crmAttributedLeads', day.leads,
						'captureGap', day.leads_reported + day.conversations - day.leads,
						'captureRate', case
							when day.leads_reported + day.conversations > 0
								then day.leads::numeric * 100 / (day.leads_reported + day.conversations)
							else null
						end,
						'contacted', day.contacted,
						'responded', day.responded,
						'qualified', day.qualified,
						'won', day.won,
						'lost', day.lost,
						'revenue', day.revenue,
						'conversations', day.conversations,
						'total', day.leads
					)
					order by day.metric_date
				)
				from daily as day
			), '[]'::jsonb),
			'media', coalesce((
				select jsonb_agg(to_jsonb(media_row) order by media_row.published_at desc nulls last)
				from (
					select
						asset.id,
						asset.provider,
						asset.source_kind,
						asset.external_media_id,
						asset.media_type,
						asset.title,
						asset.caption,
						asset.campaign_id,
						asset.campaign_name,
						asset.adset_id,
						asset.adset_name,
						asset.ad_id,
						asset.ad_name,
						asset.creative_id,
						asset.thumbnail_url,
						asset.media_url,
						asset.video_url,
						asset.permalink_url,
						asset.published_at,
						case
							when asset.source_kind = 'paid' then jsonb_strip_nulls(
								jsonb_build_object(
									'spend', current_paid_ad.spend,
									'impressions', current_paid_ad.impressions,
									'reach', current_paid_ad.reach,
									'clicks', current_paid_ad.clicks,
									'link_clicks', current_paid_ad.link_clicks,
									'leads', current_paid_ad.leads_reported,
									'conversations', current_paid_ad.conversations_reported,
									'conversions', current_paid_ad.conversions_reported,
									'ctr', current_paid_ad.ctr,
									'cpc', current_paid_ad.cpc,
									'cpl', current_paid_ad.reported_cpl,
									'hook_rate', current_paid_ad.hook_rate,
									'currency', current_paid_ad.currency
								)
							)
							else asset.metrics
						end as metrics,
						asset.last_synced_at
					from public.marketing_media_assets as asset
					cross join params
					cross join time_bounds
					left join paid_ads as current_paid_ad
					  on asset.source_kind = 'paid'
					 and current_paid_ad.ad_id = asset.ad_id
					where asset.organization_id = $1::uuid
					  and (params.campaign_id is null or asset.campaign_id = params.campaign_id)
					  and (params.adset_id is null or asset.adset_id = params.adset_id)
					  and (params.ad_id is null or asset.ad_id = params.ad_id)
					  and (
					    params.page_id is null
					    or (
					      asset.source_kind = 'paid'
					      and current_paid_ad.ad_id is not null
					    )
					    or (
					      asset.source_kind <> 'paid'
					      and exists (
					        select 1 from public.meta_integrations as integration
					        where integration.organization_id = $1::uuid
					          and integration.id = asset.integration_id
					          and integration.page_id = params.page_id
					      )
					    )
					  )
					  and (
					    (
					      asset.source_kind = 'paid'
					      and asset.ad_id is not null
					      and current_paid_ad.ad_id is not null
					    )
					    or (
					      asset.source_kind <> 'paid'
					      and (
					        time_bounds.starts_at is null
					        or (
					          asset.published_at is not null
					          and asset.published_at >= time_bounds.starts_at
					        )
					      )
					      and (
					        time_bounds.ends_at is null
					        or (
					          asset.published_at is not null
					          and asset.published_at < time_bounds.ends_at
					        )
					      )
					    )
					  )
					order by asset.published_at desc nulls last, asset.last_synced_at desc
					limit 240
				) as media_row
			), '[]'::jsonb),
			'social', jsonb_build_object(
				'provider', (select provider from latest_social),
				'profileName', (select profile_name from latest_social),
				'profileCount', coalesce((select profile_count from latest_social), 0),
				'followers', (select followers from latest_social),
				'followerGrowth', coalesce((select follower_growth from social), 0),
				'posts', coalesce((select posts from social), 0),
				'impressions', coalesce((select impressions from social), 0),
				'reach', coalesce((select reach from social), 0),
				'interactions', coalesce((select interactions from social), 0),
				'likes', coalesce((select likes from social), 0),
				'comments', coalesce((select comments from social), 0),
				'saves', coalesce((select saves from social), 0),
				'shares', coalesce((select shares from social), 0),
				'profileViews', coalesce((select profile_views from social), 0),
				'websiteClicks', coalesce((select website_clicks from social), 0),
				'videoViews', coalesce((select video_views from social), 0),
				'lastSync', (select fetched_at from latest_social)
			),
			'summary', jsonb_build_object(
				'totalLeads', (select leads from summary),
				'reportedLeads', (select leads_reported from summary),
				'metaReportedLeads', (select leads_reported from summary),
				'metaReportedConversations', (select conversations from summary),
				'reportedResults', (select leads_reported + conversations from summary),
				'crmAttributedLeads', (select leads from summary),
				'captureGap', (select leads_reported + conversations - leads from summary),
				'captureRate', case
					when (select leads_reported + conversations from summary) > 0
						then (select leads from summary)::numeric * 100
							/ (select leads_reported + conversations from summary)
					else null
				end,
				'totalContacted', (select contacted from summary),
				'totalResponded', (select responded from summary),
				'totalQualified', (select qualified from summary),
				'totalWon', (select won from summary),
				'totalLost', (select lost from summary),
				'totalOpen', (select open from summary),
				'totalRevenue', (select revenue from summary),
				'totalCampaigns', (select count(*) from campaigns),
				'totalAdsets', (select count(*) from paid_adsets),
				'totalAds', (select count(*) from paid_ads),
				'totalSpend', case
					when (select currency_count from currency_state) = 1
					 and (select currency from currency_state) <> 'UNKNOWN'
						then (select spend from summary)
					else null
				end,
				'currency', case
					when (select currency_count from currency_state) = 1
					 and (select currency from currency_state) <> 'UNKNOWN'
						then (select currency from currency_state)
					else null
				end,
				'currencyBreakdown', (select breakdown from currency_state),
				'totalImpressions', (select impressions from summary),
				'totalReach', (select reach from summary),
				'totalClicks', (select clicks from summary),
				'totalLinkClicks', (select link_clicks from summary),
				'conversations_count', (select conversations from summary),
				'avgCpl', case
					when (select currency_count from currency_state) = 1
					 and (select currency from currency_state) <> 'UNKNOWN'
					 and not (select has_crm_scope_filter from params)
					 and (select leads from summary) > 0
						then (select spend from summary) / (select leads from summary)
					else null
				end,
				'reportedCpl', case
					when (select currency_count from currency_state) = 1
					 and (select currency from currency_state) <> 'UNKNOWN'
					 and (select leads_reported from summary) > 0
						then (select spend from summary) / (select leads_reported from summary)
					else null
				end,
				'cpql', case
					when (select currency_count from currency_state) = 1
					 and (select currency from currency_state) <> 'UNKNOWN'
					 and not (select has_crm_scope_filter from params)
					 and (select qualified from summary) > 0
						then (select spend from summary) / (select qualified from summary)
					else null
				end,
				'cac', case
					when (select currency_count from currency_state) = 1
					 and (select currency from currency_state) <> 'UNKNOWN'
					 and not (select has_crm_scope_filter from params)
					 and (select won from summary) > 0
						then (select spend from summary) / (select won from summary)
					else null
				end,
				'ctr', case
					when (select impressions from summary) > 0
						then (select clicks from summary)::numeric * 100 / (select impressions from summary)
					else null
				end,
				'cpc', case
					when (select currency_count from currency_state) = 1
					 and (select currency from currency_state) <> 'UNKNOWN'
					 and (select clicks from summary) > 0
						then (select spend from summary) / (select clicks from summary)
					else null
				end,
				'cpm', case
					when (select currency_count from currency_state) = 1
					 and (select currency from currency_state) <> 'UNKNOWN'
					 and (select impressions from summary) > 0
						then (select spend from summary) * 1000 / (select impressions from summary)
					else null
				end,
				'responseRate', case
					when (select leads from summary) > 0
						then (select responded from summary)::numeric * 100 / (select leads from summary)
					else null
				end,
				'qualificationRate', case
					when (select leads from summary) > 0
						then (select qualified from summary)::numeric * 100 / (select leads from summary)
					else null
				end,
				'conversionRate', case
					when (select leads from summary) > 0
						then (select won from summary)::numeric * 100 / (select leads from summary)
					else null
				end,
				'roas', case
					when (select currency_count from currency_state) = 1
					 and (select currency from currency_state) <> 'UNKNOWN'
					 and not (select has_crm_scope_filter from params)
					 and (select spend from summary) > 0
						then (select revenue from summary) / (select spend from summary)
					else null
				end
			),
			'connection', jsonb_build_object(
				'isConnected', coalesce((select connected from connection), false),
				'connectedPages', coalesce((select connected_pages from connection), 0),
				'adAccounts', coalesce((select ad_accounts from connection), 0),
				'instagramAccounts', coalesce((select instagram_accounts from connection), 0),
				'marketingTokenAvailable', coalesce((select marketing_token_available from connection), false),
				'instagramInsightsAvailable', coalesce((select instagram_insights_available from connection), false),
				'lastIntegrationSync', (select last_sync_at from connection)
			),
			'dataQuality', jsonb_build_object(
				'model', 'daily_facts_v1',
				'attribution', 'last_meta_touch_in_entry_cohort',
				'reportedResultsRule', 'meta_leads_plus_messaging_conversations_non_unique',
				'reportedResultsMayOverlap', true,
				'qualification', 'qualified_stage_history',
				'hasDailyFacts', exists(select 1 from paid),
				'hasAccountFacts', exists(
					select 1 from paid where level = 'account'
				),
				-- The canonical attribution pipeline is available even when
				-- the selected period legitimately contains zero Meta leads.
				'hasCRMAttribution', true,
				'hasCRMEvents', exists(select 1 from entry_candidates),
				'hasCRMScopedFilters', (select has_crm_scope_filter from params),
				'coverageFrom', (select min(metric_date) from paid),
				'coverageTo', (select max(metric_date) from paid),
				'reportTimezone', (select timezone_name from report_settings),
				'socialProfileCount', coalesce(
					(select profile_count from latest_social),
					0
				),
				'reachAggregation', 'sum_of_daily_scope_reach',
				'reachIsUniqueAcrossPeriod', false,
				'multipleCurrencies',
					(select currency_count from currency_state) > 1,
				'currencyBreakdown', (select breakdown from currency_state),
				'summaryLevel', case
					when (select ad_id from params) is not null then 'ad'
					when (select adset_id from params) is not null then 'adset'
					when (select campaign_id from params) is not null then 'campaign'
					when exists(select 1 from paid_selected where level = 'campaign')
						and exists(select 1 from paid where level = 'account')
						then 'account_with_campaign_fallback'
					when exists(select 1 from paid_selected where level = 'account')
						then 'account'
					when exists(select 1 from paid_selected where level = 'campaign')
						then 'campaign_fallback'
					when exists(select 1 from paid_selected where level = 'adset')
						then 'adset_fallback'
					else 'ad_fallback'
				end,
				'legacyRowsIgnored', (
					select count(*)
					from public.meta_campaign_insights as legacy
					where legacy.organization_id = $1::uuid
				)
			),
			'lastSync', (select max(fetched_at) from paid),
			'hasSpendData', exists(select 1 from paid_selected)
		)
	`,
		tenantContext.OrganizationID,
		dateOnly(values, "dateFrom"),
		dateOnly(values, "dateTo"),
		values.Get("campaignId"),
		values.Get("adSetId"),
		values.Get("adId"),
		values.Get("teamId"),
		values.Get("userId"),
		values.Get("source"),
		tagIDs,
		values.Get("dealStatus"),
		values.Get("accountId"),
		values.Get("objective"),
		values.Get("pageId"),
	)
}
