package analytics

import (
	"context"
	"encoding/json"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// The stub schema mirrors the columns these queries read in the production
// baseline. The test replaces the public tables, so it only runs against a
// scratch database whose name makes that intent explicit.
const siteInsightsStubSchema = `
drop table if exists public.site_analytics_events, public.property_assets, public.properties, public.leads, public.organization_attention_settings;
create table public.organization_attention_settings (organization_id uuid primary key, timezone text);
create table public.leads (id uuid primary key default gen_random_uuid(), organization_id uuid not null, source text, source_detail text, created_at timestamptz not null default now());
create table public.properties (
  id uuid primary key, organization_id uuid not null, title text, code text, tipo_de_negocio text, tipo_de_imovel text,
  bairro text, cidade text, quartos int, preco numeric, valor_locacao numeric, imagem_principal text,
  image_urls text[] default '{}', metadata jsonb default '{}'
);
create table public.property_assets (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, property_id uuid not null, asset_type text not null,
  visibility text not null default 'public', external_url text, is_primary boolean default false, sort_order int default 0,
  created_at timestamptz default now()
);
create table public.site_analytics_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, session_id text not null, event_type text not null,
  page_path text not null, page_title text, referrer text, utm_source text, utm_medium text, utm_campaign text, device_type text,
  browser text, duration_seconds int, created_at timestamptz not null default now(), property_id uuid, lead_id uuid,
  metadata jsonb not null default '{}', last_seen_at timestamptz
);
`

const (
	insightsOrgA      = "00000000-0000-4000-8000-00000000000a"
	insightsOrgB      = "00000000-0000-4000-8000-00000000000b"
	insightsPropertyA = "00000000-0000-4000-8000-0000000000a1"
	insightsPropertyB = "00000000-0000-4000-8000-0000000000b1"
	insightsLeadOne   = "00000000-0000-4000-8000-000000000101"
	insightsLeadTwo   = "00000000-0000-4000-8000-000000000102"
)

const siteInsightsFixture = `
insert into public.properties (id, organization_id, title, code, tipo_de_negocio, bairro, preco, valor_locacao, imagem_principal, image_urls, metadata) values
 ('` + insightsPropertyA + `', '` + insightsOrgA + `', 'Apto Noroeste', 'AP1', 'Venda', 'Noroeste', 780000, null, 'https://cdn.test/oculta.jpg', '{https://cdn.test/visivel.jpg}', '{"hidden_site_image_urls":["https://cdn.test/oculta.jpg"]}'),
 ('` + insightsPropertyB + `', '` + insightsOrgB + `', 'Outra org', 'B1', 'Aluguel', 'Sul', null, 2500, null, '{}', '{}');
insert into public.leads (organization_id, source, created_at) values
 ('` + insightsOrgA + `', 'site', '2026-06-05 12:00:00+00');
insert into public.site_analytics_events (organization_id, session_id, event_type, page_path, page_title, device_type, utm_source, utm_medium, utm_campaign, property_id, lead_id, duration_seconds, metadata, created_at) values
 -- s1: Instagram (social), mobile, home, then property, opens WhatsApp form and submits it.
 ('` + insightsOrgA + `', 's1', 'session_start', '/', null, 'mobile', 'instagram', null, null, null, null, null, '{}', '2026-06-15 12:00:00+00'),
 ('` + insightsOrgA + `', 's1', 'pageview', '/', 'Inicio', 'mobile', 'instagram', null, null, null, null, null, '{}', '2026-06-15 12:00:01+00'),
 ('` + insightsOrgA + `', 's1', 'page_duration', '/', 'Inicio', 'mobile', 'instagram', null, null, null, null, 30, '{}', '2026-06-15 12:00:30+00'),
 ('` + insightsOrgA + `', 's1', 'pageview', '/imovel/ap1', 'x', 'mobile', 'instagram', null, null, '` + insightsPropertyA + `', null, null, '{}', '2026-06-15 12:01:00+00'),
 ('` + insightsOrgA + `', 's1', 'page_duration', '/imovel/ap1', 'x', 'mobile', 'instagram', null, null, '` + insightsPropertyA + `', null, 90, '{}', '2026-06-15 12:02:00+00'),
 ('` + insightsOrgA + `', 's1', 'favorite', '/imovel/ap1', 'x', 'mobile', 'instagram', null, null, '` + insightsPropertyA + `', null, null, '{}', '2026-06-15 12:02:10+00'),
 ('` + insightsOrgA + `', 's1', 'cta_click', '/imovel/ap1', 'x', 'mobile', 'instagram', null, null, '` + insightsPropertyA + `', null, null, '{"action":"open_whatsapp_lead_form"}', '2026-06-15 12:02:20+00'),
 ('` + insightsOrgA + `', 's1', 'form_submit', '/', 'Conversao', null, 'instagram', null, null, '` + insightsPropertyA + `', '` + insightsLeadOne + `', null, '{"reentry":true}', '2026-06-15 12:03:00+00'),
 -- s2: direct desktop, bounces on the search page, searching by neighborhood.
 ('` + insightsOrgA + `', 's2', 'pageview', '/imoveis', 'Busca', 'desktop', null, null, null, null, null, null, '{}', '2026-06-16 12:00:00+00'),
 ('` + insightsOrgA + `', 's2', 'property_search', '/imoveis', 'Busca', 'desktop', null, null, null, null, null, null, '{"filters":{"bairro":"Noroeste","max_price":"900000"}}', '2026-06-16 12:00:05+00'),
 -- s3: paid campaign, tablet, property page then form.
 ('` + insightsOrgA + `', 's3', 'pageview', '/imovel/ap1', 'x', 'tablet', 'meta', 'cpc', 'Park Sul', '` + insightsPropertyA + `', null, null, '{}', '2026-06-17 12:00:00+00'),
 ('` + insightsOrgA + `', 's3', 'form_submit', '/imovel/ap1', 'Conversao', null, 'meta', 'cpc', 'Park Sul', '` + insightsPropertyA + `', '` + insightsLeadTwo + `', null, '{}', '2026-06-17 12:06:00+00'),
 -- Synthetic contact: a lead with no tracked session. It is not a visit.
 ('` + insightsOrgA + `', 'site-contact:abc', 'form_submit', '/contato', 'Conversao', null, null, null, null, null, '00000000-0000-4000-8000-000000000103', null, '{}', '2026-06-18 12:00:00+00'),
 -- Previous period, used only for comparisons.
 ('` + insightsOrgA + `', 'p1', 'pageview', '/', 'Inicio', 'mobile', null, null, null, null, null, null, '{}', '2026-05-20 12:00:00+00'),
 ('` + insightsOrgA + `', 'p2', 'pageview', '/', 'Inicio', 'mobile', null, null, null, null, null, null, '{}', '2026-05-21 12:00:00+00'),
 -- Another tenant that must never leak into the first one.
 ('` + insightsOrgB + `', 'b1', 'pageview', '/segredo', 'Segredo', 'desktop', 'google', 'cpc', 'Campanha B', '` + insightsPropertyB + `', null, null, '{}', '2026-06-15 12:00:00+00'),
 ('` + insightsOrgB + `', 'b1', 'form_submit', '/segredo', 'Conversao', null, 'google', 'cpc', 'Campanha B', '` + insightsPropertyB + `', '00000000-0000-4000-8000-000000000104', null, '{}', '2026-06-15 12:01:00+00');
`

func TestSiteInsightsAgainstScratchPostgres(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("SITE_INSIGHTS_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set SITE_INSIGHTS_TEST_DATABASE_URL to run the site insights query test")
	}
	parsedURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse SITE_INSIGHTS_TEST_DATABASE_URL: %v", err)
	}
	if !strings.HasSuffix(parsedURL.Path, "_site_insights_test") {
		t.Fatal("SITE_INSIGHTS_TEST_DATABASE_URL must name a scratch database ending in _site_insights_test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 2})
	if err != nil {
		t.Fatalf("connect scratch PostgreSQL: %v", err)
	}
	defer database.Close()
	if _, err := database.Pool().Exec(ctx, siteInsightsStubSchema); err != nil {
		t.Fatalf("create stub schema: %v", err)
	}
	if _, err := database.Pool().Exec(ctx, siteInsightsFixture); err != nil {
		t.Fatalf("seed fixture: %v", err)
	}

	repo := NewRepository(database)
	filters := url.Values{"dateFrom": {"2026-06-01"}, "dateTo": {"2026-06-30"}}
	detailed, err := repo.SiteDetailed(ctx, tenant.Context{OrganizationID: insightsOrgA}, filters)
	if err != nil {
		t.Fatalf("SiteDetailed: %v", err)
	}
	insights, ok := detailed["insights"].(map[string]any)
	if !ok {
		t.Fatalf("SiteDetailed degraded its insights: %#v", detailed["insights"])
	}
	raw, _ := json.Marshal(insights)
	for _, leaked := range []string{"segredo", "Segredo", "Outra org", "Campanha B"} {
		if strings.Contains(string(raw), leaked) {
			t.Fatalf("insights leaked another tenant through %q: %s", leaked, raw)
		}
	}

	current := insights["current"].(map[string]any)
	for key, want := range map[string]float64{
		"sessions":                  3,
		"property_sessions":         2,
		"search_sessions":           1,
		"interaction_sessions":      3,
		"contact_sessions":          2,
		"lead_sessions":             2,
		"converted_sessions":        2,
		"views":                     4,
		"property_views":            2,
		"searches":                  1,
		"favorites":                 1,
		"whatsapp_clicks":           1,
		"cta_clicks":                0,
		"form_submits":              3,
		"contacts":                  3,
		"viewed_properties":         1,
		"leads":                     3,
		"returning_leads":           1,
		"bounce_rate":               33.33,
		"median_seconds_to_contact": 270,
		"avg_pages_to_contact":      1.5,
	} {
		if got := current[key]; got != want {
			t.Errorf("current.%s = %v, want %v", key, got, want)
		}
	}
	previous := insights["previous"].(map[string]any)
	for key, want := range map[string]float64{"sessions": 2, "views": 2, "bounce_rate": 100, "site_leads": 0} {
		if got := previous[key]; got != want {
			t.Errorf("previous.%s = %v, want %v", key, got, want)
		}
	}

	pages := map[string]map[string]any{}
	for _, row := range insights["pages"].([]any) {
		page := row.(map[string]any)
		pages[page["page_path"].(string)] = page
	}
	home := pages["/"]
	if home["views"] != 1.0 || home["entries"] != 1.0 || home["leads"] != 1.0 ||
		home["avg_duration"] != 30.0 || home["bounce_rate"] != 0.0 || home["conversion_rate"] != 100.0 {
		t.Errorf("home page row = %#v", home)
	}
	if search := pages["/imoveis"]; search["bounce_rate"] != 100.0 || search["leads"] != 0.0 || search["avg_duration"] != nil {
		t.Errorf("search page row = %#v", search)
	}
	if property := pages["/imovel/ap1"]; property["title"] != "Apto Noroeste" || property["sessions"] != 2.0 {
		t.Errorf("property page row = %#v", property)
	}

	properties := insights["properties"].([]any)
	if len(properties) != 1 {
		t.Fatalf("properties = %#v", properties)
	}
	property := properties[0].(map[string]any)
	for key, want := range map[string]any{
		"code": "AP1", "business_type": "Venda", "sale_price": 780000.0,
		"photo_url": "https://cdn.test/visivel.jpg", "page_path": "/imovel/ap1",
		"views": 2.0, "sessions": 2.0, "favorites": 1.0, "whatsapp_clicks": 1.0,
		"form_submits": 2.0, "leads": 2.0, "avg_duration": 90.0, "conversion_rate": 100.0,
	} {
		if got := property[key]; got != want {
			t.Errorf("property.%s = %v, want %v", key, got, want)
		}
	}

	sources := map[string]map[string]any{}
	for _, row := range insights["sources"].([]any) {
		source := row.(map[string]any)
		sources[source["source_type"].(string)] = source
	}
	if social := sources["social"]; social["sessions"] != 1.0 || social["leads"] != 1.0 || social["converted_sessions"] != 1.0 {
		t.Errorf("social source = %#v", social)
	}
	if direct := sources["direct"]; direct["sessions"] != 1.0 || direct["leads"] != 0.0 || direct["prev_sessions"] != 2.0 {
		t.Errorf("direct source = %#v", direct)
	}

	devices := map[string]map[string]any{}
	for _, row := range insights["devices"].([]any) {
		device := row.(map[string]any)
		devices[device["device_type"].(string)] = device
	}
	if tablet := devices["tablet"]; tablet["sessions"] != 1.0 || tablet["converted_sessions"] != 1.0 {
		t.Errorf("tablet device = %#v", tablet)
	}
	if desktop := devices["desktop"]; desktop["converted_sessions"] != 0.0 {
		t.Errorf("desktop device = %#v", desktop)
	}

	campaigns := insights["campaigns"].([]any)
	if len(campaigns) != 1 || campaigns[0].(map[string]any)["campaign"] != "Park Sul" ||
		campaigns[0].(map[string]any)["source"] != "meta" || campaigns[0].(map[string]any)["leads"] != 1.0 {
		t.Errorf("campaigns = %#v", campaigns)
	}

	paths := map[string]float64{}
	for _, row := range insights["contactPaths"].([]any) {
		path := row.(map[string]any)
		paths[path["path"].(string)] = path["sessions"].(float64)
	}
	if paths["Início › Imóvel › Formulário"] != 1 || paths["Imóvel › Formulário"] != 1 {
		t.Errorf("contact paths = %#v", paths)
	}

	searches := insights["searchQueries"].([]any)
	if len(searches) != 1 || searches[0].(map[string]any)["term"] != "noroeste" {
		t.Errorf("search queries = %#v (price filters must stay out of the terms)", searches)
	}

	var dailyLeads float64
	for _, row := range insights["daily"].([]any) {
		dailyLeads += row.(map[string]any)["leads"].(float64)
	}
	if dailyLeads != 3 {
		t.Errorf("daily leads = %v, want 3", dailyLeads)
	}

	lead, err := repo.LeadAnalytics(ctx, tenant.Context{OrganizationID: insightsOrgA}, filters)
	if err != nil {
		t.Fatalf("LeadAnalytics: %v", err)
	}
	journeys := map[string]map[string]any{}
	for _, row := range lead["journeys"].([]any) {
		journey := row.(map[string]any)
		journeys[journey["session_id"].(string)] = journey
	}
	if len(journeys) != 3 {
		t.Fatalf("journeys = %#v", journeys)
	}
	if s3 := journeys["s3"]; s3["seconds_to_contact"] != 360.0 || s3["pages_to_contact"] != 1.0 || s3["has_lead"] != true {
		t.Errorf("s3 journey = %#v", s3)
	}
	if s2 := journeys["s2"]; s2["seconds_to_contact"] != nil || s2["pages_to_contact"] != nil || s2["has_lead"] != false {
		t.Errorf("s2 journey = %#v", s2)
	}
}
