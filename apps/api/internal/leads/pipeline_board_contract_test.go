package leads

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestPipelineBoardStageExposesQualifiedMarker(t *testing.T) {
	payload, err := json.Marshal(PipelineBoardStage{
		ID:          "11111111-1111-4111-8111-111111111111",
		IsQualified: true,
		Leads:       []PipelineBoardLead{},
	})
	if err != nil {
		t.Fatalf("marshal pipeline board stage: %v", err)
	}
	if !strings.Contains(string(payload), `"is_qualified":true`) {
		t.Fatalf("pipeline board stage JSON missing qualified marker: %s", payload)
	}

	source, err := os.ReadFile("pipeline_board.go")
	if err != nil {
		t.Fatalf("read pipeline_board.go: %v", err)
	}
	functionSource := string(source)
	start := strings.Index(functionSource, "func (repo Repository) listPipelineBoardStages")
	if start < 0 {
		t.Fatal("could not find listPipelineBoardStages source")
	}
	end := strings.Index(functionSource[start:], "func (repo Repository) listPipelineBoardLeads")
	if end < 0 {
		t.Fatal("could not isolate listPipelineBoardStages source")
	}
	functionSource = functionSource[start : start+end]

	for _, contract := range []string{
		"coalesce((to_jsonb(s)->>'is_qualified')::boolean, false)",
		"&stage.IsQualified",
		"and s.is_active = true",
	} {
		if !strings.Contains(functionSource, contract) {
			t.Fatalf("pipeline board stage projection must contain %q", contract)
		}
	}
}

func TestLeadMetaFiltersUseVisibleLeadPeriodAndDistinctHistoricalEntries(t *testing.T) {
	source, err := os.ReadFile("pipeline_board.go")
	if err != nil {
		t.Fatalf("read pipeline_board.go: %v", err)
	}
	functionSource := string(source)
	start := strings.Index(functionSource, "func (repo Repository) ListLeadMetaFilters")
	if start < 0 {
		t.Fatal("could not find ListLeadMetaFilters source")
	}
	end := strings.Index(functionSource[start:], "func (repo Repository) resolvePipelineBoardPipelineID")
	if end < 0 {
		t.Fatal("could not isolate ListLeadMetaFilters source")
	}
	functionSource = functionSource[start : start+end]

	for _, contract := range []string{
		"buildPipelineLeadWhere(tenantContext, filter)",
		"with visible_leads as",
		"left join lateral",
		"select distinct",
		"union all",
		"raw_attribution",
		"selectedPageID := normalizedLeadAttributionValue(filter.FilterPage)",
		"or entry.page_id = $",
		"or meta.page_id = $",
		"where $`+fmt.Sprint(selectedPageIndex)+` = ''",
		"entry.utm_campaign",
		"entry.campaign_id",
		"entry.adset_id",
		"entry.ad_id",
		"l.utm_campaign",
		"l.meta_campaign_id",
		"l.meta_adset_id",
		"l.meta_ad_id",
		"from public.marketing_performance_daily performance",
		"and performance.provider = 'meta'",
		"performance.ad_id = nullif(btrim(raw_attribution.ad_id), '')",
		"performance.adset_id = nullif(btrim(raw_attribution.adset_id), '')",
		"performance.campaign_id = nullif(btrim(raw_attribution.campaign_id), '')",
		"order by performance.metric_date desc, performance.fetched_at desc",
		"from public.meta_campaign_insights mi",
		"pageFilter.FilterPage = \"\"",
		"entry.page_name",
		"entry.page_id",
		"meta.page_id",
		"from public.meta_integrations integration",
		"integration.organization_id = l.organization_id",
		"select distinct nullif(btrim(l.source), '') as source",
		"sourceArgs = append(sourceArgs, maxPipelineBoardSources)",
		"order by source",
	} {
		if !strings.Contains(functionSource, contract) {
			t.Fatalf("meta-filter projection must contain %q", contract)
		}
	}
	for _, forbidden := range []string{
		"lee.occurred_at >=",
		"lee.occurred_at <=",
		"lee.id is not null",
		"attribution_keys",
		"coalesce(nullif(raw_attribution.campaign_id, ''), nullif(l.meta_campaign_id, ''))",
	} {
		if strings.Contains(functionSource, forbidden) {
			t.Fatalf("meta-filter projection must not contain %q", forbidden)
		}
	}
}

