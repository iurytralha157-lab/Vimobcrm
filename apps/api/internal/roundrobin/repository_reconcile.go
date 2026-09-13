package roundrobin

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type persistedRuleState struct {
	ID         string
	MatchType  string
	MatchValue string
	Match      map[string]any
	Priority   int
	IsActive   bool
}

type ruleReconcileMutation struct {
	ID   string
	Rule ruleInput
}

type ruleReconcilePlan struct {
	Updates   []ruleReconcileMutation
	Inserts   []ruleInput
	Deletes   []string
	Effective []ruleInput
}

type persistedMemberState struct {
	ID       string
	UserID   *string
	TeamID   *string
	Weight   int
	Position int
	IsActive bool
}

type memberReconcileMutation struct {
	ID       string
	UserID   *string
	TeamID   *string
	Weight   int
	Position int
	IsActive bool
}

type memberReconcilePlan struct {
	Updates []memberReconcileMutation
	Inserts []memberReconcileMutation
	Deletes []string
}

func (repo Repository) reconcileRules(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	roundRobinID string,
	rules []ruleInput,
) (bool, error) {
	existing, err := loadPersistedRuleStates(ctx, tx, organizationID, roundRobinID)
	if err != nil {
		return false, err
	}
	rules, err = repo.classifyRuleInputIDs(ctx, tx, existing, rules)
	if err != nil {
		return false, err
	}
	plan, err := planRuleReconciliation(existing, rules)
	if err != nil {
		return false, err
	}
	if err := repo.checkConditionConflicts(ctx, tx, organizationID, &roundRobinID, plan.Effective); err != nil {
		return false, err
	}

	changed := false
	for _, ruleID := range plan.Deletes {
		if err := repo.deleteWhatsAppInboundRule(ctx, tx, organizationID, ruleID); err != nil {
			return false, err
		}
		commandTag, err := tx.Exec(ctx, `
			delete from public.round_robin_rules
			where organization_id = $1::uuid
			  and round_robin_id = $2::uuid
			  and id = $3::uuid
		`, organizationID, roundRobinID, ruleID)
		if err != nil {
			return false, err
		}
		if commandTag.RowsAffected() != 1 {
			return false, ErrInvalidReference
		}
		changed = true
	}

	for _, mutation := range plan.Updates {
		rule := mutation.Rule
		matchJSON := jsonb(normalizeObject(rule.Match))
		conditionsJSON := jsonb(rulePayload(rule.MatchType, rule.MatchValue, rule.Match))
		commandTag, err := tx.Exec(ctx, `
			update public.round_robin_rules
			set match_type = $4,
			    match_value = $5,
			    match = $6::jsonb,
			    name = $4,
			    conditions = $7::jsonb,
			    is_active = $8,
			    priority = $9,
			    updated_at = now()
			where organization_id = $1::uuid
			  and round_robin_id = $2::uuid
			  and id = $3::uuid
			  and (
			    coalesce(nullif(match_type, ''), conditions->>'match_type', name, '') is distinct from $4
			    or coalesce(nullif(match_value, ''), conditions->>'match_value', '') is distinct from $5
			    or coalesce(match, conditions->'match', '{}'::jsonb) is distinct from $6::jsonb
			    or coalesce(is_active, true) is distinct from $8
			    or coalesce(priority, 0) is distinct from $9
			  )
		`, organizationID, roundRobinID, mutation.ID, rule.MatchType, rule.MatchValue, matchJSON, conditionsJSON, rule.IsActive, rule.Priority)
		if err != nil {
			return false, err
		}
		changed = changed || commandTag.RowsAffected() > 0
	}

	for _, rule := range plan.Inserts {
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
		`, organizationID, roundRobinID, rule.MatchType, rule.MatchValue, jsonb(normalizeObject(rule.Match)), jsonb(rulePayload(rule.MatchType, rule.MatchValue, rule.Match)), rule.IsActive, rule.Priority); err != nil {
			return false, err
		}
		changed = true
	}

	return changed, nil
}

func loadPersistedRuleStates(
	ctx context.Context,
	q queryer,
	organizationID string,
	roundRobinID string,
) ([]persistedRuleState, error) {
	rows, err := q.Query(ctx, `
		select
			id::text,
			coalesce(nullif(match_type, ''), conditions->>'match_type', name, ''),
			coalesce(nullif(match_value, ''), conditions->>'match_value', ''),
			coalesce(match, conditions->'match', '{}'::jsonb)::text,
			coalesce(priority, 0),
			coalesce(is_active, true)
		from public.round_robin_rules
		where organization_id = $1::uuid
		  and round_robin_id = $2::uuid
		order by created_at asc, id asc
		for update
	`, organizationID, roundRobinID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	states := []persistedRuleState{}
	for rows.Next() {
		var state persistedRuleState
		var matchJSON string
		if err := rows.Scan(&state.ID, &state.MatchType, &state.MatchValue, &matchJSON, &state.Priority, &state.IsActive); err != nil {
			return nil, err
		}
		state.Match = parseObject(matchJSON)
		states = append(states, state)
	}
	return states, rows.Err()
}

func (repo Repository) classifyRuleInputIDs(
	ctx context.Context,
	q queryer,
	existing []persistedRuleState,
	rules []ruleInput,
) ([]ruleInput, error) {
	currentIDs := make(map[string]struct{}, len(existing))
	for _, state := range existing {
		currentIDs[state.ID] = struct{}{}
	}

	unknownIDs := []string{}
	seenUnknown := map[string]struct{}{}
	for _, candidate := range rules {
		if candidate.ID == "" {
			continue
		}
		if _, current := currentIDs[candidate.ID]; current {
			continue
		}
		if _, duplicate := seenUnknown[candidate.ID]; duplicate {
			continue
		}
		seenUnknown[candidate.ID] = struct{}{}
		unknownIDs = append(unknownIDs, candidate.ID)
	}
	if len(unknownIDs) == 0 {
		return append([]ruleInput(nil), rules...), nil
	}

	args := []any{}
	placeholders := appendUUIDPlaceholders(&args, unknownIDs)
	rows, err := q.Query(ctx, `
		select id::text
		from public.round_robin_rules
		where id in (`+placeholders+`)
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	persistedElsewhere := map[string]struct{}{}
	for rows.Next() {
		var ruleID string
		if err := rows.Scan(&ruleID); err != nil {
			return nil, err
		}
		persistedElsewhere[ruleID] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return classifyUnmatchedRuleIDs(currentIDs, persistedElsewhere, rules)
}

func classifyUnmatchedRuleIDs(
	currentIDs map[string]struct{},
	persistedElsewhere map[string]struct{},
	rules []ruleInput,
) ([]ruleInput, error) {
	classified := append([]ruleInput(nil), rules...)
	for index, candidate := range classified {
		if candidate.ID == "" {
			continue
		}
		if _, current := currentIDs[candidate.ID]; current {
			continue
		}
		if _, foreignOrStale := persistedElsewhere[candidate.ID]; foreignOrStale {
			return nil, fmt.Errorf("%w: rule id does not belong to this queue", ErrInvalidReference)
		}
		// The editor creates UUID-shaped client IDs for unsaved conditions. They
		// are correlation keys only; let Postgres generate the persisted UUID.
		candidate.ID = ""
		classified[index] = candidate
	}
	return classified, nil
}

func planRuleReconciliation(existing []persistedRuleState, rules []ruleInput) (ruleReconcilePlan, error) {
	plan := ruleReconcilePlan{
		Updates:   []ruleReconcileMutation{},
		Inserts:   []ruleInput{},
		Deletes:   []string{},
		Effective: []ruleInput{},
	}
	existingByID := make(map[string]persistedRuleState, len(existing))
	for _, state := range existing {
		existingByID[state.ID] = state
	}

	reserved := make(map[string]struct{}, len(rules))
	for _, candidate := range rules {
		if candidate.ID == "" {
			continue
		}
		if _, ok := existingByID[candidate.ID]; !ok {
			return ruleReconcilePlan{}, fmt.Errorf("%w: rule id does not belong to this queue", ErrInvalidReference)
		}
		if _, duplicate := reserved[candidate.ID]; duplicate {
			return ruleReconcilePlan{}, fmt.Errorf("%w: duplicate rule id", ErrInvalidInput)
		}
		reserved[candidate.ID] = struct{}{}
	}

	availableBySemantics := make(map[string][]string, len(existing))
	for _, state := range existing {
		if _, isReserved := reserved[state.ID]; isReserved {
			continue
		}
		key := ruleSemanticKey(state.MatchType, state.MatchValue, state.Match)
		availableBySemantics[key] = append(availableBySemantics[key], state.ID)
	}

	kept := make(map[string]struct{}, len(rules))
	for _, candidate := range rules {
		if candidate.ID == "" {
			key := ruleSemanticKey(candidate.MatchType, candidate.MatchValue, candidate.Match)
			if available := availableBySemantics[key]; len(available) > 0 {
				candidate.ID = available[0]
				availableBySemantics[key] = available[1:]
			} else {
				plan.Inserts = append(plan.Inserts, candidate)
				plan.Effective = append(plan.Effective, candidate)
				continue
			}
		}

		state, ok := existingByID[candidate.ID]
		if !ok {
			return ruleReconcilePlan{}, fmt.Errorf("%w: rule id does not belong to this queue", ErrInvalidReference)
		}
		if _, duplicate := kept[candidate.ID]; duplicate {
			return ruleReconcilePlan{}, fmt.Errorf("%w: duplicate rule id", ErrInvalidInput)
		}
		kept[candidate.ID] = struct{}{}

		if !candidate.PrioritySet {
			candidate.Priority = state.Priority
		}
		if !candidate.IsActiveSet {
			candidate.IsActive = state.IsActive
		}
		plan.Effective = append(plan.Effective, candidate)
		if !sameRuleSemantics(state, candidate) {
			plan.Updates = append(plan.Updates, ruleReconcileMutation{ID: state.ID, Rule: candidate})
		}
	}

	for _, state := range existing {
		if _, ok := kept[state.ID]; !ok {
			plan.Deletes = append(plan.Deletes, state.ID)
		}
	}
	return plan, nil
}

func sameRuleSemantics(state persistedRuleState, candidate ruleInput) bool {
	return state.MatchType == candidate.MatchType &&
		state.MatchValue == candidate.MatchValue &&
		jsonb(normalizeObject(state.Match)) == jsonb(normalizeObject(candidate.Match)) &&
		state.Priority == candidate.Priority &&
		state.IsActive == candidate.IsActive
}

func ruleSemanticKey(matchType string, matchValue string, match map[string]any) string {
	return matchType + "\x00" + matchValue + "\x00" + jsonb(normalizeObject(match))
}

func (repo Repository) reconcileMembers(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	roundRobinID string,
	members []memberInput,
	ignoreAvailability bool,
) (bool, error) {
	existing, err := loadPersistedMemberStates(ctx, tx, tenantContext.OrganizationID, roundRobinID)
	if err != nil {
		return false, err
	}
	existingByID := make(map[string]persistedMemberState, len(existing))
	for _, state := range existing {
		existingByID[state.ID] = state
	}
	members, err = inheritPersistedMemberIDs(existing, members)
	if err != nil {
		return false, err
	}

	resolved := make([]memberInput, 0, len(members))
	for _, member := range members {
		if member.ID != "" {
			state, ok := existingByID[member.ID]
			if !ok {
				return false, fmt.Errorf("%w: member id does not belong to this queue", ErrInvalidReference)
			}
			if !sameOptionalString(member.UserID, state.UserID) || !sameOptionalString(member.TeamID, state.TeamID) {
				return false, fmt.Errorf("%w: member id does not match its saved user/team context", ErrInvalidReference)
			}
			if err := ensureResolvedMemberInScope(tenantContext, state.UserID, state.TeamID); err != nil {
				return false, err
			}
			member.UserID = cloneStringPointer(state.UserID)
			member.TeamID = cloneStringPointer(state.TeamID)
			resolved = append(resolved, member)
			continue
		}

		_, userID, teamID, err := repo.resolveMemberEntry(
			ctx,
			tx,
			tenantContext.OrganizationID,
			member,
			ignoreAvailability,
		)
		if err != nil {
			return false, err
		}
		if err := ensureResolvedMemberInScope(tenantContext, userID, teamID); err != nil {
			return false, err
		}
		member.UserID = cloneStringPointer(userID)
		member.TeamID = cloneStringPointer(teamID)
		resolved = append(resolved, member)
	}

	plan, err := planMemberReconciliation(existing, resolved)
	if err != nil {
		return false, err
	}

	changed := false
	for _, memberID := range plan.Deletes {
		commandTag, err := tx.Exec(ctx, `
			delete from public.round_robin_members
			where organization_id = $1::uuid
			  and round_robin_id = $2::uuid
			  and id = $3::uuid
		`, tenantContext.OrganizationID, roundRobinID, memberID)
		if err != nil {
			return false, err
		}
		if commandTag.RowsAffected() != 1 {
			return false, ErrInvalidReference
		}
		changed = true
	}

	for _, mutation := range plan.Updates {
		commandTag, err := tx.Exec(ctx, `
			update public.round_robin_members
			set weight = $4,
			    position = $5,
			    updated_at = now()
			where organization_id = $1::uuid
			  and round_robin_id = $2::uuid
			  and id = $3::uuid
			  and (
			    coalesce(weight, 1) is distinct from $4
			    or coalesce(position, 0) is distinct from $5
			  )
		`, tenantContext.OrganizationID, roundRobinID, mutation.ID, mutation.Weight, mutation.Position)
		if err != nil {
			return false, err
		}
		changed = changed || commandTag.RowsAffected() > 0
	}

	for _, mutation := range plan.Inserts {
		if _, err := tx.Exec(ctx, `
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
		`, tenantContext.OrganizationID, roundRobinID, nullable(mutation.TeamID), nullable(mutation.UserID), mutation.Weight, mutation.Position); err != nil {
			return false, err
		}
		changed = true
	}

	return changed, nil
}

func loadPersistedMemberStates(
	ctx context.Context,
	q queryer,
	organizationID string,
	roundRobinID string,
) ([]persistedMemberState, error) {
	rows, err := q.Query(ctx, `
		select
			id::text,
			user_id::text,
			team_id::text,
			coalesce(weight, 1),
			coalesce(position, 0),
			coalesce(is_active, true)
		from public.round_robin_members
		where organization_id = $1::uuid
		  and round_robin_id = $2::uuid
		order by coalesce(position, 0) asc, created_at asc, id asc
		for update
	`, organizationID, roundRobinID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	states := []persistedMemberState{}
	for rows.Next() {
		var state persistedMemberState
		var userID, teamID pgtype.Text
		if err := rows.Scan(&state.ID, &userID, &teamID, &state.Weight, &state.Position, &state.IsActive); err != nil {
			return nil, err
		}
		if userID.Valid {
			state.UserID = cloneStringPointer(&userID.String)
		}
		if teamID.Valid {
			state.TeamID = cloneStringPointer(&teamID.String)
		}
		states = append(states, state)
	}
	return states, rows.Err()
}

func planMemberReconciliation(existing []persistedMemberState, members []memberInput) (memberReconcilePlan, error) {
	plan := memberReconcilePlan{
		Updates: []memberReconcileMutation{},
		Inserts: []memberReconcileMutation{},
		Deletes: []string{},
	}
	existingByID := make(map[string]persistedMemberState, len(existing))
	for _, state := range existing {
		existingByID[state.ID] = state
	}
	members, err := inheritPersistedMemberIDs(existing, members)
	if err != nil {
		return memberReconcilePlan{}, err
	}

	kept := make(map[string]struct{}, len(members))
	seenMembers := make(map[string]struct{}, len(members))
	for index, candidate := range members {
		memberKey, ok := reconciliationMemberUniqueKey(candidate.UserID, candidate.TeamID)
		if !ok {
			return memberReconcilePlan{}, ErrInvalidReference
		}
		if _, duplicate := seenMembers[memberKey]; duplicate {
			return memberReconcilePlan{}, fmt.Errorf("%w: duplicate queue member", ErrInvalidInput)
		}
		seenMembers[memberKey] = struct{}{}

		if candidate.ID == "" {
			plan.Inserts = append(plan.Inserts, memberReconcileMutation{
				UserID:   cloneStringPointer(candidate.UserID),
				TeamID:   cloneStringPointer(candidate.TeamID),
				Weight:   candidate.Weight,
				Position: index,
				IsActive: true,
			})
			continue
		}

		state := existingByID[candidate.ID]
		kept[candidate.ID] = struct{}{}
		desiredWeight := state.Weight
		if candidate.WeightSet {
			desiredWeight = candidate.Weight
		}
		if desiredWeight != state.Weight || index != state.Position {
			plan.Updates = append(plan.Updates, memberReconcileMutation{
				ID:       state.ID,
				UserID:   cloneStringPointer(state.UserID),
				TeamID:   cloneStringPointer(state.TeamID),
				Weight:   desiredWeight,
				Position: index,
				IsActive: state.IsActive,
			})
		}
	}

	for _, state := range existing {
		if _, ok := kept[state.ID]; !ok {
			plan.Deletes = append(plan.Deletes, state.ID)
		}
	}
	return plan, nil
}

func inheritPersistedMemberIDs(existing []persistedMemberState, members []memberInput) ([]memberInput, error) {
	existingByID := make(map[string]persistedMemberState, len(existing))
	reserved := make(map[string]struct{}, len(members))
	for _, state := range existing {
		existingByID[state.ID] = state
	}
	for _, candidate := range members {
		if candidate.ID == "" {
			continue
		}
		state, ok := existingByID[candidate.ID]
		if !ok {
			return nil, fmt.Errorf("%w: member id does not belong to this queue", ErrInvalidReference)
		}
		if _, duplicate := reserved[candidate.ID]; duplicate {
			return nil, fmt.Errorf("%w: duplicate member id", ErrInvalidInput)
		}
		if !sameOptionalString(candidate.UserID, state.UserID) || !sameOptionalString(candidate.TeamID, state.TeamID) {
			return nil, fmt.Errorf("%w: member id does not match its saved user/team context", ErrInvalidReference)
		}
		reserved[candidate.ID] = struct{}{}
	}

	available := make(map[string][]string, len(existing))
	for _, state := range existing {
		if _, isReserved := reserved[state.ID]; isReserved {
			continue
		}
		key, ok := reconciliationMemberIdentityKey(state.UserID, state.TeamID)
		if ok {
			available[key] = append(available[key], state.ID)
		}
	}

	associated := append([]memberInput(nil), members...)
	for index, candidate := range associated {
		if candidate.ID != "" {
			continue
		}
		key, ok := reconciliationMemberIdentityKey(candidate.UserID, candidate.TeamID)
		if !ok || len(available[key]) == 0 {
			continue
		}
		candidate.ID = available[key][0]
		available[key] = available[key][1:]
		associated[index] = candidate
	}
	return associated, nil
}

func reconciliationMemberIdentityKey(userID *string, teamID *string) (string, bool) {
	if userID != nil && *userID != "" {
		teamContext := "none"
		if teamID != nil && *teamID != "" {
			teamContext = *teamID
		}
		return "user:" + *userID + ":team:" + teamContext, true
	}
	if teamID != nil && *teamID != "" {
		return "team:" + *teamID, true
	}
	return "", false
}

func reconciliationMemberUniqueKey(userID *string, teamID *string) (string, bool) {
	if userID != nil && *userID != "" {
		// The database uniqueness contract is one direct-user row per queue,
		// independently of the team context attached to that row.
		return "user:" + *userID, true
	}
	return reconciliationMemberIdentityKey(userID, teamID)
}

func sameOptionalString(left *string, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func cloneStringPointer(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}
