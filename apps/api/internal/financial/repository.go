package financial

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db      *dbpkg.Postgres
	storage contractDocumentStorage
}

type execer interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

const dreMappingsSelectSQL = `
	select to_jsonb(m) || jsonb_build_object(
		'group', case when g.id is null then null else jsonb_build_object('id', g.id::text, 'name', g.name, 'group_type', g.group_type) end
	)
	from public.dre_account_mappings m
	left join public.dre_account_groups g
	  on g.id = m.group_id
	 and g.organization_id = m.organization_id
	where m.organization_id = $1::uuid
	order by m.created_at desc
`

func NewRepository(db *dbpkg.Postgres, storageConfig StorageConfig) Repository {
	return Repository{
		db:      db,
		storage: newStorageClient(storageConfig),
	}
}

func (repo Repository) ListCategories(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	if !canReadFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	return repo.queryJSONRows(ctx, `
		select to_jsonb(c)
		from public.financial_categories c
		where c.organization_id = $1::uuid
		  and c.is_active = true
		order by c.name asc
	`, tenantContext.OrganizationID)
}

func (repo Repository) CreateCategory(ctx context.Context, tenantContext tenant.Context, payload map[string]any) (map[string]any, error) {
	if !canManageFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	name := stringValue(payload["name"])
	categoryType := stringValue(payload["type"])
	if name == "" || (categoryType != "income" && categoryType != "expense") {
		return nil, ErrInvalidInput
	}
	categoryGroup := nullableString(payload["category_group"])
	return repo.queryJSONObject(ctx, `
		insert into public.financial_categories (organization_id, name, type, category_group)
		values ($1::uuid, $2, $3, $4)
		returning to_jsonb(financial_categories)
	`, tenantContext.OrganizationID, name, categoryType, categoryGroup)
}

func (repo Repository) ListEntries(ctx context.Context, tenantContext tenant.Context, values url.Values) ([]map[string]any, error) {
	if !canReadFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	args := []any{tenantContext.OrganizationID}
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

func (repo Repository) Dashboard(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
	if !canReadFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	return repo.queryJSONObject(ctx, `
		with bounds as (
			select
				current_date::date as today,
				(current_date + interval '30 days')::date as days30,
				(current_date + interval '60 days')::date as days60,
				(current_date + interval '90 days')::date as days90,
				(current_date - interval '30 days')::date as last30,
				date_trunc('year', current_date)::date as year_start,
				least(date_trunc('month', current_date) - interval '5 months', date_trunc('year', current_date))::date as history_start
		),
		entries as (
			select * from public.financial_entries where organization_id = $1::uuid
		),
		pending_receivables as (
			select amount, due_date from entries where type = 'receivable' and status = 'pending'
		),
		pending_payables as (
			select amount, due_date from entries where type = 'payable' and status = 'pending'
		),
		paid_entries as (
			select amount, type, paid_date from entries, bounds where status = 'paid' and paid_date >= bounds.history_start
		),
		commission_totals as (
			select
				coalesce(sum(coalesce(amount, calculated_value)) filter (where status in ('forecast', 'prevista')), 0) as forecast,
				coalesce(sum(coalesce(amount, calculated_value)) filter (where status in ('pending', 'pendente', 'approved', 'aprovada')), 0) as pending,
				coalesce(sum(coalesce(amount, calculated_value)) filter (where status in ('paid', 'paga')), 0) as paid
			from public.commissions
			where organization_id = $1::uuid
		),
		contracts as (
			select id, value, commission_value
			from public.contracts
			where organization_id = $1::uuid
			  and status in ('active', 'signed', 'completed')
		),
		won_leads as (
			select id, valor_interesse
			from public.leads
			where organization_id = $1::uuid
			  and deal_status = 'won'
			  and coalesce(valor_interesse, 0) > 0
		),
		months as (
			select generate_series(
				date_trunc('month', (select today from bounds)) - interval '5 months',
				date_trunc('month', (select today from bounds)),
				interval '1 month'
			)::date as month_start
		),
		monthly as (
			select coalesce(jsonb_agg(jsonb_build_object(
				'month', to_char(m.month_start, 'Mon/YY'),
				'receitas', coalesce((select sum(amount) from paid_entries e where e.type = 'receivable' and date_trunc('month', e.paid_date)::date = m.month_start), 0),
				'despesas', coalesce((select sum(amount) from paid_entries e where e.type = 'payable' and date_trunc('month', e.paid_date)::date = m.month_start), 0)
			) order by m.month_start), '[]'::jsonb) as data
			from months m
		)
		select jsonb_build_object(
			'receivable30', coalesce((select sum(amount) from pending_receivables, bounds where due_date between bounds.today and bounds.days30), 0),
			'receivable60', coalesce((select sum(amount) from pending_receivables, bounds where due_date > bounds.days30 and due_date <= bounds.days60), 0),
			'receivable90', coalesce((select sum(amount) from pending_receivables, bounds where due_date > bounds.days60 and due_date <= bounds.days90), 0),
			'confirmedRevenue30', coalesce((select sum(amount) from paid_entries, bounds where type = 'receivable' and paid_date between bounds.last30 and bounds.today), 0),
			'confirmedRevenueYTD', coalesce((select sum(amount) from paid_entries, bounds where type = 'receivable' and paid_date >= bounds.year_start), 0),
			'totalPayable', coalesce((select sum(amount) from pending_payables), 0),
			'forecastCommissions', (select forecast from commission_totals),
			'pendingCommissions', (select pending from commission_totals),
			'paidCommissions', (select paid from commission_totals),
			'overdueReceivables', coalesce((select sum(amount) from pending_receivables, bounds where due_date < bounds.today), 0),
			'overduePayables', coalesce((select sum(amount) from pending_payables, bounds where due_date < bounds.today), 0),
			'monthlyData', (select data from monthly),
			'totalLeadsValue', coalesce((select sum(valor_interesse) from won_leads), 0),
			'vgvBruto', coalesce((select sum(value) from contracts), 0),
			'vgvLiquido', coalesce((select sum(value) - sum(coalesce(commission_value, 0)) from contracts), 0),
			'totalContractsValue', coalesce((select sum(value) - sum(coalesce(commission_value, 0)) from contracts), 0),
			'activeContracts', (select count(*) from contracts),
			'wonLeadsCount', (select count(*) from won_leads),
			'avgTicket', coalesce((select avg(value) from contracts), 0),
			'conversionRate', case when (select count(*) from won_leads) > 0 then ((select count(*) from contracts)::numeric / (select count(*) from won_leads)::numeric) * 100 else 0 end,
			'annualProjection', 0,
			'defaultRate', 0
		)
	`, tenantContext.OrganizationID)
}

func (repo Repository) ListContracts(ctx context.Context, tenantContext tenant.Context, values url.Values) ([]map[string]any, error) {
	if !canReadFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	args := []any{tenantContext.OrganizationID}
	where := []string{"c.organization_id = $1::uuid"}
	add := func(value any, clause string) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}
	if value := strings.TrimSpace(values.Get("status")); value != "" {
		add(value, "c.status = $%d")
	}
	if value := strings.TrimSpace(values.Get("type")); value != "" {
		add(value, "c.contract_type = $%d")
	}
	pagination, err := financialListPaginationSQL(values, &args)
	if err != nil {
		return nil, err
	}
	return repo.queryJSONRows(ctx, `
		select `+contractJSONSQL(false)+`
		from public.contracts c
		left join public.properties p
		  on p.id = c.property_id
		 and p.organization_id = c.organization_id
		left join public.leads l
		  on l.id = c.lead_id
		 and l.organization_id = c.organization_id
		where `+strings.Join(where, " and ")+`
		order by c.created_at desc, c.id asc
		`+pagination+`
	`, args...)
}

