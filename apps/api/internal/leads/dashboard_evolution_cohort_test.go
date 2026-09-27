package leads

import (
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestDashboardEvolutionUsesSameLeadEntryCohortAsKPIs(t *testing.T) {
	if got := dashboardEvolutionEventSQL("l"); got != "l.created_at" {
		t.Fatalf("evolution bucket date = %q, want lead entry date", got)
	}
	from := time.Date(2026, 9, 20, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 9, 26, 23, 59, 59, 999000000, time.UTC)
	where, _, err := (Repository{}).buildDashboardLeadWhere(tenant.Context{
		UserID:         "11111111-1111-4111-8111-111111111111",
		OrganizationID: "22222222-2222-4222-8222-222222222222",
		MemberRole:     "admin",
	}, DashboardFilter{DateFrom: &from, DateTo: &to}, dashboardLeadWhereOptions{DateColumn: "created_at"})
	if err != nil {
		t.Fatal(err)
	}
	query := strings.Join(where, " and ")
	if !strings.Contains(query, "l.created_at >= $5") || !strings.Contains(query, "l.created_at <= $6") {
		t.Fatalf("evolution cohort must use the same inclusive lead creation period as KPI totals: %s", query)
	}
	if strings.Contains(query, "l.won_at") || strings.Contains(query, "l.lost_at") {
		t.Fatalf("won/lost event dates must not replace the lead entry cohort: %s", query)
	}
}
