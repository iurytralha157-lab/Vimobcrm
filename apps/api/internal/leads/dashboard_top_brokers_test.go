package leads

import (
	"context"
	"math"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestDashboardTopBrokerCommissionsUseOnlyVisibleFilteredLeads(t *testing.T) {
	join := dashboardTopBrokerCommissionJoinSQL()
	for _, expected := range []string{
		"join filtered_leads visible_lead on visible_lead.id = cm.lead_id",
		"cm.organization_id = $1::uuid",
		"group by cm.user_id",
	} {
		if !strings.Contains(join, expected) {
			t.Fatalf("commission join lost scoped lead condition %q: %s", expected, join)
		}
	}
	if strings.Contains(join, "join public.leads") {
		t.Fatal("commission join must use the filtered lead cohort, not unrestricted leads")
	}
}

func TestDashboardTopBrokerCommissionsReadOnlyIntegration(t *testing.T) {
	databaseURL := os.Getenv("VIMOB_DASHBOARD_READONLY_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set VIMOB_DASHBOARD_READONLY_DATABASE_URL for the read-only integration check")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
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
	var organizationID string
	if err := db.Pool().QueryRow(ctx, `
		select organization_id::text from public.leads
		group by organization_id order by count(*) desc limit 1
	`).Scan(&organizationID); err != nil {
		t.Skipf("no lead organization available: %v", err)
	}
	repo := NewRepository(db, nil)
	brokers, err := repo.dashboardTopBrokers(ctx, tenant.Context{
		OrganizationID: organizationID, UserID: organizationID, MemberRole: "admin",
	}, DashboardFilter{}, false)
	if err != nil {
		t.Fatalf("scoped top broker query: %v", err)
	}
	for _, broker := range brokers {
		var expected float64
		if err := db.Pool().QueryRow(ctx, `
			select coalesce(sum(cm.amount), 0)::double precision
			from public.commissions cm
			join public.leads l on l.id = cm.lead_id and l.organization_id = cm.organization_id
			where cm.organization_id = $1::uuid and cm.user_id = $2::uuid
			  and l.deal_status = 'won'
			  and cm.status in ('forecast', 'approved', 'paid', 'prevista', 'aprovada', 'paga')
		`, organizationID, broker.ID).Scan(&expected); err != nil {
			t.Fatalf("independent commission check: %v", err)
		}
		if math.Abs(broker.TotalCommissions-expected) > 0.01 {
			t.Fatalf("broker %s commissions = %.2f, want %.2f from linked won leads", broker.ID, broker.TotalCommissions, expected)
		}
	}
	t.Logf("read-only top broker query returned %d brokers", len(brokers))
	if _, err := repo.GetDashboardFunnel(ctx, tenant.Context{
		OrganizationID: organizationID, UserID: organizationID, MemberRole: "admin",
	}, DashboardFilter{PipelineID: "all"}); err != nil {
		t.Fatalf("dashboard funnel with all pipelines selected: %v", err)
	}
}
