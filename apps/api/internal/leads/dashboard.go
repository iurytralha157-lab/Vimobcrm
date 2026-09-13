package leads

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/propertyscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/searchtext"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	"golang.org/x/sync/errgroup"
)

type dashboardLeadWhereOptions struct {
	DateColumn      string
	DateExpression  string
	ForceDealStatus string
}

type dashboardQueryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type dashboardAggregate struct {
	Total               int64
	Open                int64
	Lost                int64
	AverageResponseSecs *float64
}

type dashboardWonSummary struct {
	Count                 int64
	TotalValue            float64
	AverageConversionDays *int
	Buckets               []WonConversionBucket
}

type conversionBucketDefinition struct {
	Key   string
	Label string
	Min   int
	Max   int
	Color string
}

type lossReasonDefinition struct {
	Key     string
	Label   string
	Color   string
	Aliases []string
}

var dashboardConversionBuckets = []conversionBucketDefinition{
	{Key: "up_to_7", Label: "Ate 7 dias", Min: 0, Max: 7, Color: "#10b981"},
	{Key: "7_to_14", Label: "De 7 a 14 dias", Min: 8, Max: 14, Color: "#22c55e"},
	{Key: "15_to_30", Label: "15 a 30 dias", Min: 15, Max: 30, Color: "#84cc16"},
	{Key: "1_to_2_months", Label: "Entre 1 e 2 meses", Min: 31, Max: 60, Color: "#eab308"},
	{Key: "2_to_4_months", Label: "De 2 a 4 meses", Min: 61, Max: 120, Color: "#f97316"},
	{Key: "4_to_6_months", Label: "De 4 a 6 meses", Min: 121, Max: 180, Color: "#fb6f24"},
	{Key: "over_6_months", Label: "Acima de 6 meses", Min: 181, Max: math.MaxInt, Color: "#ef4444"},
}

var dashboardLossReasonDefinitions = []lossReasonDefinition{
	{Key: "nao_respondeu", Label: "Nao respondeu", Color: "#ef4444", Aliases: []string{"nao respondeu", "não respondeu", "sem resposta"}},
	{Key: "outra_regiao", Label: "Lead de outra regiao", Color: "#f97316", Aliases: []string{"lead de outra regiao", "lead de outra região", "outra regiao", "outra região", "ddd de fora"}},
	{Key: "contato_invalido", Label: "Contato invalido / sem telefone", Color: "#eab308", Aliases: []string{"contato invalido", "contato inválido", "telefone invalido", "telefone inválido", "sem telefone"}},
	{Key: "sem_interesse", Label: "Sem interesse no momento", Color: "#8b5cf6", Aliases: []string{"sem interesse", "sem interesse no momento"}},
	{Key: "sem_orcamento", Label: "Sem orcamento", Color: "#06b6d4", Aliases: []string{"sem orcamento", "sem orçamento", "fora do orcamento", "fora do orçamento"}},
	{Key: "concorrente", Label: "Comprou com concorrente", Color: "#10b981", Aliases: []string{"comprou com concorrente", "concorrente", "escolheu concorrente"}},
}

const dashboardLossReasonOtherColor = "#64748b"

const (
	dashboardDetailLimit             = 100
	dashboardMaxEvolutionBucketCount = 24
)

