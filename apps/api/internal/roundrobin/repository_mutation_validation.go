package roundrobin

import (
	"context"
	"fmt"
	"strings"
)

// Take the organization rule-domain lock before any queue locks. A queue row
// lock alone cannot serialize two different queues choosing the same criterion.
func lockConditionDomain(ctx context.Context, q queryer, organizationID string) error {
	_, err := q.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended('round_robin_conditions:' || $1::text, 0))`, organizationID)
	if err != nil {
		return err
	}
	// Managed inbound priority synchronization touches other queue parents.
	// Teams synchronize subsets in this same UUID order. Take parent locks before
	// any child/membership locks so those operations cannot create a lock cycle.
	rows, err := q.Query(ctx, `select id from public.round_robins where organization_id = $1::uuid and deleted_at is null order by id for update`, organizationID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
	}
	return rows.Err()
}

func (repo Repository) validateQueueParticipants(ctx context.Context, q queryer, organizationID, roundRobinID string) error {
	var active bool
	var count int
	if err := q.QueryRow(ctx, `
 select coalesce(rr.is_active, true), (
   select count(*)::int from public.round_robin_members rrm
   where rrm.organization_id = rr.organization_id and rrm.round_robin_id = rr.id
     and `+memberEffectiveActiveSQL+`
 ) from public.round_robins rr
 where rr.organization_id = $1::uuid and rr.id = $2::uuid
 `, organizationID, roundRobinID).Scan(&active, &count); err != nil {
		return err
	}
	if active && count == 0 {
		return fmt.Errorf("%w: an active queue requires at least one active participant", ErrInvalidInput)
	}
	state, err := repo.getStateForUpdate(ctx, q, organizationID, roundRobinID)
	if err != nil {
		return err
	}
	return repo.validateRedistributionCapacity(ctx, q, organizationID, roundRobinID, objectFromObject(state.Metadata, "settings"))
}

// Validate catalog-backed conditions on the server too. Existing, unchanged
// rules are retained by reconciliation so a stale reference can be removed.
func (repo Repository) validateRuleReferences(ctx context.Context, q queryer, organizationID string, rules []ruleInput) error {
	for _, rule := range rules {
		if err := validateNewRuleValueBounds(rule); err != nil {
			return err
		}
		values := ruleMatchValues(rule.MatchType, rule.MatchValue)
		switch canonicalRuleMatchType(rule.MatchType) {
		case "source", "city", "website_category", "campaign_contains", "meta_form", "form", "whatsapp_message_contains", "all", "any":
			// Free text and Meta/managed WhatsApp have their own contract validation.
		case "tag", "property", "interest_property", "webhook", "whatsapp_session":
			table := map[string]string{"tag": "tags", "property": "properties", "interest_property": "properties", "webhook": "webhooks_integrations", "whatsapp_session": "whatsapp_sessions"}[canonicalRuleMatchType(rule.MatchType)]
			for _, raw := range values {
				id, ok := normalizeUUID(raw)
				if !ok {
					return fmt.Errorf("%w: invalid %s criterion", ErrInvalidReference, rule.MatchType)
				}
				var exists bool
				if err := q.QueryRow(ctx, `select exists(select 1 from public.`+table+` where organization_id = $1::uuid and id = $2::uuid)`, organizationID, id).Scan(&exists); err != nil {
					return err
				}
				if !exists {
					return fmt.Errorf("%w: %s criterion is unavailable", ErrInvalidReference, rule.MatchType)
				}
			}
		default:
			if strings.TrimSpace(rule.MatchType) == "" {
				return ErrInvalidInput
			}
			return fmt.Errorf("%w: unsupported new condition type", ErrInvalidInput)
		}
	}
	return nil
}
