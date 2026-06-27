package analytics

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db *dbpkg.Postgres
}

func NewRepository(db *dbpkg.Postgres) Repository {
	return Repository{db: db}
}

func (repo Repository) MetaInsights(ctx context.Context, tenantContext tenant.Context, values url.Values) ([]map[string]any, error) {
	return repo.queryJSONRows(ctx, `
		select to_jsonb(mi)
		from public.meta_campaign_insights mi
		where mi.organization_id = $1::uuid
		  and ($2 = '' or mi.date_start >= nullif($2, '')::date)
		  and ($3 = '' or mi.date_stop <= nullif($3, '')::date)
		  and ($4 = '' or mi.campaign_id = $4)
		  and ($5 = '' or mi.adset_id = $5)
		  and ($6 = '' or mi.ad_id = $6)
		order by mi.date_start desc
		limit 2000
	`, tenantContext.OrganizationID, dateOnly(values, "dateFrom"), dateOnly(values, "dateTo"), values.Get("campaignId"), values.Get("adSetId"), values.Get("adId"))
}

func (repo Repository) CampaignInsights(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
	return repo.queryJSONObject(ctx, `
		with insights as (
			select *
			from public.meta_campaign_insights mi
			where mi.organization_id = $1::uuid
			  and ($2 = '' or mi.date_start >= nullif($2, '')::date)
			  and ($3 = '' or mi.date_stop <= nullif($3, '')::date)
		),
		campaigns as (
			select
				coalesce(campaign_id, 'unknown') as campaign_id,
				coalesce(max(campaign_name), 'Campanha') as campaign_name,
				sum(coalesce(spend, 0)) as spend,
				sum(coalesce(impressions, 0)) as impressions,
				sum(coalesce(reach, 0)) as reach,
				sum(coalesce(leads_count, 0)) as leads_count,
				sum(coalesce(conversations_count, 0)) as conversations_count,
				avg(cpl) as cpl,
				avg(ctr) as ctr,
				avg(hook_rate) as hook_rate,
				max(status) as status,
				max(budget) as budget,
				max(budget_type) as budget_type,
				max(objective) as objective
			from insights
			where level = 'campaign'
			group by coalesce(campaign_id, 'unknown')
		),
		ads as (
			select
				coalesce(ad_id, 'unknown') as ad_id,
				coalesce(max(ad_name), 'Anuncio') as ad_name,
				coalesce(max(campaign_name), 'Campanha') as campaign_name,
				sum(coalesce(spend, 0)) as spend,
				sum(coalesce(impressions, 0)) as impressions,
				sum(coalesce(reach, 0)) as reach,
				sum(coalesce(leads_count, 0)) as leads_count,
				0 as won_count,
				0 as revenue,
				avg(cpl) as cpl,
				avg(ctr) as ctr,
				avg(hook_rate) as hook_rate,
				max(creative_url) as creative_url,
				max(creative_video_url) as creative_video_url,
				max(creative_permalink_url) as creative_permalink_url
			from insights
			where level = 'ad'
			group by coalesce(ad_id, 'unknown')
		),
		daily as (
			select
				date_start::text as date,
				sum(coalesce(leads_count, 0))::int as leads,
				sum(coalesce(conversations_count, 0))::int as conversations
			from insights
			group by date_start
			order by date_start
		)
		select jsonb_build_object(
			'campaigns', coalesce((
				select jsonb_agg(jsonb_build_object(
					'campaign_id', campaign_id,
					'campaign_name', campaign_name,
					'spend', spend,
					'impressions', impressions,
					'reach', reach,
					'leads_count', leads_count,
					'conversations_count', conversations_count,
					'won_count', 0,
					'revenue', 0,
					'cpl', cpl,
					'ctr', ctr,
					'hook_rate', hook_rate,
					'status', status,
					'budget', budget,
					'budget_type', budget_type,
					'objective', objective,
					'adsets', '[]'::jsonb
				) order by leads_count desc)
				from campaigns
			), '[]'::jsonb),
			'topCreatives', coalesce((
				select jsonb_agg(jsonb_build_object(
					'ad_id', ad_id,
					'ad_name', ad_name,
					'campaign_name', campaign_name,
					'leads_count', leads_count,
					'won_count', won_count,
					'revenue', revenue,
					'score', leads_count,
					'creative_url', creative_url,
					'creative_video_url', creative_video_url,
					'creative_permalink_url', creative_permalink_url,
					'spend', spend,
					'cpl', cpl,
					'ctr', ctr,
					'hook_rate', hook_rate
				) order by leads_count desc)
				from ads
			), '[]'::jsonb),
			'dailyData', coalesce((
				select jsonb_agg(jsonb_build_object(
					'date', date,
					'leads', leads,
					'conversations', conversations,
					'total', leads + conversations
				))
				from daily
			), '[]'::jsonb),
			'summary', jsonb_build_object(
				'totalLeads', coalesce((select sum(leads_count) from campaigns), 0),
				'totalWon', 0,
				'totalRevenue', 0,
				'totalCampaigns', coalesce((select count(*) from campaigns), 0),
				'totalAdsets', coalesce((select count(distinct adset_id) from insights where adset_id is not null), 0),
				'totalAds', coalesce((select count(distinct ad_id) from insights where ad_id is not null), 0),
				'totalSpend', coalesce((select sum(spend) from campaigns), 0),
				'avgCpl', coalesce((select avg(cpl) from campaigns), 0),
				'totalImpressions', coalesce((select sum(impressions) from campaigns), 0),
				'totalReach', coalesce((select sum(reach) from campaigns), 0),
				'conversations_count', coalesce((select sum(conversations_count) from campaigns), 0)
			),
			'lastSync', (select max(fetched_at) from insights),
			'hasSpendData', exists(select 1 from insights)
		)
	`, tenantContext.OrganizationID, dateOnly(values, "dateFrom"), dateOnly(values, "dateTo"))
}

