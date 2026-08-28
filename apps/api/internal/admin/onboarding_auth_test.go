package admin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
)

const publicSignupAuthTestUserID = "83e32fe9-8da6-4ea4-bb4d-dcc09986eb39"

func TestCreatePublicSignupAuthUserRequiresSignupProofAndBindsAttempt(t *testing.T) {
	t.Parallel()

	const attemptID = "0f5ecbd9-c8c9-490c-b70a-3beb8ef44d6f"
	const email = "andre@example.com"
	const appURL = "https://app.vimobcrm.com.br"
	const hashedToken = "hashed-confirmation-token"

	requests := make(chan string, 2)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("apikey") != "sb_secret_signup_test" || request.Header.Get("Authorization") != "" {
			t.Errorf("auth admin headers were not applied")
		}
		writer.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/auth/v1/admin/generate_link":
			requests <- "generate-signup"
			redirectTo := request.URL.Query().Get("redirect_to")
			if redirectTo != appURL+"/login?emailConfirmation=success" {
				t.Fatalf("redirect_to = %q", redirectTo)
			}
			var payload map[string]any
			if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
				t.Fatalf("decode signup-link payload: %v", err)
			}
			if payload["type"] != "signup" || payload["email"] != email || payload["password"] != "StrongPassword!1" {
				t.Fatalf("unexpected signup-link payload: %#v", payload)
			}
			data, ok := payload["data"].(map[string]any)
			if !ok ||
				data["name"] != "Andre Silva" ||
				data["signup_attempt_id"] != attemptID ||
				data["provisioning_source"] != "public_onboarding" ||
				strings.TrimSpace(stringValue(data["signup_attempt_binding"])) == "" {
				t.Fatalf("signup request is missing its signed provisional binding: %#v", payload["data"])
			}
			actionLink := server.URL + "/auth/v1/verify?" + url.Values{
				"redirect_to": []string{redirectTo},
				"token":       []string{hashedToken},
				"type":        []string{"signup"},
			}.Encode()
			_ = json.NewEncoder(writer).Encode(map[string]any{
				"action_link":       actionLink,
				"email":             email,
				"hashed_token":      hashedToken,
				"redirect_to":       redirectTo,
				"verification_type": "signup",
				"id":                publicSignupAuthTestUserID,
			})
		case "/auth/v1/admin/users/" + publicSignupAuthTestUserID:
			requests <- "bind-attempt"
			if request.Method != http.MethodPut {
				t.Fatalf("bind method = %q, want PUT", request.Method)
			}
			var payload map[string]any
			if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
				t.Fatalf("decode binding payload: %v", err)
			}
			appMetadata, ok := payload["app_metadata"].(map[string]any)
			if !ok ||
				appMetadata["signup_attempt_id"] != attemptID ||
				appMetadata["provisioning_source"] != "public_onboarding" {
				t.Fatalf("Auth app_metadata is not attempt-exact: %#v", payload["app_metadata"])
			}
			_ = json.NewEncoder(writer).Encode(map[string]any{
				"id":                 publicSignupAuthTestUserID,
				"email":              email,
				"email_confirmed_at": nil,
				"app_metadata":       appMetadata,
			})
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	repo := Repository{
		environment: "test",
		projectURL:  server.URL,
		apiKey:      "sb_secret_signup_test",
		appURL:      appURL,
		httpClient:  server.Client(),
	}
	result, err := repo.createPublicSignupAuthUser(
		context.Background(),
		attemptID,
		email,
		"StrongPassword!1",
		"Andre Silva",
	)
	if err != nil {
		t.Fatalf("create public signup auth user: %v", err)
	}
	if result.UserID != publicSignupAuthTestUserID ||
		result.NeedsAuthConfirmationResend ||
		!strings.HasPrefix(result.EmailConfirmationURL, server.URL+"/auth/v1/verify?") {
		t.Fatalf("unexpected auth result: %#v", result)
	}
	if first, second := <-requests, <-requests; first != "generate-signup" || second != "bind-attempt" {
		t.Fatalf("unexpected auth request order: %s, %s", first, second)
	}
}

