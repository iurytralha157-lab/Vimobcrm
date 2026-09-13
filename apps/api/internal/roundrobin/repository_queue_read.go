package roundrobin

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) List(ctx context.Context, tenantContext tenant.Context) ([]RoundRobin, error) {
	args := []any{tenantContext.OrganizationID}
	where := []string{"rr.organization_id = $1::uuid"}
	if !canManageRoundRobins(tenantContext) {
		if !tenantContext.IsTeamLeader {
			return []RoundRobin{}, nil
		}
		where = append(where, leadershipRoundRobinCondition(tenantContext, "rr", &args))
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			rr.id::text,
			rr.organization_id::text,
			rr.name,
			coalesce(rr.is_active, true),
			coalesce(latest_log.current_position, rr.current_position, 0),
			coalesce(rr.target_pipeline_id, rr.pipeline_id)::text,
			(
			  coalesce(rr.rules, '{}'::jsonb)
			  || jsonb_strip_nulls(jsonb_build_object(
			    'strategy', coalesce(nullif(rr.strategy, ''), rr.rules->>'strategy', 'simple'),
			    'target_stage_id', coalesce(rr.target_stage_id::text, rr.rules->>'target_stage_id'),
			    'settings', coalesce(rr.settings, rr.rules->'settings', '{}'::jsonb),
			    'reentry_behavior', coalesce(nullif(rr.reentry_behavior, ''), rr.rules->>'reentry_behavior', 'redistribute')
			  ))
			)::text,
			rr.created_by::text,
			rr.created_at,
			rr.updated_at,
			p.id::text,
			p.name,
			s.id::text,
			s.name,
			s.color,
			creator.id::text,
			creator.name,
			creator.email,
			coalesce(logs.total, 0)
		from public.round_robins rr
		left join public.pipelines p
		  on p.organization_id = rr.organization_id
		 and p.id = coalesce(rr.target_pipeline_id, rr.pipeline_id)
		left join public.stages s
		  on s.organization_id = rr.organization_id
		 and s.id = coalesce(rr.target_stage_id,
		   case when coalesce(rr.rules->>'target_stage_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
		     then (rr.rules->>'target_stage_id')::uuid else null end)
		left join public.users creator
		  on creator.id = rr.created_by
		left join lateral (
			select
			  case
			    when coalesce(latest.metadata->>'candidate_position', '') ~ '^[0-9]+$' then
			      case
			        when (latest.metadata->>'candidate_position')::numeric <= 2147483647
			          then (latest.metadata->>'candidate_position')::integer
			      end
			  end as current_position
			from public.round_robin_logs latest
			where latest.organization_id = rr.organization_id
			  and latest.round_robin_id = rr.id
			  and latest.reason = 'canonical_round_robin'
			order by latest.created_at desc, latest.id desc
			limit 1
		) latest_log on true
		left join lateral (
			select count(*)::bigint as total
			from public.round_robin_logs rrl
			where rrl.organization_id = rr.organization_id
			  and rrl.round_robin_id = rr.id
		) logs on true
		where `+strings.Join(where, " and ")+`
		order by rr.created_at desc, rr.id desc
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []RoundRobin{}
	for rows.Next() {
		item, err := scanRoundRobin(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rules, err := repo.listRules(ctx, tenantContext.OrganizationID, nil)
	if err != nil {
		return nil, err
	}
	metaFormLinkRules, err := repo.listMetaFormLinkRules(ctx, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	rules = mergeMissingMetaFormLinkRules(rules, metaFormLinkRules)
	members, err := repo.listMembers(ctx, tenantContext.OrganizationID, nil)
	if err != nil {
		return nil, err
	}

	rulesByRoundRobin := map[string][]Rule{}
	for _, rule := range rules {
		rulesByRoundRobin[rule.RoundRobinID] = append(rulesByRoundRobin[rule.RoundRobinID], rule)
	}

	membersByRoundRobin := map[string][]Member{}
	for _, member := range members {
		membersByRoundRobin[member.RoundRobinID] = append(membersByRoundRobin[member.RoundRobinID], member)
	}

	for index := range items {
		items[index].Rules = rulesByRoundRobin[items[index].ID]
		if items[index].Rules == nil {
			items[index].Rules = []Rule{}
		}
		items[index].Members = membersByRoundRobin[items[index].ID]
		if items[index].Members == nil {
			items[index].Members = []Member{}
		}
	}

	return items, nil
}

func (repo Repository) Get(ctx context.Context, tenantContext tenant.Context, roundRobinID string) (RoundRobin, error) {
	roundRobinID, ok := normalizeUUID(roundRobinID)
	if !ok {
		return RoundRobin{}, ErrRoundRobinNotFound
	}
	if err := repo.ensureRoundRobinVisible(ctx, repo.db.Pool(), tenantContext, roundRobinID); err != nil {
		return RoundRobin{}, err
	}

	item, err := scanRoundRobin(repo.db.Pool().QueryRow(ctx, `
		select
			rr.id::text,
			rr.organization_id::text,
			rr.name,
			coalesce(rr.is_active, true),
			coalesce(latest_log.current_position, rr.current_position, 0),
			coalesce(rr.target_pipeline_id, rr.pipeline_id)::text,
			(
			  coalesce(rr.rules, '{}'::jsonb)
			  || jsonb_strip_nulls(jsonb_build_object(
			    'strategy', coalesce(nullif(rr.strategy, ''), rr.rules->>'strategy', 'simple'),
			    'target_stage_id', coalesce(rr.target_stage_id::text, rr.rules->>'target_stage_id'),
			    'settings', coalesce(rr.settings, rr.rules->'settings', '{}'::jsonb),
			    'reentry_behavior', coalesce(nullif(rr.reentry_behavior, ''), rr.rules->>'reentry_behavior', 'redistribute')
			  ))
			)::text,
			rr.created_by::text,
			rr.created_at,
			rr.updated_at,
			p.id::text,
			p.name,
			s.id::text,
			s.name,
			s.color,
			creator.id::text,
			creator.name,
			creator.email,
			coalesce(logs.total, 0)
		from public.round_robins rr
		left join public.pipelines p
		  on p.organization_id = rr.organization_id
		 and p.id = coalesce(rr.target_pipeline_id, rr.pipeline_id)
		left join public.stages s
		  on s.organization_id = rr.organization_id
		 and s.id = coalesce(rr.target_stage_id,
		   case when coalesce(rr.rules->>'target_stage_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
		     then (rr.rules->>'target_stage_id')::uuid else null end)
		left join public.users creator
		  on creator.id = rr.created_by
		left join lateral (
			select
			  case
			    when coalesce(latest.metadata->>'candidate_position', '') ~ '^[0-9]+$' then
			      case
			        when (latest.metadata->>'candidate_position')::numeric <= 2147483647
			          then (latest.metadata->>'candidate_position')::integer
			      end
			  end as current_position
			from public.round_robin_logs latest
			where latest.organization_id = rr.organization_id
			  and latest.round_robin_id = rr.id
			  and latest.reason = 'canonical_round_robin'
			order by latest.created_at desc, latest.id desc
			limit 1
		) latest_log on true
		left join lateral (
			select count(*)::bigint as total
			from public.round_robin_logs rrl
			where rrl.organization_id = rr.organization_id
			  and rrl.round_robin_id = rr.id
		) logs on true
		where rr.organization_id = $1::uuid
		  and rr.id = $2::uuid
		limit 1
	`, tenantContext.OrganizationID, roundRobinID))
	if errors.Is(err, pgx.ErrNoRows) {
		return RoundRobin{}, ErrRoundRobinNotFound
	}
	if err != nil {
		return RoundRobin{}, err
	}

	rules, err := repo.listRules(ctx, tenantContext.OrganizationID, &roundRobinID)
	if err != nil {
		return RoundRobin{}, err
	}
	metaFormLinkRules, err := repo.listMetaFormLinkRules(ctx, tenantContext.OrganizationID)
	if err != nil {
		return RoundRobin{}, err
	}
	linkedRulesForQueue := make([]Rule, 0, len(metaFormLinkRules))
	for _, rule := range metaFormLinkRules {
		if rule.RoundRobinID == roundRobinID {
			linkedRulesForQueue = append(linkedRulesForQueue, rule)
		}
	}
	rules = mergeMissingMetaFormLinkRules(rules, linkedRulesForQueue)
	members, err := repo.listMembers(ctx, tenantContext.OrganizationID, &roundRobinID)
	if err != nil {
		return RoundRobin{}, err
	}
	item.Rules = rules
	item.Members = members

	return item, nil
}
