package leads

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// This optional check reads real tenant grants and lead counts. It never
// writes to the database and prints only aggregates, not user or lead data.
func TestDashboardRoleScopeReadOnlyIntegration(t *testing.T) {
	databaseURL := os.Getenv("VIMOB_DASHBOARD_READONLY_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set VIMOB_DASHBOARD_READONLY_DATABASE_URL for the read-only integration check")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	db, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 1, ForceReadOnly: true, HealthTimeout: 8 * time.Second})
	if err != nil {
		t.Fatalf("connect read-only database: %v", err)
	}
	defer db.Close()
	var readOnly string
	if err := db.Pool().QueryRow(ctx, "show default_transaction_read_only").Scan(&readOnly); err != nil || readOnly != "on" {
		t.Fatalf("database session is not read-only: %v", err)
	}

	// Managers intentionally receive LeadViewAll. Audit ordinary team leaders
	// for custom role grants or per-user overrides that would broaden access.
	var activeLeaders, broadenedLeaders int64
	if err := db.Pool().QueryRow(ctx, `
		with leaders as (
			select distinct tm.organization_id, tm.user_id
			from public.team_members tm
			join public.teams team on team.id = tm.team_id and team.organization_id = tm.organization_id
			join public.organization_members om on om.organization_id = tm.organization_id and om.user_id = tm.user_id
			join public.users u on u.id = tm.user_id
			where tm.is_active = true and tm.is_leader = true
			  and coalesce(team.is_active, true) = true
			  and om.is_active = true and om.deleted_at is null
			  and coalesce(u.is_active, false) = true
			  and lower(om.role) not in ('owner', 'admin', 'manager', 'proprietario', 'administrador', 'gerente')
		), grants as (
			select leader.organization_id, leader.user_id,
			  exists (
				select 1 from public.user_organization_roles uor
				join public.organization_role_permissions orp
				  on orp.role_id = uor.role_id and orp.organization_id = uor.organization_id
				join public.available_permissions ap on ap.id = orp.permission_id
				where uor.user_id = leader.user_id and uor.organization_id = leader.organization_id
				  and uor.is_active = true
				  and lower(ap.key) in ('lead_view_all', 'lead_edit_all', 'lead_manage', '*')
			  ) as role_grant,
			  (select upo.allowed from public.user_permission_overrides upo
			   where upo.organization_id = leader.organization_id and upo.user_id = leader.user_id
			     and lower(upo.permission_key) = 'lead_view_all' limit 1) as override_grant
			from leaders leader
		)
		select count(*)::bigint,
		  count(*) filter (where coalesce(override_grant, role_grant))::bigint
		from grants
	`).Scan(&activeLeaders, &broadenedLeaders); err != nil {
		t.Fatalf("audit leader grants: %v", err)
	}
	t.Logf("active ordinary leaders=%d; effective LeadViewAll grants=%d", activeLeaders, broadenedLeaders)
	if broadenedLeaders > 0 {
		t.Fatalf("ordinary team leaders with organization-wide lead grants: %d", broadenedLeaders)
	}

	var organizationID, leaderID, brokerID string
	err = db.Pool().QueryRow(ctx, `
		select leader.organization_id::text, leader.user_id::text, member.user_id::text
		from public.team_members leader
		join public.teams team on team.id = leader.team_id and team.organization_id = leader.organization_id
		join public.team_members member on member.organization_id = leader.organization_id
		  and member.team_id = leader.team_id and member.is_active = true
		join public.organization_members lom on lom.organization_id = leader.organization_id
		  and lom.user_id = leader.user_id and lom.is_active = true and lom.deleted_at is null
		join public.organization_members bom on bom.organization_id = member.organization_id
		  and bom.user_id = member.user_id and bom.is_active = true and bom.deleted_at is null
		join public.users lu on lu.id = leader.user_id and coalesce(lu.is_active, false) = true
		join public.users bu on bu.id = member.user_id and coalesce(bu.is_active, false) = true
		where leader.is_active = true and leader.is_leader = true and coalesce(team.is_active, true) = true
		  and member.user_id <> leader.user_id
		  and lower(lom.role) not in ('owner', 'admin', 'manager', 'proprietario', 'administrador', 'gerente')
		  and lower(bom.role) in ('user', 'member', 'usuario', 'corretor', 'broker', 'agent')
		  and not exists (select 1 from public.team_members other_leadership
		    where other_leadership.organization_id = member.organization_id
		      and other_leadership.user_id = member.user_id
		      and other_leadership.is_active = true and other_leadership.is_leader = true)
		  and exists (select 1 from public.leads l
		    where l.organization_id = member.organization_id and l.assigned_user_id = member.user_id)
		order by leader.organization_id, leader.user_id, member.user_id
		limit 1
	`).Scan(&organizationID, &leaderID, &brokerID)
	if errors.Is(err, pgx.ErrNoRows) {
		t.Skip("no active ordinary leader and broker pair with leads")
	}
	if err != nil {
		t.Fatalf("select role-scope pair: %v", err)
	}

	tenantRepo := tenant.NewRepository(db)
	leader, err := tenantRepo.Resolve(ctx, leaderID, organizationID)
	if err != nil {
		t.Fatalf("resolve leader: %v", err)
	}
	broker, err := tenantRepo.Resolve(ctx, brokerID, organizationID)
	if err != nil {
		t.Fatalf("resolve broker: %v", err)
	}
	if !leader.IsTeamLeader || leader.HasPermission(permissions.LeadViewAll) ||
		!leader.HasPermission(permissions.LeadViewTeam) || broker.IsTeamLeader ||
		broker.HasPermission(permissions.LeadViewTeam) || broker.HasPermission(permissions.LeadViewAll) {
		t.Skip("selected pair has custom permissions outside ordinary leader/broker roles")
	}

	repo := NewRepository(db, nil)
	leaderSources, err := repo.GetDashboardSources(ctx, leader, DashboardFilter{})
	if err != nil {
		t.Fatalf("leader dashboard sources: %v", err)
	}
	brokerSources, err := repo.GetDashboardSources(ctx, broker, DashboardFilter{})
	if err != nil {
		t.Fatalf("broker dashboard sources: %v", err)
	}
	adminSources, err := repo.GetDashboardSources(ctx, tenant.Context{
		OrganizationID: organizationID, UserID: leaderID, MemberRole: "admin",
	}, DashboardFilter{})
	if err != nil {
		t.Fatalf("admin dashboard sources: %v", err)
	}

	var expectedLeader, expectedBroker, expectedAdmin int64
	if err := db.Pool().QueryRow(ctx, `
		with led_teams as (
			select leader.team_id from public.team_members leader
			join public.teams t on t.id = leader.team_id and t.organization_id = leader.organization_id
			where leader.organization_id = $1::uuid and leader.user_id = $2::uuid
			  and leader.is_active = true and leader.is_leader = true and coalesce(t.is_active, true) = true
		), led_users as (
			select distinct member.user_id from public.team_members member
			join led_teams lt on lt.team_id = member.team_id
			join public.users u on u.id = member.user_id and coalesce(u.is_active, false) = true
			join public.organization_members om on om.organization_id = member.organization_id
			  and om.user_id = member.user_id and om.is_active = true and om.deleted_at is null
			where member.organization_id = $1::uuid and member.is_active = true
		)
		select
		  count(*) filter (where l.assigned_user_id = $2::uuid
		    or l.assigned_user_id in (select user_id from led_users)
		    or (l.assigned_user_id is null and l.team_id in (select team_id from led_teams)))::bigint,
		  count(*) filter (where l.assigned_user_id = $3::uuid)::bigint,
		  count(*)::bigint
		from public.leads l where l.organization_id = $1::uuid
	`, organizationID, leaderID, brokerID).Scan(&expectedLeader, &expectedBroker, &expectedAdmin); err != nil {
		t.Fatalf("independent role counts: %v", err)
	}
	countSources := func(items []SourceDataPoint) int64 {
		var total int64
		for _, item := range items {
			total += item.Value
		}
		return total
	}
	if actual := countSources(leaderSources); actual != expectedLeader {
		t.Fatalf("leader dashboard count %d != permitted team count %d", actual, expectedLeader)
	}
	if actual := countSources(brokerSources); actual != expectedBroker {
		t.Fatalf("broker dashboard count %d != own lead count %d", actual, expectedBroker)
	}
	if actual := countSources(adminSources); actual != expectedAdmin {
		t.Fatalf("admin dashboard count %d != organization count %d", actual, expectedAdmin)
	}
	t.Logf("read-only role scope reconciled: leader=%d broker=%d admin=%d", expectedLeader, expectedBroker, expectedAdmin)
}
