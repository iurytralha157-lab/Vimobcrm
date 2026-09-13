package roundrobin

import (
	"context"
	"strings"
)

var uniqueConditionTypes = map[string]struct{}{
	"meta_form":                          {},
	"webhook":                            {},
	"whatsapp_session":                   {},
	whatsappMessageContainsConditionType: {},
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
