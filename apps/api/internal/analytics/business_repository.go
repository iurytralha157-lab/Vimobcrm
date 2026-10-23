package analytics

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/financial"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) EnterpriseKPIs(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
	if !financial.CanReadDashboardFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	return repo.queryJSONObject(ctx, `
		with entries as (
			select amount, type
			from public.financial_entries fe
			where fe.organization_id = $1::uuid
			  and fe.status = 'paid'
			  and ($2 = '' or coalesce(fe.paid_date, fe.due_date)::date >= nullif($2, '')::date)
			  and ($3 = '' or coalesce(fe.paid_date, fe.due_date)::date <= nullif($3, '')::date)
		),
		totals as (
			select
				coalesce(sum(amount) filter (where type in ('revenue', 'receivable')), 0) as revenue,
				coalesce(sum(amount) filter (where type in ('expense', 'payable')), 0) as expense
			from entries
		)
		select jsonb_build_object(
			'financial', jsonb_build_object(
				'ebitda', revenue - expense,
				'revenue', revenue,
				'expense', expense,
				'roi_overview', case when expense > 0 then (revenue - expense) / expense else 0 end
			)
		)
		from totals
	`, tenantContext.OrganizationID, dateOnly(values, "dateFrom"), dateOnly(values, "dateTo"))
}

func (repo Repository) DREExecutive(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
	if !financial.CanReadDashboardFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	startDate := dateOnly(values, "startDate")
	endDate := dateOnly(values, "endDate")
	dateField := "due_date"
	if strings.TrimSpace(values.Get("regime")) == "cash" {
		dateField = "paid_date"
	}
	return repo.queryJSONObject(ctx, `
		with entries as (
			select amount, type, category_group
			from public.financial_entries fe
			where fe.organization_id = $1::uuid
			  and fe.status in ('pending', 'paid', 'overdue')
			  and ($2 = '' or coalesce(fe.`+dateField+`, fe.due_date)::date >= nullif($2, '')::date)
			  and ($3 = '' or coalesce(fe.`+dateField+`, fe.due_date)::date <= nullif($3, '')::date)
		),
		t as (
			select
				coalesce(sum(amount) filter (where type in ('receivable', 'revenue') or category_group = 'gross_revenue'), 0) as gross_revenue,
				coalesce(sum(amount) filter (where category_group = 'tax_deduction'), 0) as taxes,
				coalesce(sum(amount) filter (where category_group = 'variable_cost'), 0) as variable_costs,
				coalesce(sum(amount) filter (where type in ('payable', 'expense') and coalesce(category_group, '') <> 'variable_cost'), 0) as fixed_costs
			from entries
		)
		select jsonb_build_object(
			'period', jsonb_build_object('start', $2, 'end', $3),
			'lines', jsonb_build_array(
				jsonb_build_object('id', 'gross_rev', 'name', '(+) Receita Bruta', 'value', gross_revenue, 'isTotal', false, 'type', 'revenue', 'level', 0),
				jsonb_build_object('id', 'taxes', 'name', '(-) Deducoes e Impostos', 'value', taxes, 'isTotal', false, 'type', 'tax', 'level', 1),
				jsonb_build_object('id', 'net_rev', 'name', '(=) Receita Liquida', 'value', gross_revenue - taxes, 'isTotal', true, 'type', 'total', 'level', 0),
				jsonb_build_object('id', 'var_costs', 'name', '(-) Custos Variaveis', 'value', variable_costs, 'isTotal', false, 'type', 'expense', 'level', 1),
				jsonb_build_object('id', 'gross_profit', 'name', '(=) Lucro Bruto', 'value', gross_revenue - taxes - variable_costs, 'isTotal', true, 'type', 'total', 'level', 0),
				jsonb_build_object('id', 'fixed_costs', 'name', '(-) Custos Fixos', 'value', fixed_costs, 'isTotal', false, 'type', 'expense', 'level', 1),
				jsonb_build_object('id', 'ebitda', 'name', '(=) EBITDA', 'value', gross_revenue - taxes - variable_costs - fixed_costs, 'isTotal', true, 'type', 'total', 'level', 0),
				jsonb_build_object('id', 'net_result', 'name', '(=) Lucro Liquido', 'value', gross_revenue - taxes - variable_costs - fixed_costs, 'isTotal', true, 'type', 'total', 'level', 0)
			),
			'totals', jsonb_build_object(
				'grossRevenue', gross_revenue,
				'netRevenue', gross_revenue - taxes,
				'grossProfit', gross_revenue - taxes - variable_costs,
				'operatingResult', gross_revenue - taxes - variable_costs - fixed_costs,
				'netResult', gross_revenue - taxes - variable_costs - fixed_costs,
				'ebitda', gross_revenue - taxes - variable_costs - fixed_costs,
				'roi', case when variable_costs + fixed_costs > 0 then (gross_revenue - taxes - variable_costs - fixed_costs) / (variable_costs + fixed_costs) else 0 end,
				'fixedCosts', fixed_costs,
				'variableCosts', variable_costs
			)
		)
		from t
	`, tenantContext.OrganizationID, startDate, endDate)
}

