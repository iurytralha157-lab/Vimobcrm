package leads

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// Opt-in only: each run creates and removes a synthetic database on the
// explicitly selected local PostgreSQL instance, never an existing database.
func TestDashboardTopBrokersFinancialLocalIntegration(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DASHBOARD_FINANCIAL_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_DASHBOARD_FINANCIAL_DB_TESTS=LOCAL_WRITE_TEST and DASHBOARD_FINANCIAL_TEST_ADMIN_URL for a disposable local fixture")
	}
	parsed, err := url.Parse(strings.TrimSpace(os.Getenv("DASHBOARD_FINANCIAL_TEST_ADMIN_URL")))
	if err != nil || parsed.User == nil || parsed.User.Username() != "postgres" ||
		(parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") ||
		(parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") || parsed.Path != "/postgres" {
		t.Fatal("financial fixture requires an explicit loopback postgres admin URL")
	}
	t.Setenv("FINANCIAL_ORGANIZATION_IDS", "")
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
	databaseName := "vimob_dashboard_financial_" + hex.EncodeToString(suffix[:])
	if _, err := admin.Pool().Exec(ctx, "create database "+databaseName); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, done := context.WithTimeout(context.Background(), 30*time.Second)
		defer done()
		if _, err := admin.Pool().Exec(cleanupCtx, "drop database "+databaseName+" with (force)"); err != nil {
			t.Errorf("remove financial fixture: %v", err)
		}
	})
	parsed.Path = "/" + databaseName
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: parsed.String(), MaxConns: 2, HealthTimeout: 10 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(database.Close)
	for index, statement := range strings.Split(dashboardGenerationTestSchema+dashboardLoadFixtureSchema+dashboardFinancialFixtureData, ";") {
		if statement = strings.TrimSpace(statement); statement == "" {
			continue
		}
		if _, err := database.Pool().Exec(ctx, statement); err != nil {
			t.Fatalf("prepare financial fixture step %d: %v", index, err)
		}
	}
	repo := NewRepository(database, nil)
	base := tenant.Context{
		OrganizationID: dashboardFinancialOrg, OrganizationName: "Vetter Co.",
		UserID: dashboardFinancialLeader, MemberRole: "manager",
		Permissions: []string{permissions.DashboardView, permissions.LeadViewAll},
	}
	actor := func(role, financialPermission string, enabled, leaderScoped bool) tenant.Context {
		viewer := base
		viewer.MemberRole = role
		viewer.Permissions = append([]string{}, base.Permissions...)
		if !enabled {
			viewer.OrganizationName = "Synthetic disabled financial module"
		}
		if leaderScoped {
			viewer.Permissions = []string{permissions.DashboardView, permissions.LeadViewOwn, permissions.LeadViewTeam}
			viewer.IsTeamLeader = true
			viewer.LedTeamIDs = []string{dashboardFinancialTeam}
			viewer.LedUserIDs = []string{dashboardFinancialLeader, dashboardFinancialBroker}
		}
		if financialPermission != "" {
			viewer.Permissions = append(viewer.Permissions, financialPermission)
		}
		return viewer
	}
	type expectedBroker struct {
		count      int64
		sales      float64
		commission *float64
	}
	amount := func(value float64) *float64 { return &value }
	global := func(leaderCommission, brokerCommission, outsideCommission *float64) map[string]expectedBroker {
		return map[string]expectedBroker{
			dashboardFinancialLeader:  {1, 100000, leaderCommission},
			dashboardFinancialBroker:  {2, 500000, brokerCommission},
			dashboardFinancialOutside: {1, 400000, outsideCommission},
		}
	}
	team := func(leaderCommission, brokerCommission *float64) map[string]expectedBroker {
		return map[string]expectedBroker{
			dashboardFinancialLeader: {1, 100000, leaderCommission},
			dashboardFinancialBroker: {2, 500000, brokerCommission},
		}
	}
	assertRanking := func(t *testing.T, viewer tenant.Context, filter DashboardFilter, fallback bool, expected map[string]expectedBroker) {
		t.Helper()
		result, err := repo.GetDashboardTopBrokers(ctx, viewer, filter)
		if err != nil {
			t.Fatal(err)
		}
		if result.IsFallbackMode != fallback || len(result.Brokers) != len(expected) {
			t.Fatalf("ranking mode/count: fallback=%v rows=%d; want %v/%d", result.IsFallbackMode, len(result.Brokers), fallback, len(expected))
		}
		seen := map[string]bool{}
		for _, row := range result.Brokers {
			want, ok := expected[row.ID]
			if !ok || seen[row.ID] {
				t.Fatalf("unexpected or duplicate broker %s", row.ID)
			}
			seen[row.ID] = true
			if row.ClosedLeads != want.count || row.SalesValue != want.sales {
				t.Fatalf("commercial ranking changed for %s: %d/%.0f want %d/%.0f", row.ID, row.ClosedLeads, row.SalesValue, want.count, want.sales)
			}
			if want.commission == nil {
				if row.TotalCommissions != nil {
					t.Fatalf("commission must be withheld for %s, got %.0f", row.ID, *row.TotalCommissions)
				}
			} else if row.TotalCommissions == nil || *row.TotalCommissions != *want.commission {
				t.Fatalf("commission differs for %s: got %v, want %.0f", row.ID, row.TotalCommissions, *want.commission)
			}
		}
	}
	for _, scenario := range []struct {
		name   string
		viewer tenant.Context
		want   map[string]expectedBroker
	}{
		{"dashboard_only", actor("manager", "", true, false), global(nil, nil, nil)},
		{"financial_read_own", actor("manager", permissions.FinancialView, true, false), global(amount(8988), nil, nil)},
		{"financial_manage", actor("manager", permissions.FinancialManage, true, false), global(amount(8988), amount(550), amount(400))},
		{"reader_without_module", actor("manager", permissions.FinancialView, false, false), global(nil, nil, nil)},
		{"manager_without_module", actor("manager", permissions.FinancialManage, false, false), global(nil, nil, nil)},
		{"admin_without_module", actor("admin", "", false, false), global(nil, nil, nil)},
		{"owner_without_module", actor("owner", "", false, false), global(nil, nil, nil)},
		{"admin_with_module", actor("admin", "", true, false), global(amount(8988), amount(550), amount(400))},
		{"owner_with_module", actor("owner", "", true, false), global(amount(8988), amount(550), amount(400))},
		{"leader_without_financial", actor("member", "", true, true), team(nil, nil)},
		{"leader_read_own", actor("member", permissions.FinancialView, true, true), team(amount(100), nil)},
		{"leader_manage_visible_leads", actor("member", permissions.FinancialManage, true, true), team(amount(100), amount(550))},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			assertRanking(t, scenario.viewer, DashboardFilter{}, false, scenario.want)
		})
	}
	t.Run("explicit_filter_keeps_commissions_in_the_same_lead_cohort", func(t *testing.T) {
		assertRanking(t, actor("manager", permissions.FinancialManage, true, false), DashboardFilter{UserID: dashboardFinancialBroker}, false,
			map[string]expectedBroker{dashboardFinancialBroker: {2, 500000, amount(550)}})
	})
	t.Run("other_organization_excludes_same_users_foreign_commissions", func(t *testing.T) {
		viewer := actor("manager", permissions.FinancialManage, true, false)
		viewer.OrganizationID = dashboardFinancialOtherOrg
		viewer.UserID = dashboardFinancialBroker
		assertRanking(t, viewer, DashboardFilter{}, false,
			map[string]expectedBroker{dashboardFinancialBroker: {1, 900000, amount(9000)}})
	})
	t.Run("own_lead_user_does_not_gain_a_ranking_from_financial_manage", func(t *testing.T) {
		viewer := actor("member", permissions.FinancialManage, true, false)
		viewer.Permissions = []string{permissions.DashboardView, permissions.LeadViewOwn, permissions.FinancialManage}
		assertRanking(t, viewer, DashboardFilter{}, false, map[string]expectedBroker{})
	})
	for _, scenario := range []struct {
		name       string
		permission string
		commission *float64
	}{
		{"fallback_without_financial", "", nil},
		{"fallback_reader_cannot_see_colleague", permissions.FinancialView, nil},
		{"fallback_manager_preserves_authorized_zero", permissions.FinancialManage, amount(0)},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			assertRanking(t, actor("manager", scenario.permission, true, false), DashboardFilter{DealStatus: "open"}, true,
				map[string]expectedBroker{dashboardFinancialBroker: {1, 500000, scenario.commission}})
		})
	}
}

