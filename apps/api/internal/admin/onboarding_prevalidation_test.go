package admin

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

type onboardingPrevalidationRow struct {
	value bool
	err   error
}

func (row onboardingPrevalidationRow) Scan(destinations ...any) error {
	if row.err != nil {
		return row.err
	}
	if len(destinations) != 1 {
		return errors.New("unexpected prevalidation scan destination count")
	}
	destination, ok := destinations[0].(*bool)
	if !ok {
		return errors.New("unexpected prevalidation scan destination")
	}
	*destination = row.value
	return nil
}

type onboardingPrevalidationQueryer struct {
	limiterResults []bool
	lookupExists   bool
	queries        []string
	arguments      [][]any
}

func (queryer *onboardingPrevalidationQueryer) QueryRow(
	_ context.Context,
	query string,
	arguments ...any,
) pgx.Row {
	queryer.queries = append(queryer.queries, query)
	queryer.arguments = append(queryer.arguments, arguments)
	if strings.Contains(query, "check_public_ingress_rate_limit") {
		allowed := true
		if len(queryer.limiterResults) > 0 {
			allowed = queryer.limiterResults[0]
			queryer.limiterResults = queryer.limiterResults[1:]
		}
		return onboardingPrevalidationRow{value: allowed}
	}
	return onboardingPrevalidationRow{value: queryer.lookupExists}
}

func TestValidatePublicOnboardingStepValidationRequestNormalizesEachStep(t *testing.T) {
	t.Parallel()

	organization, err := validatePublicOnboardingStepValidationRequest(PublicOnboardingStepValidationRequest{
		Step:           " ORGANIZATION ",
		CompanyName:    "  Vimob Imoveis  ",
		DocumentNumber: " 04.252.011/0001-10 ",
	})
	if err != nil {
		t.Fatalf("validate organization step: %v", err)
	}
	if organization.Step != publicOnboardingOrganizationStep ||
		organization.CompanyName != "Vimob Imoveis" ||
		organization.DocumentNumber != "04252011000110" {
		t.Fatalf("unexpected normalized organization request: %#v", organization)
	}

	access, err := validatePublicOnboardingStepValidationRequest(PublicOnboardingStepValidationRequest{
		Step:  " ACCESS ",
		Email: "  ANDRE@EXAMPLE.COM ",
	})
	if err != nil {
		t.Fatalf("validate access step: %v", err)
	}
	if access.Step != publicOnboardingAccessStep || access.Email != "andre@example.com" {
		t.Fatalf("unexpected normalized access request: %#v", access)
	}
}

func TestValidatePublicOnboardingStepValidationRequestRejectsInvalidOrMixedPayloads(t *testing.T) {
	t.Parallel()

	tests := []PublicOnboardingStepValidationRequest{
		{Step: publicOnboardingOrganizationStep, CompanyName: "A", DocumentNumber: "04.252.011/0001-10"},
		{Step: publicOnboardingOrganizationStep, CompanyName: "Vimob", DocumentNumber: "123.456.789-01"},
		{Step: publicOnboardingOrganizationStep, CompanyName: "Vimob", DocumentNumber: "04.252.011/0001-10", Email: "extra@example.com"},
		{Step: publicOnboardingAccessStep, Email: "not-an-email"},
		{Step: publicOnboardingAccessStep, Email: "andre@example.com", CompanyName: "Vimob"},
		{Step: "unknown", Email: "andre@example.com"},
	}

	for _, request := range tests {
		if _, err := validatePublicOnboardingStepValidationRequest(request); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("request %#v returned %v, want ErrInvalidInput", request, err)
		}
	}
}

func TestPublicOnboardingValidateStepDetectsExistingDocumentAndEmail(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		request       PublicOnboardingStepValidationRequest
		wantError     error
		lookupSnippet string
		lookupValue   string
	}{
		{
			name: "document",
			request: PublicOnboardingStepValidationRequest{
				Step: publicOnboardingOrganizationStep, CompanyName: "Vimob Imoveis",
				DocumentNumber: "04252011000110", ipAddress: "192.0.2.10",
			},
			wantError: ErrPublicSignupDocumentExists, lookupSnippet: "from public.organizations", lookupValue: "04252011000110",
		},
		{
			name: "email",
			request: PublicOnboardingStepValidationRequest{
				Step: publicOnboardingAccessStep, Email: "andre@example.com", ipAddress: "192.0.2.10",
			},
			wantError: ErrPublicSignupEmailExists, lookupSnippet: "from auth.users", lookupValue: "andre@example.com",
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			queryer := &onboardingPrevalidationQueryer{lookupExists: true}
			_, err := publicOnboardingValidateStepWithQueryer(context.Background(), queryer, "production", testCase.request)
			if !errors.Is(err, testCase.wantError) {
				t.Fatalf("error = %v, want %v", err, testCase.wantError)
			}
			if len(queryer.queries) != 3 || !strings.Contains(queryer.queries[2], testCase.lookupSnippet) {
				t.Fatalf("unexpected query sequence: %#v", queryer.queries)
			}
			if len(queryer.arguments[2]) != 1 || queryer.arguments[2][0] != testCase.lookupValue {
				t.Fatalf("lookup did not use normalized value: %#v", queryer.arguments[2])
			}
			for index := 0; index < 2; index++ {
				if len(queryer.arguments[index]) < 2 || queryer.arguments[index][1] == testCase.lookupValue {
					t.Fatalf("rate limiter stored raw PII instead of its digest: %#v", queryer.arguments[index])
				}
			}
		})
	}
}

