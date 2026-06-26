package leads

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type dashboardLeadWhereOptions struct {
	DateColumn      string
	ForceDealStatus string
}

type dashboardAggregate struct {
	Total               int64
	Open                int64
	Lost                int64
	AverageResponseSecs *float64
}

type dashboardEvolutionLead struct {
	CreatedAt  time.Time
	WonAt      *time.Time
	LostAt     *time.Time
	DealStatus string
}

type conversionBucketDefinition struct {
	Key   string
	Label string
	Min   int
	Max   int
	Color string
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

func (repo Repository) GetDashboardStats(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) (DashboardStats, error) {
	currentFrom, currentTo := dashboardDateRange(filter)
	interval := currentTo.Sub(currentFrom)
	if interval <= 0 {
		interval = 30 * 24 * time.Hour
	}
	prevFrom := currentFrom.Add(-interval)
	prevTo := currentFrom

	currentFilter := filterWithDateRange(filter, currentFrom, currentTo)
	previousFilter := filterWithDateRange(filter, prevFrom, prevTo)

	currentAggregate, err := repo.dashboardAggregate(ctx, tenantContext, currentFilter, dashboardLeadWhereOptions{DateColumn: "created_at"})
	if err != nil {
		return DashboardStats{}, err
	}
	previousAggregate, err := repo.dashboardAggregate(ctx, tenantContext, previousFilter, dashboardLeadWhereOptions{DateColumn: "created_at"})
	if err != nil {
		return DashboardStats{}, err
	}

	wonDeals, err := repo.dashboardWonDeals(ctx, tenantContext, currentFilter)
	if err != nil {
		return DashboardStats{}, err
	}
	previousWonCount, err := repo.dashboardWonCount(ctx, tenantContext, previousFilter)
	if err != nil {
		return DashboardStats{}, err
	}

	totalSalesValue := 0.0
	conversionDays := []int{}
	for _, deal := range wonDeals {
		totalSalesValue += deal.Value
		if deal.ConversionDays != nil {
			conversionDays = append(conversionDays, *deal.ConversionDays)
		}
	}

	closedLeads := int64(len(wonDeals))
	conversionRate := 0.0
	if currentAggregate.Total > 0 {
		conversionRate = (float64(closedLeads) / float64(currentAggregate.Total)) * 100
	}

	var averageConversionDays *int
	if len(conversionDays) > 0 {
		total := 0
		for _, days := range conversionDays {
			total += days
		}
		value := int(math.Round(float64(total) / float64(len(conversionDays))))
		averageConversionDays = &value
	}

	return DashboardStats{
		TotalLeads:               currentAggregate.Total,
		LeadsInProgress:          currentAggregate.Open,
		LeadsClosed:              closedLeads,
		LeadsLost:                currentAggregate.Lost,
		OpenLeads:                currentAggregate.Open,
		LostLeads:                currentAggregate.Lost,
		ConversionRate:           conversionRate,
		ClosedLeads:              closedLeads,
		WonAverageConversionDays: averageConversionDays,
		WonConversionBuckets:     buildWonConversionBuckets(wonDeals, closedLeads),
		WonDeals:                 wonDeals,
		AverageResponseTime:      formatAverageResponseTime(currentAggregate.AverageResponseSecs),
		TotalSalesValue:          totalSalesValue,
		PendingCommissions:       0,
		LeadsTrend:               calculateTrend(currentAggregate.Total, previousAggregate.Total),
		OpenTrend:                calculateTrend(currentAggregate.Open, previousAggregate.Open),
		LostTrend:                calculateTrend(currentAggregate.Lost, previousAggregate.Lost),
		ConversionTrend:          0,
		ClosedTrend:              calculateTrend(closedLeads, previousWonCount),
		TotalReceivables:         0,
		TotalPayables:            0,
		OverdueReceivables:       0,
		OverduePayables:          0,
		PaidCommissions:          0,
	}, nil
}

func (repo Repository) GetDashboardFunnel(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) ([]FunnelDataPoint, error) {
	from, to := dashboardDateRange(filter)
	filter = filterWithDateRange(filter, from, to)

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
	var total int64
	for rows.Next() {
		var stageID string
		var count int64
		if err := rows.Scan(&stageID, &count); err != nil {
			return nil, err
		}
		counts[stageID] = count
		total += count
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

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

func (repo Repository) GetDashboardSources(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) ([]SourceDataPoint, error) {
	from, to := dashboardDateRange(filter)
	filter = filterWithDateRange(filter, from, to)

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

	from, to := dashboardDateRange(filter)
	filter = filterWithDateRange(filter, from, to)

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
		  and lt.due_date is not null
		  and l.organization_id = $1::uuid
		  and `+leadVisibilitySQL("$2", "$3", "$4")+`
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
	from, to := dashboardDateRange(filter)
	filter = filterWithDateRange(filter, from, to)

	where, args, err := repo.buildDashboardLeadWhere(tenantContext, filter, dashboardLeadWhereOptions{})
	if err != nil {
		return nil, err
	}
	args = append(args, from, to)
	fromIndex := len(args) - 1
	toIndex := len(args)
	where = append(where, fmt.Sprintf(`(
		(l.created_at >= $%d and l.created_at <= $%d)
		or (l.won_at is not null and l.won_at >= $%d and l.won_at <= $%d)
		or (l.lost_at is not null and l.lost_at >= $%d and l.lost_at <= $%d)
	)`, fromIndex, toIndex, fromIndex, toIndex, fromIndex, toIndex))

	rows, err := repo.db.Pool().Query(ctx, `
		select l.created_at, l.won_at, l.lost_at, l.deal_status
		from public.leads l
		where `+strings.Join(where, " and "),
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	leads := []dashboardEvolutionLead{}
	for rows.Next() {
		var lead dashboardEvolutionLead
		var wonAt, lostAt pgtype.Timestamptz
		if err := rows.Scan(&lead.CreatedAt, &wonAt, &lostAt, &lead.DealStatus); err != nil {
			return nil, err
		}
		lead.WonAt = pipelineTimePtr(wonAt)
		lead.LostAt = pipelineTimePtr(lostAt)
		leads = append(leads, lead)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(leads) == 0 {
		return []DealsEvolutionPoint{}, nil
	}

	return buildDealsEvolutionPoints(leads, from, to), nil
}

func (repo Repository) GetDashboardExtraCounts(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) (DashboardExtraCounts, error) {
	from, to := dashboardDateRange(filter)
	filter = filterWithDateRange(filter, from, to)

	propertyCount, err := repo.countDashboardProperties(ctx, tenantContext, filter)
	if err != nil {
		return DashboardExtraCounts{}, err
	}
	siteVisits, err := repo.countDashboardSiteVisits(ctx, tenantContext, filter)
	if err != nil {
		return DashboardExtraCounts{}, err
	}
	scheduledVisits, err := repo.countDashboardScheduledVisits(ctx, tenantContext, filter)
	if err != nil {
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
		  and `+leadVisibilitySQL("$2", "$3", "$4")+`
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

	if filter.DateFrom == nil && filter.DateTo == nil {
		from, to := dashboardDateRange(filter)
		filter = filterWithDateRange(filter, from, to)
	}

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
	where, args, err := buildDashboardPropertyWhere(tenantContext, filter, true)
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
	needsPropertyScope := !canViewAllLeads(tenantContext) || (filter.UserID != "" && filter.UserID != "all") || (filter.TeamID != "" && filter.TeamID != "all")
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
	var leadWhere []string
	var args []any
	if dashboardNeedsLeadSubquery(filter) {
		var err error
		leadWhere, args, err = repo.buildDashboardLeadWhere(tenantContext, filter, dashboardLeadWhereOptions{})
		if err != nil {
			return 0, err
		}
	} else {
		args = []any{
			tenantContext.OrganizationID,
			canViewAllLeads(tenantContext),
			tenantContext.UserID,
			tenantContext.HasPermission("lead_view_team"),
		}
	}

	where := []string{
		"se.organization_id = $1::uuid",
		"se.event_type = 'visit'",
		eventUserVisibilitySQL("$2", "$3", "$4"),
	}

	add := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}
	if filter.DateFrom != nil {
		add("se.start_time >= $%d", *filter.DateFrom)
	}
	if filter.DateTo != nil {
		add("se.start_time <= $%d", *filter.DateTo)
	}
	if filter.UserID != "" && filter.UserID != "all" {
		userID, ok := normalizeUUID(filter.UserID)
		if !ok {
			return 0, ErrInvalidInput
		}
		add("se.user_id = $%d::uuid", userID)
	}
	if filter.TeamID != "" && filter.TeamID != "all" {
		teamID, ok := normalizeUUID(filter.TeamID)
		if !ok {
			return 0, ErrInvalidInput
		}
		add(`exists (
			select 1
			from public.team_members stm
			where stm.organization_id = $1::uuid
			  and stm.team_id = $%d::uuid
			  and stm.user_id = se.user_id
			  and stm.is_active = true
		)`, teamID)
	}

	if len(leadWhere) > 0 {
		where = append(where, `exists (
			select 1
			from public.leads l
			where l.id = se.lead_id
			  and `+strings.Join(leadWhere, " and ")+`
		)`)
	}

	var count int64
	err := repo.db.Pool().QueryRow(ctx, `
		select count(*)::bigint
		from public.schedule_events se
		where `+strings.Join(where, " and "),
		args...,
	).Scan(&count)
	return count, err
}

func (repo Repository) dashboardAggregate(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter, options dashboardLeadWhereOptions) (dashboardAggregate, error) {
	where, args, err := repo.buildDashboardLeadWhere(tenantContext, filter, options)
	if err != nil {
		return dashboardAggregate{}, err
	}

	var aggregate dashboardAggregate
	var average pgtype.Float8
	err = repo.db.Pool().QueryRow(ctx, `
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

func (repo Repository) dashboardWonCount(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) (int64, error) {
	where, args, err := repo.buildDashboardLeadWhere(tenantContext, filter, dashboardLeadWhereOptions{
		DateColumn:      "won_at",
		ForceDealStatus: "won",
	})
	if err != nil {
		return 0, err
	}

	var count int64
	err = repo.db.Pool().QueryRow(ctx, `
		select count(*)::bigint
		from public.leads l
		where `+strings.Join(where, " and "),
		args...,
	).Scan(&count)

	return count, err
}

func (repo Repository) dashboardWonDeals(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) ([]WonDealDetail, error) {
	where, args, err := repo.buildDashboardLeadWhere(tenantContext, filter, dashboardLeadWhereOptions{
		DateColumn:      "won_at",
		ForceDealStatus: "won",
	})
	if err != nil {
		return nil, err
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			l.id::text,
			l.name,
			l.phone,
			l.source,
			l.valor_interesse::double precision,
			l.created_at,
			l.won_at,
			u.name
		from public.leads l
		left join public.users u on u.id = l.assigned_user_id
		where `+strings.Join(where, " and ")+`
		order by l.won_at desc nulls last, l.created_at desc
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
			select l.assigned_user_id, coalesce(l.valor_interesse, 0)::double precision as value
			from public.leads l
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
		leadVisibilitySQL("$2", "$3", "$4"),
	}

	add := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}

	if options.DateColumn != "" {
		if filter.DateFrom != nil {
			add("l."+options.DateColumn+" >= $%d", *filter.DateFrom)
		}
		if filter.DateTo != nil {
			add("l."+options.DateColumn+" <= $%d", *filter.DateTo)
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
		add(`exists (
			select 1
			from public.team_members dtm
			where dtm.organization_id = $1::uuid
			  and dtm.team_id = $%d::uuid
			  and dtm.user_id = l.assigned_user_id
			  and dtm.is_active = true
		)`, teamID)
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
		value := "%" + strings.TrimSpace(filter.SearchQuery) + "%"
		args = append(args, value)
		index := len(args)
		where = append(where, fmt.Sprintf("(l.name ilike $%d or l.email ilike $%d or l.phone ilike $%d)", index, index, index))
	}

	metaConditions := []string{}
	addMetaCondition := func(idColumn string, nameColumn string, value string) {
		value = strings.TrimSpace(value)
		if value == "" || value == "all" {
			return
		}
		args = append(args, value)
		index := len(args)
		column := nameColumn
		if numericMetaFilter.MatchString(value) {
			column = idColumn
		}
		metaConditions = append(metaConditions, fmt.Sprintf("dlm.%s = $%d", column, index))
	}
	addMetaCondition("campaign_id", "campaign_name", filter.CampaignID)
	addMetaCondition("adset_id", "adset_name", filter.AdSetID)
	addMetaCondition("ad_id", "ad_name", filter.AdID)
	if len(metaConditions) > 0 {
		where = append(where, `exists (
			select 1
			from public.lead_meta dlm
			where dlm.organization_id = $1::uuid
			  and dlm.lead_id = l.id
			  and `+strings.Join(metaConditions, " and ")+`
		)`)
	}

	return where, args, nil
}

func buildDashboardPropertyWhere(tenantContext tenant.Context, filter DashboardFilter, includeCreatedAt bool) ([]string, []any, error) {
	args := []any{
		tenantContext.OrganizationID,
		canViewAllLeads(tenantContext),
		tenantContext.UserID,
		tenantContext.HasPermission("lead_view_team"),
	}
	where := []string{
		"p.organization_id = $1::uuid",
		propertyUserVisibilitySQL("$2", "$3", "$4"),
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
		where = append(where, fmt.Sprintf("(p.responsible_user_id = $%d::uuid or p.created_by = $%d::uuid)", index, index))
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
	return `(
		` + canViewAllPlaceholder + `::boolean
		or p.responsible_user_id = ` + userIDPlaceholder + `::uuid
		or p.created_by = ` + userIDPlaceholder + `::uuid
		or (
			` + canViewTeamPlaceholder + `::boolean
			and exists (
				select 1
				from public.team_members leader
				join public.team_members member
				  on member.organization_id = leader.organization_id
				 and member.team_id = leader.team_id
				 and member.is_active = true
				where leader.organization_id = p.organization_id
				  and leader.user_id = ` + userIDPlaceholder + `::uuid
				  and leader.is_active = true
				  and leader.is_leader = true
				  and (member.user_id = p.responsible_user_id or member.user_id = p.created_by)
			)
		)
	)`
}

func eventUserVisibilitySQL(canViewAllPlaceholder string, userIDPlaceholder string, canViewTeamPlaceholder string) string {
	return `(
		` + canViewAllPlaceholder + `::boolean
		or se.user_id = ` + userIDPlaceholder + `::uuid
		or (
			` + canViewTeamPlaceholder + `::boolean
			and se.user_id is not null
			and exists (
				select 1
				from public.team_members leader
				join public.team_members member
				  on member.organization_id = leader.organization_id
				 and member.team_id = leader.team_id
				 and member.is_active = true
				where leader.organization_id = se.organization_id
				  and leader.user_id = ` + userIDPlaceholder + `::uuid
				  and leader.is_active = true
				  and leader.is_leader = true
				  and member.user_id = se.user_id
			)
		)
	)`
}

func dashboardNeedsLeadSubquery(filter DashboardFilter) bool {
	return (filter.Source != "" && filter.Source != "all") ||
		(filter.CampaignID != "" && filter.CampaignID != "all") ||
		(filter.AdSetID != "" && filter.AdSetID != "all") ||
		(filter.AdID != "" && filter.AdID != "all") ||
		(filter.TagID != "" && filter.TagID != "all") ||
		(filter.DealStatus != "" && filter.DealStatus != "all") ||
		strings.TrimSpace(filter.SearchQuery) != ""
}

func dashboardDateRange(filter DashboardFilter) (time.Time, time.Time) {
	now := time.Now().UTC()
	to := now
	from := now.AddDate(0, 0, -29)
	if filter.DateFrom != nil {
		from = *filter.DateFrom
	}
	if filter.DateTo != nil {
		to = *filter.DateTo
	}
	if to.Before(from) {
		from, to = to, from
	}

	return from, to
}

func filterWithDateRange(filter DashboardFilter, from time.Time, to time.Time) DashboardFilter {
	filter.DateFrom = &from
	filter.DateTo = &to
	return filter
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

func buildDealsEvolutionPoints(leads []dashboardEvolutionLead, from time.Time, to time.Time) []DealsEvolutionPoint {
	intervals, labels := dashboardEvolutionIntervals(from, to)
	result := make([]DealsEvolutionPoint, 0, len(intervals))
	for index, start := range intervals {
		end := to
		if index < len(intervals)-1 {
			end = intervals[index+1]
		}

		point := DealsEvolutionPoint{Date: labels[index]}
		for _, lead := range leads {
			switch lead.DealStatus {
			case "won":
				if lead.WonAt != nil && dateInRange(*lead.WonAt, start, end) {
					point.Ganhos++
				}
			case "lost":
				lostDate := lead.CreatedAt
				if lead.LostAt != nil {
					lostDate = *lead.LostAt
				}
				if dateInRange(lostDate, start, end) {
					point.Perdas++
				}
			default:
				if dateInRange(lead.CreatedAt, start, end) {
					point.Abertos++
				}
			}
		}
		result = append(result, point)
	}

	return result
}

func dashboardEvolutionIntervals(from time.Time, to time.Time) ([]time.Time, []string) {
	if sameDashboardDay(from, to) {
		start := startOfDashboardDay(from)
		intervals := make([]time.Time, 0, 24)
		labels := make([]string, 0, 24)
		for hour := 0; hour < 24; hour++ {
			current := start.Add(time.Duration(hour) * time.Hour)
			intervals = append(intervals, current)
			labels = append(labels, current.Format("15:04"))
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
		return intervals, labels
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
	if len(intervals) <= 12 {
		return intervals, labels
	}
	step := int(math.Ceil(float64(len(intervals)) / 12))
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

func dateInRange(value time.Time, start time.Time, end time.Time) bool {
	return !value.Before(start) && value.Before(end)
}

func sameDashboardDay(left time.Time, right time.Time) bool {
	return left.Year() == right.Year() && left.YearDay() == right.YearDay()
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
