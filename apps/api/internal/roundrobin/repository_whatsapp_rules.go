package roundrobin

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

func (repo Repository) validateWhatsAppMessageDistribution(ctx context.Context, q queryer, organizationID string, roundRobinID string) error {
	var state whatsappMessageDistributionState
	err := q.QueryRow(ctx, `
		select
			coalesce(round_robin.is_active, true),
			lower(btrim(coalesce(round_robin.settings->>'require_checkin', 'false'))) in ('true', '1', 'yes'),
			exists (
				select 1
				from public.round_robin_rules rule
				where rule.organization_id = round_robin.organization_id
				  and rule.round_robin_id = round_robin.id
				  and coalesce(rule.is_active, true) = true
				  and coalesce(nullif(rule.match_type, ''), rule.conditions->>'match_type', rule.name, '') = $3
				  and btrim(coalesce(nullif(rule.match_value, ''), rule.conditions->>'match_value', '')) <> ''
			),
			(
				select count(*)::int
				from public.round_robin_rules rule
				left join public.whatsapp_sessions session
				  on session.organization_id = rule.organization_id
				 and session.id = case
				   when btrim(coalesce(rule.match->>$4, rule.conditions->'match'->>$4, ''))
				     ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
				   then btrim(coalesce(rule.match->>$4, rule.conditions->'match'->>$4, ''))::uuid
				   else null
				 end
				 and session.provider = 'evolution_go'
				 and coalesce(session.is_active, true) = true
				 and lower(btrim(coalesce(session.status, ''))) not in ('deleted', 'disabled')
				where rule.organization_id = round_robin.organization_id
				  and rule.round_robin_id = round_robin.id
				  and coalesce(rule.is_active, true) = true
				  and coalesce(nullif(rule.match_type, ''), rule.conditions->>'match_type', rule.name, '') = $3
				  and btrim(coalesce(nullif(rule.match_value, ''), rule.conditions->>'match_value', '')) <> ''
				  and session.id is null
			)
		from public.round_robins round_robin
		where round_robin.organization_id = $1::uuid
		  and round_robin.id = $2::uuid
	`, organizationID, roundRobinID, whatsappMessageContainsConditionType, whatsappSessionMatchKey).Scan(
		&state.QueueActive,
		&state.RequireCheckIn,
		&state.HasActiveRule,
		&state.InvalidSessionRuleCount,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrRoundRobinNotFound
	}
	if err != nil {
		return err
	}
	return validateWhatsAppMessageDistributionState(state)
}