func TestPublicOnboardingValidateStepReturnsSuccessAndStopsWhenRateLimited(t *testing.T) {
	t.Parallel()

	request := PublicOnboardingStepValidationRequest{
		Step: publicOnboardingAccessStep, Email: "new@example.com", ipAddress: "192.0.2.10",
	}
	queryer := &onboardingPrevalidationQueryer{}
	result, err := publicOnboardingValidateStepWithQueryer(context.Background(), queryer, "production", request)
	if err != nil {
		t.Fatalf("validate available email: %v", err)
	}
	if !result.OK || !result.Valid || result.Step != publicOnboardingAccessStep {
		t.Fatalf("unexpected success result: %#v", result)
	}

	blockedQueryer := &onboardingPrevalidationQueryer{limiterResults: []bool{false}}
	_, err = publicOnboardingValidateStepWithQueryer(context.Background(), blockedQueryer, "production", request)
	if !errors.Is(err, ErrPublicSignupRateLimited) {
		t.Fatalf("rate-limited error = %v", err)
	}
	if len(blockedQueryer.queries) != 1 {
		t.Fatalf("rate-limited request reached a lookup: %#v", blockedQueryer.queries)
	}
}

func TestPublicOnboardingValidateStepDoesNotAcceptPassword(t *testing.T) {
	t.Parallel()

	if _, exists := reflect.TypeOf(PublicOnboardingStepValidationRequest{}).FieldByName("Password"); exists {
		t.Fatal("public onboarding prevalidation must not accept a password")
	}

	request := httptest.NewRequest(http.MethodPost, "/v1/public/onboarding/validate-step", strings.NewReader(
		`{"step":"access","email":"andre@example.com","password":"secret-value"}`,
	))
	recorder := httptest.NewRecorder()
	Handler{}.PublicOnboardingValidateStep(recorder, request)
	if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "invalid_json") {
		t.Fatalf("unexpected password payload response: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestPublicOnboardingPrevalidationUsesStableConflictCodes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		err  error
		code string
	}{
		{name: "document", err: ErrPublicSignupDocumentExists, code: "signup_document_exists"},
		{name: "email", err: ErrPublicSignupEmailExists, code: "signup_email_exists"},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/v1/public/onboarding/validate-step", nil)
			writeOnboardingError(recorder, request, testCase.err)
			if recorder.Code != http.StatusConflict ||
				!strings.Contains(recorder.Body.String(), `"code":"`+testCase.code+`"`) {
				t.Fatalf("unexpected conflict response: status=%d body=%s", recorder.Code, recorder.Body.String())
			}
		})
	}
}
func TestPublicOnboardingPrevalidationRemainsReadOnlyAndRouted(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("onboarding_prevalidation.go")
	if err != nil {
		t.Fatal(err)
	}
	source := strings.ToLower(string(raw))
	for _, mutation := range []string{"insert ", "update ", "delete "} {
		if strings.Contains(source, mutation) {
			t.Fatalf("prevalidation contains a business-data mutation: %q", mutation)
		}
	}
	if strings.Contains(source, "slog") || strings.Contains(source, "log.") {
		t.Fatal("prevalidation must not log PII")
	}

	handlerRaw, err := os.ReadFile("handler.go")
	if err != nil {
		t.Fatal(err)
	}
	handlerSource := string(handlerRaw)
	handlerStart := strings.Index(handlerSource, "func (handler Handler) PublicOnboardingValidateStep(")
	if handlerStart < 0 {
		t.Fatal("could not locate public onboarding prevalidation handler")
	}
	handlerTail := handlerSource[handlerStart:]
	handlerEnd := strings.Index(handlerTail, "func (handler Handler) PublicResendOnboardingEmailConfirmation(")
	if handlerEnd < 0 {
		t.Fatal("could not isolate public onboarding prevalidation handler")
	}
	handlerBody := handlerTail[:handlerEnd]
	resolveIP := strings.Index(handlerBody, "publicClientIPResolver.Resolve(r)")
	repositoryCall := strings.Index(handlerBody, "handler.repo.PublicOnboardingValidateStep(")
	if resolveIP < 0 || repositoryCall < 0 || resolveIP >= repositoryCall {
		t.Fatal("prevalidation handler must replace client-supplied network identity before repository access")
	}
	appRaw, err := os.ReadFile("../app/app.go")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(appRaw), `POST /v1/public/onboarding/validate-step`) ||
		!strings.Contains(string(appRaw), "adminHandler.PublicOnboardingValidateStep") {
		t.Fatal("public onboarding prevalidation route is not registered")
	}
}
