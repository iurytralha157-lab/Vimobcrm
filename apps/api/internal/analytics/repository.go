package analytics

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

var ErrInvalidInput = errors.New("invalid analytics input")

type Repository struct {
	db *dbpkg.Postgres
}

func NewRepository(db *dbpkg.Postgres) Repository {
	return Repository{db: db}
}

func (repo Repository) SiteSummary(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
	if err := validateSiteAnalyticsValues(values); err != nil {
		return nil, err
	}

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
	if err := validateSiteAnalyticsValues(values); err != nil {
		return nil, err
	}

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
	if err := validateSiteAnalyticsValues(values); err != nil {
		return nil, err
	}

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
	if err := validateCampaignInsightsValues(values); err != nil {
		return nil, err
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
				nullif($10, '')::uuid as tag_id,
				nullif($11, '') as deal_status,
				(
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
			  and (params.campaign_id is null or metric.campaign_id = params.campaign_id)
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
			      and level = 'adset'
			      and adset_id = scope.selected_adset_id
			    )
			    or (
			      scope.selected_ad_id is null
			      and scope.selected_adset_id is null
			      and level = 'campaign'
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
			      and level = 'adset'
			      and (
			        scope.selected_adset_id is null
			        or adset_id = scope.selected_adset_id
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
				nullif(entry.ad_name, '') as ad_name
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
			  and (params.team_id is null or lead.team_id = params.team_id)
			  and (params.user_id is null or lead.assigned_user_id = params.user_id)
			  and (
			    params.source is null
			    or params.source in ('meta', 'meta_ads', 'facebook', 'instagram')
			  )
			  and (params.deal_status is null or lead.deal_status = params.deal_status)
			  and (
			    params.tag_id is null
			    or exists (
			      select 1
			      from public.lead_tags as lead_tag
			      where lead_tag.organization_id = $1::uuid
			        and lead_tag.lead_id = lead.id
			        and lead_tag.tag_id = params.tag_id
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
			    and metric.level = 'adset'
			    and metric.adset_id = params.adset_id
			  )
			  or (
			    params.ad_id is null
			    and params.adset_id is null
			    and params.campaign_id is not null
			    and metric.level = 'campaign'
			  )
			  or (
			    params.ad_id is null
			    and params.adset_id is null
			    and params.campaign_id is null
			    and (
			      metric.level = 'account'
			      or (
			        metric.level = 'campaign'
			        and not exists (
			          select 1
			          from paid as account_metric
			          where account_metric.level = 'account'
			            and account_metric.external_account_id = metric.external_account_id
			            and account_metric.metric_date = metric.metric_date
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
			select integration.*
			from public.meta_integrations as integration
			join vault.decrypted_secrets as page_secret
			  on page_secret.id = integration.access_token_secret_ref
			 and nullif(page_secret.decrypted_secret, '') is not null
			join vault.decrypted_secrets as user_secret
			  on user_secret.id = integration.user_access_token_secret_ref
			 and nullif(user_secret.decrypted_secret, '') is not null
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
				max(last_sync_at) as last_sync_at,
				count(*) > 0 as connected
			from healthy_meta_integrations
		)
		select jsonb_build_object(
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
						asset.metrics,
						asset.last_synced_at
					from public.marketing_media_assets as asset
					cross join params
					cross join time_bounds
					where asset.organization_id = $1::uuid
					  and (params.campaign_id is null or asset.campaign_id = params.campaign_id)
					  and (params.adset_id is null or asset.adset_id = params.adset_id)
					  and (params.ad_id is null or asset.ad_id = params.ad_id)
					  and (
					    (
					      asset.source_kind = 'paid'
					      and asset.ad_id is not null
					      and exists (
					        select 1
					        from paid_ads as current_paid_ad
					        where current_paid_ad.ad_id = asset.ad_id
					      )
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
				'lastIntegrationSync', (select last_sync_at from connection)
			),
			'dataQuality', jsonb_build_object(
				'model', 'daily_facts_v1',
				'attribution', 'last_meta_touch_in_entry_cohort',
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
						then 'account_with_campaign_fallback'
					when exists(select 1 from paid_selected where level = 'account')
						then 'account'
					else 'campaign_fallback'
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
		values.Get("tagId"),
		values.Get("dealStatus"),
	)
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

func validateSiteAnalyticsValues(values url.Values) error {
	const dateLayout = "2006-01-02"

	dates := make(map[string]time.Time, 2)
	for _, key := range []string{"dateFrom", "dateTo"} {
		value := strings.TrimSpace(values.Get(key))
		if value == "" {
			continue
		}

		parsed, err := time.Parse(dateLayout, value)
		if err != nil || parsed.Format(dateLayout) != value {
			return fmt.Errorf("%w: %s must use YYYY-MM-DD", ErrInvalidInput, key)
		}
		dates[key] = parsed
	}

	start, hasStart := dates["dateFrom"]
	end, hasEnd := dates["dateTo"]
	if !hasStart || !hasEnd {
		return nil
	}
	if end.Before(start) {
		return fmt.Errorf("%w: dateTo must be on or after dateFrom", ErrInvalidInput)
	}
	if end.Sub(start) > 365*24*time.Hour {
		return fmt.Errorf("%w: date range cannot exceed 366 days", ErrInvalidInput)
	}

	return nil
}

func validateCampaignInsightsValues(values url.Values) error {
	const dateLayout = "2006-01-02"

	dates := make(map[string]time.Time, 2)
	for _, key := range []string{"dateFrom", "dateTo"} {
		value := strings.TrimSpace(values.Get(key))
		if value == "" {
			continue
		}

		parsed, err := time.Parse(dateLayout, value)
		if err != nil || parsed.Format(dateLayout) != value {
			return fmt.Errorf("%w: %s must use YYYY-MM-DD", ErrInvalidInput, key)
		}
		dates[key] = parsed
	}

	start, hasStart := dates["dateFrom"]
	end, hasEnd := dates["dateTo"]
	if !hasStart || !hasEnd {
		return fmt.Errorf("%w: dateFrom and dateTo are required", ErrInvalidInput)
	}
	if end.Before(start) {
		return fmt.Errorf("%w: dateTo must be on or after dateFrom", ErrInvalidInput)
	}
	if end.Sub(start) > 365*24*time.Hour {
		return fmt.Errorf("%w: date range cannot exceed 366 days", ErrInvalidInput)
	}

	for _, key := range []string{"teamId", "userId", "tagId"} {
		value := strings.TrimSpace(values.Get(key))
		if value == "" {
			continue
		}
		var id pgtype.UUID
		if err := id.Scan(value); err != nil || !id.Valid {
			return fmt.Errorf("%w: %s must be a UUID", ErrInvalidInput, key)
		}
	}

	return nil
}
