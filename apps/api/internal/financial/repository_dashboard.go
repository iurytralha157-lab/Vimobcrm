package financial

import (
	"context"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) Dashboard(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
	if !canReadFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	return repo.queryJSONObject(ctx, `
		with bounds as (
			select
				current_date::date as today,
				(current_date + interval '30 days')::date as days30,
				(current_date + interval '60 days')::date as days60,
				(current_date + interval '90 days')::date as days90,
				(current_date - interval '30 days')::date as last30,
				date_trunc('year', current_date)::date as year_start,
				least(date_trunc('month', current_date) - interval '5 months', date_trunc('year', current_date))::date as history_start
		),
		entries as (
			select * from public.financial_entries where organization_id = $1::uuid
		),
		pending_receivables as (
			select amount, due_date from entries where type = 'receivable' and status = 'pending'
		),
		pending_payables as (
			select amount, due_date from entries where type = 'payable' and status = 'pending'
		),
		paid_entries as (
			select amount, type, paid_date from entries, bounds where status = 'paid' and paid_date >= bounds.history_start
		),
		commission_totals as (
			select
				coalesce(sum(coalesce(amount, calculated_value)) filter (where status in ('forecast', 'prevista')), 0) as forecast,
				coalesce(sum(coalesce(amount, calculated_value)) filter (where status in ('pending', 'pendente', 'approved', 'aprovada')), 0) as pending,
				coalesce(sum(coalesce(amount, calculated_value)) filter (where status in ('paid', 'paga')), 0) as paid
			from public.commissions
			where organization_id = $1::uuid
		),
		contracts as (
			select id, value, commission_value
			from public.contracts
			where organization_id = $1::uuid
			  and status in ('active', 'signed', 'completed')
		),
		won_leads as (
			select id, valor_interesse
			from public.leads
			where organization_id = $1::uuid
			  and deal_status = 'won'
			  and coalesce(valor_interesse, 0) > 0
		),
		months as (
			select generate_series(
				date_trunc('month', (select today from bounds)) - interval '5 months',
				date_trunc('month', (select today from bounds)),
				interval '1 month'
			)::date as month_start
		),
		monthly as (
			select coalesce(jsonb_agg(jsonb_build_object(
				'month', to_char(m.month_start, 'Mon/YY'),
				'receitas', coalesce((select sum(amount) from paid_entries e where e.type = 'receivable' and date_trunc('month', e.paid_date)::date = m.month_start), 0),
				'despesas', coalesce((select sum(amount) from paid_entries e where e.type = 'payable' and date_trunc('month', e.paid_date)::date = m.month_start), 0)
			) order by m.month_start), '[]'::jsonb) as data
			from months m
		)
		select jsonb_build_object(
			'receivable30', coalesce((select sum(amount) from pending_receivables, bounds where due_date between bounds.today and bounds.days30), 0),
			'receivable60', coalesce((select sum(amount) from pending_receivables, bounds where due_date > bounds.days30 and due_date <= bounds.days60), 0),
			'receivable90', coalesce((select sum(amount) from pending_receivables, bounds where due_date > bounds.days60 and due_date <= bounds.days90), 0),
			'confirmedRevenue30', coalesce((select sum(amount) from paid_entries, bounds where type = 'receivable' and paid_date between bounds.last30 and bounds.today), 0),
			'confirmedRevenueYTD', coalesce((select sum(amount) from paid_entries, bounds where type = 'receivable' and paid_date >= bounds.year_start), 0),
			'totalPayable', coalesce((select sum(amount) from pending_payables), 0),
			'forecastCommissions', (select forecast from commission_totals),
			'pendingCommissions', (select pending from commission_totals),
			'paidCommissions', (select paid from commission_totals),
			'overdueReceivables', coalesce((select sum(amount) from pending_receivables, bounds where due_date < bounds.today), 0),
			'overduePayables', coalesce((select sum(amount) from pending_payables, bounds where due_date < bounds.today), 0),
			'monthlyData', (select data from monthly),
			'totalLeadsValue', coalesce((select sum(valor_interesse) from won_leads), 0),
			'vgvBruto', coalesce((select sum(value) from contracts), 0),
			'vgvLiquido', coalesce((select sum(value) - sum(coalesce(commission_value, 0)) from contracts), 0),
			'totalContractsValue', coalesce((select sum(value) - sum(coalesce(commission_value, 0)) from contracts), 0),
			'activeContracts', (select count(*) from contracts),
			'wonLeadsCount', (select count(*) from won_leads),
			'avgTicket', coalesce((select avg(value) from contracts), 0),
			'conversionRate', case when (select count(*) from won_leads) > 0 then ((select count(*) from contracts)::numeric / (select count(*) from won_leads)::numeric) * 100 else 0 end,
			'annualProjection', 0,
			'defaultRate', 0
		)
	`, tenantContext.OrganizationID)
}
