package leads

import (
	"fmt"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/financial"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Keep financial authorization independent from commercial ranking access.
// An unavailable amount is null, while an authorized empty amount remains zero.
func dashboardBrokerCommissionSQL(actor tenant.Context, fallback bool, args []any) (string, string, string, []any) {
	if !financial.CanReadDashboardFinancial(actor) {
		return "null::double precision as total_commissions", "", "", args
	}
	value := "0::double precision"
	join, group := "", ""
	ownerPlaceholder := ""
	if !financial.CanManageDashboardFinancial(actor) {
		args = append(args, actor.UserID)
		ownerPlaceholder = fmt.Sprintf("$%d", len(args))
	}
	if !fallback {
		value = "coalesce(c.total_commissions, 0)::double precision"
		join = dashboardTopBrokerCommissionJoinSQL(ownerPlaceholder)
		group = ", c.total_commissions"
	}
	if ownerPlaceholder != "" {
		value = "case when u.id = " + ownerPlaceholder + "::uuid then " + value + " else null::double precision end"
	}
	return value + " as total_commissions", join, group, args
}

// Reuse the ranking's visible, filtered lead cohort. The optional owner
// placeholder further restricts financial_view readers to their own commissions.
func dashboardTopBrokerCommissionJoinSQL(ownerPlaceholder string) string {
	ownerFilter := ""
	if ownerPlaceholder != "" {
		ownerFilter = " and cm.user_id = " + ownerPlaceholder + "::uuid"
	}
	return `
		left join (
			select cm.user_id, sum(coalesce(cm.amount, 0)) as total_commissions
			from public.commissions cm
			join filtered_leads visible_lead on visible_lead.id = cm.lead_id
			where cm.organization_id = $1::uuid
			  and cm.status in ('forecast', 'approved', 'paid', 'prevista', 'aprovada', 'paga')` + ownerFilter + `
			group by cm.user_id
		) c on c.user_id = u.id`
}