func (repo Repository) ShowContract(ctx context.Context, tenantContext tenant.Context, id string) (map[string]any, error) {
	if !canReadFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok {
		return nil, ErrInvalidInput
	}
	return repo.showContractWithExec(ctx, repo.db.Pool(), tenantContext.OrganizationID, id, false)
}

func (repo Repository) showContractWithExec(ctx context.Context, exec execer, organizationID string, id string, lock bool) (map[string]any, error) {
	lockClause := ""
	if lock {
		lockClause = " for update of c"
	}
	item, err := queryJSONObjectExec(ctx, exec, `
		select `+contractJSONSQL(true)+`
		from public.contracts c
		left join public.properties p
		  on p.id = c.property_id
		 and p.organization_id = c.organization_id
		left join public.leads l
		  on l.id = c.lead_id
		 and l.organization_id = c.organization_id
		where c.organization_id = $1::uuid
		  and c.id = $2::uuid
	`+lockClause, organizationID, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return item, err
}

func (repo Repository) CreateContract(ctx context.Context, tenantContext tenant.Context, payload map[string]any) (map[string]any, error) {
	if !canManageFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	brokers, err := parseContractBrokerPayload(payload["brokers"])
	if err != nil {
		return nil, err
	}
	delete(payload, "brokers")
	if err := validateContractPayload(payload, brokers, true, nil); err != nil {
		return nil, err
	}
	prepareContractCreatePayload(payload, tenantContext.UserID)

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := validateContractReferences(ctx, tx, tenantContext.OrganizationID, payload); err != nil {
		return nil, err
	}

	contractNumber, err := repo.nextContractNumber(ctx, tx, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	payload["contract_number"] = contractNumber

	contract, err := repo.insertMapWithExec(ctx, tx, "contracts", tenantContext.OrganizationID, payload, contractFieldSpecs, "to_jsonb(contracts)")
	if err != nil {
		return nil, err
	}
	contractID, _ := contract["id"].(string)
	if err := replaceContractBrokers(ctx, tx, tenantContext.OrganizationID, contractID, brokers); err != nil {
		return nil, err
	}
	item, err := repo.showContractWithExec(ctx, tx, tenantContext.OrganizationID, contractID, false)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return item, nil
}

func (repo Repository) UpdateContract(ctx context.Context, tenantContext tenant.Context, id string, payload map[string]any) (map[string]any, error) {
	if !canManageFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok {
		return nil, ErrInvalidInput
	}
	for _, immutableField := range []string{"status", "created_by", "contract_number"} {
		if _, provided := payload[immutableField]; provided {
			return nil, ErrInvalidInput
		}
	}
	brokerValue, hasBrokers := payload["brokers"]
	brokers := []map[string]any(nil)
	if hasBrokers {
		var err error
		brokers, err = parseContractBrokerPayload(brokerValue)
		if err != nil {
			return nil, err
		}
	}
	delete(payload, "brokers")

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	state, err := lockDraftContractValidationState(ctx, tx, tenantContext.OrganizationID, id)
	if err != nil {
		return nil, err
	}
	if err := validateContractPayload(payload, brokers, false, &state); err != nil {
		return nil, err
	}
	if err := validateContractReferences(ctx, tx, tenantContext.OrganizationID, payload); err != nil {
		return nil, err
	}

	if _, err := repo.updateMapWithExec(ctx, tx, "contracts", tenantContext.OrganizationID, id, payload, contractFieldSpecs, "to_jsonb(contracts)"); err != nil {
		return nil, err
	}
	if hasBrokers {
		if err := replaceContractBrokers(ctx, tx, tenantContext.OrganizationID, id, brokers); err != nil {
			return nil, err
		}
	}
	item, err := repo.showContractWithExec(ctx, tx, tenantContext.OrganizationID, id, false)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return item, nil
}

func (repo Repository) DeleteContract(ctx context.Context, tenantContext tenant.Context, id string) error {
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
	if err := ensureDraftContract(ctx, tx, tenantContext.OrganizationID, id); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `
		delete from public.contracts
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and status = 'draft'
	`, tenantContext.OrganizationID, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrConflict
	}
	return tx.Commit(ctx)
}

func (repo Repository) ActivateContract(ctx context.Context, tenantContext tenant.Context, id string, skipCommissions bool) (map[string]any, error) {
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
	if err := repo.activateContractWithExec(ctx, tx, tenantContext, id, skipCommissions); err != nil {
		return nil, err
	}
	item, err := repo.showContractWithExec(ctx, tx, tenantContext.OrganizationID, id, false)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return item, nil
}

func (repo Repository) activateContractWithExec(ctx context.Context, exec execer, tenantContext tenant.Context, id string, skipCommissions bool) error {
	contract, err := repo.showContractWithExec(ctx, exec, tenantContext.OrganizationID, id, true)
	if err != nil {
		return err
	}
	if stringValue(contract["status"]) != "draft" {
		return ErrConflict
	}
	brokers := brokerPayload(contract["brokers"])
	if len(brokers) == 0 && !skipCommissions {
		return fmt.Errorf("%w: no brokers", ErrInvalidInput)
	}

	tag, err := exec.Exec(ctx, `
		update public.contracts
		set status = 'active',
		    signing_date = current_date,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and status = 'draft'
	`, tenantContext.OrganizationID, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrConflict
	}
	if skipCommissions {
		// The production baseline still has a legacy AFTER UPDATE trigger that
		// creates forecast commissions. Remove only rows created by that trigger
		// in this transaction; pre-existing history is left untouched. The
		// canonical commission book remains a separate migration/design decision.
		if _, err := exec.Exec(ctx, `
			delete from public.commissions
			where organization_id = $1::uuid
			  and contract_id = $2::uuid
			  and status = 'forecast'
			  and notes = 'Comissão prevista gerada automaticamente ao ativar contrato'
			  and created_at >= transaction_timestamp()
		`, tenantContext.OrganizationID, id); err != nil {
			return err
		}
	}

	totalValue := numberValue(contract["value"])
	downPayment := numberValue(contract["down_payment"])
	installments := intFromAny(contract["installments"], 1)
	if installments < 1 {
		installments = 1
	}
	if err := createContractReceivables(ctx, exec, tenantContext, id, stringValue(contract["contract_number"]), totalValue, downPayment, installments); err != nil {
		return err
	}
	if len(brokers) > 0 && !skipCommissions {
		if _, err := regenerateContractCommissions(ctx, exec, tenantContext, contract, brokers); err != nil {
			return err
		}
	}
	return nil
}

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
	contract, err := repo.showContractWithExec(ctx, tx, tenantContext.OrganizationID, id, true)
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

func (repo Repository) ListContractDocuments(ctx context.Context, tenantContext tenant.Context, id string) ([]any, error) {
	if !canReadFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok {
		return nil, ErrInvalidInput
	}
	var raw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		select attachments
		from public.contracts
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, id).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	items := []any{}
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	return items, nil
}

