package analytics

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db *dbpkg.Postgres
}

func NewRepository(db *dbpkg.Postgres) Repository {
	return Repository{db: db}
}

func (repo Repository) SiteSummary(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
	return repo.queryJSONObject(ctx, `
		with bounds as (
			select coalesce(nullif($2, '')::date, current_date - 6) as date_from,
			       coalesce(nullif($3, '')::date, current_date) as date_to
		), periods as (
			select date_from, date_to, (date_to - date_from + 1) as days from bounds
		), current_events as (
			select e.* from public.site_analytics_events e, periods p
			where e.organization_id = $1::uuid and e.created_at >= p.date_from and e.created_at < p.date_to + 1
		), previous_events as (
			select e.* from public.site_analytics_events e, periods p
			where e.organization_id = $1::uuid and e.created_at >= p.date_from - p.days and e.created_at < p.date_from
		), session_sources as (
			select distinct on (session_id) session_id, utm_source, utm_medium, referrer
			from current_events where session_id is not null order by session_id, created_at
		), current_session_durations as (
			select session_id, sum(coalesce(duration_seconds, 0))::numeric duration
			from current_events where session_id is not null group by session_id
		), previous_session_durations as (
			select session_id, sum(coalesce(duration_seconds, 0))::numeric duration
			from previous_events where session_id is not null group by session_id
		), totals as (
			select count(*) filter (where event_type in ('pageview','page_view'))::int views,
			       count(distinct page_path) filter (where event_type in ('pageview','page_view'))::int unique_pages,
			       count(distinct session_id)::int sessions,
			       coalesce((select round(avg(duration)) from current_session_durations), 0)::int avg_duration,
			       count(*) filter (where event_type = 'form_submit')::int conversions,
			       count(distinct session_id) filter (where device_type = 'desktop')::numeric desktop,
			       count(distinct session_id) filter (where device_type = 'mobile')::numeric mobile,
			       count(distinct session_id) filter (where device_type = 'tablet')::numeric tablet
			from current_events
		), previous as (
			select count(*) filter (where event_type in ('pageview','page_view'))::int views,
			       count(distinct page_path) filter (where event_type in ('pageview','page_view'))::int unique_pages,
			       count(distinct session_id)::int sessions,
			       coalesce((select round(avg(duration)) from previous_session_durations), 0)::int avg_duration,
			       count(*) filter (where event_type = 'form_submit')::int conversions,
			       count(distinct session_id) filter (where device_type = 'desktop')::numeric desktop,
			       count(distinct session_id) filter (where device_type = 'mobile')::numeric mobile
			from previous_events
		), classified_sources as (
			select case
			 when lower(coalesce(utm_source,'')) ~ '(facebook|instagram|meta|linkedin|tiktok)' or lower(coalesce(referrer,'')) ~ '(facebook|instagram|linkedin|tiktok)' then 'social'
			 when lower(coalesce(utm_medium,'')) in ('organic','search','cpc','ppc') or lower(coalesce(referrer,'')) ~ '(google|bing|yahoo)' then 'search'
			 when utm_source is not null or utm_medium is not null then 'campaign'
			 when coalesce(referrer,'') = '' then 'direct'
			 else 'referral' end source_type
			from session_sources
		), sources as (
			select count(*)::numeric total,
			 count(*) filter (where source_type='direct')::numeric direct,
			 count(*) filter (where source_type='search')::numeric search,
			 count(*) filter (where source_type='social')::numeric social,
			 count(*) filter (where source_type='campaign')::numeric campaign,
			 count(*) filter (where source_type='referral')::numeric referral
			from classified_sources
		)
		select jsonb_build_object(
		 'totalViews', t.views, 'totalPages', t.views, 'uniquePages', t.unique_pages, 'uniqueSessions', t.sessions,
		 'avgDuration', t.avg_duration,
		 'desktopPct', case when t.sessions>0 then round(t.desktop*100/t.sessions) else 0 end,
		 'mobilePct', case when t.sessions>0 then round(t.mobile*100/t.sessions) else 0 end,
		 'tabletPct', case when t.sessions>0 then round(t.tablet*100/t.sessions) else 0 end,
		 'directPct', case when s.total>0 then round(s.direct*100/s.total) else 0 end,
		 'searchPct', case when s.total>0 then round(s.search*100/s.total) else 0 end,
		 'socialPct', case when s.total>0 then round(s.social*100/s.total) else 0 end,
		 'campaignPct', case when s.total>0 then round(s.campaign*100/s.total) else 0 end,
		 'referralPct', case when s.total>0 then round(s.referral*100/s.total) else 0 end,
		 'conversions', t.conversions,
		 'prevSessions', p.sessions, 'prevViews', p.views, 'prevPages', p.views, 'prevUniquePages', p.unique_pages, 'prevAvgDuration', p.avg_duration,
		 'prevDesktopPct', case when p.sessions>0 then round(p.desktop*100/p.sessions) else 0 end,
		 'prevMobilePct', case when p.sessions>0 then round(p.mobile*100/p.sessions) else 0 end,
		 'prevConversions', p.conversions,
		 'prevConversionRate', case when p.sessions>0 then round(p.conversions::numeric*100/p.sessions,2) else 0 end)
		from totals t cross join previous p cross join sources s
	`, tenantContext.OrganizationID, dateOnly(values, "dateFrom"), dateOnly(values, "dateTo"))
}

