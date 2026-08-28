package admin

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/publicingress"
)

const (
	publicOnboardingOrganizationStep = "organization"
	publicOnboardingAccessStep       = "access"
)

func validatePublicOnboardingStepValidationRequest(
	request PublicOnboardingStepValidationRequest,
) (PublicOnboardingStepValidationRequest, error) {
	request.Step = strings.ToLower(strings.TrimSpace(request.Step))
	request.CompanyName = strings.TrimSpace(request.CompanyName)
	request.DocumentNumber = strings.TrimSpace(request.DocumentNumber)
	request.Email = strings.TrimSpace(request.Email)

	switch request.Step {
	case publicOnboardingOrganizationStep:
		companyNameLength := utf8.RuneCountInString(request.CompanyName)
		if request.Email != "" ||
			!utf8.ValidString(request.CompanyName) ||
			companyNameLength < onboardingCompanyNameMinLength ||
			companyNameLength > onboardingCompanyNameMaxLength ||
			!hasOnlyBrazilianTaxIDCharacters(request.DocumentNumber) {
			return PublicOnboardingStepValidationRequest{}, ErrInvalidInput
		}
		request.DocumentNumber = normalizeBrazilianTaxID(request.DocumentNumber)
		if !isValidBrazilianTaxID(request.DocumentNumber) {
			return PublicOnboardingStepValidationRequest{}, ErrInvalidInput
		}
		request.Email = ""
	case publicOnboardingAccessStep:
		if request.CompanyName != "" || request.DocumentNumber != "" {
			return PublicOnboardingStepValidationRequest{}, ErrInvalidInput
		}
		email, err := normalizeEmail(request.Email)
		if err != nil || utf8.RuneCountInString(email) > onboardingEmailMaxLength {
			return PublicOnboardingStepValidationRequest{}, ErrInvalidInput
		}
		request.Email = email
	default:
		return PublicOnboardingStepValidationRequest{}, ErrInvalidInput
	}

	return request, nil
}

func (repo Repository) PublicOnboardingValidateStep(
	ctx context.Context,
	request PublicOnboardingStepValidationRequest,
) (PublicOnboardingStepValidationResult, error) {
	validatedRequest, err := validatePublicOnboardingStepValidationRequest(request)
	if err != nil {
		return PublicOnboardingStepValidationResult{}, err
	}
	if repo.db == nil {
		return PublicOnboardingStepValidationResult{}, errors.New("database is unavailable for onboarding prevalidation")
	}

	return publicOnboardingValidateStepWithQueryer(
		ctx,
		repo.db.Pool(),
		repo.environment,
		validatedRequest,
	)
}

func publicOnboardingValidateStepWithQueryer(
	ctx context.Context,
	queryer publicingress.QueryRower,
	environment string,
	request PublicOnboardingStepValidationRequest,
) (PublicOnboardingStepValidationResult, error) {
	allowDevelopmentFallback := environment == "development" || environment == "local" || environment == "test"
	availableValue := request.DocumentNumber
	if request.Step == publicOnboardingAccessStep {
		availableValue = request.Email
	}

	allowed, err := publicingress.AllowWithOptions(
		ctx,
		queryer,
		"onboarding_validate_step_ip",
		[]string{request.ipAddress},
		40,
		10*time.Minute,
		publicingress.AllowOptions{ProcessFallbackEnabled: allowDevelopmentFallback},
	)
	if err != nil {
		return PublicOnboardingStepValidationResult{}, err
	}
	if !allowed {
		return PublicOnboardingStepValidationResult{}, ErrPublicSignupRateLimited
	}

	allowed, err = publicingress.AllowWithOptions(
		ctx,
		queryer,
		"onboarding_validate_step_value",
		[]string{request.Step, availableValue},
		6,
		10*time.Minute,
		publicingress.AllowOptions{ProcessFallbackEnabled: allowDevelopmentFallback},
	)
	if err != nil {
		return PublicOnboardingStepValidationResult{}, err
	}
	if !allowed {
		return PublicOnboardingStepValidationResult{}, ErrPublicSignupRateLimited
	}

	var alreadyExists bool
	switch request.Step {
	case publicOnboardingOrganizationStep:
		err = queryer.QueryRow(ctx, `
			select exists (
				select 1
				from public.organizations existing
				where regexp_replace(coalesce(existing.cnpj, ''), '[^0-9]', '', 'g') = $1
				   or regexp_replace(coalesce(existing.billing_tax_id, ''), '[^0-9]', '', 'g') = $1
			)
		`, request.DocumentNumber).Scan(&alreadyExists)
		if err != nil {
			return PublicOnboardingStepValidationResult{}, err
		}
		if alreadyExists {
			return PublicOnboardingStepValidationResult{}, ErrPublicSignupDocumentExists
		}
	case publicOnboardingAccessStep:
		err = queryer.QueryRow(ctx, `
			select exists (
				select 1
				from auth.users auth_user
				where lower(auth_user.email) = $1
				  and auth_user.deleted_at is null
			)
		`, request.Email).Scan(&alreadyExists)
		if err != nil {
			return PublicOnboardingStepValidationResult{}, err
		}
		if alreadyExists {
			return PublicOnboardingStepValidationResult{}, ErrPublicSignupEmailExists
		}
	}

	return PublicOnboardingStepValidationResult{
		OK:    true,
		Valid: true,
		Step:  request.Step,
	}, nil
}
