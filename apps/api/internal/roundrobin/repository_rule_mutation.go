package roundrobin

import "context"

func updateReconciledRuleMetadata(ctx context.Context, q queryer, organizationID, queueID string, mutation ruleReconcileMutation) (bool, error) {
	// Priority/activation changes must preserve hybrid conditions and unrelated
	// legacy metadata byte-for-byte. No matcher column is written on this path.
	command, err := q.Exec(ctx, `
		update public.round_robin_rules
		set priority = $4, is_active = $5, updated_at = now()
		where organization_id = $1::uuid and round_robin_id = $2::uuid and id = $3::uuid
		  and (coalesce(priority, 0) is distinct from $4 or coalesce(is_active, true) is distinct from $5)
	`, organizationID, queueID, mutation.ID, mutation.Rule.Priority, mutation.Rule.IsActive)
	return command.RowsAffected() > 0, err
}
