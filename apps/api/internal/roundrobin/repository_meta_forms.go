package roundrobin

import (
	"context"
)

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
