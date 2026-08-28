package admin

import (
	"errors"
	"os"
	"strings"
	"testing"
)

func validOnboardingSignupRequest() OnboardingSignupRequest {
	return OnboardingSignupRequest{
		AttemptID:        "0f5ecbd9-c8c9-490c-b70a-3beb8ef44d6f",
		CompanyName:      "Vimob Imoveis",
		DocumentNumber:   "04.252.011/0001-10",
		BrokersCount:     25,
		AdminName:        "Andre Silva",
		PhoneCountryCode: "+55",
		Phone:            "(11) 99999-9999",
		Email:            "ANDRE@EXAMPLE.COM",
		Password:         "12345678",
		SignupPath:       "paid",
		PlanSlug:         "pro",
		TermsAccepted:    true,
		PrivacyAccepted:  true,
		TermsVersion:     currentTermsVersion,
		PrivacyVersion:   currentPrivacyVersion,
	}
}

func TestBrazilianTaxIDValidationAndNormalization(t *testing.T) {
	t.Parallel()

	valid := []string{"529.982.247-25", "04.252.011/0001-10"}
	for _, value := range valid {
		if !isValidBrazilianTaxID(value) {
			t.Fatalf("expected valid Brazilian tax ID %q", value)
		}
	}

	invalid := []string{"", "123.456.789-01", "04.252.011/0001-11", "111.111.111-11", "11.111.111/1111-11"}
	for _, value := range invalid {
		if isValidBrazilianTaxID(value) {
			t.Fatalf("expected invalid Brazilian tax ID %q", value)
		}
	}

	if got := normalizeBrazilianTaxID(" 04.252.011/0001-10 "); got != "04252011000110" {
		t.Fatalf("normalized tax ID = %q, want 04252011000110", got)
	}
}

func TestValidatePublicOnboardingSignupRequestNormalizesTrustedFields(t *testing.T) {
	t.Parallel()

	request := validOnboardingSignupRequest()
	request.CompanyName = "  Vimob Imoveis  "
	request.AdminName = "  Andre Silva  "
	request.PhoneCountryCode = "  +55  "
	request.Phone = "  (11) 99999-9999  "

	validated, err := validatePublicOnboardingSignupRequest(request)
	if err != nil {
		t.Fatalf("validate signup: %v", err)
	}
	if validated.CompanyName != "Vimob Imoveis" || validated.AdminName != "Andre Silva" {
		t.Fatalf("names were not normalized: %#v", validated)
	}
	if validated.DocumentNumber != "04252011000110" {
		t.Fatalf("document = %q, want canonical digits", validated.DocumentNumber)
	}
	if validated.Email != "andre@example.com" {
		t.Fatalf("email = %q, want normalized lowercase", validated.Email)
	}
	if validated.PhoneCountryCode != "+55" || validated.Phone != "(11) 99999-9999" {
		t.Fatalf("phone was not normalized: %q %q", validated.PhoneCountryCode, validated.Phone)
	}
	if validated.AttemptID != "0f5ecbd9-c8c9-490c-b70a-3beb8ef44d6f" {
		t.Fatalf("attempt id = %q, want canonical UUID", validated.AttemptID)
	}
}

func TestValidatePublicOnboardingSignupRequestRejectsUnsafeFields(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		mutate func(*OnboardingSignupRequest)
	}{
		{name: "missing attempt id", mutate: func(value *OnboardingSignupRequest) { value.AttemptID = "" }},
		{name: "invalid attempt id", mutate: func(value *OnboardingSignupRequest) { value.AttemptID = "not-a-uuid" }},
		{name: "missing document", mutate: func(value *OnboardingSignupRequest) { value.DocumentNumber = "" }},
		{name: "invalid document", mutate: func(value *OnboardingSignupRequest) { value.DocumentNumber = "123.456.789-01" }},
		{name: "document with letters", mutate: func(value *OnboardingSignupRequest) { value.DocumentNumber = "04abc252011000110" }},
		{name: "short company", mutate: func(value *OnboardingSignupRequest) { value.CompanyName = "A" }},
		{name: "long company", mutate: func(value *OnboardingSignupRequest) { value.CompanyName = strings.Repeat("A", 161) }},
		{name: "short admin", mutate: func(value *OnboardingSignupRequest) { value.AdminName = "A" }},
		{name: "long admin", mutate: func(value *OnboardingSignupRequest) { value.AdminName = strings.Repeat("A", 141) }},
		{name: "short password", mutate: func(value *OnboardingSignupRequest) { value.Password = strings.Repeat("1", 7) }},
		{name: "long password", mutate: func(value *OnboardingSignupRequest) { value.Password = strings.Repeat("1", 129) }},
		{name: "zero brokers", mutate: func(value *OnboardingSignupRequest) { value.BrokersCount = 0 }},
		{name: "too many brokers", mutate: func(value *OnboardingSignupRequest) { value.BrokersCount = 501 }},
		{name: "unsupported country", mutate: func(value *OnboardingSignupRequest) { value.PhoneCountryCode = "+999" }},
		{name: "wrong phone length", mutate: func(value *OnboardingSignupRequest) { value.Phone = "(11) 9999-9999" }},
		{name: "phone letters", mutate: func(value *OnboardingSignupRequest) { value.Phone = "(11) abcde-fghi" }},
		{name: "missing terms", mutate: func(value *OnboardingSignupRequest) { value.TermsAccepted = false }},
		{name: "missing privacy", mutate: func(value *OnboardingSignupRequest) { value.PrivacyAccepted = false }},
		{name: "missing terms version", mutate: func(value *OnboardingSignupRequest) { value.TermsVersion = "" }},
		{name: "stale terms version", mutate: func(value *OnboardingSignupRequest) { value.TermsVersion = "2025-01-01" }},
		{name: "missing privacy version", mutate: func(value *OnboardingSignupRequest) { value.PrivacyVersion = "" }},
		{name: "stale privacy version", mutate: func(value *OnboardingSignupRequest) { value.PrivacyVersion = "2025-01-01" }},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			request := validOnboardingSignupRequest()
			testCase.mutate(&request)
			_, err := validatePublicOnboardingSignupRequest(request)
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("error = %v, want ErrInvalidInput", err)
			}
		})
	}
}

func TestPublicOnboardingValidationRunsBeforeAuthMutation(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("onboarding.go")
	if err != nil {
		t.Fatalf("read onboarding source: %v", err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) PublicOnboardingSignup(")
	if start < 0 {
		t.Fatal("could not locate public onboarding signup")
	}
	end := strings.Index(source[start:], "func (repo Repository) PublicCheckoutPlan(")
	if end < 0 {
		t.Fatal("could not isolate public onboarding signup")
	}
	signup := source[start : start+end]

	validation := strings.Index(signup, "validatePublicOnboardingSignupRequest(request)")
	authMutation := strings.Index(signup, "repo.createPublicSignupAuthUser(")
	if validation < 0 || authMutation < 0 || validation >= authMutation {
		t.Fatalf("signup validation must run before Auth mutation: validation=%d auth=%d", validation, authMutation)
	}
}
