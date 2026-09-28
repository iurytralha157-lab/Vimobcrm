package leads

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestDashboardEntriesCountOneInitialPerVisibleCardAndOnlyCountableReentries(t *testing.T) {
	repo := Repository{}
	query, _, err := repo.buildDashboardEntryCountsQuery(tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		MemberRole:     "admin",
	}, DashboardFilter{})
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{
		"l.id as lead_id, false as is_reentry", // exactly one synthetic initial per visible card
		"e.entry_type = 'initial'",
		"order by e.occurred_at, e.created_at, e.id",
		"limit 1", // a duplicate historical initial cannot add to the total
		"select e.id::text as entry_id",
		"e.entry_type = 'reentry' and e.is_countable = true",
		"count(*) filter (where not entry.is_reentry)",
		"count(*) filter (where entry.is_reentry)",
		"left join lateral (", // only one historical initial can join each card
	} {
		if !strings.Contains(query, required) {
			t.Errorf("entry count query is missing %q", required)
		}
	}
	if strings.Contains(query, "l.reentry_count") || strings.Contains(query, "count(distinct entry.lead_id)") {
		t.Fatal("entry count must use canonical countable events, not the mutable reentry counter or unique card count")
	}
}

func TestDashboardEntriesApplyCurrentCardScopeAndSameOccurrenceAttribution(t *testing.T) {
	from := time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, time.September, 27, 23, 59, 59, 0, time.UTC)
	filter := DashboardFilter{
		DateFrom:   &from,
		DateTo:     &to,
		Source:     "meta",
		PageID:     "page-1",
		CampaignID: "campaign-1",
		PipelineID: "33333333-3333-4333-8333-333333333333",
		UserID:     "22222222-2222-4222-8222-222222222222",
		DealStatus: "open",
		TagID:      "44444444-4444-4444-8444-444444444444",
	}
	cte, entryWhere, args, err := (Repository{}).buildDashboardEntriesCTE(tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		Permissions:    []string{permissions.LeadViewOwn},
	}, filter)
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{
		"l.organization_id = $1::uuid",
		"l.assigned_user_id =",
		"l.pipeline_id =",
		"l.deal_status =",
		"from public.lead_tags",
		"coalesce(initial.occurred_at, l.created_at) as occurred_at",
		"true as is_reentry, e.occurred_at",
		"nullif(e.page_id, '') as page_id",
		"nullif(e.campaign_id, '') as campaign_id",
		"nullif(initial.page_id, '') as page_id",
		"nullif(initial.campaign_id, '') as campaign_id",
	} {
		if !strings.Contains(cte, required) {
			t.Errorf("entry CTE is missing %q", required)
		}
	}
	for _, absent := range []string{
		"l.created_at >=",
		"l.created_at <=",
		"l.source =",
		"from public.lead_entry_events entry", // broad exists attribution leaks another arrival
	} {
		if strings.Contains(cte, absent) {
			t.Errorf("card cohort applied an occurrence filter: %q", absent)
		}
	}
	for _, required := range []string{
		"entry.occurred_at >=",
		"entry.occurred_at <=",
		"btrim(entry.source) =",
		"btrim(entry.page_id) =",
		"btrim(entry.campaign_id) =",
		"btrim(entry.campaign_name) =",
		"btrim(entry.utm_campaign) =",
	} {
		if !strings.Contains(entryWhere, required) {
			t.Errorf("same-arrival filter is missing %q", required)
		}
	}
	if len(args) < 10 || args[0] != "11111111-1111-4111-8111-111111111111" {
		t.Fatalf("unexpected scoped arguments: %#v", args)
	}
}

