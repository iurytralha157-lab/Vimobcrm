package leads

import (
	"context"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// GetDashboardFirstContact summarizes the same creation-date lead cohort used by
// dashboard stats. The first human response belongs to its actor, while a lead's
// current assignee is reported separately so transfers do not rewrite history.
func (repo Repository) GetDashboardFirstContact(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter) (DashboardFirstContact, error) {
	result := DashboardFirstContact{
		Brokers: []DashboardFirstContactBroker{},
		Sources: []DashboardFirstContactSource{},
	}
	if !canViewDashboardLeadDistribution(tenantContext) {
		return result, tenant.ErrOrganizationAccessDenied
	}
	where, args, err := repo.buildDashboardLeadWhere(tenantContext, filter, dashboardLeadWhereOptions{DateColumn: "created_at"})
	if err != nil {
		return DashboardFirstContact{}, err
	}

	tx, err := repo.db.Pool().BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return DashboardFirstContact{}, err
	}
	defer tx.Rollback(ctx)

	brokerIndex := map[string]int{}
	sourceIndex := map[string]int{}
	rows, err := tx.Query(ctx, dashboardFirstContactMetricsSQL(where), args...)
	if err != nil {
		return DashboardFirstContact{}, err
	}
	for rows.Next() {
		var dimension, id, name string
		var avatar pgtype.Text
		var leadCount, contactedLeads int64
		var average pgtype.Float8
		if err := rows.Scan(&dimension, &id, &name, &avatar, &leadCount, &contactedLeads, &average); err != nil {
			rows.Close()
			return DashboardFirstContact{}, err
		}
		switch dimension {
		case "total":
			result.LeadCount = leadCount
			result.ContactedLeads = contactedLeads
			result.AverageResponseSeconds = dashboardNullableAverage(average)
		case "broker":
			brokerIndex[id] = len(result.Brokers)
			result.Brokers = append(result.Brokers, DashboardFirstContactBroker{
				ID: id, Name: name, AvatarURL: pipelineTextPtr(avatar),
				LeadCount: leadCount, ContactedLeads: contactedLeads,
				AverageResponseSeconds: dashboardNullableAverage(average),
			})
		case "source":
			sourceIndex[id] = len(result.Sources)
			result.Sources = append(result.Sources, DashboardFirstContactSource{
				Source: id, LeadCount: leadCount, ContactedLeads: contactedLeads,
				AverageResponseSeconds: dashboardNullableAverage(average),
			})
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return DashboardFirstContact{}, err
	}
	rows.Close()

	redistributionRows, err := tx.Query(ctx, dashboardFirstContactRedistributionSQL(where), args...)
	if err != nil {
		return DashboardFirstContact{}, err
	}
	for redistributionRows.Next() {
		var dimension, id, name string
		var avatar pgtype.Text
		var events, distinctLeads int64
		if err := redistributionRows.Scan(&dimension, &id, &name, &avatar, &events, &distinctLeads); err != nil {
			redistributionRows.Close()
			return DashboardFirstContact{}, err
		}
		switch dimension {
		case "total":
			result.RedistributionEvents = events
			result.RedistributedLeads = distinctLeads
		case "source":
			if index, ok := sourceIndex[id]; ok {
				result.Sources[index].RedistributionEvents = events
				result.Sources[index].RedistributedLeads = distinctLeads
			}
		case "broker_away", "broker_received":
			index, ok := brokerIndex[id]
			if !ok {
				index = len(result.Brokers)
				brokerIndex[id] = index
				result.Brokers = append(result.Brokers, DashboardFirstContactBroker{
					ID: id, Name: name, AvatarURL: pipelineTextPtr(avatar),
				})
			}
			if dimension == "broker_away" {
				result.Brokers[index].RedistributedAway = distinctLeads
			} else {
				result.Brokers[index].RedistributedReceived = distinctLeads
			}
		}
	}
	if err := redistributionRows.Err(); err != nil {
		redistributionRows.Close()
		return DashboardFirstContact{}, err
	}
	redistributionRows.Close()
	if err := tx.Commit(ctx); err != nil {
		return DashboardFirstContact{}, err
	}

	sort.Slice(result.Brokers, func(i, j int) bool {
		left, right := result.Brokers[i], result.Brokers[j]
		if left.ContactedLeads != right.ContactedLeads {
			return left.ContactedLeads > right.ContactedLeads
		}
		if left.Name != right.Name {
			return left.Name < right.Name
		}
		return left.ID < right.ID
	})
	sort.Slice(result.Sources, func(i, j int) bool {
		left, right := result.Sources[i], result.Sources[j]
		if left.LeadCount != right.LeadCount {
			return left.LeadCount > right.LeadCount
		}
		return left.Source < right.Source
	})
	return result, nil
}

func dashboardNullableAverage(value pgtype.Float8) *float64 {
	if !value.Valid {
		return nil
	}
	average := value.Float64
	return &average
}

func dashboardFirstContactMetricsSQL(where []string) string {
	return `
		with cohort as (
			select l.assigned_user_id, l.first_response_actor_user_id,
				coalesce(nullif(l.source, ''), 'manual') as source,
				case when l.first_response_actor_user_id is not null
				  and coalesce(l.first_response_is_automation, false) = false
				  and l.first_response_seconds >= 0
				  then l.first_response_seconds end as response_seconds
			from public.leads l
			where ` + strings.Join(where, " and ") + `
		), assigned as (
			select assigned_user_id as user_id, count(*)::bigint as lead_count
			from cohort where assigned_user_id is not null group by assigned_user_id
		), contacted as (
			select first_response_actor_user_id as user_id,
				count(*)::bigint as contacted_leads,
				avg(response_seconds)::double precision as average_seconds
			from cohort where response_seconds is not null group by first_response_actor_user_id
		), brokers as (
			select coalesce(a.user_id, c.user_id) as user_id,
				coalesce(a.lead_count, 0)::bigint as lead_count,
				coalesce(c.contacted_leads, 0)::bigint as contacted_leads,
				c.average_seconds
			from assigned a full join contacted c on c.user_id = a.user_id
		)
		select 'total'::text, ''::text, ''::text, null::text,
			count(*)::bigint, count(response_seconds)::bigint,
			avg(response_seconds)::double precision
		from cohort
		union all
		select 'broker', b.user_id::text,
			coalesce(nullif(btrim(u.name), ''), 'Usuário indisponível'), u.avatar_url,
			b.lead_count, b.contacted_leads, b.average_seconds
		from brokers b
		left join public.users u on u.id = b.user_id and exists (
			select 1 from public.organization_members om
			where om.organization_id = $1::uuid and om.user_id = b.user_id
		)
		union all
		select 'source', c.source, ''::text, null::text,
			count(*)::bigint, count(c.response_seconds)::bigint,
			avg(c.response_seconds)::double precision
		from cohort c group by c.source
	`
}

func dashboardFirstContactRedistributionSQL(where []string) string {
	return `
		with cohort as (
			select l.id, coalesce(nullif(l.source, ''), 'manual') as source
			from public.leads l
			where ` + strings.Join(where, " and ") + `
		), events as (
			select c.id as lead_id, c.source,
				previous_user.id as from_user_id, rrl.assigned_user_id as to_user_id
			from cohort c
			join public.round_robin_logs rrl on rrl.organization_id = $1::uuid and rrl.lead_id = c.id
			  and rrl.reason = 'auto_redistribution' and rrl.assigned_user_id is not null
			join public.users previous_user on previous_user.id::text = rrl.metadata->>'previous_user_id'
			where previous_user.id <> rrl.assigned_user_id
			union all
			select c.id, c.source, h.from_user_id, h.to_user_id
			from cohort c
			join public.lead_pool_history h on h.organization_id = $1::uuid and h.lead_id = c.id
			where h.from_user_id is not null and h.to_user_id is not null
			  and h.from_user_id <> h.to_user_id
		), by_broker as (
			select 'broker_away'::text as dimension, from_user_id as user_id, lead_id from events
			union all
			select 'broker_received', to_user_id, lead_id from events
		)
		select 'total'::text, ''::text, ''::text, null::text,
			count(*)::bigint, count(distinct lead_id)::bigint from events
		union all
		select 'source', source, ''::text, null::text,
			count(*)::bigint, count(distinct lead_id)::bigint
		from events group by source
		union all
		select b.dimension, b.user_id::text,
			coalesce(nullif(btrim(u.name), ''), 'Usuário indisponível'), u.avatar_url,
			count(*)::bigint, count(distinct b.lead_id)::bigint
		from by_broker b
		left join public.users u on u.id = b.user_id and exists (
			select 1 from public.organization_members om
			where om.organization_id = $1::uuid and om.user_id = b.user_id
		)
		group by b.dimension, b.user_id, u.name, u.avatar_url
	`
}
