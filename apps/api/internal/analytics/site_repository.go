package analytics

import (
	"context"
	"net/url"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// siteAcquisitionSourceTypeSQL is shared by summary and detailed analytics so
// that every site dashboard applies the same first-touch channel precedence.
// Explicit paid/campaign markers must win over social and organic-search
// hints. A Facebook click id alone proves social origin, not paid delivery.
const siteAcquisitionSourceTypeSQL = `case
	when coalesce(google_ads_click, false)
	  or nullif(btrim(utm_campaign), '') is not null
	  or lower(coalesce(nullif(btrim(utm_medium), ''), '')) in ('cpc', 'ppc', 'paid', 'paid_search', 'paid-search', 'paid_social', 'paid-social', 'display', 'affiliate') then 'campaign'
	when coalesce(facebook_click, false)
	  or lower(coalesce(nullif(btrim(utm_medium), ''), '')) in ('social', 'organic_social', 'organic-social')
	  or lower(coalesce(utm_source, '')) ~ '(^|[^a-z0-9])(facebook|instagram|meta|linkedin|tiktok)([^a-z0-9]|$)'
	  or lower(coalesce(substring(referrer from '^https?://([^/:]+)'), ''))
	    ~ '(^|\.)(facebook\.com|fb\.com|instagram\.com|linkedin\.com|tiktok\.com)$' then 'social'
	when lower(coalesce(nullif(btrim(utm_medium), ''), '')) in ('organic', 'search', 'organic_search', 'organic-search', 'seo')
	  or lower(coalesce(utm_source, '')) ~ '(^|[^a-z])(google|bing|yahoo)([^a-z]|$)'
	  or lower(coalesce(substring(referrer from '^https?://([^/:]+)'), ''))
	    ~ '(^|\.)(google\.(com|cat|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})|bing\.com|yahoo\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2}))$' then 'search'
	when nullif(btrim(utm_source), '') is not null or nullif(btrim(utm_medium), '') is not null then 'campaign'
	when nullif(btrim(referrer), '') is null then 'direct'
	else 'referral'
end`

// siteAcquisitionSourceLabelSQL is evaluated after source_type is available.
// It prevents organic and referral traffic without UTM tags from being
// presented as "Direto" in the detailed acquisition list.
const siteAcquisitionSourceLabelSQL = `coalesce(
	nullif(btrim(utm_source), ''),
	case
		when coalesce(google_ads_click, false) then 'Google Ads'
		when coalesce(facebook_click, false) then 'Facebook / Meta'
	end,
	nullif(substring(referrer from '^https?://([^/]+)'), ''),
	case source_type
		when 'search' then 'Busca organica'
		when 'social' then 'Redes sociais'
		when 'campaign' then 'Campanha'
		when 'referral' then 'Referencia'
		else 'Direto'
	end
)`

func (repo Repository) SiteSummary(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
	if err := validateSiteAnalyticsValues(values); err != nil {
		return nil, err
	}
	capabilities, err := repo.resolveSiteAnalyticsCapabilities(ctx)
	if err != nil {
		return nil, err
	}
	lastObservedAtSQL := siteAnalyticsObservedAtSQL("e.", capabilities.lastSeenAt)

	return repo.queryJSONObject(ctx, `
		with report_settings as (
			select coalesce(
				(
					select nullif(btrim(settings.timezone), '')
					from public.organization_attention_settings as settings
					where settings.organization_id = $1::uuid
				),
				'America/Sao_Paulo'
			) as timezone_name
		), bounds as (
			select coalesce(nullif($2, '')::date, (current_timestamp at time zone report_settings.timezone_name)::date - 6) as date_from,
			       coalesce(nullif($3, '')::date, (current_timestamp at time zone report_settings.timezone_name)::date) as date_to,
			       report_settings.timezone_name
			from report_settings
		), periods as (
			select date_from,
			       date_to,
			       (date_to - date_from + 1) as days,
			       date_from::timestamp at time zone timezone_name as starts_at,
			       (date_to + 1)::timestamp at time zone timezone_name as ends_at,
			       timezone_name
			from bounds
		), current_events as (
			select e.* from public.site_analytics_events e, periods p
			where e.organization_id = $1::uuid and e.created_at >= p.starts_at and e.created_at < p.ends_at
		), previous_events as (
			select e.* from public.site_analytics_events e, periods p
			where e.organization_id = $1::uuid
			  and e.created_at >= (p.date_from - p.days)::timestamp at time zone p.timezone_name
			  and e.created_at < p.starts_at
		), session_sources as (
			select distinct on (session_id) session_id, utm_source, utm_medium, utm_campaign, referrer,
			       (metadata->>'google_ads_click' = 'true' or nullif(btrim(metadata->>'gclid'), '') is not null) google_ads_click,
			       (metadata->>'facebook_click' = 'true' or nullif(btrim(metadata->>'fbclid'), '') is not null) facebook_click
			from current_events
			where session_id is not null and session_id not like 'site-contact:%'
			order by session_id, created_at, id
		), current_sessions as (
			select session_id,
			       duration,
			       duration_measured,
			       case
			         when first_device in ('desktop', 'mobile', 'tablet') then first_device
			         else 'other'
			       end device_type
			from (
				select session_id,
				       sum(coalesce(duration_seconds, 0))::numeric duration,
				       bool_or(event_type = 'page_duration') duration_measured,
				       (array_agg(lower(btrim(device_type)) order by created_at, id)
				         filter (where nullif(btrim(device_type), '') is not null))[1] first_device
				from current_events
				where session_id is not null and session_id not like 'site-contact:%'
				group by session_id
			) session_events
		), previous_sessions as (
			select session_id,
			       duration,
			       duration_measured,
			       case
			         when first_device in ('desktop', 'mobile', 'tablet') then first_device
			         else 'other'
			       end device_type
			from (
				select session_id,
				       sum(coalesce(duration_seconds, 0))::numeric duration,
				       bool_or(event_type = 'page_duration') duration_measured,
				       (array_agg(lower(btrim(device_type)) order by created_at, id)
				         filter (where nullif(btrim(device_type), '') is not null))[1] first_device
				from previous_events
				where session_id is not null and session_id not like 'site-contact:%'
				group by session_id
			) session_events
		), totals as (
			select count(*) filter (where event_type in ('pageview','page_view'))::int views,
			       count(distinct page_path) filter (where event_type in ('pageview','page_view'))::int unique_pages,
			       (select count(*)::int from current_sessions) sessions,
			       (select count(*)::int from current_sessions where duration_measured) measured_sessions,
			       coalesce((select round(avg(duration)) from current_sessions where duration_measured), 0)::int avg_duration,
			       count(*) filter (where event_type = 'form_submit')::int conversions,
			       (select count(*)::numeric from current_sessions where device_type = 'desktop') desktop,
			       (select count(*)::numeric from current_sessions where device_type = 'mobile') mobile,
			       (select count(*)::numeric from current_sessions where device_type = 'tablet') tablet,
			       (select count(*)::numeric from current_sessions where device_type = 'other') other_device
			from current_events
		), previous as (
			select count(*) filter (where event_type in ('pageview','page_view'))::int views,
			       count(distinct page_path) filter (where event_type in ('pageview','page_view'))::int unique_pages,
			       (select count(*)::int from previous_sessions) sessions,
			       coalesce((select round(avg(duration)) from previous_sessions where duration_measured), 0)::int avg_duration,
			       count(*) filter (where event_type = 'form_submit')::int conversions,
			       count(distinct session_id) filter (
			         where event_type = 'form_submit' and session_id not like 'site-contact:%'
			       )::int converted_sessions,
			       (select count(*)::numeric from previous_sessions where device_type = 'desktop') desktop,
			       (select count(*)::numeric from previous_sessions where device_type = 'mobile') mobile
			from previous_events
		), classified_sources as (
			select `+siteAcquisitionSourceTypeSQL+` source_type
			from session_sources
		), sources as (
			select count(*)::numeric total,
			 count(*) filter (where source_type='direct')::numeric direct,
			 count(*) filter (where source_type='search')::numeric search,
			 count(*) filter (where source_type='social')::numeric social,
			 count(*) filter (where source_type='campaign')::numeric campaign,
			 count(*) filter (where source_type='referral')::numeric referral
			from classified_sources
		), device_percentages as (
			select case when t.sessions>0 then round(t.desktop*100/t.sessions,2) else 0 end desktop_pct,
			       case when t.sessions>0 then round(t.mobile*100/t.sessions,2) else 0 end mobile_pct,
			       case when t.sessions>0 then round(t.tablet*100/t.sessions,2) else 0 end tablet_pct,
			       case when t.sessions>0 then round(t.other_device*100/t.sessions,2) else 0 end other_pct,
			       case
			         when t.sessions=0 then 'none'
			         when t.desktop >= t.mobile and t.desktop >= t.tablet and t.desktop >= t.other_device then 'desktop'
			         when t.mobile >= t.tablet and t.mobile >= t.other_device then 'mobile'
			         when t.tablet >= t.other_device then 'tablet'
			         else 'other'
			       end balance_device
			from totals t
		), freshness as (
			select max(`+lastObservedAtSQL+`) as last_collected_at
			from public.site_analytics_events e
			where e.organization_id = $1::uuid
		)
		select jsonb_build_object(
		 'totalViews', t.views, 'totalPages', t.views, 'uniquePages', t.unique_pages, 'uniqueSessions', t.sessions,
		 'measuredSessions', t.measured_sessions,
		 'lastCollectedAt', f.last_collected_at,
		 'avgDuration', t.avg_duration,
		 'desktopPct', case when d.balance_device='desktop' then 100-d.mobile_pct-d.tablet_pct-d.other_pct else d.desktop_pct end,
		 'mobilePct', case when d.balance_device='mobile' then 100-d.desktop_pct-d.tablet_pct-d.other_pct else d.mobile_pct end,
		 'tabletPct', case when d.balance_device='tablet' then 100-d.desktop_pct-d.mobile_pct-d.other_pct else d.tablet_pct end,
		 'otherDevicePct', case when d.balance_device='other' then 100-d.desktop_pct-d.mobile_pct-d.tablet_pct else d.other_pct end,
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
		 'prevConversionRate', case when p.sessions>0 then round(p.converted_sessions::numeric*100/p.sessions,2) else 0 end)
		from totals t cross join previous p cross join sources s cross join device_percentages d cross join freshness f
	`, tenantContext.OrganizationID, dateOnly(values, "dateFrom"), dateOnly(values, "dateTo"))
}

func (repo Repository) SiteDetailed(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
	if err := validateSiteAnalyticsValues(values); err != nil {
		return nil, err
	}

	capabilities, err := repo.resolveSiteAnalyticsCapabilities(ctx)
	if err != nil {
		return nil, err
	}
	if !capabilities.trackingV2 {
		return repo.siteDetailedLegacy(ctx, tenantContext, values, capabilities)
	}
	liveObservedAtSQL := siteAnalyticsObservedAtSQL("live.", capabilities.lastSeenAt)
	return repo.queryJSONObject(ctx, `
		with params as (
		 select nullif($2, '')::date as date_from, nullif($3, '')::date as date_to
		), report_settings as (
		 select coalesce(
		   (
		     select nullif(btrim(settings.timezone), '')
		     from public.organization_attention_settings as settings
		     where settings.organization_id = $1::uuid
		   ),
		   'America/Sao_Paulo'
		 ) as timezone_name
		), bounds as (
		 select coalesce(params.date_from, (current_timestamp at time zone report_settings.timezone_name)::date - 6) date_from,
		   coalesce(params.date_to, (current_timestamp at time zone report_settings.timezone_name)::date) date_to,
		   report_settings.timezone_name
		 from params cross join report_settings
		), time_bounds as (
		 select date_from::timestamp at time zone timezone_name starts_at,
		   (date_to + 1)::timestamp at time zone timezone_name ends_at,
		   timezone_name
		 from bounds
		), events as (
		 select e.* from public.site_analytics_events e cross join time_bounds
		 where e.organization_id=$1::uuid
		   and e.created_at >= time_bounds.starts_at
		   and e.created_at < time_bounds.ends_at
		), top_properties as (
		 select e.property_id, coalesce(max(p.title),'Imovel') title, coalesce(max(p.code),'') code,
		   count(*) filter(where e.event_type in ('pageview','page_view'))::int views,
		   count(*) filter(where e.event_type='favorite')::int favorites
		 from events e join public.properties p on p.id=e.property_id and p.organization_id=e.organization_id
		 where e.property_id is not null
		 group by e.property_id
		 having count(*) filter(where e.event_type in ('pageview','page_view')) > 0
		 order by views desc limit 20
		), top_pages as (
		 select page_path, count(*)::int views from events where event_type in ('pageview','page_view')
		 group by page_path order by views desc limit 20
		), daily as (
		 select (e.created_at at time zone time_bounds.timezone_name)::date::text date, count(*)::int views
		 from events e cross join time_bounds where e.event_type in ('pageview','page_view')
		 group by (e.created_at at time zone time_bounds.timezone_name)::date
		 order by (e.created_at at time zone time_bounds.timezone_name)::date
		), session_metrics as (
		 select session_id,
		   count(*) filter(where event_type in ('pageview','page_view'))::int pageviews,
		   bool_or(event_type='form_submit') converted,
		   max(created_at) last_seen
		 from events where session_id is not null and session_id not like 'site-contact:%' group by session_id
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
		       and live.session_id not like 'site-contact:%'
		       and (live.created_at >= now()-interval '5 minutes'
		         or (live.event_type='page_duration'
		           and `+liveObservedAtSQL+` >= now()-interval '5 minutes'))) live_visitors
		 from session_metrics
		), site_leads as (
		 select count(*)::int total from public.leads l cross join time_bounds
		 where l.organization_id=$1::uuid and (l.source in ('site','website') or l.source_detail='public_site')
		   and l.created_at >= time_bounds.starts_at
		   and l.created_at < time_bounds.ends_at
		), session_sources as (
		 select distinct on (session_id) session_id, utm_source, utm_medium, utm_campaign, referrer,
		   (metadata->>'google_ads_click' = 'true' or nullif(btrim(metadata->>'gclid'), '') is not null) google_ads_click,
		   (metadata->>'facebook_click' = 'true' or nullif(btrim(metadata->>'fbclid'), '') is not null) facebook_click
		 from events
		 where session_id is not null and session_id not like 'site-contact:%'
		 order by session_id, created_at, id
		), typed_sessions as (
		 select session_sources.*, `+siteAcquisitionSourceTypeSQL+` source_type
		 from session_sources
		), classified_sessions as (
		 select session_id,
		   `+siteAcquisitionSourceLabelSQL+` source,
		   coalesce(nullif(btrim(utm_campaign), ''), 'Sem campanha') campaign,
		   source_type
		 from typed_sessions
		), session_conversions as (
		 select session_id, count(*) filter(where event_type='form_submit')::int conversions
		 from events where session_id is not null and session_id not like 'site-contact:%' group by session_id
		), campaigns as (
		 select classified.source, classified.campaign, classified.source_type,
		   count(*)::int sessions, coalesce(sum(conversions.conversions), 0)::int conversions
		 from classified_sessions classified
		 left join session_conversions conversions using (session_id)
		 group by classified.source, classified.campaign, classified.source_type
		 order by sessions desc limit 20
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

	capabilities, err := repo.resolveSiteAnalyticsCapabilities(ctx)
	if err != nil {
		return nil, err
	}
	if !capabilities.trackingV2 {
		return repo.leadAnalyticsLegacy(ctx, tenantContext, values, capabilities)
	}
	lastObservedAtSQL := siteAnalyticsObservedAtSQL("", capabilities.lastSeenAt)
	return repo.queryJSONObject(ctx, `
		with params as (
		 select nullif($2, '')::date as date_from, nullif($3, '')::date as date_to
		), report_settings as (
		 select coalesce(
		   (
		     select nullif(btrim(settings.timezone), '')
		     from public.organization_attention_settings as settings
		     where settings.organization_id = $1::uuid
		   ),
		   'America/Sao_Paulo'
		 ) as timezone_name
		), bounds as (
		 select coalesce(params.date_from, (current_timestamp at time zone report_settings.timezone_name)::date - 6) date_from,
		   coalesce(params.date_to, (current_timestamp at time zone report_settings.timezone_name)::date) date_to,
		   report_settings.timezone_name
		 from params cross join report_settings
		), time_bounds as (
		 select date_from::timestamp at time zone timezone_name starts_at,
		   (date_to + 1)::timestamp at time zone timezone_name ends_at,
		   timezone_name
		 from bounds
		), events as (
		 select e.* from public.site_analytics_events e cross join time_bounds where e.organization_id=$1::uuid
		 and e.created_at >= time_bounds.starts_at
		 and e.created_at < time_bounds.ends_at
		), journeys as (
		 select session_id,
		   coalesce(
		     array_agg(page_path order by created_at, id)
		       filter (where event_type in ('pageview','page_view') and nullif(btrim(page_path), '') is not null),
		     array[]::text[]
		   ) path_sequence,
		   array_agg(event_type order by created_at, id) event_sequence, min(created_at)::text first_event,
		   max(`+lastObservedAtSQL+`)::text last_event, count(*)::int total_events,
		   bool_or(event_type='form_submit') converted, max(device_type) device_type, max(browser) browser,
		   max(metadata->>'os') os, max(metadata->>'city') city, max(metadata->>'region') region,
		   max(metadata->>'country') country,
		   coalesce(
		     max(nullif(btrim(utm_source), '')),
		     case
		       when bool_or(metadata->>'google_ads_click' = 'true' or nullif(btrim(metadata->>'gclid'), '') is not null) then 'Google Ads'
		       when bool_or(metadata->>'facebook_click' = 'true' or nullif(btrim(metadata->>'fbclid'), '') is not null) then 'Facebook / Meta'
		     end
		   ) utm_source,
		   max(referrer) referrer
		 from events
		 where session_id is not null and session_id not like 'site-contact:%'
		 group by session_id order by max(`+lastObservedAtSQL+`) desc limit 100
		), funnel as (
		 select case when event_type in ('pageview','page_view') then 'pageview' else event_type end event_type,
		   count(distinct session_id)::int total from events
		 where session_id is not null and session_id not like 'site-contact:%'
		   and event_type not in ('session_start', 'page_duration')
		 group by 1 order by total desc
		), pages as (
		 select page_path, count(*)::int views from events where event_type in ('pageview','page_view') group by page_path order by views desc limit 20
		), daily as (
		 select (e.created_at at time zone time_bounds.timezone_name)::date::text date, count(*)::int views
		 from events e cross join time_bounds where e.event_type in ('pageview','page_view')
		 group by (e.created_at at time zone time_bounds.timezone_name)::date
		 order by (e.created_at at time zone time_bounds.timezone_name)::date
		), session_devices as (
		 select session_id,
		   case when first_device in ('desktop', 'mobile', 'tablet') then first_device else 'other' end device_type
		 from (
		   select session_id,
		     (array_agg(lower(btrim(device_type)) order by created_at, id)
		       filter (where nullif(btrim(device_type), '') is not null))[1] first_device
		   from events where session_id is not null and session_id not like 'site-contact:%' group by session_id
		 ) session_device_values
		), devices as (
		 select device_type, count(*)::int total from session_devices group by device_type
		), locations as (
		 select coalesce(max(metadata->>'city'), max(metadata->>'country'), 'Localizacao nao identificada') city,
		   max(metadata->>'region') region, max(metadata->>'country') country,
		   max(case when metadata->>'lat' ~ '^-?[0-9]+([.][0-9]+)?$' then (metadata->>'lat')::numeric end) lat,
		   max(case when metadata->>'lng' ~ '^-?[0-9]+([.][0-9]+)?$' then (metadata->>'lng')::numeric end) lng,
		   count(distinct session_id)::int sessions
		 from events
		 where session_id is not null
		   and session_id not like 'site-contact:%'
		   and (metadata->>'city' is not null or metadata->>'country' is not null)
		 group by coalesce(metadata->>'city', metadata->>'country'), metadata->>'region'
		 order by sessions desc limit 50
		)
		select jsonb_build_object(
		 'journeys',coalesce((select jsonb_agg(to_jsonb(x)) from journeys x),'[]'::jsonb),
		 'funnel',coalesce((select jsonb_agg(to_jsonb(x)) from funnel x),'[]'::jsonb),
		 'top_pages',coalesce((select jsonb_agg(to_jsonb(x)) from pages x),'[]'::jsonb),
		 'daily_views',coalesce((select jsonb_agg(to_jsonb(x)) from daily x),'[]'::jsonb),
		 'total_sessions',(select count(distinct session_id) from events where session_id not like 'site-contact:%'),
		 'total_conversions',(select count(*) from events where event_type='form_submit'),
		 'total_converted_sessions',(select count(distinct session_id) from events where event_type='form_submit' and session_id not like 'site-contact:%'),
		 'total_interactions',(select count(*) from events where session_id not like 'site-contact:%' and event_type not in ('session_start', 'page_duration')),
		 'device_breakdown',coalesce((select jsonb_agg(to_jsonb(x)) from devices x),'[]'::jsonb),
		 'locations',coalesce((select jsonb_agg(to_jsonb(x)) from locations x),'[]'::jsonb))
	`, tenantContext.OrganizationID, dateOnly(values, "dateFrom"), dateOnly(values, "dateTo"))
}

func (repo Repository) resolveSiteAnalyticsCapabilities(ctx context.Context) (siteAnalyticsSchemaCapabilities, error) {
	load := func() (siteAnalyticsSchemaCapabilities, error) {
		var capabilities siteAnalyticsSchemaCapabilities
		err := repo.db.Pool().QueryRow(ctx, `
			select count(*) filter (
			         where column_name in ('property_id','lead_id','metadata')
			       ) = 3 as tracking_v2,
			       count(*) filter (where column_name = 'last_seen_at') = 1 as last_seen_at
			from information_schema.columns
			where table_schema='public' and table_name='site_analytics_events'
		`).Scan(&capabilities.trackingV2, &capabilities.lastSeenAt)
		return capabilities, err
	}

	if repo.siteAnalyticsCapabilities == nil {
		return load()
	}
	return repo.siteAnalyticsCapabilities.resolve(time.Now(), load)
}

func siteAnalyticsObservedAtSQL(qualifier string, lastSeenAt bool) string {
	if lastSeenAt {
		return "coalesce(" + qualifier + "last_seen_at, " + qualifier + "created_at)"
	}
	return qualifier + "created_at"
}

func (repo Repository) siteDetailedLegacy(ctx context.Context, tenantContext tenant.Context, values url.Values, capabilities siteAnalyticsSchemaCapabilities) (map[string]any, error) {
	liveObservedAtSQL := siteAnalyticsObservedAtSQL("live.", capabilities.lastSeenAt)
	return repo.queryJSONObject(ctx, `
		with params as (
		 select nullif($2, '')::date as date_from, nullif($3, '')::date as date_to
		), report_settings as (
		 select coalesce(
		   (
		     select nullif(btrim(settings.timezone), '')
		     from public.organization_attention_settings as settings
		     where settings.organization_id = $1::uuid
		   ),
		   'America/Sao_Paulo'
		 ) as timezone_name
		), bounds as (
		 select coalesce(params.date_from, (current_timestamp at time zone report_settings.timezone_name)::date - 6) date_from,
		   coalesce(params.date_to, (current_timestamp at time zone report_settings.timezone_name)::date) date_to,
		   report_settings.timezone_name
		 from params cross join report_settings
		), time_bounds as (
		 select date_from::timestamp at time zone timezone_name starts_at,
		   (date_to + 1)::timestamp at time zone timezone_name ends_at,
		   timezone_name
		 from bounds
		), events as (
		 select e.* from public.site_analytics_events e cross join time_bounds
		 where e.organization_id=$1::uuid
		   and e.created_at >= time_bounds.starts_at
		   and e.created_at < time_bounds.ends_at
		), top_pages as (
		 select page_path, count(*)::int views from events where event_type in ('pageview','page_view')
		 group by page_path order by views desc limit 20
		), daily as (
		 select (e.created_at at time zone time_bounds.timezone_name)::date::text date, count(*)::int views
		 from events e cross join time_bounds where e.event_type in ('pageview','page_view')
		 group by (e.created_at at time zone time_bounds.timezone_name)::date
		 order by (e.created_at at time zone time_bounds.timezone_name)::date
		), session_metrics as (
		 select session_id, count(*) filter(where event_type in ('pageview','page_view'))::int pageviews,
		   bool_or(event_type='form_submit') converted, max(created_at) last_seen
		 from events where session_id is not null and session_id not like 'site-contact:%' group by session_id
		), totals as (
		 select count(*)::int sessions, count(*) filter(where converted)::int converted_sessions,
		   (select count(*)::int from events where event_type='form_submit') conversions,
		   coalesce(round(sum(pageviews)::numeric/nullif(count(*),0),2),0) pages_per_session,
		   coalesce(round(count(*) filter(where pageviews<=1 and not converted)::numeric*100/nullif(count(*),0),2),0) bounce_rate,
		   (select count(distinct live.session_id)::int
		      from public.site_analytics_events live
		     where live.organization_id=$1::uuid
		       and live.session_id is not null
		       and live.session_id not like 'site-contact:%'
		       and (live.created_at >= now()-interval '5 minutes'
		         or (live.event_type='page_duration'
		           and `+liveObservedAtSQL+` >= now()-interval '5 minutes'))) live_visitors
		 from session_metrics
		), site_leads as (
		 select count(*)::int total from public.leads l cross join time_bounds
		 where l.organization_id=$1::uuid and (l.source in ('site','website') or l.source_detail='public_site')
		   and l.created_at >= time_bounds.starts_at
		   and l.created_at < time_bounds.ends_at
		), session_sources as (
		 select distinct on (session_id) session_id, utm_source, utm_medium, utm_campaign, referrer,
		   false google_ads_click, false facebook_click
		 from events
		 where session_id is not null and session_id not like 'site-contact:%'
		 order by session_id, created_at
		), typed_sessions as (
		 select session_sources.*, `+siteAcquisitionSourceTypeSQL+` source_type
		 from session_sources
		), classified_sessions as (
		 select session_id,
		   `+siteAcquisitionSourceLabelSQL+` source,
		   coalesce(nullif(btrim(utm_campaign), ''), 'Sem campanha') campaign,
		   source_type
		 from typed_sessions
		), session_conversions as (
		 select session_id, count(*) filter(where event_type='form_submit')::int conversions
		 from events where session_id is not null and session_id not like 'site-contact:%' group by session_id
		), campaigns as (
		 select classified.source, classified.campaign, classified.source_type,
		   count(*)::int sessions, coalesce(sum(conversions.conversions), 0)::int conversions
		 from classified_sessions classified
		 left join session_conversions conversions using (session_id)
		 group by classified.source, classified.campaign, classified.source_type
		 order by sessions desc limit 20
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

func (repo Repository) leadAnalyticsLegacy(ctx context.Context, tenantContext tenant.Context, values url.Values, capabilities siteAnalyticsSchemaCapabilities) (map[string]any, error) {
	lastObservedAtSQL := siteAnalyticsObservedAtSQL("", capabilities.lastSeenAt)
	return repo.queryJSONObject(ctx, `
		with params as (
		 select nullif($2, '')::date as date_from, nullif($3, '')::date as date_to
		), report_settings as (
		 select coalesce(
		   (
		     select nullif(btrim(settings.timezone), '')
		     from public.organization_attention_settings as settings
		     where settings.organization_id = $1::uuid
		   ),
		   'America/Sao_Paulo'
		 ) as timezone_name
		), bounds as (
		 select coalesce(params.date_from, (current_timestamp at time zone report_settings.timezone_name)::date - 6) date_from,
		   coalesce(params.date_to, (current_timestamp at time zone report_settings.timezone_name)::date) date_to,
		   report_settings.timezone_name
		 from params cross join report_settings
		), time_bounds as (
		 select date_from::timestamp at time zone timezone_name starts_at,
		   (date_to + 1)::timestamp at time zone timezone_name ends_at,
		   timezone_name
		 from bounds
		), events as (
		 select e.* from public.site_analytics_events e cross join time_bounds where e.organization_id=$1::uuid
		 and e.created_at >= time_bounds.starts_at
		 and e.created_at < time_bounds.ends_at
		), journeys as (
		 select session_id,
		   coalesce(
		     array_agg(page_path order by created_at)
		       filter (where event_type in ('pageview','page_view') and nullif(btrim(page_path), '') is not null),
		     array[]::text[]
		   ) path_sequence,
		   array_agg(event_type order by created_at, id) event_sequence, min(created_at)::text first_event,
		   max(`+lastObservedAtSQL+`)::text last_event, count(*)::int total_events,
		   bool_or(event_type='form_submit') converted, max(device_type) device_type, max(browser) browser,
		   null::text os, null::text city, null::text region, null::text country,
		   max(utm_source) utm_source, max(referrer) referrer
		 from events
		 where session_id is not null and session_id not like 'site-contact:%'
		 group by session_id order by max(`+lastObservedAtSQL+`) desc limit 100
		), funnel as (
		 select case when event_type in ('pageview','page_view') then 'pageview' else event_type end event_type,
		   count(distinct session_id)::int total from events
		 where session_id is not null and session_id not like 'site-contact:%'
		   and event_type not in ('session_start', 'page_duration')
		 group by 1 order by total desc
		), pages as (
		 select page_path, count(*)::int views from events where event_type in ('pageview','page_view') group by page_path order by views desc limit 20
		), daily as (
		 select (e.created_at at time zone time_bounds.timezone_name)::date::text date, count(*)::int views
		 from events e cross join time_bounds where e.event_type in ('pageview','page_view')
		 group by (e.created_at at time zone time_bounds.timezone_name)::date
		 order by (e.created_at at time zone time_bounds.timezone_name)::date
		), session_devices as (
		 select session_id,
		   case when first_device in ('desktop', 'mobile', 'tablet') then first_device else 'other' end device_type
		 from (
		   select session_id,
		     (array_agg(lower(btrim(device_type)) order by created_at)
		       filter (where nullif(btrim(device_type), '') is not null))[1] first_device
		   from events where session_id is not null and session_id not like 'site-contact:%' group by session_id
		 ) session_device_values
		), devices as (
		 select device_type, count(*)::int total from session_devices group by device_type
		)
		select jsonb_build_object(
		 'journeys',coalesce((select jsonb_agg(to_jsonb(x)) from journeys x),'[]'::jsonb),
		 'funnel',coalesce((select jsonb_agg(to_jsonb(x)) from funnel x),'[]'::jsonb),
		 'top_pages',coalesce((select jsonb_agg(to_jsonb(x)) from pages x),'[]'::jsonb),
		 'daily_views',coalesce((select jsonb_agg(to_jsonb(x)) from daily x),'[]'::jsonb),
		 'total_sessions',(select count(distinct session_id) from events where session_id not like 'site-contact:%'),
		 'total_conversions',(select count(*) from events where event_type='form_submit'),
		 'total_converted_sessions',(select count(distinct session_id) from events where event_type='form_submit' and session_id not like 'site-contact:%'),
		 'total_interactions',(select count(*) from events where session_id not like 'site-contact:%' and event_type not in ('session_start', 'page_duration')),
		 'device_breakdown',coalesce((select jsonb_agg(to_jsonb(x)) from devices x),'[]'::jsonb),
		 'locations','[]'::jsonb)
	`, tenantContext.OrganizationID, dateOnly(values, "dateFrom"), dateOnly(values, "dateTo"))
}
