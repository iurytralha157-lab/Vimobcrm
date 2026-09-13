package financial

import (
	"context"
	"errors"
	"math"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type contractValidationState struct {
	value        float64
	downPayment  float64
	installments int
}

func validateContractPayload(payload map[string]any, brokers []map[string]any, create bool, current *contractValidationState) error {
	if payload == nil {
		return ErrInvalidInput
	}
	if create {
		for _, serverOwnedField := range []string{"created_by", "contract_number"} {
			if _, provided := payload[serverOwnedField]; provided {
				return ErrInvalidInput
			}
		}
	} else {
		if current == nil {
			return ErrInvalidInput
		}
		for _, immutableField := range []string{"status", "created_by", "contract_number"} {
			if _, provided := payload[immutableField]; provided {
				return ErrInvalidInput
			}
		}
	}

	contractType, hasContractType := payload["contract_type"]
	if create && (!hasContractType || stringValue(contractType) == "") {
		return ErrInvalidInput
	}
	if hasContractType {
		normalizedType := strings.ToLower(stringValue(contractType))
		if !allowedString(normalizedType, "sale", "rent", "rental", "service") {
			return ErrInvalidInput
		}
		payload["contract_type"] = normalizedType
	}
	clientName, hasClientName := payload["client_name"]
	if create && (!hasClientName || stringValue(clientName) == "") {
		return ErrInvalidInput
	}
	if hasClientName {
		name := stringValue(clientName)
		if name == "" {
			return ErrInvalidInput
		}
		payload["client_name"] = name
	}

	if rawPercentage, provided := payload["commission_percentage"]; provided && rawPercentage != nil {
		percentage, ok := finiteNumberValue(rawPercentage)
		if !ok || percentage < 0 || percentage > 100 {
			return ErrInvalidInput
		}
		payload["commission_percentage"] = percentage
	}
	if rawCommissionValue, provided := payload["commission_value"]; provided && rawCommissionValue != nil {
		commissionValue, ok := finiteNumberValue(rawCommissionValue)
		if !ok {
			return ErrInvalidInput
		}
		if _, valid := financialAmountToCents(commissionValue); !valid {
			return ErrInvalidInput
		}
		payload["commission_value"] = commissionValue
	}
	if err := validateContractBrokers(brokers); err != nil {
		return err
	}

	relationsChanged := create
	for _, key := range []string{"value", "down_payment", "installments"} {
		if _, provided := payload[key]; provided {
			relationsChanged = true
		}
	}
	if !relationsChanged {
		return nil
	}

	value := 0.0
	downPayment := 0.0
	installments := 1
	if current != nil {
		value = current.value
		downPayment = current.downPayment
		installments = current.installments
	}
	if rawValue, provided := payload["value"]; provided {
		parsed, ok := finiteNumberValue(rawValue)
		if !ok || parsed <= 0 {
			return ErrInvalidInput
		}
		value = parsed
		payload["value"] = parsed
	} else if create {
		return ErrInvalidInput
	}
	if rawDownPayment, provided := payload["down_payment"]; provided {
		if isNilOrEmptyString(rawDownPayment) {
			downPayment = 0
		} else {
			parsed, ok := finiteNumberValue(rawDownPayment)
			if !ok || parsed < 0 {
				return ErrInvalidInput
			}
			downPayment = parsed
			payload["down_payment"] = parsed
		}
	}
	if rawInstallments, provided := payload["installments"]; provided {
		if isNilOrEmptyString(rawInstallments) {
			installments = 0
		} else {
			parsed, ok := integerValue(rawInstallments)
			if !ok || parsed < 1 || parsed > 360 {
				return ErrInvalidInput
			}
			installments = parsed
			payload["installments"] = parsed
		}
	}

	valueCents, ok := financialAmountToCents(value)
	if !ok || valueCents <= 0 {
		return ErrInvalidInput
	}
	downPaymentCents, ok := financialAmountToCents(downPayment)
	if !ok || downPaymentCents > valueCents {
		return ErrInvalidInput
	}
	remainingCents := valueCents - downPaymentCents
	if remainingCents > 0 {
		effectiveInstallments := installments
		if effectiveInstallments == 0 {
			effectiveInstallments = 1
		}
		if effectiveInstallments < 1 || effectiveInstallments > 360 || int64(effectiveInstallments) > remainingCents {
			return ErrInvalidInput
		}
	}
	return nil
}

func lockDraftContractValidationState(ctx context.Context, exec execer, organizationID string, id string) (contractValidationState, error) {
	var state contractValidationState
	var status string
	err := exec.QueryRow(ctx, `
		select coalesce(status, ''), coalesce(value, 0)::float8,
		       coalesce(down_payment, 0)::float8, coalesce(installments, 0)
		from public.contracts
		where organization_id = $1::uuid
		  and id = $2::uuid
		for update
	`, organizationID, id).Scan(&status, &state.value, &state.downPayment, &state.installments)
	if errors.Is(err, pgx.ErrNoRows) {
		return contractValidationState{}, ErrNotFound
	}
	if err != nil {
		return contractValidationState{}, err
	}
	if status != "draft" {
		return contractValidationState{}, ErrConflict
	}
	return state, nil
}

func brokerPayload(value any) []map[string]any {
	switch typed := value.(type) {
	case []map[string]any:
		return typed
	case []any:
		items := []map[string]any{}
		for _, item := range typed {
			if mapped, ok := item.(map[string]any); ok {
				items = append(items, mapped)
			}
		}
		return items
	default:
		return []map[string]any{}
	}
}

func parseContractBrokerPayload(value any) ([]map[string]any, error) {
	if value == nil {
		return []map[string]any{}, nil
	}
	var brokers []map[string]any
	switch typed := value.(type) {
	case []map[string]any:
		brokers = typed
	case []any:
		brokers = make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			broker, ok := item.(map[string]any)
			if !ok {
				return nil, ErrInvalidInput
			}
			brokers = append(brokers, broker)
		}
	default:
		return nil, ErrInvalidInput
	}
	if err := validateContractBrokers(brokers); err != nil {
		return nil, err
	}
	return brokers, nil
}

