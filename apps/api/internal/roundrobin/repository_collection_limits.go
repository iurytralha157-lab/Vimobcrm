package roundrobin

import (
	"context"
	"fmt"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
)

const maxQueueMembers = distribution.MaxQueueParticipants
const maxQueueRules = 200

func validateNewQueueCollectionSizes(members []memberInput, rules []ruleInput) error {
	if len(members) > maxQueueMembers || len(rules) > maxQueueRules {
		return fmt.Errorf("%w: a new queue supports up to %d participants and %d rules", ErrInvalidInput, maxQueueMembers, maxQueueRules)
	}
	return nil
}

// Call only after the parent/domain lock. No concurrent append can race the
// count, and inactive entries count toward the editor's collection limit too.
func ensureQueueCollectionCanGrow(ctx context.Context, q queryer, organizationID, queueID string, members bool) error {
	table, maximum := "round_robin_rules", maxQueueRules
	if members {
		table, maximum = "round_robin_members", maxQueueMembers
	}
	var count int
	if err := q.QueryRow(ctx, `select count(*)::int from public.`+table+` where organization_id = $1::uuid and round_robin_id = $2::uuid`, organizationID, queueID).Scan(&count); err != nil {
		return err
	}
	if count >= maximum {
		return fmt.Errorf("%w: this queue already has the maximum of %d entries; remove an entry before adding another", ErrInvalidInput, maximum)
	}
	return nil
}

func validateRuleCollectionPlan(existing []persistedRuleState, plan ruleReconcilePlan) error {
	if len(plan.Effective) <= maxQueueRules {
		return nil
	}
	// Large legacy snapshots can be retained or reduced, never expanded or
	// rewritten under the exception. IDs are already verified by reconciliation.
	if len(existing) <= maxQueueRules || len(plan.Inserts) > 0 || len(plan.Updates) > 0 {
		return fmt.Errorf("%w: reduce the queue to at most %d rules before editing its remaining rules", ErrInvalidInput, maxQueueRules)
	}
	return nil
}

func ensureQueueCollectionCanChange(ctx context.Context, q queryer, organizationID, queueID string, members, changed bool) error {
	if !changed {
		return nil
	}
	table, maximum := "round_robin_rules", maxQueueRules
	if members {
		table, maximum = "round_robin_members", maxQueueMembers
	}
	var count int
	if err := q.QueryRow(ctx, `select count(*)::int from public.`+table+` where organization_id = $1::uuid and round_robin_id = $2::uuid`, organizationID, queueID).Scan(&count); err != nil {
		return err
	}
	if count > maximum {
		return fmt.Errorf("%w: reduce the queue to at most %d entries before editing its remaining entries", ErrInvalidInput, maximum)
	}
	return nil
}

func validateMemberPatchCollectionSize(ctx context.Context, q queryer, organizationID, queueID, memberID string, input updateMemberInput) error {
	var weight, position int
	var active bool
	if err := q.QueryRow(ctx, `select coalesce(weight, 1), coalesce(position, 0), coalesce(is_active, true) from public.round_robin_members where organization_id = $1::uuid and round_robin_id = $2::uuid and id = $3::uuid`, organizationID, queueID, memberID).Scan(&weight, &position, &active); err != nil {
		return err
	}
	changed := input.Weight != nil && *input.Weight != weight || input.Position != nil && *input.Position != position
	if input.IsActive.Set {
		requestedActive := input.IsActive.Value != nil && *input.IsActive.Value
		// An explicit activation may bind a new membership generation even if
		// the historical raw activity flag is already true.
		changed = changed || requestedActive || requestedActive != active
	}
	return ensureQueueCollectionCanChange(ctx, q, organizationID, queueID, true, changed)
}

func constrainLegacyMemberCollectionPlan(existing []persistedMemberState, members []memberInput, plan memberReconcilePlan) (memberReconcilePlan, error) {
	if len(members) <= maxQueueMembers {
		return plan, nil
	}
	if len(existing) <= maxQueueMembers || len(plan.Inserts) > 0 {
		return memberReconcilePlan{}, fmt.Errorf("%w: a queue supports at most %d participants", ErrInvalidInput, maxQueueMembers)
	}
	existingByID := map[string]persistedMemberState{}
	order := map[string]int{}
	for index, state := range existing {
		existingByID[state.ID], order[state.ID] = state, index
	}
	previous := -1
	for _, member := range members {
		state, found := existingByID[member.ID]
		if !found || order[member.ID] <= previous || member.IsActive != nil || (member.WeightSet && member.Weight != state.Weight) {
			return memberReconcilePlan{}, fmt.Errorf("%w: reduce the queue to at most %d participants before changing the remaining participants", ErrInvalidInput, maxQueueMembers)
		}
		previous = order[member.ID]
	}
	// Removal need not close position gaps in legacy rows. Leaving their saved
	// positions intact also keeps out-of-scope participants completely untouched.
	plan.Updates = nil
	return plan, nil
}