// Managed WhatsApp rules reuse the round_robin_rules UUID in the inbound table.
// This keeps lifecycle operations deterministic without changing the existing
// schema, and lets manual inbound rules keep their own independent UUIDs.
func (repo Repository) deleteWhatsAppInboundRule(ctx context.Context, q queryer, organizationID string, ruleID string) error {
	_, err := q.Exec(ctx, `
		delete from public.whatsapp_inbound_rules
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, organizationID, ruleID)
	return err
}

func (repo Repository) deleteWhatsAppInboundRulesForRoundRobin(ctx context.Context, q queryer, organizationID string, roundRobinID string) error {
	_, err := q.Exec(ctx, `
		delete from public.whatsapp_inbound_rules inbound_rule
		using public.round_robin_rules round_robin_rule
		where inbound_rule.organization_id = $1::uuid
		  and round_robin_rule.organization_id = $1::uuid
		  and round_robin_rule.round_robin_id = $2::uuid
		  and inbound_rule.id = round_robin_rule.id
	`, organizationID, roundRobinID)
	return err
}

func (repo Repository) syncWhatsAppInboundRules(ctx context.Context, q queryer, organizationID string, roundRobinID string) error {
	if _, err := q.Exec(ctx, `
		delete from public.whatsapp_inbound_rules inbound_rule
		using public.round_robin_rules round_robin_rule
		where inbound_rule.organization_id = $1::uuid
		  and round_robin_rule.organization_id = $1::uuid
		  and round_robin_rule.round_robin_id = $2::uuid
		  and inbound_rule.id = round_robin_rule.id
		  and (
		    coalesce(nullif(round_robin_rule.match_type, ''), round_robin_rule.conditions->>'match_type', round_robin_rule.name, '') <> $3
		    or btrim(coalesce(nullif(round_robin_rule.match_value, ''), round_robin_rule.conditions->>'match_value', '')) = ''
		    or not exists (
		      select 1
		      from public.whatsapp_sessions session
		      where session.organization_id = round_robin_rule.organization_id
		        and session.id = case
		          when btrim(coalesce(
		            round_robin_rule.match->>$4,
		            round_robin_rule.conditions->'match'->>$4,
		            ''
		          )) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
		          then btrim(coalesce(
		            round_robin_rule.match->>$4,
		            round_robin_rule.conditions->'match'->>$4,
		            ''
		          ))::uuid
		          else null
		        end
		        and session.provider = 'evolution_go'
		        and coalesce(session.is_active, true) = true
		        and lower(btrim(coalesce(session.status, ''))) not in ('deleted', 'disabled')
		    )
		  )
	`, organizationID, roundRobinID, whatsappMessageContainsConditionType, whatsappSessionMatchKey); err != nil {
		return err
	}

	if _, err := q.Exec(ctx, `
		insert into public.whatsapp_inbound_rules (
		  id,
		  organization_id,
		  session_id,
		  name,
		  priority,
		  is_active,
		  match_type,
		  match_value,
		  match_field,
		  target_round_robin_id,
		  target_team_id,
		  target_user_id,
		  target_pipeline_id,
		  target_stage_id,
		  source_label,
		  campaign_label
		)
		select
		  round_robin_rule.id,
		  round_robin.organization_id,
		  whatsapp_session.id,
		  'Distribuição: ' || round_robin.name,
		  -2000000000,
		  coalesce(round_robin.is_active, true) and coalesce(round_robin_rule.is_active, true),
		  'contains',
		  btrim(coalesce(nullif(round_robin_rule.match_value, ''), round_robin_rule.conditions->>'match_value', '')),
		  'message',
		  round_robin.id,
		  null,
		  null,
		  coalesce(round_robin.target_pipeline_id, round_robin.pipeline_id),
		  round_robin.target_stage_id,
		  null,
		  null
		from public.round_robin_rules round_robin_rule
		join public.round_robins round_robin
		  on round_robin.organization_id = round_robin_rule.organization_id
		 and round_robin.id = round_robin_rule.round_robin_id
		join public.whatsapp_sessions whatsapp_session
		  on whatsapp_session.organization_id = round_robin_rule.organization_id
		 and whatsapp_session.id = case
		   when btrim(coalesce(
		     round_robin_rule.match->>$4,
		     round_robin_rule.conditions->'match'->>$4,
		     ''
		   )) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
		   then btrim(coalesce(
		     round_robin_rule.match->>$4,
		     round_robin_rule.conditions->'match'->>$4,
		     ''
		   ))::uuid
		   else null
		 end
		 and whatsapp_session.provider = 'evolution_go'
		 and coalesce(whatsapp_session.is_active, true) = true
		 and lower(btrim(coalesce(whatsapp_session.status, ''))) not in ('deleted', 'disabled')
		where round_robin_rule.organization_id = $1::uuid
		  and round_robin_rule.round_robin_id = $2::uuid
		  and coalesce(nullif(round_robin_rule.match_type, ''), round_robin_rule.conditions->>'match_type', round_robin_rule.name, '') = $3
		  and btrim(coalesce(nullif(round_robin_rule.match_value, ''), round_robin_rule.conditions->>'match_value', '')) <> ''
		on conflict (id) do update set
		  session_id = excluded.session_id,
		  name = excluded.name,
		  priority = excluded.priority,
		  is_active = excluded.is_active,
		  match_type = excluded.match_type,
		  match_value = excluded.match_value,
		  match_field = excluded.match_field,
		  target_round_robin_id = excluded.target_round_robin_id,
		  target_team_id = excluded.target_team_id,
		  target_user_id = excluded.target_user_id,
		  target_pipeline_id = excluded.target_pipeline_id,
		  target_stage_id = excluded.target_stage_id,
		  source_label = excluded.source_label,
		  campaign_label = excluded.campaign_label,
		  updated_at = now()
		where whatsapp_inbound_rules.organization_id = excluded.organization_id
	`, organizationID, roundRobinID, whatsappMessageContainsConditionType, whatsappSessionMatchKey); err != nil {
		return err
	}

	// Both webhook runtimes sort inbound rules by priority, but they use
	// different tie-breakers. Keep managed rules in a reserved negative range
	// so explicit/manual inbound rules retain precedence, and give every
	// managed rule a deterministic unique priority within that range.
	_, err := q.Exec(ctx, `
		with ranked_managed_rules as (
			select
			  inbound_rule.id,
			  row_number() over (
			    partition by inbound_rule.session_id
			    order by
			      char_length(inbound_rule.match_value) desc,
			      lower(inbound_rule.match_value) asc,
			      inbound_rule.id asc
			  ) as managed_rank
			from public.whatsapp_inbound_rules inbound_rule
			join public.round_robin_rules round_robin_rule
			  on round_robin_rule.organization_id = inbound_rule.organization_id
			 and round_robin_rule.id = inbound_rule.id
			where inbound_rule.organization_id = $1::uuid
			  and coalesce(nullif(round_robin_rule.match_type, ''), round_robin_rule.conditions->>'match_type', round_robin_rule.name, '') = $2
		)
		update public.whatsapp_inbound_rules inbound_rule
		set priority = -1000000000 - ranked_managed_rules.managed_rank::int,
		    updated_at = now()
		from ranked_managed_rules
		where inbound_rule.organization_id = $1::uuid
		  and inbound_rule.id = ranked_managed_rules.id
	`, organizationID, whatsappMessageContainsConditionType)
	return err
}