func (repo Repository) SiteDetailed(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
	trackingV2, err := repo.hasSiteAnalyticsV2(ctx)
	if err != nil {
		return nil, err
	}
	if !trackingV2 {
		return repo.siteDetailedLegacy(ctx, tenantContext, values)
	}
	return repo.queryJSONObject(ctx, `
		with events as (
		 select * from public.site_analytics_events e
		 where e.organization_id=$1::uuid
		   and ($2='' or e.created_at >= nullif($2,'')::date)
		   and ($3='' or e.created_at < nullif($3,'')::date + 1)
		), top_properties as (
		 select e.property_id, coalesce(max(p.title),'Imovel') title, coalesce(max(p.code),'') code,
		   count(*) filter(where e.event_type in ('pageview','page_view'))::int views,
		   count(*) filter(where e.event_type='favorite')::int favorites
		 from events e join public.properties p on p.id=e.property_id and p.organization_id=e.organization_id
		 where e.property_id is not null group by e.property_id order by views desc limit 20
		), top_pages as (
		 select page_path, count(*)::int views from events where event_type in ('pageview','page_view')
		 group by page_path order by views desc limit 20
		), daily as (
		 select created_at::date::text date, count(*)::int views from events where event_type in ('pageview','page_view')
		 group by created_at::date order by created_at::date
		), session_metrics as (
		 select session_id,
		   count(*) filter(where event_type in ('pageview','page_view'))::int pageviews,
		   bool_or(event_type='form_submit') converted,
		   max(created_at) last_seen
		 from events where session_id is not null group by session_id
		), totals as (
		 select count(*)::int sessions,
		   count(*) filter(where converted)::int converted_sessions,
		   (select count(*)::int from events where event_type='form_submit') conversions,
		   coalesce(round(sum(pageviews)::numeric/nullif(count(*),0),2),0) pages_per_session,
		   coalesce(round(count(*) filter(where pageviews<=1 and not converted)::numeric*100/nullif(count(*),0),2),0) bounce_rate,
		   (select count(distinct live.session_id)::int
		      from public.site_analytics_events live
		     where live.organization_id=$1::uuid
		       and live.session_id is not null
		       and live.created_at >= now()-interval '5 minutes') live_visitors
		 from session_metrics
		), site_leads as (
		 select count(*)::int total from public.leads l
		 where l.organization_id=$1::uuid and (l.source in ('site','website') or l.source_detail='public_site')
		   and ($2='' or l.created_at >= nullif($2,'')::date) and ($3='' or l.created_at < nullif($3,'')::date + 1)
		), campaigns as (
		 select coalesce(utm_source,'Direto') source, coalesce(utm_campaign,'Sem campanha') campaign,
		   count(distinct session_id)::int sessions, count(*) filter(where event_type='form_submit')::int conversions
		 from events group by 1,2 order by sessions desc limit 20
		), searches as (
		 select coalesce(nullif(metadata->>'search_term',''), 'Busca por filtros') term, count(*)::int searches
		 from events where event_type='property_search'
		 group by 1 order by searches desc limit 20
		)
		select jsonb_build_object(
		 'topProperties', coalesce((select jsonb_agg(to_jsonb(x)) from top_properties x),'[]'::jsonb),
		 'topPages', coalesce((select jsonb_agg(to_jsonb(x)) from top_pages x),'[]'::jsonb),
		 'dailyViews', coalesce((select jsonb_agg(to_jsonb(x)) from daily x),'[]'::jsonb),
		 'campaigns', coalesce((select jsonb_agg(to_jsonb(x)) from campaigns x),'[]'::jsonb),
		 'searchTerms', coalesce((select jsonb_agg(to_jsonb(x)) from searches x),'[]'::jsonb),
		 'conversionRate', case when t.sessions>0 then round(t.converted_sessions::numeric*100/t.sessions,2) else 0 end,
		 'totalSessions', t.sessions, 'totalConversions', t.conversions, 'siteLeads', s.total,
		 'pagesPerSession', t.pages_per_session, 'bounceRate', t.bounce_rate, 'liveVisitors', t.live_visitors)
		from totals t cross join site_leads s
	`, tenantContext.OrganizationID, dateOnly(values, "dateFrom"), dateOnly(values, "dateTo"))
}

