package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/publicingress"
)

const defaultSignupPlanSlug = "starter-197"

var defaultStarterModules = []string{"crm", "agenda", "whatsapp", "round_robin"}

var planControlledModules = []string{
	"crm",
	"properties",
	"financial",
	"whatsapp",
	"agenda",
	"cadences",
	"tags",
	"round_robin",
	"reports",
	"automations",
	"webhooks",
	"site",
	"campaigns",
	"api",
	"portals",
	"performance",
	"gamification",
}

func (repo Repository) PublicOnboardingSignup(ctx context.Context, request OnboardingSignupRequest) (result map[string]any, resultErr error) {
	validatedRequest, err := validatePublicOnboardingSignupRequest(request)
	if err != nil {
		return nil, err
	}
	request = validatedRequest

	companyName := request.CompanyName
	adminName := request.AdminName
	billingLegalName := companyName
	if len(request.DocumentNumber) == 11 {
		billingLegalName = adminName
	}
	email := request.Email

	if completedResult, found, lookupErr := repo.publicSignupResultForAttempt(ctx, request.AttemptID, email); lookupErr != nil {
		return nil, lookupErr
	} else if found {
		return completedResult, nil
	}

	allowDevelopmentFallback := repo.environment == "development" || repo.environment == "local" || repo.environment == "test"
	allowed, err := publicingress.AllowWithOptions(
		ctx,
		repo.db.Pool(),
		"onboarding_signup_ip",
		[]string{request.IPAddress},
		5,
		time.Hour,
		publicingress.AllowOptions{ProcessFallbackEnabled: allowDevelopmentFallback},
	)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, ErrPublicSignupRateLimited
	}

	allowed, err = publicingress.AllowWithOptions(
		ctx,
		repo.db.Pool(),
		"onboarding_signup_email",
		[]string{email},
		3,
		time.Hour,
		publicingress.AllowOptions{ProcessFallbackEnabled: allowDevelopmentFallback},
	)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, ErrPublicSignupRateLimited
	}

	attemptClaim, claimOutcome, err := repo.claimPublicSignupAttempt(ctx, request.AttemptID, email)
	if err != nil {
		return nil, err
	}
	if claimOutcome == publicSignupAttemptClaimBusy {
		return nil, ErrPublicSignupRateLimited
	}
	if claimOutcome == publicSignupAttemptClaimCompleted {
		completedResult, found, lookupErr := repo.publicSignupResultForAttempt(ctx, request.AttemptID, email)
		if lookupErr != nil {
			return nil, lookupErr
		}
		if !found {
			return nil, errors.New("completed public signup attempt has no authoritative organization")
		}
		return completedResult, nil
	}

	claimFinished := false
	claimOwnershipUncertain := false
	createdUserID := ""
	defer func() {
		if claimFinished || claimOwnershipUncertain {
			return
		}

		cleanupContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), organizationAuthCleanupTimeout)
		defer cancel()
		// Preserve the exact attempt-owned Auth identity and trigger-created
		// profile. A retry reconciles that orphan by signup_attempt_id. Deleting
		// Auth after the database lease commits would race with a new membership
		// and could cascade another tenant's access.
		if _, releaseErr := repo.releasePublicSignupAttempt(cleanupContext, attemptClaim); releaseErr != nil {
			result = nil
			resultErr = errors.Join(resultErr, fmt.Errorf("release public signup attempt: %w", releaseErr))
		}
	}()

	if completedResult, found, lookupErr := repo.publicSignupResultForAttempt(ctx, request.AttemptID, email); lookupErr != nil {
		return nil, lookupErr
	} else if found {
		return completedResult, nil
	}

	planSlug := strings.TrimSpace(request.PlanSlug)
	if planSlug == "" {
		planSlug = defaultSignupPlanSlug
	}
	plan, err := repo.activeSignupPlan(ctx, planSlug)
	if err != nil {
		return nil, err
	}

	signupAuthUser, err := repo.createPublicSignupAuthUser(
		ctx,
		request.AttemptID,
		email,
		request.Password,
		adminName,
	)
	if err != nil {
		return nil, err
	}
	createdUserID = signupAuthUser.UserID
	claimOwned, err := repo.attachPublicSignupAuthUser(ctx, attemptClaim, createdUserID)
	if err != nil {
		claimOwnershipUncertain = true
		return nil, err
	}
	if !claimOwned {
		claimOwnershipUncertain = true
		return nil, ErrPublicSignupRateLimited
	}
	createdOrganizationID := ""

	now := time.Now().UTC()
	trialDays := 0
	if boolValue(plan["trial_enabled"]) {
		trialDays = intValue(plan["trial_days"])
	}
	isTrial := trialDays > 0
	var trialEndsAt *time.Time
	if isTrial {
		value := now.Add(time.Duration(trialDays) * 24 * time.Hour)
		trialEndsAt = &value
	}

	// The team size collected during onboarding is informational. Contracted
	// capacity must always come from the selected backend plan so a crafted
	// signup request cannot raise the organization's user limit.
	maxUsers := maxInt(intValue(plan["max_users"]), 1)
	fullPhone := strings.TrimSpace(strings.TrimSpace(request.PhoneCountryCode) + " " + strings.TrimSpace(request.Phone))
	organizationSlug := slugifyAdmin(companyName)
	if organizationSlug == "" {
		organizationSlug = "organizacao"
	}
	organizationSlug = fmt.Sprintf("%s-%s", organizationSlug, createdUserID[:8])
	signupPath := "paid"
	if isTrial {
		signupPath = "trial"
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := fencePublicSignupAttemptForProvisioning(ctx, tx, attemptClaim, createdUserID); err != nil {
		if errors.Is(err, errPublicSignupAttemptLeaseLost) {
			claimOwnershipUncertain = true
			return nil, ErrPublicSignupRateLimited
		}
		claimOwnershipUncertain = true
		return nil, err
	}
	canonicalDocument := onlyDigitsAdmin(request.DocumentNumber)
	if _, err := tx.Exec(ctx, `
		select pg_advisory_xact_lock(
			pg_catalog.hashtextextended('public-signup-document:' || $1, 0)
		)
	`, canonicalDocument); err != nil {
		return nil, err
	}
	var documentAlreadyProvisioned bool
	if err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.organizations existing
			where existing.signup_attempt_id is distinct from $2::uuid
			  and (
				regexp_replace(coalesce(existing.cnpj, ''), '[^0-9]', '', 'g') = $1
				or regexp_replace(coalesce(existing.billing_tax_id, ''), '[^0-9]', '', 'g') = $1
			  )
		)
	`, canonicalDocument, request.AttemptID).Scan(&documentAlreadyProvisioned); err != nil {
		return nil, err
	}
	if documentAlreadyProvisioned {
		// The deterministic advisory lock closes the race that a SELECT-only
		// duplicate check would leave while the sentinel avoids tenant details.
		return nil, ErrPublicSignupDocumentExists
	}

	err = tx.QueryRow(ctx, `
		insert into public.organizations (
			name,
			slug,
			segment,
			cnpj,
			razao_social,
			nome_fantasia,
			telefone,
			whatsapp,
			email,
			billing_legal_name,
			billing_tax_id,
			billing_email,
			billing_phone,
			plan_id,
			pending_plan_id,
			subscription_status,
			subscription_type,
			subscription_value,
			trial_ends_at,
			max_users,
			created_by,
			signup_attempt_id,
			signup_attempt_email,
			signup_requires_payment
		)
		values (
			$1,
			$2,
			'imobiliario',
			$3,
			$1,
			$1,
			$4,
			$4,
			$5,
			$12,
			$3,
			$5,
			$4,
			case when $7 = 'trial' then $6::uuid else null end,
			case when $7 = 'trial' then null else $6::uuid end,
			$7,
			case when $7 = 'trial' then 'trial' else 'paid' end,
			case when $7 = 'trial' then $8 else 0 end,
			$9,
			case when $7 = 'trial' then $10 else 1 end,
			$11::uuid,
			$13::uuid,
			$5,
			($7 <> 'trial')
		)
		returning id::text
	`,
		companyName,
		organizationSlug,
		nullableText(onlyDigitsAdmin(request.DocumentNumber)),
		nullableText(fullPhone),
		email,
		stringValue(plan["id"]),
		statusForTrial(isTrial),
		floatValue(plan["price"]),
		trialEndsAt,
		maxUsers,
		createdUserID,
		billingLegalName,
		request.AttemptID,
	).Scan(&createdOrganizationID)
	if err != nil {
		return nil, err
	}

	var checkoutTokenValue string
	if err := tx.QueryRow(ctx, `
		insert into public.organization_checkout_capabilities (organization_id)
		values ($1::uuid)
		on conflict (organization_id) do update
		set checkout_token = organization_checkout_capabilities.checkout_token
		returning checkout_token
	`, createdOrganizationID).Scan(&checkoutTokenValue); err != nil {
		return nil, err
	}
	checkoutTokenValue = strings.TrimSpace(checkoutTokenValue)
	if !isCanonicalCheckoutToken(checkoutTokenValue) {
		return nil, errors.New("signup organization has an invalid checkout capability")
	}

	if _, err := tx.Exec(ctx, `
		insert into public.users (
			id,
			organization_id,
			name,
			email,
			role,
			is_active,
			whatsapp,
			cpf
		)
		values ($1::uuid, $2::uuid, $3, $4, 'user', true, $5, $6)
		on conflict (id) do update set
			organization_id = excluded.organization_id,
			name = excluded.name,
			email = excluded.email,
			role = case when public.users.role = 'super_admin' then public.users.role else 'user' end,
			is_active = true,
			whatsapp = excluded.whatsapp,
			cpf = excluded.cpf,
			updated_at = now()
	`, createdUserID, createdOrganizationID, adminName, email, nullableText(fullPhone), nullableText(onlyDigitsAdmin(request.DocumentNumber))); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'admin', true)
		on conflict (user_id, organization_id)
		do update set role = 'admin', is_active = true, updated_at = now()
	`, createdOrganizationID, createdUserID); err != nil {
		return nil, err
	}

	selectedModules := []string{}
	if isTrial {
		selectedModules = selectedPlanModules(plan)
	}
	if err := writeOrganizationModules(ctx, tx, createdOrganizationID, selectedModules); err != nil {
		return nil, err
	}

	subscriptionMetadata, _ := json.Marshal(map[string]any{
		"signup_path": signupPath,
		"plan_slug":   stringValue(plan["slug"]),
	})
	if _, err := tx.Exec(ctx, `
		insert into public.subscriptions (
			organization_id,
			plan_id,
			status,
			current_period_start,
			current_period_end,
			trial_ends_at,
			metadata
		)
		values (
			$1::uuid,
			case when $3 = 'trial' then $2::uuid else null end,
			$3,
			$4,
			$5,
			$5,
			$6::jsonb
		)
	`, createdOrganizationID, stringValue(plan["id"]), statusForTrial(isTrial), now, trialEndsAt, string(subscriptionMetadata)); err != nil {
		return nil, err
	}

	consentMetadata, _ := json.Marshal(map[string]any{
		"terms_accepted":   request.TermsAccepted,
		"privacy_accepted": request.PrivacyAccepted,
		"legal_documents":  currentLegalConsentEvidence(),
	})
	if _, err := tx.Exec(ctx, `
		insert into public.legal_consents (
			user_id,
			organization_id,
			terms_version,
			privacy_version,
			ip_address,
			user_agent,
			source,
			metadata
		)
		values ($1::uuid, $2::uuid, $3, $4, $5, $6, 'signup', $7::jsonb)
	`,
		createdUserID,
		createdOrganizationID,
		currentTermsVersion,
		currentPrivacyVersion,
		nullableText(request.IPAddress),
		nullableText(request.UserAgent),
		string(consentMetadata),
	); err != nil {
		return nil, err
	}

	auditData, _ := json.Marshal(map[string]any{
		"company_name": companyName,
		"signup_path":  signupPath,
		"plan_slug":    stringValue(plan["slug"]),
	})
	if _, err := tx.Exec(ctx, `
		insert into public.audit_logs (
			organization_id,
			user_id,
			action,
			entity_type,
			entity_id,
			new_data,
			ip_address,
			user_agent
		)
		values ($1::uuid, $2::uuid, 'signup_completed', 'organization', $1::uuid, $3::jsonb, $4, $5)
	`, createdOrganizationID, createdUserID, string(auditData), nullableText(request.IPAddress), nullableText(request.UserAgent)); err != nil {
		return nil, err
	}

	if !isTrial && !isCanonicalCheckoutToken(checkoutTokenValue) {
		return nil, errors.New("paid signup organization has an invalid checkout token")
	}
	welcomeTarget := "/select-organization"
	if !isTrial && checkoutTokenValue != "" {
		welcomeTarget = "/checkout/" + checkoutTokenValue
	}
	welcomeEmailDispatch := map[string]any{"required": true, "status": "pending"}
	if signupAuthUser.NeedsAuthConfirmationResend {
		welcomeEmailDispatch = map[string]any{
			"required": false,
			"status":   "skipped",
			"error":    "supabase_auth_signup_resend_pending",
		}
	}
	welcomeMetadata, _ := json.Marshal(map[string]any{
		"event_key":                     "onboarding_welcome",
		"dedupe_key":                    "onboarding:welcome:" + createdOrganizationID,
		"recipient_name":                adminName,
		"recipient_email":               email,
		"recipient_whatsapp":            fullPhone,
		"organization_id":               createdOrganizationID,
		"organization_name":             companyName,
		"plan_name":                     stringValue(plan["name"]),
		"plan_slug":                     stringValue(plan["slug"]),
		"signup_path":                   signupPath,
		"is_trial":                      isTrial,
		"trial_days":                    trialDays,
		"trial_ends_at":                 trialEndsAt,
		"checkout_path":                 welcomeTarget,
		"terms_version":                 currentTermsVersion,
		"privacy_version":               currentPrivacyVersion,
		"whatsapp_opt_in_type":          "transactional_onboarding",
		"email_confirmation_expires_at": time.Now().UTC().Add(onboardingConfirmationCapabilityTTL).Format(time.RFC3339),
		"variables": map[string]any{
			"name":                   adminName,
			"organization_name":      companyName,
			"plan_name":              stringValue(plan["name"]),
			"signup_path":            signupPath,
			"is_trial":               isTrial,
			"trial_days":             trialDays,
			"trial_ends_at":          trialEndsAt,
			"checkout_path":          welcomeTarget,
			"email_confirmation_url": signupAuthUser.EmailConfirmationURL,
			"terms_version":          currentTermsVersion,
			"privacy_version":        currentPrivacyVersion,
		},
		"dispatch": map[string]any{
			"email":    welcomeEmailDispatch,
			"whatsapp": map[string]any{"required": true, "status": "pending"},
		},
		"whatsapp_dispatch_required": true,
		"whatsapp_dispatch":          map[string]any{"status": "pending"},
	})
	if _, err := tx.Exec(ctx, `
		insert into public.notifications (
			organization_id,
			user_id,
			title,
			content,
			body,
			type,
			channel,
			target_url,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			'Bem-vindo ao Vimob',
			'Seu cadastro foi concluido com sucesso.',
			'Seu cadastro foi concluido com sucesso.',
			'onboarding',
			'in_app',
			$3,
			$4::jsonb
		)
		on conflict do nothing
	`, createdOrganizationID, createdUserID, welcomeTarget, string(welcomeMetadata)); err != nil {
		return nil, err
	}
	if err := completePublicSignupAttempt(
		ctx,
		tx,
		attemptClaim,
		createdUserID,
		createdOrganizationID,
	); err != nil {
		return nil, err
	}

	if commitErr := tx.Commit(ctx); commitErr != nil {
		// A commit error is inherently ambiguous: PostgreSQL may have committed
		// even if the client lost the acknowledgement. Never delete the Auth
		// identity in this branch. If the transaction did roll back, the same
		// attempt will safely reuse its exact orphan on retry.
		claimOwnershipUncertain = true
		reconciliationContext, cancel := context.WithTimeout(
			context.WithoutCancel(ctx),
			publicSignupAuthReconciliationTimeout,
		)
		defer cancel()
		committedResult, committed, reconcileErr := repo.reconcilePublicSignupCommit(
			reconciliationContext,
			request.AttemptID,
			email,
			createdUserID,
		)
		if reconcileErr != nil {
			return nil, errors.Join(
				commitErr,
				fmt.Errorf("reconcile ambiguous public signup commit: %w", reconcileErr),
			)
		}
		if committed {
			claimFinished = true
			claimOwnershipUncertain = false
			if signupAuthUser.NeedsAuthConfirmationResend {
				repo.resendPublicSignupEmailConfirmationAfterCommit(ctx, request.AttemptID, email)
			}
			return committedResult, nil
		}
		return nil, commitErr
	}
	claimFinished = true
	if signupAuthUser.NeedsAuthConfirmationResend {
		repo.resendPublicSignupEmailConfirmationAfterCommit(ctx, request.AttemptID, email)
	}

	redirectTo := "/select-organization"
	if !isTrial && checkoutTokenValue != "" {
		redirectTo = "/checkout/" + checkoutTokenValue
	}

	result = publicSignupSuccessResult(createdOrganizationID, checkoutTokenValue, redirectTo, !isTrial)
	if err := repo.attachPublicSignupRecoveryCapability(result, request.AttemptID, createdUserID, createdOrganizationID, email); err != nil {
		return nil, err
	}
	return result, nil
}

