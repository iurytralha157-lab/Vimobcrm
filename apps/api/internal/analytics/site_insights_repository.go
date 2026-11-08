package analytics

import (
	"context"
	"log/slog"
	"net/url"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Shared definitions for the Site dashboard. The public site emits no dedicated
// WhatsApp click today: its WhatsApp button records a cta_click that opens the
// lead form, so both shapes count as a click and only form_submit or a real
// whatsapp_click count as a contact that was actually sent.
const siteInsightsTimeout = 10 * time.Second

const (
	siteInsightsPageviewSQL = `event_type in ('pageview','page_view')`
	siteInsightsWhatsAppSQL = `(event_type = 'whatsapp_click' or (event_type = 'cta_click' and metadata->>'action' = 'open_whatsapp_lead_form'))`
	siteInsightsContactSQL  = `event_type in ('form_submit','whatsapp_click')`
)

// attachSiteInsights adds the additive `insights` key. A failure here must not
// take away the metrics the older keys already answered, so it degrades to null
// and the dashboard shows those sections as unavailable instead of estimating.
func (repo Repository) attachSiteInsights(ctx context.Context, tenantContext tenant.Context, values url.Values, detailed map[string]any) error {
	// The base keys are already loaded: running out of budget here costs only the
	// additive breakdown, never the screen.
	insightsCtx, cancel := context.WithTimeout(ctx, siteInsightsTimeout)
	defer cancel()
	insights, err := repo.siteInsights(insightsCtx, tenantContext, values)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		slog.WarnContext(ctx, "could not load site dashboard insights", "error", err)
		detailed["insights"] = nil
		return nil
	}
	detailed["insights"] = insights
	return nil
}