func (repo Repository) LeadAnalytics(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
	trackingV2, err := repo.hasSiteAnalyticsV2(ctx)
	if err != nil {
		return nil, err
	}
	if !trackingV2 {
		return repo.leadAnalyticsLegacy(ctx, tenantContext, values)
	}
	return repo.queryJSONObject(ctx, `
		with events as (
		 select * from public.site_analytics_events e where e.organization_id=$1::uuid
		 and ($2='' or e.created_at >= nullif($2,'')::date) and ($3='' or e.created_at < nullif($3,'')::date + 1)
		), journeys as (
		 select session_id, array_agg(page_path order by created_at) path_sequence,
		   array_agg(event_type order by created_at) event_sequence, min(created_at)::text first_event,
		   max(created_at)::text last_event, count(*)::int total_events,
		   bool_or(event_type='form_submit') converted, max(device_type) device_type, max(browser) browser,
		   max(metadata->>'os') os, max(metadata->>'city') city, max(metadata->>'region') region,
		   max(metadata->>'country') country, max(utm_source) utm_source, max(referrer) referrer
		 from events where session_id is not null group by session_id order by max(created_at) desc limit 100
		), funnel as (
		 select event_type, count(*)::int total from events
		 where event_type not in ('session_start', 'page_duration')
		 group by event_type order by total desc
		), pages as (
		 select page_path, count(*)::int views from events where event_type in ('pageview','page_view') group by page_path order by views desc limit 20
		), daily as (
		 select created_at::date::text date, count(*)::int views from events where event_type in ('pageview','page_view') group by created_at::date order by created_at::date
		), devices as (
		 select coalesce(device_type,'unknown') device_type, count(distinct session_id)::int total from events group by device_type
		), locations as (
		 select coalesce(max(metadata->>'city'), max(metadata->>'country'), 'Localizacao nao identificada') city,
		   max(metadata->>'region') region, max(metadata->>'country') country,
		   max(case when metadata->>'lat' ~ '^-?[0-9]+([.][0-9]+)?$' then (metadata->>'lat')::numeric end) lat,
		   max(case when metadata->>'lng' ~ '^-?[0-9]+([.][0-9]+)?$' then (metadata->>'lng')::numeric end) lng,
		   count(distinct session_id)::int sessions
		 from events
		 where metadata->>'city' is not null or metadata->>'country' is not null
		 group by coalesce(metadata->>'city', metadata->>'country'), metadata->>'region'
		 order by sessions desc limit 50
		)
		select jsonb_build_object(
		 'journeys',coalesce((select jsonb_agg(to_jsonb(x)) from journeys x),'[]'::jsonb),
		 'funnel',coalesce((select jsonb_agg(to_jsonb(x)) from funnel x),'[]'::jsonb),
		 'top_pages',coalesce((select jsonb_agg(to_jsonb(x)) from pages x),'[]'::jsonb),
		 'daily_views',coalesce((select jsonb_agg(to_jsonb(x)) from daily x),'[]'::jsonb),
		 'total_sessions',(select count(distinct session_id) from events),
		 'total_conversions',(select count(*) from events where event_type='form_submit'),
		 'device_breakdown',coalesce((select jsonb_agg(to_jsonb(x)) from devices x),'[]'::jsonb),
		 'locations',coalesce((select jsonb_agg(to_jsonb(x)) from locations x),'[]'::jsonb))
	`, tenantContext.OrganizationID, dateOnly(values, "dateFrom"), dateOnly(values, "dateTo"))
}

func (repo Repository) hasSiteAnalyticsV2(ctx context.Context) (bool, error) {
	var available bool
	err := repo.db.Pool().QueryRow(ctx, `
		select count(*) = 3
		from information_schema.columns
		where table_schema='public' and table_name='site_analytics_events'
		  and column_name in ('property_id','lead_id','metadata')
	`).Scan(&available)
	return available, err
}