func TestRequestPublicSignupAuthUserRejectsRecoveryContract(t *testing.T) {
	t.Parallel()

	const attemptID = "0f5ecbd9-c8c9-490c-b70a-3beb8ef44d6f"
	const email = "andre@example.com"
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		redirectTo := request.URL.Query().Get("redirect_to")
		token := "hashed-recovery-token"
		actionLink := server.URL + "/auth/v1/verify?" + url.Values{
			"redirect_to": []string{redirectTo},
			"token":       []string{token},
			"type":        []string{"recovery"},
		}.Encode()
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"action_link":       actionLink,
			"email":             email,
			"hashed_token":      token,
			"redirect_to":       redirectTo,
			"verification_type": "recovery",
			"id":                publicSignupAuthTestUserID,
		})
	}))
	defer server.Close()

	repo := Repository{
		environment: "test",
		projectURL:  server.URL,
		apiKey:      "service-role-test",
		appURL:      "https://app.vimobcrm.com.br",
		httpClient:  server.Client(),
	}
	_, err := repo.requestPublicSignupAuthUser(
		context.Background(),
		attemptID,
		email,
		"StrongPassword!1",
		"Andre Silva",
	)
	if err == nil || !strings.Contains(err.Error(), "invalid contract") {
		t.Fatalf("error = %v, want recovery-contract rejection", err)
	}
}

func TestResendPublicSignupEmailConfirmationUsesOfficialSignupEndpoint(t *testing.T) {
	t.Parallel()

	const email = "andre@example.com"
	const appURL = "https://app.vimobcrm.com.br"
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		called = true
		if request.URL.Path != "/auth/v1/resend" || request.Method != http.MethodPost {
			t.Fatalf("unexpected resend request: %s %s", request.Method, request.URL.Path)
		}
		if redirectTo := request.URL.Query().Get("redirect_to"); redirectTo != appURL+"/login?emailConfirmation=success" {
			t.Fatalf("redirect_to = %q", redirectTo)
		}
		var payload map[string]any
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode resend payload: %v", err)
		}
		if payload["type"] != "signup" || payload["email"] != email {
			t.Fatalf("resend must use signup only: %#v", payload)
		}
		writer.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	repo := Repository{
		projectURL: server.URL,
		apiKey:     "sb_secret_signup_test",
		appURL:     appURL,
		httpClient: server.Client(),
	}
	if err := repo.resendPublicSignupEmailConfirmation(context.Background(), email); err != nil {
		t.Fatalf("resend signup confirmation: %v", err)
	}
	if !called {
		t.Fatal("official signup resend endpoint was not called")
	}
}

func TestPublicSignupAuthFailureMappingRequiresExplicitDuplicateCode(t *testing.T) {
	t.Parallel()

	for name, raw := range map[string][]byte{
		"current code": []byte(`{"code":"email_exists","msg":"already registered"}`),
		"legacy code":  []byte(`{"error_code":"user_already_exists","msg":"already registered"}`),
	} {
		t.Run(name, func(t *testing.T) {
			internal := publicSignupAuthGenerateLinkError(http.StatusUnprocessableEntity, raw)
			if !errors.Is(internal, errPublicSignupAuthEmailExists) {
				t.Fatalf("explicit duplicate code was not classified: %v", internal)
			}
			mapped := publicSignupAuthFailure(internal)
			if !errors.Is(mapped, ErrPublicSignupEmailExists) ||
				errors.Is(mapped, ErrPublicSignupConfirmationFailed) {
				t.Fatalf("explicit duplicate code mapped incorrectly: %v", mapped)
			}
		})
	}

	messageOnly := publicSignupAuthGenerateLinkError(
		http.StatusUnprocessableEntity,
		[]byte(`{"msg":"User already registered"}`),
	)
	if errors.Is(messageOnly, errPublicSignupAuthEmailExists) {
		t.Fatalf("free-form upstream text must not be treated as an unequivocal duplicate: %v", messageOnly)
	}
	mapped := publicSignupAuthFailure(messageOnly)
	if !errors.Is(mapped, ErrPublicSignupConfirmationFailed) ||
		errors.Is(mapped, ErrPublicSignupEmailExists) {
		t.Fatalf("ambiguous Auth failure mapped incorrectly: %v", mapped)
	}
}

