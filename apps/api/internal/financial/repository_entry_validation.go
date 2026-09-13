package financial

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
)

type financialEntryMutationState struct {
	status   string
	category string
	paid     float64
}

func prepareFinancialEntryCreatePayload(payload map[string]any, userID string) error {
	if payload == nil || strings.TrimSpace(userID) == "" {
		return ErrInvalidInput
	}
	for _, serverOwnedField := range []string{"created_by", "paid_amount", "paid_value", "paid_date"} {
		if _, provided := payload[serverOwnedField]; provided {
			return ErrInvalidInput
		}
	}

	entryType := strings.ToLower(stringValue(payload["type"]))
	if entryType != "receivable" && entryType != "payable" {
		return ErrInvalidInput
	}
	category := stringValue(payload["category"])
	description := stringValue(payload["description"])
	if category == "" || description == "" {
		return ErrInvalidInput
	}
	amount, ok := finiteNumberValue(payload["amount"])
	if !ok || amount <= 0 {
		return ErrInvalidInput
	}
	dueDate := stringValue(payload["due_date"])
	if !isFinancialCalendarDate(dueDate) {
		return ErrInvalidInput
	}

	if rawStatus, provided := payload["status"]; provided && rawStatus != nil {
		status := strings.ToLower(stringValue(rawStatus))
		if status != "" && status != "pending" {
			return ErrInvalidInput
		}
	}
	if rawGroup, provided := payload["category_group"]; provided && rawGroup != nil {
		group := strings.ToLower(stringValue(rawGroup))
		if group != "" && !allowedString(group, "revenue", "tax_deduction", "variable_cost", "fixed_cost", "investment", "financial_result") {
			return ErrInvalidInput
		}
		if group != "" {
			payload["category_group"] = group
		}
	}
	if rawRecurring, provided := payload["is_recurring"]; provided && rawRecurring != nil {
		if _, ok := rawRecurring.(bool); !ok {
			return ErrInvalidInput
		}
	}
	recurringType := ""
	if rawRecurringType, provided := payload["recurring_type"]; provided && rawRecurringType != nil {
		recurringType = strings.ToLower(stringValue(rawRecurringType))
		if recurringType != "" && !allowedString(recurringType, "monthly", "weekly", "yearly") {
			return ErrInvalidInput
		}
		if recurringType != "" {
			payload["recurring_type"] = recurringType
		}
	}
	if recurring, _ := payload["is_recurring"].(bool); recurring && recurringType == "" {
		return ErrInvalidInput
	}

	installmentNumber, hasInstallmentNumber, err := optionalIntegerField(payload, "installment_number", 1, 360)
	if err != nil {
		return err
	}
	totalInstallments, hasTotalInstallments, err := optionalIntegerField(payload, "total_installments", 1, 360)
	if err != nil {
		return err
	}
	if hasInstallmentNumber && hasTotalInstallments && installmentNumber > totalInstallments {
		return ErrInvalidInput
	}

	payload["type"] = entryType
	payload["category"] = category
	payload["description"] = description
	payload["amount"] = amount
	payload["due_date"] = dueDate
	payload["status"] = "pending"
	payload["created_by"] = userID
	return nil
}

func lockMutableFinancialEntry(ctx context.Context, exec execer, organizationID string, id string) (financialEntryMutationState, error) {
	var state financialEntryMutationState
	err := exec.QueryRow(ctx, `
		select coalesce(status, 'pending'), coalesce(category, ''),
		       greatest(abs(coalesce(paid_amount, 0)), abs(coalesce(paid_value, 0)))::float8
		from public.financial_entries
		where organization_id = $1::uuid
		  and id = $2::uuid
		for update
	`, organizationID, id).Scan(&state.status, &state.category, &state.paid)
	if errors.Is(err, pgx.ErrNoRows) {
		return financialEntryMutationState{}, ErrNotFound
	}
	if err != nil {
		return financialEntryMutationState{}, err
	}
	normalizedStatus := normalizedFinancialEntryStatus(state.status)
	if normalizedStatus == "paid" || normalizedStatus == "partial" || state.paid > 0 || isCommissionFinancialCategory(state.category) {
		return financialEntryMutationState{}, ErrConflict
	}
	return state, nil
}

func validateFinancialEntryMutation(state financialEntryMutationState, payload map[string]any) error {
	if _, provided := payload["created_by"]; provided {
		return ErrInvalidInput
	}
	for _, field := range []string{"paid_amount", "paid_value", "paid_date"} {
		if _, exists := payload[field]; exists {
			return ErrConflict
		}
	}
	if value, exists := payload["status"]; exists {
		targetStatus := stringValue(value)
		if targetStatus == "" || normalizedFinancialEntryStatus(targetStatus) != normalizedFinancialEntryStatus(state.status) {
			return ErrConflict
		}
	}
	if value, exists := payload["category"]; exists && isCommissionFinancialCategory(stringValue(value)) {
		return ErrConflict
	}
	if value, exists := payload["type"]; exists {
		normalized := strings.ToLower(stringValue(value))
		if !allowedString(normalized, "receivable", "payable") {
			return ErrInvalidInput
		}
		payload["type"] = normalized
	}
	for _, field := range []string{"category", "description"} {
		if value, exists := payload[field]; exists && stringValue(value) == "" {
			return ErrInvalidInput
		}
	}
	if value, exists := payload["amount"]; exists {
		amount, ok := finiteNumberValue(value)
		if !ok || amount <= 0 {
			return ErrInvalidInput
		}
		payload["amount"] = amount
	}
	if value, exists := payload["due_date"]; exists && !isFinancialCalendarDate(stringValue(value)) {
		return ErrInvalidInput
	}
	if value, exists := payload["category_group"]; exists && value != nil {
		group := strings.ToLower(stringValue(value))
		if group != "" && !allowedString(group, "revenue", "tax_deduction", "variable_cost", "fixed_cost", "investment", "financial_result") {
			return ErrInvalidInput
		}
		payload["category_group"] = group
	}
	if value, exists := payload["is_recurring"]; exists && value != nil {
		if _, ok := value.(bool); !ok {
			return ErrInvalidInput
		}
	}
	if value, exists := payload["recurring_type"]; exists && value != nil {
		recurringType := strings.ToLower(stringValue(value))
		if recurringType != "" && !allowedString(recurringType, "monthly", "weekly", "yearly") {
			return ErrInvalidInput
		}
		payload["recurring_type"] = recurringType
	}
	installmentNumber, hasInstallmentNumber, err := optionalIntegerField(payload, "installment_number", 1, 360)
	if err != nil {
		return err
	}
	totalInstallments, hasTotalInstallments, err := optionalIntegerField(payload, "total_installments", 1, 360)
	if err != nil {
		return err
	}
	if hasInstallmentNumber && hasTotalInstallments && installmentNumber > totalInstallments {
		return ErrInvalidInput
	}
	return nil
}

func normalizedFinancialEntryStatus(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	switch value {
	case "", "pending", "pendente":
		return "pending"
	case "partial", "parcial":
		return "partial"
	case "paid", "paga":
		return "paid"
	case "overdue", "vencido":
		return "overdue"
	case "cancelled", "cancelada":
		return "cancelled"
	default:
		return value
	}
}

func isCommissionFinancialCategory(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	return value == "comissão" || value == "comissao"
}
