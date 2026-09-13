package financial

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/propertyscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) ListContracts(ctx context.Context, tenantContext tenant.Context, values url.Values) ([]map[string]any, error) {
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
		 and $2::boolean
		 and `+propertyscope.VisibilitySQL("p", "$3", "$4", "$5")+`
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
	return repo.showContractWithExec(ctx, repo.db.Pool(), tenantContext, id, false)
}

func (repo Repository) showContractWithExec(ctx context.Context, exec execer, tenantContext tenant.Context, id string, lock bool) (map[string]any, error) {
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
		 and $3::boolean
		 and `+propertyscope.VisibilitySQL("p", "$4", "$5", "$6")+`
		left join public.leads l
		  on l.id = c.lead_id
		 and l.organization_id = c.organization_id
		where c.organization_id = $1::uuid
		  and c.id = $2::uuid
	`+lockClause,
		tenantContext.OrganizationID,
		id,
		propertyscope.CanRead(tenantContext),
		propertyscope.CanViewAll(tenantContext),
		tenantContext.UserID,
		propertyscope.CanViewTeam(tenantContext),
	)
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
	if err := validateContractReferences(ctx, tx, tenantContext, payload); err != nil {
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
	item, err := repo.showContractWithExec(ctx, tx, tenantContext, contractID, false)
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
	if err := validateContractReferences(ctx, tx, tenantContext, payload); err != nil {
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
	item, err := repo.showContractWithExec(ctx, tx, tenantContext, id, false)
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
	item, err := repo.showContractWithExec(ctx, tx, tenantContext, id, false)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return item, nil
}

func (repo Repository) activateContractWithExec(ctx context.Context, exec execer, tenantContext tenant.Context, id string, skipCommissions bool) error {
	contract, err := repo.showContractWithExec(ctx, exec, tenantContext, id, true)
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

func contractJSONSQL(includeDetails bool) string {
	base := `to_jsonb(c) || jsonb_build_object(
		'property_id', case when p.id is null then null else c.property_id end,
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
				'property_id', case when p.id is null then null else cm.property_id end,
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
