package financial

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/propertyscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) RegenerateCommissions(ctx context.Context, tenantContext tenant.Context, id string) (map[string]any, error) {
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
	contract, err := repo.showContractWithExec(ctx, tx, tenantContext, id, true)
	if err != nil {
		return nil, err
	}
	if status := strings.ToLower(strings.TrimSpace(stringValue(contract["status"]))); status != "active" && status != "signed" {
		return nil, ErrConflict
	}
	brokers := brokerPayload(contract["brokers"])
	if len(brokers) == 0 {
		return nil, ErrInvalidInput
	}
	if err := ensureCommissionRegenerationSafe(ctx, tx, tenantContext.OrganizationID, id); err != nil {
		return nil, err
	}
	result, err := regenerateContractCommissions(ctx, tx, tenantContext, contract, brokers)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return result, nil
}

func (repo Repository) ListCommissions(ctx context.Context, tenantContext tenant.Context, values url.Values) ([]map[string]any, error) {
	if !canReadFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	canReadProperties := propertyscope.CanRead(tenantContext)
	args := []any{
		tenantContext.OrganizationID,
		canReadProperties,
		canReadProperties && propertyscope.CanViewAll(tenantContext),
		tenantContext.UserID,
		canReadProperties && propertyscope.CanViewTeam(tenantContext),
	}
	where := []string{"cm.organization_id = $1::uuid"}
	add := func(value any, clause string) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}
	if value := strings.TrimSpace(values.Get("status")); value != "" {
		aliases, ok := commissionStatusAliases(value)
		if !ok {
			return nil, ErrInvalidInput
		}
		add(aliases, "cm.status = any($%d::text[])")
	}
	if value := strings.TrimSpace(values.Get("userId")); value != "" {
		add(value, "cm.user_id = $%d::uuid")
	}
	if values.Get("mine") == "true" {
		add(tenantContext.UserID, "cm.user_id = $%d::uuid")
	}
	if !canManageFinancial(tenantContext) {
		add(tenantContext.UserID, "cm.user_id = $%d::uuid")
	}
	pagination, err := financialListPaginationSQL(values, &args)
	if err != nil {
		return nil, err
	}
	return repo.queryJSONRows(ctx, `
		select `+commissionJSONSQL()+`
		from public.commissions cm
		left join public.users u
		  on u.id = cm.user_id
		 and exists (
			select 1
			from public.organization_members om
			where om.organization_id = cm.organization_id
			  and om.user_id = u.id
			  and om.is_active = true
		 )
		left join public.contracts c
		  on c.id = cm.contract_id
		 and c.organization_id = cm.organization_id
		left join public.properties p
		  on p.id = cm.property_id
		 and p.organization_id = cm.organization_id
		 and $2::boolean
		 and `+propertyscope.VisibilitySQL("p", "$3", "$4", "$5")+`
		where `+strings.Join(where, " and ")+`
		order by cm.created_at desc, cm.id asc
		`+pagination+`
	`, args...)
}

func (repo Repository) UpdateCommissionStatus(ctx context.Context, tenantContext tenant.Context, id string, action string, request CommissionStatusRequest) (map[string]any, error) {
	if !canManageFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok {
		return nil, ErrInvalidInput
	}
	return updateCommissionStatusWithExec(ctx, repo.db.Pool(), tenantContext, id, action, request)
}

