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

type roundRobinState struct {
	ID         string
	PipelineID *string
	Metadata   map[string]any
}

var uniqueConditionTypes = map[string]struct{}{
	"meta_form":        {},
	"webhook":          {},
	"whatsapp_session": {},
}

func NewRepository(db *dbpkg.Postgres) Repository {
	return Repository{db: db}
}

func (repo Repository) List(ctx context.Context, tenantContext tenant.Context) ([]RoundRobin, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select
			rr.id::text,
			rr.organization_id::text,
			rr.name,
			coalesce(rr.is_active, true),
			coalesce(rr.current_position, 0),
			rr.pipeline_id::text,
			coalesce(rr.rules, '{}'::jsonb)::text,
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
		 and p.id = rr.pipeline_id
		left join public.stages s
		  on s.organization_id = rr.organization_id
		 and s.id::text = rr.rules->>'target_stage_id'
		left join public.users creator
		  on creator.id = rr.created_by
		left join lateral (
			select count(*)::bigint as total
			from public.round_robin_logs rrl
			where rrl.organization_id = rr.organization_id
			  and rrl.round_robin_id = rr.id
		) logs on true
		where rr.organization_id = $1::uuid
		order by rr.created_at desc, rr.id desc
	`, tenantContext.OrganizationID)
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

	item, err := scanRoundRobin(repo.db.Pool().QueryRow(ctx, `
		select
			rr.id::text,
			rr.organization_id::text,
			rr.name,
			coalesce(rr.is_active, true),
			coalesce(rr.current_position, 0),
			rr.pipeline_id::text,
			coalesce(rr.rules, '{}'::jsonb)::text,
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
		 and p.id = rr.pipeline_id
		left join public.stages s
		  on s.organization_id = rr.organization_id
		 and s.id::text = rr.rules->>'target_stage_id'
		left join public.users creator
		  on creator.id = rr.created_by
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
	if !canManageRoundRobins(tenantContext) {
		return RoundRobin{}, tenant.ErrOrganizationAccessDenied
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return RoundRobin{}, err
	}
	defer tx.Rollback(ctx)

	if err := repo.validateDestination(ctx, tx, tenantContext.OrganizationID, input.TargetPipelineID, input.TargetStageID); err != nil {
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
			is_active,
			current_position,
			rules,
			created_by
		)
		values (
			$1::uuid,
			$2,
			$3::uuid,
			$4,
			0,
			$5::jsonb,
			$6::uuid
		)
		returning id::text
	`, tenantContext.OrganizationID, input.Name, nullable(input.TargetPipelineID), input.IsActive, jsonb(metadata), tenantContext.UserID).Scan(&roundRobinID)
	if err != nil {
		return RoundRobin{}, err
	}

	if err := repo.insertRules(ctx, tx, tenantContext.OrganizationID, roundRobinID, input.Rules); err != nil {
		return RoundRobin{}, err
	}
	if _, err := repo.insertMembers(ctx, tx, tenantContext.OrganizationID, roundRobinID, input.Members); err != nil {
		return RoundRobin{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return RoundRobin{}, err
	}

	return repo.Get(ctx, tenantContext, roundRobinID)
}

func (repo Repository) Update(ctx context.Context, tenantContext tenant.Context, roundRobinID string, input updateInput) (RoundRobin, error) {
	if !canManageRoundRobins(tenantContext) {
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
		addSet("pipeline_id = $%d::uuid", nullable(pipelineID))
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
		if _, err := repo.insertMembers(ctx, tx, tenantContext.OrganizationID, roundRobinID, input.Members); err != nil {
			return RoundRobin{}, err
		}
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

	if _, err := repo.getStateForUpdate(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
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
		if err := repo.ensureRoundRobin(ctx, repo.db.Pool(), tenantContext.OrganizationID, value); err != nil {
			return nil, err
		}
	}

	return repo.listRules(ctx, tenantContext.OrganizationID, roundRobinID)
}

func (repo Repository) CreateRule(ctx context.Context, tenantContext tenant.Context, input ruleMutationInput) (Rule, error) {
	if !canManageRoundRobins(tenantContext) {
		return Rule{}, tenant.ErrOrganizationAccessDenied
	}

	if err := repo.ensureRoundRobin(ctx, repo.db.Pool(), tenantContext.OrganizationID, input.RoundRobinID); err != nil {
		return Rule{}, err
	}
	if err := repo.checkConditionConflicts(ctx, repo.db.Pool(), tenantContext.OrganizationID, &input.RoundRobinID, []ruleInput{{
		MatchType:  input.MatchType,
		MatchValue: input.MatchValue,
		Match:      input.Match,
		Priority:   input.Priority,
		IsActive:   input.IsActive,
	}}); err != nil {
		return Rule{}, err
	}

	var ruleID string
	err := repo.db.Pool().QueryRow(ctx, `
		insert into public.round_robin_rules (
			organization_id,
			round_robin_id,
			name,
			conditions,
			is_active,
			priority
		)
		values (
			$1::uuid,
			$2::uuid,
			$3,
			$4::jsonb,
			$5,
			$6
		)
		returning id::text
	`, tenantContext.OrganizationID, input.RoundRobinID, input.MatchType, jsonb(rulePayload(input.MatchType, input.MatchValue, input.Match)), input.IsActive, input.Priority).Scan(&ruleID)
	if err != nil {
		return Rule{}, err
	}

	return repo.getRule(ctx, tenantContext.OrganizationID, ruleID)
}

func (repo Repository) UpdateRule(ctx context.Context, tenantContext tenant.Context, ruleID string, input updateRuleInput) (Rule, error) {
	if !canManageRoundRobins(tenantContext) {
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
	match := current.Match
	if match == nil {
		match = map[string]any{}
	}
	if input.MatchType.Set && input.MatchType.Value != nil {
		matchType = *input.MatchType.Value
	}
	if input.MatchValue.Set {
		matchValue = ""
		if input.MatchValue.Value != nil {
			matchValue = *input.MatchValue.Value
		}
	}
	if input.Match.Set {
		match = input.Match.Value
	}
	if len(match) == 0 && matchValue != "" {
		match = buildRuleMatch(matchType, splitValues(matchValue))
	}

	if err := repo.checkConditionConflicts(ctx, repo.db.Pool(), tenantContext.OrganizationID, &current.RoundRobinID, []ruleInput{{
		MatchType:  matchType,
		MatchValue: matchValue,
		Match:      match,
		Priority:   current.Priority,
		IsActive:   current.IsActive,
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
	}
	if input.Priority != nil {
		args = append(args, *input.Priority)
		setClauses = append(setClauses, fmt.Sprintf("priority = $%d", len(args)))
	}
	if input.IsActive.Set {
		args = append(args, valueOrNil(input.IsActive.Value))
		setClauses = append(setClauses, fmt.Sprintf("is_active = coalesce($%d::boolean, false)", len(args)))
	}

	commandTag, err := repo.db.Pool().Exec(ctx, `
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

	return repo.getRule(ctx, tenantContext.OrganizationID, ruleID)
}

