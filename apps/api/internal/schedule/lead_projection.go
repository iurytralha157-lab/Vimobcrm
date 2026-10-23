package schedule

import "github.com/vimob-crm/vimob-crm/apps/api/internal/leadscope"

// Event access and linked-lead access are independent. Aliases and placeholders
// are source constants, while the read flags come from the current actor.
func scheduleLeadJoinSQL(eventAlias, leadAlias, allPlaceholder, userPlaceholder, teamPlaceholder string, canViewOwn bool) string {
	return `left join public.leads ` + leadAlias + `
		on ` + leadAlias + `.id = ` + eventAlias + `.lead_id
		and ` + leadAlias + `.organization_id = ` + eventAlias + `.organization_id
		and ` + leadscope.VisibilitySQL(leadAlias, allPlaceholder, userPlaceholder, teamPlaceholder, canViewOwn)
}

func scheduleCanViewOwnLeadProjection(options []bool) bool {
	return len(options) > 0 && options[0]
}
