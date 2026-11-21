package settings

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) SelectSubscriptionPlan(ctx context.Context, tenantContext tenant.Context, planID string) (SubscriptionOverview, error) {
	if !canManageSetting(tenantContext, permissions.SettingsBilling) {
		return SubscriptionOverview{}, tenant.ErrOrganizationAccessDenied
	}

	planID, ok := normalizeUUID(planID)
	if !ok {
		return SubscriptionOverview{}, ErrInvalidInput
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return SubscriptionOverview{}, err
	}
	defer tx.Rollback(ctx)

	var currentPlanID, pendingPlanID, subscriptionType, subscriptionStatus, providerSubscriptionID string
	var currentPlanConsistent bool
	var targetPlanName, nextBillingDate string
	var targetPlanPrice float64
	var billingPeriodMonths int
	err = tx.QueryRow(ctx, `
		select
			coalesce(o.plan_id::text, ''),
			coalesce(o.pending_plan_id::text, ''),
			coalesce(o.subscription_type, ''),
			coalesce(o.subscription_status, ''),
			coalesce(o.asaas_subscription_id, ''),
			exists (
				select 1
				from public.admin_subscription_plans current_plan
				where current_plan.id = o.plan_id
				  and coalesce(current_plan.price, 0) > 0
			),
			p.name,
			p.price::double precision,
			case
				when o.subscription_billing_period_months in (1, 6, 12)
					then o.subscription_billing_period_months
				else 1
			end,
			coalesce(to_char(o.next_billing_date, 'YYYY-MM-DD'), '')
		from public.organizations o
		join public.admin_subscription_plans p
		  on p.id = $2::uuid
		 and coalesce(p.is_active, true) = true
		 and coalesce(p.is_public, true) = true
		 and coalesce(p.price, 0) > 0
		 and lower(btrim(p.name)) not in ('trial', 'básico', 'basico')
		where o.id = $1::uuid
		for update of o
	`, tenantContext.OrganizationID, planID).Scan(
		&currentPlanID,
		&pendingPlanID,
		&subscriptionType,
		&subscriptionStatus,
		&providerSubscriptionID,
		&currentPlanConsistent,
		&targetPlanName,
		&targetPlanPrice,
		&billingPeriodMonths,
		&nextBillingDate,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return SubscriptionOverview{}, ErrInvalidInput
	}
	if err != nil {
		return SubscriptionOverview{}, err
	}
	var activeCheckoutPlanID string
	err = tx.QueryRow(ctx, `
		select coalesce(intent.pending_plan_id::text, '')
		from private.billing_checkout_intents intent
		where intent.organization_id = $1::uuid
		  and intent.status in ('creating', 'pending')
		order by intent.created_at desc, intent.id desc
		limit 1
		for update
	`, tenantContext.OrganizationID).Scan(&activeCheckoutPlanID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return SubscriptionOverview{}, err
	}
	// Re-selecting the current paid plan is an idempotent read, not permission
	// to open a second provider subscription.
	if isIdempotentPaidPlanSelection(
		subscriptionType,
		subscriptionStatus,
		currentPlanID,
		planID,
		currentPlanConsistent,
	) {
		if strings.TrimSpace(pendingPlanID) != "" &&
			!strings.EqualFold(strings.TrimSpace(pendingPlanID), planID) {
			return SubscriptionOverview{}, ErrPlanChangeInProgress
		}
		if err := tx.Commit(ctx); err != nil {
			return SubscriptionOverview{}, err
		}
		return repo.GetSubscriptionOverview(ctx, tenantContext)
	}

	// A provider-linked organization must never fall through to checkout, even
	// if its local subscription type drifted away from the provider contract.
	// Only an active contract with a known paid current plan may continue, and
	// that path is required to become the managed update below. Missing catalog
	// state and non-active contracts fail closed for billing regularization.
	if blocksProviderPlanChange(
		subscriptionType,
		subscriptionStatus,
		currentPlanID,
		planID,
		providerSubscriptionID,
		currentPlanConsistent,
	) {
		return SubscriptionOverview{}, ErrPlanChangeRequiresActive
	}
	if activeCheckoutPlanID != "" && !strings.EqualFold(activeCheckoutPlanID, planID) {
		return SubscriptionOverview{}, ErrCheckoutInProgress
	}

	managedPlanChange := requiresManagedPlanChange(
		subscriptionType,
		subscriptionStatus,
		currentPlanID,
		planID,
		providerSubscriptionID,
		currentPlanConsistent,
	)
	if managedPlanChange {
		if activeCheckoutPlanID != "" {
			return SubscriptionOverview{}, ErrCheckoutInProgress
		}
		if !repo.asaasSubscriptions.isConfigured() {
			return SubscriptionOverview{}, ErrAsaasNotConfigured
		}

		amount := math.Round(targetPlanPrice*float64(billingPeriodMonths)*100) / 100
		cycle := asaasCycleForBillingPeriod(billingPeriodMonths)
		description := managedPlanDescription(targetPlanName, billingPeriodMonths)
		changeID, alreadyScheduled, recoverProviderState, err := stageManagedPlanChange(
			ctx,
			tx,
			tenantContext,
			currentPlanID,
			planID,
			providerSubscriptionID,
			billingPeriodMonths,
			amount,
			cycle,
			description,
			pendingPlanID,
		)
		if err != nil {
			return SubscriptionOverview{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return SubscriptionOverview{}, err
		}
		if alreadyScheduled {
			return repo.GetSubscriptionOverview(ctx, tenantContext)
		}

		providerInput := asaasPlanChangeInput{
			Amount:      amount,
			Cycle:       cycle,
			Description: description,
		}
		var snapshot asaasSubscriptionSnapshot
		var providerErr error
		if recoverProviderState {
			snapshot, providerErr = repo.asaasSubscriptions.recoverPlanChange(
				ctx,
				providerSubscriptionID,
				providerInput,
			)
		} else {
			snapshot, providerErr = repo.asaasSubscriptions.schedulePlanChange(
				ctx,
				providerSubscriptionID,
				providerInput,
			)
		}
		if providerErr != nil {
			persistenceCtx, cancelPersistence := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer cancelPersistence()
			if errors.Is(providerErr, ErrAsaasOperation) {
				if persistErr := repo.failManagedPlanChange(
					persistenceCtx,
					tenantContext.OrganizationID,
					changeID,
					planID,
				); persistErr != nil {
					return SubscriptionOverview{}, errors.Join(providerErr, persistErr)
				}
			} else if errors.Is(providerErr, ErrAsaasAmbiguous) {
				if persistErr := repo.markManagedPlanChangeAmbiguous(persistenceCtx, changeID); persistErr != nil {
					return SubscriptionOverview{}, errors.Join(providerErr, persistErr)
				}
			}
			return SubscriptionOverview{}, providerErr
		}

		effectiveOn := normalizeProviderDate(snapshot.NextDueDate)
		if effectiveOn == "" {
			effectiveOn = normalizeProviderDate(nextBillingDate)
		}
		persistenceCtx, cancelPersistence := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancelPersistence()
		if effectiveOn == "" {
			// Never guess a billing anchor. The payment trigger can still recover
			// an accepted but ambiguous provider update from an exact future charge.
			if persistErr := repo.markManagedPlanChangeAmbiguous(persistenceCtx, changeID); persistErr != nil {
				return SubscriptionOverview{}, errors.Join(ErrAsaasAmbiguous, persistErr)
			}
			return SubscriptionOverview{}, ErrAsaasAmbiguous
		}
		if err := repo.confirmManagedPlanChange(
			persistenceCtx,
			changeID,
			snapshot.rawJSON(),
			effectiveOn,
		); err != nil {
			// The provider may already have accepted the update. Keeping the
			// durable row in provider_updating lets an identical retry recover.
			return SubscriptionOverview{}, err
		}

		return repo.GetSubscriptionOverview(ctx, tenantContext)
	}

	stagedStatus := subscriptionStatusWhilePlanPending(subscriptionType, subscriptionStatus)
	tag, err := tx.Exec(ctx, `
		update public.organizations o
		set
			pending_plan_id = p.id,
			subscription_status = $3,
			updated_at = now()
		from public.admin_subscription_plans p
		where o.id = $1::uuid
		  and p.id = $2::uuid
		  and coalesce(p.is_active, true) = true
		  and coalesce(p.is_public, true) = true
		  and coalesce(p.price, 0) > 0
		  and lower(btrim(p.name)) not in ('trial', 'básico', 'basico')
	`, tenantContext.OrganizationID, planID, stagedStatus)
	if err != nil {
		return SubscriptionOverview{}, err
	}
	if tag.RowsAffected() == 0 {
		return SubscriptionOverview{}, ErrInvalidInput
	}
	if err := tx.Commit(ctx); err != nil {
		return SubscriptionOverview{}, err
	}

	return repo.GetSubscriptionOverview(ctx, tenantContext)
}

func asaasCycleForBillingPeriod(months int) string {
	switch months {
	case 6:
		return "SEMIANNUALLY"
	case 12:
		return "YEARLY"
	default:
		return "MONTHLY"
	}
}

func managedPlanDescription(planName string, months int) string {
	return fmt.Sprintf("Vimob CRM - Plano %s - %d mes(es)", strings.TrimSpace(planName), months)
}

func normalizeProviderDate(value string) string {
	value = strings.TrimSpace(value)
	if len(value) != len("2006-01-02") {
		return ""
	}
	if _, err := time.Parse("2006-01-02", value); err != nil {
		return ""
	}
	return value
}

func subscriptionStatusWhilePlanPending(subscriptionType string, subscriptionStatus string) string {
	subscriptionType = strings.ToLower(strings.TrimSpace(subscriptionType))
	subscriptionStatus = strings.ToLower(strings.TrimSpace(subscriptionStatus))

	if (subscriptionType == "free" || subscriptionType == "paid") && subscriptionStatus == "active" {
		return "active"
	}
	if subscriptionType == "trial" && subscriptionStatus == "trial" {
		return "trial"
	}
	return "pending_payment"
}

func isIdempotentPaidPlanSelection(
	subscriptionType string,
	subscriptionStatus string,
	currentPlanID string,
	targetPlanID string,
	currentPlanConsistent bool,
) bool {
	return strings.EqualFold(strings.TrimSpace(subscriptionType), "paid") &&
		strings.EqualFold(strings.TrimSpace(subscriptionStatus), "active") &&
		currentPlanConsistent &&
		strings.TrimSpace(currentPlanID) != "" &&
		strings.EqualFold(strings.TrimSpace(currentPlanID), strings.TrimSpace(targetPlanID))
}

func requiresManagedPlanChange(
	subscriptionType string,
	subscriptionStatus string,
	currentPlanID string,
	targetPlanID string,
	providerSubscriptionID string,
	currentPlanConsistent bool,
) bool {
	differentPlan := strings.TrimSpace(currentPlanID) != "" &&
		strings.TrimSpace(targetPlanID) != "" &&
		!strings.EqualFold(strings.TrimSpace(currentPlanID), strings.TrimSpace(targetPlanID))
	if !differentPlan ||
		!currentPlanConsistent ||
		!strings.EqualFold(strings.TrimSpace(subscriptionType), "paid") ||
		!strings.EqualFold(strings.TrimSpace(subscriptionStatus), "active") {
		return false
	}

	return strings.TrimSpace(providerSubscriptionID) != ""
}

func blocksProviderPlanChange(
	subscriptionType string,
	subscriptionStatus string,
	currentPlanID string,
	targetPlanID string,
	providerSubscriptionID string,
	currentPlanConsistent bool,
) bool {
	differentPlan := strings.TrimSpace(currentPlanID) != "" &&
		strings.TrimSpace(targetPlanID) != "" &&
		!strings.EqualFold(strings.TrimSpace(currentPlanID), strings.TrimSpace(targetPlanID))

	if strings.TrimSpace(providerSubscriptionID) == "" {
		return false
	}

	// The provider identifier is authoritative even if the local subscription
	// type drifted. The only provider-linked selection that may continue beyond
	// this guard is a managed paid change from a known, active current plan.
	// A same-plan selection has already returned idempotently above. Treat it as
	// blocked here too so a future refactor cannot accidentally open a checkout.
	return !strings.EqualFold(strings.TrimSpace(subscriptionType), "paid") ||
		!strings.EqualFold(strings.TrimSpace(subscriptionStatus), "active") ||
		!currentPlanConsistent ||
		!differentPlan
}