// siteInsights computes every per-page, per-property, per-channel and
// per-device metric from the same events the older keys read. Sessions follow
// the existing rule: synthetic site-contact sessions never count as visits, so
// a lead without a tracked session has no channel or device to be credited to.
func (repo Repository) siteInsights(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
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
		   (date_from - (date_to - date_from + 1))::timestamp at time zone timezone_name prev_starts_at,
		   timezone_name
		 from bounds
		), scoped as materialized (
		 select e.id, e.session_id, e.event_type, e.page_path, e.page_title, e.property_id, e.lead_id,
		   e.device_type, e.duration_seconds, e.created_at, e.metadata, e.utm_source, e.utm_medium,
		   e.utm_campaign, e.referrer,
		   case when e.created_at >= b.starts_at then 'current' else 'previous' end period
		 from public.site_analytics_events e cross join time_bounds b
		 where e.organization_id = $1::uuid
		   and e.created_at >= b.prev_starts_at
		   and e.created_at < b.ends_at
		), events as (
		 select * from scoped where period = 'current'
		), tracked as (
		 select * from scoped where session_id is not null and session_id not like 'site-contact:%'
		), session_facts as materialized (
		 select period, session_id,
		   count(*) filter (where `+siteInsightsPageviewSQL+`)::int pageviews,
		   bool_or(event_type = 'form_submit') converted,
		   bool_or(event_type = 'form_submit' and lead_id is not null) became_lead,
		   bool_or(`+siteInsightsPageviewSQL+` and property_id is not null) viewed_property,
		   bool_or(event_type = 'property_search') searched,
		   bool_or(event_type in ('property_search','favorite','cta_click','whatsapp_click','form_submit')) interacted,
		   min(created_at) first_at,
		   min(created_at) filter (where `+siteInsightsContactSQL+`) contact_at,
		   (array_agg(event_type order by created_at, id) filter (where `+siteInsightsContactSQL+`))[1] contact_type,
		   (array_agg(page_path order by created_at, id) filter (where `+siteInsightsPageviewSQL+`))[1] landing_page,
		   (array_agg(lower(btrim(device_type)) order by created_at, id)
		     filter (where nullif(btrim(device_type), '') is not null))[1] first_device
		 from tracked
		 group by period, session_id
		), session_first as materialized (
		 select distinct on (period, session_id) period, session_id, utm_source, utm_medium, utm_campaign, referrer,
		   (metadata->>'google_ads_click' = 'true' or nullif(btrim(metadata->>'gclid'), '') is not null) google_ads_click,
		   (metadata->>'facebook_click' = 'true' or nullif(btrim(metadata->>'fbclid'), '') is not null) facebook_click
		 from tracked
		 order by period, session_id, created_at, id
		), typed_sessions as (
		 select session_first.*, `+siteAcquisitionSourceTypeSQL+` source_type
		 from session_first
		), session_leads as (
		 select distinct period, session_id, lead_id
		 from tracked
		 where event_type = 'form_submit' and lead_id is not null
		), session_summary as (
		 select period,
		   count(*)::int sessions,
		   count(*) filter (where viewed_property)::int property_sessions,
		   count(*) filter (where searched)::int search_sessions,
		   count(*) filter (where interacted)::int interaction_sessions,
		   count(*) filter (where contact_at is not null)::int contact_sessions,
		   count(*) filter (where became_lead)::int lead_sessions,
		   count(*) filter (where converted)::int converted_sessions,
		   coalesce(round(sum(pageviews)::numeric / nullif(count(*), 0), 2), 0) pages_per_session,
		   coalesce(round(count(*) filter (where pageviews <= 1 and not converted)::numeric * 100 / nullif(count(*), 0), 2), 0) bounce_rate,
		   round((percentile_cont(0.5) within group (order by extract(epoch from contact_at - first_at))
		     filter (where contact_at is not null))::numeric) median_seconds_to_contact
		 from session_facts
		 group by period
		), event_summary as (
		 select period,
		   count(*) filter (where `+siteInsightsPageviewSQL+`)::int views,
		   count(*) filter (where `+siteInsightsPageviewSQL+` and property_id is not null)::int property_views,
		   count(*) filter (where event_type = 'property_search')::int searches,
		   count(*) filter (where event_type = 'favorite')::int favorites,
		   count(*) filter (where `+siteInsightsWhatsAppSQL+`)::int whatsapp_clicks,
		   count(*) filter (where event_type = 'cta_click' and not `+siteInsightsWhatsAppSQL+`)::int cta_clicks,
		   count(*) filter (where event_type = 'form_submit')::int form_submits,
		   count(*) filter (where `+siteInsightsContactSQL+`)::int contacts
		 from scoped
		 group by period
		), lead_summary as (
		 select count(distinct lead_id)::int leads,
		   count(distinct lead_id) filter (where metadata->>'reentry' = 'true')::int returning_leads
		 from events
		 where event_type = 'form_submit' and lead_id is not null
		), pages_before_contact as (
		 select f.session_id, count(*) filter (where t.`+siteInsightsPageviewSQL+`)::numeric pages
		 from session_facts f
		 join tracked t on t.period = f.period and t.session_id = f.session_id and t.created_at <= f.contact_at
		 where f.period = 'current' and f.contact_at is not null
		 group by f.session_id
		), page_views as (
		 select page_path,
		   count(*)::int views,
		   count(distinct session_id) filter (where session_id not like 'site-contact:%')::int sessions,
		   (array_agg(nullif(btrim(page_title), '') order by created_at desc, id desc)
		     filter (where nullif(btrim(page_title), '') is not null))[1] page_title,
		   max(property_id::text)::uuid property_id
		 from events
		 where `+siteInsightsPageviewSQL+`
		 group by page_path
		), page_durations as (
		 select page_path, count(*)::int measured_sessions, round(avg(total))::int avg_duration
		 from (
		   select page_path, session_id, sum(coalesce(duration_seconds, 0))::numeric total
		   from tracked
		   where period = 'current' and event_type = 'page_duration'
		   group by page_path, session_id
		 ) page_session_durations
		 group by page_path
		), page_entries as (
		 select landing_page page_path,
		   count(*)::int entries,
		   count(*) filter (where pageviews <= 1 and not converted)::int bounces
		 from session_facts
		 where period = 'current' and landing_page is not null
		 group by landing_page
		), page_leads as (
		 select page_path, count(distinct lead_id)::int leads
		 from events
		 where event_type = 'form_submit' and lead_id is not null
		 group by page_path
		), page_rows as (
		 select pv.page_path, coalesce(p.title, pv.page_title) title, pv.views, pv.sessions,
		   coalesce(pe.entries, 0) entries,
		   case when pe.entries > 0 then round(pe.bounces::numeric * 100 / pe.entries, 2) end bounce_rate,
		   coalesce(pd.measured_sessions, 0) measured_sessions,
		   pd.avg_duration,
		   coalesce(pl.leads, 0) leads,
		   case when pe.entries > 0 then least(100, round(coalesce(pl.leads, 0)::numeric * 100 / pe.entries, 2)) end conversion_rate
		 from page_views pv
		 left join public.properties p on p.id = pv.property_id and p.organization_id = $1::uuid
		 left join page_durations pd using (page_path)
		 left join page_entries pe using (page_path)
		 left join page_leads pl using (page_path)
		 order by pv.views desc, pv.page_path
		 limit 20
		), lead_page_rows as (
		 select pl.page_path, coalesce(p.title, pv.page_title) title, pl.leads
		 from page_leads pl
		 left join page_views pv using (page_path)
		 left join public.properties p on p.id = pv.property_id and p.organization_id = $1::uuid
		 order by pl.leads desc, pl.page_path
		 limit 6
		), property_stats as (
		 select property_id,
		   count(*) filter (where `+siteInsightsPageviewSQL+`)::int views,
		   count(distinct session_id) filter (where `+siteInsightsPageviewSQL+` and session_id not like 'site-contact:%')::int sessions,
		   count(*) filter (where event_type = 'favorite')::int favorites,
		   count(*) filter (where `+siteInsightsWhatsAppSQL+`)::int whatsapp_clicks,
		   count(*) filter (where event_type = 'form_submit')::int form_submits,
		   count(distinct lead_id) filter (where event_type = 'form_submit')::int leads,
		   (array_agg(page_path order by created_at desc, id desc) filter (where `+siteInsightsPageviewSQL+`))[1] page_path
		 from events
		 where property_id in (select p.id from public.properties p where p.organization_id = $1::uuid)
		 group by property_id
		), property_durations as (
		 select property_id, round(avg(total))::int avg_duration
		 from (
		   select property_id, session_id, sum(coalesce(duration_seconds, 0))::numeric total
		   from tracked
		   where period = 'current' and event_type = 'page_duration' and property_id is not null
		   group by property_id, session_id
		 ) property_session_durations
		 group by property_id
		), property_rows as (
		 select s.property_id,
		   coalesce(nullif(btrim(p.title), ''), 'Imovel') title,
		   coalesce(p.code, '') code,
		   p.tipo_de_negocio business_type,
		   p.tipo_de_imovel property_type,
		   p.bairro neighborhood,
		   p.cidade city,
		   p.quartos bedrooms,
		   p.preco sale_price,
		   p.valor_locacao rent_price,
		   coalesce(
		     (
		       select img.url
		       from unnest(array_remove(array_prepend(nullif(p.imagem_principal, ''), coalesce(p.image_urls, '{}'::text[])), null))
		         with ordinality as img(url, ord)
		       where not (coalesce(p.metadata->'hidden_site_image_urls', '[]'::jsonb) ? img.url)
		       order by img.ord
		       limit 1
		     ),
		     (
		       select nullif(btrim(asset.external_url), '')
		       from public.property_assets asset
		       where asset.organization_id = p.organization_id
		         and asset.property_id = p.id
		         and asset.asset_type = 'photo'
		         and asset.visibility <> 'confidential'
		         and nullif(btrim(asset.external_url), '') is not null
		       order by asset.is_primary desc, asset.sort_order, asset.created_at, asset.id
		       limit 1
		     )
		   ) photo_url,
		   s.page_path, s.views, s.sessions, s.favorites, s.whatsapp_clicks, s.form_submits, s.leads,
		   d.avg_duration,
		   case when s.sessions > 0 then least(100, round(s.leads::numeric * 100 / s.sessions, 2)) end conversion_rate
		 from property_stats s
		 join public.properties p on p.id = s.property_id and p.organization_id = $1::uuid
		 left join property_durations d using (property_id)
		 where s.views > 0
		 order by s.views desc, s.leads desc, s.property_id
		 limit 20
		), property_totals as (
		 select count(*) filter (where views > 0)::int viewed_properties,
		   coalesce(sum(leads), 0)::int leads
		 from property_stats
		), source_rows as (
		 select t.source_type,
		   count(distinct t.session_id) filter (where t.period = 'current')::int sessions,
		   count(distinct t.session_id) filter (where t.period = 'previous')::int prev_sessions,
		   count(distinct t.session_id) filter (where t.period = 'current' and f.converted)::int converted_sessions,
		   count(distinct l.lead_id) filter (where t.period = 'current')::int leads
		 from typed_sessions t
		 join session_facts f on f.period = t.period and f.session_id = t.session_id
		 left join session_leads l on l.period = t.period and l.session_id = t.session_id
		 group by t.source_type
		 order by sessions desc, t.source_type
		), device_rows as (
		 select case when f.first_device in ('desktop', 'mobile', 'tablet') then f.first_device else 'other' end device_type,
		   count(distinct f.session_id)::int sessions,
		   count(distinct f.session_id) filter (where f.converted)::int converted_sessions,
		   count(distinct l.lead_id)::int leads
		 from session_facts f
		 left join session_leads l on l.period = f.period and l.session_id = f.session_id
		 where f.period = 'current'
		 group by 1
		 order by sessions desc, 1
		), campaign_rows as (
		 select btrim(t.utm_campaign) campaign,
		   `+siteAcquisitionSourceLabelSQL+` source,
		   nullif(btrim(t.utm_medium), '') medium,
		   count(distinct t.session_id)::int sessions,
		   count(distinct t.session_id) filter (where f.converted)::int converted_sessions,
		   count(distinct l.lead_id)::int leads
		 from typed_sessions t
		 join session_facts f on f.period = t.period and f.session_id = t.session_id
		 left join session_leads l on l.period = t.period and l.session_id = t.session_id
		 where t.period = 'current' and nullif(btrim(t.utm_campaign), '') is not null
		 group by 1, 2, 3
		 order by sessions desc, 1
		 limit 20
		), path_steps as (
		 select t.session_id, t.created_at, t.id, kind.step,
		   lag(kind.step) over (partition by t.session_id order by t.created_at, t.id) previous_step
		 from session_facts f
		 join tracked t on t.period = f.period and t.session_id = f.session_id and t.created_at <= f.contact_at
		 cross join lateral (
		   select case
		     when t.property_id is not null then 'Imóvel'
		     when regexp_replace(t.page_path, '^/sites/[^/]+', '') in ('', '/') then 'Início'
		     when t.page_path ~ '(^|/)imoveis(/|$)' then 'Busca'
		     when t.page_path ~ '(^|/)contato(/|$)' then 'Contato'
		     else 'Outra página'
		   end step
		 ) kind
		 where f.period = 'current' and f.contact_at is not null and t.`+siteInsightsPageviewSQL+`
		), session_paths as (
		 select session_id,
		   string_agg(step, ' › ' order by created_at, id) filter (where previous_step is distinct from step) path
		 from path_steps
		 group by session_id
		), contact_path_rows as (
		 select case
		     when sp.path is null then 'Direto no contato'
		     else sp.path || ' › ' || case when f.contact_type = 'whatsapp_click' then 'WhatsApp' else 'Formulário' end
		   end path,
		   count(*)::int sessions
		 from session_facts f
		 left join session_paths sp using (session_id)
		 where f.period = 'current' and f.contact_at is not null
		 group by 1
		 order by sessions desc, 1
		 limit 6
		), daily_rows as (
		 select (e.created_at at time zone b.timezone_name)::date::text date,
		   count(distinct e.session_id) filter (where e.session_id not like 'site-contact:%')::int sessions,
		   count(*) filter (where e.`+siteInsightsPageviewSQL+`)::int views,
		   count(distinct e.lead_id) filter (where e.event_type = 'form_submit')::int leads
		 from events e cross join time_bounds b
		 group by (e.created_at at time zone b.timezone_name)::date
		 order by (e.created_at at time zone b.timezone_name)::date
		), search_rows as (
		 select lower(btrim(filter_value.value)) term, count(*)::int searches
		 from events e
		 cross join lateral jsonb_each_text(
		   case when jsonb_typeof(e.metadata->'filters') = 'object' then e.metadata->'filters' else '{}'::jsonb end
		 ) filter_value
		 where e.event_type = 'property_search'
		   and filter_value.key in ('search', 'cidade', 'bairro', 'tipo', 'finalidade')
		   and nullif(btrim(filter_value.value), '') is not null
		 group by 1
		 order by searches desc, 1
		 limit 20
		), previous_site_leads as (
		 select count(*)::int total
		 from public.leads l cross join time_bounds b
		 where l.organization_id = $1::uuid
		   and (l.source in ('site', 'website') or l.source_detail = 'public_site')
		   and l.created_at >= b.prev_starts_at
		   and l.created_at < b.starts_at
		)
		select jsonb_build_object(
		 'pages', coalesce((select jsonb_agg(to_jsonb(x)) from page_rows x), '[]'::jsonb),
		 'leadPages', coalesce((select jsonb_agg(to_jsonb(x)) from lead_page_rows x), '[]'::jsonb),
		 'properties', coalesce((select jsonb_agg(to_jsonb(x)) from property_rows x), '[]'::jsonb),
		 'sources', coalesce((select jsonb_agg(to_jsonb(x)) from source_rows x), '[]'::jsonb),
		 'devices', coalesce((select jsonb_agg(to_jsonb(x)) from device_rows x), '[]'::jsonb),
		 'campaigns', coalesce((select jsonb_agg(to_jsonb(x)) from campaign_rows x), '[]'::jsonb),
		 'contactPaths', coalesce((select jsonb_agg(to_jsonb(x)) from contact_path_rows x), '[]'::jsonb),
		 'daily', coalesce((select jsonb_agg(to_jsonb(x)) from daily_rows x), '[]'::jsonb),
		 'searchQueries', coalesce((select jsonb_agg(to_jsonb(x)) from search_rows x), '[]'::jsonb),
		 'current', coalesce(
		   (select to_jsonb(s) - 'period' from session_summary s where s.period = 'current'), '{}'::jsonb
		 ) || coalesce((select to_jsonb(e) - 'period' from event_summary e where e.period = 'current'), '{}'::jsonb)
		   || jsonb_build_object(
		     'viewed_properties', (select viewed_properties from property_totals),
		     'leads', (select leads from lead_summary),
		     'returning_leads', (select returning_leads from lead_summary),
		     'avg_pages_to_contact', (select round(avg(pages), 1) from pages_before_contact)
		   ),
		 'previous', coalesce(
		   (select to_jsonb(s) - 'period' from session_summary s where s.period = 'previous'), '{}'::jsonb
		 ) || coalesce((select to_jsonb(e) - 'period' from event_summary e where e.period = 'previous'), '{}'::jsonb)
		   || jsonb_build_object('site_leads', (select total from previous_site_leads))
		)
	`, tenantContext.OrganizationID, dateOnly(values, "dateFrom"), dateOnly(values, "dateTo"))
}
