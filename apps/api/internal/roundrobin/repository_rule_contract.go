package roundrobin

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

const maxNewRuleMatchValueLength = 18_099 // 100 values of 180 runes, plus separators.
const campaignLiteralValuesKey = "campaign_name_contains_literals"

func newRuleMatcherValues(matchType, matchValue string) []string {
	if canonicalRuleMatchType(matchType) == "campaign_contains" {
		return []string{strings.TrimSpace(matchValue)}
	}
	return ruleMatchValues(matchType, matchValue)
}

func canonicalRuleMatchType(value string) string {
	value = strings.TrimSpace(value)
	if strings.EqualFold(value, "form") || strings.EqualFold(value, "meta_form") {
		return "meta_form"
	}
	return value
}

func prepareNewRuleMatcher(rule ruleInput) (ruleInput, error) {
	if canonicalRuleMatchType(rule.MatchType) != "campaign_contains" {
		return rule, nil
	}
	if _, present := rule.Match[campaignLiteralValuesKey]; present {
		return rule, nil
	}
	value := strings.TrimSpace(rule.MatchValue)
	if value == "" {
		return ruleInput{}, fmt.Errorf("%w: a campaign criterion requires literal text", ErrInvalidInput)
	}
	rule.Match = cloneObject(rule.Match)
	rule.Match["campaign_name_contains"] = value
	rule.Match[campaignLiteralValuesKey] = []string{value}
	return rule, nil
}

func validateNewRuleValueBounds(rule ruleInput) error {
	if !rule.MatcherUnchanged && utf8.RuneCountInString(rule.MatchValue) > maxNewRuleMatchValueLength {
		return fmt.Errorf("%w: rule value exceeds %d characters", ErrInvalidInput, maxNewRuleMatchValueLength)
	}
	if canonicalRuleMatchType(rule.MatchType) != "campaign_contains" {
		return nil
	}
	raw, present := rule.Match[campaignLiteralValuesKey]
	if !present {
		return nil
	} // Legacy CSV keeps its established meaning.
	values := []string{}
	switch typed := raw.(type) {
	case []string:
		values = typed
	case []any:
		for _, item := range typed {
			text, ok := item.(string)
			if !ok {
				return fmt.Errorf("%w: campaign literals must be strings", ErrInvalidInput)
			}
			values = append(values, text)
		}
	default:
		return fmt.Errorf("%w: campaign literals must be an array", ErrInvalidInput)
	}
	if len(values) == 0 || len(values) > 100 {
		return fmt.Errorf("%w: campaign literals must contain 1 to 100 values", ErrInvalidInput)
	}
	length := len(values) - 1
	for _, value := range values {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%w: campaign literal cannot be empty", ErrInvalidInput)
		}
		length += utf8.RuneCountInString(value)
	}
	if !rule.MatcherUnchanged && length > maxNewRuleMatchValueLength {
		return fmt.Errorf("%w: campaign literals exceed the supported length", ErrInvalidInput)
	}
	return nil
}

func prepareRulePlanMatchers(existing []persistedRuleState, plan ruleReconcilePlan) (ruleReconcilePlan, error) {
	existingByID := map[string]persistedRuleState{}
	for _, state := range existing {
		existingByID[state.ID] = state
	}
	preparedByID := map[string]ruleInput{}
	for index, rule := range plan.Inserts {
		prepared, err := prepareNewRuleMatcher(rule)
		if err != nil {
			return ruleReconcilePlan{}, err
		}
		plan.Inserts[index] = prepared
	}
	for index, mutation := range plan.Updates {
		if sameRuleMatcher(existingByID[mutation.ID], mutation.Rule) {
			continue
		}
		prepared, err := prepareNewRuleMatcher(mutation.Rule)
		if err != nil {
			return ruleReconcilePlan{}, err
		}
		plan.Updates[index].Rule, preparedByID[mutation.ID] = prepared, prepared
	}
	insert := 0
	for index, rule := range plan.Effective {
		if rule.ID == "" {
			plan.Effective[index] = plan.Inserts[insert]
			insert++
		} else if prepared, present := preparedByID[rule.ID]; present {
			plan.Effective[index] = prepared
		}
	}
	return plan, nil
}
