package roundrobin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	statsTeamID      = "98520000-0000-4000-8000-000000000001"
	statsOtherTeamID = "98520000-0000-4000-8000-000000000002"
)

func TestCanViewTeamDistributionStatsAccessMatrix(t *testing.T) {
	tests := []struct {
		name    string
		context tenant.Context
		teamID  string
		want    bool
	}{
		{
			name:    "super admin",
			context: tenant.Context{IsSuperAdmin: true},
			teamID:  statsOtherTeamID,
			want:    true,
		},
		{
			name:    "organization admin",
			context: tenant.Context{MemberRole: "admin"},
			teamID:  statsOtherTeamID,
			want:    true,
		},
		{
			name: "manager with team view but without team manage",
			context: tenant.Context{
				MemberRole:  "manager",
				Permissions: []string{permissions.TeamView},
			},
			teamID: statsOtherTeamID,
			want:   false,
		},
		{
			name: "non-leader with team view and team manage",
			context: tenant.Context{
				MemberRole:  "manager",
				Permissions: []string{permissions.TeamView, permissions.TeamManage},
			},
			teamID: statsOtherTeamID,
			want:   true,
		},
		{
			name: "manager without team view",
			context: tenant.Context{
				MemberRole: "manager",
			},
			teamID: statsTeamID,
			want:   false,
		},
		{
			name: "leader of requested team",
			context: tenant.Context{
				MemberRole:   "user",
				Permissions:  []string{permissions.TeamView},
				IsTeamLeader: true,
				LedTeamIDs:   []string{statsTeamID},
			},
			teamID: statsTeamID,
			want:   true,
		},
		{
			name: "leader of another team remains scoped even with team manage",
			context: tenant.Context{
				MemberRole:   "user",
				Permissions:  []string{permissions.TeamView, permissions.TeamManage},
				IsTeamLeader: true,
				LedTeamIDs:   []string{statsOtherTeamID},
			},
			teamID: statsTeamID,
			want:   false,
		},
		{
			name: "ordinary user even with direct team view grant",
			context: tenant.Context{
				MemberRole:  "user",
				Permissions: []string{permissions.TeamView},
			},
			teamID: statsTeamID,
			want:   false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := canViewTeamDistributionStats(test.context, test.teamID); got != test.want {
				t.Fatalf("canViewTeamDistributionStats() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestTeamDistributionStatsRejectsInvalidTeamBeforeDatabaseAccess(t *testing.T) {
	repository := Repository{}
	_, err := repository.TeamDistributionStats(
		context.Background(),
		tenant.Context{MemberRole: "admin", OrganizationID: "98510000-0000-4000-8000-000000000001"},
		"not-a-uuid",
	)
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("TeamDistributionStats() error = %v, want ErrInvalidInput", err)
	}
}

func TestTeamDistributionStatsRejectsOrdinaryUserBeforeDatabaseAccess(t *testing.T) {
	repository := Repository{}
	_, err := repository.TeamDistributionStats(
		context.Background(),
		tenant.Context{
			MemberRole:     "user",
			OrganizationID: "98510000-0000-4000-8000-000000000001",
			Permissions:    []string{permissions.TeamView},
		},
		statsTeamID,
	)
	if !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("TeamDistributionStats() error = %v, want organization access denied", err)
	}
}

func TestTeamDistributionStatsQueryIsTenantScopedAndUsesSnapshots(t *testing.T) {
	for _, fragment := range []string{
		"team.organization_id = $1::uuid",
		"team.id = $2::uuid",
		"scoped_team.created_at",
		"event.organization_id = $1::uuid",
		"event.team_id = $2::uuid",
		"count(event.round_robin_log_id)",
		"count(distinct event.lead_id)",
		"event.event_kind = 'redistribution'",
		"private.team_distribution_event_coverage",
		"private.team_distribution_events",
	} {
		if !strings.Contains(teamDistributionStatsQuery, fragment) {
			t.Fatalf("team stats query is missing %q", fragment)
		}
	}
}

func TestResolveTeamDistributionCoverage(t *testing.T) {
	completeSince := time.Date(2026, time.September, 4, 20, 30, 0, 0, time.UTC)
	tests := []struct {
		name           string
		globalCoverage string
		teamCreatedAt  time.Time
		want           string
	}{
		{
			name:           "older team remains partial",
			globalCoverage: "partial",
			teamCreatedAt:  completeSince.Add(-time.Nanosecond),
			want:           "partial",
		},
		{
			name:           "team created exactly at boundary is complete",
			globalCoverage: "partial",
			teamCreatedAt:  completeSince,
			want:           "complete",
		},
		{
			name:           "newer team is complete",
			globalCoverage: "partial",
			teamCreatedAt:  completeSince.Add(time.Nanosecond),
			want:           "complete",
		},
		{
			name:           "global complete covers older teams",
			globalCoverage: "complete",
			teamCreatedAt:  completeSince.Add(-24 * time.Hour),
			want:           "complete",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			teamCreatedAt := test.teamCreatedAt
			got := resolveTeamDistributionCoverage(
				test.globalCoverage,
				completeSince,
				&teamCreatedAt,
			)
			if got != test.want {
				t.Fatalf("resolveTeamDistributionCoverage() = %q, want %q", got, test.want)
			}
		})
	}
	if got := resolveTeamDistributionCoverage("partial", completeSince, nil); got != "partial" {
		t.Fatalf("missing team creation date coverage = %q, want partial", got)
	}
}

func TestTeamDistributionSnapshotMigrationKeepsBackfillConservative(t *testing.T) {
	path := filepath.Join(
		"..", "..", "..", "..",
		"supabase", "migrations",
		"20260904203000_capture_team_distribution_event_snapshots.sql",
	)
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read snapshot migration: %v", err)
	}

	backfillStart := strings.Index(string(source), "-- Conservative backfill")
	backfillEnd := strings.Index(string(source), "create or replace function private.prevent_team_distribution_event_mutation")
	if backfillStart < 0 || backfillEnd <= backfillStart {
		t.Fatal("snapshot migration is missing a bounded conservative backfill")
	}
	backfill := string(source)[backfillStart:backfillEnd]
	for _, fragment := range []string{
		"join public.round_robins as queue",
		"join public.leads as lead",
		"join public.organization_members as assigned_membership",
		"join public.users as assigned_user",
		"join public.teams as metadata_team",
		"distribution_log.metadata->>'team_id'",
		"metadata_team.organization_id = distribution_log.organization_id",
		"distribution_log.assigned_user_id is not null",
		"assigned_membership.is_active = true",
		"assigned_membership.deleted_at is null",
	} {
		if !strings.Contains(backfill, fragment) {
			t.Fatalf("conservative backfill is missing %q", fragment)
		}
	}
	if strings.Contains(backfill, "round_robin_members") {
		t.Fatal("backfill must not infer historical team attribution from current members")
	}
}