func (repo Repository) siteDetailedLegacy(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
	return repo.queryJSONObject(ctx, `
		with events as (
		 select * from public.site_analytics_events e
		 where e.organization_id=$1::uuid
		   and ($2='' or e.created_at >= nullif($2,'')::date)
		   and ($3='' or e.created_at < nullif($3,'')::date + 1)
		), top_pages as (
		 select page_path, count(*)::int views from events where event_type in ('pageview','page_view')
		 group by page_path order by views desc limit 20
		), daily as (
		 select created_at::date::text date, count(*)::int views from events where event_type in ('pageview','page_view')
		 group by created_at::date order by created_at::date
		), session_metrics as (
		 select session_id, count(*) filter(where event_type in ('pageview','page_view'))::int pageviews,
		   bool_or(event_type='form_submit') converted, max(created_at) last_seen
		 from events where session_id is not null group by session_id
		), totals as (
		 select count(*)::int sessions, count(*) filter(where converted)::int converted_sessions,
		   (select count(*)::int from events where event_type='form_submit') conversions,
		   coalesce(round(sum(pageviews)::numeric/nullif(count(*),0),2),0) pages_per_session,
		   coalesce(round(count(*) filter(where pageviews<=1 and not converted)::numeric*100/nullif(count(*),0),2),0) bounce_rate,
		   (select count(distinct live.session_id)::int
		      from public.site_analytics_events live
		     where live.organization_id=$1::uuid
		       and live.session_id is not null
		       and live.created_at >= now()-interval '5 minutes') live_visitors
		 from session_metrics
		), site_leads as (
		 select count(*)::int total from public.leads l
		 where l.organization_id=$1::uuid and (l.source in ('site','website') or l.source_detail='public_site')
		   and ($2='' or l.created_at >= nullif($2,'')::date) and ($3='' or l.created_at < nullif($3,'')::date + 1)
		), campaigns as (
		 select coalesce(utm_source,'Direto') source, coalesce(utm_campaign,'Sem campanha') campaign,
		   count(distinct session_id)::int sessions, count(*) filter(where event_type='form_submit')::int conversions
		 from events group by 1,2 order by sessions desc limit 20
		)
		select jsonb_build_object(
		 'topProperties','[]'::jsonb,
		 'topPages',coalesce((select jsonb_agg(to_jsonb(x)) from top_pages x),'[]'::jsonb),
		 'dailyViews',coalesce((select jsonb_agg(to_jsonb(x)) from daily x),'[]'::jsonb),
		 'campaigns',coalesce((select jsonb_agg(to_jsonb(x)) from campaigns x),'[]'::jsonb),
		 'searchTerms','[]'::jsonb,
		 'conversionRate',case when t.sessions>0 then round(t.converted_sessions::numeric*100/t.sessions,2) else 0 end,
		 'totalSessions',t.sessions,'totalConversions',t.conversions,'siteLeads',s.total,
		 'pagesPerSession',t.pages_per_session,'bounceRate',t.bounce_rate,'liveVisitors',t.live_visitors)
		from totals t cross join site_leads s
	`, tenantContext.OrganizationID, dateOnly(values, "dateFrom"), dateOnly(values, "dateTo"))
}

