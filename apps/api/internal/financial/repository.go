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
	storage storageClient
}

type execer interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

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

	return repo.queryJSONRows(ctx, `
		select to_jsonb(fe) || jsonb_build_object(
			'contract', case when c.id is null then null else jsonb_build_object('contract_number', c.contract_number) end
		)
		from public.financial_entries fe
		left join public.contracts c on c.id = fe.contract_id
		where `+strings.Join(where, " and ")+`
		order by fe.due_date asc nulls last, fe.created_at desc
	`, args...)
}

func (repo Repository) CreateEntry(ctx context.Context, tenantContext tenant.Context, payload map[string]any) (map[string]any, error) {
	if !canManageFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if stringValue(payload["type"]) == "" {
		return nil, ErrInvalidInput
	}
	payload["created_by"] = tenantContext.UserID
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
	return repo.updateMap(ctx, "financial_entries", tenantContext.OrganizationID, id, payload, entryFieldSpecs, "to_jsonb(financial_entries)")
}

func (repo Repository) DeleteEntry(ctx context.Context, tenantContext tenant.Context, id string) error {
	if !canManageFinancial(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	return repo.deleteByID(ctx, "financial_entries", tenantContext.OrganizationID, id)
}

func (repo Repository) MarkEntryPaid(ctx context.Context, tenantContext tenant.Context, id string, payload map[string]any) (map[string]any, error) {
	if !canManageFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok {
		return nil, ErrInvalidInput
	}
	paidValue := nullableNumber(payload["paid_value"])
	return repo.queryJSONObject(ctx, `
		update public.financial_entries
		set status = 'paid',
		    paid_date = current_date,
		    paid_value = coalesce($3::numeric, paid_value),
		    paid_amount = coalesce($3::numeric, paid_amount),
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		returning to_jsonb(financial_entries)
	`, tenantContext.OrganizationID, id, paidValue)
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
	return repo.queryJSONRows(ctx, `
		select `+contractJSONSQL(false)+`
		from public.contracts c
		left join public.properties p on p.id = c.property_id
		left join public.leads l on l.id = c.lead_id
		where `+strings.Join(where, " and ")+`
		order by c.created_at desc
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
	item, err := repo.queryJSONObject(ctx, `
		select `+contractJSONSQL(true)+`
		from public.contracts c
		left join public.properties p on p.id = c.property_id
		left join public.leads l on l.id = c.lead_id
		where c.organization_id = $1::uuid
		  and c.id = $2::uuid
	`, tenantContext.OrganizationID, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return item, err
}

func (repo Repository) CreateContract(ctx context.Context, tenantContext tenant.Context, payload map[string]any) (map[string]any, error) {
	if !canManageFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	brokers := brokerPayload(payload["brokers"])
	delete(payload, "brokers")
	payload["created_by"] = tenantContext.UserID

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

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
	if err := replaceContractBrokers(ctx, tx, contractID, numberValue(payload["value"]), brokers); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return repo.ShowContract(ctx, tenantContext, contractID)
}

func (repo Repository) UpdateContract(ctx context.Context, tenantContext tenant.Context, id string, payload map[string]any) (map[string]any, error) {
	if !canManageFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok {
		return nil, ErrInvalidInput
	}
	brokers, hasBrokers := payload["brokers"]
	delete(payload, "brokers")

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	contract, err := repo.updateMapWithExec(ctx, tx, "contracts", tenantContext.OrganizationID, id, payload, contractFieldSpecs, "to_jsonb(contracts)")
	if err != nil {
		return nil, err
	}
	value := numberValue(contract["value"])
	if hasBrokers {
		if err := replaceContractBrokers(ctx, tx, id, value, brokerPayload(brokers)); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return repo.ShowContract(ctx, tenantContext, id)
}

func (repo Repository) DeleteContract(ctx context.Context, tenantContext tenant.Context, id string) error {
	if !canManageFinancial(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	return repo.deleteByID(ctx, "contracts", tenantContext.OrganizationID, id)
}

func (repo Repository) ActivateContract(ctx context.Context, tenantContext tenant.Context, id string, skipCommissions bool) (map[string]any, error) {
	if !canManageFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok {
		return nil, ErrInvalidInput
	}
	contract, err := repo.ShowContract(ctx, tenantContext, id)
	if err != nil {
		return nil, err
	}
	brokers := brokerPayload(contract["brokers"])
	if len(brokers) == 0 && !skipCommissions {
		return nil, fmt.Errorf("%w: no brokers", ErrInvalidInput)
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		update public.contracts
		set status = 'active',
		    signing_date = current_date,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, id); err != nil {
		return nil, err
	}

	totalValue := numberValue(contract["value"])
	downPayment := numberValue(contract["down_payment"])
	installments := intFromAny(contract["installments"], 1)
	if installments < 1 {
		installments = 1
	}
	if err := createContractReceivables(ctx, tx, tenantContext, id, stringValue(contract["contract_number"]), totalValue, downPayment, installments); err != nil {
		return nil, err
	}
	if len(brokers) > 0 {
		if _, err := regenerateContractCommissions(ctx, tx, tenantContext, contract, brokers); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return repo.ShowContract(ctx, tenantContext, id)
}

func (repo Repository) RegenerateCommissions(ctx context.Context, tenantContext tenant.Context, id string) (map[string]any, error) {
	if !canManageFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	contract, err := repo.ShowContract(ctx, tenantContext, id)
	if err != nil {
		return nil, err
	}
	brokers := brokerPayload(contract["brokers"])
	if len(brokers) == 0 {
		return nil, ErrInvalidInput
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
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
	objectPath := fmt.Sprintf("%s/%s/%d_%s", tenantContext.OrganizationID, id, time.Now().UnixMilli(), safeName)
	if err := repo.storage.upload(ctx, "contract-documents", objectPath, contentType, body); err != nil {
		return nil, err
	}
	doc := map[string]any{
		"name":        fileName,
		"path":        objectPath,
		"size":        size,
		"uploaded_at": time.Now().UTC().Format(time.RFC3339),
	}
	raw, _ := json.Marshal(doc)
	if _, err := repo.db.Pool().Exec(ctx, `
		update public.contracts
		set attachments = attachments || $3::jsonb,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, id, string(raw)); err != nil {
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
	if err := repo.ensureContract(ctx, tenantContext, id); err != nil {
		return err
	}
	if err := repo.storage.remove(ctx, "contract-documents", []string{path}); err != nil {
		return err
	}
	_, err := repo.db.Pool().Exec(ctx, `
		update public.contracts
		set attachments = coalesce((
			select jsonb_agg(item)
			from jsonb_array_elements(attachments) item
			where item->>'path' <> $3
		), '[]'::jsonb),
		updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, id, path)
	return err
}

func (repo Repository) ContractDocumentSignedURL(ctx context.Context, tenantContext tenant.Context, id string, path string) (map[string]any, error) {
	if !canReadFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok || strings.TrimSpace(path) == "" {
		return nil, ErrInvalidInput
	}
	if err := repo.ensureContract(ctx, tenantContext, id); err != nil {
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
		select to_jsonb(cr)
		from public.commission_rules cr
		where cr.organization_id = $1::uuid
		order by cr.name asc
	`, tenantContext.OrganizationID)
}

func (repo Repository) CreateCommissionRule(ctx context.Context, tenantContext tenant.Context, payload map[string]any) (map[string]any, error) {
	if !canManageFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if stringValue(payload["name"]) == "" {
		return nil, ErrInvalidInput
	}
	normalizeCommissionRulePayload(payload)
	return repo.insertMap(ctx, "commission_rules", tenantContext.OrganizationID, payload, commissionRuleFieldSpecs, "to_jsonb(commission_rules)")
}

func (repo Repository) UpdateCommissionRule(ctx context.Context, tenantContext tenant.Context, id string, payload map[string]any) (map[string]any, error) {
	if !canManageFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	normalizeCommissionRulePayload(payload)
	return repo.updateMap(ctx, "commission_rules", tenantContext.OrganizationID, id, payload, commissionRuleFieldSpecs, "to_jsonb(commission_rules)")
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
		add(value, "cm.status = $%d")
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
	return repo.queryJSONRows(ctx, `
		select `+commissionJSONSQL()+`
		from public.commissions cm
		left join public.users u on u.id = cm.user_id
		left join public.contracts c on c.id = cm.contract_id
		left join public.properties p on p.id = cm.property_id
		where `+strings.Join(where, " and ")+`
		order by cm.created_at desc
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
	switch action {
	case "approve":
		return repo.queryJSONObject(ctx, `
			update public.commissions
			set status = 'approved',
			    approved_at = now(),
			    approved_by = $3::uuid,
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
			returning to_jsonb(commissions)
		`, tenantContext.OrganizationID, id, tenantContext.UserID)
	case "pay":
		return repo.queryJSONObject(ctx, `
			update public.commissions
			set status = 'paid',
			    paid_at = now(),
			    paid_by = $3::uuid,
			    payment_proof = coalesce($4, payment_proof),
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
			returning to_jsonb(commissions)
		`, tenantContext.OrganizationID, id, tenantContext.UserID, optionalText(request.PaymentProof))
	case "cancel":
		return repo.queryJSONObject(ctx, `
			update public.commissions
			set status = 'cancelled',
			    notes = coalesce($3, notes),
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
			returning to_jsonb(commissions)
		`, tenantContext.OrganizationID, id, optionalText(request.Notes))
	default:
		return nil, ErrInvalidInput
	}
}

func (repo Repository) CommissionsByBroker(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	if !canReadFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	return repo.queryJSONRows(ctx, `
		select jsonb_build_object(
			'user', jsonb_build_object('id', u.id::text, 'name', u.name, 'email', u.email),
			'forecast', coalesce(sum(coalesce(cm.amount, cm.calculated_value)) filter (where cm.status = 'forecast'), 0),
			'approved', coalesce(sum(coalesce(cm.amount, cm.calculated_value)) filter (where cm.status = 'approved'), 0),
			'paid', coalesce(sum(coalesce(cm.amount, cm.calculated_value)) filter (where cm.status = 'paid'), 0),
			'total', coalesce(sum(coalesce(cm.amount, cm.calculated_value)), 0)
		)
		from public.commissions cm
		left join public.users u on u.id = cm.user_id
		where cm.organization_id = $1::uuid
		group by u.id, u.name, u.email
		order by coalesce(sum(coalesce(cm.amount, cm.calculated_value)), 0) desc
	`, tenantContext.OrganizationID)
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
	return repo.queryJSONRows(ctx, `
		select to_jsonb(m) || jsonb_build_object(
			'group', case when g.id is null then null else jsonb_build_object('id', g.id::text, 'name', g.name, 'group_type', g.group_type) end
		)
		from public.dre_account_mappings m
		left join public.dre_account_groups g on g.id = m.group_id
		where m.organization_id = $1::uuid
		order by m.created_at desc
	`, tenantContext.OrganizationID)
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

func (repo Repository) nextContractNumber(ctx context.Context, exec execer, organizationID string) (string, error) {
	var nextNumber int
	if err := exec.QueryRow(ctx, `
		insert into public.contract_sequences (organization_id, last_number)
		values ($1::uuid, 1)
		on conflict (organization_id)
		do update set last_number = contract_sequences.last_number + 1,
		              updated_at = now()
		returning last_number
	`, organizationID).Scan(&nextNumber); err != nil {
		return "", err
	}
	return fmt.Sprintf("CTR-%d-%05d", time.Now().Year(), nextNumber), nil
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

func replaceContractBrokers(ctx context.Context, exec execer, contractID string, contractValue float64, brokers []map[string]any) error {
	if _, err := exec.Exec(ctx, `delete from public.contract_brokers where contract_id = $1::uuid`, contractID); err != nil {
		return err
	}
	for _, broker := range brokers {
		userID := stringValue(broker["user_id"])
		if _, ok := normalizeUUID(userID); !ok {
			return ErrInvalidInput
		}
		percentage := numberValue(broker["commission_percentage"])
		role := nullableString(broker["role"])
		if _, err := exec.Exec(ctx, `
			insert into public.contract_brokers (contract_id, user_id, commission_percentage, commission_value, role)
			values ($1::uuid, $2::uuid, $3, $4, $5)
		`, contractID, userID, percentage, contractValue*(percentage/100), role); err != nil {
			return err
		}
	}
	return nil
}

func createContractReceivables(ctx context.Context, exec execer, tenantContext tenant.Context, contractID string, contractNumber string, totalValue float64, downPayment float64, installments int) error {
	remainingValue := math.Max(0, totalValue-downPayment)
	installmentValue := 0.0
	if installments > 0 {
		installmentValue = remainingValue / float64(installments)
	}
	if downPayment > 0 {
		if _, err := exec.Exec(ctx, `
			insert into public.financial_entries (
				organization_id, contract_id, type, category, description, amount, due_date, status,
				installment_number, total_installments, created_by
			)
			values ($1::uuid, $2::uuid, 'receivable', 'Entrada', $3, $4, current_date, 'pending', 0, $5, $6::uuid)
		`, tenantContext.OrganizationID, contractID, "Entrada - Contrato "+contractNumber, downPayment, installments, tenantContext.UserID); err != nil {
			return err
		}
	}
	for i := 1; i <= installments; i++ {
		dueDate := time.Now().AddDate(0, i, 0).Format("2006-01-02")
		if _, err := exec.Exec(ctx, `
			insert into public.financial_entries (
				organization_id, contract_id, type, category, description, amount, due_date, status,
				installment_number, total_installments, created_by
			)
			values ($1::uuid, $2::uuid, 'receivable', 'Parcela', $3, $4, $5::date, 'pending', $6, $7, $8::uuid)
		`, tenantContext.OrganizationID, contractID, fmt.Sprintf("Parcela %d/%d - Contrato %s", i, installments, contractNumber), installmentValue, dueDate, i, installments, tenantContext.UserID); err != nil {
			return err
		}
	}
	return nil
}

func regenerateContractCommissions(ctx context.Context, exec execer, tenantContext tenant.Context, contract map[string]any, brokers []map[string]any) (map[string]any, error) {
	contractID := stringValue(contract["id"])
	totalValue := numberValue(contract["value"])
	propertyID := nullableString(contract["property_id"])
	if _, err := exec.Exec(ctx, `delete from public.commissions where contract_id = $1::uuid`, contractID); err != nil {
		return nil, err
	}
	if _, err := exec.Exec(ctx, `
		delete from public.financial_entries
		where contract_id = $1::uuid
		  and category = 'Comissão'
	`, contractID); err != nil {
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
	return tenantContext.HasPermission("financial_manage") || tenantContext.HasRole("owner", "admin", "corretor", "broker", "agent", "user")
}

func canManageFinancial(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission("financial_manage") || tenantContext.HasRole("owner", "admin")
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
				'user', jsonb_build_object('id', u.id::text, 'name', u.name, 'email', u.email)
			) order by cb.created_at)
			from public.contract_brokers cb
			left join public.users u on u.id = cb.user_id
			where cb.contract_id = c.id
		), '[]'::jsonb)`
	if includeDetails {
		base += `,
		'entries', coalesce((
			select jsonb_agg(to_jsonb(fe) order by fe.due_date asc nulls last)
			from public.financial_entries fe
			where fe.contract_id = c.id
		), '[]'::jsonb),
		'commissions', coalesce((
			select jsonb_agg(to_jsonb(cm) || jsonb_build_object('user', jsonb_build_object('name', u.name)) order by cm.created_at desc)
			from public.commissions cm
			left join public.users u on u.id = cm.user_id
			where cm.contract_id = c.id
		), '[]'::jsonb)`
	}
	return base + `)`
}

func commissionJSONSQL() string {
	return `to_jsonb(cm) || jsonb_build_object(
		'user', case when u.id is null then null else jsonb_build_object('id', u.id::text, 'name', u.name, 'email', u.email) end,
		'contract', case when c.id is null then null else jsonb_build_object('contract_number', c.contract_number, 'client_name', c.client_name) end,
		'property', case when p.id is null then null else jsonb_build_object('code', p.code, 'title', p.title) end,
		'calculated_value', coalesce(cm.calculated_value, cm.amount, 0)
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