func (repo Repository) SlaSummary(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
	scope := newBusinessAnalyticsScope(tenantContext, tenantContext.OrganizationID, values.Get("pipelineId"))
	return repo.queryJSONObject(ctx, `
		select jsonb_build_object(
			'totalPending', count(*),
			'totalWarning', 0,
			'totalOverdue', 0,
			'avgResponseTime', avg(first_response_seconds),
			'slaComplianceRate', null
		)
		from public.leads l
		where l.organization_id = $1::uuid
		  and ($2 = '' or l.pipeline_id = nullif($2, '')::uuid)
		  and `+scope.leads+`
	`, scope.args...)
}

func (repo Repository) SlaPerformanceByUser(ctx context.Context, tenantContext tenant.Context, values url.Values) ([]map[string]any, error) {
	scope := newBusinessAnalyticsScope(tenantContext, tenantContext.OrganizationID, values.Get("pipelineId"), values.Get("startDate"), values.Get("endDate"))
	scope.restrictUsers(tenantContext)
	return repo.queryJSONRows(ctx, `
		select jsonb_build_object(
			'user_id', u.id::text,
			'user_name', u.name,
			'total_leads', count(l.id),
			'responded_in_time', 0,
			'responded_late', 0,
			'pending_response', count(l.id) filter (where l.first_response_at is null),
			'overdue_count', 0,
			'avg_response_seconds', avg(l.first_response_seconds),
			'avg_first_touch_seconds', avg(l.first_touch_seconds),
			'sla_compliance_rate', null
		)
		from public.users u
		join public.organization_members om
		  on om.user_id = u.id
		 and om.organization_id = $1::uuid
		left join public.leads l on l.assigned_user_id = u.id
		  and l.organization_id = $1::uuid
		  and ($2 = '' or l.pipeline_id = nullif($2, '')::uuid)
		  and ($3 = '' or l.created_at >= nullif($3, '')::timestamptz)
		  and ($4 = '' or l.created_at <= nullif($4, '')::timestamptz)
		  and `+scope.leads+`
		where coalesce(u.is_active, false) = true
		  and coalesce(om.is_active, false) = true
		  and om.deleted_at is null
		  and `+scope.users+`
		group by u.id, u.name
		order by count(l.id) desc
	`, scope.args...)
}

func (repo Repository) TeamRanking(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
	scope := newBusinessAnalyticsScope(tenantContext, tenantContext.OrganizationID, tenantContext.UserID, values.Get("dateFrom"), values.Get("dateTo"))
	scope.restrictUsers(tenantContext)
	return repo.queryJSONObject(ctx, `
		with users as (
			select u.id::text, u.name, u.avatar_url
			from public.users u
			join public.organization_members om
			  on om.user_id = u.id
			 and om.organization_id = $1::uuid
			where coalesce(u.is_active, false) = true
			  and coalesce(om.is_active, false) = true
			  and om.deleted_at is null
			  and `+scope.users+`
		),
		counts as (
			select assigned_user_id::text as user_id, count(*)::int as closed_count
			from public.leads l
			where organization_id = $1::uuid
			  and deal_status = 'won'
			  and assigned_user_id is not null
			  and ($3 = '' or won_at >= nullif($3, '')::timestamptz)
			  and ($4 = '' or won_at <= nullif($4, '')::timestamptz)
			  and `+scope.leads+`
			group by assigned_user_id
		),
		ranking as (
			select
				u.id,
				u.name,
				u.avatar_url,
				coalesce(c.closed_count, 0) as closed_count,
				row_number() over (order by coalesce(c.closed_count, 0) desc, u.name asc) as position
			from users u
			left join counts c on c.user_id = u.id
		)
		select jsonb_build_object(
			'ranking', coalesce(jsonb_agg(jsonb_build_object(
				'userId', id,
				'userName', name,
				'avatarUrl', avatar_url,
				'closedCount', closed_count,
				'position', position,
				'isCurrentUser', id = $2
			) order by position), '[]'::jsonb),
			'myPosition', (select position from ranking where id = $2)
		)
		from ranking
	`, scope.args...)
}