func TestCollectLeadMetaPageOptionsRequiresStableIDAndStableOrdering(t *testing.T) {
	pages := map[string]LeadMetaPageOption{}
	collectLeadMetaPageOption(pages, "Página duplicada", "page-b")
	collectLeadMetaPageOption(pages, "Página duplicada", "page-a")
	collectLeadMetaPageOption(pages, "Sem id", "")
	collectLeadMetaPageOption(pages, "", "page-c")

	filters := LeadMetaFilters{Pages: make([]LeadMetaPageOption, 0, len(pages))}
	for _, page := range pages {
		filters.Pages = append(filters.Pages, page)
	}
	sortLeadMetaOptions(&filters)

	if len(filters.Pages) != 3 {
		t.Fatalf("pages = %#v, want three canonical page ids", filters.Pages)
	}
	if filters.Pages[0].ID != "page-c" || filters.Pages[0].Name != "page-c" {
		t.Fatalf("empty page name did not fall back to id: %#v", filters.Pages)
	}
	if filters.Pages[1].ID != "page-a" || filters.Pages[2].ID != "page-b" {
		t.Fatalf("duplicate names are not stably ordered by id: %#v", filters.Pages)
	}
}

func TestCollectLeadMetaFilterOptionsRequiresCompleteParentHierarchy(t *testing.T) {
	campaigns := map[string]LeadMetaCampaignOption{}
	adsets := map[string]LeadMetaAdsetOption{}
	ads := map[string]LeadMetaAdOption{}

	collectLeadMetaFilterOptions(
		campaigns,
		adsets,
		ads,
		"",
		"",
		"Conjunto órfão",
		"adset-orphan",
		"Anúncio órfão",
		"ad-orphan",
	)
	if len(campaigns) != 0 || len(adsets) != 0 || len(ads) != 0 {
		t.Fatalf("orphan attribution leaked into filters: campaigns=%#v adsets=%#v ads=%#v", campaigns, adsets, ads)
	}

	collectLeadMetaFilterOptions(
		campaigns,
		adsets,
		ads,
		"Campanha completa",
		"campaign-1",
		"",
		"",
		"Anúncio sem conjunto",
		"ad-without-adset",
	)
	if len(campaigns) != 1 || len(adsets) != 0 || len(ads) != 0 {
		t.Fatalf("child without adset leaked into filters: campaigns=%#v adsets=%#v ads=%#v", campaigns, adsets, ads)
	}

	collectLeadMetaFilterOptions(
		campaigns,
		adsets,
		ads,
		" Campanha completa ",
		" campaign-1 ",
		" Conjunto completo ",
		" adset-1 ",
		" Anúncio completo ",
		" ad-1 ",
	)

	campaign, ok := campaigns["campaign-1"]
	if !ok || campaign.Name != "Campanha completa" {
		t.Fatalf("campaign was not normalized: %#v", campaigns)
	}
	adset, ok := adsets["campaign-1-adset-1"]
	if !ok || adset.CampaignID != "campaign-1" || adset.Name != "Conjunto completo" {
		t.Fatalf("adset hierarchy is invalid: %#v", adsets)
	}
	ad, ok := ads["campaign-1-adset-1-ad-1"]
	if !ok || ad.CampaignID != "campaign-1" || ad.AdsetID != "adset-1" || ad.Name != "Anúncio completo" {
		t.Fatalf("ad hierarchy is invalid: %#v", ads)
	}
}

func TestPipelineStageCursorUsesStableBoardOrdering(t *testing.T) {
	source, err := os.ReadFile("pipeline_board.go")
	if err != nil {
		t.Fatalf("read pipeline_board.go: %v", err)
	}
	functionSource := string(source)
	start := strings.Index(functionSource, "func (repo Repository) listPipelineBoardLeads(")
	if start < 0 {
		t.Fatal("could not find listPipelineBoardLeads source")
	}
	end := strings.Index(functionSource[start:], "func (repo Repository) listInitialPipelineBoardLeadsByStage")
	if end < 0 {
		t.Fatal("could not isolate listPipelineBoardLeads source")
	}
	functionSource = functionSource[start : start+end]

	for _, contract := range []string{
		"if filter.CursorBefore != nil",
		`boardSortExpression := pipelineBoardSortExpression("l")`,
		`"("+boardSortExpression+", l.id) <`,
		"order by `+boardSortExpression+` desc, l.id desc",
		"if filter.CursorBefore == nil",
		"paginationSQL = \" offset $\"",
	} {
		if !strings.Contains(functionSource, contract) {
			t.Fatalf("pipeline stage cursor contract must contain %q", contract)
		}
	}
}

