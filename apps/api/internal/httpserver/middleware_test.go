package httpserver

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
)

const middlewareTestJWTSecret = "vimob-middleware-test-secret-32-bytes"

func TestRequireAuthAllowsRegularSession(t *testing.T) {
	verifier := newMiddlewareTestVerifier(t)
	called := false
	handler := RequireAuth(verifier, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		user, ok := UserFromContext(r.Context())
		if !ok || user.ID != "10000000-0000-0000-0000-000000000001" {
			t.Fatalf("authenticated user was not injected: %#v", user)
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	request := middlewareTestAuthenticatedRequest(t, []authpkg.AuthenticationMethod{{Method: "password"}})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if !called || response.Code != http.StatusNoContent {
		t.Fatalf("regular session status = %d, called = %t", response.Code, called)
	}
}

func TestRequireAuthRejectsPasswordRecoverySession(t *testing.T) {
	verifier := newMiddlewareTestVerifier(t)
	called := false
	handler := RequireAuth(verifier, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}))

	request := middlewareTestAuthenticatedRequest(t, []authpkg.AuthenticationMethod{
		{Method: "recovery"},
		{Method: "token_refresh"},
	})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if called {
		t.Fatal("restricted recovery session reached the protected handler")
	}
	if response.Code != http.StatusForbidden {
		t.Fatalf("recovery session status = %d, want %d", response.Code, http.StatusForbidden)
	}
	if !strings.Contains(response.Body.String(), `"code":"recovery_session_restricted"`) {
		t.Fatalf("unexpected recovery error: %s", response.Body.String())
	}
}

func TestRequirePasswordChangeAuthAllowsRecoverySession(t *testing.T) {
	verifier := newMiddlewareTestVerifier(t)
	called := false
	handler := RequirePasswordChangeAuth(verifier, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		user, ok := UserFromContext(r.Context())
		if !ok || !user.IsPasswordRecovery() {
			t.Fatalf("recovery user was not injected: %#v", user)
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	request := middlewareTestAuthenticatedRequest(t, []authpkg.AuthenticationMethod{{Method: "recovery"}})
	request.Method = http.MethodPost
	request.URL.Path = "/v1/settings/password"
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if !called || response.Code != http.StatusNoContent {
		t.Fatalf("allowed recovery session status = %d, called = %t", response.Code, called)
	}
}

func TestRequirePasswordChangeAuthKeepsExceptionPathScoped(t *testing.T) {
	verifier := newMiddlewareTestVerifier(t)
	handler := RequirePasswordChangeAuth(verifier, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	tests := []struct {
		name   string
		method string
		path   string
	}{
		{name: "wrong method", method: http.MethodGet, path: "/v1/settings/password"},
		{name: "wrong path", method: http.MethodPost, path: "/v1/me"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := middlewareTestAuthenticatedRequest(t, []authpkg.AuthenticationMethod{{Method: "recovery"}})
			request.Method = test.method
			request.URL.Path = test.path
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)

			if response.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
			}
		})
	}
}

func newMiddlewareTestVerifier(t *testing.T) *authpkg.Verifier {
	t.Helper()
	verifier, err := authpkg.NewVerifier(context.Background(), authpkg.Config{
		ProjectURL: "https://example.supabase.co",
		Issuer:     "https://example.supabase.co/auth/v1",
		Audience:   "authenticated",
		JWTSecret:  middlewareTestJWTSecret,
	})
	if err != nil {
		t.Fatalf("NewVerifier() error = %v", err)
	}
	t.Cleanup(verifier.Close)
	return verifier
}

func middlewareTestAuthenticatedRequest(t *testing.T, methods []authpkg.AuthenticationMethod) *http.Request {
	t.Helper()
	claims := authpkg.Claims{
		AuthenticationMethods: methods,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "10000000-0000-0000-0000-000000000001",
			Issuer:    "https://example.supabase.co/auth/v1",
			Audience:  jwt.ClaimStrings{"authenticated"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(middlewareTestJWTSecret))
	if err != nil {
		t.Fatalf("SignedString() error = %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "https://api.example.test/v1/me", nil)
	request.Header.Set("Authorization", "Bearer "+signed)
	return request
}

func TestLogRequestsRedactsGrupoOLXPathTokens(t *testing.T) {
	t.Parallel()

	for _, route := range []string{
		"GET /v1/public/integrations/portals/grupo-olx/feed/{token}",
		"POST /v1/public/integrations/portals/grupo-olx/leads/{token}",
		"POST /v1/public/integrations/portals/grupo-olx/import-reports/{token}",
	} {
		route := route
		t.Run(route, func(t *testing.T) {
			t.Parallel()
			var output bytes.Buffer
			logger := slog.New(slog.NewJSONHandler(&output, nil))
			mux := http.NewServeMux()
			mux.HandleFunc(route, func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusNoContent)
			})
			handler := LogRequests(logger)(mux)
			method, pathPattern, _ := strings.Cut(route, " ")
			secret := "durable-provider-token-must-not-leak"
			requestPath := strings.Replace(pathPattern, "{token}", secret, 1)
			request := httptest.NewRequest(method, "https://api.example.test"+requestPath, nil)
			handler.ServeHTTP(httptest.NewRecorder(), request)

			logged := output.String()
			if strings.Contains(logged, secret) {
				t.Fatalf("request log leaked path credential: %s", logged)
			}
			if !strings.Contains(logged, `"path":"`+pathPattern+`"`) {
				t.Fatalf("request log path = %s, want route template %q", logged, pathPattern)
			}
		})
	}
}

func TestSafeRequestPathRedactsGrupoOLXTokenWithoutMuxPattern(t *testing.T) {
	secret := "durable-provider-token-must-not-leak"
	request := httptest.NewRequest(http.MethodGet, "https://api.example.test/v1/public/integrations/portals/grupo-olx/feed/"+secret, nil)
	got := safeRequestPath(request)
	if strings.Contains(got, secret) || got != "/v1/public/integrations/portals/grupo-olx/feed/{token}" {
		t.Fatalf("safe path = %q", got)
	}
}

func TestCORSAllowsIdempotencyKey(t *testing.T) {
	handler := CORS([]string{"https://crm.example.test"})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	request := httptest.NewRequest(http.MethodOptions, "https://api.example.test/v1/property-developments/id/units/id/reservations", nil)
	request.Header.Set("Origin", "https://crm.example.test")
	request.Header.Set("Access-Control-Request-Headers", "authorization,content-type,idempotency-key,x-organization-id")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want %d", response.Code, http.StatusNoContent)
	}
	allowedHeaders := strings.ToLower(response.Header().Get("Access-Control-Allow-Headers"))
	if !strings.Contains(allowedHeaders, "idempotency-key") {
		t.Fatalf("Access-Control-Allow-Headers = %q, want Idempotency-Key", allowedHeaders)
	}
}