func (repo Repository) EnterpriseKPIs(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
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
	`, tenantContext.OrganizationID, values.Get("pipelineId"))
}

func (repo Repository) SlaPerformanceByUser(ctx context.Context, tenantContext tenant.Context, values url.Values) ([]map[string]any, error) {
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
		left join public.leads l on l.assigned_user_id = u.id
		  and l.organization_id = $1::uuid
		  and ($2 = '' or l.pipeline_id = nullif($2, '')::uuid)
		  and ($3 = '' or l.created_at >= nullif($3, '')::timestamptz)
		  and ($4 = '' or l.created_at <= nullif($4, '')::timestamptz)
		where u.organization_id = $1::uuid
		  and u.is_active = true
		group by u.id, u.name
		order by count(l.id) desc
	`, tenantContext.OrganizationID, values.Get("pipelineId"), values.Get("startDate"), values.Get("endDate"))
}

func (repo Repository) TeamRanking(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
	return repo.queryJSONObject(ctx, `
		with users as (
			select id::text, name, avatar_url
			from public.users
			where organization_id = $1::uuid
			  and is_active = true
		),
		counts as (
			select assigned_user_id::text as user_id, count(*)::int as closed_count
			from public.leads
			where organization_id = $1::uuid
			  and deal_status = 'won'
			  and assigned_user_id is not null
			  and ($3 = '' or won_at >= nullif($3, '')::timestamptz)
			  and ($4 = '' or won_at <= nullif($4, '')::timestamptz)
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
	`, tenantContext.OrganizationID, tenantContext.UserID, values.Get("dateFrom"), values.Get("dateTo"))
}

