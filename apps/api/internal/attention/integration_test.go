package attention

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestWorkerQueriesAgainstDatabase(t *testing.T) {
	databaseURL := os.Getenv("ATTENTION_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("ATTENTION_TEST_DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer postgres.Close()
	repo := NewRepository(postgres)
	var fixtureOrganizationID, eligibleLeadID, manualLeadID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.organizations (name, slug)
		values ('Attention integration fixture', 'attention-fixture-' || gen_random_uuid()::text)
		returning id::text
	`).Scan(&fixtureOrganizationID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.organizations where id = $1::uuid`, fixtureOrganizationID)
	})
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.lead_attention_policies (
			organization_id, name, policy_type, status,
			threshold_minutes, warning_minutes, notify_assignee
		) values ($1::uuid, 'Unassigned fixture', 'unassigned', 'shadow', 15, 5, false)
	`, fixtureOrganizationID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.leads (organization_id, name, source, meta_lead_id)
		values ($1::uuid, 'Eligible Meta fixture', 'meta', 'fixture-' || gen_random_uuid()::text)
		returning id::text
	`, fixtureOrganizationID).Scan(&eligibleLeadID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.leads (organization_id, name, source)
		values ($1::uuid, 'Manual WhatsApp label fixture', 'whatsapp')
		returning id::text
	`, fixtureOrganizationID).Scan(&manualLeadID); err != nil {
		t.Fatal(err)
	}
	if err := repo.Process(ctx); err != nil {
		t.Fatal(err)
	}
	var eligible, manual bool
	if err := postgres.Pool().QueryRow(ctx, `select attention_eligible from public.leads where id = $1::uuid`, eligibleLeadID).Scan(&eligible); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `select attention_eligible from public.leads where id = $1::uuid`, manualLeadID).Scan(&manual); err != nil {
		t.Fatal(err)
	}
	if !eligible || !manual {
		t.Fatalf("all leads must be attention eligible: meta=%v manual=%v", eligible, manual)
	}
	var instanceCount int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::int
		from public.lead_attention_instances
		where organization_id = $1::uuid and lead_id = $2::uuid
	`, fixtureOrganizationID, eligibleLeadID).Scan(&instanceCount); err != nil {
		t.Fatal(err)
	}
	if instanceCount != 1 {
		t.Fatalf("expected one reconciled attention instance, got %d", instanceCount)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::int
		from public.lead_attention_instances
		where organization_id = $1::uuid and lead_id = $2::uuid
	`, fixtureOrganizationID, manualLeadID).Scan(&instanceCount); err != nil {
		t.Fatal(err)
	}
	if instanceCount != 1 {
		t.Fatalf("manual lead must get one attention instance, got %d", instanceCount)
	}
	var organizationID, userID string
	if err := postgres.Pool().QueryRow(ctx, `
		select om.organization_id::text, om.user_id::text
		from public.organization_members om
		where coalesce(om.is_active, true) = true
		order by om.created_at, om.user_id
		limit 1
	`).Scan(&organizationID, &userID); err != nil {
		t.Logf("no organization member available for API query smoke test: %v", err)
		return
	}
	tenantContext := tenant.Context{
		OrganizationID: organizationID,
		UserID:         userID,
		MemberRole:     "admin",
	}
	if _, err := repo.GetSettings(ctx, tenantContext); err != nil {
		t.Fatalf("get settings: %v", err)
	}
	if _, err := repo.ListPolicies(ctx, tenantContext, false); err != nil {
		t.Fatalf("list policies: %v", err)
	}
	if _, err := repo.Summary(ctx, tenantContext, "organization"); err != nil {
		t.Fatalf("summary: %v", err)
	}
	if _, err := repo.ListItems(ctx, tenantContext, ListFilter{Scope: "organization", Limit: 10}); err != nil {
		t.Fatalf("list items: %v", err)
	}
}