const (
	dashboardFinancialOrg      = "81111111-1111-4111-8111-111111111111"
	dashboardFinancialOtherOrg = "89999999-9999-4999-8999-999999999999"
	dashboardFinancialLeader   = "82222222-2222-4222-8222-222222222222"
	dashboardFinancialBroker   = "83333333-3333-4333-8333-333333333333"
	dashboardFinancialOutside  = "85555555-5555-4555-8555-555555555555"
	dashboardFinancialTeam     = "84444444-4444-4444-8444-444444444444"
)

const dashboardFinancialFixtureData = `
-- These assigned synthetic leads have no managed pool override. Null keeps
-- the real own/team/all visibility predicate active for this financial check.
create schema private;
create function private.queue_pool_read_access(uuid,uuid,uuid) returns boolean language sql stable as 'select null::boolean';
create table public.commissions(id uuid primary key, organization_id uuid not null, lead_id uuid, user_id uuid, amount numeric, status text);
insert into public.users(id, name) values
 ('82222222-2222-4222-8222-222222222222','Lider sintetico'),
 ('83333333-3333-4333-8333-333333333333','Corretor sintetico'),
 ('85555555-5555-4555-8555-555555555555','Outro corretor sintetico');
insert into public.organization_members(organization_id, user_id)
 select org, id from public.users cross join (values ('81111111-1111-4111-8111-111111111111'::uuid),('89999999-9999-4999-8999-999999999999'::uuid)) orgs(org);
insert into public.teams(id, organization_id, name)
 values ('84444444-4444-4444-8444-444444444444','81111111-1111-4111-8111-111111111111','Equipe sintetica');
insert into public.team_members(team_id, organization_id, user_id, is_leader) values
 ('84444444-4444-4444-8444-444444444444','81111111-1111-4111-8111-111111111111','82222222-2222-4222-8222-222222222222',true),
 ('84444444-4444-4444-8444-444444444444','81111111-1111-4111-8111-111111111111','83333333-3333-4333-8333-333333333333',false);
insert into public.leads(id, organization_id, assigned_user_id, created_at, deal_status, name, source, valor_interesse, won_at)
 select md5('finance-lead-'||n)::uuid, org::uuid, owner::uuid, '2026-10-08T12:00:00Z', status, 'Lead sintetico '||n, 'manual', value, '2026-10-09T12:00:00Z'
 from (values
 (1,'81111111-1111-4111-8111-111111111111','82222222-2222-4222-8222-222222222222','won',100000),
 (2,'81111111-1111-4111-8111-111111111111','83333333-3333-4333-8333-333333333333','won',200000),
 (3,'81111111-1111-4111-8111-111111111111','83333333-3333-4333-8333-333333333333','won',300000),
 (4,'81111111-1111-4111-8111-111111111111','85555555-5555-4555-8555-555555555555','won',400000),
 (5,'81111111-1111-4111-8111-111111111111','83333333-3333-4333-8333-333333333333','open',500000),
 (6,'89999999-9999-4999-8999-999999999999','83333333-3333-4333-8333-333333333333','won',900000)
 ) fixture(n,org,owner,status,value);
insert into public.commissions(id, organization_id, lead_id, user_id, amount, status)
 select md5('finance-commission-'||n)::uuid, org::uuid, md5('finance-lead-'||lead)::uuid, owner::uuid, amount, status
 from (values
 (1,'81111111-1111-4111-8111-111111111111',1,'82222222-2222-4222-8222-222222222222',100,'approved'),
 (2,'81111111-1111-4111-8111-111111111111',2,'83333333-3333-4333-8333-333333333333',200,'approved'),
 (3,'81111111-1111-4111-8111-111111111111',2,'83333333-3333-4333-8333-333333333333',50,'paid'),
 (4,'81111111-1111-4111-8111-111111111111',3,'83333333-3333-4333-8333-333333333333',300,'forecast'),
 (5,'81111111-1111-4111-8111-111111111111',4,'85555555-5555-4555-8555-555555555555',400,'aprovada'),
 (6,'81111111-1111-4111-8111-111111111111',5,'83333333-3333-4333-8333-333333333333',500,'approved'),
 (7,'89999999-9999-4999-8999-999999999999',6,'83333333-3333-4333-8333-333333333333',9000,'paid'),
 (8,'89999999-9999-4999-8999-999999999999',2,'83333333-3333-4333-8333-333333333333',77777,'approved'),
 (9,'81111111-1111-4111-8111-111111111111',4,'82222222-2222-4222-8222-222222222222',8888,'approved'),
 (10,'81111111-1111-4111-8111-111111111111',3,'83333333-3333-4333-8333-333333333333',66666,'cancelled')
 ) fixture(n,org,lead,owner,amount,status);
`