func (repo Repository) UploadContractDocument(ctx context.Context, tenantContext tenant.Context, id string, fileName string, size int64, contentType string, body io.Reader) (map[string]any, error) {
	if !canManageFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok {
		return nil, ErrInvalidInput
	}
	if err := repo.ensureContract(ctx, tenantContext, id); err != nil {
		return nil, err
	}
	safeName := sanitizeFileName(fileName)
	uploadedAt := time.Now().UTC()
	objectPath := fmt.Sprintf("%s/%s/%d_%s", tenantContext.OrganizationID, id, uploadedAt.UnixMilli(), safeName)
	// Storage and Postgres do not share a transaction. Handled failures below
	// are compensated, while process crashes in this gap require a durable
	// outbox/reconciler (and therefore a schema migration) to close completely.
	if err := repo.storage.upload(ctx, "contract-documents", objectPath, contentType, body); err != nil {
		return nil, err
	}
	doc := map[string]any{
		"name":        fileName,
		"path":        objectPath,
		"size":        size,
		"uploaded_at": uploadedAt.Format(time.RFC3339),
	}
	raw, err := json.Marshal(doc)
	if err != nil {
		return nil, repo.compensateContractDocumentUpload(ctx, objectPath, err)
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, repo.compensateContractDocumentUpload(ctx, objectPath, err)
	}
	defer tx.Rollback(ctx)
	if err := appendContractDocumentMetadataWithExec(ctx, tx, tenantContext.OrganizationID, id, objectPath, raw); err != nil {
		_ = tx.Rollback(ctx)
		return nil, repo.compensateContractDocumentUpload(ctx, objectPath, err)
	}
	if err := tx.Commit(ctx); err != nil {
		// A commit error can be ambiguous: Postgres may have committed even if the
		// acknowledgement was lost. Keep the object so committed metadata can
		// never point to a file that compensation removed.
		return nil, err
	}
	return doc, nil
}