func (repo Repository) leadAnalyticsLegacy(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
	return repo.queryJSONObject(ctx, `
		with events as (
		 select * from public.site_analytics_events e where e.organization_id=$1::uuid
		 and ($2='' or e.created_at >= nullif($2,'')::date) and ($3='' or e.created_at < nullif($3,'')::date + 1)
		), journeys as (
		 select session_id, array_agg(page_path order by created_at) path_sequence,
		   array_agg(event_type order by created_at) event_sequence, min(created_at)::text first_event,
		   max(created_at)::text last_event, count(*)::int total_events,
		   bool_or(event_type='form_submit') converted, max(device_type) device_type, max(browser) browser,
		   null::text os, null::text city, null::text region, null::text country,
		   max(utm_source) utm_source, max(referrer) referrer
		 from events where session_id is not null group by session_id order by max(created_at) desc limit 100
		), funnel as (
		 select event_type, count(*)::int total from events
		 where event_type not in ('session_start', 'page_duration')
		 group by event_type order by total desc
		), pages as (
		 select page_path, count(*)::int views from events where event_type in ('pageview','page_view') group by page_path order by views desc limit 20
		), daily as (
		 select created_at::date::text date, count(*)::int views from events where event_type in ('pageview','page_view') group by created_at::date order by created_at::date
		), devices as (
		 select coalesce(device_type,'unknown') device_type, count(distinct session_id)::int total from events group by device_type
		)
		select jsonb_build_object(
		 'journeys',coalesce((select jsonb_agg(to_jsonb(x)) from journeys x),'[]'::jsonb),
		 'funnel',coalesce((select jsonb_agg(to_jsonb(x)) from funnel x),'[]'::jsonb),
		 'top_pages',coalesce((select jsonb_agg(to_jsonb(x)) from pages x),'[]'::jsonb),
		 'daily_views',coalesce((select jsonb_agg(to_jsonb(x)) from daily x),'[]'::jsonb),
		 'total_sessions',(select count(distinct session_id) from events),
		 'total_conversions',(select count(*) from events where event_type='form_submit'),
		 'device_breakdown',coalesce((select jsonb_agg(to_jsonb(x)) from devices x),'[]'::jsonb),
		 'locations','[]'::jsonb)
	`, tenantContext.OrganizationID, dateOnly(values, "dateFrom"), dateOnly(values, "dateTo"))
}

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
	return repo.queryJSONObject(ctx, `
		with insights as (
			select *
			from public.meta_campaign_insights mi
			where mi.organization_id = $1::uuid
			  and ($2 = '' or mi.date_start >= nullif($2, '')::date)
			  and ($3 = '' or mi.date_stop <= nullif($3, '')::date)
		),
		campaigns as (
			select
				coalesce(campaign_id, 'unknown') as campaign_id,
				coalesce(max(campaign_name), 'Campanha') as campaign_name,
				sum(coalesce(spend, 0)) as spend,
				sum(coalesce(impressions, 0)) as impressions,
				sum(coalesce(reach, 0)) as reach,
				sum(coalesce(leads_count, 0)) as leads_count,
				sum(coalesce(conversations_count, 0)) as conversations_count,
				avg(cpl) as cpl,
				avg(ctr) as ctr,
				avg(hook_rate) as hook_rate,
				max(status) as status,
				max(budget) as budget,
				max(budget_type) as budget_type,
				max(objective) as objective
			from insights
			where level = 'campaign'
			group by coalesce(campaign_id, 'unknown')
		),
		ads as (
			select
				coalesce(ad_id, 'unknown') as ad_id,
				coalesce(max(ad_name), 'Anuncio') as ad_name,
				coalesce(max(campaign_name), 'Campanha') as campaign_name,
				sum(coalesce(spend, 0)) as spend,
				sum(coalesce(impressions, 0)) as impressions,
				sum(coalesce(reach, 0)) as reach,
				sum(coalesce(leads_count, 0)) as leads_count,
				0 as won_count,
				0 as revenue,
				avg(cpl) as cpl,
				avg(ctr) as ctr,
				avg(hook_rate) as hook_rate,
				max(creative_url) as creative_url,
				max(creative_video_url) as creative_video_url,
				max(creative_permalink_url) as creative_permalink_url
			from insights
			where level = 'ad'
			group by coalesce(ad_id, 'unknown')
		),
		daily as (
			select
				date_start::text as date,
				sum(coalesce(leads_count, 0))::int as leads,
				sum(coalesce(conversations_count, 0))::int as conversations
			from insights
			group by date_start
			order by date_start
		)
		select jsonb_build_object(
			'campaigns', coalesce((
				select jsonb_agg(jsonb_build_object(
					'campaign_id', campaign_id,
					'campaign_name', campaign_name,
					'spend', spend,
					'impressions', impressions,
					'reach', reach,
					'leads_count', leads_count,
					'conversations_count', conversations_count,
					'won_count', 0,
					'revenue', 0,
					'cpl', cpl,
					'ctr', ctr,
					'hook_rate', hook_rate,
					'status', status,
					'budget', budget,
					'budget_type', budget_type,
					'objective', objective,
					'adsets', '[]'::jsonb
				) order by leads_count desc)
				from campaigns
			), '[]'::jsonb),
			'topCreatives', coalesce((
				select jsonb_agg(jsonb_build_object(
					'ad_id', ad_id,
					'ad_name', ad_name,
					'campaign_name', campaign_name,
					'leads_count', leads_count,
					'won_count', won_count,
					'revenue', revenue,
					'score', leads_count,
					'creative_url', creative_url,
					'creative_video_url', creative_video_url,
					'creative_permalink_url', creative_permalink_url,
					'spend', spend,
					'cpl', cpl,
					'ctr', ctr,
					'hook_rate', hook_rate
				) order by leads_count desc)
				from ads
			), '[]'::jsonb),
			'dailyData', coalesce((
				select jsonb_agg(jsonb_build_object(
					'date', date,
					'leads', leads,
					'conversations', conversations,
					'total', leads + conversations
				))
				from daily
			), '[]'::jsonb),
			'summary', jsonb_build_object(
				'totalLeads', coalesce((select sum(leads_count) from campaigns), 0),
				'totalWon', 0,
				'totalRevenue', 0,
				'totalCampaigns', coalesce((select count(*) from campaigns), 0),
				'totalAdsets', coalesce((select count(distinct adset_id) from insights where adset_id is not null), 0),
				'totalAds', coalesce((select count(distinct ad_id) from insights where ad_id is not null), 0),
				'totalSpend', coalesce((select sum(spend) from campaigns), 0),
				'avgCpl', coalesce((select avg(cpl) from campaigns), 0),
				'totalImpressions', coalesce((select sum(impressions) from campaigns), 0),
				'totalReach', coalesce((select sum(reach) from campaigns), 0),
				'conversations_count', coalesce((select sum(conversations_count) from campaigns), 0)
			),
			'lastSync', (select max(fetched_at) from insights),
			'hasSpendData', exists(select 1 from insights)
		)
	`, tenantContext.OrganizationID, dateOnly(values, "dateFrom"), dateOnly(values, "dateTo"))
}

func (repo Repository) EnterpriseKPIs(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
	return repo.queryJSONObject(ctx, `
		with entries as (
			select amount, type
			from public.financial_entries fe
			where fe.organization_id = $1::uuid
			  and fe.status = 'paid'
			  and ($2 = '' or coalesce(fe.paid_date, fe.due_date)::date >= nullif($2, '')::date)
			  and ($3 = '' or coalesce(fe.paid_date, fe.due_date)::date <= nullif($3, '')::date)
		),
		totals as (
			select
				coalesce(sum(amount) filter (where type in ('revenue', 'receivable')), 0) as revenue,
				coalesce(sum(amount) filter (where type in ('expense', 'payable')), 0) as expense
			from entries
		)
		select jsonb_build_object(
			'financial', jsonb_build_object(
				'ebitda', revenue - expense,
				'revenue', revenue,
				'expense', expense,
				'roi_overview', case when expense > 0 then (revenue - expense) / expense else 0 end
			)
		)
		from totals
	`, tenantContext.OrganizationID, dateOnly(values, "dateFrom"), dateOnly(values, "dateTo"))
}