func (repo Repository) GetDashboardStats(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) (DashboardStats, error) {
	currentFilter := filter
	previousFilter, hasPreviousPeriod := dashboardPreviousPeriodFilter(filter)

	var currentAggregate dashboardAggregate
	var previousAggregate dashboardAggregate
	var wonSummary dashboardWonSummary
	var lostReasonBuckets []LostReasonBucket
	var wonDeals []WonDealDetail
	var lostDeals []LostDealDetail
	var lostLeads int64
	var previousWonCount int64
	var previousLostCount int64

	tx, err := repo.db.Pool().BeginTx(ctx, pgx.TxOptions{
		IsoLevel:   pgx.RepeatableRead,
		AccessMode: pgx.ReadOnly,
	})
	if err != nil {
		return DashboardStats{}, err
	}
	defer tx.Rollback(ctx)

	currentAggregate, err = repo.dashboardAggregate(ctx, tx, tenantContext, currentFilter, dashboardLeadWhereOptions{DateColumn: "created_at"})
	if err != nil {
		return DashboardStats{}, err
	}
	wonSummary, err = repo.dashboardWonSummary(ctx, tx, tenantContext, currentFilter)
	if err != nil {
		return DashboardStats{}, err
	}
	lostReasonBuckets, lostLeads, err = repo.dashboardLostReasonSummary(ctx, tx, tenantContext, currentFilter)
	if err != nil {
		return DashboardStats{}, err
	}
	wonDeals, lostDeals, err = repo.dashboardDealDetails(ctx, tx, tenantContext, currentFilter)
	if err != nil {
		return DashboardStats{}, err
	}
	if hasPreviousPeriod {
		previousAggregate, err = repo.dashboardAggregate(ctx, tx, tenantContext, previousFilter, dashboardLeadWhereOptions{DateColumn: "created_at"})
		if err != nil {
			return DashboardStats{}, err
		}
		previousWonCount, err = repo.dashboardWonCount(ctx, tx, tenantContext, previousFilter)
		if err != nil {
			return DashboardStats{}, err
		}
		previousLostCount, err = repo.dashboardLostCount(ctx, tx, tenantContext, previousFilter)
		if err != nil {
			return DashboardStats{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return DashboardStats{}, err
	}

	closedLeads := wonSummary.Count
	conversionRate := 0.0
	if currentAggregate.Total > 0 {
		conversionRate = (float64(closedLeads) / float64(currentAggregate.Total)) * 100
	}
	leadsTrend := 0
	openTrend := 0
	lostTrend := 0
	closedTrend := 0
	if hasPreviousPeriod {
		leadsTrend = calculateTrend(currentAggregate.Total, previousAggregate.Total)
		openTrend = calculateTrend(currentAggregate.Open, previousAggregate.Open)
		lostTrend = calculateTrend(lostLeads, previousLostCount)
		closedTrend = calculateTrend(closedLeads, previousWonCount)
	}

	return DashboardStats{
		TotalLeads:               currentAggregate.Total,
		LeadsInProgress:          currentAggregate.Open,
		LeadsClosed:              closedLeads,
		LeadsLost:                lostLeads,
		OpenLeads:                currentAggregate.Open,
		LostLeads:                lostLeads,
		ConversionRate:           conversionRate,
		ClosedLeads:              closedLeads,
		WonAverageConversionDays: wonSummary.AverageConversionDays,
		WonConversionBuckets:     wonSummary.Buckets,
		WonDeals:                 wonDeals,
		WonDealsTruncated:        int64(len(wonDeals)) < closedLeads,
		LostReasonBuckets:        lostReasonBuckets,
		LostDeals:                lostDeals,
		LostDealsTruncated:       int64(len(lostDeals)) < lostLeads,
		AverageResponseTime:      formatAverageResponseTime(currentAggregate.AverageResponseSecs),
		TotalSalesValue:          wonSummary.TotalValue,
		PendingCommissions:       0,
		LeadsTrend:               leadsTrend,
		OpenTrend:                openTrend,
		LostTrend:                lostTrend,
		ConversionTrend:          0,
		ClosedTrend:              closedTrend,
		TotalReceivables:         0,
		TotalPayables:            0,
		OverdueReceivables:       0,
		OverduePayables:          0,
		PaidCommissions:          0,
	}, nil
}

func (repo Repository) GetDashboardFunnel(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) ([]FunnelDataPoint, error) {
	pipelineID, err := repo.resolvePipelineBoardPipelineID(ctx, tenantContext, filter.PipelineID)
	if err != nil {
		return nil, err
	}
	if pipelineID == "" {
		return []FunnelDataPoint{}, nil
	}
	filter.PipelineID = pipelineID

	stages, err := repo.listPipelineBoardStages(ctx, tenantContext, pipelineID)
	if err != nil {
		return nil, err
	}
	if len(stages) == 0 {
		return []FunnelDataPoint{}, nil
	}

	where, args, err := repo.buildDashboardLeadWhere(tenantContext, filter, dashboardLeadWhereOptions{DateColumn: "created_at"})
	if err != nil {
		return nil, err
	}
	stageIDs := make([]string, 0, len(stages))
	stagePlaceholderStart := len(args) + 1
	for _, stage := range stages {
		stageIDs = append(stageIDs, stage.ID)
		args = append(args, stage.ID)
	}
	where = append(where, "l.stage_id in ("+uuidPlaceholders(stagePlaceholderStart, stageIDs)+")")

	rows, err := repo.db.Pool().Query(ctx, `
		select l.stage_id::text, count(*)::bigint
		from public.leads l
		where `+strings.Join(where, " and ")+`
		group by l.stage_id
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	counts := map[string]int64{}
	for rows.Next() {
		var stageID string
		var count int64
		if err := rows.Scan(&stageID, &count); err != nil {
			return nil, err
		}
		counts[stageID] = count
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Only active stages returned above belong in the displayed funnel. Leads
	// still pointing at a removed stage (or at no stage) must not dilute the
	// percentages of the visible columns.
	total := dashboardVisibleFunnelTotal(stages, counts)

	result := make([]FunnelDataPoint, 0, len(stages))
	for _, stage := range stages {
		count := counts[stage.ID]
		percentage := 0
		if total > 0 {
			percentage = int(math.Round((float64(count) / float64(total)) * 100))
		}
		stageKey := stage.Name
		if stage.StageKey != nil && strings.TrimSpace(*stage.StageKey) != "" {
			stageKey = *stage.StageKey
		}
		result = append(result, FunnelDataPoint{
			Name:       stage.Name,
			Value:      count,
			Percentage: percentage,
			StageKey:   stageKey,
		})
	}

	return result, nil
}

func dashboardVisibleFunnelTotal(stages []PipelineBoardStage, counts map[string]int64) int64 {
	var total int64
	for _, stage := range stages {
		total += counts[stage.ID]
	}
	return total
}

func (repo Repository) GetDashboardSources(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) ([]SourceDataPoint, error) {
	where, args, err := repo.buildDashboardLeadWhere(tenantContext, filter, dashboardLeadWhereOptions{DateColumn: "created_at"})
	if err != nil {
		return nil, err
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select coalesce(nullif(l.source, ''), 'manual') as source_name, count(*)::bigint
		from public.leads l
		where `+strings.Join(where, " and ")+`
		group by coalesce(nullif(l.source, ''), 'manual')
		order by count(*) desc
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := []SourceDataPoint{}
	for rows.Next() {
		var source string
		var count int64
		if err := rows.Scan(&source, &count); err != nil {
			return nil, err
		}
		result = append(result, SourceDataPoint{
			Name:      source,
			Value:     count,
			RawSource: source,
		})
	}

	return result, rows.Err()
}

func (repo Repository) GetDashboardTopBrokers(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) (TopBrokersResult, error) {
	if !canViewAllLeads(tenantContext) && !tenantContext.HasPermission("lead_view_team") {
		return TopBrokersResult{Brokers: []TopBroker{}, IsFallbackMode: false}, nil
	}

	brokers, err := repo.dashboardTopBrokers(ctx, tenantContext, filter, false)
	if err != nil {
		return TopBrokersResult{}, err
	}
	if len(brokers) > 0 {
		return TopBrokersResult{Brokers: brokers, IsFallbackMode: false}, nil
	}

	fallback, err := repo.dashboardTopBrokers(ctx, tenantContext, filter, true)
	if err != nil {
		return TopBrokersResult{}, err
	}

	return TopBrokersResult{Brokers: fallback, IsFallbackMode: true}, nil
}

func (repo Repository) GetDashboardUpcomingTasks(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) ([]UpcomingTask, error) {
	limit := filter.Limit
	if limit < 1 {
		limit = defaultDashboardTaskLimit
	}
	if limit > maxDashboardTaskLimit {
		limit = maxDashboardTaskLimit
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			lt.id::text,
			lt.title,
			lt.type,
			lt.due_date,
			l.id::text,
			l.name
		from public.lead_tasks lt
		join public.leads l on l.id = lt.lead_id and l.organization_id = lt.organization_id
		where lt.organization_id = $1::uuid
		  and lt.is_done = false
		  and coalesce(
		    lt.status,
		    case when coalesce(lt.is_done, false) then 'completed' else 'pending' end
		  ) = 'pending'
		  and lt.due_date is not null
		  and l.organization_id = $1::uuid
		  and l.deal_status = 'open'
		  and (
		    lt.cadence_enrollment_id is null
		    or exists (
		      select 1
		      from public.cadence_enrollments enrollment
		      join public.lead_stage_cycles cycle
		        on cycle.organization_id = enrollment.organization_id
		       and cycle.id = enrollment.stage_cycle_id
		       and cycle.exited_at is null
		      where enrollment.organization_id = lt.organization_id
		        and enrollment.id = lt.cadence_enrollment_id
		        and enrollment.status = 'active'
		        and cycle.lead_id = l.id
		        and cycle.pipeline_id = l.pipeline_id
		        and cycle.stage_id = l.stage_id
		    )
		  )
		  and `+leadVisibilitySQL("$2", "$3", "$4", tenantContext.HasPermission(permissions.LeadViewOwn))+`
		order by lt.due_date asc, lt.created_at asc
		limit $5
	`,
		tenantContext.OrganizationID,
		canViewAllLeads(tenantContext),
		tenantContext.UserID,
		tenantContext.HasPermission("lead_view_team"),
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tasks := []UpcomingTask{}
	for rows.Next() {
		var task UpcomingTask
		var taskType pgtype.Text
		var dueDate pgtype.Timestamptz
		if err := rows.Scan(&task.ID, &task.Title, &taskType, &dueDate, &task.LeadID, &task.LeadName); err != nil {
			return nil, err
		}
		task.Type = normalizeDashboardTaskType(textValue(taskType))
		if dueDate.Valid {
			task.DueDate = dueDate.Time.Format(time.RFC3339)
		}
		tasks = append(tasks, task)
	}

	return tasks, rows.Err()
}

func (repo Repository) GetDashboardDealsEvolution(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) ([]DealsEvolutionPoint, error) {
	queryer := dashboardQueryer(repo.db.Pool())
	var tx pgx.Tx
	var err error

	from, to, hasRange := dashboardExplicitDateRange(filter)
	if !hasRange {
		tx, err = repo.db.Pool().BeginTx(ctx, pgx.TxOptions{
			IsoLevel:   pgx.RepeatableRead,
			AccessMode: pgx.ReadOnly,
		})
		if err != nil {
			return nil, err
		}
		defer tx.Rollback(ctx)
		queryer = tx

		from, to, hasRange, err = repo.dashboardEvolutionBounds(ctx, queryer, tenantContext, filter)
		if err != nil {
			return nil, err
		}
		if !hasRange {
			return []DealsEvolutionPoint{}, nil
		}
	}

	data, err := repo.dashboardDealsEvolutionAggregate(ctx, queryer, tenantContext, filter, from, to)
	if err != nil {
		return nil, err
	}
	if tx != nil {
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
	}

	return data, nil
}

func (repo Repository) dashboardEvolutionBounds(ctx context.Context, queryer dashboardQueryer, tenantContext tenant.Context, filter DashboardFilter) (time.Time, time.Time, bool, error) {
	where, args, err := repo.buildDashboardLeadWhere(tenantContext, filter, dashboardLeadWhereOptions{})
	if err != nil {
		return time.Time{}, time.Time{}, false, err
	}
	eventAt := dashboardEvolutionEventSQL("l")

	var minimum, maximum pgtype.Timestamptz
	err = queryer.QueryRow(ctx, `
		select min(`+eventAt+`), max(`+eventAt+`)
		from public.leads l
		where `+strings.Join(where, " and ")+`
		  and `+eventAt+` is not null
	`, args...).Scan(&minimum, &maximum)
	if err != nil {
		return time.Time{}, time.Time{}, false, err
	}
	if !minimum.Valid || !maximum.Valid {
		return time.Time{}, time.Time{}, false, nil
	}

	from := minimum.Time
	to := maximum.Time.Add(time.Microsecond)
	if !to.After(from) {
		to = from.Add(time.Microsecond)
	}
	return from, to, true, nil
}

func (repo Repository) dashboardDealsEvolutionAggregate(ctx context.Context, queryer dashboardQueryer, tenantContext tenant.Context, filter DashboardFilter, from time.Time, to time.Time) ([]DealsEvolutionPoint, error) {
	granularity := filter.Granularity
	if filter.DateFrom == nil && filter.DateTo == nil && to.Sub(from) > 24*time.Hour {
		granularity = ""
	}
	intervals, labels := dashboardEvolutionIntervals(from, to, granularity)
	if len(intervals) == 0 {
		return []DealsEvolutionPoint{}, nil
	}

	where, args, err := repo.buildDashboardLeadWhere(tenantContext, filter, dashboardLeadWhereOptions{})
	if err != nil {
		return nil, err
	}
	eventAt := dashboardEvolutionEventSQL("l")
	args = append(args, from, to)
	fromIndex := len(args) - 1
	toIndex := len(args)

	caseParts := make([]string, 0, len(intervals))
	for index := 0; index < len(intervals)-1; index++ {
		args = append(args, intervals[index+1])
		caseParts = append(caseParts, fmt.Sprintf("when event_at < $%d::timestamptz then %d", len(args), index))
	}
	caseParts = append(caseParts, fmt.Sprintf("else %d", len(intervals)-1))

	rows, err := queryer.Query(ctx, `
		with filtered_events as (
			select
				coalesce(l.deal_status, 'open') as deal_status,
				`+eventAt+` as event_at
			from public.leads l
			where `+strings.Join(where, " and ")+`
		), bucketed_events as (
			select
				deal_status,
				case `+strings.Join(caseParts, " ")+` end as bucket_index
			from filtered_events
			where event_at >= $`+fmt.Sprintf("%d", fromIndex)+`::timestamptz
			  and event_at < $`+fmt.Sprintf("%d", toIndex)+`::timestamptz
		)
		select
			bucket_index,
			count(*) filter (where deal_status = 'won')::bigint,
			count(*) filter (where deal_status = 'lost')::bigint,
			count(*) filter (where deal_status not in ('won', 'lost'))::bigint
		from bucketed_events
		group by bucket_index
		order by bucket_index
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]DealsEvolutionPoint, len(intervals))
	for index, label := range labels {
		result[index].Date = label
	}
	var total int64
	for rows.Next() {
		var index int
		var point DealsEvolutionPoint
		if err := rows.Scan(&index, &point.Ganhos, &point.Perdas, &point.Abertos); err != nil {
			return nil, err
		}
		if index < 0 || index >= len(result) {
			return nil, fmt.Errorf("invalid dashboard evolution bucket index %d", index)
		}
		point.Date = labels[index]
		result[index] = point
		total += point.Ganhos + point.Perdas + point.Abertos
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if total == 0 {
		return []DealsEvolutionPoint{}, nil
	}

	return result, nil
}

func dashboardEvolutionEventSQL(alias string) string {
	return `case
		when coalesce(` + alias + `.deal_status, 'open') = 'won' then ` + alias + `.won_at
		when coalesce(` + alias + `.deal_status, 'open') = 'lost' then coalesce(` + alias + `.lost_at, ` + alias + `.created_at)
		else ` + alias + `.created_at
	end`
}

func (repo Repository) GetDashboardExtraCounts(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) (DashboardExtraCounts, error) {
	var propertyCount int64
	var siteVisits int64
	var scheduledVisits int64

	group, groupCtx := errgroup.WithContext(ctx)
	group.SetLimit(3)
	group.Go(func() error {
		var err error
		propertyCount, err = repo.countDashboardProperties(groupCtx, tenantContext, filter)
		return err
	})
	group.Go(func() error {
		var err error
		siteVisits, err = repo.countDashboardSiteVisits(groupCtx, tenantContext, filter)
		return err
	})
	group.Go(func() error {
		var err error
		scheduledVisits, err = repo.countDashboardScheduledVisits(groupCtx, tenantContext, filter)
		return err
	})
	if err := group.Wait(); err != nil {
		return DashboardExtraCounts{}, err
	}

	return DashboardExtraCounts{
		PropertyCount:   propertyCount,
		SiteVisits:      siteVisits,
		ScheduledVisits: scheduledVisits,
	}, nil
}

func (repo Repository) GetDashboardRecentActivities(ctx context.Context, tenantContext tenant.Context, limit int) ([]RecentActivity, error) {
	if limit < 1 {
		limit = 8
	}
	if limit > 50 {
		limit = 50
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			a.id::text,
			a.type,
			a.content,
			a.created_at,
			coalesce(nullif(l.name, ''), 'Lead') as lead_name,
			u.name
		from public.activities a
		join public.leads l on l.id = a.lead_id and l.organization_id = a.organization_id
		left join public.users u on u.id = a.user_id
		where a.organization_id = $1::uuid
		  and l.organization_id = $1::uuid
		  and `+leadVisibilitySQL("$2", "$3", "$4", tenantContext.HasPermission(permissions.LeadViewOwn))+`
		order by a.created_at desc
		limit $5
	`,
		tenantContext.OrganizationID,
		canViewAllLeads(tenantContext),
		tenantContext.UserID,
		tenantContext.HasPermission("lead_view_team"),
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	activities := []RecentActivity{}
	for rows.Next() {
		var activity RecentActivity
		var content, userName pgtype.Text
		var createdAt pgtype.Timestamptz
		if err := rows.Scan(&activity.ID, &activity.Type, &content, &createdAt, &activity.LeadName, &userName); err != nil {
			return nil, err
		}
		activity.Content = pipelineTextPtr(content)
		if createdAt.Valid {
			activity.CreatedAt = createdAt.Time.Format(time.RFC3339)
		}
		activity.UserName = pipelineTextPtr(userName)
		activities = append(activities, activity)
	}
	return activities, rows.Err()
}

func (repo Repository) GetDashboardTeamLeadIDs(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) ([]string, error) {
	if filter.TeamID == "" || filter.TeamID == "all" {
		return nil, nil
	}
	teamID, ok := normalizeUUID(filter.TeamID)
	if !ok {
		return nil, ErrInvalidInput
	}
	filter.TeamID = teamID

	where, args, err := repo.buildDashboardLeadWhere(tenantContext, filter, dashboardLeadWhereOptions{DateColumn: "created_at"})
	if err != nil {
		return nil, err
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select l.id::text
		from public.leads l
		where `+strings.Join(where, " and ")+`
		order by l.created_at desc
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (repo Repository) countDashboardProperties(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) (int64, error) {
	where, args, err := buildDashboardPropertyWhere(tenantContext, filter, false)
	if err != nil {
		return 0, err
	}

	var count int64
	err = repo.db.Pool().QueryRow(ctx, `
		select count(*)::bigint
		from public.properties p
		where `+strings.Join(where, " and "),
		args...,
	).Scan(&count)
	return count, err
}

func (repo Repository) countDashboardSiteVisits(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) (int64, error) {
	args := []any{tenantContext.OrganizationID}

	where := []string{"le.organization_id = $1::uuid", "le.session_id is not null"}
	needsPropertyScope := !propertyscope.CanViewAll(tenantContext) || (filter.UserID != "" && filter.UserID != "all") || (filter.TeamID != "" && filter.TeamID != "all")
	if needsPropertyScope {
		propertyWhere, propertyArgs, err := buildDashboardPropertyWhere(tenantContext, filter, false)
		if err != nil {
			return 0, err
		}
		args = propertyArgs
		where = append(where, `exists (
			select 1
			from public.properties p
			where p.id = le.property_id
			  and `+strings.Join(propertyWhere, " and ")+`
		)`)
	}
	if filter.DateFrom != nil {
		args = append(args, *filter.DateFrom)
		where = append(where, fmt.Sprintf("le.created_at >= $%d", len(args)))
	}
	if filter.DateTo != nil {
		args = append(args, *filter.DateTo)
		where = append(where, fmt.Sprintf("le.created_at <= $%d", len(args)))
	}

	var count int64
	err := repo.db.Pool().QueryRow(ctx, `
		select count(distinct le.session_id)::bigint
		from public.lead_events le
		where `+strings.Join(where, " and "),
		args...,
	).Scan(&count)
	return count, err
}

func (repo Repository) countDashboardScheduledVisits(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) (int64, error) {
	where, args, err := repo.buildDashboardScheduledVisitsWhere(tenantContext, filter)
	if err != nil {
		return 0, err
	}

	var count int64
	err = repo.db.Pool().QueryRow(ctx, `
		select count(*)::bigint
		from public.schedule_events se
		where `+strings.Join(where, " and "),
		args...,
	).Scan(&count)
	return count, err
}

func (repo Repository) buildDashboardScheduledVisitsWhere(tenantContext tenant.Context, filter DashboardFilter) ([]string, []any, error) {
	leadWhere, args, err := repo.buildDashboardLeadWhere(tenantContext, filter, dashboardLeadWhereOptions{})
	if err != nil {
		return nil, nil, err
	}

	where := []string{
		"se.organization_id = $1::uuid",
		"se.event_type in ('visit', 'meeting')",
	}

	add := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}
	if filter.DateFrom != nil {
		add("se.created_at >= $%d", *filter.DateFrom)
	}
	if filter.DateTo != nil {
		add("se.created_at <= $%d", *filter.DateTo)
	}
	where = append(where, `exists (
		select 1
		from public.leads l
		where l.id = se.lead_id
		  and `+strings.Join(leadWhere, " and ")+`
	)`)

	return where, args, nil
}

func (repo Repository) dashboardAggregate(ctx context.Context, queryer dashboardQueryer, tenantContext tenant.Context, filter DashboardFilter, options dashboardLeadWhereOptions) (dashboardAggregate, error) {
	where, args, err := repo.buildDashboardLeadWhere(tenantContext, filter, options)
	if err != nil {
		return dashboardAggregate{}, err
	}

	var aggregate dashboardAggregate
	var average pgtype.Float8
	err = queryer.QueryRow(ctx, `
		select
			count(*)::bigint,
			count(*) filter (where coalesce(l.deal_status, 'open') not in ('won', 'lost'))::bigint,
			count(*) filter (where l.deal_status = 'lost')::bigint,
			avg(l.first_response_seconds)::double precision
		from public.leads l
		where `+strings.Join(where, " and "),
		args...,
	).Scan(&aggregate.Total, &aggregate.Open, &aggregate.Lost, &average)
	if err != nil {
		return dashboardAggregate{}, err
	}
	if average.Valid {
		value := average.Float64
		aggregate.AverageResponseSecs = &value
	}

	return aggregate, nil
}

func (repo Repository) dashboardWonSummary(ctx context.Context, queryer dashboardQueryer, tenantContext tenant.Context, filter DashboardFilter) (dashboardWonSummary, error) {
	where, args, err := repo.buildDashboardLeadWhere(tenantContext, filter, dashboardLeadWhereOptions{
		DateColumn:      "won_at",
		ForceDealStatus: "won",
	})
	if err != nil {
		return dashboardWonSummary{}, err
	}
	args, propertyVisibility := appendCanonicalPropertyVisibility(args, tenantContext, "p")
	propertyValue := dashboardPropertyValueSQL(tenantContext)
	conversionDays := `case
		when l.created_at is null or l.won_at is null then null
		else greatest(floor(extract(epoch from (l.won_at - l.created_at)) / 86400), 0)::integer
	end`

	selects := []string{
		"count(*)::bigint",
		"coalesce(sum(value), 0)::double precision",
		"avg(conversion_days)::double precision",
	}
	for _, definition := range dashboardConversionBuckets {
		predicate := dashboardConversionBucketPredicate("conversion_days", definition)
		selects = append(selects,
			"count(*) filter (where "+predicate+")::bigint",
			"coalesce(sum(value) filter (where "+predicate+"), 0)::double precision",
		)
	}

	summary := dashboardWonSummary{Buckets: make([]WonConversionBucket, len(dashboardConversionBuckets))}
	counts := make([]int64, len(dashboardConversionBuckets))
	values := make([]float64, len(dashboardConversionBuckets))
	var average pgtype.Float8
	scanTargets := []any{&summary.Count, &summary.TotalValue, &average}
	for index := range dashboardConversionBuckets {
		scanTargets = append(scanTargets, &counts[index], &values[index])
	}

	err = queryer.QueryRow(ctx, `
		with filtered_won as (
			select
				`+propertyValue+` as value,
				`+conversionDays+` as conversion_days
			from public.leads l
			left join public.properties p
			  on p.organization_id = l.organization_id
			 and p.id = coalesce(l.interest_property_id, l.property_id)
			 and `+propertyVisibility+`
			where `+strings.Join(where, " and ")+`
		)
		select `+strings.Join(selects, ",\n\t\t\t")+`
		from filtered_won
	`, args...).Scan(scanTargets...)
	if err != nil {
		return dashboardWonSummary{}, err
	}
	if average.Valid {
		value := int(math.Round(average.Float64))
		summary.AverageConversionDays = &value
	}
	for index, definition := range dashboardConversionBuckets {
		percentage := 0.0
		if summary.Count > 0 {
			percentage = (float64(counts[index]) / float64(summary.Count)) * 100
		}
		summary.Buckets[index] = WonConversionBucket{
			Key:        definition.Key,
			Label:      definition.Label,
			Count:      counts[index],
			Percentage: percentage,
			Value:      values[index],
			Color:      definition.Color,
		}
	}

	return summary, nil
}

func (repo Repository) dashboardLostReasonSummary(ctx context.Context, queryer dashboardQueryer, tenantContext tenant.Context, filter DashboardFilter) ([]LostReasonBucket, int64, error) {
	where, args, err := repo.buildDashboardLeadWhere(tenantContext, filter, dashboardLeadWhereOptions{
		DateExpression:  "coalesce(l.lost_at, l.created_at)",
		ForceDealStatus: "lost",
	})
	if err != nil {
		return nil, 0, err
	}

	reasonKey := dashboardLostReasonKeySQL("l.lost_reason")
	rows, err := queryer.Query(ctx, `
		select `+reasonKey+` as reason_key, count(*)::bigint
		from public.leads l
		where `+strings.Join(where, " and ")+`
		group by reason_key
	`, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	counts := map[string]int64{}
	var total int64
	for rows.Next() {
		var key string
		var count int64
		if err := rows.Scan(&key, &count); err != nil {
			return nil, 0, err
		}
		counts[key] += count
		total += count
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	return buildLostReasonBucketsFromCounts(counts, total), total, nil
}

func (repo Repository) dashboardWonCount(ctx context.Context, queryer dashboardQueryer, tenantContext tenant.Context, filter DashboardFilter) (int64, error) {
	where, args, err := repo.buildDashboardLeadWhere(tenantContext, filter, dashboardLeadWhereOptions{
		DateColumn:      "won_at",
		ForceDealStatus: "won",
	})
	if err != nil {
		return 0, err
	}

	var count int64
	err = queryer.QueryRow(ctx, `
		select count(*)::bigint
		from public.leads l
		where `+strings.Join(where, " and "),
		args...,
	).Scan(&count)

	return count, err
}

func (repo Repository) dashboardLostCount(ctx context.Context, queryer dashboardQueryer, tenantContext tenant.Context, filter DashboardFilter) (int64, error) {
	where, args, err := repo.buildDashboardLeadWhere(tenantContext, filter, dashboardLeadWhereOptions{
		DateExpression:  "coalesce(l.lost_at, l.created_at)",
		ForceDealStatus: "lost",
	})
	if err != nil {
		return 0, err
	}

	var count int64
	err = queryer.QueryRow(ctx, `
		select count(*)::bigint
		from public.leads l
		where `+strings.Join(where, " and "),
		args...,
	).Scan(&count)

	return count, err
}

func (repo Repository) dashboardDealDetails(ctx context.Context, queryer dashboardQueryer, tenantContext tenant.Context, filter DashboardFilter) ([]WonDealDetail, []LostDealDetail, error) {
	if !filter.IncludeDetails {
		return []WonDealDetail{}, []LostDealDetail{}, nil
	}

	wonDeals, err := repo.dashboardWonDeals(ctx, queryer, tenantContext, filter)
	if err != nil {
		return nil, nil, err
	}
	lostDeals, err := repo.dashboardLostDeals(ctx, queryer, tenantContext, filter)
	if err != nil {
		return nil, nil, err
	}

	return wonDeals, lostDeals, nil
}

func (repo Repository) dashboardWonDeals(ctx context.Context, queryer dashboardQueryer, tenantContext tenant.Context, filter DashboardFilter) ([]WonDealDetail, error) {
	where, args, err := repo.buildDashboardLeadWhere(tenantContext, filter, dashboardLeadWhereOptions{
		DateColumn:      "won_at",
		ForceDealStatus: "won",
	})
	if err != nil {
		return nil, err
	}
	args, propertyVisibility := appendCanonicalPropertyVisibility(args, tenantContext, "p")
	propertyValue := dashboardPropertyValueSQL(tenantContext)
	args, limitClause := dashboardDetailLimitClause(args)

	rows, err := queryer.Query(ctx, `
		select
			l.id::text,
			l.name,
			l.phone,
			l.source,
			`+propertyValue+`,
			l.created_at,
			l.won_at,
			u.name
		from public.leads l
		left join public.users u on u.id = l.assigned_user_id
		left join public.properties p
		  on p.organization_id = l.organization_id
		 and p.id = coalesce(l.interest_property_id, l.property_id)
		 and `+propertyVisibility+`
		where `+strings.Join(where, " and ")+`
		order by l.won_at desc nulls last, l.created_at desc, l.id desc
		`+limitClause+`
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	deals := []WonDealDetail{}
	for rows.Next() {
		var deal WonDealDetail
		var phone, source, userName pgtype.Text
		var interestValue pgtype.Float8
		var createdAt, wonAt pgtype.Timestamptz
		if err := rows.Scan(&deal.ID, &deal.Name, &phone, &source, &interestValue, &createdAt, &wonAt, &userName); err != nil {
			return nil, err
		}
		if deal.Name == "" {
			deal.Name = "Lead sem nome"
		}
		deal.Phone = pipelineTextPtr(phone)
		deal.Source = pipelineTextPtr(source)
		if interestValue.Valid {
			deal.Value = interestValue.Float64
		}
		if createdAt.Valid {
			value := createdAt.Time.Format(time.RFC3339)
			deal.CreatedAt = &value
		}
		if wonAt.Valid {
			value := wonAt.Time.Format(time.RFC3339)
			deal.WonAt = &value
		}
		if createdAt.Valid && wonAt.Valid {
			days := int(math.Floor(wonAt.Time.Sub(createdAt.Time).Hours() / 24))
			if days < 0 {
				days = 0
			}
			deal.ConversionDays = &days
		}
		deal.AssignedUserName = textValueWithDefault(userName, "Sem responsavel")
		deals = append(deals, deal)
	}

	return deals, rows.Err()
}

func (repo Repository) dashboardLostDeals(ctx context.Context, queryer dashboardQueryer, tenantContext tenant.Context, filter DashboardFilter) ([]LostDealDetail, error) {
	where, args, err := repo.buildDashboardLeadWhere(tenantContext, filter, dashboardLeadWhereOptions{
		DateExpression:  "coalesce(l.lost_at, l.created_at)",
		ForceDealStatus: "lost",
	})
	if err != nil {
		return nil, err
	}
	args, limitClause := dashboardDetailLimitClause(args)

	rows, err := queryer.Query(ctx, `
		select
			l.id::text,
			l.name,
			l.phone,
			l.source,
			l.lost_reason,
			l.created_at,
			l.lost_at,
			u.name
		from public.leads l
		left join public.users u on u.id = l.assigned_user_id
		where `+strings.Join(where, " and ")+`
		order by coalesce(l.lost_at, l.created_at) desc, l.created_at desc, l.id desc
		`+limitClause+`
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	deals := []LostDealDetail{}
	for rows.Next() {
		var deal LostDealDetail
		var phone, source, lostReason, userName pgtype.Text
		var createdAt, lostAt pgtype.Timestamptz
		if err := rows.Scan(&deal.ID, &deal.Name, &phone, &source, &lostReason, &createdAt, &lostAt, &userName); err != nil {
			return nil, err
		}
		if deal.Name == "" {
			deal.Name = "Lead sem nome"
		}
		deal.Phone = pipelineTextPtr(phone)
		deal.Source = pipelineTextPtr(source)
		deal.LostReason = textValueWithDefault(lostReason, "Outros")
		_, groupLabel, _ := classifyLostReason(deal.LostReason)
		deal.LostReasonGroup = groupLabel
		if createdAt.Valid {
			value := createdAt.Time.Format(time.RFC3339)
			deal.CreatedAt = &value
		}
		if lostAt.Valid {
			value := lostAt.Time.Format(time.RFC3339)
			deal.LostAt = &value
		}
		deal.AssignedUserName = textValueWithDefault(userName, "Sem responsavel")
		deals = append(deals, deal)
	}

	return deals, rows.Err()
}

func (repo Repository) dashboardTopBrokers(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter, fallback bool) ([]TopBroker, error) {
	options := dashboardLeadWhereOptions{DateColumn: "won_at", ForceDealStatus: "won"}
	if fallback {
		options = dashboardLeadWhereOptions{DateColumn: "created_at"}
	}

	where, args, err := repo.buildDashboardLeadWhere(tenantContext, filter, options)
	if err != nil {
		return nil, err
	}
	where = append(where, "l.assigned_user_id is not null")
	args, propertyVisibility := appendCanonicalPropertyVisibility(args, tenantContext, "p")
	propertyValue := dashboardPropertyValueSQL(tenantContext)

	commissionSelect := "0::double precision as total_commissions"
	commissionJoin := ""
	if !fallback {
		commissionSelect = "coalesce(c.total_commissions, 0)::double precision as total_commissions"
		commissionJoin = `
		left join (
			select user_id, sum(coalesce(amount, 0)) as total_commissions
			from public.commissions
			where organization_id = $1::uuid
			  and status in ('forecast', 'approved', 'paid', 'prevista', 'aprovada', 'paga')
			group by user_id
		) c on c.user_id = u.id`
	}

	rows, err := repo.db.Pool().Query(ctx, `
		with filtered_leads as (
			select
				l.assigned_user_id,
				`+propertyValue+` as value
			from public.leads l
			left join public.properties p
			  on p.organization_id = l.organization_id
			 and p.id = coalesce(l.interest_property_id, l.property_id)
			 and `+propertyVisibility+`
			where `+strings.Join(where, " and ")+`
		)
		select
			u.id::text,
			coalesce(nullif(u.name, ''), 'Usuario') as name,
			u.avatar_url,
			count(fl.assigned_user_id)::bigint as closed_leads,
			coalesce(sum(fl.value), 0)::double precision as sales_value,
			`+commissionSelect+`
		from filtered_leads fl
		join public.users u on u.id = fl.assigned_user_id
		`+commissionJoin+`
		group by u.id, u.name, u.avatar_url`+groupByCommission(fallback)+`
		order by count(fl.assigned_user_id) desc, coalesce(sum(fl.value), 0) desc
		limit 5
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	brokers := []TopBroker{}
	for rows.Next() {
		var broker TopBroker
		var avatar pgtype.Text
		if err := rows.Scan(&broker.ID, &broker.Name, &avatar, &broker.ClosedLeads, &broker.SalesValue, &broker.TotalCommissions); err != nil {
			return nil, err
		}
		broker.AvatarURL = pipelineTextPtr(avatar)
		brokers = append(brokers, broker)
	}

	return brokers, rows.Err()
}

func (repo Repository) buildDashboardLeadWhere(tenantContext tenant.Context, filter DashboardFilter, options dashboardLeadWhereOptions) ([]string, []any, error) {
	args := []any{
		tenantContext.OrganizationID,
		canViewAllLeads(tenantContext),
		tenantContext.UserID,
		tenantContext.HasPermission("lead_view_team"),
	}
	where := []string{
		"l.organization_id = $1::uuid",
		leadVisibilitySQL("$2", "$3", "$4", tenantContext.HasPermission(permissions.LeadViewOwn)),
	}

	add := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}

	dateExpression := options.DateExpression
	if dateExpression == "" && options.DateColumn != "" {
		dateExpression = "l." + options.DateColumn
	}
	if dateExpression != "" {
		if filter.DateFrom != nil {
			add(dateExpression+" >= $%d", *filter.DateFrom)
		}
		if filter.DateTo != nil {
			add(dateExpression+" <= $%d", *filter.DateTo)
		}
	}
	if filter.UserID != "" && filter.UserID != "all" {
		userID, ok := normalizeUUID(filter.UserID)
		if !ok {
			return nil, nil, ErrInvalidInput
		}
		add("l.assigned_user_id = $%d::uuid", userID)
	}
	if filter.TeamID != "" && filter.TeamID != "all" {
		teamID, ok := normalizeUUID(filter.TeamID)
		if !ok {
			return nil, nil, ErrInvalidInput
		}
		args = append(args, teamID)
		index := len(args)
		where = append(where, fmt.Sprintf(`(
			nullif(to_jsonb(l)->>'team_id', '') = $%d::text
			or (
				nullif(to_jsonb(l)->>'team_id', '') is null
				and exists (
					select 1
					from public.team_members dtm
					where dtm.organization_id = l.organization_id
					  and dtm.team_id = $%d::uuid
					  and dtm.user_id = l.assigned_user_id
					  and dtm.is_active = true
				)
			)
		)`, index, index))
	}
	if filter.Source != "" && filter.Source != "all" {
		add("l.source = $%d", filter.Source)
	}
	if filter.PipelineID != "" && filter.PipelineID != "all" {
		pipelineID, ok := normalizeUUID(filter.PipelineID)
		if !ok {
			return nil, nil, ErrInvalidInput
		}
		add("l.pipeline_id = $%d::uuid", pipelineID)
	}
	if filter.DealStatus != "" && filter.DealStatus != "all" {
		add("l.deal_status = $%d", filter.DealStatus)
	}
	if options.ForceDealStatus != "" {
		add("l.deal_status = $%d", options.ForceDealStatus)
	}
	if filter.TagID != "" && filter.TagID != "all" {
		tagID, ok := normalizeUUID(filter.TagID)
		if !ok {
			return nil, nil, ErrInvalidInput
		}
		add(`exists (
			select 1
			from public.lead_tags dlt
			where dlt.organization_id = $1::uuid
			  and dlt.lead_id = l.id
			  and dlt.tag_id = $%d::uuid
		)`, tagID)
	}
	if strings.TrimSpace(filter.SearchQuery) != "" {
		value := searchtext.Pattern(filter.SearchQuery)
		args = append(args, value)
		index := len(args)
		where = append(where, searchtext.AnySQL([]string{"l.name", "l.email", "l.phone"}, fmt.Sprintf("$%d", index)))
	}

	addLeadAttributionFilterCondition(&args, &where, "l", "dlm", leadAttributionFilter{
		Campaign: filter.CampaignID,
		AdSet:    filter.AdSetID,
		Ad:       filter.AdID,
	})

	return where, args, nil
}

func buildDashboardPropertyWhere(tenantContext tenant.Context, filter DashboardFilter, includeCreatedAt bool) ([]string, []any, error) {
	args := []any{tenantContext.OrganizationID}
	args, propertyVisibility := appendCanonicalPropertyVisibility(args, tenantContext, "p")
	where := []string{
		"p.organization_id = $1::uuid",
		propertyVisibility,
	}

	add := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}

	if includeCreatedAt {
		if filter.DateFrom != nil {
			add("p.created_at >= $%d", *filter.DateFrom)
		}
		if filter.DateTo != nil {
			add("p.created_at <= $%d", *filter.DateTo)
		}
	}
	if filter.UserID != "" && filter.UserID != "all" {
		userID, ok := normalizeUUID(filter.UserID)
		if !ok {
			return nil, nil, ErrInvalidInput
		}
		args = append(args, userID)
		index := len(args)
		where = append(where, fmt.Sprintf("p.responsible_user_id = $%d::uuid", index))
	}
	if filter.TeamID != "" && filter.TeamID != "all" {
		teamID, ok := normalizeUUID(filter.TeamID)
		if !ok {
			return nil, nil, ErrInvalidInput
		}
		add(`exists (
			select 1
			from public.team_members ptm
			where ptm.organization_id = $1::uuid
			  and ptm.team_id = $%d::uuid
			  and ptm.is_active = true
			  and (ptm.user_id = p.responsible_user_id or ptm.user_id = p.created_by)
		)`, teamID)
	}

	return where, args, nil
}

func propertyUserVisibilitySQL(canViewAllPlaceholder string, userIDPlaceholder string, canViewTeamPlaceholder string) string {
	return propertyscope.VisibilitySQL("p", canViewAllPlaceholder, userIDPlaceholder, canViewTeamPlaceholder)
}

func dashboardExplicitDateRange(filter DashboardFilter) (time.Time, time.Time, bool) {
	if filter.DateFrom == nil || filter.DateTo == nil {
		return time.Time{}, time.Time{}, false
	}
	from := *filter.DateFrom
	to := *filter.DateTo
	if to.Before(from) {
		from, to = to, from
	}

	return from, to, true
}

func dashboardPreviousPeriodFilter(filter DashboardFilter) (DashboardFilter, bool) {
	from, to, ok := dashboardExplicitDateRange(filter)
	if !ok {
		return DashboardFilter{}, false
	}
	interval := to.Sub(from)
	if interval <= 0 {
		return DashboardFilter{}, false
	}

	previous := filter
	previousFrom := from.Add(-interval)
	previous.DateFrom = &previousFrom
	previous.DateTo = &from
	return previous, true
}

func dashboardDetailLimitClause(args []any) ([]any, string) {
	args = append(args, dashboardDetailLimit)
	return args, fmt.Sprintf("limit $%d", len(args))
}

func calculateTrend(current int64, previous int64) int {
	if previous <= 0 {
		return 0
	}

	return int(math.Round(((float64(current) - float64(previous)) / float64(previous)) * 100))
}

func formatAverageResponseTime(seconds *float64) string {
	if seconds == nil {
		return "--"
	}
	if *seconds < 60 {
		return fmt.Sprintf("%ds", int(math.Round(*seconds)))
	}
	if *seconds < 3600 {
		return fmt.Sprintf("%dm", int(math.Round(*seconds/60)))
	}

	return fmt.Sprintf("%dh", int(math.Round(*seconds/3600)))
}

func buildWonConversionBuckets(deals []WonDealDetail, closedLeads int64) []WonConversionBucket {
	buckets := make([]WonConversionBucket, 0, len(dashboardConversionBuckets))
	for _, definition := range dashboardConversionBuckets {
		var count int64
		var value float64
		for _, deal := range deals {
			if deal.ConversionDays == nil {
				continue
			}
			if *deal.ConversionDays >= definition.Min && *deal.ConversionDays <= definition.Max {
				count++
				value += deal.Value
			}
		}
		percentage := 0.0
		if closedLeads > 0 {
			percentage = (float64(count) / float64(closedLeads)) * 100
		}
		buckets = append(buckets, WonConversionBucket{
			Key:        definition.Key,
			Label:      definition.Label,
			Count:      count,
			Percentage: percentage,
			Value:      value,
			Color:      definition.Color,
		})
	}

	return buckets
}

func dashboardConversionBucketPredicate(column string, definition conversionBucketDefinition) string {
	if definition.Max == math.MaxInt {
		return fmt.Sprintf("%s >= %d", column, definition.Min)
	}
	return fmt.Sprintf("%s between %d and %d", column, definition.Min, definition.Max)
}

func buildLostReasonBuckets(deals []LostDealDetail, lostLeads int64) []LostReasonBucket {
	counts := map[string]int64{}

	for _, deal := range deals {
		key, _, _ := classifyLostReason(deal.LostReason)
		counts[key]++
	}
	return buildLostReasonBucketsFromCounts(counts, lostLeads)
}

func buildLostReasonBucketsFromCounts(counts map[string]int64, lostLeads int64) []LostReasonBucket {
	buckets := make([]LostReasonBucket, 0, len(counts))
	handled := map[string]struct{}{}
	for _, definition := range dashboardLossReasonDefinitions {
		count := counts[definition.Key]
		if count == 0 {
			continue
		}
		buckets = append(buckets, LostReasonBucket{
			Key:        definition.Key,
			Label:      definition.Label,
			Count:      count,
			Percentage: lostReasonPercentage(count, lostLeads),
			Color:      definition.Color,
		})
		handled[definition.Key] = struct{}{}
	}

	if count := counts["outros"]; count > 0 {
		buckets = append(buckets, LostReasonBucket{
			Key:        "outros",
			Label:      "Outros",
			Count:      count,
			Percentage: lostReasonPercentage(count, lostLeads),
			Color:      dashboardLossReasonOtherColor,
		})
		handled["outros"] = struct{}{}
	}

	for key, count := range counts {
		if _, exists := handled[key]; exists {
			continue
		}
		buckets = append(buckets, LostReasonBucket{
			Key:        key,
			Label:      key,
			Count:      count,
			Percentage: lostReasonPercentage(count, lostLeads),
			Color:      dashboardLossReasonOtherColor,
		})
	}

	sort.SliceStable(buckets, func(i, j int) bool {
		if buckets[i].Count == buckets[j].Count {
			return buckets[i].Label < buckets[j].Label
		}
		return buckets[i].Count > buckets[j].Count
	})

	return buckets
}

func dashboardLostReasonKeySQL(column string) string {
	normalized := "translate(lower(btrim(coalesce(" + column + ", ''))), 'áàâãéêíóôõúç', 'aaaaeeiooouc')"
	clauses := []string{
		"when " + normalized + " = '' then 'outros'",
		"when " + normalized + " like 'outro%' then 'outros'",
	}
	for _, definition := range dashboardLossReasonDefinitions {
		seen := map[string]struct{}{}
		conditions := make([]string, 0, len(definition.Aliases))
		for _, alias := range definition.Aliases {
			prefix := normalizeLostReason(alias)
			if _, exists := seen[prefix]; exists {
				continue
			}
			seen[prefix] = struct{}{}
			conditions = append(conditions, normalized+" like "+dashboardSQLLiteral(prefix+"%"))
		}
		clauses = append(clauses, "when "+strings.Join(conditions, " or ")+" then "+dashboardSQLLiteral(definition.Key))
	}

	return "case " + strings.Join(clauses, " ") + " else 'outros' end"
}

func dashboardSQLLiteral(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func lostReasonPercentage(count int64, total int64) float64 {
	if total <= 0 {
		return 0
	}

	return (float64(count) / float64(total)) * 100
}

func classifyLostReason(reason string) (string, string, string) {
	normalized := normalizeLostReason(reason)
	if normalized == "" || strings.HasPrefix(normalized, "outros") || strings.HasPrefix(normalized, "outro") {
		return "outros", "Outros", dashboardLossReasonOtherColor
	}

	for _, definition := range dashboardLossReasonDefinitions {
		for _, alias := range definition.Aliases {
			if strings.HasPrefix(normalized, normalizeLostReason(alias)) {
				return definition.Key, definition.Label, definition.Color
			}
		}
	}

	return "outros", "Outros", dashboardLossReasonOtherColor
}

func normalizeLostReason(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	replacer := strings.NewReplacer(
		"á", "a", "à", "a", "â", "a", "ã", "a",
		"é", "e", "ê", "e",
		"í", "i",
		"ó", "o", "ô", "o", "õ", "o",
		"ú", "u",
		"ç", "c",
	)
	return replacer.Replace(value)
}

func groupByCommission(fallback bool) string {
	if fallback {
		return ""
	}

	return ", c.total_commissions"
}

func normalizeDashboardTaskType(value string) string {
	switch value {
	case "call", "email", "meeting", "message", "task":
		return value
	default:
		return "task"
	}
}

func dashboardEvolutionIntervals(from time.Time, to time.Time, granularity string) ([]time.Time, []string) {
	if granularity == "hour" || sameDashboardDay(from, to) || isSingleDashboardDayRange(from, to) {
		intervals := make([]time.Time, 0, 24)
		labels := make([]string, 0, 24)
		for hour := 0; hour < 24; hour++ {
			current := from.Add(time.Duration(hour) * time.Hour)
			intervals = append(intervals, current)
			labels = append(labels, fmt.Sprintf("%02d:00", hour))
		}
		return intervals, labels
	}

	days := int(math.Ceil(to.Sub(from).Hours() / 24))
	if days <= 31 {
		start := startOfDashboardDay(from)
		intervals := []time.Time{}
		labels := []string{}
		for current := start; !current.After(to); current = current.AddDate(0, 0, 1) {
			intervals = append(intervals, current)
			labels = append(labels, current.Format("02/01"))
		}
		return limitDashboardIntervals(intervals, labels)
	}

	if days <= 90 {
		start := startOfDashboardWeek(from)
		intervals := []time.Time{}
		labels := []string{}
		for current := start; !current.After(to); current = current.AddDate(0, 0, 7) {
			_, week := current.ISOWeek()
			intervals = append(intervals, current)
			labels = append(labels, fmt.Sprintf("Sem %d", week))
		}
		return limitDashboardIntervals(intervals, labels)
	}

	start := time.Date(from.Year(), from.Month(), 1, 0, 0, 0, 0, from.Location())
	intervals := []time.Time{}
	labels := []string{}
	for current := start; !current.After(to); current = current.AddDate(0, 1, 0) {
		intervals = append(intervals, current)
		labels = append(labels, dashboardMonthLabel(current))
	}

	return limitDashboardIntervals(intervals, labels)
}

func limitDashboardIntervals(intervals []time.Time, labels []string) ([]time.Time, []string) {
	if len(intervals) <= dashboardMaxEvolutionBucketCount {
		return intervals, labels
	}
	step := int(math.Ceil(float64(len(intervals)) / dashboardMaxEvolutionBucketCount))
	limitedIntervals := []time.Time{}
	limitedLabels := []string{}
	for index := range intervals {
		if index%step == 0 {
			limitedIntervals = append(limitedIntervals, intervals[index])
			limitedLabels = append(limitedLabels, labels[index])
		}
	}

	return limitedIntervals, limitedLabels
}

func sameDashboardDay(left time.Time, right time.Time) bool {
	return left.Year() == right.Year() && left.YearDay() == right.YearDay()
}

func isSingleDashboardDayRange(from time.Time, to time.Time) bool {
	duration := to.Sub(from)
	return duration > 0 && duration <= 24*time.Hour
}

func startOfDashboardDay(value time.Time) time.Time {
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, value.Location())
}

func startOfDashboardWeek(value time.Time) time.Time {
	start := startOfDashboardDay(value)
	weekday := int(start.Weekday())
	if weekday == 0 {
		weekday = 7
	}

	return start.AddDate(0, 0, -(weekday - 1))
}

func dashboardMonthLabel(value time.Time) string {
	labels := []string{"Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"}
	index := int(value.Month()) - 1
	if index < 0 || index >= len(labels) {
		return value.Format("Jan")
	}

	return labels[index]
}
