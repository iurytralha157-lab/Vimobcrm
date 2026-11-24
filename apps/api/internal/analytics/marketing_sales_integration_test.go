package analytics

import (
	"context"
	"net/url"
	"os"
	"regexp"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestCampaignInsightsReconcilesClosingDateAndCampaignEvidence(t *testing.T) {
	databaseURL := os.Getenv("MARKETING_SALES_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set MARKETING_SALES_TEST_DATABASE_URL to an isolated local marketing_sales_analytics_fixture database")
	}
	parsed, err := url.Parse(databaseURL)
	if err != nil || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost" && parsed.Hostname() != "::1") || parsed.Path != "/marketing_sales_analytics_fixture" {
		t.Fatal("fixture requires a loopback connection to marketing_sales_analytics_fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 2})
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	foundation, err := os.ReadFile("../../../../supabase/migrations/20260731120000_marketing_intelligence_foundation.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.Pool().Exec(ctx, businessScopeFixtureSQL+marketingSalesFixtureSchemaSQL); err != nil {
		t.Fatalf("prepare synthetic CRM schema: %v", err)
	}
	marketingTables := regexp.MustCompile(`(?ms)^create table if not exists public\.marketing_(accounts|performance_daily|social_daily|media_assets) \(.*?^\);`).FindAll(foundation, -1)
	if len(marketingTables) != 4 {
		t.Fatal("Marketing foundation is missing a fixture table")
	}
	for _, table := range marketingTables {
		if _, err := database.Pool().Exec(ctx, string(table)); err != nil {
			t.Fatalf("prepare Marketing schema: %v", err)
		}
	}
	if _, err := database.Pool().Exec(ctx, marketingSalesFixtureSQL); err != nil {
		t.Fatalf("prepare synthetic fixture: %v", err)
	}
	repo := NewRepository(database)
	admin := tenant.Context{OrganizationID: businessOrg, UserID: businessLeader, MemberRole: "admin"}
	broker := tenant.Context{OrganizationID: businessOrg, UserID: businessBroker, Permissions: []string{permissions.LeadViewOwn}}
	leader := tenant.Context{OrganizationID: businessOrg, UserID: businessLeader, Permissions: []string{permissions.LeadViewOwn, permissions.LeadViewTeam}}
	campaignOnly := tenant.Context{OrganizationID: businessOrg, UserID: businessBroker, Permissions: []string{permissions.DashboardCampaignsView}}
	foreign := tenant.Context{OrganizationID: businessOtherOrg, UserID: businessForeign, MemberRole: "admin"}

	for _, tc := range []struct {
		name     string
		actor    tenant.Context
		filters  url.Values
		sales    any
		campaign any
		cohort   float64
	}{
		{"organization", admin, nil, float64(3), float64(1), 1},
		{"own leads", broker, nil, float64(2), float64(1), 1},
		{"led team", leader, nil, float64(2), float64(1), 1},
		{"campaign only permission", campaignOnly, nil, nil, nil, 1},
		{"other organization", foreign, nil, float64(1), float64(0), 0},
		{"historic account and objective", admin, url.Values{"accountId": {"act_sales"}, "objective": {"OUTCOME_LEADS"}}, float64(1), float64(1), 0},
		{"campaign at closing", admin, url.Values{"campaignIds": {"sales_old"}}, float64(1), float64(1), 0},
		{"campaign after closing", admin, url.Values{"campaignIds": {"sales_future"}}, float64(0), float64(0), 0},
		{"other account", admin, url.Values{"accountId": {"act_other"}}, float64(0), float64(0), 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			filters := url.Values{"dateFrom": {"2026-11-01"}, "dateTo": {"2026-11-01"}}
			for key, values := range tc.filters {
				filters[key] = values
			}
			item, err := repo.CampaignInsights(ctx, tc.actor, filters)
			if err != nil {
				t.Fatal(err)
			}
			summary := item["summary"].(map[string]any)
			if summary["crmSalesCount"] != tc.sales || summary["crmAttributedSales"] != tc.campaign || summary["totalWon"] != tc.cohort {
				t.Fatalf("sales=%v campaign=%v cohort=%v, want %v/%v/%v", summary["crmSalesCount"], summary["crmAttributedSales"], summary["totalWon"], tc.sales, tc.campaign, tc.cohort)
			}
			if tc.sales != nil && tc.sales != float64(0) {
				days := item["dailyData"].([]any)
				if len(days) != 1 {
					t.Fatalf("daily buckets=%d, want 1", len(days))
				}
				day := days[0].(map[string]any)
				if day["date"] != "2026-11-01" || day["crmSalesCount"] != tc.sales {
					t.Fatalf("sales must be grouped by local closing date: %#v", day)
				}
			}
			if tc.campaign != float64(1) {
				return
			}
			seen := false
			for _, raw := range item["campaigns"].([]any) {
				campaign := raw.(map[string]any)
				if campaign["campaign_id"] != "sales_old" {
					continue
				}
				seen = true
				if campaign["sales_count"] != tc.campaign || campaign["leads_count"] != float64(0) {
					t.Fatalf("prior-period lead must only add a sale to the campaign: %#v", campaign)
				}
				adset := campaign["adsets"].([]any)[0].(map[string]any)
				ad := adset["ads"].([]any)[0].(map[string]any)
				if adset["adset_id"] != "sales_adset" || adset["sales_count"] != tc.campaign || ad["ad_id"] != "sales_ad" || ad["sales_count"] != tc.campaign {
					t.Fatalf("sale dimensions disagree: %#v / %#v", adset, ad)
				}
			}
			if !seen {
				t.Fatal("campaign with a sale but no in-period clicks or leads is missing")
			}
		})
	}
}

