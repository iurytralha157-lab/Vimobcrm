package admin

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/publicingress"
)

const onboardingConfirmationCapabilityTTL = time.Hour

type publicSignupConfirmationRecipient struct {
	UserID           string
	Name             string
	Email            string
	OrganizationID   string
	OrganizationName string
	PlanName         string
	TermsVersion     string
	PrivacyVersion   string
}

// ResendPublicSignupEmailConfirmation deliberately returns nil when the
// address has no pending public-onboarding account. The public handler always
// emits the same accepted response, so this endpoint cannot be used for
// account enumeration.
func (repo Repository) ResendPublicSignupEmailConfirmation(
	ctx context.Context,
	request ResendOnboardingEmailConfirmationRequest,
) error {
	email, err := normalizeEmail(request.Email)
	if err != nil || len(email) > onboardingEmailMaxLength {
		return ErrInvalidInput
	}
	if repo.db == nil {
		return errors.New("database is unavailable for signup confirmation resend")
	}

	allowDevelopmentFallback := repo.environment == "development" || repo.environment == "local" || repo.environment == "test"
	limiterOptions := publicingress.AllowOptions{ProcessFallbackEnabled: allowDevelopmentFallback}
	for _, rule := range []struct {
		scope   string
		subject []string
		limit   int
		window  time.Duration
	}{
		{scope: "onboarding_confirmation_resend_ip", subject: []string{request.IPAddress}, limit: 5, window: time.Hour},
		{scope: "onboarding_confirmation_resend_email", subject: []string{email}, limit: 3, window: time.Hour},
		// This atomic shared cooldown also prevents concurrent requests from
		// generating two links where only the newest credential is useful.
		{scope: "onboarding_confirmation_resend_email_cooldown", subject: []string{email}, limit: 1, window: time.Minute},
	} {
		allowed, limitErr := publicingress.AllowWithOptions(
			ctx,
			repo.db.Pool(),
			rule.scope,
			rule.subject,
			rule.limit,
			rule.window,
			limiterOptions,
		)
		if limitErr != nil {
			return limitErr
		}
		if !allowed {
			return ErrPublicSignupRateLimited
		}
	}

	recipient, found, err := repo.pendingPublicSignupConfirmationRecipient(ctx, email)
	if err != nil || !found {
		return err
	}

	// Existing unconfirmed users must use Auth's official signup resend.
	// It creates a fresh signup credential and never turns confirmation into a
	// magic-link sign-in or password-recovery session.
	return repo.resendPublicSignupEmailConfirmation(ctx, recipient.Email)
}

func (repo Repository) pendingPublicSignupConfirmationRecipient(
	ctx context.Context,
	email string,
) (publicSignupConfirmationRecipient, bool, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select
			auth_user.id::text,
			coalesce(nullif(trim(profile.name), ''), split_part(auth_user.email, '@', 1)),
			auth_user.email,
			organization.id::text,
			organization.name,
			coalesce(nullif(plan.name, ''), 'Plano Vimob'),
			coalesce(consent.terms_version, ''),
			coalesce(consent.privacy_version, '')
		from auth.users as auth_user
		join public.users as profile
		  on profile.id = auth_user.id
		join public.organization_members as membership
		  on membership.user_id = auth_user.id
		join public.organizations as organization
		  on organization.id = membership.organization_id
		 and organization.id = profile.organization_id
		left join public.admin_subscription_plans as plan
		  on plan.id = organization.plan_id
		left join lateral (
			select legal.terms_version, legal.privacy_version
			from public.legal_consents as legal
			where legal.user_id = auth_user.id
			  and legal.organization_id = organization.id
			order by legal.accepted_at desc, legal.id desc
			limit 1
		) as consent on true
		where lower(auth_user.email) = $1
		  and auth_user.deleted_at is null
		  and auth_user.email_confirmed_at is null
		  and auth_user.raw_app_meta_data ->> 'provisioning_source' = 'public_onboarding'
		  and auth_user.raw_app_meta_data ->> 'signup_attempt_id' = organization.signup_attempt_id::text
		  and lower(coalesce(organization.signup_attempt_email, '')) = $1
		  and organization.created_by = auth_user.id
		limit 2
	`, email)
	if err != nil {
		return publicSignupConfirmationRecipient{}, false, err
	}
	defer rows.Close()

	matches := make([]publicSignupConfirmationRecipient, 0, 2)
	for rows.Next() {
		var recipient publicSignupConfirmationRecipient
		if err := rows.Scan(
			&recipient.UserID,
			&recipient.Name,
			&recipient.Email,
			&recipient.OrganizationID,
			&recipient.OrganizationName,
			&recipient.PlanName,
			&recipient.TermsVersion,
			&recipient.PrivacyVersion,
		); err != nil {
			return publicSignupConfirmationRecipient{}, false, err
		}
		matches = append(matches, recipient)
	}
	if err := rows.Err(); err != nil {
		return publicSignupConfirmationRecipient{}, false, err
	}
	if len(matches) == 0 {
		return publicSignupConfirmationRecipient{}, false, nil
	}
	if len(matches) != 1 || !strings.EqualFold(strings.TrimSpace(matches[0].Email), email) {
		return publicSignupConfirmationRecipient{}, false, errors.New("signup confirmation recipient is not unique")
	}
	return matches[0], true, nil
}