func (repo Repository) publicSignupResultForAttempt(ctx context.Context, attemptID string, email string) (map[string]any, bool, error) {
	var organizationID string
	var checkoutToken sql.NullString
	var storedEmail string
	var authUserID string
	var requiresPayment bool
	err := repo.db.Pool().QueryRow(ctx, `
		select
			organization.id::text,
			checkout_capability.checkout_token,
			organization.signup_attempt_email,
			organization.created_by::text,
			organization.signup_requires_payment
		from public.organizations as organization
		left join public.organization_checkout_capabilities as checkout_capability
		  on checkout_capability.organization_id = organization.id
		where organization.signup_attempt_id = $1::uuid
		limit 1
	`, attemptID).Scan(&organizationID, &checkoutToken, &storedEmail, &authUserID, &requiresPayment)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	if storedEmail != email {
		return nil, false, ErrSignupAttemptConflict
	}

	checkoutTokenValue := ""
	if checkoutToken.Valid {
		checkoutTokenValue = strings.TrimSpace(checkoutToken.String)
	}
	redirectTo := "/select-organization"
	if requiresPayment {
		if !isCanonicalCheckoutToken(checkoutTokenValue) {
			return nil, false, errors.New("idempotent paid signup has an invalid checkout token")
		}
		redirectTo = "/checkout/" + checkoutTokenValue
	}

	result := publicSignupSuccessResult(organizationID, checkoutTokenValue, redirectTo, requiresPayment)
	if err := repo.attachPublicSignupRecoveryCapability(result, attemptID, authUserID, organizationID, storedEmail); err != nil {
		return nil, false, err
	}
	return result, true, nil
}