func TestInitialPipelineBoardSeparatesExactMetricsFromLimitedCards(t *testing.T) {
	source, err := os.ReadFile("pipeline_board.go")
	if err != nil {
		t.Fatalf("read pipeline_board.go: %v", err)
	}
	functionSource := string(source)

	getStart := strings.Index(functionSource, "func (repo Repository) GetPipelineBoard(")
	if getStart < 0 {
		t.Fatal("could not isolate GetPipelineBoard")
	}
	getEnd := strings.Index(functionSource[getStart:], "func (repo Repository) ListPipelineStageLeads")
	if getEnd < 0 {
		t.Fatal("could not isolate GetPipelineBoard")
	}
	getSource := functionSource[getStart : getStart+getEnd]
	for _, contract := range []string{
		"listInitialPipelineBoardLeadsByStage",
		"listPipelineBoardStageMetrics",
		"metric.LeadCount",
		"metric.TotalValue",
	} {
		if !strings.Contains(getSource, contract) {
			t.Fatalf("initial board must contain %q", contract)
		}
	}

	previewStart := strings.Index(functionSource, "func (repo Repository) listInitialPipelineBoardLeadsByStage")
	if previewStart < 0 {
		t.Fatal("could not isolate initial board preview query")
	}
	previewEnd := strings.Index(functionSource[previewStart:], "type pipelineBoardStageMetric")
	if previewEnd < 0 {
		t.Fatal("could not isolate initial board preview query")
	}
	previewSource := functionSource[previewStart : previewStart+previewEnd]
	for _, contract := range []string{
		"with requested_stages(stage_id) as",
		"cross join lateral",
		"and l.stage_id = requested_stage.stage_id",
		"limit $",
		`pipelineBoardSortExpression("l")`,
	} {
		if !strings.Contains(previewSource, contract) {
			t.Fatalf("initial board preview must contain %q", contract)
		}
	}
	for _, forbidden := range []string{"count(*) over", "row_number() over", "stage_rank", " offset $"} {
		if strings.Contains(previewSource, forbidden) {
			t.Fatalf("initial board preview must not contain %q", forbidden)
		}
	}

	metricsStart := strings.Index(functionSource, "func (repo Repository) listPipelineBoardStageMetrics")
	if metricsStart < 0 {
		t.Fatal("could not isolate pipeline board metrics query")
	}
	metricsEnd := strings.Index(functionSource[metricsStart:], "func buildPipelineLeadWhere")
	if metricsEnd < 0 {
		t.Fatal("could not isolate pipeline board metrics query")
	}
	metricsSource := functionSource[metricsStart : metricsStart+metricsEnd]
	for _, contract := range []string{"count(*)::bigint as lead_count", "coalesce(sum(", "group by l.stage_id"} {
		if !strings.Contains(metricsSource, contract) {
			t.Fatalf("pipeline metrics must contain %q", contract)
		}
	}
}

func TestPipelineBoardSortUsesIndexBackedOperationalClock(t *testing.T) {
	if got := pipelineBoardSortExpression("lead"); got != "lead.board_order_at" {
		t.Fatalf("pipelineBoardSortExpression() = %q", got)
	}
}

func TestOperationalLeadMutationsAdvanceBoardClock(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}
	functionSource := string(source)
	for _, contract := range []string{
		`if !hasLeadColumnAssignment(assignments, "board_order_at")`,
		`addRawAssignment("board_order_at = now()")`,
		"set board_order_at = now(),",
		"assigned_at = case when $3::uuid is null then null else now() end,\n\t\t    board_order_at = now(),",
	} {
		if !strings.Contains(functionSource, contract) {
			t.Fatalf("lead operational mutations must contain %q", contract)
		}
	}

	if !hasLeadColumnAssignment([]string{"stage_id = $3::uuid", " board_order_at = now()"}, "board_order_at") {
		t.Fatal("board clock assignment detector missed an existing assignment")
	}
	if hasLeadColumnAssignment([]string{"updated_at = now()"}, "board_order_at") {
		t.Fatal("board clock assignment detector matched another column")
	}
}

func TestLeadReentryAlwaysReturnsCardToTop(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}
	functionSource := string(source)
	start := strings.Index(functionSource, "func (repo Repository) registerReentry(")
	end := strings.Index(functionSource[start:], "func (repo Repository) resolveDestination")
	if start < 0 || end < 0 {
		t.Fatal("could not isolate registerReentry")
	}
	reentrySource := functionSource[start : start+end]
	if !strings.Contains(reentrySource, "board_order_at = now()") {
		t.Fatal("lead reentry must advance board_order_at even when the stage does not change")
	}
}

func TestGenericLeadUpdateResolvesStageStatusInsideTransaction(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}
	functionSource := string(source)
	start := strings.Index(functionSource, "func (repo Repository) Update(")
	end := strings.Index(functionSource[start:], "func (repo Repository) dispatchDealStatusSideEffects")
	if start < 0 || end < 0 {
		t.Fatal("could not isolate lead Update")
	}
	functionSource = functionSource[start : start+end]
	ordered := []string{
		"repo.getLeadSnapshotForUpdate",
		"repo.applyDestinationDealStatus(ctx, tx",
		"validateLostReasonContract(current, input)",
		"repo.applyDestinationAssignments(ctx, tx",
		"repo.lockWonLeadPropertyForUpdate",
		"repo.enqueueDealWonNotifications",
		"tx.Commit(ctx)",
	}
	previous := -1
	for _, contract := range ordered {
		position := strings.Index(functionSource, contract)
		if position <= previous {
			t.Fatalf("generic stage update contract %q missing or out of order", contract)
		}
		previous = position
	}
}