func (repo Repository) DeleteRule(ctx context.Context, tenantContext tenant.Context, ruleID string) error {
	if !canManageRoundRobins(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}

	ruleID, ok := normalizeUUID(ruleID)
	if !ok {
		return ErrRuleNotFound
	}

	commandTag, err := repo.db.Pool().Exec(ctx, `
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
	return nil
}

func (repo Repository) AddMember(ctx context.Context, tenantContext tenant.Context, roundRobinID string, input memberMutationInput) ([]Member, error) {
	if !canManageRoundRobins(tenantContext) {
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

	if err := repo.ensureRoundRobin(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return nil, err
	}

	items := []memberInput{{
		Type:     input.Type,
		EntityID: input.EntityID,
		UserID:   input.UserID,
		TeamID:   input.TeamID,
		Weight:   input.Weight,
	}}
	ids, err := repo.insertMembers(ctx, tx, tenantContext.OrganizationID, roundRobinID, items)
	if err != nil {
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
	if !canManageRoundRobins(tenantContext) {
		return Member{}, tenant.ErrOrganizationAccessDenied
	}

	memberID, ok := normalizeUUID(memberID)
	if !ok {
		return Member{}, ErrMemberNotFound
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

	commandTag, err := repo.db.Pool().Exec(ctx, `
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

	return repo.getMember(ctx, tenantContext.OrganizationID, memberID)
}

func (repo Repository) DeleteMember(ctx context.Context, tenantContext tenant.Context, memberID string) error {
	if !canManageRoundRobins(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}

	memberID, ok := normalizeUUID(memberID)
	if !ok {
		return ErrMemberNotFound
	}

	commandTag, err := repo.db.Pool().Exec(ctx, `
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
	return nil
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
			coalesce(r.conditions->>'match_type', r.name, ''),
			coalesce(r.conditions->>'match_value', ''),
			coalesce(r.conditions->'match', '{}'::jsonb)::text,
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
			  and rrl.assigned_user_id = rrm.user_id
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
			coalesce(r.conditions->>'match_type', r.name, ''),
			coalesce(r.conditions->>'match_value', ''),
			coalesce(r.conditions->'match', '{}'::jsonb)::text,
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
			  and rrl.assigned_user_id = rrm.user_id
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
			pipeline_id::text,
			coalesce(rules, '{}'::jsonb)::text
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
				name,
				conditions,
				is_active,
				priority
			)
			values (
				$1::uuid,
				$2::uuid,
				$3,
				$4::jsonb,
				$5,
				$6
			)
		`, organizationID, roundRobinID, rule.MatchType, jsonb(rulePayload(rule.MatchType, rule.MatchValue, rule.Match)), rule.IsActive, priority); err != nil {
			return err
		}
	}
	return nil
}