func (repo Repository) attachPublicSignupRecoveryCapability(
	result map[string]any,
	attemptID string,
	authUserID string,
	organizationID string,
	email string,
) error {
	capability, err := repo.issuePublicSignupRecoveryCapability(attemptID, authUserID, organizationID, email)
	if err != nil {
		return err
	}
	result["recoveryCapability"] = capability
	return nil
}

func (repo Repository) reconcilePublicSignupCommit(
	ctx context.Context,
	attemptID string,
	email string,
	userID string,
) (map[string]any, bool, error) {
	var provisioned bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.organizations as organization
			join public.users as profile
			  on profile.id = $3::uuid
			 and profile.organization_id = organization.id
			join public.organization_members as membership
			  on membership.organization_id = organization.id
			 and membership.user_id = $3::uuid
			 and membership.is_active = true
			join public.organization_checkout_capabilities as checkout_capability
			  on checkout_capability.organization_id = organization.id
			where organization.signup_attempt_id = $1::uuid
			  and organization.signup_attempt_email = $2
			  and organization.created_by = $3::uuid
			  and exists (
				select 1
				from public.notifications as notification
				where notification.organization_id = organization.id
				  and notification.user_id = $3::uuid
				  and notification.metadata ->> 'event_key' = 'onboarding_welcome'
				  and notification.metadata ->> 'dedupe_key' = 'onboarding:welcome:' || organization.id::text
			  )
		)
	`, attemptID, email, userID).Scan(&provisioned)
	if err != nil {
		return nil, false, err
	}
	if !provisioned {
		return nil, false, nil
	}

	return repo.publicSignupResultForAttempt(ctx, attemptID, email)
}

func publicSignupSuccessResult(organizationID string, checkoutToken string, redirectTo string, requiresPayment bool) map[string]any {
	if !requiresPayment {
		checkoutToken = ""
		redirectTo = "/select-organization"
	}
	return map[string]any{
		"ok":                        true,
		"message":                   "Cadastro criado. Confirme seu e-mail para acessar o Vimob.",
		"redirectTo":                redirectTo,
		"checkoutToken":             nullableText(checkoutToken),
		"organizationId":            organizationID,
		"requiresPayment":           requiresPayment,
		"emailConfirmationRequired": true,
	}
}

func isCanonicalCheckoutToken(value string) bool {
	if len(value) != 32 {
		return false
	}
	for _, character := range value {
		if (character >= '0' && character <= '9') || (character >= 'a' && character <= 'f') {
			continue
		}
		return false
	}
	return true
}

func (repo Repository) PublicCheckoutPlan(ctx context.Context, request CheckoutPlanRequest) (map[string]any, error) {
	checkoutToken := strings.TrimSpace(request.CheckoutToken)
	planSlug := strings.TrimSpace(request.PlanSlug)
	if !isCanonicalCheckoutToken(checkoutToken) || planSlug == "" {
		return nil, ErrInvalidInput
	}

	organization, err := repo.queryJSONObject(ctx, `
		select jsonb_build_object(
			'id', o.id::text,
			'max_users', o.max_users,
			'is_active', o.is_active,
			'subscription_status', o.subscription_status,
			'subscription_type', o.subscription_type,
			'plan_id', o.plan_id,
			'pending_plan_id', o.pending_plan_id
		)
		from public.organizations o
		join public.organization_checkout_capabilities checkout_capability
		  on checkout_capability.organization_id = o.id
		where checkout_capability.checkout_token = $1
		  and o.is_active = true
		limit 1
	`, checkoutToken)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	status := stringValue(organization["subscription_status"])
	if status != "pending_payment" && status != "trial" {
		return nil, ErrInvalidInput
	}

	plan, err := repo.activeSignupPlan(ctx, planSlug)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	trialDays := 0
	if boolValue(plan["trial_enabled"]) {
		trialDays = intValue(plan["trial_days"])
	}
	isTrial := trialDays > 0
	var trialEndsAt *time.Time
	if isTrial {
		value := now.Add(time.Duration(trialDays) * 24 * time.Hour)
		trialEndsAt = &value
	}
	organizationID := stringValue(organization["id"])
	// Entitlements are controlled by the selected public plan. Carrying the
	// previous organization's ceiling through a downgrade would let a public
	// checkout retain capacity that no longer belongs to the target plan.
	maxUsers := maxInt(intValue(plan["max_users"]), 1)

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var lockedStatus string
	var lockedTrialEndsAt sql.NullTime
	var activeCheckoutPlanID sql.NullString
	err = tx.QueryRow(ctx, `
		select
			o.subscription_status,
			o.trial_ends_at,
			(
				select intent.pending_plan_id::text
				from private.billing_checkout_intents intent
				where intent.organization_id = o.id
				  and intent.status in ('creating', 'pending')
				order by intent.created_at desc, intent.id desc
				limit 1
			)
		from public.organizations o
		where o.id = $1::uuid
		for update
	`, organizationID).Scan(&lockedStatus, &lockedTrialEndsAt, &activeCheckoutPlanID)
	if err != nil {
		return nil, err
	}
	if lockedStatus != "pending_payment" && lockedStatus != "trial" {
		return nil, ErrInvalidInput
	}

	targetPlanID := stringValue(plan["id"])
	if activeCheckoutPlanID.Valid &&
		!strings.EqualFold(strings.TrimSpace(activeCheckoutPlanID.String), targetPlanID) {
		return nil, ErrCheckoutPlanConflict
	}
	if isTrial && lockedStatus == "trial" {
		if lockedTrialEndsAt.Valid {
			preservedTrialEnd := lockedTrialEndsAt.Time.UTC()
			trialEndsAt = &preservedTrialEnd
		} else {
			trialEndsAt = nil
		}
	}

	if isTrial {
		if _, err := tx.Exec(ctx, `
			update public.organizations
			set
				plan_id = $2::uuid,
				pending_plan_id = null,
				subscription_status = 'trial',
				subscription_type = 'trial',
				subscription_value = $3,
				trial_ends_at = $4,
				max_users = $5,
				next_billing_date = null,
				updated_at = now()
			where id = $1::uuid
		`, organizationID, targetPlanID, floatValue(plan["price"]), trialEndsAt, maxUsers); err != nil {
			return nil, err
		}

		if err := writeOrganizationModules(ctx, tx, organizationID, selectedPlanModules(plan)); err != nil {
			return nil, err
		}
	} else {
		statusWhilePending := "pending_payment"
		if lockedStatus == "trial" {
			statusWhilePending = "trial"
		}
		if _, err := tx.Exec(ctx, `
			update public.organizations
			set
				pending_plan_id = $2::uuid,
				subscription_status = $3,
				subscription_type = case
					when $3 = 'trial' then subscription_type
					else 'paid'
				end,
				updated_at = now()
			where id = $1::uuid
		`, organizationID, targetPlanID, statusWhilePending); err != nil {
			return nil, err
		}
	}

	subscriptionMetadata, _ := json.Marshal(map[string]any{
		"signup_path":           checkoutSignupPath(isTrial),
		"plan_slug":             stringValue(plan["slug"]),
		"changed_from_checkout": true,
	})
	if _, err := tx.Exec(ctx, `
		update public.subscriptions
		set
			plan_id = case when $3 = 'trial' then $2::uuid else plan_id end,
			status = $3,
			current_period_end = $4,
			trial_ends_at = $4,
			metadata = $5::jsonb,
			updated_at = now()
		where organization_id = $1::uuid
	`, organizationID, stringValue(plan["id"]), statusForTrial(isTrial), trialEndsAt, string(subscriptionMetadata)); err != nil {
		return nil, err
	}

	auditData, _ := json.Marshal(map[string]any{
		"plan_slug":   stringValue(plan["slug"]),
		"signup_path": checkoutSignupPath(isTrial),
	})
	if _, err := tx.Exec(ctx, `
		insert into public.audit_logs (
			organization_id,
			action,
			entity_type,
			entity_id,
			new_data
		)
		values ($1::uuid, 'checkout_plan_changed', 'organization', $1::uuid, $2::jsonb)
	`, organizationID, string(auditData)); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return map[string]any{
		"ok":              true,
		"message":         "Plano atualizado com sucesso.",
		"requiresPayment": !isTrial,
		"checkoutToken":   checkoutToken,
		"organizationId":  organizationID,
		"plan":            plan,
	}, nil
}

const activeSignupPlanSQL = `
		select jsonb_build_object(
			'id', p.id::text,
			'slug', p.slug,
			'name', p.name,
			'price', p.price,
			'reference_price', p.reference_price,
			'discount_percentage', p.discount_percentage,
			'trial_enabled', p.trial_enabled,
			'trial_days', p.trial_days,
			'max_users', p.max_users,
			'max_whatsapp_sessions', p.max_whatsapp_sessions,
			'billing_cycle', p.billing_cycle,
			'billing_periods', p.billing_periods,
			'description', p.description,
			'display_features', p.display_features,
			'display_order', p.display_order,
			'modules', coalesce(to_jsonb(p.modules), '[]'::jsonb)
		)
		from public.admin_subscription_plans p
		where p.slug = $1
		  and coalesce(p.is_active, true) = true
		  and coalesce(p.is_public, true) = true
		limit 1
	`

func (repo Repository) activeSignupPlan(ctx context.Context, slug string) (map[string]any, error) {
	plan, err := repo.queryJSONObject(ctx, activeSignupPlanSQL, slug)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	return plan, err
}

func writeOrganizationModules(ctx context.Context, tx pgx.Tx, organizationID string, selectedModules []string) error {
	selectedModules = organizationModulesWithCore(selectedModules)
	selected := map[string]bool{}
	for _, moduleName := range selectedModules {
		moduleName = canonicalOrganizationModuleName(moduleName)
		if moduleName != "" {
			selected[moduleName] = true
		}
	}
	for _, moduleName := range allPlanModules(selectedModules) {
		_, err := tx.Exec(ctx, `
			insert into public.organization_modules (
				organization_id,
				module_name,
				is_enabled
			)
			values ($1::uuid, $2, $3)
			on conflict (organization_id, module_name)
			do update set is_enabled = excluded.is_enabled, updated_at = now()
		`, organizationID, moduleName, selected[moduleName])
		if err != nil {
			return err
		}
	}
	return nil
}

func selectedPlanModules(plan map[string]any) []string {
	modules := stringSliceValue(plan["modules"])
	if len(modules) > 0 {
		return modules
	}
	return append([]string{}, defaultStarterModules...)
}

func allPlanModules(selected []string) []string {
	seen := map[string]bool{}
	modules := []string{}
	allModules := make([]string, 0, len(planControlledModules)+len(selected))
	allModules = append(allModules, planControlledModules...)
	allModules = append(allModules, selected...)
	for _, moduleName := range allModules {
		moduleName = canonicalOrganizationModuleName(moduleName)
		if moduleName == "" || seen[moduleName] {
			continue
		}
		seen[moduleName] = true
		modules = append(modules, moduleName)
	}
	return modules
}

func stringSliceValue(value any) []string {
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		items := []string{}
		for _, item := range typed {
			text := strings.TrimSpace(stringValue(item))
			if text != "" {
				items = append(items, text)
			}
		}
		return items
	default:
		return nil
	}
}

func boolValue(value any) bool {
	typed, ok := value.(bool)
	return ok && typed
}

func intValue(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		parsed, _ := typed.Int64()
		return int(parsed)
	default:
		return 0
	}
}

func floatValue(value any) float64 {
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
	default:
		return 0
	}
}

func maxInt(values ...int) int {
	maxValue := values[0]
	for _, value := range values[1:] {
		if value > maxValue {
			maxValue = value
		}
	}
	return maxValue
}

func onlyDigitsAdmin(value string) string {
	builder := strings.Builder{}
	for _, char := range value {
		if char >= '0' && char <= '9' {
			builder.WriteRune(char)
		}
	}
	return builder.String()
}

func slugifyAdmin(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	builder := strings.Builder{}
	lastDash := false
	for _, char := range value {
		isAlphaNumber := (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')
		if isAlphaNumber {
			builder.WriteRune(char)
			lastDash = false
			continue
		}
		if !lastDash && builder.Len() > 0 {
			builder.WriteRune('-')
			lastDash = true
		}
		if builder.Len() >= 48 {
			break
		}
	}
	return strings.Trim(builder.String(), "-")
}

func statusForTrial(isTrial bool) string {
	if isTrial {
		return "trial"
	}
	return "pending_payment"
}

func checkoutSignupPath(isTrial bool) string {
	if isTrial {
		return "trial"
	}
	return "paid"
}

func nullableText(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func defaultText(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}
