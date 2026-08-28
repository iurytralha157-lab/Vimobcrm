package app

import (
	"os"
	"strings"
	"testing"
)

func TestPublicOnboardingRoutesAreRegisteredAsOneReleaseContract(t *testing.T) {
	raw, err := os.ReadFile("app.go")
	if err != nil {
		t.Fatalf("read app.go: %v", err)
	}
	source := string(raw)

	for route, handler := range map[string]string{
		`GET /v1/public/onboarding/plans`:                      "adminHandler.PublicSubscriptionPlans",
		`POST /v1/public/onboarding/validate-step`:             "adminHandler.PublicOnboardingValidateStep",
		`POST /v1/public/onboarding/signup`:                    "adminHandler.PublicOnboardingSignup",
		`POST /v1/public/onboarding/signup/recovery`:           "adminHandler.PublicRecoverOnboardingSignup",
		`POST /v1/public/onboarding/email-confirmation/resend`: "adminHandler.PublicResendOnboardingEmailConfirmation",
		`POST /v1/public/onboarding/checkout-plan`:             "adminHandler.PublicCheckoutPlan",
	} {
		registration := `mux.HandleFunc("` + route + `", ` + handler + `)`
		if !strings.Contains(source, registration) {
			t.Fatalf("public onboarding release contract is missing %q", registration)
		}
	}
}
