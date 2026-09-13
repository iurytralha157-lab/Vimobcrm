package financial

import (
	"context"
	"errors"
	"math"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) ListCommissionRules(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	if !canReadFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	return repo.queryJSONRows(ctx, `
		select `+commissionRuleJSONSQL("cr")+`
		from public.commission_rules cr
		where cr.organization_id = $1::uuid
		order by cr.name asc
	`, tenantContext.OrganizationID)
}

func (repo Repository) CreateCommissionRule(ctx context.Context, tenantContext tenant.Context, payload map[string]any) (map[string]any, error) {
	if !canManageFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if err := validateCommissionRulePayload(payload, true, nil); err != nil {
		return nil, err
	}
	normalizeCommissionRulePayload(payload)
	return repo.insertMap(ctx, "commission_rules", tenantContext.OrganizationID, payload, commissionRuleFieldSpecs, commissionRuleJSONSQL("commission_rules"))
}

func (repo Repository) UpdateCommissionRule(ctx context.Context, tenantContext tenant.Context, id string, payload map[string]any) (map[string]any, error) {
	if !canManageFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok {
		return nil, ErrInvalidInput
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	state, err := lockCommissionRuleValidationState(ctx, tx, tenantContext.OrganizationID, id)
	if err != nil {
		return nil, err
	}
	if err := validateCommissionRulePayload(payload, false, &state); err != nil {
		return nil, err
	}
	normalizeCommissionRulePayload(payload)
	item, err := repo.updateMapWithExec(ctx, tx, "commission_rules", tenantContext.OrganizationID, id, payload, commissionRuleFieldSpecs, commissionRuleJSONSQL("commission_rules"))
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return item, nil
}

func (repo Repository) DeleteCommissionRule(ctx context.Context, tenantContext tenant.Context, id string) error {
	if !canManageFinancial(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	return repo.deleteByID(ctx, "commission_rules", tenantContext.OrganizationID, id)
}

func normalizeCommissionRulePayload(payload map[string]any) {
	if stringValue(payload["commission_type"]) == "percentage" {
		payload["percentage"] = numberValue(payload["commission_value"])
	}
}

type commissionRuleValidationState struct {
	commissionType  string
	commissionValue float64
}

func validateCommissionRulePayload(payload map[string]any, create bool, current *commissionRuleValidationState) error {
	if payload == nil || (!create && current == nil) {
		return ErrInvalidInput
	}
	name, hasName := payload["name"]
	if create && (!hasName || stringValue(name) == "") {
		return ErrInvalidInput
	}
	if hasName {
		normalizedName := stringValue(name)
		if normalizedName == "" {
			return ErrInvalidInput
		}
		payload["name"] = normalizedName
	}
	if rawBusinessType, provided := payload["business_type"]; provided {
		businessType := strings.ToLower(stringValue(rawBusinessType))
		if !allowedString(businessType, "sale", "rental", "service", "all") {
			return ErrInvalidInput
		}
		payload["business_type"] = businessType
	} else if create {
		return ErrInvalidInput
	}
	if rawActive, provided := payload["is_active"]; provided && rawActive != nil {
		if _, ok := rawActive.(bool); !ok {
			return ErrInvalidInput
		}
	}
	if rawPercentage, provided := payload["percentage"]; provided && rawPercentage != nil {
		percentage, ok := finiteNumberValue(rawPercentage)
		if !ok || percentage < 0 || percentage > 100 {
			return ErrInvalidInput
		}
		payload["percentage"] = percentage
	}

	effectiveType := ""
	effectiveValue := 0.0
	if current != nil {
		effectiveType = current.commissionType
		effectiveValue = current.commissionValue
	}
	rawType, hasType := payload["commission_type"]
	if hasType {
		effectiveType = strings.ToLower(stringValue(rawType))
		if !allowedString(effectiveType, "percentage", "fixed") {
			return ErrInvalidInput
		}
		payload["commission_type"] = effectiveType
	} else if create {
		return ErrInvalidInput
	}
	rawValue, hasValue := payload["commission_value"]
	if hasValue {
		effectiveValue, _ = finiteNumberValue(rawValue)
		if _, ok := financialAmountToCents(effectiveValue); !ok || effectiveValue <= 0 {
			return ErrInvalidInput
		}
		payload["commission_value"] = effectiveValue
	} else if create {
		return ErrInvalidInput
	}
	if create || hasType || hasValue {
		if !allowedString(effectiveType, "percentage", "fixed") || effectiveValue <= 0 || math.IsNaN(effectiveValue) || math.IsInf(effectiveValue, 0) {
			return ErrInvalidInput
		}
		if effectiveType == "percentage" && effectiveValue > 100 {
			return ErrInvalidInput
		}
	}
	return nil
}

func lockCommissionRuleValidationState(ctx context.Context, exec execer, organizationID string, id string) (commissionRuleValidationState, error) {
	var state commissionRuleValidationState
	err := exec.QueryRow(ctx, `
		select commission_type, coalesce(commission_value, percentage, 0)::float8
		from public.commission_rules
		where organization_id = $1::uuid
		  and id = $2::uuid
		for update
	`, organizationID, id).Scan(&state.commissionType, &state.commissionValue)
	if errors.Is(err, pgx.ErrNoRows) {
		return commissionRuleValidationState{}, ErrNotFound
	}
	if err != nil {
		return commissionRuleValidationState{}, err
	}
	return state, nil
}

func commissionRuleJSONSQL(alias string) string {
	return `to_jsonb(` + alias + `) || jsonb_build_object(
		'commission_value', coalesce(` + alias + `.commission_value, ` + alias + `.percentage, 0),
		'is_active', coalesce(` + alias + `.is_active, true)
	)`
}

var commissionRuleFieldSpecs = map[string]FieldSpec{
	"name":             {Column: "name", Kind: "text"},
	"business_type":    {Column: "business_type", Kind: "text"},
	"commission_type":  {Column: "commission_type", Kind: "text"},
	"commission_value": {Column: "commission_value", Kind: "numeric"},
	"percentage":       {Column: "percentage", Kind: "numeric"},
	"is_active":        {Column: "is_active", Kind: "bool"},
}
