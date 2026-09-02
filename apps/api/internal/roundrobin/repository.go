package roundrobin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db *dbpkg.Postgres
}

type scanner interface {
	Scan(dest ...any) error
}

type queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func setAuditActor(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context) error {
	userID := strings.TrimSpace(tenantContext.UserID)
	if userID == "" {
		return nil
	}
	_, err := tx.Exec(ctx, `select set_config('app.current_user_id', $1, true)`, userID)
	return err
}

type roundRobinState struct {
	ID         string
	PipelineID *string
	Metadata   map[string]any
}

const (
	whatsappMessageContainsConditionType = "whatsapp_message_contains"
	whatsappSessionMatchKey              = "whatsapp_session_id"
	listMetaFormOptionsQuery             = `
		select
		  form_config.id::text,
		  form_config.form_id,
		  coalesce(nullif(btrim(form_config.form_name), ''), ''),
		  coalesce(nullif(btrim(meta_integration.page_id), ''), ''),
		  coalesce(nullif(btrim(meta_integration.page_name), ''), ''),
		  coalesce(form_config.round_robin_id::text, ''),
		  coalesce(form_config.is_active, true),
		  (
		    coalesce(meta_integration.is_connected, true)
		    and btrim(coalesce(meta_integration.page_id, '')) <> ''
		  )
		from public.meta_form_configs form_config
		join public.meta_integrations meta_integration
		  on meta_integration.organization_id = form_config.organization_id
		 and meta_integration.id = form_config.integration_id
		where form_config.organization_id = $1::uuid
		  and btrim(form_config.form_id) <> ''
		order by
		  (
		    coalesce(form_config.is_active, true)
		    and coalesce(meta_integration.is_connected, true)
		    and btrim(coalesce(meta_integration.page_id, '')) <> ''
		  ) desc,
		  lower(coalesce(nullif(form_config.form_name, ''), form_config.form_id)) asc,
		  form_config.form_id asc
	`
	listMetaFormLinkRulesQuery = `
		select
		  form_config.id::text,
		  form_config.round_robin_id::text,
		  form_config.form_id,
		  coalesce(form_config.is_active, true),
		  form_config.created_at,
		  form_config.updated_at
		from public.meta_form_configs form_config
		join public.round_robins round_robin
		  on round_robin.organization_id = form_config.organization_id
		 and round_robin.id = form_config.round_robin_id
		where form_config.organization_id = $1::uuid
		  and form_config.round_robin_id is not null
		  and btrim(form_config.form_id) <> ''
		order by form_config.created_at asc, form_config.id asc
	`
	lockMetaFormLinksQuery = `
		select
		  form_config.form_id,
		  coalesce(form_config.round_robin_id::text, ''),
		  coalesce(round_robin.name, '')
		from public.meta_form_configs form_config
		left join public.round_robins round_robin
		  on round_robin.organization_id = form_config.organization_id
		 and round_robin.id = form_config.round_robin_id
		where form_config.organization_id = $1::uuid
		  and form_config.form_id = any($2::text[])
		order by form_config.form_id asc
		for update of form_config
	`
)

type whatsappMessageDistributionState struct {
	QueueActive             bool
	RequireCheckIn          bool
	HasActiveRule           bool
	InvalidSessionRuleCount int
}

type metaFormLinkState struct {
	FormID       string
	RoundRobinID string
	QueueName    string
}

func validateWhatsAppMessageDistributionState(state whatsappMessageDistributionState) error {
	if !state.QueueActive || !state.HasActiveRule {
		return nil
	}

	if state.InvalidSessionRuleCount > 0 {
		return fmt.Errorf("%w: active WhatsApp message distribution requires a valid active connection", ErrInvalidInput)
	}
	if state.RequireCheckIn {
		return fmt.Errorf("%w: active WhatsApp message distribution does not support required check-in", ErrInvalidInput)
	}

	return nil
}

var uniqueConditionTypes = map[string]struct{}{
	"meta_form":                          {},
	"webhook":                            {},
	"whatsapp_session":                   {},
	whatsappMessageContainsConditionType: {},
}

func NewRepository(db *dbpkg.Postgres) Repository {
	return Repository{db: db}
}