func (repo Repository) DeleteContractDocument(ctx context.Context, tenantContext tenant.Context, id string, path string) error {
	if !canManageFinancial(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok || strings.TrimSpace(path) == "" {
		return ErrInvalidInput
	}
	if !isContractDocumentObjectPath(tenantContext.OrganizationID, id, path) {
		return ErrNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	document, err := removeContractDocumentMetadataWithExec(ctx, tx, tenantContext.OrganizationID, id, path)
	if err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		// Do not delete from Storage when the metadata commit outcome is unknown.
		// At worst this leaves an orphan object, never a broken metadata link.
		return err
	}

	// The database commit intentionally precedes irreversible object deletion.
	// A crash after this point can leave an orphan object, which is safer than
	// metadata referencing a missing file and needs an outbox to reconcile.
	if err := repo.storage.remove(ctx, "contract-documents", []string{path}); err != nil {
		compensationCtx, cancel := contractDocumentCompensationContext(ctx)
		defer cancel()
		return reconcileContractDocumentDeleteFailure(
			compensationCtx,
			repo.storage,
			path,
			err,
			func(restoreCtx context.Context) error {
				return repo.restoreContractDocumentMetadata(restoreCtx, tenantContext.OrganizationID, id, path, document)
			},
		)
	}
	return nil
}

func (repo Repository) compensateContractDocumentUpload(ctx context.Context, objectPath string, cause error) error {
	compensationCtx, cancel := contractDocumentCompensationContext(ctx)
	defer cancel()
	return compensateContractDocumentUpload(compensationCtx, repo.storage, objectPath, cause)
}

func (repo Repository) restoreContractDocumentMetadata(ctx context.Context, organizationID string, contractID string, path string, document json.RawMessage) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := restoreContractDocumentMetadataWithExec(ctx, tx, organizationID, contractID, path, document); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (repo Repository) ContractDocumentSignedURL(ctx context.Context, tenantContext tenant.Context, id string, path string) (map[string]any, error) {
	if !canReadFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok || strings.TrimSpace(path) == "" {
		return nil, ErrInvalidInput
	}
	if err := repo.ensureContractDocument(ctx, tenantContext, id, path); err != nil {
		return nil, err
	}
	signedURL, err := repo.storage.signedURL(ctx, "contract-documents", path, 60)
	if err != nil {
		return nil, err
	}
	return map[string]any{"signedUrl": signedURL}, nil
}

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

func (repo Repository) ListCommissions(ctx context.Context, tenantContext tenant.Context, values url.Values) ([]map[string]any, error) {
	if !canReadFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	args := []any{tenantContext.OrganizationID}
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

func (repo Repository) DREInput(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
	if !canReadFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	regime := strings.TrimSpace(values.Get("regime"))
	if regime == "" {
		regime = "cash"
	}
	startDate := strings.TrimSpace(values.Get("startDate"))
	endDate := strings.TrimSpace(values.Get("endDate"))
	prevStart := strings.TrimSpace(values.Get("previousStartDate"))
	prevEnd := strings.TrimSpace(values.Get("previousEndDate"))
	if startDate == "" || endDate == "" {
		return nil, ErrInvalidInput
	}
	dateColumn := "due_date"
	statuses := []string{"pending", "paid", "overdue"}
	if regime == "cash" {
		dateColumn = "paid_date"
		statuses = []string{"paid"}
	}
	args := []any{tenantContext.OrganizationID, startDate, endDate, statuses}
	entriesSQL := fmt.Sprintf(`
		select coalesce(jsonb_agg(to_jsonb(fe)), '[]'::jsonb)
		from public.financial_entries fe
		where fe.organization_id = $1::uuid
		  and fe.status = any($4::text[])
		  and fe.%s >= $2::date
		  and fe.%s <= $3::date
	`, dateColumn, dateColumn)
	entries, err := repo.queryJSONArray(ctx, entriesSQL, args...)
	if err != nil {
		return nil, err
	}
	previousEntries := []any{}
	if prevStart != "" && prevEnd != "" {
		previousEntries, err = repo.queryJSONArray(ctx, entriesSQL, tenantContext.OrganizationID, prevStart, prevEnd, statuses)
		if err != nil {
			return nil, err
		}
	}
	groups, err := repo.DREGroups(ctx, tenantContext)
	if err != nil {
		return nil, err
	}
	mappings, err := repo.DREMappings(ctx, tenantContext)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"groups":          groups,
		"mappings":        mappings,
		"entries":         entries,
		"previousEntries": previousEntries,
	}, nil
}

func (repo Repository) DREGroups(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	if !canReadFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	return repo.queryJSONRows(ctx, `
		select to_jsonb(g)
		from public.dre_account_groups g
		where g.organization_id = $1::uuid
		order by g.display_order asc, g.name asc
	`, tenantContext.OrganizationID)
}

func (repo Repository) DREMappings(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	if !canReadFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	return repo.queryJSONRows(ctx, dreMappingsSelectSQL, tenantContext.OrganizationID)
}

func (repo Repository) CreateDREMapping(ctx context.Context, tenantContext tenant.Context, payload map[string]any) (map[string]any, error) {
	if !canManageFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	category := stringValue(payload["category"])
	entryType := stringValue(payload["entry_type"])
	groupID := stringValue(payload["group_id"])
	if category == "" || (entryType != "payable" && entryType != "receivable") {
		return nil, ErrInvalidInput
	}
	if _, ok := normalizeUUID(groupID); !ok {
		return nil, ErrInvalidInput
	}
	if err := validateOptionalOrganizationReference(ctx, repo.db.Pool(), tenantContext.OrganizationID, payload, "group_id", "dre_account_groups"); err != nil {
		return nil, err
	}
	return repo.queryJSONObject(ctx, `
		insert into public.dre_account_mappings (organization_id, category, entry_type, group_id)
		values ($1::uuid, $2, $3, $4::uuid)
		on conflict (organization_id, category, entry_type)
		do update set group_id = excluded.group_id
		returning to_jsonb(dre_account_mappings)
	`, tenantContext.OrganizationID, category, entryType, groupID)
}

func (repo Repository) DeleteDREMapping(ctx context.Context, tenantContext tenant.Context, id string) error {
	if !canManageFinancial(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	return repo.deleteByID(ctx, "dre_account_mappings", tenantContext.OrganizationID, id)
}

func (repo Repository) InitializeDREGroups(ctx context.Context, tenantContext tenant.Context) error {
	if !canManageFinancial(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	_, err := repo.db.Pool().Exec(ctx, `select public.copy_default_dre_groups($1::uuid)`, tenantContext.OrganizationID)
	return err
}

func (repo Repository) insertMap(ctx context.Context, table string, organizationID string, payload map[string]any, specs map[string]FieldSpec, returning string) (map[string]any, error) {
	return repo.insertMapWithExec(ctx, repo.db.Pool(), table, organizationID, payload, specs, returning)
}

func (repo Repository) insertMapWithExec(ctx context.Context, exec execer, table string, organizationID string, payload map[string]any, specs map[string]FieldSpec, returning string) (map[string]any, error) {
	columns := []string{"organization_id"}
	args := []any{organizationID}
	placeholders := []string{"$1::uuid"}
	for key, spec := range specs {
		value, ok := payload[key]
		if !ok {
			continue
		}
		args = append(args, cleanValue(value))
		columns = append(columns, spec.Column)
		placeholders = append(placeholders, placeholderForKind(spec.Kind, len(args)))
	}
	if len(columns) == 1 {
		return nil, ErrInvalidInput
	}
	identifier := pgx.Identifier{"public", table}.Sanitize()
	sql := fmt.Sprintf(`
		insert into %s (%s)
		values (%s)
		returning %s
	`, identifier, strings.Join(columns, ", "), strings.Join(placeholders, ", "), returning)
	return queryJSONObjectExec(ctx, exec, sql, args...)
}

func (repo Repository) updateMap(ctx context.Context, table string, organizationID string, id string, payload map[string]any, specs map[string]FieldSpec, returning string) (map[string]any, error) {
	return repo.updateMapWithExec(ctx, repo.db.Pool(), table, organizationID, id, payload, specs, returning)
}

func (repo Repository) updateMapWithExec(ctx context.Context, exec execer, table string, organizationID string, id string, payload map[string]any, specs map[string]FieldSpec, returning string) (map[string]any, error) {
	id, ok := normalizeUUID(id)
	if !ok {
		return nil, ErrInvalidInput
	}
	args := []any{organizationID, id}
	assignments := []string{}
	for key, spec := range specs {
		value, ok := payload[key]
		if !ok {
			continue
		}
		args = append(args, cleanValue(value))
		assignments = append(assignments, fmt.Sprintf("%s = %s", spec.Column, placeholderForKind(spec.Kind, len(args))))
	}
	if len(assignments) == 0 {
		return nil, ErrInvalidInput
	}
	assignments = append(assignments, "updated_at = now()")
	identifier := pgx.Identifier{"public", table}.Sanitize()
	sql := fmt.Sprintf(`
		update %s
		set %s
		where organization_id = $1::uuid
		  and id = $2::uuid
		returning %s
	`, identifier, strings.Join(assignments, ", "), returning)
	item, err := queryJSONObjectExec(ctx, exec, sql, args...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return item, err
}

func (repo Repository) deleteByID(ctx context.Context, table string, organizationID string, id string) error {
	id, ok := normalizeUUID(id)
	if !ok {
		return ErrInvalidInput
	}
	identifier := pgx.Identifier{"public", table}.Sanitize()
	tag, err := repo.db.Pool().Exec(ctx, fmt.Sprintf(`
		delete from %s
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, identifier), organizationID, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (repo Repository) ensureContract(ctx context.Context, tenantContext tenant.Context, id string) error {
	var exists bool
	if err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.contracts
			where organization_id = $1::uuid
			  and id = $2::uuid
		)
	`, tenantContext.OrganizationID, id).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	return nil
}

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

func ensureDraftContract(ctx context.Context, exec execer, organizationID string, id string) error {
	var status string
	err := exec.QueryRow(ctx, `
		select coalesce(status, '')
		from public.contracts
		where organization_id = $1::uuid
		  and id = $2::uuid
		for update
	`, organizationID, id).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if status != "draft" {
		return ErrConflict
	}
	return nil
}

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

func (repo Repository) ensureContractDocument(ctx context.Context, tenantContext tenant.Context, id string, path string) error {
	if !isContractDocumentObjectPath(tenantContext.OrganizationID, id, path) {
		return ErrNotFound
	}

	var exists bool
	if err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.contracts c
			cross join lateral jsonb_array_elements(
				case when jsonb_typeof(c.attachments) = 'array' then c.attachments else '[]'::jsonb end
			) item
			where c.organization_id = $1::uuid
			  and c.id = $2::uuid
			  and item->>'path' = $3
		)
	`, tenantContext.OrganizationID, id, path).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	return nil
}

func (repo Repository) nextContractNumber(ctx context.Context, exec execer, organizationID string) (string, error) {
	var nextNumber int
	if err := exec.QueryRow(ctx, `
		insert into public.contract_sequences (organization_id, last_number)
		values ($1::uuid, 1)
		on conflict (organization_id)
		do update set last_number = contract_sequences.last_number + 1
		returning last_number
	`, organizationID).Scan(&nextNumber); err != nil {
		return "", err
	}
	return fmt.Sprintf("CTR-%d-%05d", time.Now().Year(), nextNumber), nil
}

func prepareContractCreatePayload(payload map[string]any, userID string) {
	payload["status"] = "draft"
	payload["created_by"] = userID
}

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

func sanitizeFileName(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "documento"
	}
	builder := strings.Builder{}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '.' || char == '_' || char == '-' {
			builder.WriteRune(char)
		} else {
			builder.WriteRune('_')
		}
	}
	return builder.String()
}

func validateContractReferences(ctx context.Context, exec execer, organizationID string, payload map[string]any) error {
	for _, reference := range []struct {
		key   string
		table string
	}{
		{key: "property_id", table: "properties"},
		{key: "lead_id", table: "leads"},
	} {
		if err := validateOptionalOrganizationReference(ctx, exec, organizationID, payload, reference.key, reference.table); err != nil {
			return err
		}
	}
	return nil
}

func validateFinancialEntryReferences(ctx context.Context, exec execer, organizationID string, payload map[string]any) error {
	for _, reference := range []struct {
		key   string
		table string
	}{
		{key: "contract_id", table: "contracts"},
		{key: "lead_id", table: "leads"},
		{key: "broker_id", table: "organization_members"},
		{key: "parent_entry_id", table: "financial_entries"},
	} {
		if err := validateOptionalOrganizationReference(ctx, exec, organizationID, payload, reference.key, reference.table); err != nil {
			return err
		}
	}
	return nil
}

func validateOptionalOrganizationReference(
	ctx context.Context,
	exec execer,
	organizationID string,
	payload map[string]any,
	key string,
	table string,
) error {
	raw, provided := payload[key]
	if !provided || raw == nil {
		return nil
	}
	id := strings.TrimSpace(stringValue(raw))
	if id == "" {
		return nil
	}
	if _, ok := normalizeUUID(id); !ok {
		return ErrInvalidInput
	}

	var query string
	switch table {
	case "properties":
		query = `select exists (select 1 from public.properties where organization_id = $1::uuid and id = $2::uuid)`
	case "leads":
		query = `select exists (select 1 from public.leads where organization_id = $1::uuid and id = $2::uuid)`
	case "contracts":
		query = `select exists (select 1 from public.contracts where organization_id = $1::uuid and id = $2::uuid)`
	case "financial_entries":
		query = `select exists (select 1 from public.financial_entries where organization_id = $1::uuid and id = $2::uuid)`
	case "organization_members":
		query = `select exists (
			select 1
			from public.organization_members
			where organization_id = $1::uuid
			  and user_id = $2::uuid
			  and is_active = true
		)`
	case "dre_account_groups":
		query = `select exists (
			select 1
			from public.dre_account_groups
			where organization_id = $1::uuid
			  and id = $2::uuid
		)`
	default:
		return ErrInvalidInput
	}

	var exists bool
	if err := exec.QueryRow(ctx, query, organizationID, id).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return tenant.ErrOrganizationAccessDenied
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

func (repo Repository) queryJSONRows(ctx context.Context, sql string, args ...any) ([]map[string]any, error) {
	rows, err := repo.db.Pool().Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var item map[string]any
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (repo Repository) queryJSONObject(ctx context.Context, sql string, args ...any) (map[string]any, error) {
	return queryJSONObjectExec(ctx, repo.db.Pool(), sql, args...)
}

func queryJSONObjectExec(ctx context.Context, exec interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}, sql string, args ...any) (map[string]any, error) {
	var raw []byte
	if err := exec.QueryRow(ctx, sql, args...).Scan(&raw); err != nil {
		return nil, err
	}
	var item map[string]any
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil, err
	}
	return item, nil
}

func (repo Repository) queryJSONArray(ctx context.Context, sql string, args ...any) ([]any, error) {
	var raw []byte
	if err := repo.db.Pool().QueryRow(ctx, sql, args...).Scan(&raw); err != nil {
		return nil, err
	}
	items := []any{}
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	return items, nil
}

func canReadFinancial(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission("financial_view") || tenantContext.HasPermission("financial_manage")
}

func canManageFinancial(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission("financial_manage") || tenantContext.HasRole("owner", "admin")
}

const (
	defaultFinancialListLimit = 200
	maximumFinancialListLimit = 500
	maximumFinancialOffset    = 10_000_000
)

func financialListPaginationSQL(values url.Values, args *[]any) (string, error) {
	limit := defaultFinancialListLimit
	if raw := strings.TrimSpace(values.Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > maximumFinancialListLimit {
			return "", ErrInvalidInput
		}
		limit = parsed
	}
	offset := 0
	if raw := strings.TrimSpace(values.Get("offset")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 || parsed > maximumFinancialOffset {
			return "", ErrInvalidInput
		}
		offset = parsed
	}
	*args = append(*args, limit, offset)
	return fmt.Sprintf("limit $%d::int offset $%d::int", len(*args)-1, len(*args)), nil
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

func placeholderForKind(kind string, index int) string {
	switch kind {
	case "uuid":
		return fmt.Sprintf("$%d::uuid", index)
	case "date":
		return fmt.Sprintf("$%d::date", index)
	case "timestamptz":
		return fmt.Sprintf("$%d::timestamptz", index)
	case "numeric":
		return fmt.Sprintf("$%d::numeric", index)
	case "int":
		return fmt.Sprintf("$%d::int", index)
	case "bool":
		return fmt.Sprintf("$%d::boolean", index)
	case "json":
		return fmt.Sprintf("$%d::jsonb", index)
	default:
		return fmt.Sprintf("$%d", index)
	}
}

func cleanValue(value any) any {
	switch typed := value.(type) {
	case string:
		if strings.TrimSpace(typed) == "" {
			return nil
		}
		return strings.TrimSpace(typed)
	case []any, map[string]any:
		raw, _ := json.Marshal(typed)
		return string(raw)
	default:
		return typed
	}
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

func optionalText(value *string) any {
	if value == nil {
		return nil
	}
	text := strings.TrimSpace(*value)
	if text == "" {
		return nil
	}
	return text
}

func nullableString(value any) any {
	text := stringValue(value)
	if text == "" {
		return nil
	}
	return text
}

func nullableNumber(value any) any {
	if value == nil {
		return nil
	}
	return numberValue(value)
}

func positiveFiniteNumber(value any) (float64, bool) {
	number := numberValue(value)
	return number, number > 0 && !math.IsNaN(number) && !math.IsInf(number, 0)
}

func finiteNumberValue(value any) (float64, bool) {
	var number float64
	switch typed := value.(type) {
	case float64:
		number = typed
	case float32:
		number = float64(typed)
	case int:
		number = float64(typed)
	case int8:
		number = float64(typed)
	case int16:
		number = float64(typed)
	case int32:
		number = float64(typed)
	case int64:
		number = float64(typed)
	case uint:
		number = float64(typed)
	case uint8:
		number = float64(typed)
	case uint16:
		number = float64(typed)
	case uint32:
		number = float64(typed)
	case uint64:
		number = float64(typed)
	case json.Number:
		parsed, err := typed.Float64()
		if err != nil {
			return 0, false
		}
		number = parsed
	case string:
		text := strings.TrimSpace(typed)
		if text == "" {
			return 0, false
		}
		parsed, err := strconv.ParseFloat(text, 64)
		if err != nil {
			return 0, false
		}
		number = parsed
	default:
		return 0, false
	}
	return number, !math.IsNaN(number) && !math.IsInf(number, 0)
}

func integerValue(value any) (int, bool) {
	number, ok := finiteNumberValue(value)
	if !ok || math.Trunc(number) != number || number < float64(math.MinInt) || number > float64(math.MaxInt) {
		return 0, false
	}
	return int(number), true
}

func optionalIntegerField(payload map[string]any, key string, minimum int, maximum int) (int, bool, error) {
	raw, provided := payload[key]
	if !provided || isNilOrEmptyString(raw) {
		return 0, false, nil
	}
	value, ok := integerValue(raw)
	if !ok || value < minimum || value > maximum {
		return 0, false, ErrInvalidInput
	}
	payload[key] = value
	return value, true, nil
}

func isNilOrEmptyString(value any) bool {
	if value == nil {
		return true
	}
	text, ok := value.(string)
	return ok && strings.TrimSpace(text) == ""
}

func isFinancialCalendarDate(value string) bool {
	if len(value) != len("2006-01-02") {
		return false
	}
	parsed, err := time.Parse("2006-01-02", value)
	return err == nil && parsed.Format("2006-01-02") == value
}

func allowedString(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
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

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	default:
		return ""
	}
}

func numberValue(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		parsed, _ := typed.Float64()
		return parsed
	case string:
		parsed, _ := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(typed), ",", "."), 64)
		return parsed
	default:
		return 0
	}
}

func intFromAny(value any, fallback int) int {
	number := numberValue(value)
	if number <= 0 {
		return fallback
	}
	return int(number)
}

func normalizeUUID(value string) (string, bool) {
	var uuid pgtype.UUID
	if err := uuid.Scan(strings.TrimSpace(value)); err != nil {
		return "", false
	}
	if !uuid.Valid {
		return "", false
	}
	return uuid.String(), true
}

func contractJSONSQL(includeDetails bool) string {
	base := `to_jsonb(c) || jsonb_build_object(
		'property', case when p.id is null then null else jsonb_build_object('id', p.id::text, 'code', p.code, 'title', p.title, 'endereco', p.endereco) end,
		'lead', case when l.id is null then null else jsonb_build_object('id', l.id::text, 'name', l.name, 'email', l.email, 'phone', l.phone) end,
		'brokers', coalesce((
			select jsonb_agg(to_jsonb(cb) || jsonb_build_object(
				'commission_percentage', coalesce(cb.commission_percentage, 0),
				'user', case when u.id is null then null else jsonb_build_object('id', u.id::text, 'name', u.name, 'email', u.email) end
			) order by cb.created_at)
			from public.contract_brokers cb
			left join public.users u on u.id = cb.user_id
			where cb.contract_id = c.id
			  and exists (
				select 1
				from public.organization_members om
				where om.organization_id = c.organization_id
				  and om.user_id = cb.user_id
				  and om.is_active = true
			  )
		), '[]'::jsonb)`
	if includeDetails {
		base += `,
		'entries', coalesce((
			select jsonb_agg(to_jsonb(fe) order by fe.due_date asc nulls last)
			from public.financial_entries fe
			where fe.contract_id = c.id
			  and fe.organization_id = c.organization_id
		), '[]'::jsonb),
		'commissions', coalesce((
			select jsonb_agg(` + commissionRecordJSONSQL("cm") + ` || jsonb_build_object(
				'user', case when u.id is null then null else jsonb_build_object('id', u.id::text, 'name', u.name, 'email', u.email) end
			) order by cm.created_at desc)
			from public.commissions cm
			left join public.users u on u.id = cm.user_id
			where cm.contract_id = c.id
			  and cm.organization_id = c.organization_id
			  and exists (
				select 1
				from public.organization_members om
				where om.organization_id = c.organization_id
				  and om.user_id = cm.user_id
				  and om.is_active = true
			  )
		), '[]'::jsonb)`
	}
	return base + `)`
}

func commissionJSONSQL() string {
	return commissionRecordJSONSQL("cm") + ` || jsonb_build_object(
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

func commissionRuleJSONSQL(alias string) string {
	return `to_jsonb(` + alias + `) || jsonb_build_object(
		'commission_value', coalesce(` + alias + `.commission_value, ` + alias + `.percentage, 0),
		'is_active', coalesce(` + alias + `.is_active, true)
	)`
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

var contractFieldSpecs = map[string]FieldSpec{
	"contract_number":       {Column: "contract_number", Kind: "text"},
	"contract_type":         {Column: "contract_type", Kind: "text"},
	"status":                {Column: "status", Kind: "text"},
	"property_id":           {Column: "property_id", Kind: "uuid"},
	"lead_id":               {Column: "lead_id", Kind: "uuid"},
	"value":                 {Column: "value", Kind: "numeric"},
	"commission_percentage": {Column: "commission_percentage", Kind: "numeric"},
	"commission_value":      {Column: "commission_value", Kind: "numeric"},
	"client_name":           {Column: "client_name", Kind: "text"},
	"client_email":          {Column: "client_email", Kind: "text"},
	"client_phone":          {Column: "client_phone", Kind: "text"},
	"client_document":       {Column: "client_document", Kind: "text"},
	"down_payment":          {Column: "down_payment", Kind: "numeric"},
	"installments":          {Column: "installments", Kind: "int"},
	"payment_conditions":    {Column: "payment_conditions", Kind: "text"},
	"start_date":            {Column: "start_date", Kind: "date"},
	"end_date":              {Column: "end_date", Kind: "date"},
	"signing_date":          {Column: "signing_date", Kind: "date"},
	"closing_date":          {Column: "closing_date", Kind: "date"},
	"notes":                 {Column: "notes", Kind: "text"},
	"attachments":           {Column: "attachments", Kind: "json"},
	"created_by":            {Column: "created_by", Kind: "uuid"},
}

var commissionRuleFieldSpecs = map[string]FieldSpec{
	"name":             {Column: "name", Kind: "text"},
	"business_type":    {Column: "business_type", Kind: "text"},
	"commission_type":  {Column: "commission_type", Kind: "text"},
	"commission_value": {Column: "commission_value", Kind: "numeric"},
	"percentage":       {Column: "percentage", Kind: "numeric"},
	"is_active":        {Column: "is_active", Kind: "bool"},
}
