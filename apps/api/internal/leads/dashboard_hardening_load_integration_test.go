package leads

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// Opt-in only: creates its own database on an explicitly selected loopback
// PostgreSQL instance, runs synthetic GET handlers, and removes that database.
func TestDashboardHardeningLocalLoadIntegration(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DASHBOARD_LOAD_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_DASHBOARD_LOAD_DB_TESTS=LOCAL_WRITE_TEST and DASHBOARD_LOAD_TEST_ADMIN_URL for the disposable local fixture")
	}
	parsed, err := url.Parse(strings.TrimSpace(os.Getenv("DASHBOARD_LOAD_TEST_ADMIN_URL")))
	if err != nil || parsed.User == nil || parsed.User.Username() != "postgres" || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") || parsed.Path != "/postgres" {
		t.Fatal("dashboard load fixture requires an explicit loopback postgres admin URL")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 120*time.Second)
	defer cancel()
	admin, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: parsed.String(), MaxConns: 2, HealthTimeout: 10 * time.Second})
	if err != nil {
		t.Fatalf("open local fixture: %v", err)
	}
	t.Cleanup(admin.Close)
	var suffix [8]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		t.Fatal(err)
	}
	databaseName := "vimob_dashboard_load_" + hex.EncodeToString(suffix[:])
	if _, err := admin.Pool().Exec(ctx, "create database "+databaseName); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, done := context.WithTimeout(context.Background(), 15*time.Second)
		defer done()
		if _, err := admin.Pool().Exec(cleanupCtx, "drop database "+databaseName+" with (force)"); err != nil {
			t.Errorf("remove local fixture: %v", err)
		}
	})
	parsed.Path = "/" + databaseName
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: parsed.String(), MaxConns: 8, HealthTimeout: 10 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(database.Close)
	for index, statement := range strings.Split(dashboardGenerationTestSchema+dashboardLoadFixtureSchema+dashboardLoadFixtureData, ";") {
		statement = strings.TrimSpace(statement)
		if statement == "" {
			continue
		}
		if _, err := database.Pool().Exec(ctx, statement); err != nil {
			t.Fatalf("prepare synthetic fixture step %d: %v", index, err)
		}
	}
	runDashboardHardeningLocalFixtureChecks(t, ctx, database, true)
}

// This opt-in check can reuse only a prepared synthetic fixture database. It
// avoids CREATE/DROP checkpoint time and enforces read-only PostgreSQL sessions.
func TestDashboardHardeningPreparedLocalFixtureReadOnly(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DASHBOARD_PREPARED_READONLY_TESTS") != "LOCAL_READ_TEST" {
		t.Skip("set VIMOB_RUN_DASHBOARD_PREPARED_READONLY_TESTS=LOCAL_READ_TEST and DASHBOARD_PREPARED_TEST_DATABASE_URL for a prepared synthetic fixture")
	}
	parsed, err := url.Parse(strings.TrimSpace(os.Getenv("DASHBOARD_PREPARED_TEST_DATABASE_URL")))
	if err != nil || parsed.User == nil || parsed.User.Username() != "postgres" || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") || !strings.HasPrefix(parsed.Path, "/vimob_dashboard_load_") {
		t.Fatal("prepared fixture requires an explicit loopback synthetic dashboard database")
	}
	suffix, err := hex.DecodeString(strings.TrimPrefix(parsed.Path, "/vimob_dashboard_load_"))
	if err != nil || len(suffix) != 8 {
		t.Fatal("prepared fixture database name must have its generated 16-character hexadecimal suffix")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 120*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: parsed.String(), MaxConns: 8, HealthTimeout: 10 * time.Second, ForceReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(database.Close)
	runDashboardHardeningLocalFixtureChecks(t, ctx, database, false)
}

