package financial

import "github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"

// CanReadDashboardFinancial applies the financial domain's existing module and
// read authorization to projections served by other domains. DashboardView
// alone never grants access to financial records.
func CanReadDashboardFinancial(actor tenant.Context) bool {
	return actor.IsOrganizationMember() && tenant.CanUseFinancialModule(actor) && canReadFinancial(actor)
}

// CanManageDashboardFinancial preserves the existing distinction between
// reading one's commissions and managing commissions across the organization.
func CanManageDashboardFinancial(actor tenant.Context) bool {
	return CanReadDashboardFinancial(actor) && canManageFinancial(actor)
}