func (repo Repository) VGVStats(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
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
	`, tenantContext.OrganizationID, values.Get("dateFrom"), values.Get("dateTo"), values.Get("userId"), values.Get("pipelineId"))
}

func (repo Repository) VGVByBroker(ctx context.Context, tenantContext tenant.Context, values url.Values) ([]map[string]any, error) {
	return repo.queryJSONRows(ctx, `
		select jsonb_build_object(
			'user_id', u.id::text,
			'user_name', u.name,
			'user_avatar', u.avatar_url,
			'won_count', count(l.id) filter (where l.deal_status = 'won'),
			'won_vgv', coalesce(sum(l.valor_interesse) filter (where l.deal_status = 'won'), 0),
			'open_count', count(l.id) filter (where coalesce(l.deal_status, 'open') not in ('won', 'lost')),
			'open_vgv', coalesce(sum(l.valor_interesse) filter (where coalesce(l.deal_status, 'open') not in ('won', 'lost')), 0),
			'total_commission', coalesce((select sum(c.amount) from public.commissions c where c.user_id = u.id), 0)
		)
		from public.users u
		left join public.leads l on l.assigned_user_id = u.id
		  and l.organization_id = $1::uuid
		  and ($2 = '' or l.created_at >= nullif($2, '')::timestamptz)
		  and ($3 = '' or l.created_at <= nullif($3, '')::timestamptz)
		where u.organization_id = $1::uuid
		  and u.is_active = true
		group by u.id, u.name, u.avatar_url
		order by coalesce(sum(l.valor_interesse) filter (where l.deal_status = 'won'), 0) desc
	`, tenantContext.OrganizationID, values.Get("dateFrom"), values.Get("dateTo"))
}

func (repo Repository) StageVGV(ctx context.Context, tenantContext tenant.Context, values url.Values) ([]map[string]any, error) {
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
		group by l.stage_id
	`, tenantContext.OrganizationID, values.Get("pipelineId"))
}

func (repo Repository) LeaderStats(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	return repo.queryJSONRows(ctx, `
		with leader_teams as (
			select tm.user_id, tm.team_id, u.name as user_name, t.name as team_name
			from public.team_members tm
			join public.users u on u.id = tm.user_id
			join public.teams t on t.id = tm.team_id
			where tm.organization_id = $1::uuid
			  and tm.is_leader = true
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
		left join public.team_pipelines tp on tp.team_id = lt.team_id
		left join public.leads l on l.pipeline_id = tp.pipeline_id and l.organization_id = $1::uuid
		group by lt.user_id, lt.user_name, lt.team_id, lt.team_name
	`, tenantContext.OrganizationID)
}

func (repo Repository) TeamLeaderStats(ctx context.Context, tenantContext tenant.Context, teamID string) ([]map[string]any, error) {
	return repo.queryJSONRows(ctx, `
		select jsonb_build_object(
			'userId', tm.user_id::text,
			'user', jsonb_build_object('id', u.id::text, 'name', u.name, 'avatar_url', u.avatar_url),
			'assignedLeads', (
				select count(*)
				from public.leads l
				where l.organization_id = $1::uuid
				  and l.assigned_user_id = tm.user_id
			)
		)
		from public.team_members tm
		join public.users u on u.id = tm.user_id
		where tm.organization_id = $1::uuid
		  and tm.team_id = $2::uuid
		  and tm.is_leader = true
	`, tenantContext.OrganizationID, teamID)
}

func (repo Repository) EmptyObject(ctx context.Context, value map[string]any) (map[string]any, error) {
	return value, nil
}

func (repo Repository) EmptyRows(ctx context.Context) ([]map[string]any, error) {
	return []map[string]any{}, nil
}

func (repo Repository) queryJSONRows(ctx context.Context, sql string, args ...any) ([]map[string]any, error) {
	rows, err := repo.db.Pool().Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []map[string]any{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var item map[string]any
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (repo Repository) queryJSONObject(ctx context.Context, sql string, args ...any) (map[string]any, error) {
	var raw []byte
	if err := repo.db.Pool().QueryRow(ctx, sql, args...).Scan(&raw); err != nil {
		return nil, err
	}
	var item map[string]any
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil, err
	}
	return item, nil
}

func dateOnly(values url.Values, key string) string {
	value := strings.TrimSpace(values.Get(key))
	if len(value) >= 10 {
		return value[:10]
	}
	return value
}