func validateContractBrokers(brokers []map[string]any) error {
	if len(brokers) > 100 {
		return ErrInvalidInput
	}
	seen := make(map[string]struct{}, len(brokers))
	totalPercentage := 0.0
	for _, broker := range brokers {
		userID, ok := normalizeUUID(stringValue(broker["user_id"]))
		if !ok {
			return ErrInvalidInput
		}
		if _, duplicate := seen[userID]; duplicate {
			return ErrInvalidInput
		}
		seen[userID] = struct{}{}
		percentage, ok := finiteNumberValue(broker["commission_percentage"])
		if !ok || percentage < 0 || percentage > 100 {
			return ErrInvalidInput
		}
		totalPercentage += percentage
		if math.IsNaN(totalPercentage) || math.IsInf(totalPercentage, 0) || totalPercentage > 100+1e-9 {
			return ErrInvalidInput
		}
		broker["user_id"] = userID
		broker["commission_percentage"] = percentage
	}
	return nil
}

func replaceContractBrokers(ctx context.Context, exec execer, organizationID string, contractID string, brokers []map[string]any) error {
	if err := validateContractBrokers(brokers); err != nil {
		return err
	}
	if _, err := exec.Exec(ctx, `delete from public.contract_brokers where contract_id = $1::uuid`, contractID); err != nil {
		return err
	}
	for _, broker := range brokers {
		userID := stringValue(broker["user_id"])
		if _, ok := normalizeUUID(userID); !ok {
			return ErrInvalidInput
		}
		var isActiveMember bool
		if err := exec.QueryRow(ctx, `
			select exists (
				select 1
				from public.organization_members om
				where om.organization_id = $1::uuid
				  and om.user_id = $2::uuid
				  and om.is_active = true
			)
		`, organizationID, userID).Scan(&isActiveMember); err != nil {
			return err
		}
		if !isActiveMember {
			return tenant.ErrOrganizationAccessDenied
		}
		percentage, _ := finiteNumberValue(broker["commission_percentage"])
		if _, err := exec.Exec(ctx, `
			insert into public.contract_brokers (contract_id, user_id, commission_percentage)
			values ($1::uuid, $2::uuid, $3)
		`, contractID, userID, percentage); err != nil {
			return err
		}
	}
	return nil
}