func TestPublicSignupAuthReconciliationIsAttemptExactAndOrphanOnly(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("onboarding_auth.go")
	if err != nil {
		t.Fatalf("read onboarding auth source: %v", err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) reconcilePublicSignupAuthUser(")
	end := strings.Index(source[start:], "func (repo Repository) bindPublicSignupAuthUserAttempt(")
	if start < 0 || end < 0 {
		t.Fatal("could not isolate public signup auth reconciliation")
	}
	reconciliation := source[start : start+end]
	for _, required := range []string{
		"auth_user.email = $1",
		"raw_app_meta_data ->> 'signup_attempt_id' = $2",
		"raw_app_meta_data ->> 'provisioning_source' = 'public_onboarding'",
		"publicSignupAuthProvisionalBinding(attemptID, email)",
		"raw_user_meta_data ->> 'signup_attempt_id' = $2",
		"raw_user_meta_data ->> 'signup_attempt_binding' = $3",
		"coalesce(auth_user.raw_app_meta_data ->> 'signup_attempt_id', '') in ('', $2)",
		"auth_user.deleted_at is null",
		"auth_user.email_confirmed_at is null",
		"from public.users as profile",
		"profile.organization_id is null",
		"lower(coalesce(profile.role, '')) = 'user'",
		"coalesce(profile.is_active, true) = true",
		"from public.organization_members as membership",
		"from public.organizations as organization",
		"where organization.created_by = auth_user.id",
		"limit 2",
	} {
		if !strings.Contains(reconciliation, required) {
			t.Fatalf("strict auth reconciliation is missing %q", required)
		}
	}
	if strings.Contains(source, "updateAuthUserPassword") {
		t.Fatal("public signup auth helper must never reset or replace an existing password")
	}
	if !strings.Contains(source, "context.WithoutCancel(ctx)") {
		t.Fatal("ambiguous Auth responses must be reconciled after request cancellation")
	}
}

func TestPublicSignupFailurePreservesAttemptExactAuthOrphanForRetry(t *testing.T) {
	t.Parallel()

	onboardingRaw, err := os.ReadFile("onboarding.go")
	if err != nil {
		t.Fatalf("read onboarding source: %v", err)
	}
	cleanup := string(onboardingRaw)
	for _, required := range []string{
		"context.WithoutCancel(ctx)",
		"repo.releasePublicSignupAttempt(cleanupContext, attemptClaim)",
		"A retry reconciles that orphan by signup_attempt_id",
	} {
		if !strings.Contains(cleanup, required) {
			t.Fatalf("attempt-exact orphan preservation is missing %q", required)
		}
	}
	if strings.Contains(cleanup, "repo.deleteAuthUser(") || strings.Contains(cleanup, "repo.removePublicSignupAutomaticProfileForCompensation(") {
		t.Fatal("public signup failure must preserve its exact Auth orphan for a safe retry")
	}
}

func TestValidatePublicSignupEmailConfirmationURLRequiresExactSignupContract(t *testing.T) {
	t.Parallel()

	const projectURL = "https://project.supabase.co"
	const redirectTo = "https://app.vimobcrm.com.br/login?emailConfirmation=success"
	const token = "hashed-signup-token"
	valid := projectURL + "/auth/v1/verify?" + url.Values{
		"redirect_to": []string{redirectTo},
		"token":       []string{token},
		"type":        []string{"signup"},
	}.Encode()
	if err := validatePublicSignupEmailConfirmationURL(valid, projectURL, redirectTo, token); err != nil {
		t.Fatalf("valid signup link was rejected: %v", err)
	}

	cases := map[string]string{
		"foreign origin": strings.Replace(valid, projectURL, "https://attacker.example", 1),
		"recovery type":  strings.Replace(valid, "type=signup", "type=recovery", 1),
		"wrong token":    strings.Replace(valid, token, "another-token", 1),
		"wrong redirect": strings.Replace(valid, url.QueryEscape(redirectTo), url.QueryEscape("https://app.vimobcrm.com.br/login"), 1),
		"extra key":      valid + "&next=https%3A%2F%2Fattacker.example",
		"duplicate type": valid + "&type=signup",
	}
	for name, actionLink := range cases {
		if err := validatePublicSignupEmailConfirmationURL(
			actionLink,
			projectURL,
			redirectTo,
			token,
		); err == nil {
			t.Errorf("%s must be rejected", name)
		}
	}
}
