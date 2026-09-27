package leads

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// Optional real-schema audit. Supply IDs for a controlled organization/team and
// a read-only database URL. This exercises the repository queries without JWTs,
// changing memberships, or exposing contact details in the test output.
func TestDashboardScopedParityReadOnlyIntegration(t *testing.T) {
	databaseURL := os.Getenv("VIMOB_DASHBOARD_READONLY_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set VIMOB_DASHBOARD_READONLY_DATABASE_URL for the read-only integration check")
	}
	readID := func(name string) string {
		t.Helper()
		id, ok := normalizeUUID(strings.TrimSpace(os.Getenv(name)))
		if !ok {
			t.Fatalf("%s must be a UUID", name)
		}
		return id
	}
	organizationID := readID("VIMOB_DASHBOARD_AUDIT_ORGANIZATION_ID")
	teamID := readID("VIMOB_DASHBOARD_AUDIT_TEAM_ID")
	adminID := readID("VIMOB_DASHBOARD_AUDIT_ADMIN_ID")
	leaderID := readID("VIMOB_DASHBOARD_AUDIT_LEADER_ID")
	brokerID := readID("VIMOB_DASHBOARD_AUDIT_BROKER_ID")

	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
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

	tenantRepo := tenant.NewRepository(db)
	admin, err := tenantRepo.Resolve(ctx, adminID, organizationID)
	if err != nil || !admin.HasRole("admin", "owner") {
		t.Fatalf("audit administrator is not an active organization administrator: %v", err)
	}
	broker, err := tenantRepo.Resolve(ctx, brokerID, organizationID)
	if err != nil || !broker.HasPermission(permissions.LeadViewOwn) || broker.HasPermission(permissions.LeadViewTeam) || broker.HasPermission(permissions.LeadViewAll) {
		t.Fatalf("audit broker is not an ordinary active broker: %v", err)
	}
	leader, err := tenantRepo.Resolve(ctx, leaderID, organizationID)
	if err != nil {
		t.Fatalf("resolve audit leader: %v", err)
	}
	leaderReady := leader.IsTeamLeader && leader.LeadsTeam(teamID) &&
		leader.HasPermission(permissions.LeadViewTeam) && !leader.HasPermission(permissions.LeadViewAll)
	if !leaderReady && os.Getenv("VIMOB_DASHBOARD_AUDIT_REQUIRE_LEADER") == "true" {
		t.Fatal("audit leader has no active scoped leadership in the selected team")
	}

	repo := NewRepository(db, nil)
	pipelineID, ok := normalizeUUID(strings.TrimSpace(os.Getenv("VIMOB_DASHBOARD_AUDIT_PIPELINE_ID")))
	if !ok {
		t.Fatal("VIMOB_DASHBOARD_AUDIT_PIPELINE_ID must be a UUID")
	}
	stages, err := repo.listPipelineBoardStages(ctx, admin, pipelineID)
	if err != nil || len(stages) == 0 {
		t.Fatalf("audit pipeline has no readable active stages: %v", err)
	}
	stageIDs := make([]string, 0, len(stages))
	for _, stage := range stages {
		stageIDs = append(stageIDs, stage.ID)
	}

	roles := []struct {
		name     string
		viewer   tenant.Context
		expected string
	}{
		{"admin", admin, "admin"},
		{"broker", broker, "broker"},
	}
	if leaderReady {
		roles = append(roles, struct {
			name     string
			viewer   tenant.Context
			expected string
		}{"leader", leader, "leader"})
	} else {
		t.Log("leader comparison deferred: no active leadership in selected team")
	}

	for _, role := range roles {
		t.Run(role.name, func(t *testing.T) {
			var expected int64
			switch role.expected {
			case "admin":
				err = db.Pool().QueryRow(ctx, `select count(*)::bigint from public.leads where organization_id=$1::uuid and pipeline_id=$2::uuid`, organizationID, pipelineID).Scan(&expected)
			case "broker":
				err = db.Pool().QueryRow(ctx, `select count(*)::bigint from public.leads where organization_id=$1::uuid and pipeline_id=$2::uuid and assigned_user_id=$3::uuid`, organizationID, pipelineID, brokerID).Scan(&expected)
			case "leader":
				err = db.Pool().QueryRow(ctx, `
				with led_teams as (
				  select tm.team_id from public.team_members tm
				  join public.teams t on t.id=tm.team_id and t.organization_id=tm.organization_id and coalesce(t.is_active,true)=true
				  where tm.organization_id=$1::uuid and tm.user_id=$3::uuid and tm.is_active=true and tm.is_leader=true
				), led_users as (
				  select distinct tm.user_id from public.team_members tm
				  join led_teams lt on lt.team_id=tm.team_id
				  join public.users u on u.id=tm.user_id and coalesce(u.is_active,false)=true
				  join public.organization_members om on om.organization_id=tm.organization_id and om.user_id=tm.user_id and om.is_active=true and om.deleted_at is null
				  where tm.organization_id=$1::uuid and tm.is_active=true
				)
				select count(*)::bigint from public.leads l
				where l.organization_id=$1::uuid and l.pipeline_id=$2::uuid
				  and (l.assigned_user_id=$3::uuid or l.assigned_user_id in (select user_id from led_users)
				    or (l.assigned_user_id is null and l.team_id in (select team_id from led_teams)))
			`, organizationID, pipelineID, leaderID).Scan(&expected)
			}
			if err != nil {
				t.Fatalf("independent role count: %v", err)
			}

			filter := DashboardFilter{PipelineID: pipelineID}
			stats, err := repo.GetDashboardStats(ctx, role.viewer, filter)
			if err != nil {
				t.Fatalf("dashboard stats: %v", err)
			}
			sources, err := repo.GetDashboardSources(ctx, role.viewer, filter)
			if err != nil {
				t.Fatalf("dashboard sources: %v", err)
			}
			var sourceCount int64
			for _, source := range sources {
				sourceCount += source.Value
			}
			contactsCount, err := repo.countContacts(ctx, role.viewer, ContactListFilter{PipelineID: pipelineID})
			if err != nil {
				t.Fatalf("contacts count: %v", err)
			}
			if stats.TotalLeads != expected || sourceCount != expected || contactsCount != expected {
				t.Fatalf("scope mismatch: independent=%d dashboard=%d sources=%d contacts=%d", expected, stats.TotalLeads, sourceCount, contactsCount)
			}

			funnel, err := repo.GetDashboardFunnel(ctx, role.viewer, filter)
			if err != nil {
				t.Fatalf("dashboard funnel: %v", err)
			}
			board, err := repo.listPipelineBoardStageMetrics(ctx, role.viewer, PipelineBoardFilter{
				PipelineID: pipelineID, StageIDs: stageIDs, DateMode: PipelineBoardDateModeOrigin,
			})
			if err != nil {
				t.Fatalf("pipeline board metrics: %v", err)
			}
			var funnelCount, boardCount int64
			for _, point := range funnel {
				funnelCount += point.Value
			}
			for _, stage := range stages {
				boardCount += board[stage.ID].LeadCount
			}
			if funnelCount != boardCount || funnelCount > expected {
				t.Fatalf("funnel/pipeline mismatch: funnel=%d board=%d visible=%d", funnelCount, boardCount, expected)
			}
			t.Logf("read_only=on scoped pipeline: dashboard=%d contacts=%d funnel=%d pipeline_board=%d", expected, contactsCount, funnelCount, boardCount)

			teamFilter := DashboardFilter{PipelineID: pipelineID, TeamID: teamID}
			teamSources, err := repo.GetDashboardSources(ctx, role.viewer, teamFilter)
			if err != nil {
				t.Fatalf("team-filtered dashboard: %v", err)
			}
			teamContacts, err := repo.countContacts(ctx, role.viewer, ContactListFilter{PipelineID: pipelineID, TeamID: teamID})
			if err != nil {
				t.Fatalf("team-filtered contacts: %v", err)
			}
			var teamDashboard int64
			for _, source := range teamSources {
				teamDashboard += source.Value
			}
			if teamDashboard != teamContacts {
				t.Fatalf("team filter mismatch: dashboard=%d contacts=%d", teamDashboard, teamContacts)
			}
			teamFunnel, err := repo.GetDashboardFunnel(ctx, role.viewer, teamFilter)
			if err != nil {
				t.Fatalf("team-filtered funnel: %v", err)
			}
			teamBoard, err := repo.listPipelineBoardStageMetrics(ctx, role.viewer, PipelineBoardFilter{
				PipelineID: pipelineID, StageIDs: stageIDs, TeamID: teamID, DateMode: PipelineBoardDateModeOrigin,
			})
			if err != nil {
				t.Fatalf("team-filtered Pipeline board: %v", err)
			}
			var teamFunnelCount, teamBoardCount int64
			for _, point := range teamFunnel {
				teamFunnelCount += point.Value
			}
			for _, stage := range stages {
				teamBoardCount += teamBoard[stage.ID].LeadCount
			}
			if teamFunnelCount != teamBoardCount || teamFunnelCount > teamDashboard {
				t.Fatalf("team filter mismatch: dashboard=%d contacts=%d funnel=%d board=%d", teamDashboard, teamContacts, teamFunnelCount, teamBoardCount)
			}
			t.Logf("selected_team dashboard=%d contacts=%d funnel=%d pipeline_board=%d", teamDashboard, teamContacts, teamFunnelCount, teamBoardCount)
			if role.name == "leader" {
				distribution, err := repo.GetDashboardLeadDistribution(ctx, role.viewer, teamFilter)
				if err != nil || distribution.TotalLeads != teamDashboard {
					t.Fatalf("leader distribution does not match scoped team cohort: distribution=%d dashboard=%d error=%v", distribution.TotalLeads, teamDashboard, err)
				}
				for _, user := range distribution.Users {
					if user.ID != nil && !role.viewer.LeadsUser(*user.ID) {
						t.Fatal("leader distribution includes a broker outside led teams")
					}
				}
				firstContact, err := repo.GetDashboardFirstContact(ctx, role.viewer, teamFilter)
				if err != nil || firstContact.LeadCount != teamDashboard {
					t.Fatalf("leader first contact does not match scoped team cohort: first_contact=%d dashboard=%d error=%v", firstContact.LeadCount, teamDashboard, err)
				}
				for _, user := range firstContact.Brokers {
					if !role.viewer.LeadsUser(user.ID) {
						t.Fatal("leader first contact includes a broker outside led teams")
					}
				}
			}
			if role.name == "broker" {
				if _, err := repo.GetDashboardLeadDistribution(ctx, role.viewer, filter); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
					t.Fatalf("broker could read management distribution: %v", err)
				}
				if _, err := repo.GetDashboardFirstContact(ctx, role.viewer, filter); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
					t.Fatalf("broker could read management first contact: %v", err)
				}
			}
		})
	}
}
