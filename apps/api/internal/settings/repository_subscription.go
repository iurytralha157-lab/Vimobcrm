package settings

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/jsonvalue"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) GetSubscriptionOverview(ctx context.Context, tenantContext tenant.Context) (SubscriptionOverview, error) {
	if !canManageSetting(tenantContext, permissions.SettingsBilling) {
		return SubscriptionOverview{}, tenant.ErrOrganizationAccessDenied
	}

	org, plan, pendingPlan, err := repo.getSubscriptionOrgAndPlan(ctx, tenantContext.OrganizationID)
	if err != nil {
		return SubscriptionOverview{}, err
	}
	plans, err := repo.listActiveSubscriptionPlans(ctx)
	if err != nil {
		return SubscriptionOverview{}, err
	}
	history, billingCheckoutReady, err := repo.listPaymentHistory(ctx, tenantContext.OrganizationID)
	if err != nil {
		return SubscriptionOverview{}, err
	}
	planChange, err := repo.getActiveBillingPlanChange(ctx, tenantContext.OrganizationID)
	if err != nil {
		return SubscriptionOverview{}, err
	}
	return SubscriptionOverview{
		Org:                  org,
		Plan:                 plan,
		PendingPlan:          pendingPlan,
		PlanChange:           planChange,
		AvailablePlans:       plans,
		History:              history,
		BillingCheckoutReady: billingCheckoutReady,
	}, nil
}

func (repo Repository) UpdateSubscriptionBilling(ctx context.Context, tenantContext tenant.Context, request UpdateBillingRequest) (SubscriptionOverview, error) {
	if !canManageSetting(tenantContext, permissions.SettingsBilling) {
		return SubscriptionOverview{}, tenant.ErrOrganizationAccessDenied
	}

	_, err := repo.db.Pool().Exec(ctx, `
		update public.organizations
		set
			billing_legal_name = $2,
			billing_tax_id = $3,
			billing_postal_code = $4,
			billing_address = $5,
			billing_address_number = $6,
			billing_address_complement = $7,
			billing_neighborhood = $8,
			billing_city = $9,
			billing_state = $10,
			billing_email = $11,
			billing_phone = $12,
			updated_at = now()
		where id = $1::uuid
	`, tenantContext.OrganizationID,
		cleanStringPointer(request.RazaoSocial),
		cleanStringPointer(request.CNPJ),
		cleanStringPointer(request.CEP),
		cleanStringPointer(request.Endereco),
		cleanStringPointer(request.Numero),
		cleanStringPointer(request.Complemento),
		cleanStringPointer(request.Bairro),
		cleanStringPointer(request.Cidade),
		cleanUpperStringPointer(request.UF),
		cleanStringPointer(request.Email),
		cleanStringPointer(request.Telefone),
	)
	if err != nil {
		return SubscriptionOverview{}, err
	}

	return repo.GetSubscriptionOverview(ctx, tenantContext)
}

func (repo Repository) getSubscriptionOrgAndPlan(ctx context.Context, organizationID string) (map[string]any, map[string]any, map[string]any, error) {
	var orgRaw, planRaw, pendingPlanRaw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		select
			jsonb_build_object(
				'id', o.id::text,
				'name', o.name,
				'razao_social', coalesce(o.billing_legal_name, o.razao_social),
				'cnpj', coalesce(o.billing_tax_id, o.cnpj),
				'cep', coalesce(o.billing_postal_code, o.cep),
				'endereco', coalesce(o.billing_address, o.endereco),
				'numero', coalesce(o.billing_address_number, o.numero),
				'complemento', coalesce(o.billing_address_complement, o.complemento),
				'bairro', coalesce(o.billing_neighborhood, o.bairro),
				'cidade', coalesce(o.billing_city, o.cidade),
				'uf', coalesce(o.billing_state, o.uf),
				'telefone', coalesce(o.billing_phone, o.telefone),
				'whatsapp', o.whatsapp,
				'email', coalesce(o.billing_email, o.email),
				'plan_id', o.plan_id::text,
				'pending_plan_id', o.pending_plan_id::text,
				'plan_name', current_plan.name,
				'pending_plan_name', pending_plan.name,
				'subscription_status', o.subscription_status,
				'subscription_type', o.subscription_type,
				'subscription_value', o.subscription_value,
				'subscription_billing_period_months', o.subscription_billing_period_months,
				'subscription_renewal_value', round(
					coalesce(o.subscription_value, current_plan.price, 0)::numeric
					* o.subscription_billing_period_months,
					2
				),
				'next_billing_date', o.next_billing_date,
				'trial_ends_at', o.trial_ends_at,
				'billing_grace_until', o.billing_grace_until,
				'billing_last_reconciled_at', o.billing_last_reconciled_at,
				'max_users', o.max_users,
				'max_whatsapp_sessions_override', o.max_whatsapp_sessions_override,
				'has_automatic_billing', nullif(btrim(o.asaas_subscription_id), '') is not null,
				'subscription_reference', coalesce(
					nullif(btrim(o.asaas_subscription_id), ''),
					o.id::text
				),
				'created_at', o.created_at
			),
			coalesce(to_jsonb(current_plan), 'null'::jsonb),
			coalesce(to_jsonb(pending_plan), 'null'::jsonb)
		from public.organizations o
		left join public.admin_subscription_plans current_plan
		  on current_plan.id = o.plan_id
		left join public.admin_subscription_plans pending_plan
		  on pending_plan.id = o.pending_plan_id
		where o.id = $1::uuid
	`, organizationID).Scan(&orgRaw, &planRaw, &pendingPlanRaw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil, tenant.ErrOrganizationNotFound
	}
	if err != nil {
		return nil, nil, nil, err
	}

	org, err := jsonvalue.DecodeObject(orgRaw)
	if err != nil {
		return nil, nil, nil, err
	}
	plan, err := decodeNullableJSONObject(planRaw)
	if err != nil {
		return nil, nil, nil, err
	}
	pendingPlan, err := decodeNullableJSONObject(pendingPlanRaw)
	if err != nil {
		return nil, nil, nil, err
	}
	return org, plan, pendingPlan, nil
}

func (repo Repository) listActiveSubscriptionPlans(ctx context.Context) ([]map[string]any, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select to_jsonb(p)
		from public.admin_subscription_plans p
		where coalesce(p.is_active, true) = true
		  and coalesce(p.is_public, true) = true
		  and coalesce(p.price, 0) > 0
		  and lower(btrim(p.name)) not in ('trial', 'básico', 'basico')
		order by p.price asc, p.name asc
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []map[string]any{}
	for rows.Next() {
		var raw []byte
		var item map[string]any
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
