package settings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type localPaymentIdentity struct {
	ID                  string
	AsaasPaymentID      string
	AsaasCustomerID     string
	AsaasSubscriptionID string
	BillingType         string
	Value               float64
	DueDate             string
}

type paymentSnapshotApplyResult struct {
	Outcome string `json:"outcome"`
	Field   string `json:"field"`
}

// RefreshSubscriptionPayment reconciles one tenant-scoped local payment with
// its authoritative Asaas snapshot. The observation timestamp is captured
// before the network request so a newer webhook always wins the database
// ordering race.
func (repo Repository) RefreshSubscriptionPayment(
	ctx context.Context,
	tenantContext tenant.Context,
	paymentID string,
) (PaymentHistoryItem, error) {
	if !canManageSetting(tenantContext, permissions.SettingsBilling) {
		return PaymentHistoryItem{}, tenant.ErrOrganizationAccessDenied
	}

	paymentID, ok := normalizeUUID(paymentID)
	if !ok {
		return PaymentHistoryItem{}, ErrPaymentNotFound
	}

	local, err := repo.getLocalPaymentIdentity(ctx, tenantContext.OrganizationID, paymentID)
	if err != nil {
		return PaymentHistoryItem{}, err
	}
	item, err := repo.getPaymentHistoryItem(ctx, tenantContext.OrganizationID, paymentID)
	if err != nil {
		return PaymentHistoryItem{}, err
	}

	observedAt := time.Now().UTC()
	snapshot, providerErr := repo.asaasSubscriptions.getPayment(ctx, local.AsaasPaymentID)
	if providerErr != nil {
		if ctx.Err() != nil {
			return PaymentHistoryItem{}, ctx.Err()
		}

		// A provider 404 is ambiguous (deleted payment, wrong provider account,
		// or temporary inconsistency). Keep the last local status, mark it as
		// unavailable, and suppress the checkout URL instead of claiming it was
		// cancelled. The same safe response is used for timeouts and upstream
		// outages.
		slog.Warn(
			"billing payment provider refresh unavailable",
			"organization_id", tenantContext.OrganizationID,
			"payment_id", paymentID,
			"provider_not_found", isAsaasPaymentNotFound(providerErr),
		)
		item.SyncState = PaymentSyncStateProviderUnavailable
		item.CheckoutURL = nil
		return item, nil
	}

	if err := validateAsaasPaymentSnapshot(snapshot, local); err != nil {
		slog.Error(
			"billing payment provider identity mismatch",
			"organization_id", tenantContext.OrganizationID,
			"payment_id", paymentID,
		)
		return PaymentHistoryItem{}, err
	}

	providerStatus := snapshot.normalizedStatus()
	if providerStatus == "" {
		item.SyncState = PaymentSyncStateProviderUnavailable
		item.CheckoutURL = nil
		return item, nil
	}

	providerValue := local.Value
	providerDueDate := local.DueDate
	providerCustomerID := local.AsaasCustomerID
	providerSubscriptionID := local.AsaasSubscriptionID
	if !snapshot.Deleted {
		providerValue = *snapshot.Value
		providerDueDate = snapshot.DueDate
		providerCustomerID = snapshot.CustomerID
		providerSubscriptionID = snapshot.SubscriptionID
	}

	var rawResult string
	err = repo.db.Pool().QueryRow(ctx, `
		select public.reconcile_asaas_payment_snapshot(
			$1::uuid,
			nullif($2, ''),
			nullif($3, ''),
			nullif($4, ''),
			nullif($5, ''),
			$6::numeric,
			nullif($7, '')::date,
			$8::timestamptz,
			'settings_payment_refresh'
		)::text
	`,
		tenantContext.OrganizationID,
		local.AsaasPaymentID,
		providerCustomerID,
		providerSubscriptionID,
		providerStatus,
		providerValue,
		providerDueDate,
		observedAt,
	).Scan(&rawResult)
	if err != nil {
		return PaymentHistoryItem{}, err
	}

	var applyResult paymentSnapshotApplyResult
	if err := json.Unmarshal([]byte(rawResult), &applyResult); err != nil {
		return PaymentHistoryItem{}, fmt.Errorf("decode payment refresh result: %w", err)
	}
	switch applyResult.Outcome {
	case "applied", "stale", "stale_snapshot":
		// A stale outcome means a webhook already persisted a newer truth. The
		// reread below intentionally returns that newer row.
	case "organization_not_found", "payment_not_found":
		return PaymentHistoryItem{}, ErrPaymentNotFound
	case "identifier_mismatch", "amount_mismatch", "invalid_identity", "invalid_payment_snapshot", "unsupported_status", "invalid_observed_at", "invalid_source":
		return PaymentHistoryItem{}, fmt.Errorf(
			"%w: %s",
			ErrPaymentProviderMismatch,
			strings.TrimSpace(applyResult.Field),
		)
	default:
		return PaymentHistoryItem{}, fmt.Errorf(
			"unexpected payment refresh outcome %q",
			applyResult.Outcome,
		)
	}

	item, err = repo.getPaymentHistoryItem(ctx, tenantContext.OrganizationID, paymentID)
	if err != nil {
		return PaymentHistoryItem{}, err
	}
	item.SyncState = PaymentSyncStateCurrent
	return item, nil
}

func (repo Repository) getLocalPaymentIdentity(
	ctx context.Context,
	organizationID string,
	paymentID string,
) (localPaymentIdentity, error) {
	var item localPaymentIdentity
	err := repo.db.Pool().QueryRow(ctx, `
		select
			p.id::text,
			p.asaas_payment_id,
			coalesce(p.asaas_customer_id, ''),
			coalesce(p.asaas_subscription_id, ''),
			upper(coalesce(p.billing_type, '')),
			coalesce(p.value, 0)::double precision,
			coalesce(p.due_date::text, '')
		from public.asaas_payments p
		where p.organization_id = $1::uuid
		  and p.id = $2::uuid
		limit 1
	`, organizationID, paymentID).Scan(
		&item.ID,
		&item.AsaasPaymentID,
		&item.AsaasCustomerID,
		&item.AsaasSubscriptionID,
		&item.BillingType,
		&item.Value,
		&item.DueDate,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return localPaymentIdentity{}, ErrPaymentNotFound
	}
	if err != nil {
		return localPaymentIdentity{}, err
	}
	return item, nil
}
