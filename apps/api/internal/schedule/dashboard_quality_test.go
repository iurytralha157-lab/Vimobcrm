package schedule

import (
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestDashboardQualityKeepsUnknownDatesOutsideThePeriodWithoutExpandingAccess(t *testing.T) {
	for _, role := range []string{"user", "admin"} {
		for _, basis := range []DashboardDateBasis{DashboardDateBasisStartTime, DashboardDateBasisCreatedAt, DashboardDateBasisCompletedAt} {
			actor := tenant.Context{OrganizationID: "11111111-1111-4111-8111-111111111111", UserID: "22222222-2222-4222-8222-222222222222", MemberRole: role, Permissions: []string{permissions.ScheduleView}}
			filter := DashboardFilter{DateFrom: time.Date(2026, 10, 12, 0, 0, 0, 0, time.UTC), DateTo: time.Date(2026, 10, 12, 0, 0, 0, 0, time.UTC), DateBasis: basis, UserID: actor.UserID, TeamID: "33333333-3333-4333-8333-333333333333", Source: "Synthetic", EventType: "task", Status: "completed"}
			scope, err := buildScheduleDashboardQueryScope(actor, filter)
			if err != nil {
				t.Fatal(err)
			}
			quality := scheduleDashboardQualityCTEs(scope)
			for _, clause := range scope.where {
				if clause == scope.dateExpression+" >= bounds.from_at" || clause == scope.dateExpression+" < bounds.to_at" {
					if strings.Contains(quality, clause) {
						t.Fatalf("unknown result assigned an invented period for %s", basis)
					}
				} else if !strings.Contains(quality, clause) {
					t.Fatalf("quality lost authorization/filter %q", clause)
				}
			}
			if !strings.Contains(quality, "se.outcome_recorded_at is null and se.completed_at is null") || strings.Contains(quality, "coalesce(se.completed_at, se.start_time)") {
				t.Fatal("unknown realization timestamps must stay unknown")
			}
			query, _, err := buildScheduleDashboardQuery(actor, filter)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(query, "'data_quality'") || !strings.Contains(query, "coalesce(se.outcome_recorded_at, se.completed_at) is null as missing_result_time") {
				t.Fatal("dashboard must expose genuine missing fields")
			}
		}
	}
}