func (repo Repository) DREExecutive(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
	startDate := dateOnly(values, "startDate")
	endDate := dateOnly(values, "endDate")
	dateField := "due_date"
	if strings.TrimSpace(values.Get("regime")) == "cash" {
		dateField = "paid_date"
	}
	return repo.queryJSONObject(ctx, `
		with entries as (
			select amount, type, category_group
			from public.financial_entries fe
			where fe.organization_id = $1::uuid
			  and fe.status in ('pending', 'paid', 'overdue')
			  and ($2 = '' or coalesce(fe.`+dateField+`, fe.due_date)::date >= nullif($2, '')::date)
			  and ($3 = '' or coalesce(fe.`+dateField+`, fe.due_date)::date <= nullif($3, '')::date)
		),
		t as (
			select
				coalesce(sum(amount) filter (where type in ('receivable', 'revenue') or category_group = 'gross_revenue'), 0) as gross_revenue,
				coalesce(sum(amount) filter (where category_group = 'tax_deduction'), 0) as taxes,
				coalesce(sum(amount) filter (where category_group = 'variable_cost'), 0) as variable_costs,
				coalesce(sum(amount) filter (where type in ('payable', 'expense') and coalesce(category_group, '') <> 'variable_cost'), 0) as fixed_costs
			from entries
		)
		select jsonb_build_object(
			'period', jsonb_build_object('start', $2, 'end', $3),
			'lines', jsonb_build_array(
				jsonb_build_object('id', 'gross_rev', 'name', '(+) Receita Bruta', 'value', gross_revenue, 'isTotal', false, 'type', 'revenue', 'level', 0),
				jsonb_build_object('id', 'taxes', 'name', '(-) Deducoes e Impostos', 'value', taxes, 'isTotal', false, 'type', 'tax', 'level', 1),
				jsonb_build_object('id', 'net_rev', 'name', '(=) Receita Liquida', 'value', gross_revenue - taxes, 'isTotal', true, 'type', 'total', 'level', 0),
				jsonb_build_object('id', 'var_costs', 'name', '(-) Custos Variaveis', 'value', variable_costs, 'isTotal', false, 'type', 'expense', 'level', 1),
				jsonb_build_object('id', 'gross_profit', 'name', '(=) Lucro Bruto', 'value', gross_revenue - taxes - variable_costs, 'isTotal', true, 'type', 'total', 'level', 0),
				jsonb_build_object('id', 'fixed_costs', 'name', '(-) Custos Fixos', 'value', fixed_costs, 'isTotal', false, 'type', 'expense', 'level', 1),
				jsonb_build_object('id', 'ebitda', 'name', '(=) EBITDA', 'value', gross_revenue - taxes - variable_costs - fixed_costs, 'isTotal', true, 'type', 'total', 'level', 0),
				jsonb_build_object('id', 'net_result', 'name', '(=) Lucro Liquido', 'value', gross_revenue - taxes - variable_costs - fixed_costs, 'isTotal', true, 'type', 'total', 'level', 0)
			),
			'totals', jsonb_build_object(
				'grossRevenue', gross_revenue,
				'netRevenue', gross_revenue - taxes,
				'grossProfit', gross_revenue - taxes - variable_costs,
				'operatingResult', gross_revenue - taxes - variable_costs - fixed_costs,
				'netResult', gross_revenue - taxes - variable_costs - fixed_costs,
				'ebitda', gross_revenue - taxes - variable_costs - fixed_costs,
				'roi', case when variable_costs + fixed_costs > 0 then (gross_revenue - taxes - variable_costs - fixed_costs) / (variable_costs + fixed_costs) else 0 end,
				'fixedCosts', fixed_costs,
				'variableCosts', variable_costs
			)
		)
		from t
	`, tenantContext.OrganizationID, startDate, endDate)
}

func (repo Repository) SlaSummary(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
	return repo.queryJSONObject(ctx, `
		select jsonb_build_object(
			'totalPending', count(*),
			'totalWarning', 0,
			'totalOverdue', 0,
			'avgResponseTime', avg(first_response_seconds),
			'slaComplianceRate', null
		)
		from public.leads l
		where l.organization_id = $1::uuid
		  and ($2 = '' or l.pipeline_id = nullif($2, '')::uuid)
	`, tenantContext.OrganizationID, values.Get("pipelineId"))
}

