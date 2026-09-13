package financial

import (
	"context"
	"fmt"
	"math"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func ensureCommissionRegenerationSafe(ctx context.Context, exec execer, organizationID string, contractID string) error {
	queries := []string{
		`select coalesce(bool_or(status in ('approved', 'aprovada', 'paid', 'paga')), false)
		 from (
			select coalesce(status, '') as status
			from public.commissions
			where organization_id = $1::uuid
			  and contract_id = $2::uuid
			for update
		 ) locked_commissions`,
		`select coalesce(bool_or(status in ('approved', 'aprovada', 'paid', 'paga')), false)
		 from (
			select coalesce(status, '') as status
			from public.financial_entries
			where organization_id = $1::uuid
			  and contract_id = $2::uuid
			  and category in ('Comissão', 'Comissao')
			for update
		 ) locked_entries`,
	}
	for _, query := range queries {
		var protected bool
		if err := exec.QueryRow(ctx, query, organizationID, contractID).Scan(&protected); err != nil {
			return err
		}
		if protected {
			return ErrConflict
		}
	}
	return nil
}

func createContractReceivables(ctx context.Context, exec execer, tenantContext tenant.Context, contractID string, contractNumber string, totalValue float64, downPayment float64, installments int) error {
	totalCents, ok := financialAmountToCents(totalValue)
	if !ok || totalCents <= 0 {
		return ErrInvalidInput
	}
	downPaymentCents, ok := financialAmountToCents(downPayment)
	if !ok {
		return ErrInvalidInput
	}
	installmentCents, err := splitFinancialCents(totalCents, downPaymentCents, installments)
	if err != nil {
		return err
	}
	if downPaymentCents > 0 {
		if _, err := exec.Exec(ctx, `
			insert into public.financial_entries (
				organization_id, contract_id, type, category, description, amount, due_date, status,
				installment_number, total_installments, created_by
			)
			values ($1::uuid, $2::uuid, 'receivable', 'Entrada', $3, $4, current_date, 'pending', 0, $5, $6::uuid)
		`, tenantContext.OrganizationID, contractID, "Entrada - Contrato "+contractNumber, financialAmountFromCents(downPaymentCents), installments, tenantContext.UserID); err != nil {
			return err
		}
	}
	for index, amountCents := range installmentCents {
		installmentNumber := index + 1
		if _, err := exec.Exec(ctx, `
			insert into public.financial_entries (
				organization_id, contract_id, type, category, description, amount, due_date, status,
				installment_number, total_installments, created_by
			)
			values (
				$1::uuid, $2::uuid, 'receivable', 'Parcela', $3, $4::numeric,
				(current_date + make_interval(months => $5::int))::date,
				'pending', $5, $6, $7::uuid
			)
		`, tenantContext.OrganizationID, contractID, fmt.Sprintf("Parcela %d/%d - Contrato %s", installmentNumber, len(installmentCents), contractNumber), financialAmountFromCents(amountCents), installmentNumber, len(installmentCents), tenantContext.UserID); err != nil {
			return err
		}
	}
	return nil
}

func regenerateContractCommissions(ctx context.Context, exec execer, tenantContext tenant.Context, contract map[string]any, brokers []map[string]any) (map[string]any, error) {
	contractID := stringValue(contract["id"])
	totalValue := numberValue(contract["value"])
	propertyID := nullableString(contract["property_id"])
	if _, err := exec.Exec(ctx, `
		update public.commissions
		set status = 'cancelled',
		    notes = case
		      when nullif(trim(notes), '') is null then 'Substituída por regeneração'
		      else notes || E'\nSubstituída por regeneração'
		    end,
		    updated_at = now()
		where organization_id = $1::uuid
		  and contract_id = $2::uuid
		  and coalesce(status, '') not in ('cancelled', 'cancelada')
	`, tenantContext.OrganizationID, contractID); err != nil {
		return nil, err
	}
	if _, err := exec.Exec(ctx, `
		update public.financial_entries
		set status = 'cancelled',
		    notes = case
		      when nullif(trim(notes), '') is null then 'Substituído por regeneração de comissões'
		      else notes || E'\nSubstituído por regeneração de comissões'
		    end,
		    updated_at = now()
		where organization_id = $1::uuid
		  and contract_id = $2::uuid
		  and category in ('Comissão', 'Comissao')
		  and coalesce(status, '') not in ('cancelled', 'cancelada')
	`, tenantContext.OrganizationID, contractID); err != nil {
		return nil, err
	}
	totalCommissionValue := 0.0
	for _, broker := range brokers {
		userID := stringValue(broker["user_id"])
		percentage := numberValue(broker["commission_percentage"])
		calculated := totalValue * (percentage / 100)
		totalCommissionValue += calculated
		if _, err := exec.Exec(ctx, `
			insert into public.commissions (
				organization_id, contract_id, user_id, property_id, base_value, percentage,
				calculated_value, amount, status, forecast_date
			)
			values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $7, 'forecast', current_date)
		`, tenantContext.OrganizationID, contractID, userID, propertyID, totalValue, percentage, calculated); err != nil {
			return nil, err
		}
	}
	if totalCommissionValue > 0 {
		if _, err := exec.Exec(ctx, `
			insert into public.financial_entries (
				organization_id, contract_id, type, category, description, amount, due_date, status, created_by
			)
			values ($1::uuid, $2::uuid, 'payable', 'Comissão', $3, $4, current_date, 'pending', $5::uuid)
		`, tenantContext.OrganizationID, contractID, "Comissões - Contrato "+stringValue(contract["contract_number"]), totalCommissionValue, tenantContext.UserID); err != nil {
			return nil, err
		}
	}
	return map[string]any{
		"commissionsCount": len(brokers),
		"totalValue":       totalCommissionValue,
	}, nil
}

func financialAmountToCents(value float64) (int64, bool) {
	if value < 0 || math.IsNaN(value) || math.IsInf(value, 0) || value > 999_999_999_999.99 {
		return 0, false
	}
	return int64(math.Round(value * 100)), true
}

func financialAmountFromCents(value int64) string {
	return fmt.Sprintf("%d.%02d", value/100, value%100)
}

func splitFinancialCents(totalCents int64, downPaymentCents int64, installments int) ([]int64, error) {
	if totalCents <= 0 || downPaymentCents < 0 || downPaymentCents > totalCents || installments < 1 || installments > 360 {
		return nil, ErrInvalidInput
	}
	remainingCents := totalCents - downPaymentCents
	if remainingCents == 0 {
		return []int64{}, nil
	}
	if int64(installments) > remainingCents {
		return nil, ErrInvalidInput
	}

	base := remainingCents / int64(installments)
	remainder := remainingCents % int64(installments)
	values := make([]int64, installments)
	for index := range values {
		values[index] = base
		if int64(index) < remainder {
			values[index]++
		}
	}
	return values, nil
}