func TestDashboardInitialAttributionUsesEarliestLedgerFactWithoutMutableFallback(t *testing.T) {
	cte, _, _, err := (Repository{}).buildDashboardEntriesCTE(tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		MemberRole:     "admin",
	}, DashboardFilter{})
	if err != nil {
		t.Fatal(err)
	}
	initial, _, found := strings.Cut(cte, "union all")
	if !found {
		t.Fatal("entry CTE must keep initial and reentry branches separate")
	}
	for _, required := range []string{
		"select l.id, l.organization_id, l.created_at",
		"coalesce(initial.id::text, 'initial:' || l.id::text) as entry_id",
		"coalesce(initial.occurred_at, l.created_at) as occurred_at",
		"nullif(initial.source, '') as source",
		"nullif(initial.page_id, '') as page_id",
		"nullif(initial.campaign_id, '') as campaign_id",
		"nullif(initial.utm_campaign, '') as utm_campaign",
		"nullif(initial.adset_id, '') as adset_id",
		"nullif(initial.ad_id, '') as ad_id",
		"e.entry_type = 'initial'",
		"order by e.occurred_at, e.created_at, e.id",
		"limit 1",
	} {
		if !strings.Contains(initial, required) {
			t.Errorf("first-arrival branch is missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"e.is_countable = true", // a non-countable initial can still be the earliest fact
		"from public.lead_meta",
		" l.source", " l.meta_campaign_id", " l.utm_campaign",
		"meta.page_id", "meta.campaign_id",
	} {
		if strings.Contains(initial, forbidden) {
			t.Errorf("first arrival can inherit a later attribution from %q", forbidden)
		}
	}
}

func TestDashboardEntriesPipelineUsesCurrentCardScope(t *testing.T) {
	// A filtered pipeline has one initial occurrence per card plus every
	// countable reentry for those cards. Filtering l.pipeline_id (current card)
	// before the union includes reentries whose entry-event pipeline snapshot
	// was null or recorded before distribution.
	query, _, err := (Repository{}).buildDashboardEntryCountsQuery(tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		MemberRole:     "admin",
	}, DashboardFilter{PipelineID: "33333333-3333-4333-8333-333333333333"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(query, "l.pipeline_id =") || !strings.Contains(query, "join public.lead_entry_events e") {
		t.Fatalf("the pipeline must include its current cards and their countable reentries: %s", query)
	}
	if strings.Contains(query, "e.pipeline_id =") {
		t.Fatal("historical entry pipeline can be null or pre-distribution and must not remove reentries")
	}
}

// This optional canary uses an independently written count query on a pinned
// organization and its selected pipeline. It only reads production data, so
// the expected numbers can drift without making the test stale.
func TestDashboardEntriesReadOnlyReconciliation(t *testing.T) {
	databaseURL := os.Getenv("VIMOB_DASHBOARD_READONLY_DATABASE_URL")
	organizationID := strings.TrimSpace(os.Getenv("VIMOB_DASHBOARD_AUDIT_ORGANIZATION_ID"))
	if databaseURL == "" || organizationID == "" {
		t.Skip("set VIMOB_DASHBOARD_READONLY_DATABASE_URL and VIMOB_DASHBOARD_AUDIT_ORGANIZATION_ID for the read-only entry canary")
	}
	if normalized, ok := normalizeUUID(organizationID); ok {
		organizationID = normalized
	} else {
		t.Fatal("VIMOB_DASHBOARD_AUDIT_ORGANIZATION_ID must be a UUID")
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
	repo := NewRepository(db, nil)
	var viewerUserID string
	if err := db.Pool().QueryRow(ctx, `
		select user_id::text from public.organization_members
		where organization_id = $1::uuid and is_active = true and deleted_at is null
		order by user_id limit 1
	`, organizationID).Scan(&viewerUserID); err != nil {
		t.Fatalf("select audit viewer: %v", err)
	}
	viewer := tenant.Context{OrganizationID: organizationID, UserID: viewerUserID, MemberRole: "admin"}
	pipelineID := strings.TrimSpace(os.Getenv("VIMOB_DASHBOARD_AUDIT_PIPELINE_ID"))
	if pipelineID != "" {
		if normalized, ok := normalizeUUID(pipelineID); ok {
			pipelineID = normalized
		} else {
			t.Fatal("VIMOB_DASHBOARD_AUDIT_PIPELINE_ID must be a UUID")
		}
	} else {
		pipelineID, err = repo.resolvePipelineBoardPipelineID(ctx, viewer, "")
		if err != nil {
			t.Fatalf("resolve default pipeline: %v", err)
		}
	}
	tx, err := db.Pool().BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		t.Fatalf("begin read-only snapshot: %v", err)
	}
	defer tx.Rollback(ctx)
	scopes := []string{""}
	if pipelineID != "" {
		scopes = append(scopes, pipelineID)
	}
	for _, scope := range scopes {
		var pipelineArg any
		if scope != "" {
			pipelineArg = scope
		}
		actual, err := repo.dashboardEntryCounts(ctx, tx, viewer, DashboardFilter{PipelineID: scope})
		if err != nil {
			t.Fatalf("count dashboard entries for pipeline %q: %v", scope, err)
		}
		var cards, reentries int64
		if err := tx.QueryRow(ctx, `
			select
				(select count(*)::bigint from public.leads l
				 where l.organization_id = $1::uuid
				   and ($2::uuid is null or l.pipeline_id = $2::uuid)),
				(select count(*)::bigint from public.lead_entry_events e
				 join public.leads l on l.organization_id = e.organization_id and l.id = e.lead_id
				 where e.organization_id = $1::uuid and e.entry_type = 'reentry'
				   and e.is_countable = true
				   and ($2::uuid is null or l.pipeline_id = $2::uuid))
		`, organizationID, pipelineArg).Scan(&cards, &reentries); err != nil {
			t.Fatalf("independent entry count for pipeline %q: %v", scope, err)
		}
		if actual.UniqueLeads != cards || actual.Reentries != reentries || actual.TotalEntries != cards+reentries {
			t.Fatalf("pipeline %q: dashboard entries %+v; independent cards=%d reentries=%d", scope, actual, cards, reentries)
		}
		t.Logf("pipeline=%q cards=%d reentries=%d entries=%d", scope, cards, reentries, actual.TotalEntries)
	}
}
