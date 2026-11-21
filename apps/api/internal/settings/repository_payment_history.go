package settings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const paymentHistoryProjection = `
	jsonb_build_object(
		'id', p.id::text,
		'asaas_payment_id', p.asaas_payment_id,
		'asaas_subscription_id', p.asaas_subscription_id,
		'billing_intent_id', p.billing_intent_id,
		'plan_id', coalesce(intent.plan_id, capability.plan_id),
		'plan_name', historical_plan.name,
		'billing_type', p.billing_type,
		'status', p.status,
		'value', p.value,
		'due_date', p.due_date,
		'payment_date', p.payment_date,
		'bank_slip_registration_cancelled', (
			p.bank_slip_registration_cancelled_at is not null
			and p.bank_slip_registration_cancelled_due_date is not distinct from p.due_date
		),
		'checkout_url', case
			when capability.checkout_token is not null
			then '/checkout/' || capability.checkout_token
			else null
		end,
		'receipt_path', case
			when receipt.verification_token is not null
			then '/comprovantes/' || receipt.verification_token::text
			else null
		end,
		'sync_state', 'cached',
		'created_at', p.created_at,
		'updated_at', p.updated_at
	)
`

const paymentHistoryFrom = `
	from public.asaas_payments p
	left join public.billing_payment_checkout_capabilities capability
		on capability.payment_id = p.id
		and capability.organization_id = p.organization_id
		and capability.asaas_payment_id = p.asaas_payment_id
		and capability.revoked_at is null
		and capability.expires_at > now()
		and private.billing_payment_checkout_is_resolvable(p.id)
		and upper(btrim(coalesce(p.status, ''))) in (
			'CREATED',
			'PENDING',
			'OVERDUE',
			'DUNNING_REQUESTED',
			'DUNNING_RECEIVED',
			'CREDIT_CARD_CAPTURE_REFUSED'
		)
	left join private.billing_checkout_intents intent
		on intent.id = p.billing_intent_id
		and intent.organization_id = p.organization_id
	left join public.admin_subscription_plans historical_plan
		on historical_plan.id = coalesce(intent.plan_id, capability.plan_id)
	left join public.billing_payment_receipts receipt
		on receipt.payment_id = p.id
		and receipt.organization_id = p.organization_id
`

const paymentHistoryFallbackProjection = `
	jsonb_build_object(
		'id', p.id::text,
		'asaas_payment_id', p.asaas_payment_id,
		'asaas_subscription_id', p.asaas_subscription_id,
		'billing_intent_id', p.billing_intent_id,
		'plan_id', receipt.plan_id,
		'plan_name', receipt.plan_name,
		'billing_type', p.billing_type,
		'status', p.status,
		'value', p.value,
		'due_date', p.due_date,
		'payment_date', p.payment_date,
		'bank_slip_registration_cancelled', false,
		'checkout_url', null,
		'receipt_path', case
			when receipt.verification_token is not null
			then '/comprovantes/' || receipt.verification_token::text
			else null
		end,
		'sync_state', 'cached',
		'created_at', p.created_at,
		'updated_at', p.updated_at
	)
`

const paymentHistoryFallbackFrom = `
	from public.asaas_payments p
	left join public.billing_payment_receipts receipt
		on receipt.payment_id = p.id
		and receipt.organization_id = p.organization_id
`

func (repo Repository) listPaymentHistory(ctx context.Context, organizationID string) ([]PaymentHistoryItem, bool, error) {
	rows, err := repo.db.Pool().Query(ctx, fmt.Sprintf(`
		select %s
		%s
		where p.organization_id = $1::uuid
		order by p.due_date desc nulls last, p.created_at desc
	`, paymentHistoryProjection, paymentHistoryFrom), organizationID)
	if err == nil {
		items, scanErr := scanPaymentHistoryRows(rows)
		if scanErr == nil {
			return items, true, nil
		}
		err = scanErr
	}
	if !isPaymentHistoryCheckoutSchemaDrift(err) {
		return nil, false, err
	}

	rows, err = repo.db.Pool().Query(ctx, fmt.Sprintf(`
		select %s
		%s
		where p.organization_id = $1::uuid
		order by p.due_date desc nulls last, p.created_at desc
	`, paymentHistoryFallbackProjection, paymentHistoryFallbackFrom), organizationID)
	if err != nil {
		return nil, false, err
	}
	items, scanErr := scanPaymentHistoryRows(rows)
	return items, false, scanErr
}

func scanPaymentHistoryRows(rows pgx.Rows) ([]PaymentHistoryItem, error) {
	defer rows.Close()
	items := []PaymentHistoryItem{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var item PaymentHistoryItem
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (repo Repository) getPaymentHistoryItem(
	ctx context.Context,
	organizationID string,
	paymentID string,
) (PaymentHistoryItem, error) {
	var raw []byte
	err := repo.db.Pool().QueryRow(ctx, fmt.Sprintf(`
		select %s
		%s
		where p.organization_id = $1::uuid
		  and p.id = $2::uuid
		limit 1
	`, paymentHistoryProjection, paymentHistoryFrom), organizationID, paymentID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return PaymentHistoryItem{}, ErrPaymentNotFound
	}
	if err != nil {
		return PaymentHistoryItem{}, err
	}

	var item PaymentHistoryItem
	if err := json.Unmarshal(raw, &item); err != nil {
		return PaymentHistoryItem{}, err
	}
	return item, nil
}

func isPaymentHistoryCheckoutSchemaDrift(err error) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}

	message := strings.ToLower(strings.TrimSpace(pgErr.Message))
	tableName := strings.ToLower(strings.TrimSpace(pgErr.TableName))
	columnName := strings.ToLower(strings.TrimSpace(pgErr.ColumnName))

	switch pgErr.Code {
	case "42P01":
		return tableName == "billing_payment_checkout_capabilities" ||
			strings.Contains(message, `relation "billing_payment_checkout_capabilities" does not exist`) ||
			strings.Contains(message, `relation "public.billing_payment_checkout_capabilities" does not exist`)
	case "42703":
		return columnName == "bank_slip_registration_cancelled_at" ||
			columnName == "bank_slip_registration_cancelled_due_date" ||
			strings.Contains(message, "column p.bank_slip_registration_cancelled_at does not exist") ||
			strings.Contains(message, "column p.bank_slip_registration_cancelled_due_date does not exist")
	case "42883":
		return strings.Contains(
			message,
			"function private.billing_payment_checkout_is_resolvable(uuid) does not exist",
		)
	default:
		return false
	}
}