func (repo Repository) SlaPerformanceByUser(ctx context.Context, tenantContext tenant.Context, values url.Values) ([]map[string]any, error) {
	return repo.queryJSONRows(ctx, `
		select jsonb_build_object(
			'user_id', u.id::text,
			'user_name', u.name,
			'total_leads', count(l.id),
			'responded_in_time', 0,
			'responded_late', 0,
			'pending_response', count(l.id) filter (where l.first_response_at is null),
			'overdue_count', 0,
			'avg_response_seconds', avg(l.first_response_seconds),
			'avg_first_touch_seconds', avg(l.first_touch_seconds),
			'sla_compliance_rate', null
		)
		from public.users u
		join public.organization_members om
		  on om.user_id = u.id
		 and om.organization_id = $1::uuid
		left join public.leads l on l.assigned_user_id = u.id
		  and l.organization_id = $1::uuid
		  and ($2 = '' or l.pipeline_id = nullif($2, '')::uuid)
		  and ($3 = '' or l.created_at >= nullif($3, '')::timestamptz)
		  and ($4 = '' or l.created_at <= nullif($4, '')::timestamptz)
		where coalesce(u.is_active, false) = true
		  and coalesce(om.is_active, false) = true
		group by u.id, u.name
		order by count(l.id) desc
	`, tenantContext.OrganizationID, values.Get("pipelineId"), values.Get("startDate"), values.Get("endDate"))
}

func (repo Repository) TeamRanking(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
	return repo.queryJSONObject(ctx, `
		with users as (
			select u.id::text, u.name, u.avatar_url
			from public.users u
			join public.organization_members om
			  on om.user_id = u.id
			 and om.organization_id = $1::uuid
			where coalesce(u.is_active, false) = true
			  and coalesce(om.is_active, false) = true
		),
		counts as (
			select assigned_user_id::text as user_id, count(*)::int as closed_count
			from public.leads
			where organization_id = $1::uuid
			  and deal_status = 'won'
			  and assigned_user_id is not null
			  and ($3 = '' or won_at >= nullif($3, '')::timestamptz)
			  and ($4 = '' or won_at <= nullif($4, '')::timestamptz)
			group by assigned_user_id
		),
		ranking as (
			select
				u.id,
				u.name,
				u.avatar_url,
				coalesce(c.closed_count, 0) as closed_count,
				row_number() over (order by coalesce(c.closed_count, 0) desc, u.name asc) as position
			from users u
			left join counts c on c.user_id = u.id
		)
		select jsonb_build_object(
			'ranking', coalesce(jsonb_agg(jsonb_build_object(
				'userId', id,
				'userName', name,
				'avatarUrl', avatar_url,
				'closedCount', closed_count,
				'position', position,
				'isCurrentUser', id = $2
			) order by position), '[]'::jsonb),
			'myPosition', (select position from ranking where id = $2)
		)
		from ranking
	`, tenantContext.OrganizationID, tenantContext.UserID, values.Get("dateFrom"), values.Get("dateTo"))
}

func (repo Repository) VGVStats(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
	return repo.queryJSONObject(ctx, `
		select jsonb_build_object(
			'totalVGV', coalesce(sum(valor_interesse), 0),
			'wonVGV', coalesce(sum(valor_interesse) filter (where deal_status = 'won'), 0),
			'openVGV', coalesce(sum(valor_interesse) filter (where coalesce(deal_status, 'open') not in ('won', 'lost')), 0),
			'lostVGV', coalesce(sum(valor_interesse) filter (where deal_status = 'lost'), 0),
			'totalLeads', count(*),
			'wonLeads', count(*) filter (where deal_status = 'won'),
			'openLeads', count(*) filter (where coalesce(deal_status, 'open') not in ('won', 'lost')),
			'lostLeads', count(*) filter (where deal_status = 'lost')
		)
		from public.leads l
		where l.organization_id = $1::uuid
		  and ($2 = '' or l.created_at >= nullif($2, '')::timestamptz)
		  and ($3 = '' or l.created_at <= nullif($3, '')::timestamptz)
		  and ($4 = '' or l.assigned_user_id = nullif($4, '')::uuid)
		  and ($5 = '' or l.pipeline_id = nullif($5, '')::uuid)
	`, tenantContext.OrganizationID, values.Get("dateFrom"), values.Get("dateTo"), values.Get("userId"), values.Get("pipelineId"))
}

