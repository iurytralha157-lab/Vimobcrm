package roundrobin

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

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
	if err := repo.rejectPendingWhatsAppIntake(ctx, tx, tenantContext.OrganizationID, input.RoundRobinID); err != nil {
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
	if err := repo.rejectPendingWhatsAppIntake(ctx, tx, tenantContext.OrganizationID, current.RoundRobinID); err != nil {
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
	if _, err := repo.getStateForUpdate(ctx, tx, tenantContext.OrganizationID, current.RoundRobinID); err != nil {
		return err
	}
	if err := repo.rejectPendingWhatsAppIntake(ctx, tx, tenantContext.OrganizationID, current.RoundRobinID); err != nil {
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

func (repo Repository) listRules(ctx context.Context, organizationID string, roundRobinID *string) ([]Rule, error) {
	return listRulesWithQueryer(ctx, repo.db.Pool(), organizationID, roundRobinID)
}

func listRulesWithQueryer(ctx context.Context, q queryer, organizationID string, roundRobinID *string) ([]Rule, error) {
	args := []any{organizationID}
	where := "r.organization_id = $1::uuid"
	if roundRobinID != nil {
		args = append(args, *roundRobinID)
		where += " and r.round_robin_id = $2::uuid"
	}

	rows, err := q.Query(ctx, `
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
		join public.round_robins rr
		  on rr.organization_id = r.organization_id
		 and rr.id = r.round_robin_id
		where `+where+`
		  and rr.deleted_at is null
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
		join public.round_robins rr
		  on rr.organization_id = r.organization_id
		 and rr.id = r.round_robin_id
		where r.organization_id = $1::uuid
		  and r.id = $2::uuid
		  and rr.deleted_at is null
		limit 1
	`, organizationID, ruleID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Rule{}, ErrRuleNotFound
	}
	return rule, err
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