func TestCurrentSuccessfulLogWritersPersistLeadAssignmentFirst(t *testing.T) {
	checks := []struct {
		name   string
		path   string
		anchor string
		first  string
		second string
	}{
		{
			name: "canonical distribution function",
			path: filepath.Join(
				"..", "..", "..", "..",
				"supabase", "migrations",
				"20260729011728_forward_distribution_ticket_upgrade.sql",
			),
			anchor: "v_previous_assigned_user_id := v_lead.assigned_user_id;",
			first:  "update public.leads",
			second: "insert into public.round_robin_logs",
		},
		{
			name:   "manual redistribution",
			path:   filepath.Join("..", "leads", "repository.go"),
			anchor: "func (repo Repository) RedistributeRoundRobin",
			first:  "repo.transferLeadAssignee",
			second: "insert into public.round_robin_logs",
		},
		{
			name:   "automatic redistribution",
			path:   filepath.Join("..", "leads", "redistribution_worker.go"),
			anchor: "func (repo Repository) processDueRedistributions",
			first:  "repo.transferLeadAssignee",
			second: "repo.insertAutoRedistributionLog",
		},
	}

	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			source, err := os.ReadFile(check.path)
			if err != nil {
				t.Fatalf("read %s: %v", check.path, err)
			}
			anchored := string(source)
			anchorIndex := strings.Index(anchored, check.anchor)
			if anchorIndex < 0 {
				t.Fatalf("%s is missing anchor %q", check.path, check.anchor)
			}
			anchored = anchored[anchorIndex:]
			firstIndex := strings.Index(anchored, check.first)
			secondIndex := strings.Index(anchored, check.second)
			if firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex {
				t.Fatalf(
					"%s must keep %q before %q after %q",
					check.path,
					check.first,
					check.second,
					check.anchor,
				)
			}
		})
	}
}

func TestTeamDistributionStatsJSONContract(t *testing.T) {
	completeSince := time.Date(2026, time.September, 4, 20, 30, 0, 0, time.UTC)
	payload, err := json.Marshal(map[string]TeamDistributionStats{
		"data": {
			TotalEvents:          21,
			UniqueLeads:          4,
			RedistributionEvents: 17,
			Coverage:             "partial",
			CompleteSince:        completeSince,
		},
	})
	if err != nil {
		t.Fatalf("marshal team distribution stats: %v", err)
	}

	for _, field := range []string{
		`"totalEvents":21`,
		`"uniqueLeads":4`,
		`"redistributionEvents":17`,
		`"coverage":"partial"`,
		`"completeSince":"2026-09-04T20:30:00Z"`,
	} {
		if !strings.Contains(string(payload), field) {
			t.Fatalf("JSON contract is missing %s: %s", field, payload)
		}
	}
}

func TestGetTeamDistributionStatsRequiresTenantContext(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/teams/"+statsTeamID+"/distribution-stats", nil)

	(Handler{}).GetTeamDistributionStats(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
	if !strings.Contains(recorder.Body.String(), `"code":"organization_required"`) {
		t.Fatalf("response = %s, want organization_required", recorder.Body.String())
	}
}

func TestTeamDistributionStatsNotFoundErrorResponse(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/teams/"+statsTeamID+"/distribution-stats", nil)

	writeTeamDistributionStatsError(recorder, request, ErrTeamDistributionStatsNotFound)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNotFound)
	}
	if !strings.Contains(recorder.Body.String(), `"code":"team_not_found"`) {
		t.Fatalf("response = %s, want team_not_found", recorder.Body.String())
	}
}