func (repo Repository) VGVByBroker(ctx context.Context, tenantContext tenant.Context, values url.Values) ([]map[string]any, error) {
	return repo.queryJSONRows(ctx, `
		select jsonb_build_object(
			'user_id', u.id::text,
			'user_name', u.name,
			'user_avatar', u.avatar_url,
			'won_count', count(l.id) filter (where l.deal_status = 'won'),
			'won_vgv', coalesce(sum(l.valor_interesse) filter (where l.deal_status = 'won'), 0),
			'open_count', count(l.id) filter (where coalesce(l.deal_status, 'open') not in ('won', 'lost')),
			'open_vgv', coalesce(sum(l.valor_interesse) filter (where coalesce(l.deal_status, 'open') not in ('won', 'lost')), 0),
			'total_commission', coalesce((
				select sum(c.amount)
				from public.commissions c
				where c.user_id = u.id
				  and c.organization_id = $1::uuid
			), 0)
		)
		from public.users u
		join public.organization_members om
		  on om.user_id = u.id
		 and om.organization_id = $1::uuid
		left join public.leads l on l.assigned_user_id = u.id
		  and l.organization_id = $1::uuid
		  and ($2 = '' or l.created_at >= nullif($2, '')::timestamptz)
		  and ($3 = '' or l.created_at <= nullif($3, '')::timestamptz)
		where coalesce(u.is_active, false) = true
		  and coalesce(om.is_active, false) = true
		group by u.id, u.name, u.avatar_url
		order by coalesce(sum(l.valor_interesse) filter (where l.deal_status = 'won'), 0) desc
	`, tenantContext.OrganizationID, values.Get("dateFrom"), values.Get("dateTo"))
}

func (repo Repository) StageVGV(ctx context.Context, tenantContext tenant.Context, values url.Values) ([]map[string]any, error) {
	return repo.queryJSONRows(ctx, `
		select jsonb_build_object(
			'stageId', l.stage_id::text,
			'totalVGV', coalesce(sum(l.valor_interesse), 0),
			'openVGV', coalesce(sum(l.valor_interesse) filter (where coalesce(l.deal_status, 'open') not in ('won', 'lost')), 0),
			'wonVGV', coalesce(sum(l.valor_interesse) filter (where l.deal_status = 'won'), 0),
			'leadsCount', count(*)
		)
		from public.leads l
		where l.organization_id = $1::uuid
		  and ($2 = '' or l.pipeline_id = nullif($2, '')::uuid)
		  and l.stage_id is not null
		group by l.stage_id
	`, tenantContext.OrganizationID, values.Get("pipelineId"))
}

func (repo Repository) LeaderStats(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	return repo.queryJSONRows(ctx, `
		with leader_teams as (
			select tm.user_id, tm.team_id, u.name as user_name, t.name as team_name
			from public.team_members tm
			join public.users u on u.id = tm.user_id
			join public.teams t on t.id = tm.team_id
			where tm.organization_id = $1::uuid
			  and tm.is_leader = true
		)
		select jsonb_build_object(
			'userId', lt.user_id::text,
			'userName', lt.user_name,
			'teamId', lt.team_id::text,
			'teamName', lt.team_name,
			'totalLeads', count(l.id),
			'convertedLeads', count(l.id) filter (where l.deal_status = 'won'),
			'conversionRate', case when count(l.id) > 0 then round((count(l.id) filter (where l.deal_status = 'won'))::numeric * 100 / count(l.id), 0) else 0 end,
			'avgTimeInStage', null
		)
		from leader_teams lt
		left join public.team_pipelines tp on tp.team_id = lt.team_id
		left join public.leads l on l.pipeline_id = tp.pipeline_id and l.organization_id = $1::uuid
		group by lt.user_id, lt.user_name, lt.team_id, lt.team_name
	`, tenantContext.OrganizationID)
}

func (repo Repository) TeamLeaderStats(ctx context.Context, tenantContext tenant.Context, teamID string) ([]map[string]any, error) {
	return repo.queryJSONRows(ctx, `
		select jsonb_build_object(
			'userId', tm.user_id::text,
			'user', jsonb_build_object('id', u.id::text, 'name', u.name, 'avatar_url', u.avatar_url),
			'assignedLeads', (
				select count(*)
				from public.leads l
				where l.organization_id = $1::uuid
				  and l.assigned_user_id = tm.user_id
			)
		)
		from public.team_members tm
		join public.users u on u.id = tm.user_id
		where tm.organization_id = $1::uuid
		  and tm.team_id = $2::uuid
		  and tm.is_leader = true
	`, tenantContext.OrganizationID, teamID)
}

func (repo Repository) EmptyObject(ctx context.Context, value map[string]any) (map[string]any, error) {
	return value, nil
}

func (repo Repository) EmptyRows(ctx context.Context) ([]map[string]any, error) {
	return []map[string]any{}, nil
}

func (repo Repository) queryJSONRows(ctx context.Context, sql string, args ...any) ([]map[string]any, error) {
	rows, err := repo.db.Pool().Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []map[string]any{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var item map[string]any
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (repo Repository) queryJSONObject(ctx context.Context, sql string, args ...any) (map[string]any, error) {
	var raw []byte
	if err := repo.db.Pool().QueryRow(ctx, sql, args...).Scan(&raw); err != nil {
		return nil, err
	}
	var item map[string]any
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil, err
	}
	return item, nil
}

func dateOnly(values url.Values, key string) string {
	value := strings.TrimSpace(values.Get(key))
	if len(value) >= 10 {
		return value[:10]
	}
	return value
}