func (repo Repository) VGVStats(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
	scope := newBusinessAnalyticsScope(tenantContext, tenantContext.OrganizationID, values.Get("dateFrom"), values.Get("dateTo"), values.Get("userId"), values.Get("pipelineId"))
	return repo.queryJSONObject(ctx, `
		select jsonb_build_object(
			'totalVGV', coalesce(sum(valor_interesse), 0),
			'wonVGV', coalesce(sum(valor_interesse) filter (where deal_status = 'won'), 0),
			'openVGV', coalesce(sum(valor_interesse) filter (where coalesce(deal_status, 'open') not in ('won', 'lost')), 0),
			'lostVGV', coalesce(sum(valor_interesse) filter (where deal_status = 'lost'), 0),
			'totalLeads', count(*),
			'wonLeads', count(*) filter (where deal_status = 'won'),
			'openLeads', count(*) filter (where coalesce(deal_status, 'open') not in ('won', 'lost')),
			'lostLeads', count(*) filter (where deal_status = 'lost')
		)
		from public.leads l
		where l.organization_id = $1::uuid
		  and ($2 = '' or l.created_at >= nullif($2, '')::timestamptz)
		  and ($3 = '' or l.created_at <= nullif($3, '')::timestamptz)
		  and ($4 = '' or l.assigned_user_id = nullif($4, '')::uuid)
		  and ($5 = '' or l.pipeline_id = nullif($5, '')::uuid)
		  and `+scope.leads+`
	`, scope.args...)
}

func (repo Repository) VGVByBroker(ctx context.Context, tenantContext tenant.Context, values url.Values) ([]map[string]any, error) {
	scope := newBusinessAnalyticsScope(tenantContext, tenantContext.OrganizationID, values.Get("dateFrom"), values.Get("dateTo"))
	scope.restrictUsers(tenantContext)
	financialRead := fmt.Sprintf("$%d", len(scope.args)+1)
	financialManage := fmt.Sprintf("$%d", len(scope.args)+2)
	commissionOwner := fmt.Sprintf("$%d", len(scope.args)+3)
	scope.args = append(scope.args, financial.CanReadDashboardFinancial(tenantContext), financial.CanManageDashboardFinancial(tenantContext), tenantContext.UserID)
	return repo.queryJSONRows(ctx, `
		with visible_leads as (
			select l.* from public.leads l
			where l.organization_id = $1::uuid
			  and ($2 = '' or l.created_at >= nullif($2, '')::timestamptz)
			  and ($3 = '' or l.created_at <= nullif($3, '')::timestamptz)
			  and `+scope.leads+`
		)
		select jsonb_build_object(
			'user_id', u.id::text,
			'user_name', u.name,
			'user_avatar', u.avatar_url,
			'won_count', count(l.id) filter (where l.deal_status = 'won'),
			'won_vgv', coalesce(sum(l.valor_interesse) filter (where l.deal_status = 'won'), 0),
			'open_count', count(l.id) filter (where coalesce(l.deal_status, 'open') not in ('won', 'lost')),
			'open_vgv', coalesce(sum(l.valor_interesse) filter (where coalesce(l.deal_status, 'open') not in ('won', 'lost')), 0),
			'total_commission', case when `+financialRead+`::boolean
			  and (`+financialManage+`::boolean or u.id = `+commissionOwner+`::uuid) then coalesce((
				select sum(coalesce(c.amount, c.calculated_value))
				from public.commissions c
				join visible_leads commission_lead on commission_lead.id = c.lead_id
				where c.user_id = u.id
				  and c.organization_id = $1::uuid
				  and lower(coalesce(c.status, '')) not in ('cancelled', 'cancelada')
			), 0) else null end
		)
		from public.users u
		join public.organization_members om
		  on om.user_id = u.id
		 and om.organization_id = $1::uuid
		left join visible_leads l on l.assigned_user_id = u.id
		where coalesce(u.is_active, false) = true
		  and coalesce(om.is_active, false) = true
		  and om.deleted_at is null
		  and `+scope.users+`
		group by u.id, u.name, u.avatar_url
		order by coalesce(sum(l.valor_interesse) filter (where l.deal_status = 'won'), 0) desc
	`, scope.args...)
}