func runDashboardHardeningLocalFixtureChecks(t *testing.T, ctx context.Context, database *dbpkg.Postgres, allowFixtureUpdate bool) {
	t.Helper()
	repo := NewRepository(database, nil)
	adminViewer := tenant.Context{OrganizationID: dashboardLoadOrganizationID, UserID: dashboardLoadLeaderID, MemberRole: "admin"}
	leaderViewer := tenant.Context{OrganizationID: dashboardLoadOrganizationID, UserID: dashboardLoadLeaderID, MemberRole: "member", IsTeamLeader: true, Permissions: []string{permissions.DashboardView, permissions.LeadViewTeam}, LedUserIDs: []string{dashboardLoadBrokerID}, LedTeamIDs: []string{dashboardLoadTeamID}}
	brokerViewer := tenant.Context{OrganizationID: dashboardLoadOrganizationID, UserID: dashboardLoadBrokerID, MemberRole: "member", Permissions: []string{permissions.DashboardView, permissions.LeadViewOwn}}
	for _, fixture := range []struct {
		name   string
		viewer tenant.Context
		want   int64
	}{{"admin", adminViewer, 20001}, {"leader", leaderViewer, 10000}, {"broker", brokerViewer, 10000}} {
		cte, _, arguments, err := repo.buildDashboardEntriesCTE(fixture.viewer, DashboardFilter{})
		if err != nil {
			t.Fatal(err)
		}
		// Independently compare the set-based first-arrival choice with the old
		// per-card lookup, including duplicate/non-countable and absent initials.
		var mismatches int64
		if err := database.Pool().QueryRow(ctx, cte+`
			select count(*)::bigint from entries entry
			join visible_cards card on card.id = entry.lead_id
			left join lateral (
				select id, occurred_at, source, campaign_id, metadata
				from public.lead_entry_events history
				where history.organization_id = card.organization_id and history.lead_id = card.id
				  and history.entry_type = 'initial'
				order by history.occurred_at, history.created_at, history.id limit 1
			) expected on true
			where not entry.is_reentry and
			  row(entry.entry_id, entry.occurred_at, entry.source, entry.campaign_id, entry.creative_id)
			  is distinct from row(coalesce(expected.id::text, 'initial:' || card.id::text),
				coalesce(expected.occurred_at, card.created_at), nullif(expected.source, ''),
				nullif(expected.campaign_id, ''), nullif(btrim(expected.metadata->>'creative_id'), ''))
		`, arguments...).Scan(&mismatches); err != nil {
			t.Fatal(err)
		}
		if mismatches != 0 {
			t.Fatalf("%s first-arrival facts differ from the independent historical lookup: %d", fixture.name, mismatches)
		}
		stats, err := repo.GetDashboardStats(ctx, fixture.viewer, DashboardFilter{})
		if err != nil {
			t.Fatalf("%s stats: %v", fixture.name, err)
		}
		if stats.TotalLeads != fixture.want || stats.TotalReceivables != 0 || stats.TotalPayables != 0 || stats.PendingCommissions != 0 || stats.OverdueReceivables != 0 || stats.OverduePayables != 0 || stats.PaidCommissions != 0 {
			t.Fatalf("%s stats = %#v", fixture.name, stats)
		}
		unassigned, err := repo.GetDashboardStats(ctx, fixture.viewer, DashboardFilter{UserID: "unassigned"})
		if err != nil {
			t.Fatal(err)
		}
		wantUnassigned := int64(0)
		if fixture.name == "admin" {
			wantUnassigned = 1
		}
		if unassigned.TotalLeads != wantUnassigned {
			t.Fatalf("%s unassigned = %d", fixture.name, unassigned.TotalLeads)
		}
	}
	// Validate the optimized previous status counters against the former independent
	// counts over the same filters and one repeatable-read snapshot.
	tx, err := database.Pool().BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		t.Fatal(err)
	}
	for _, status := range []string{"", "open", "won", "lost"} {
		filter := DashboardFilter{DealStatus: status}
		aggregate, err := repo.dashboardAggregate(ctx, tx, adminViewer, filter, dashboardLeadWhereOptions{DateColumn: "created_at"})
		if err != nil {
			t.Fatal(err)
		}
		won, err := repo.dashboardWonCount(ctx, tx, adminViewer, filter)
		if err != nil {
			t.Fatal(err)
		}
		lost, err := repo.dashboardLostCount(ctx, tx, adminViewer, filter)
		if err != nil {
			t.Fatal(err)
		}
		if aggregate.Won != won || aggregate.Lost != lost {
			t.Fatalf("status %s parity: %#v / %d / %d", status, aggregate, won, lost)
		}
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	for _, optimized := range []bool{false, true} {
		started := time.Now()
		for sample := 0; sample < 10; sample++ {
			if _, err := repo.dashboardAggregate(ctx, database.Pool(), adminViewer, DashboardFilter{}, dashboardLeadWhereOptions{DateColumn: "created_at"}); err != nil {
				t.Fatal(err)
			}
			if !optimized {
				if _, err := repo.dashboardWonCount(ctx, database.Pool(), adminViewer, DashboardFilter{}); err != nil {
					t.Fatal(err)
				}
				if _, err := repo.dashboardLostCount(ctx, database.Pool(), adminViewer, DashboardFilter{}); err != nil {
					t.Fatal(err)
				}
			}
		}
		t.Logf("local status-count comparison optimized=%v: mean %.1fms over 10 samples (one query versus former three-query path)", optimized, float64(time.Since(started).Microseconds())/10000)
	}

	before, err := repo.GetDashboardStats(ctx, adminViewer, DashboardFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if before.UniqueLeads != 20001 || before.Reentries != 709 {
		t.Fatalf("entry parity = %#v", before)
	}
	if before.TotalSalesValue != float64(before.ClosedLeads)*500000 {
		t.Fatal("VGV must preserve its documented current-property-price fallback")
	}
	if allowFixtureUpdate {
		if _, err := database.Pool().Exec(ctx, "update public.properties set preco = 550000"); err != nil {
			t.Fatal(err)
		}
		after, err := repo.GetDashboardStats(ctx, adminViewer, DashboardFilter{})
		if err != nil {
			t.Fatal(err)
		}
		if after.TotalSalesValue-before.TotalSalesValue != float64(before.ClosedLeads)*50000 {
			t.Fatal("VGV must preserve its documented current-price fallback rather than inventing realized revenue")
		}
		t.Logf("VGV current-price fallback confirmed: %d won cards, change %.0f; financial placeholders remain zero", before.ClosedLeads, after.TotalSalesValue-before.TotalSalesValue)
		if _, err := database.Pool().Exec(ctx, "update public.properties set preco = 500000"); err != nil {
			t.Fatal(err)
		}
	}

	from := time.Date(2026, 10, 1, 3, 0, 0, 0, time.UTC)
	to := time.Date(2026, 10, 15, 2, 59, 59, 999000000, time.UTC)
	evolution, err := repo.GetDashboardDealsEvolution(ctx, adminViewer, DashboardFilter{DateFrom: &from, DateTo: &to})
	if err != nil {
		t.Fatal(err)
	}
	var evolutionTotal int64
	for _, point := range evolution {
		evolutionTotal += point.Ganhos + point.Perdas + point.Abertos
	}
	if evolutionTotal != 20001 {
		t.Fatalf("evolution total = %d", evolutionTotal)
	}
	var civilDayCount int64
	if err := database.Pool().QueryRow(ctx, `select count(*)::bigint from public.leads where organization_id = $1::uuid and created_at >= '2026-10-08T03:00:00Z'::timestamptz and created_at < '2026-10-09T03:00:00Z'::timestamptz`, dashboardLoadOrganizationID).Scan(&civilDayCount); err != nil {
		t.Fatal(err)
	}
	foundCivilDay := false
	for _, point := range evolution {
		if point.Date == "08/10" && point.Ganhos+point.Perdas+point.Abertos != civilDayCount {
			t.Fatalf("actual SQL bucket differs from the independent civil-midnight query: got %d, want %d", point.Ganhos+point.Perdas+point.Abertos, civilDayCount)
		}
		foundCivilDay = foundCivilDay || point.Date == "08/10"
	}
	if !foundCivilDay {
		t.Fatal("evolution omitted the expected civil-day bucket")
	}
	creativeQuery, creativeArgs, err := repo.buildDashboardCreativesQuery(adminViewer, DashboardFilter{DateFrom: &from, DateTo: &to})
	if err != nil {
		t.Fatal(err)
	}
	planRows, err := database.Pool().Query(ctx, "explain (analyze, buffers, format text) "+creativeQuery, creativeArgs...)
	if err != nil {
		t.Fatal(err)
	}
	for planRows.Next() {
		var line string
		if err := planRows.Scan(&line); err != nil {
			planRows.Close()
			t.Fatal(err)
		}
		if strings.Contains(line, "actual time") || strings.Contains(line, "Execution Time") || strings.Contains(line, "Sort Method") || strings.Contains(line, "Buffers:") || strings.Contains(line, "JIT:") || strings.Contains(line, "Timing:") || strings.Contains(line, "Functions:") {
			t.Log("creative plan: " + line)
		}
	}
	if err := planRows.Err(); err != nil {
		planRows.Close()
		t.Fatal(err)
	}
	planRows.Close()

	handler := NewHandler(repo)
	routes := map[string]http.HandlerFunc{
		"stats": handler.ShowDashboardStats, "sources": handler.ShowDashboardSources,
		"campaigns": handler.ShowDashboardCampaigns, "creatives": handler.ShowDashboardCreatives,
		"deals-evolution": handler.ShowDashboardDealsEvolution, "lead-distribution": handler.ShowDashboardLeadDistribution,
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/v1/dashboard/")
		if route := routes[name]; route != nil {
			route(w, r.WithContext(tenant.ContextWithTenant(r.Context(), adminViewer)))
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(server.Close)
	names := []string{"stats", "sources", "campaigns", "creatives", "deals-evolution", "lead-distribution"}
	client := &http.Client{Timeout: 15 * time.Second}
	var mutex sync.Mutex
	measurements := map[string][]float64{}
	var workers sync.WaitGroup
	for worker := 0; worker < 10; worker++ {
		workers.Add(1)
		go func(worker int) {
			defer workers.Done()
			for index := 0; index < 6; index++ {
				name := names[(worker+index)%len(names)]
				started := time.Now()
				response, err := client.Get(server.URL + "/v1/dashboard/" + name + "?dateFrom=2026-10-01T03:00:00Z&dateTo=2026-10-15T02:59:59Z&countEntries=true")
				if err != nil {
					t.Errorf("GET %s: %v", name, err)
					return
				}
				body, readErr := io.ReadAll(io.LimitReader(response.Body, 4<<20))
				response.Body.Close()
				if response.StatusCode != http.StatusOK || readErr != nil || !json.Valid(body) {
					t.Errorf("GET %s returned status %d, valid JSON %v", name, response.StatusCode, json.Valid(body))
					return
				}
				mutex.Lock()
				measurements[name] = append(measurements[name], float64(time.Since(started).Microseconds())/1000)
				mutex.Unlock()
			}
		}(worker)
	}
	workers.Wait()
	for _, name := range names {
		values := measurements[name]
		sort.Float64s(values)
		if len(values) != 10 {
			t.Fatalf("%s samples = %d", name, len(values))
		}
		t.Logf("local synthetic GET /dashboard/%s: n=%d p50=%.1fms p95=%.1fms max=%.1fms", name, len(values), values[4], values[9], values[9])
	}
}

const (
	dashboardLoadOrganizationID = "71111111-1111-4111-8111-111111111111"
	dashboardLoadLeaderID       = "72222222-2222-4222-8222-222222222222"
	dashboardLoadBrokerID       = "73333333-3333-4333-8333-333333333333"
	dashboardLoadTeamID         = "74444444-4444-4444-8444-444444444444"
)

const dashboardLoadFixtureSchema = `
alter table public.team_members add column is_leader boolean not null default false;
alter table public.leads add column created_at timestamptz, add column deal_status text, add column name text,
  add column email text, add column phone text, add column source text, add column pipeline_id uuid,
  add column property_id uuid, add column interest_property_id uuid, add column valor_interesse numeric default 0,
  add column won_at timestamptz, add column lost_at timestamptz, add column lost_reason text,
  add column first_response_seconds bigint, add column first_response_actor_user_id uuid,
  add column first_response_is_automation boolean, add column first_response_at timestamptz;
create table public.properties(id uuid primary key, organization_id uuid, responsible_user_id uuid, created_by uuid, preco numeric, valor_venda_avaliado numeric);
create table public.organization_attention_settings(organization_id uuid primary key, timezone text);
create table public.lead_entry_events(id uuid primary key, organization_id uuid, lead_id uuid, entry_type text, is_countable boolean default true, occurred_at timestamptz, created_at timestamptz, source text, page_id text, page_name text, campaign_id text, campaign_name text, utm_campaign text, adset_id text, adset_name text, ad_id text, ad_name text, provider text, metadata jsonb default '{}');
-- Reproduce existing baseline indexes, not a proposed production index.
create index idx_lead_entry_events_lead on public.lead_entry_events(lead_id);
create index idx_leads_dashboard_user_created on public.leads(organization_id, assigned_user_id, created_at desc);
create index idx_leads_organization on public.leads(organization_id);
create index lead_entry_events_org_occurred_idx on public.lead_entry_events(organization_id, occurred_at desc);
create index idx_lead_entry_events_org_date on public.lead_entry_events(organization_id, created_at desc);
create index lead_entry_events_lead_history_idx on public.lead_entry_events(organization_id, lead_id, occurred_at desc) where is_countable = true;
create index lead_entry_events_campaign_history_idx on public.lead_entry_events(organization_id, campaign_id, occurred_at desc, lead_id) where is_countable = true and campaign_id is not null;
create index lead_entry_events_adset_history_idx on public.lead_entry_events(organization_id, adset_id, occurred_at desc, lead_id) where is_countable = true and adset_id is not null;
create index lead_entry_events_ad_history_idx on public.lead_entry_events(organization_id, ad_id, occurred_at desc, lead_id) where is_countable = true and ad_id is not null;
`

const dashboardLoadFixtureData = `
insert into public.users(id, name) values
  ('72222222-2222-4222-8222-222222222222','Líder QA'), ('73333333-3333-4333-8333-333333333333','Corretor QA'), ('75555555-5555-4555-8555-555555555555','Outro corretor QA');
insert into public.organization_members(organization_id, user_id) select '71111111-1111-4111-8111-111111111111'::uuid, id from public.users;
insert into public.teams(id, organization_id, name) values ('74444444-4444-4444-8444-444444444444','71111111-1111-4111-8111-111111111111','Equipe QA');
insert into public.team_members(team_id, organization_id, user_id, is_leader) values
  ('74444444-4444-4444-8444-444444444444','71111111-1111-4111-8111-111111111111','72222222-2222-4222-8222-222222222222',true),
  ('74444444-4444-4444-8444-444444444444','71111111-1111-4111-8111-111111111111','73333333-3333-4333-8333-333333333333',false);
insert into public.organization_attention_settings values ('71111111-1111-4111-8111-111111111111','America/Sao_Paulo');
insert into public.properties values ('76666666-6666-4666-8666-666666666666','71111111-1111-4111-8111-111111111111','73333333-3333-4333-8333-333333333333',null,500000,600000);
insert into public.leads(id, organization_id, assigned_user_id, created_at, deal_status, name, source, property_id, won_at)
select md5('dashboard-load-'||n)::uuid, '71111111-1111-4111-8111-111111111111'::uuid,
  case when n%2=0 then '73333333-3333-4333-8333-333333333333'::uuid else '75555555-5555-4555-8555-555555555555'::uuid end,
  '2026-10-08 03:00:00+00'::timestamptz+(n%7)*interval '1 day'+(n%23)*interval '1 hour',
  case n%3 when 0 then 'won' when 1 then 'lost' else 'open' end, 'Lead QA '||n, 'Importação '||(n%547),
  '76666666-6666-4666-8666-666666666666'::uuid, '2026-10-20 03:00:00+00'::timestamptz
from generate_series(1,20000) n;
insert into public.leads(id, organization_id, assigned_user_id, team_id, created_at, deal_status, name, source)
values ('77777777-7777-4777-8777-777777777777','71111111-1111-4111-8111-111111111111',null,'74444444-4444-4444-8444-444444444444','2026-10-09 01:00:00+00','open','Lead sem responsável QA',repeat('ã',500)),
  ('78888888-8888-4888-8888-888888888888','79999999-9999-4999-8999-999999999999','73333333-3333-4333-8333-333333333333',null,'2026-10-09 03:00:00+00','open','Outra organização QA','Outro');
insert into public.lead_entry_events(id, organization_id, lead_id, entry_type, occurred_at, created_at, source, campaign_id, campaign_name, ad_id, provider, metadata)
select md5('initial-'||id)::uuid,organization_id,id,'initial',created_at,created_at,source,
  (row_number() over()%334)::text,'Campanha QA '||(row_number() over()%334),(row_number() over()%10+1)::text,'meta',jsonb_build_object('creative_id',(row_number() over()%10+1)::text,'creative_name','Criativo QA')
from public.leads where organization_id='71111111-1111-4111-8111-111111111111';
insert into public.lead_entry_events(id, organization_id, lead_id, entry_type, occurred_at, created_at, source, campaign_id, campaign_name, ad_id, provider, metadata)
select md5('reentry-'||lead_id)::uuid,organization_id,lead_id,'reentry',occurred_at+interval '1 hour',created_at+interval '1 hour',source,campaign_id,campaign_name,ad_id,provider,metadata from public.lead_entry_events order by id limit 709;
-- Exercise missing and duplicate first-arrival facts without changing card or
-- countable reentry totals. The earliest initial is deliberately non-countable.
delete from public.lead_entry_events where lead_id='77777777-7777-4777-8777-777777777777' and entry_type='initial';
insert into public.lead_entry_events(id, organization_id, lead_id, entry_type, is_countable, occurred_at, created_at, source, campaign_id, campaign_name, ad_id, provider, metadata)
select md5('earliest-duplicate-'||lead_id)::uuid,organization_id,lead_id,'initial',false,'2026-10-07T03:00:00Z'::timestamptz,created_at,'Entrada primária histórica',campaign_id,campaign_name,ad_id,provider,metadata
from public.lead_entry_events where lead_id=md5('dashboard-load-2')::uuid and entry_type='initial';
insert into public.lead_entry_events(id, organization_id, lead_id, entry_type, is_countable, occurred_at, created_at, source, campaign_id, campaign_name, ad_id, provider, metadata)
select md5('late-duplicate-'||lead_id)::uuid,organization_id,lead_id,'initial',true,'2026-10-14T03:00:00Z'::timestamptz,created_at,'Duplicata tardia',campaign_id,campaign_name,ad_id,provider,metadata
from public.lead_entry_events where lead_id=md5('dashboard-load-3')::uuid and entry_type='initial';
analyze public.leads;
analyze public.lead_entry_events;
`