func (repo Repository) ListWhatsAppSessionOptions(ctx context.Context, tenantContext tenant.Context) ([]WhatsAppSessionOption, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select
		  session.id::text,
		  coalesce(session.instance_name, ''),
		  coalesce(session.display_name, ''),
		  coalesce(session.phone_number, ''),
		  coalesce(session.status, ''),
		  coalesce(session.provider, ''),
		  coalesce(session.is_active, true)
		from public.whatsapp_sessions session
		where session.organization_id = $1::uuid
		  and session.provider = 'evolution_go'
		  and lower(btrim(coalesce(session.status, ''))) <> 'deleted'
		order by
		  coalesce(session.is_active, true) desc,
		  lower(coalesce(nullif(session.display_name, ''), nullif(session.phone_number, ''), session.instance_name, '')) asc,
		  session.id asc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []WhatsAppSessionOption{}
	for rows.Next() {
		var item WhatsAppSessionOption
		if err := rows.Scan(
			&item.ID,
			&item.InstanceName,
			&item.DisplayName,
			&item.PhoneNumber,
			&item.Status,
			&item.Provider,
			&item.IsActive,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (repo Repository) ListMetaFormOptions(ctx context.Context, tenantContext tenant.Context) ([]MetaFormOption, error) {
	rows, err := repo.db.Pool().Query(ctx, listMetaFormOptionsQuery, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []MetaFormOption{}
	for rows.Next() {
		var item MetaFormOption
		if err := rows.Scan(
			&item.ConfigID,
			&item.FormID,
			&item.FormName,
			&item.PageID,
			&item.PageName,
			&item.RoundRobinID,
			&item.IsActive,
			&item.IntegrationConnected,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (repo Repository) listMetaFormLinkRules(ctx context.Context, organizationID string) ([]Rule, error) {
	rows, err := repo.db.Pool().Query(ctx, listMetaFormLinkRulesQuery, organizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []Rule{}
	for rows.Next() {
		var item Rule
		if err := rows.Scan(
			&item.ID,
			&item.RoundRobinID,
			&item.MatchValue,
			&item.IsActive,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		item.MatchType = "meta_form"
		item.Match = map[string]any{"meta_form_id": []string{item.MatchValue}}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func mergeMissingMetaFormLinkRules(rules []Rule, linkedRules []Rule) []Rule {
	canonicalFormIDByQueueAndConfig := map[string]string{}
	for _, linkedRule := range linkedRules {
		canonicalFormIDByQueueAndConfig[linkedRule.RoundRobinID+"\x00"+linkedRule.ID] = linkedRule.MatchValue
	}

	existing := map[string]map[string]struct{}{}
	merged := append([]Rule(nil), rules...)
	for index, rule := range merged {
		if rule.MatchType != "meta_form" && rule.MatchType != "form" {
			continue
		}
		if existing[rule.RoundRobinID] == nil {
			existing[rule.RoundRobinID] = map[string]struct{}{}
		}
		formIDs := splitValues(rule.MatchValue)
		seen := map[string]struct{}{}
		canonicalFormIDs := make([]string, 0, len(formIDs))
		for _, formID := range formIDs {
			if canonicalFormID, ok := canonicalFormIDByQueueAndConfig[rule.RoundRobinID+"\x00"+formID]; ok {
				formID = canonicalFormID
			}
			if _, duplicate := seen[formID]; duplicate {
				continue
			}
			seen[formID] = struct{}{}
			canonicalFormIDs = append(canonicalFormIDs, formID)
			existing[rule.RoundRobinID][formID] = struct{}{}
		}
		canonicalMatchValue := strings.Join(canonicalFormIDs, ", ")
		if canonicalMatchValue != rule.MatchValue {
			merged[index].MatchValue = canonicalMatchValue
			merged[index].Match = cloneObject(rule.Match)
			merged[index].Match["meta_form_id"] = canonicalFormIDs
		}
	}

	for _, linkedRule := range linkedRules {
		if _, ok := existing[linkedRule.RoundRobinID][linkedRule.MatchValue]; ok {
			continue
		}
		if _, ok := existing[linkedRule.RoundRobinID][linkedRule.ID]; ok {
			continue
		}
		merged = append(merged, linkedRule)
		if existing[linkedRule.RoundRobinID] == nil {
			existing[linkedRule.RoundRobinID] = map[string]struct{}{}
		}
		existing[linkedRule.RoundRobinID][linkedRule.MatchValue] = struct{}{}
	}
	return merged
}

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
	members, err := repo.listMembers(ctx, tenantContext.OrganizationID, &roundRobinID)
	if err != nil {
		return RoundRobin{}, err
	}
	item.Rules = rules
	item.Members = members

	return item, nil
}

func (repo Repository) Create(ctx context.Context, tenantContext tenant.Context, input createInput) (RoundRobin, error) {
	if !canManageRoundRobinScope(tenantContext) {
		return RoundRobin{}, tenant.ErrOrganizationAccessDenied
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return RoundRobin{}, err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return RoundRobin{}, err
	}

	if err := repo.validateDestination(ctx, tx, tenantContext.OrganizationID, input.TargetPipelineID, input.TargetStageID); err != nil {
		return RoundRobin{}, err
	}
	if err := ensureRoundRobinInputInScope(tenantContext, input.TargetPipelineID, input.Members, true, true); err != nil {
		return RoundRobin{}, err
	}
	if err := repo.checkConditionConflicts(ctx, tx, tenantContext.OrganizationID, nil, input.Rules); err != nil {
		return RoundRobin{}, err
	}

	metadata := buildMetadata(input.Strategy, input.TargetStageID, input.Settings, input.ReentryBehavior)
	var roundRobinID string
	err = tx.QueryRow(ctx, `
		insert into public.round_robins (
			organization_id,
			name,
			pipeline_id,
			target_pipeline_id,
			target_stage_id,
			strategy,
			settings,
			reentry_behavior,
			is_active,
			current_position,
			rules,
			created_by
		)
		values (
			$1::uuid,
			$2,
			$3::uuid,
			$3::uuid,
			$4::uuid,
			$5,
			$6::jsonb,
			$7,
			$8,
			0,
			$9::jsonb,
			$10::uuid
		)
		returning id::text
	`, tenantContext.OrganizationID, input.Name, nullable(input.TargetPipelineID), nullable(input.TargetStageID), input.Strategy,
		jsonb(input.Settings), input.ReentryBehavior, input.IsActive, jsonb(metadata), tenantContext.UserID).Scan(&roundRobinID)
	if err != nil {
		return RoundRobin{}, err
	}

	if err := repo.insertRules(ctx, tx, tenantContext.OrganizationID, roundRobinID, input.Rules); err != nil {
		return RoundRobin{}, err
	}
	if _, err := repo.insertMembers(
		ctx,
		tx,
		tenantContext,
		roundRobinID,
		input.Members,
		boolFromObject(input.Settings, "ignore_availability"),
	); err != nil {
		return RoundRobin{}, err
	}
	if err := repo.validateWhatsAppMessageDistribution(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return RoundRobin{}, err
	}
	if err := repo.syncMetaFormConfigLinks(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return RoundRobin{}, err
	}
	if err := repo.syncWhatsAppInboundRules(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return RoundRobin{}, err
	}
	if err := repo.validateRedistributionCapacity(ctx, tx, tenantContext.OrganizationID, roundRobinID, input.Settings); err != nil {
		return RoundRobin{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return RoundRobin{}, err
	}

	return repo.Get(ctx, tenantContext, roundRobinID)
}

func (repo Repository) Update(ctx context.Context, tenantContext tenant.Context, roundRobinID string, input updateInput) (RoundRobin, error) {
	if !canManageRoundRobinScope(tenantContext) {
		return RoundRobin{}, tenant.ErrOrganizationAccessDenied
	}

	roundRobinID, ok := normalizeUUID(roundRobinID)
	if !ok {
		return RoundRobin{}, ErrRoundRobinNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return RoundRobin{}, err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return RoundRobin{}, err
	}

	if err := repo.ensureRoundRobinMutable(ctx, tx, tenantContext, roundRobinID); err != nil {
		return RoundRobin{}, err
	}

	current, err := repo.getStateForUpdate(ctx, tx, tenantContext.OrganizationID, roundRobinID)
	if err != nil {
		return RoundRobin{}, err
	}

	metadata := cloneObject(current.Metadata)
	pipelineID := current.PipelineID

	if input.Strategy.Set {
		value := "simple"
		if input.Strategy.Value != nil {
			value = normalizeStrategy(*input.Strategy.Value)
		}
		metadata["strategy"] = value
	}
	if input.TargetPipelineID.Set {
		pipelineID = nil
		if input.TargetPipelineID.Value != nil && *input.TargetPipelineID.Value != "" {
			value := *input.TargetPipelineID.Value
			pipelineID = &value
		}
	}
	if input.TargetStageID.Set {
		if input.TargetStageID.Value == nil || *input.TargetStageID.Value == "" {
			delete(metadata, "target_stage_id")
		} else {
			metadata["target_stage_id"] = *input.TargetStageID.Value
		}
	}
	if input.Settings.Set {
		metadata["settings"] = normalizeObject(input.Settings.Value)
	}
	if input.ReentryBehavior.Set {
		value := "redistribute"
		if input.ReentryBehavior.Value != nil {
			value = normalizeReentryBehavior(*input.ReentryBehavior.Value)
		}
		metadata["reentry_behavior"] = value
	}

	targetStageID := stringPointerFromMetadata(metadata, "target_stage_id")
	if err := repo.validateDestination(ctx, tx, tenantContext.OrganizationID, pipelineID, targetStageID); err != nil {
		return RoundRobin{}, err
	}
	if err := ensureRoundRobinInputInScope(tenantContext, pipelineID, input.Members, input.MembersSet, true); err != nil {
		return RoundRobin{}, err
	}
	if input.RulesSet {
		if err := repo.checkConditionConflicts(ctx, tx, tenantContext.OrganizationID, &roundRobinID, input.Rules); err != nil {
			return RoundRobin{}, err
		}
	}

	setClauses := []string{"updated_at = now()"}
	args := []any{tenantContext.OrganizationID, roundRobinID}

	addSet := func(clause string, value any) {
		args = append(args, value)
		setClauses = append(setClauses, fmt.Sprintf(clause, len(args)))
	}

	if input.Name.Set {
		addSet("name = $%d", valueOrNil(input.Name.Value))
	}
	if input.IsActive.Set {
		addSet("is_active = coalesce($%d::boolean, false)", valueOrNil(input.IsActive.Value))
	}
	if input.TargetPipelineID.Set {
		args = append(args, nullable(pipelineID))
		position := len(args)
		setClauses = append(setClauses, fmt.Sprintf("pipeline_id = $%d::uuid, target_pipeline_id = $%d::uuid", position, position))
	}
	if input.Strategy.Set {
		addSet("strategy = $%d", stringFromObject(metadata, "strategy", "simple"))
	}
	if input.TargetStageID.Set {
		addSet("target_stage_id = $%d::uuid", nullable(targetStageID))
	}
	if input.Settings.Set {
		addSet("settings = $%d::jsonb", jsonb(objectFromObject(metadata, "settings")))
	}
	if input.ReentryBehavior.Set {
		addSet("reentry_behavior = $%d", stringFromObject(metadata, "reentry_behavior", "redistribute"))
	}
	if input.Strategy.Set || input.TargetStageID.Set || input.Settings.Set || input.ReentryBehavior.Set {
		addSet("rules = $%d::jsonb", jsonb(metadata))
	}

	commandTag, err := tx.Exec(ctx, `
		update public.round_robins
		set `+strings.Join(setClauses, ", ")+`
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, args...)
	if err != nil {
		return RoundRobin{}, err
	}
	if commandTag.RowsAffected() == 0 {
		return RoundRobin{}, ErrRoundRobinNotFound
	}

	if input.RulesSet {
		if err := repo.deleteWhatsAppInboundRulesForRoundRobin(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
			return RoundRobin{}, err
		}
		if _, err := tx.Exec(ctx, `
			delete from public.round_robin_rules
			where organization_id = $1::uuid
			  and round_robin_id = $2::uuid
		`, tenantContext.OrganizationID, roundRobinID); err != nil {
			return RoundRobin{}, err
		}
		if err := repo.insertRules(ctx, tx, tenantContext.OrganizationID, roundRobinID, input.Rules); err != nil {
			return RoundRobin{}, err
		}
	}

	if input.MembersSet {
		if _, err := tx.Exec(ctx, `
			delete from public.round_robin_members
			where organization_id = $1::uuid
			  and round_robin_id = $2::uuid
		`, tenantContext.OrganizationID, roundRobinID); err != nil {
			return RoundRobin{}, err
		}
		if _, err := repo.insertMembers(
			ctx,
			tx,
			tenantContext,
			roundRobinID,
			input.Members,
			boolFromObject(objectFromObject(metadata, "settings"), "ignore_availability"),
		); err != nil {
			return RoundRobin{}, err
		}
	}
	if err := repo.validateWhatsAppMessageDistribution(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return RoundRobin{}, err
	}
	if input.RulesSet {
		if err := repo.syncMetaFormConfigLinks(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
			return RoundRobin{}, err
		}
	}
	if err := repo.syncWhatsAppInboundRules(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return RoundRobin{}, err
	}
	if err := repo.validateRedistributionCapacity(ctx, tx, tenantContext.OrganizationID, roundRobinID, objectFromObject(metadata, "settings")); err != nil {
		return RoundRobin{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return RoundRobin{}, err
	}

	return repo.Get(ctx, tenantContext, roundRobinID)
}

func (repo Repository) Delete(ctx context.Context, tenantContext tenant.Context, roundRobinID string) error {
	if !canManageRoundRobins(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}

	roundRobinID, ok := normalizeUUID(roundRobinID)
	if !ok {
		return ErrRoundRobinNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return err
	}

	if _, err := repo.getStateForUpdate(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return err
	}
	if err := repo.deleteWhatsAppInboundRulesForRoundRobin(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return err
	}

	for _, query := range []string{
		`delete from public.round_robin_members where organization_id = $1::uuid and round_robin_id = $2::uuid`,
		`delete from public.round_robin_rules where organization_id = $1::uuid and round_robin_id = $2::uuid`,
		`delete from public.round_robin_logs where organization_id = $1::uuid and round_robin_id = $2::uuid`,
		`delete from public.round_robins where organization_id = $1::uuid and id = $2::uuid`,
	} {
		if _, err := tx.Exec(ctx, query, tenantContext.OrganizationID, roundRobinID); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func (repo Repository) ListRules(ctx context.Context, tenantContext tenant.Context, roundRobinID *string) ([]Rule, error) {
	if roundRobinID != nil {
		value, ok := normalizeUUID(*roundRobinID)
		if !ok {
			return nil, ErrRoundRobinNotFound
		}
		roundRobinID = &value
		if err := repo.ensureRoundRobinVisible(ctx, repo.db.Pool(), tenantContext, value); err != nil {
			return nil, err
		}
	}

	items, err := repo.listRules(ctx, tenantContext.OrganizationID, roundRobinID)
	if err != nil || roundRobinID != nil || canManageRoundRobins(tenantContext) {
		return items, err
	}
	visibleIDs, err := repo.visibleRoundRobinIDSet(ctx, tenantContext)
	if err != nil {
		return nil, err
	}
	filtered := make([]Rule, 0, len(items))
	for _, item := range items {
		if visibleIDs[item.RoundRobinID] {
			filtered = append(filtered, item)
		}
	}
	return filtered, nil
}

func (repo Repository) CreateRule(ctx context.Context, tenantContext tenant.Context, input ruleMutationInput) (Rule, error) {
	if !canManageRoundRobinScope(tenantContext) {
		return Rule{}, tenant.ErrOrganizationAccessDenied
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Rule{}, err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return Rule{}, err
	}

	if err := repo.ensureRoundRobinMutable(ctx, tx, tenantContext, input.RoundRobinID); err != nil {
		return Rule{}, err
	}
	if _, err := repo.getStateForUpdate(ctx, tx, tenantContext.OrganizationID, input.RoundRobinID); err != nil {
		return Rule{}, err
	}
	if err := repo.checkConditionConflicts(ctx, tx, tenantContext.OrganizationID, &input.RoundRobinID, []ruleInput{{
		MatchType:  input.MatchType,
		MatchValue: input.MatchValue,
		Match:      input.Match,
		Priority:   input.Priority,
		IsActive:   input.IsActive,
	}}); err != nil {
		return Rule{}, err
	}

	var ruleID string
	err = tx.QueryRow(ctx, `
		insert into public.round_robin_rules (
			organization_id,
			round_robin_id,
			match_type,
			match_value,
			match,
			name,
			conditions,
			is_active,
			priority
		)
		values (
			$1::uuid,
			$2::uuid,
			$3,
			$4,
			$5::jsonb,
			$3,
			$6::jsonb,
			$7,
			$8
		)
		returning id::text
	`, tenantContext.OrganizationID, input.RoundRobinID, input.MatchType, input.MatchValue, jsonb(normalizeObject(input.Match)), jsonb(rulePayload(input.MatchType, input.MatchValue, input.Match)), input.IsActive, input.Priority).Scan(&ruleID)
	if err != nil {
		return Rule{}, err
	}

	if err := repo.validateWhatsAppMessageDistribution(ctx, tx, tenantContext.OrganizationID, input.RoundRobinID); err != nil {
		return Rule{}, err
	}
	if err := repo.syncMetaFormConfigLinks(ctx, tx, tenantContext.OrganizationID, input.RoundRobinID); err != nil {
		return Rule{}, err
	}
	if err := repo.syncWhatsAppInboundRules(ctx, tx, tenantContext.OrganizationID, input.RoundRobinID); err != nil {
		return Rule{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Rule{}, err
	}

	return repo.getRule(ctx, tenantContext.OrganizationID, ruleID)
}

func (repo Repository) UpdateRule(ctx context.Context, tenantContext tenant.Context, ruleID string, input updateRuleInput) (Rule, error) {
	if !canManageRoundRobinScope(tenantContext) {
		return Rule{}, tenant.ErrOrganizationAccessDenied
	}

	ruleID, ok := normalizeUUID(ruleID)
	if !ok {
		return Rule{}, ErrRuleNotFound
	}

	current, err := repo.getRule(ctx, tenantContext.OrganizationID, ruleID)
	if err != nil {
		return Rule{}, err
	}

	matchType := current.MatchType
	matchValue := current.MatchValue
	if input.MatchType.Set && input.MatchType.Value != nil {
		matchType = *input.MatchType.Value
	}
	if input.MatchValue.Set {
		matchValue = ""
		if input.MatchValue.Value != nil {
			matchValue = *input.MatchValue.Value
		}
	}
	match := resolveRuleMatchPatch(
		current.Match,
		matchType,
		matchValue,
		input.Match,
		input.MatchType.Set || input.MatchValue.Set,
	)
	isActive := current.IsActive
	if input.IsActive.Set {
		isActive = input.IsActive.Value != nil && *input.IsActive.Value
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Rule{}, err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return Rule{}, err
	}

	if err := repo.ensureRoundRobinMutable(ctx, tx, tenantContext, current.RoundRobinID); err != nil {
		return Rule{}, err
	}
	if _, err := repo.getStateForUpdate(ctx, tx, tenantContext.OrganizationID, current.RoundRobinID); err != nil {
		return Rule{}, err
	}
	if err := repo.checkConditionConflicts(ctx, tx, tenantContext.OrganizationID, &current.RoundRobinID, []ruleInput{{
		MatchType:  matchType,
		MatchValue: matchValue,
		Match:      match,
		Priority:   current.Priority,
		IsActive:   isActive,
	}}); err != nil {
		return Rule{}, err
	}

	setClauses := []string{"updated_at = now()"}
	args := []any{tenantContext.OrganizationID, ruleID}

	if input.MatchType.Set || input.MatchValue.Set || input.Match.Set {
		args = append(args, jsonb(rulePayload(matchType, matchValue, match)))
		setClauses = append(setClauses, fmt.Sprintf("conditions = $%d::jsonb", len(args)))
		args = append(args, matchType)
		setClauses = append(setClauses, fmt.Sprintf("name = $%d", len(args)))
		args = append(args, matchType)
		setClauses = append(setClauses, fmt.Sprintf("match_type = $%d", len(args)))
		args = append(args, matchValue)
		setClauses = append(setClauses, fmt.Sprintf("match_value = $%d", len(args)))
		args = append(args, jsonb(normalizeObject(match)))
		setClauses = append(setClauses, fmt.Sprintf("match = $%d::jsonb", len(args)))
	}
	if input.Priority != nil {
		args = append(args, *input.Priority)
		setClauses = append(setClauses, fmt.Sprintf("priority = $%d", len(args)))
	}
	if input.IsActive.Set {
		args = append(args, valueOrNil(input.IsActive.Value))
		setClauses = append(setClauses, fmt.Sprintf("is_active = coalesce($%d::boolean, false)", len(args)))
	}

	commandTag, err := tx.Exec(ctx, `
		update public.round_robin_rules
		set `+strings.Join(setClauses, ", ")+`
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, args...)
	if err != nil {
		return Rule{}, err
	}
	if commandTag.RowsAffected() == 0 {
		return Rule{}, ErrRuleNotFound
	}

	if err := repo.validateWhatsAppMessageDistribution(ctx, tx, tenantContext.OrganizationID, current.RoundRobinID); err != nil {
		return Rule{}, err
	}
	if err := repo.syncMetaFormConfigLinks(ctx, tx, tenantContext.OrganizationID, current.RoundRobinID); err != nil {
		return Rule{}, err
	}
	if err := repo.syncWhatsAppInboundRules(ctx, tx, tenantContext.OrganizationID, current.RoundRobinID); err != nil {
		return Rule{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Rule{}, err
	}

	return repo.getRule(ctx, tenantContext.OrganizationID, ruleID)
}

func (repo Repository) DeleteRule(ctx context.Context, tenantContext tenant.Context, ruleID string) error {
	if !canManageRoundRobinScope(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}

	ruleID, ok := normalizeUUID(ruleID)
	if !ok {
		return ErrRuleNotFound
	}

	current, err := repo.getRule(ctx, tenantContext.OrganizationID, ruleID)
	if err != nil {
		return err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return err
	}

	if err := repo.ensureRoundRobinMutable(ctx, tx, tenantContext, current.RoundRobinID); err != nil {
		return err
	}
	if err := repo.deleteWhatsAppInboundRule(ctx, tx, tenantContext.OrganizationID, ruleID); err != nil {
		return err
	}

	commandTag, err := tx.Exec(ctx, `
		delete from public.round_robin_rules
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, ruleID)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return ErrRuleNotFound
	}
	if err := repo.syncMetaFormConfigLinks(ctx, tx, tenantContext.OrganizationID, current.RoundRobinID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (repo Repository) AddMember(ctx context.Context, tenantContext tenant.Context, roundRobinID string, input memberMutationInput) ([]Member, error) {
	if !canManageRoundRobinScope(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	roundRobinID, ok := normalizeUUID(roundRobinID)
	if !ok {
		return nil, ErrRoundRobinNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return nil, err
	}

	if err := repo.ensureRoundRobinMutable(ctx, tx, tenantContext, roundRobinID); err != nil {
		return nil, err
	}
	state, err := repo.getStateForUpdate(ctx, tx, tenantContext.OrganizationID, roundRobinID)
	if err != nil {
		return nil, err
	}

	items := []memberInput{{
		Type:     input.Type,
		EntityID: input.EntityID,
		UserID:   input.UserID,
		TeamID:   input.TeamID,
		Weight:   input.Weight,
	}}
	if err := ensureRoundRobinInputInScope(tenantContext, nil, items, true, false); err != nil {
		return nil, err
	}
	ids, err := repo.insertMembers(
		ctx,
		tx,
		tenantContext,
		roundRobinID,
		items,
		boolFromObject(objectFromObject(state.Metadata, "settings"), "ignore_availability"),
	)
	if err != nil {
		return nil, err
	}
	if err := repo.validateWhatsAppMessageDistribution(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	members := make([]Member, 0, len(ids))
	for _, id := range ids {
		member, err := repo.getMember(ctx, tenantContext.OrganizationID, id)
		if err != nil {
			return nil, err
		}
		members = append(members, member)
	}

	return members, nil
}

func (repo Repository) UpdateMember(ctx context.Context, tenantContext tenant.Context, memberID string, input updateMemberInput) (Member, error) {
	if !canManageRoundRobinScope(tenantContext) {
		return Member{}, tenant.ErrOrganizationAccessDenied
	}

	memberID, ok := normalizeUUID(memberID)
	if !ok {
		return Member{}, ErrMemberNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Member{}, err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return Member{}, err
	}
	roundRobinID, err := repo.ensureRoundRobinMemberMutable(ctx, tx, tenantContext, memberID)
	if err != nil {
		return Member{}, err
	}

	setClauses := []string{}
	args := []any{tenantContext.OrganizationID, memberID}
	if input.Weight != nil {
		args = append(args, *input.Weight)
		setClauses = append(setClauses, fmt.Sprintf("weight = $%d", len(args)))
	}
	if input.Position != nil {
		args = append(args, *input.Position)
		setClauses = append(setClauses, fmt.Sprintf("position = $%d", len(args)))
	}
	if input.IsActive.Set {
		args = append(args, valueOrNil(input.IsActive.Value))
		setClauses = append(setClauses, fmt.Sprintf("is_active = coalesce($%d::boolean, false)", len(args)))
	}

	commandTag, err := tx.Exec(ctx, `
		update public.round_robin_members
		set `+strings.Join(setClauses, ", ")+`
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, args...)
	if err != nil {
		return Member{}, err
	}
	if commandTag.RowsAffected() == 0 {
		return Member{}, ErrMemberNotFound
	}
	if err := repo.validateWhatsAppMessageDistribution(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return Member{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Member{}, err
	}

	return repo.getMember(ctx, tenantContext.OrganizationID, memberID)
}

func (repo Repository) DeleteMember(ctx context.Context, tenantContext tenant.Context, memberID string) error {
	if !canManageRoundRobinScope(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}

	memberID, ok := normalizeUUID(memberID)
	if !ok {
		return ErrMemberNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return err
	}
	roundRobinID, err := repo.ensureRoundRobinMemberMutable(ctx, tx, tenantContext, memberID)
	if err != nil {
		return err
	}

	commandTag, err := tx.Exec(ctx, `
		delete from public.round_robin_members
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, memberID)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return ErrMemberNotFound
	}
	if err := repo.validateWhatsAppMessageDistribution(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (repo Repository) listRules(ctx context.Context, organizationID string, roundRobinID *string) ([]Rule, error) {
	args := []any{organizationID}
	where := "r.organization_id = $1::uuid"
	if roundRobinID != nil {
		args = append(args, *roundRobinID)
		where += " and r.round_robin_id = $2::uuid"
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			r.id::text,
			r.round_robin_id::text,
			coalesce(nullif(r.match_type, ''), r.conditions->>'match_type', r.name, ''),
			coalesce(nullif(r.match_value, ''), r.conditions->>'match_value', ''),
			coalesce(r.match, r.conditions->'match', '{}'::jsonb)::text,
			coalesce(r.priority, 0),
			coalesce(r.is_active, true),
			r.created_at,
			r.updated_at
		from public.round_robin_rules r
		where `+where+`
		order by r.round_robin_id, coalesce(r.priority, 0) desc, r.created_at asc
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Rule{}
	for rows.Next() {
		rule, err := scanRule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rule)
	}
	return out, rows.Err()
}

func (repo Repository) listMembers(ctx context.Context, organizationID string, roundRobinID *string) ([]Member, error) {
	args := []any{organizationID}
	where := "rrm.organization_id = $1::uuid"
	if roundRobinID != nil {
		args = append(args, *roundRobinID)
		where += " and rrm.round_robin_id = $2::uuid"
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			rrm.id::text,
			rrm.round_robin_id::text,
			rrm.user_id::text,
			rrm.team_id::text,
			coalesce(rrm.position, 0),
			rrm.weight,
			coalesce(rrm.is_active, true),
			u.id::text,
			u.name,
			u.email,
			u.avatar_url,
			coalesce(logs.total, 0)
		from public.round_robin_members rrm
		left join public.users u
		  on u.id = rrm.user_id
		left join lateral (
			select count(*)::bigint as total
			from public.round_robin_logs rrl
			where rrl.organization_id = rrm.organization_id
			  and rrl.round_robin_id = rrm.round_robin_id
			  and (
			    rrl.member_id = rrm.id
			    or (
			      rrl.member_id is null
			      and (
			        (rrm.user_id is not null and rrl.assigned_user_id = rrm.user_id)
			        or (rrm.user_id is null and rrl.metadata->>'member_id' = rrm.id::text)
			      )
			    )
			  )
		) logs on true
		where `+where+`
		order by rrm.round_robin_id, coalesce(rrm.position, 0) asc, rrm.created_at asc
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Member{}
	for rows.Next() {
		member, err := scanMember(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, member)
	}
	return out, rows.Err()
}

func (repo Repository) getRule(ctx context.Context, organizationID string, ruleID string) (Rule, error) {
	rule, err := scanRule(repo.db.Pool().QueryRow(ctx, `
		select
			r.id::text,
			r.round_robin_id::text,
			coalesce(nullif(r.match_type, ''), r.conditions->>'match_type', r.name, ''),
			coalesce(nullif(r.match_value, ''), r.conditions->>'match_value', ''),
			coalesce(r.match, r.conditions->'match', '{}'::jsonb)::text,
			coalesce(r.priority, 0),
			coalesce(r.is_active, true),
			r.created_at,
			r.updated_at
		from public.round_robin_rules r
		where r.organization_id = $1::uuid
		  and r.id = $2::uuid
		limit 1
	`, organizationID, ruleID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Rule{}, ErrRuleNotFound
	}
	return rule, err
}

func (repo Repository) getMember(ctx context.Context, organizationID string, memberID string) (Member, error) {
	member, err := scanMember(repo.db.Pool().QueryRow(ctx, `
		select
			rrm.id::text,
			rrm.round_robin_id::text,
			rrm.user_id::text,
			rrm.team_id::text,
			coalesce(rrm.position, 0),
			rrm.weight,
			coalesce(rrm.is_active, true),
			u.id::text,
			u.name,
			u.email,
			u.avatar_url,
			coalesce(logs.total, 0)
		from public.round_robin_members rrm
		left join public.users u
		  on u.id = rrm.user_id
		left join lateral (
			select count(*)::bigint as total
			from public.round_robin_logs rrl
			where rrl.organization_id = rrm.organization_id
			  and rrl.round_robin_id = rrm.round_robin_id
			  and (
			    rrl.member_id = rrm.id
			    or (
			      rrl.member_id is null
			      and (
			        (rrm.user_id is not null and rrl.assigned_user_id = rrm.user_id)
			        or (rrm.user_id is null and rrl.metadata->>'member_id' = rrm.id::text)
			      )
			    )
			  )
		) logs on true
		where rrm.organization_id = $1::uuid
		  and rrm.id = $2::uuid
		limit 1
	`, organizationID, memberID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Member{}, ErrMemberNotFound
	}
	return member, err
}

func (repo Repository) getStateForUpdate(ctx context.Context, q queryer, organizationID string, roundRobinID string) (roundRobinState, error) {
	var state roundRobinState
	var pipelineID pgtype.Text
	var metadataRaw string
	err := q.QueryRow(ctx, `
		select
			id::text,
			coalesce(target_pipeline_id, pipeline_id)::text,
			(
			  coalesce(rules, '{}'::jsonb)
			  || jsonb_strip_nulls(jsonb_build_object(
			    'strategy', coalesce(nullif(strategy, ''), rules->>'strategy', 'simple'),
			    'target_stage_id', coalesce(target_stage_id::text, rules->>'target_stage_id'),
			    'settings', coalesce(settings, rules->'settings', '{}'::jsonb),
			    'reentry_behavior', coalesce(nullif(reentry_behavior, ''), rules->>'reentry_behavior', 'redistribute')
			  ))
			)::text
		from public.round_robins
		where organization_id = $1::uuid
		  and id = $2::uuid
		for update
	`, organizationID, roundRobinID).Scan(&state.ID, &pipelineID, &metadataRaw)
	if errors.Is(err, pgx.ErrNoRows) {
		return roundRobinState{}, ErrRoundRobinNotFound
	}
	if err != nil {
		return roundRobinState{}, err
	}

	if pipelineID.Valid {
		state.PipelineID = &pipelineID.String
	}
	state.Metadata = parseObject(metadataRaw)
	return state, nil
}

func (repo Repository) ensureRoundRobin(ctx context.Context, q queryer, organizationID string, roundRobinID string) error {
	var exists bool
	if err := q.QueryRow(ctx, `
		select exists (
			select 1
			from public.round_robins
			where organization_id = $1::uuid
			  and id = $2::uuid
		)
	`, organizationID, roundRobinID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrRoundRobinNotFound
	}
	return nil
}

func (repo Repository) validateDestination(ctx context.Context, q queryer, organizationID string, pipelineID *string, stageID *string) error {
	if pipelineID != nil {
		if err := repo.ensurePipeline(ctx, q, organizationID, *pipelineID); err != nil {
			return err
		}
	}
	if stageID != nil {
		var exists bool
		err := q.QueryRow(ctx, `
			select exists (
				select 1
				from public.stages
				where organization_id = $1::uuid
				  and id = $2::uuid
				  and ($3::uuid is null or pipeline_id = $3::uuid)
			)
		`, organizationID, *stageID, nullable(pipelineID)).Scan(&exists)
		if err != nil {
			return err
		}
		if !exists {
			return ErrInvalidReference
		}
	}
	return nil
}

func (repo Repository) validateRedistributionCapacity(ctx context.Context, q queryer, organizationID string, roundRobinID string, settings map[string]any) error {
	if !boolFromObject(settings, "enable_redistribution") {
		return nil
	}

	var eligibleUsers int
	err := q.QueryRow(ctx, `
		with entries as (
			select rrm.organization_id, rrm.user_id, rrm.team_id
			from public.round_robin_members rrm
			where rrm.organization_id = $1::uuid
			  and rrm.round_robin_id = $2::uuid
			  and coalesce(rrm.is_active, true) = true
		), candidates as (
			select organization_id, user_id from entries where user_id is not null
			union
			select e.organization_id, tm.user_id
			from entries e
			join public.teams t
			  on t.id = e.team_id and t.organization_id = e.organization_id and coalesce(t.is_active, true) = true
			join public.team_members tm
			  on tm.team_id = e.team_id and tm.organization_id = e.organization_id and coalesce(tm.is_active, true) = true
			where e.team_id is not null
		)
		select count(distinct c.user_id)::int
		from candidates c
		join public.organization_members om
		  on om.organization_id = c.organization_id and om.user_id = c.user_id and coalesce(om.is_active, true) = true
		join public.users u on u.id = c.user_id and coalesce(u.is_active, true) = true
	`, organizationID, roundRobinID).Scan(&eligibleUsers)
	if err != nil {
		return err
	}
	if eligibleUsers < 2 {
		return fmt.Errorf("%w: automatic redistribution requires at least two active eligible users", ErrInvalidInput)
	}
	return nil
}

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

func (repo Repository) ensurePipeline(ctx context.Context, q queryer, organizationID string, pipelineID string) error {
	var exists bool
	err := q.QueryRow(ctx, `
		select exists (
			select 1
			from public.pipelines
			where organization_id = $1::uuid
			  and id = $2::uuid
		)
	`, organizationID, pipelineID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalidReference
	}
	return nil
}

func (repo Repository) insertRules(ctx context.Context, tx pgx.Tx, organizationID string, roundRobinID string, rules []ruleInput) error {
	for index, rule := range rules {
		priority := rule.Priority
		if priority == 0 {
			priority = len(rules) - index
		}
		if _, err := tx.Exec(ctx, `
			insert into public.round_robin_rules (
				organization_id,
				round_robin_id,
				match_type,
				match_value,
				match,
				name,
				conditions,
				is_active,
				priority
			)
			values (
				$1::uuid,
				$2::uuid,
				$3,
				$4,
				$5::jsonb,
				$3,
				$6::jsonb,
				$7,
				$8
			)
		`, organizationID, roundRobinID, rule.MatchType, rule.MatchValue, jsonb(normalizeObject(rule.Match)), jsonb(rulePayload(rule.MatchType, rule.MatchValue, rule.Match)), rule.IsActive, priority); err != nil {
			return err
		}
	}
	return nil
}

func (repo Repository) syncMetaFormConfigLinks(ctx context.Context, q queryer, organizationID string, roundRobinID string) error {
	formIDs, err := repo.metaFormRuleValues(ctx, q, organizationID, roundRobinID)
	if err != nil {
		return err
	}

	if len(formIDs) == 0 {
		_, err = q.Exec(ctx, `
			update public.meta_form_configs
			set round_robin_id = null,
			    updated_at = now()
			where organization_id = $1::uuid
			  and round_robin_id = $2::uuid
		`, organizationID, roundRobinID)
		return err
	}

	if err := repo.lockAndValidateMetaFormLinks(ctx, q, organizationID, roundRobinID, formIDs); err != nil {
		return err
	}

	if _, err := q.Exec(ctx, `
		update public.meta_form_configs
		set round_robin_id = null,
		    updated_at = now()
		where organization_id = $1::uuid
		  and round_robin_id = $2::uuid
		  and not (form_id = any($3::text[]))
	`, organizationID, roundRobinID, formIDs); err != nil {
		return err
	}

	_, err = q.Exec(ctx, `
		update public.meta_form_configs
		set round_robin_id = $2::uuid,
		    updated_at = now()
		where organization_id = $1::uuid
		  and form_id = any($3::text[])
	`, organizationID, roundRobinID, formIDs)
	return err
}

func (repo Repository) lockAndValidateMetaFormLinks(
	ctx context.Context,
	q queryer,
	organizationID string,
	roundRobinID string,
	formIDs []string,
) error {
	rows, err := q.Query(ctx, lockMetaFormLinksQuery, organizationID, formIDs)
	if err != nil {
		return err
	}
	defer rows.Close()

	states := make([]metaFormLinkState, 0, len(formIDs))
	for rows.Next() {
		var state metaFormLinkState
		if err := rows.Scan(&state.FormID, &state.RoundRobinID, &state.QueueName); err != nil {
			return err
		}
		states = append(states, state)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	return validateMetaFormLinks(roundRobinID, formIDs, states)
}

func validateMetaFormLinks(roundRobinID string, formIDs []string, states []metaFormLinkState) error {
	found := make(map[string]struct{}, len(states))
	for _, state := range states {
		found[state.FormID] = struct{}{}
		if state.RoundRobinID != "" && state.RoundRobinID != roundRobinID {
			return ConditionConflictError{QueueName: state.QueueName}
		}
	}
	for _, formID := range formIDs {
		if _, ok := found[formID]; !ok {
			return ErrInvalidReference
		}
	}
	return nil
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

func (repo Repository) metaFormRuleValues(ctx context.Context, q queryer, organizationID string, roundRobinID string) ([]string, error) {
	rows, err := q.Query(ctx, `
		select coalesce(nullif(match_value, ''), conditions->>'match_value', '')
		from public.round_robin_rules
		where organization_id = $1::uuid
		  and round_robin_id = $2::uuid
		  and coalesce(is_active, true) = true
		  and coalesce(nullif(match_type, ''), conditions->>'match_type', name, '') = 'meta_form'
	`, organizationID, roundRobinID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	seen := map[string]struct{}{}
	formIDs := []string{}
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		for _, formID := range splitValues(raw) {
			if _, exists := seen[formID]; exists {
				continue
			}
			seen[formID] = struct{}{}
			formIDs = append(formIDs, formID)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return formIDs, nil
}

func (repo Repository) insertMembers(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	roundRobinID string,
	members []memberInput,
	ignoreAvailability bool,
) ([]string, error) {
	organizationID := tenantContext.OrganizationID
	insertedIDs := []string{}
	seen := map[string]struct{}{}

	for _, member := range members {
		memberKey, userID, teamID, err := repo.resolveMemberEntry(
			ctx,
			tx,
			organizationID,
			member,
			ignoreAvailability,
		)
		if err != nil {
			return nil, err
		}
		if err := ensureResolvedMemberInScope(tenantContext, userID, teamID); err != nil {
			return nil, err
		}
		if _, exists := seen[memberKey]; exists {
			continue
		}
		seen[memberKey] = struct{}{}

		var nextPosition int
		if err := tx.QueryRow(ctx, `
			select coalesce(max(position), -1) + 1
			from public.round_robin_members
			where organization_id = $1::uuid
			  and round_robin_id = $2::uuid
		`, organizationID, roundRobinID).Scan(&nextPosition); err != nil {
			return nil, err
		}

		var insertedID string
		err = tx.QueryRow(ctx, `
			insert into public.round_robin_members (
				organization_id,
				round_robin_id,
				team_id,
				user_id,
				weight,
				position,
				is_active
			)
			values (
				$1::uuid,
				$2::uuid,
				$3::uuid,
				$4::uuid,
				$5,
				$6,
				true
			)
			returning id::text
		`, organizationID, roundRobinID, nullable(teamID), nullable(userID), member.Weight, nextPosition).Scan(&insertedID)
		if err != nil {
			return nil, err
		}
		insertedIDs = append(insertedIDs, insertedID)
	}

	return insertedIDs, nil
}

func ensureResolvedMemberInScope(
	tenantContext tenant.Context,
	userID *string,
	teamID *string,
) error {
	if canManageRoundRobins(tenantContext) {
		return nil
	}
	if !tenantContext.IsTeamLeader {
		return tenant.ErrOrganizationAccessDenied
	}
	if teamID != nil && !tenantContext.LeadsTeam(*teamID) {
		return tenant.ErrOrganizationAccessDenied
	}
	if userID != nil && !tenantContext.LeadsUser(*userID) {
		return tenant.ErrOrganizationAccessDenied
	}
	return nil
}

func (repo Repository) resolveMemberEntry(
	ctx context.Context,
	q queryer,
	organizationID string,
	member memberInput,
	ignoreAvailability bool,
) (string, *string, *string, error) {
	if member.UserID != nil {
		if err := repo.validateUser(ctx, q, organizationID, *member.UserID); err != nil {
			return "", nil, nil, err
		}
		activeTeamIDs, err := repo.activeUserTeamIDs(ctx, q, organizationID, *member.UserID)
		if err != nil {
			return "", nil, nil, err
		}
		teamID, err := resolveDirectUserTeamID(activeTeamIDs, member.TeamID, ignoreAvailability)
		if err != nil {
			return "", nil, nil, err
		}
		memberKey := "user:" + *member.UserID + ":team:none"
		if teamID != nil {
			memberKey = "user:" + *member.UserID + ":team:" + *teamID
		}
		return memberKey, member.UserID, teamID, nil
	}

	if member.TeamID == nil {
		return "", nil, nil, ErrInvalidReference
	}

	if err := repo.validateTeam(ctx, q, organizationID, *member.TeamID); err != nil {
		return "", nil, nil, err
	}
	return "team:" + *member.TeamID, nil, member.TeamID, nil
}

func resolveDirectUserTeamID(
	activeTeamIDs []string,
	requestedTeamID *string,
	ignoreAvailability bool,
) (*string, error) {
	uniqueTeamIDs := make([]string, 0, len(activeTeamIDs))
	seen := map[string]struct{}{}
	for _, teamID := range activeTeamIDs {
		teamID = strings.TrimSpace(teamID)
		if teamID == "" {
			continue
		}
		if _, exists := seen[teamID]; exists {
			continue
		}
		seen[teamID] = struct{}{}
		uniqueTeamIDs = append(uniqueTeamIDs, teamID)
	}

	if requestedTeamID != nil {
		for _, teamID := range uniqueTeamIDs {
			if teamID == *requestedTeamID {
				value := teamID
				return &value, nil
			}
		}
		return nil, ErrInvalidReference
	}

	switch len(uniqueTeamIDs) {
	case 1:
		value := uniqueTeamIDs[0]
		return &value, nil
	case 0:
		if ignoreAvailability {
			return nil, nil
		}
		return nil, fmt.Errorf("%w: direct user must belong to an active team while availability is enforced", ErrInvalidInput)
	default:
		return nil, fmt.Errorf("%w: teamId is required when a direct user belongs to multiple active teams", ErrInvalidInput)
	}
}

func (repo Repository) activeUserTeamIDs(
	ctx context.Context,
	q queryer,
	organizationID string,
	userID string,
) ([]string, error) {
	rows, err := q.Query(ctx, `
		select tm.team_id::text
		from public.team_members tm
		join public.teams t
		  on t.id = tm.team_id
		 and t.organization_id = tm.organization_id
		 and coalesce(t.is_active, true) = true
		where tm.organization_id = $1::uuid
		  and tm.user_id = $2::uuid
		  and coalesce(tm.is_active, true) = true
		order by tm.created_at asc, tm.id asc
	`, organizationID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	teamIDs := []string{}
	for rows.Next() {
		var teamID string
		if err := rows.Scan(&teamID); err != nil {
			return nil, err
		}
		teamIDs = append(teamIDs, teamID)
	}
	return teamIDs, rows.Err()
}

func (repo Repository) validateTeam(ctx context.Context, q queryer, organizationID string, teamID string) error {
	var exists bool
	err := q.QueryRow(ctx, `
		select exists (
			select 1
			from public.teams
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and coalesce(is_active, true) = true
		)
	`, organizationID, teamID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalidReference
	}
	return nil
}

func (repo Repository) validateUser(ctx context.Context, q queryer, organizationID string, userID string) error {
	var exists bool
	err := q.QueryRow(ctx, `
		select exists (
			select 1
			from public.users u
			join public.organization_members om
			  on om.user_id = u.id
			 and om.organization_id = $1::uuid
			where u.id = $2::uuid
			  and coalesce(u.is_active, false) = true
			  and coalesce(om.is_active, false) = true
		)
	`, organizationID, userID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalidReference
	}
	return nil
}

type conditionConflictValue struct {
	Value     string
	SessionID string
}

func (repo Repository) checkConditionConflicts(ctx context.Context, q queryer, organizationID string, excludeRoundRobinID *string, rules []ruleInput) error {
	wanted := map[string][]conditionConflictValue{}
	for _, rule := range rules {
		if _, ok := uniqueConditionTypes[rule.MatchType]; !ok || !rule.IsActive {
			continue
		}
		sessionID := ""
		if rule.MatchType == whatsappMessageContainsConditionType {
			sessionID, _ = whatsappSessionIDFromMatch(rule.Match)
		}
		for _, value := range uniqueConditionValues(rule.MatchType, rule.MatchValue) {
			wanted[rule.MatchType] = append(wanted[rule.MatchType], conditionConflictValue{
				Value:     value,
				SessionID: sessionID,
			})
		}
	}
	if len(wanted) == 0 {
		return nil
	}

	rows, err := q.Query(ctx, `
		select
			rrr.round_robin_id::text,
			rr.name,
			jsonb_build_object(
				'match_type', coalesce(nullif(rrr.match_type, ''), rrr.conditions->>'match_type', rrr.name, ''),
				'match_value', coalesce(nullif(rrr.match_value, ''), rrr.conditions->>'match_value', ''),
				'match', coalesce(rrr.match, rrr.conditions->'match', '{}'::jsonb)
			)::text
		from public.round_robin_rules rrr
		join public.round_robins rr
		  on rr.organization_id = rrr.organization_id
		 and rr.id = rrr.round_robin_id
		where rrr.organization_id = $1::uuid
		  and coalesce(rrr.is_active, true) = true
		  and ($2::uuid is null or rrr.round_robin_id <> $2::uuid)
	`, organizationID, nullable(excludeRoundRobinID))
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var roundRobinID, queueName, raw string
		if err := rows.Scan(&roundRobinID, &queueName, &raw); err != nil {
			return err
		}
		_ = roundRobinID
		payload := parseObject(raw)
		matchType, _ := payload["match_type"].(string)
		if _, ok := uniqueConditionTypes[matchType]; !ok {
			continue
		}
		matchValue, _ := payload["match_value"].(string)
		existingSessionID := ""
		if matchType == whatsappMessageContainsConditionType {
			existingSessionID, _ = whatsappSessionIDFromMatch(objectFromObject(payload, "match"))
		}
		for _, value := range uniqueConditionValues(matchType, matchValue) {
			for _, wantedValue := range wanted[matchType] {
				if conditionScopesConflict(matchType, wantedValue.SessionID, existingSessionID) &&
					conditionValuesConflict(matchType, wantedValue.Value, value) {
					return ConditionConflictError{QueueName: queueName}
				}
			}
		}
	}
	return rows.Err()
}

func conditionScopesConflict(matchType string, leftSessionID string, rightSessionID string) bool {
	if matchType != whatsappMessageContainsConditionType {
		return true
	}
	// Legacy rules without a connection were wildcard rules. Keep treating
	// them as conflicting with every connection until they are edited.
	return leftSessionID == "" || rightSessionID == "" || leftSessionID == rightSessionID
}

func conditionValuesConflict(matchType string, left string, right string) bool {
	if matchType == whatsappMessageContainsConditionType {
		return strings.Contains(left, right) || strings.Contains(right, left)
	}
	return left == right
}

func uniqueConditionValues(matchType string, matchValue string) []string {
	if matchType != whatsappMessageContainsConditionType {
		return splitValues(matchValue)
	}
	value := strings.ToLower(strings.TrimSpace(matchValue))
	if value == "" {
		return nil
	}
	return []string{value}
}

func scanRoundRobin(row scanner) (RoundRobin, error) {
	var item RoundRobin
	var pipelineID, metadataRaw, createdBy pgtype.Text
	var pipelineSummaryID, pipelineName pgtype.Text
	var stageID, stageName, stageColor pgtype.Text
	var creatorID, creatorName, creatorEmail pgtype.Text

	if err := row.Scan(
		&item.ID,
		&item.OrganizationID,
		&item.Name,
		&item.IsActive,
		&item.LastAssignedIndex,
		&pipelineID,
		&metadataRaw,
		&createdBy,
		&item.CreatedAt,
		&item.UpdatedAt,
		&pipelineSummaryID,
		&pipelineName,
		&stageID,
		&stageName,
		&stageColor,
		&creatorID,
		&creatorName,
		&creatorEmail,
		&item.LeadsDistributed,
	); err != nil {
		return RoundRobin{}, err
	}

	metadata := parseObject(textValue(metadataRaw))
	item.TargetPipelineID = textValue(pipelineID)
	item.CreatedBy = textValue(createdBy)
	item.Strategy = stringFromObject(metadata, "strategy", "simple")
	item.TargetStageID = stringFromObject(metadata, "target_stage_id", "")
	item.Settings = objectFromObject(metadata, "settings")
	item.ReentryBehavior = stringFromObject(metadata, "reentry_behavior", "redistribute")
	item.Rules = []Rule{}
	item.Members = []Member{}

	if pipelineSummaryID.Valid {
		item.TargetPipeline = &PipelineSummary{
			ID:   pipelineSummaryID.String,
			Name: textValue(pipelineName),
		}
	}
	if stageID.Valid {
		item.TargetStage = &StageSummary{
			ID:    stageID.String,
			Name:  textValue(stageName),
			Color: textValue(stageColor),
		}
	}
	if creatorID.Valid {
		item.CreatedByUser = &UserSummary{
			ID:    creatorID.String,
			Name:  textValue(creatorName),
			Email: textValue(creatorEmail),
		}
	}

	return item, nil
}

func scanRule(row scanner) (Rule, error) {
	var rule Rule
	var matchRaw string
	if err := row.Scan(
		&rule.ID,
		&rule.RoundRobinID,
		&rule.MatchType,
		&rule.MatchValue,
		&matchRaw,
		&rule.Priority,
		&rule.IsActive,
		&rule.CreatedAt,
		&rule.UpdatedAt,
	); err != nil {
		return Rule{}, err
	}

	rule.Match = parseObject(matchRaw)
	return rule, nil
}

func scanMember(row scanner) (Member, error) {
	var member Member
	var weight pgtype.Int4
	var memberUserID, teamID, userID, userName, userEmail, avatarURL pgtype.Text
	if err := row.Scan(
		&member.ID,
		&member.RoundRobinID,
		&memberUserID,
		&teamID,
		&member.Position,
		&weight,
		&member.IsActive,
		&userID,
		&userName,
		&userEmail,
		&avatarURL,
		&member.LeadsCount,
	); err != nil {
		return Member{}, err
	}

	member.UserID = textValue(memberUserID)
	member.TeamID = textValue(teamID)
	if weight.Valid {
		member.Weight = int(weight.Int32)
	}
	if member.Weight == 0 {
		member.Weight = 1
	}
	if userID.Valid {
		member.User = &UserSummary{
			ID:        userID.String,
			Name:      textValue(userName),
			Email:     textValue(userEmail),
			AvatarURL: textValue(avatarURL),
		}
	}
	return member, nil
}

func buildMetadata(strategy string, targetStageID *string, settings map[string]any, reentryBehavior string) map[string]any {
	metadata := map[string]any{
		"strategy":         strategy,
		"settings":         normalizeObject(settings),
		"reentry_behavior": reentryBehavior,
	}
	if targetStageID != nil {
		metadata["target_stage_id"] = *targetStageID
	}
	return metadata
}

func rulePayload(matchType string, matchValue string, match map[string]any) map[string]any {
	return map[string]any{
		"match_type":  matchType,
		"match_value": matchValue,
		"match":       normalizeObject(match),
	}
}

func parseObject(raw string) map[string]any {
	if strings.TrimSpace(raw) == "" {
		return map[string]any{}
	}
	out := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return map[string]any{}
	}
	return out
}

func cloneObject(value map[string]any) map[string]any {
	out := map[string]any{}
	for key, item := range value {
		out[key] = item
	}
	return out
}

func stringFromObject(value map[string]any, key string, fallback string) string {
	raw, ok := value[key].(string)
	if !ok || raw == "" {
		return fallback
	}
	return raw
}

func stringPointerFromMetadata(value map[string]any, key string) *string {
	raw := stringFromObject(value, key, "")
	if raw == "" {
		return nil
	}
	return &raw
}

func objectFromObject(value map[string]any, key string) map[string]any {
	raw, ok := value[key].(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return raw
}

func valueOrNil[T any](value *T) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullable(value *string) any {
	if value == nil || *value == "" {
		return nil
	}
	return *value
}

func textValue(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func jsonb(value any) string {
	payload, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(payload)
}

func canManageRoundRobinScope(tenantContext tenant.Context) bool {
	return canManageRoundRobins(tenantContext)
}

func canManageRoundRobins(tenantContext tenant.Context) bool {
	if tenantContext.IsSuperAdmin || tenantContext.HasRole("owner", "admin") {
		return true
	}
	return tenantContext.HasPermission(permissions.DistributionManage)
}

func ensureRoundRobinInputInScope(tenantContext tenant.Context, pipelineID *string, members []memberInput, membersSet bool, requirePipeline bool) error {
	if canManageRoundRobins(tenantContext) {
		return nil
	}
	if !tenantContext.IsTeamLeader {
		return tenant.ErrOrganizationAccessDenied
	}
	if requirePipeline {
		if pipelineID == nil || !tenantContext.LeadsPipeline(*pipelineID) {
			return tenant.ErrOrganizationAccessDenied
		}
	} else if pipelineID != nil && !tenantContext.LeadsPipeline(*pipelineID) {
		return tenant.ErrOrganizationAccessDenied
	}
	if !membersSet {
		return nil
	}
	if len(members) == 0 {
		return tenant.ErrOrganizationAccessDenied
	}
	for _, member := range members {
		if member.TeamID != nil {
			if member.UserID == nil && !tenantContext.LeadsTeam(*member.TeamID) {
				return tenant.ErrOrganizationAccessDenied
			}
			if member.UserID != nil && !tenantContext.LeadsTeam(*member.TeamID) {
				return tenant.ErrOrganizationAccessDenied
			}
			if member.UserID == nil {
				continue
			}
		}
		if member.UserID == nil || !tenantContext.LeadsUser(*member.UserID) {
			return tenant.ErrOrganizationAccessDenied
		}
	}
	return nil
}

func leadershipRoundRobinCondition(tenantContext tenant.Context, alias string, args *[]any) string {
	conditions := []string{}
	if tenantContext.UserID != "" {
		*args = append(*args, tenantContext.UserID)
		conditions = append(conditions, fmt.Sprintf("%s.created_by = $%d::uuid", alias, len(*args)))
	}
	if len(tenantContext.LedPipelineIDs) > 0 {
		conditions = append(conditions, fmt.Sprintf("%s.pipeline_id in (%s)", alias, appendUUIDPlaceholders(args, tenantContext.LedPipelineIDs)))
	}
	if len(tenantContext.LedTeamIDs) > 0 {
		conditions = append(conditions, fmt.Sprintf(`exists (
			select 1
			from public.round_robin_members scoped_rrm
			where scoped_rrm.organization_id = %s.organization_id
			  and scoped_rrm.round_robin_id = %s.id
			  and coalesce(scoped_rrm.is_active, true) = true
			  and scoped_rrm.team_id in (%s)
		)`, alias, alias, appendUUIDPlaceholders(args, tenantContext.LedTeamIDs)))
	}
	if len(tenantContext.LedUserIDs) > 0 {
		conditions = append(conditions, fmt.Sprintf(`exists (
			select 1
			from public.round_robin_members scoped_rrm
			where scoped_rrm.organization_id = %s.organization_id
			  and scoped_rrm.round_robin_id = %s.id
			  and coalesce(scoped_rrm.is_active, true) = true
			  and scoped_rrm.user_id in (%s)
		)`, alias, alias, appendUUIDPlaceholders(args, tenantContext.LedUserIDs)))
	}
	if len(conditions) == 0 {
		return "false"
	}
	return "(" + strings.Join(conditions, " or ") + ")"
}

func appendUUIDPlaceholders(args *[]any, values []string) string {
	placeholders := make([]string, 0, len(values))
	for _, value := range values {
		*args = append(*args, value)
		placeholders = append(placeholders, fmt.Sprintf("$%d::uuid", len(*args)))
	}
	if len(placeholders) == 0 {
		return "null"
	}
	return strings.Join(placeholders, ", ")
}

func (repo Repository) ensureRoundRobinVisible(ctx context.Context, q queryer, tenantContext tenant.Context, roundRobinID string) error {
	if canManageRoundRobins(tenantContext) {
		return repo.ensureRoundRobin(ctx, q, tenantContext.OrganizationID, roundRobinID)
	}
	if !tenantContext.IsTeamLeader {
		return tenant.ErrOrganizationAccessDenied
	}
	args := []any{tenantContext.OrganizationID, roundRobinID}
	condition := leadershipRoundRobinCondition(tenantContext, "rr", &args)
	var exists bool
	if err := q.QueryRow(ctx, `
		select exists (
			select 1
			from public.round_robins rr
			where rr.organization_id = $1::uuid
			  and rr.id = $2::uuid
			  and `+condition+`
		)
	`, args...).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrRoundRobinNotFound
	}
	return nil
}

func (repo Repository) ensureRoundRobinMutable(ctx context.Context, q queryer, tenantContext tenant.Context, roundRobinID string) error {
	return repo.ensureRoundRobinVisible(ctx, q, tenantContext, roundRobinID)
}

func (repo Repository) ensureRoundRobinMemberMutable(ctx context.Context, q queryer, tenantContext tenant.Context, memberID string) (string, error) {
	var roundRobinID string
	err := q.QueryRow(ctx, `
		select round_robin_id::text
		from public.round_robin_members
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, memberID).Scan(&roundRobinID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrMemberNotFound
	}
	if err != nil {
		return "", err
	}
	if err := repo.ensureRoundRobinMutable(ctx, q, tenantContext, roundRobinID); err != nil {
		return "", err
	}
	if _, err := repo.getStateForUpdate(ctx, q, tenantContext.OrganizationID, roundRobinID); err != nil {
		return "", err
	}
	return roundRobinID, nil
}

func (repo Repository) visibleRoundRobinIDSet(ctx context.Context, tenantContext tenant.Context) (map[string]bool, error) {
	if canManageRoundRobins(tenantContext) {
		return nil, nil
	}
	if !tenantContext.IsTeamLeader {
		return map[string]bool{}, nil
	}
	args := []any{tenantContext.OrganizationID}
	condition := leadershipRoundRobinCondition(tenantContext, "rr", &args)
	rows, err := repo.db.Pool().Query(ctx, `
		select rr.id::text
		from public.round_robins rr
		where rr.organization_id = $1::uuid
		  and `+condition+`
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		result[id] = true
	}
	return result, rows.Err()
}