func updateCommissionStatusWithExec(ctx context.Context, exec execer, tenantContext tenant.Context, id string, action string, request CommissionStatusRequest) (map[string]any, error) {
	var item map[string]any
	var err error
	switch action {
	case "approve":
		item, err = queryJSONObjectExec(ctx, exec, `
			update public.commissions
			set status = 'approved',
			    approved_at = now(),
			    approved_by = $3::uuid,
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and lower(coalesce(status, '')) in ('pending', 'pendente')
			returning `+commissionRecordJSONSQL("commissions")+`
		`, tenantContext.OrganizationID, id, tenantContext.UserID)
	case "pay":
		item, err = queryJSONObjectExec(ctx, exec, `
			update public.commissions
			set status = 'paid',
			    paid_at = now(),
			    paid_by = $3::uuid,
			    payment_proof = coalesce($4, payment_proof),
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and lower(coalesce(status, '')) in ('approved', 'aprovada')
			returning `+commissionRecordJSONSQL("commissions")+`
		`, tenantContext.OrganizationID, id, tenantContext.UserID, optionalText(request.PaymentProof))
	case "cancel":
		item, err = queryJSONObjectExec(ctx, exec, `
			update public.commissions
			set status = 'cancelled',
			    notes = coalesce($3, notes),
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and lower(coalesce(status, '')) in ('forecast', 'prevista', 'pending', 'pendente', 'approved', 'aprovada')
			returning `+commissionRecordJSONSQL("commissions")+`
		`, tenantContext.OrganizationID, id, optionalText(request.Notes))
	default:
		return nil, ErrInvalidInput
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrConflict
	}
	return item, err
}

func (repo Repository) CommissionsByBroker(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	if !canReadFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	where, args := commissionsByBrokerScope(tenantContext)
	return repo.queryJSONRows(ctx, `
		select jsonb_build_object(
			'user', jsonb_build_object('id', cm.user_id::text, 'name', u.name, 'email', u.email),
			'forecast', coalesce(sum(coalesce(cm.amount, cm.calculated_value)) filter (where cm.status in ('forecast', 'prevista')), 0),
			'approved', coalesce(sum(coalesce(cm.amount, cm.calculated_value)) filter (where cm.status in ('approved', 'aprovada')), 0),
			'paid', coalesce(sum(coalesce(cm.amount, cm.calculated_value)) filter (where cm.status in ('paid', 'paga')), 0),
			'total', coalesce(sum(coalesce(cm.amount, cm.calculated_value)) filter (
				where lower(coalesce(cm.status, '')) not in ('cancelled', 'cancelada')
			), 0)
		)
		from public.commissions cm
		left join public.users u
		  on u.id = cm.user_id
		 and exists (
			select 1
			from public.organization_members om
			where om.organization_id = cm.organization_id
			  and om.user_id = u.id
			  and om.is_active = true
		 )
		where `+where+`
		group by cm.user_id, u.name, u.email
		order by coalesce(sum(coalesce(cm.amount, cm.calculated_value)) filter (
			where lower(coalesce(cm.status, '')) not in ('cancelled', 'cancelada')
		), 0) desc
	`, args...)
}

func commissionsByBrokerScope(tenantContext tenant.Context) (string, []any) {
	args := []any{tenantContext.OrganizationID}
	where := "cm.organization_id = $1::uuid"
	if !canManageFinancial(tenantContext) {
		args = append(args, tenantContext.UserID)
		where += " and cm.user_id = $2::uuid"
	}
	return where, args
}

func commissionStatusAliases(value string) ([]string, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "forecast", "prevista":
		return []string{"forecast", "prevista"}, true
	case "pending", "pendente":
		return []string{"pending", "pendente"}, true
	case "approved", "aprovada":
		return []string{"approved", "aprovada"}, true
	case "paid", "paga":
		return []string{"paid", "paga"}, true
	case "cancelled", "cancelada":
		return []string{"cancelled", "cancelada"}, true
	default:
		return nil, false
	}
}

func commissionJSONSQL() string {
	return commissionRecordJSONSQL("cm") + ` || jsonb_build_object(
		'property_id', case when p.id is null then null else cm.property_id end,
		'user', case when u.id is null then null else jsonb_build_object('id', u.id::text, 'name', u.name, 'email', u.email) end,
		'contract', case when c.id is null then null else jsonb_build_object('contract_number', c.contract_number, 'client_name', c.client_name) end,
		'property', case when p.id is null then null else jsonb_build_object('code', p.code, 'title', p.title) end
	)`
}

func commissionRecordJSONSQL(alias string) string {
	return `to_jsonb(` + alias + `) || jsonb_build_object(
		'base_value', coalesce(` + alias + `.base_value, 0),
		'calculated_value', coalesce(` + alias + `.calculated_value, ` + alias + `.amount, 0),
		'status', coalesce(` + alias + `.status, 'pending')
	)`
}
