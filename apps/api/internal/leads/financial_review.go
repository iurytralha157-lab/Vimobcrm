package leads

import "context"

// Called under the lead lock and before its commercial UPDATE. This only
// reports that existing finance records need review; it never modifies money,
// commissions, payments or contracts and exposes no amounts or beneficiaries.
func leadTransitionRequiresFinancialReview(ctx context.Context, tx leadTeamQueryer, organizationID string, current leadSnapshot, input updateInput) (bool, error) {
	if !input.DealStatus.Set || input.DealStatus.Value == nil || *input.DealStatus.Value == current.DealStatus {
		return false, nil
	}
	if current.DealStatus == "won" {
		return true, nil
	}
	if *input.DealStatus.Value != "won" {
		return false, nil
	}
	var exists bool
	err := tx.QueryRow(ctx, `select
		exists (select 1 from public.commissions where organization_id=$1::uuid and lead_id=$2::uuid)
		or exists (select 1 from public.financial_entries where organization_id=$1::uuid and lead_id=$2::uuid)
	`, organizationID, current.ID).Scan(&exists)
	return exists, err
}
