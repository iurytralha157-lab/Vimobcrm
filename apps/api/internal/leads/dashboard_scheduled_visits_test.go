package leads

import (
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestBuildDashboardScheduledVisitsWhereUsesCreationDateAndIncludesMeetings(t *testing.T) {
	dateFrom := time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC)
	dateTo := time.Date(2026, time.July, 31, 23, 59, 59, 0, time.UTC)

	where, _, err := (Repository{}).buildDashboardScheduledVisitsWhere(tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		MemberRole:     "admin",
	}, DashboardFilter{DateFrom: &dateFrom, DateTo: &dateTo})
	if err != nil {
		t.Fatalf("build dashboard scheduled visits where: %v", err)
	}

	query := strings.Join(where, " and ")
	if !strings.Contains(query, "se.event_type in ('visit', 'meeting')") {
		t.Fatalf("dashboard appointments must include visits and meetings: %s", query)
	}
	if !strings.Contains(query, "se.created_at >=") || !strings.Contains(query, "se.created_at <=") {
		t.Fatalf("dashboard appointments must be filtered by creation date: %s", query)
	}
	if strings.Contains(query, "se.start_time") {
		t.Fatalf("dashboard appointments must not be filtered by scheduled start time: %s", query)
	}
}