func (repo Repository) StageVGV(ctx context.Context, tenantContext tenant.Context, values url.Values) ([]map[string]any, error) {
	scope := newBusinessAnalyticsScope(tenantContext, tenantContext.OrganizationID, values.Get("pipelineId"))
	return repo.queryJSONRows(ctx, `
		select jsonb_build_object(
			'stageId', l.stage_id::text,
			'totalVGV', coalesce(sum(l.valor_interesse), 0),
			'openVGV', coalesce(sum(l.valor_interesse) filter (where coalesce(l.deal_status, 'open') not in ('won', 'lost')), 0),
			'wonVGV', coalesce(sum(l.valor_interesse) filter (where l.deal_status = 'won'), 0),
			'leadsCount', count(*)
		)
		from public.leads l
		where l.organization_id = $1::uuid
		  and ($2 = '' or l.pipeline_id = nullif($2, '')::uuid)
		  and l.stage_id is not null
		  and `+scope.leads+`
		group by l.stage_id
	`, scope.args...)
}

func (repo Repository) LeaderStats(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	scope := newBusinessAnalyticsScope(tenantContext, tenantContext.OrganizationID)
	scope.restrictTeams()
	return repo.queryJSONRows(ctx, `
		with leader_teams as (
			select tm.user_id, tm.team_id, u.name as user_name, t.name as team_name
			from public.team_members tm
			join public.users u on u.id = tm.user_id and coalesce(u.is_active, false) = true
			join public.teams t on t.id = tm.team_id and t.organization_id = tm.organization_id
			join public.organization_members om on om.organization_id = tm.organization_id
			  and om.user_id = tm.user_id and om.is_active = true and om.deleted_at is null
			  and om.membership_generation = tm.membership_generation
			where tm.organization_id = $1::uuid
			  and tm.is_active = true
			  and tm.is_leader = true
			  and coalesce(t.is_active, true) = true
			  and `+scope.teams+`
		)
		select jsonb_build_object(
			'userId', lt.user_id::text,
			'userName', lt.user_name,
			'teamId', lt.team_id::text,
			'teamName', lt.team_name,
			'totalLeads', count(l.id),
			'convertedLeads', count(l.id) filter (where l.deal_status = 'won'),
			'conversionRate', case when count(l.id) > 0 then round((count(l.id) filter (where l.deal_status = 'won'))::numeric * 100 / count(l.id), 0) else 0 end,
			'avgTimeInStage', null
		)
		from leader_teams lt
		left join public.team_pipelines tp on tp.team_id = lt.team_id and tp.organization_id = $1::uuid
		left join public.leads l on l.pipeline_id = tp.pipeline_id and l.organization_id = $1::uuid
		  and `+scope.leads+`
		group by lt.user_id, lt.user_name, lt.team_id, lt.team_name
	`, scope.args...)
}

func (repo Repository) TeamLeaderStats(ctx context.Context, tenantContext tenant.Context, teamID string) ([]map[string]any, error) {
	scope := newBusinessAnalyticsScope(tenantContext, tenantContext.OrganizationID, teamID)
	scope.restrictTeams()
	return repo.queryJSONRows(ctx, `
		select jsonb_build_object(
			'userId', tm.user_id::text,
			'user', jsonb_build_object('id', u.id::text, 'name', u.name, 'avatar_url', u.avatar_url),
			'assignedLeads', (
				select count(*)
				from public.leads l
				where l.organization_id = $1::uuid
				  and l.assigned_user_id = tm.user_id
				  and `+scope.leads+`
			)
		)
		from public.team_members tm
		join public.users u on u.id = tm.user_id and coalesce(u.is_active, false) = true
		join public.teams t on t.id = tm.team_id and t.organization_id = tm.organization_id
		join public.organization_members om on om.organization_id = tm.organization_id
		  and om.user_id = tm.user_id and om.is_active = true and om.deleted_at is null
		  and om.membership_generation = tm.membership_generation
		where tm.organization_id = $1::uuid
		  and tm.team_id = $2::uuid
		  and tm.is_active = true
		  and tm.is_leader = true
		  and coalesce(t.is_active, true) = true
		  and `+scope.teams+`
	`, scope.args...)
}