func (repo Repository) insertMembers(ctx context.Context, tx pgx.Tx, organizationID string, roundRobinID string, members []memberInput) ([]string, error) {
	insertedIDs := []string{}
	seen := map[string]struct{}{}

	for _, member := range members {
		userIDs, err := repo.resolveMemberUserIDs(ctx, tx, organizationID, member)
		if err != nil {
			return nil, err
		}
		for _, userID := range userIDs {
			if _, exists := seen[userID]; exists {
				continue
			}
			seen[userID] = struct{}{}

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
					user_id,
					weight,
					position,
					is_active
				)
				values (
					$1::uuid,
					$2::uuid,
					$3::uuid,
					$4,
					$5,
					true
				)
				returning id::text
			`, organizationID, roundRobinID, userID, member.Weight, nextPosition).Scan(&insertedID)
			if err != nil {
				return nil, err
			}
			insertedIDs = append(insertedIDs, insertedID)
		}
	}

	return insertedIDs, nil
}

func (repo Repository) resolveMemberUserIDs(ctx context.Context, tx pgx.Tx, organizationID string, member memberInput) ([]string, error) {
	if member.UserID != nil {
		if err := repo.validateUser(ctx, tx, organizationID, *member.UserID); err != nil {
			return nil, err
		}
		return []string{*member.UserID}, nil
	}

	if member.TeamID == nil {
		return nil, ErrInvalidReference
	}

	rows, err := tx.Query(ctx, `
		select tm.user_id::text
		from public.team_members tm
		join public.organization_members om
		  on om.organization_id = tm.organization_id
		 and om.user_id = tm.user_id
		 and om.is_active = true
		join public.users u
		  on u.id = tm.user_id
		 and u.is_active = true
		where tm.organization_id = $1::uuid
		  and tm.team_id = $2::uuid
		  and coalesce(tm.is_active, true) = true
		order by tm.created_at asc
	`, organizationID, *member.TeamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	userIDs := []string{}
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return nil, err
		}
		userIDs = append(userIDs, userID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(userIDs) == 0 {
		return nil, ErrInvalidReference
	}
	return userIDs, nil
}

func (repo Repository) validateUser(ctx context.Context, q queryer, organizationID string, userID string) error {
	var exists bool
	err := q.QueryRow(ctx, `
		select exists (
			select 1
			from public.organization_members om
			join public.users u
			  on u.id = om.user_id
			 and u.is_active = true
			where om.organization_id = $1::uuid
			  and om.user_id = $2::uuid
			  and om.is_active = true
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

func (repo Repository) checkConditionConflicts(ctx context.Context, q queryer, organizationID string, excludeRoundRobinID *string, rules []ruleInput) error {
	wanted := map[string]struct{}{}
	for _, rule := range rules {
		if _, ok := uniqueConditionTypes[rule.MatchType]; !ok || !rule.IsActive {
			continue
		}
		for _, value := range splitValues(rule.MatchValue) {
			wanted[rule.MatchType+"::"+value] = struct{}{}
		}
	}
	if len(wanted) == 0 {
		return nil
	}

	rows, err := q.Query(ctx, `
		select
			rrr.round_robin_id::text,
			rr.name,
			coalesce(rrr.conditions, '{}'::jsonb)::text
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
		for _, value := range splitValues(matchValue) {
			if _, exists := wanted[matchType+"::"+value]; exists {
				return fmt.Errorf("%w: value already used in queue %q", ErrConditionConflict, queueName)
			}
		}
	}
	return rows.Err()
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
	var userID, userName, userEmail, avatarURL pgtype.Text
	if err := row.Scan(
		&member.ID,
		&member.RoundRobinID,
		&member.UserID,
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

func canManageRoundRobins(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin", "manager") ||
		tenantContext.HasPermission("lead_manage") ||
		tenantContext.HasPermission("lead_assign")
}
