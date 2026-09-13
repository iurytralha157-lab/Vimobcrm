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

func (repo Repository) ListEntries(ctx context.Context, tenantContext tenant.Context, values url.Values) ([]map[string]any, error) {
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
	where := []string{"fe.organization_id = $1::uuid"}
	add := func(value any, clause string) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}
	if value := strings.TrimSpace(values.Get("type")); value != "" {
		add(value, "fe.type = $%d")
	}
	if value := strings.TrimSpace(values.Get("status")); value != "" {
		add(value, "fe.status = $%d")
	}
	if value := strings.TrimSpace(values.Get("startDate")); value != "" {
		add(value, "fe.due_date >= $%d::date")
	}
	if value := strings.TrimSpace(values.Get("endDate")); value != "" {
		add(value, "fe.due_date <= $%d::date")
	}
	if value := strings.TrimSpace(values.Get("contract_id")); value != "" {
		add(value, "fe.contract_id = $%d::uuid")
	}
	if value := strings.TrimSpace(values.Get("lead_id")); value != "" {
		add(value, "fe.lead_id = $%d::uuid")
	}
	if value := strings.TrimSpace(values.Get("id")); value != "" {
		add(value, "fe.id = $%d::uuid")
	}
	pagination, err := financialListPaginationSQL(values, &args)
	if err != nil {
		return nil, err
	}

	return repo.queryJSONRows(ctx, `
		select to_jsonb(fe) || jsonb_build_object(
			'contract', case when c.id is null then null else jsonb_build_object('contract_number', c.contract_number) end,
			'property', case when p.id is null then null else jsonb_build_object(
				'id', p.id::text,
				'code', p.code,
				'title', p.title
			) end
		)
		from public.financial_entries fe
		left join public.contracts c
		  on c.id = fe.contract_id
		 and c.organization_id = fe.organization_id
		left join public.properties p
		  on p.id = c.property_id
		 and p.organization_id = fe.organization_id
		 and $2::boolean
		 and `+propertyscope.VisibilitySQL("p", "$3", "$4", "$5")+`
		where `+strings.Join(where, " and ")+`
		order by fe.due_date asc nulls last, fe.created_at desc, fe.id asc
		`+pagination+`
	`, args...)
}

func (repo Repository) CreateEntry(ctx context.Context, tenantContext tenant.Context, payload map[string]any) (map[string]any, error) {
	if !canManageFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if err := prepareFinancialEntryCreatePayload(payload, tenantContext.UserID); err != nil {
		return nil, err
	}
	if err := validateFinancialEntryReferences(ctx, repo.db.Pool(), tenantContext.OrganizationID, payload); err != nil {
		return nil, err
	}
	return repo.insertMap(ctx, "financial_entries", tenantContext.OrganizationID, payload, entryFieldSpecs, "to_jsonb(financial_entries)")
}

func (repo Repository) UpdateEntry(ctx context.Context, tenantContext tenant.Context, id string, payload map[string]any) (map[string]any, error) {
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
	state, err := lockMutableFinancialEntry(ctx, tx, tenantContext.OrganizationID, id)
	if err != nil {
		return nil, err
	}
	if err := validateFinancialEntryMutation(state, payload); err != nil {
		return nil, err
	}
	if err := validateFinancialEntryReferences(ctx, tx, tenantContext.OrganizationID, payload); err != nil {
		return nil, err
	}
	item, err := repo.updateMapWithExec(ctx, tx, "financial_entries", tenantContext.OrganizationID, id, payload, entryFieldSpecs, "to_jsonb(financial_entries)")
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return item, nil
}

func (repo Repository) DeleteEntry(ctx context.Context, tenantContext tenant.Context, id string) error {
	if !canManageFinancial(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok {
		return ErrInvalidInput
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := lockMutableFinancialEntry(ctx, tx, tenantContext.OrganizationID, id); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `
		delete from public.financial_entries
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and lower(coalesce(status, 'pending')) not in ('paid', 'paga', 'partial', 'parcial')
		  and greatest(abs(coalesce(paid_amount, 0)), abs(coalesce(paid_value, 0))) = 0
		  and lower(trim(coalesce(category, ''))) not in ('comissão', 'comissao')
	`, tenantContext.OrganizationID, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrConflict
	}
	return tx.Commit(ctx)
}

func (repo Repository) MarkEntryPaid(ctx context.Context, tenantContext tenant.Context, id string, payload map[string]any) (map[string]any, error) {
	if !canManageFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok {
		return nil, ErrInvalidInput
	}
	paidValue, ok := positiveFiniteNumber(payload["paid_value"])
	if !ok {
		return nil, ErrInvalidInput
	}
	return markEntryPaidWithExec(ctx, repo.db.Pool(), tenantContext.OrganizationID, id, paidValue)
}

func markEntryPaidWithExec(ctx context.Context, exec execer, organizationID string, id string, paidValue float64) (map[string]any, error) {
	item, err := queryJSONObjectExec(ctx, exec, `
		update public.financial_entries
		set status = 'paid',
		    paid_date = current_date,
		    paid_value = $3::numeric,
		    paid_amount = $3::numeric,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and lower(coalesce(status, 'pending')) in ('pending', 'pendente', 'partial', 'parcial', 'overdue', 'vencido')
		  and amount = $3::numeric
		returning to_jsonb(financial_entries)
	`, organizationID, id, paidValue)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrConflict
	}
	return item, err
}

var entryFieldSpecs = map[string]FieldSpec{
	"type":               {Column: "type", Kind: "text"},
	"category":           {Column: "category", Kind: "text"},
	"category_group":     {Column: "category_group", Kind: "text"},
	"contract_id":        {Column: "contract_id", Kind: "uuid"},
	"lead_id":            {Column: "lead_id", Kind: "uuid"},
	"broker_id":          {Column: "broker_id", Kind: "uuid"},
	"description":        {Column: "description", Kind: "text"},
	"amount":             {Column: "amount", Kind: "numeric"},
	"paid_amount":        {Column: "paid_amount", Kind: "numeric"},
	"paid_value":         {Column: "paid_value", Kind: "numeric"},
	"due_date":           {Column: "due_date", Kind: "date"},
	"paid_date":          {Column: "paid_date", Kind: "date"},
	"payment_method":     {Column: "payment_method", Kind: "text"},
	"status":             {Column: "status", Kind: "text"},
	"notes":              {Column: "notes", Kind: "text"},
	"created_by":         {Column: "created_by", Kind: "uuid"},
	"installment_number": {Column: "installment_number", Kind: "int"},
	"total_installments": {Column: "total_installments", Kind: "int"},
	"is_recurring":       {Column: "is_recurring", Kind: "bool"},
	"recurring_type":     {Column: "recurring_type", Kind: "text"},
	"parent_entry_id":    {Column: "parent_entry_id", Kind: "uuid"},
}
