package leads

import (
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestDashboardEvolutionUsesSameLeadEntryCohortAsKPIs(t *testing.T) {

	from := time.Date(2026, 9, 20, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 9, 26, 23, 59, 59, 999000000, time.UTC)
	query, _, err := (Repository{}).buildDashboardCardCohortCTE(tenant.Context{
		UserID:         "11111111-1111-4111-8111-111111111111",
		OrganizationID: "22222222-2222-4222-8222-222222222222",
		MemberRole:     "admin",
	}, DashboardFilter{DateFrom: &from, DateTo: &to})
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{"l.created_at >= $5", "l.created_at <= $6", "e.created_at >= $5", "e.created_at <= $6", "min(entered_at)", "group by lead_id", "e.entry_type = 'reentry' and e.is_countable = true"} {
		if !strings.Contains(query, required) {
			t.Fatalf("evolution must bucket each card once at its earliest matching CRM arrival; missing %q: %s", required, query)
		}
	}
	if strings.Contains(query, "l.won_at") || strings.Contains(query, "l.lost_at") {
		t.Fatalf("won/lost event dates must not replace the lead entry cohort: %s", query)
	}
}