const marketingSalesFixtureSchemaSQL = `
create schema if not exists vault;
create table if not exists vault.decrypted_secrets (id uuid, decrypted_secret text);
create table if not exists public.organizations (id uuid primary key);
insert into public.organizations values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002') on conflict do nothing;
create table if not exists public.meta_integrations (
  id uuid, organization_id uuid, page_id text, access_token_secret_ref uuid,
  user_access_token_secret_ref uuid, token_expires_at timestamptz, granted_scopes text[],
  instagram_business_account_id text, is_connected boolean, token_status text,
  selected_ad_accounts jsonb, ad_account_id text, last_sync_at timestamptz,
  primary key (id, organization_id)
);
create table if not exists public.meta_campaign_insights (organization_id uuid);
create table if not exists public.organization_attention_settings (organization_id uuid, timezone text);
alter table public.leads add column if not exists name text, add column if not exists source text,
  add column if not exists lost_at timestamptz;
create table if not exists public.lead_entry_events (
  id uuid primary key, organization_id uuid, lead_id uuid, entry_type text,
  occurred_at timestamptz, created_at timestamptz, is_countable boolean,
  provider text, source text, campaign_id text, campaign_name text, adset_id text,
  adset_name text, ad_id text, ad_name text, page_id text
);
create table if not exists public.lead_funnel_events (
  id uuid primary key, organization_id uuid, lead_id uuid, lead_entry_event_id uuid,
  event_kind text, occurred_at timestamptz, metadata jsonb
);
create table if not exists public.lead_action_facts (
  organization_id uuid, lead_id uuid, qualifies_first_outreach boolean, is_automated boolean,
  is_inbound boolean, is_effective_contact boolean, occurred_at timestamptz
);
create table if not exists public.lead_tags (organization_id uuid, lead_id uuid, tag_id uuid);`

const marketingSalesFixtureSQL = `
insert into public.leads (id, organization_id, name, source, assigned_user_id, deal_status, won_at)
values
  ('10000000-0000-4000-8000-000000000201', '10000000-0000-4000-8000-000000000001', 'October ad', 'meta', '10000000-0000-4000-8000-000000000012', 'won', '2026-11-02 02:59Z'),
  ('10000000-0000-4000-8000-000000000202', '10000000-0000-4000-8000-000000000001', 'Manual', 'manual', '10000000-0000-4000-8000-000000000012', 'won', '2026-11-01 17:00Z'),
  ('10000000-0000-4000-8000-000000000203', '10000000-0000-4000-8000-000000000001', 'Facebook legacy', 'facebook', '10000000-0000-4000-8000-000000000014', 'won', '2026-11-01 18:00Z'),
  ('10000000-0000-4000-8000-000000000204', '10000000-0000-4000-8000-000000000001', 'Reopened', 'meta', '10000000-0000-4000-8000-000000000012', 'open', null),
  ('10000000-0000-4000-8000-000000000205', '10000000-0000-4000-8000-000000000001', 'After midnight', 'manual', '10000000-0000-4000-8000-000000000012', 'won', '2026-11-02 03:00Z'),
  ('10000000-0000-4000-8000-000000000206', '10000000-0000-4000-8000-000000000002', 'Other tenant', 'manual', '10000000-0000-4000-8000-000000000015', 'won', '2026-11-01 18:00Z')
on conflict (id) do nothing;

insert into public.lead_entry_events (id, organization_id, lead_id, entry_type, occurred_at, created_at, is_countable, provider, source, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, page_id)
values
  ('10000000-0000-4000-8000-000000000211', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000201', 'initial', '2026-10-26 12:00Z', '2026-10-26 12:00Z', true, 'meta', 'meta', 'sales_superseded', 'Superseded', null, null, null, null, 'sales_page'),
  ('10000000-0000-4000-8000-000000000212', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000201', 'reentry', '2026-10-27 12:00Z', '2026-10-27 12:00Z', true, 'meta', 'meta', 'sales_old', 'October campaign', 'sales_adset', 'Ad set', 'sales_ad', 'Ad', 'sales_page'),
  ('10000000-0000-4000-8000-000000000213', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000201', 'reentry', '2026-10-28 12:00Z', '2026-10-28 12:00Z', false, 'meta', 'meta', 'sales_invalid', 'Non-countable', null, null, null, null, 'sales_page'),
  ('10000000-0000-4000-8000-000000000214', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000201', 'reentry', '2026-11-02 03:00Z', '2026-11-02 03:00Z', true, 'meta', 'meta', 'sales_future', 'After closing', null, null, null, null, 'sales_page'),
  ('10000000-0000-4000-8000-000000000215', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000204', 'initial', '2026-11-01 12:00Z', '2026-11-01 12:00Z', true, 'meta', 'meta', 'sales_cohort', 'Reopened cohort', null, null, null, null, 'sales_page')
on conflict (id) do nothing;

insert into public.lead_funnel_events (id, organization_id, lead_id, lead_entry_event_id, event_kind, occurred_at)
values ('10000000-0000-4000-8000-000000000221', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000204', '10000000-0000-4000-8000-000000000215', 'converted', '2026-11-01 13:00Z')
on conflict (id) do nothing;

insert into public.marketing_performance_daily (organization_id, provider, external_account_id, level, entity_id, metric_date, campaign_id, campaign_name, objective)
values ('10000000-0000-4000-8000-000000000001', 'meta', 'act_sales', 'campaign', 'sales_old', '2026-10-27', 'sales_old', 'October campaign', 'OUTCOME_LEADS')
on conflict do nothing;`
