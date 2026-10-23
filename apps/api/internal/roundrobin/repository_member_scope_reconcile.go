package roundrobin

import "github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"

// Preserve immutable participants in a shared queue, including their positions.
// Editable entries use free positions in their requested order; deleting an
// earlier editable row must never rewrite an out-of-scope participant.
func planMemberReconciliationInScope(context tenant.Context, existing []persistedMemberState, members []memberInput) (memberReconcilePlan, error) {
	members, err := inheritPersistedMemberIDs(existing, members)
	if err != nil {
		return memberReconcilePlan{}, err
	}
	plan, err := planMemberReconciliation(existing, members)
	if err != nil || canManageRoundRobins(context) {
		return plan, err
	}
	existingByID := make(map[string]persistedMemberState, len(existing))
	protectedPositions := map[int]bool{}
	for _, state := range existing {
		existingByID[state.ID] = state
		if ensureResolvedMemberInScope(context, state.UserID, state.TeamID) != nil {
			protectedPositions[state.Position] = true
		}
	}
	for _, id := range plan.Deletes {
		state := existingByID[id]
		if err := ensureResolvedMemberInScope(context, state.UserID, state.TeamID); err != nil {
			return memberReconcilePlan{}, err
		}
	}
	plan.Updates, plan.Inserts = nil, nil
	position := 0
	for _, candidate := range members {
		state, persisted := existingByID[candidate.ID]
		weight, active := candidate.Weight, true
		if persisted {
			weight, active = state.Weight, state.IsActive
			if candidate.WeightSet {
				weight = candidate.Weight
			}
		}
		if candidate.IsActive != nil {
			active = *candidate.IsActive
		}
		if persisted && ensureResolvedMemberInScope(context, state.UserID, state.TeamID) != nil {
			if weight != state.Weight || candidate.IsActive != nil {
				return memberReconcilePlan{}, tenant.ErrOrganizationAccessDenied
			}
			if state.Position >= position {
				position = state.Position + 1
			}
			continue
		}
		if err := ensureResolvedMemberInScope(context, candidate.UserID, candidate.TeamID); err != nil {
			return memberReconcilePlan{}, err
		}
		for protectedPositions[position] {
			position++
		}
		if position > 2147483647 {
			return memberReconcilePlan{}, ErrInvalidInput
		}
		mutation := memberReconcileMutation{ID: candidate.ID, UserID: cloneStringPointer(candidate.UserID), TeamID: cloneStringPointer(candidate.TeamID), Weight: weight, Position: position, IsActive: active, ActiveSet: candidate.IsActive != nil}
		if !persisted {
			plan.Inserts = append(plan.Inserts, mutation)
		} else if weight != state.Weight || position != state.Position || candidate.IsActive != nil {
			plan.Updates = append(plan.Updates, mutation)
		}
		position++
	}
	return plan, nil
}
