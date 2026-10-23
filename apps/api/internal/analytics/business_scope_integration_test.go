package analytics

import (
	"context"
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

const (
	businessOrg         = "10000000-0000-4000-8000-000000000001"
	businessOtherOrg    = "10000000-0000-4000-8000-000000000002"
	businessLeader      = "10000000-0000-4000-8000-000000000011"
	businessBroker      = "10000000-0000-4000-8000-000000000012"
	businessOtherLeader = "10000000-0000-4000-8000-000000000013"
	businessOutsider    = "10000000-0000-4000-8000-000000000014"
	businessForeign     = "10000000-0000-4000-8000-000000000015"
	businessTeam        = "10000000-0000-4000-8000-000000000021"
	businessOtherTeam   = "10000000-0000-4000-8000-000000000022"
)

func TestBusinessAnalyticsScopeAgainstLocalPostgres(t *testing.T) {
	t.Setenv("FINANCIAL_ORGANIZATION_IDS", "")
	databaseURL := strings.TrimSpace(os.Getenv("DASHBOARD_ANALYTICS_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set DASHBOARD_ANALYTICS_TEST_DATABASE_URL to an isolated local dashboard_p1_analytics database")
	}
	parsed, err := url.Parse(databaseURL)
	if err != nil || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost" && parsed.Hostname() != "::1") || parsed.Path != "/dashboard_p1_analytics" {
		t.Fatal("fixture requires loopback and the exact disposable database dashboard_p1_analytics")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 2})
	if err != nil {
		t.Fatalf("connect isolated fixture: %v", err)
	}
	defer database.Close()
	if _, err := database.Pool().Exec(ctx, businessScopeFixtureSQL); err != nil {
		t.Fatalf("prepare synthetic fixture: %v", err)
	}
	repo := NewRepository(database)
	broker := tenant.Context{OrganizationID: businessOrg, OrganizationName: "Vetter Co.", UserID: businessBroker, MemberRole: "user", Permissions: []string{permissions.DashboardView, permissions.LeadViewOwn}}
	leader := broker
	leader.UserID, leader.IsTeamLeader = businessLeader, true
	leader.Permissions = []string{permissions.DashboardView, permissions.LeadViewOwn, permissions.LeadViewTeam}
	leader.LedUserIDs, leader.LedTeamIDs = []string{businessLeader, businessBroker}, []string{businessTeam}
	admin := broker
	admin.MemberRole = "admin"
	manager := broker
	manager.MemberRole, manager.Permissions = "manager", []string{permissions.DashboardView, permissions.LeadViewOwn, permissions.LeadViewAll}
	foreign := broker
	foreign.OrganizationID, foreign.UserID = businessOtherOrg, businessForeign
	noLeads := broker
	noLeads.Permissions = []string{permissions.DashboardView}
	revokedLeader := leader
	revokedLeader.Permissions = []string{permissions.DashboardView, permissions.LeadViewOwn}
	for _, tc := range []struct {
		name         string
		viewer       tenant.Context
		count, value float64
		roster       []string
	}{
		{"broker", broker, 2, 300, []string{businessBroker}},
		{"leader", leader, 3, 350, []string{businessLeader, businessBroker}},
		{"manager", manager, 6, 2750, []string{businessLeader, businessBroker, businessOtherLeader, businessOutsider}},
		{"admin", admin, 6, 2750, []string{businessLeader, businessBroker, businessOtherLeader, businessOutsider}},
		{"other organization", foreign, 1, 5000, []string{businessForeign}},
		{"lead permission removed", noLeads, 0, 0, nil},
		{"team permission removed", revokedLeader, 1, 50, []string{businessLeader}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stats, err := repo.VGVStats(ctx, tc.viewer, url.Values{})
			if err != nil {
				t.Fatal(err)
			}
			if stats["totalLeads"] != tc.count || stats["totalVGV"] != tc.value {
				t.Errorf("VGV scope: got %#v; want count=%v value=%v", stats, tc.count, tc.value)
			}
			sla, err := repo.SlaSummary(ctx, tc.viewer, url.Values{})
			if err != nil {
				t.Fatal(err)
			}
			if sla["totalPending"] != tc.count {
				t.Errorf("SLA count=%v want %v", sla["totalPending"], tc.count)
			}
			stages, err := repo.StageVGV(ctx, tc.viewer, url.Values{})
			if err != nil {
				t.Fatal(err)
			}
			var count float64
			for _, stage := range stages {
				count += stage["leadsCount"].(float64)
			}
			if count != tc.count {
				t.Errorf("stage count=%v want %v", count, tc.count)
			}
			performance, err := repo.SlaPerformanceByUser(ctx, tc.viewer, url.Values{})
			if err != nil {
				t.Fatal(err)
			}
			assertBusinessRoster(t, performance, "user_id", tc.roster)
			brokers, err := repo.VGVByBroker(ctx, tc.viewer, url.Values{})
			if err != nil {
				t.Fatal(err)
			}
			assertBusinessRoster(t, brokers, "user_id", tc.roster)
			if tc.viewer.MemberRole != "admin" {
				for _, row := range brokers {
					if row["total_commission"] != nil {
						t.Errorf("unauthorized commission visible: %#v", row)
					}
				}
			}
			ranking, err := repo.TeamRanking(ctx, tc.viewer, url.Values{})
			if err != nil {
				t.Fatal(err)
			}
			rows := []map[string]any{}
			for _, item := range ranking["ranking"].([]any) {
				rows = append(rows, item.(map[string]any))
			}
			assertBusinessRoster(t, rows, "userId", tc.roster)
		})
	}
	t.Run("forged user filter intersects scope", func(t *testing.T) {
		stats, err := repo.VGVStats(ctx, broker, url.Values{"userId": {businessOutsider}})
		if err != nil {
			t.Fatal(err)
		}
		if stats["totalLeads"] != float64(0) {
			t.Fatalf("outside user leaked: %#v", stats)
		}
	})
	t.Run("leader catalog and tampered team", func(t *testing.T) {
		rows, err := repo.LeaderStats(ctx, leader)
		if err != nil {
			t.Fatal(err)
		}
		assertBusinessRoster(t, rows, "userId", []string{businessLeader})
		if len(rows) == 1 && rows[0]["totalLeads"] != float64(3) {
			t.Errorf("leader aggregate outside scope: %#v", rows)
		}
		rows, err = repo.TeamLeaderStats(ctx, leader, businessOtherTeam)
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != 0 {
			t.Errorf("unrelated team leaders leaked: %#v", rows)
		}
		rows, err = repo.LeaderStats(ctx, revokedLeader)
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != 0 {
			t.Errorf("revoked team permission exposed leaders: %#v", rows)
		}
		rows, err = repo.TeamLeaderStats(ctx, leader, businessTeam)
		if err != nil {
			t.Fatal(err)
		}
		assertBusinessRoster(t, rows, "userId", []string{businessLeader})
	})
	t.Run("enterprise financial permission", func(t *testing.T) {
		if _, err := repo.EnterpriseKPIs(ctx, broker, url.Values{}); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
			t.Errorf("broker enterprise must be forbidden; got %v", err)
		}
		viewer := broker
		viewer.Permissions = append(append([]string{}, broker.Permissions...), permissions.FinancialView)
		if _, err := repo.EnterpriseKPIs(ctx, viewer, url.Values{}); err != nil {
			t.Errorf("financial reader denied: %v", err)
		}
		viewer.OrganizationName = "Synthetic Other Company"
		if _, err := repo.EnterpriseKPIs(ctx, viewer, url.Values{}); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
			t.Errorf("unavailable module must be forbidden; got %v", err)
		}
	})
	t.Run("DRE authorized readers remain tenant scoped", func(t *testing.T) {
		for _, scenario := range []struct {
			viewer  tenant.Context
			revenue float64
		}{
			{broker, 123456},
			{foreign, 654321},
		} {
			viewer := scenario.viewer
			viewer.Permissions = append(append([]string{}, viewer.Permissions...), permissions.FinancialView)
			result, err := repo.DREExecutive(ctx, viewer, url.Values{"startDate": {"2026-10-01"}, "endDate": {"2026-10-31"}, "regime": {"cash"}})
			if err != nil {
				t.Fatal(err)
			}
			totals, ok := result["totals"].(map[string]any)
			if !ok || totals["grossRevenue"] != scenario.revenue || totals["netResult"] != scenario.revenue {
				t.Errorf("DRE returned another tenant's financial totals: %#v", result)
			}
		}
	})
	t.Run("commission total follows financial cancellation and value rules", func(t *testing.T) {
		viewer := broker
		viewer.Permissions = append(append([]string{}, broker.Permissions...), permissions.FinancialView)
		defer database.Pool().Exec(ctx, `update public.commissions set amount=10, calculated_value=null, status=null where id='10000000-0000-4000-8000-000000000201'`)
		for _, scenario := range []struct {
			name, status       string
			amount, calculated any
			want               float64
		}{
			{"cancelled", "cancelled", 10, nil, 0},
			{"cancelada", "cancelada", 10, nil, 0},
			{"cancelled uppercase", "CANCELLED", 10, nil, 0},
			{"cancelled calculated value", "cancelada", nil, 35, 0},
			{"calculated fallback", "approved", nil, 35, 35},
			{"explicit zero wins", "paid", 0, 35, 0},
			{"explicit amount wins", "aprovada", 10, 35, 10},
		} {
			t.Run(scenario.name, func(t *testing.T) {
				if _, err := database.Pool().Exec(ctx, `update public.commissions set amount=$1, calculated_value=$2, status=$3 where id='10000000-0000-4000-8000-000000000201'`, scenario.amount, scenario.calculated, scenario.status); err != nil {
					t.Fatal(err)
				}
				rows, err := repo.VGVByBroker(ctx, viewer, url.Values{})
				if err != nil {
					t.Fatal(err)
				}
				if len(rows) != 1 || rows[0]["user_id"] != businessBroker || rows[0]["total_commission"] != scenario.want {
					t.Errorf("commission total=%#v want own total %v", rows, scenario.want)
				}
			})
		}
	})
	t.Run("financial reader sees own filtered commissions only", func(t *testing.T) {
		viewer := leader
		viewer.Permissions = append(append([]string{}, leader.Permissions...), permissions.FinancialView)
		rows, err := repo.VGVByBroker(ctx, viewer, url.Values{})
		if err != nil {
			t.Fatal(err)
		}
		for _, row := range rows {
			if row["user_id"] == businessLeader && row["total_commission"] != float64(5) {
				t.Errorf("own commissions=%v want 5", row["total_commission"])
			}
			if row["user_id"] != businessLeader && row["total_commission"] != nil {
				t.Errorf("other broker commission leaked: %#v", row)
			}
		}
		viewer.Permissions = append(viewer.Permissions, permissions.FinancialManage)
		rows, err = repo.VGVByBroker(ctx, viewer, url.Values{})
		if err != nil {
			t.Fatal(err)
		}
		for _, row := range rows {
			if row["user_id"] == businessBroker && row["total_commission"] != float64(10) {
				t.Errorf("commission escaped visible lead cohort: %#v", row)
			}
		}
		rows, err = repo.VGVByBroker(ctx, viewer, url.Values{"dateFrom": {"2030-01-01"}, "dateTo": {"2030-12-31"}})
		if err != nil {
			t.Fatal(err)
		}
		for _, row := range rows {
			if row["total_commission"] != float64(0) {
				t.Errorf("commission escaped date filter: %#v", row)
			}
		}
		viewer = admin
		viewer.OrganizationName = "Synthetic Other Company"
		rows, err = repo.VGVByBroker(ctx, viewer, url.Values{})
		if err != nil {
			t.Fatal(err)
		}
		for _, row := range rows {
			if row["total_commission"] != nil {
				t.Errorf("unavailable financial module leaked commission: %#v", row)
			}
		}
	})
	t.Run("stale actor snapshot cannot enumerate a renewed member", func(t *testing.T) {
		if _, err := database.Pool().Exec(ctx, "update public.organization_members set membership_generation = 2 where organization_id = $1::uuid and user_id = $2::uuid", businessOrg, businessBroker); err != nil {
			t.Fatal(err)
		}
		defer database.Pool().Exec(ctx, "update public.organization_members set membership_generation = 1 where organization_id = $1::uuid and user_id = $2::uuid", businessOrg, businessBroker)
		rows, err := repo.SlaPerformanceByUser(ctx, leader, url.Values{})
		if err != nil {
			t.Fatal(err)
		}
		assertBusinessRoster(t, rows, "user_id", []string{businessLeader})
		rows, err = repo.VGVByBroker(ctx, leader, url.Values{})
		if err != nil {
			t.Fatal(err)
		}
		assertBusinessRoster(t, rows, "user_id", []string{businessLeader})
	})
	t.Run("stale actor snapshot cannot enumerate a former led team", func(t *testing.T) {
		if _, err := database.Pool().Exec(ctx, `insert into public.team_members values ($1::uuid,$2::uuid,$3::uuid,true,true,1);
		update public.team_members set is_active=false where organization_id=$1::uuid and team_id=$2::uuid and user_id=$4::uuid`, businessOrg, businessTeam, businessOtherLeader, businessLeader); err != nil {
			t.Fatal(err)
		}
		defer database.Pool().Exec(ctx, `delete from public.team_members where organization_id=$1::uuid and team_id=$2::uuid and user_id=$3::uuid;
		update public.team_members set is_active=true where organization_id=$1::uuid and team_id=$2::uuid and user_id=$4::uuid`, businessOrg, businessTeam, businessOtherLeader, businessLeader)
		rows, err := repo.LeaderStats(ctx, leader)
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != 0 {
			t.Errorf("former team leaders leaked through stale actor: %#v", rows)
		}
		rows, err = repo.TeamLeaderStats(ctx, leader, businessTeam)
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != 0 {
			t.Errorf("former team detail leaked through stale actor: %#v", rows)
		}
	})
}

func assertBusinessRoster(t *testing.T, rows []map[string]any, key string, expected []string) {
	t.Helper()
	want := map[string]bool{}
	for _, id := range expected {
		want[id] = true
	}
	if len(rows) != len(want) {
		t.Errorf("roster length=%d want=%d rows=%#v", len(rows), len(want), rows)
	}
	for _, row := range rows {
		id, _ := row[key].(string)
		if !want[id] {
			t.Errorf("unauthorized roster identity: %#v", row)
		}
	}
}
