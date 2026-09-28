package leads

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// This optional audit compares the Dashboard funnel with the Pipeline board on
// the same read-only database. It reports counts only, never lead data.
func TestDashboardFunnelPipelineParityReadOnlyIntegration(t *testing.T) {
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

	// A caller can pin the organization being reviewed. Otherwise audit the
	// largest organization with a pipeline and an active member, a stable
	// criterion independent of any screenshot's transient lead count.
	organizationID := strings.TrimSpace(os.Getenv("VIMOB_DASHBOARD_AUDIT_ORGANIZATION_ID"))
	var leadTotal int64
	if organizationID != "" {
		if normalized, ok := normalizeUUID(organizationID); ok {
			organizationID = normalized
		} else {
			t.Fatal("VIMOB_DASHBOARD_AUDIT_ORGANIZATION_ID must be a UUID")
		}
		if err := db.Pool().QueryRow(ctx, `
			select count(*)::bigint from public.leads where organization_id = $1::uuid
		`, organizationID).Scan(&leadTotal); err != nil || leadTotal == 0 {
			t.Fatalf("audit organization has no readable leads: %v", err)
		}
	} else {
		if err := db.Pool().QueryRow(ctx, `
			select l.organization_id::text, count(*)::bigint as lead_total
			from public.leads l
			where exists (
				select 1 from public.pipelines p where p.organization_id = l.organization_id
			)
			and exists (
				select 1 from public.organization_members om
				where om.organization_id = l.organization_id
				  and om.is_active = true and om.deleted_at is null
			)
			group by l.organization_id
			order by count(*) desc, l.organization_id
			limit 1
		`).Scan(&organizationID, &leadTotal); err != nil {
			t.Fatalf("select audit organization: %v", err)
		}
	}

	repo := NewRepository(db, nil)
	var viewerUserID string
	if err := db.Pool().QueryRow(ctx, `
		select user_id::text
		from public.organization_members
		where organization_id = $1::uuid and is_active = true and deleted_at is null
		order by user_id
		limit 1
	`, organizationID).Scan(&viewerUserID); err != nil {
		t.Fatalf("select audit viewer: %v", err)
	}
	viewer := tenant.Context{OrganizationID: organizationID, UserID: viewerUserID, MemberRole: "admin"}
	pipelineID, err := repo.resolvePipelineBoardPipelineID(ctx, viewer, "")
	if err != nil {
		t.Fatalf("resolve default pipeline: %v", err)
	}
	if pipelineID == "" {
		t.Skip("audit organization has no pipeline")
	}
	stages, err := repo.listPipelineBoardStages(ctx, viewer, pipelineID)
	if err != nil {
		t.Fatalf("list active stages: %v", err)
	}
	stageIDs := make([]string, 0, len(stages))
	for _, stage := range stages {
		stageIDs = append(stageIDs, stage.ID)
	}
	metrics, err := repo.listPipelineBoardStageMetrics(ctx, viewer, PipelineBoardFilter{PipelineID: pipelineID, StageIDs: stageIDs, DateMode: PipelineBoardDateModeOrigin})
	if err != nil {
		t.Fatalf("count Pipeline board stages: %v", err)
	}
	funnel, err := repo.GetDashboardFunnel(ctx, viewer, DashboardFilter{PipelineID: pipelineID})
	if err != nil {
		t.Fatalf("count Dashboard funnel stages: %v", err)
	}
	var boardTotal, funnelTotal int64
	for _, stage := range stages {
		boardTotal += metrics[stage.ID].LeadCount
	}
	for _, stage := range funnel {
		funnelTotal += stage.Value
	}
	if boardTotal != funnelTotal {
		t.Fatalf("Dashboard funnel %d != Pipeline board %d on the same pipeline", funnelTotal, boardTotal)
	}

	var allLeads, pipelineLeads, visibleStageLeads, missingStageLeads, outsidePipelineLeads, noStageLeads int64
	if err := db.Pool().QueryRow(ctx, `
		select
			count(*)::bigint,
			count(*) filter (where l.pipeline_id = $2::uuid)::bigint,
			count(*) filter (where l.pipeline_id = $2::uuid and exists (
				select 1 from public.stages s
				where s.id = l.stage_id and s.organization_id = l.organization_id
				  and s.pipeline_id = $2::uuid and s.is_active = true
			))::bigint,
			count(*) filter (where l.pipeline_id = $2::uuid and not exists (
				select 1 from public.stages s
				where s.id = l.stage_id and s.organization_id = l.organization_id
				  and s.pipeline_id = $2::uuid and s.is_active = true
			))::bigint,
			count(*) filter (where l.pipeline_id is distinct from $2::uuid)::bigint,
			count(*) filter (where l.stage_id is null)::bigint
		from public.leads l
		where l.organization_id = $1::uuid
	`, organizationID, pipelineID).Scan(
		&allLeads, &pipelineLeads, &visibleStageLeads, &missingStageLeads, &outsidePipelineLeads, &noStageLeads,
	); err != nil {
		t.Fatalf("classify leads outside visible funnel: %v", err)
	}
	t.Logf("read_only=on dashboard_all_pipelines=%d default_pipeline=%d active_stages=%d pipeline_without_active_stage=%d outside_default_pipeline=%d no_stage=%d board=%d funnel=%d",
		allLeads, pipelineLeads, visibleStageLeads, missingStageLeads, outsidePipelineLeads, noStageLeads, boardTotal, funnelTotal)
	if leadTotal != allLeads || allLeads != pipelineLeads+outsidePipelineLeads || pipelineLeads != visibleStageLeads+missingStageLeads || visibleStageLeads != boardTotal {
		t.Fatalf("Dashboard/Pipeline cohort classification did not reconcile")
	}

	// Exercise the shared origin-date and current-status filters used by both
	// Dashboard and Pipeline. This detects a semantic drift that all-time totals
	// alone would not expose.
	dateTo := time.Now().UTC()
	dateFrom := dateTo.AddDate(0, 0, -7)
	filteredDashboard := DashboardFilter{
		PipelineID: pipelineID, DateFrom: &dateFrom, DateTo: &dateTo, DealStatus: "open",
	}
	filteredBoard := PipelineBoardFilter{
		PipelineID: pipelineID, StageIDs: stageIDs, DateMode: PipelineBoardDateModeOrigin,
		DateFrom: &dateFrom, DateTo: &dateTo, FilterDealStatus: "open",
	}
	filteredStats, err := repo.dashboardAggregate(ctx, db.Pool(), viewer, filteredDashboard, dashboardLeadWhereOptions{DateColumn: "created_at"})
	if err != nil {
		t.Fatalf("count filtered Dashboard leads: %v", err)
	}
	filteredFunnel, err := repo.GetDashboardFunnel(ctx, viewer, filteredDashboard)
	if err != nil {
		t.Fatalf("count filtered Dashboard funnel: %v", err)
	}
	filteredMetrics, err := repo.listPipelineBoardStageMetrics(ctx, viewer, filteredBoard)
	if err != nil {
		t.Fatalf("count filtered Pipeline board: %v", err)
	}
	var filteredFunnelTotal, filteredBoardTotal int64
	for _, stage := range filteredFunnel {
		filteredFunnelTotal += stage.Value
	}
	for _, stage := range stages {
		filteredBoardTotal += filteredMetrics[stage.ID].LeadCount
	}
	t.Logf("seven_day_open_cohort dashboard=%d funnel=%d pipeline_board=%d", filteredStats.Total, filteredFunnelTotal, filteredBoardTotal)
	if filteredStats.Total != filteredFunnelTotal || filteredFunnelTotal != filteredBoardTotal {
		t.Fatalf("filtered Dashboard/Pipeline cohort did not reconcile")
	}
}
