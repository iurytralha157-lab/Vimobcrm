package httpserver

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
)

const (
	activeSessionTestUserID    = "10000000-0000-0000-0000-000000000001"
	activeSessionTestSessionID = "20000000-0000-0000-0000-000000000001"
)

type activeSessionTestChecker struct {
	active bool
	err    error
	calls  int
}

func (checker *activeSessionTestChecker) IsActive(_ context.Context, userID, sessionID string) (bool, error) {
	checker.calls++
	if userID != activeSessionTestUserID || sessionID != activeSessionTestSessionID {
		return false, errors.New("unexpected session lookup arguments")
	}
	return checker.active, checker.err
}

func TestPasswordChangeRequiresActiveSessionForRegularAndRecoveryTokens(t *testing.T) {
	for _, methods := range [][]authpkg.AuthenticationMethod{
		{{Method: "password"}},
		{{Method: "recovery"}, {Method: "token_refresh"}},
	} {
		checker := &activeSessionTestChecker{active: true}
		called := false
		handler := RequirePasswordChangeAuth(newMiddlewareTestVerifier(t), RequireActiveSession(checker, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			called = true
			w.WriteHeader(http.StatusNoContent)
		})))

		response := httptest.NewRecorder()
		handler.ServeHTTP(response, activeSessionTestRequest(t, methods, activeSessionTestSessionID))
		if response.Code != http.StatusNoContent || !called || checker.calls != 1 {
			t.Fatalf("active password-change session: status = %d, handler called = %t, checks = %d", response.Code, called, checker.calls)
		}
	}
}

func TestSensitiveRouteRejectsRevokedOrUnknownSession(t *testing.T) {
	for _, test := range []struct {
		name      string
		sessionID string
		active    bool
		err       error
		wantCode  int
		wantCheck int
	}{
		{name: "revoked", sessionID: activeSessionTestSessionID, wantCode: http.StatusUnauthorized, wantCheck: 1},
		{name: "missing session claim", wantCode: http.StatusUnauthorized},
		{name: "database error fails closed", sessionID: activeSessionTestSessionID, err: errors.New("database unavailable"), wantCode: http.StatusServiceUnavailable, wantCheck: 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			checker := &activeSessionTestChecker{active: test.active, err: test.err}
			called := false
			handler := RequireAuth(newMiddlewareTestVerifier(t), RequireActiveSession(checker, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				called = true
				w.WriteHeader(http.StatusNoContent)
			})))
			request := activeSessionTestRequest(t, []authpkg.AuthenticationMethod{{Method: "password"}}, test.sessionID)
			request.URL.Path = "/v1/me/switch-organization"
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.wantCode || called || checker.calls != test.wantCheck {
				t.Fatalf("status = %d, handler called = %t, checks = %d", response.Code, called, checker.calls)
			}
			if test.err != nil && strings.Contains(response.Body.String(), test.err.Error()) {
				t.Fatal("session check exposed a database error")
			}
		})
	}
}

func TestRecoveryTokenDoesNotReachActiveSessionCheckOnOtherRoutes(t *testing.T) {
	checker := &activeSessionTestChecker{active: true}
	handler := RequireAuth(newMiddlewareTestVerifier(t), RequireActiveSession(checker, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, activeSessionTestRequest(t, []authpkg.AuthenticationMethod{{Method: "recovery"}}, activeSessionTestSessionID))
	if response.Code != http.StatusForbidden || checker.calls != 0 {
		t.Fatalf("recovery token: status = %d, checks = %d", response.Code, checker.calls)
	}
}

func TestSensitiveRouteFailsClosedWithoutSessionChecker(t *testing.T) {
	called := false
	handler := RequireAuth(newMiddlewareTestVerifier(t), RequireActiveSession(nil, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	})))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, activeSessionTestRequest(t, []authpkg.AuthenticationMethod{{Method: "password"}}, activeSessionTestSessionID))
	if response.Code != http.StatusServiceUnavailable || called {
		t.Fatalf("missing checker: status = %d, handler called = %t", response.Code, called)
	}
}

func activeSessionTestRequest(t *testing.T, methods []authpkg.AuthenticationMethod, sessionID string) *http.Request {
	t.Helper()
	claims := authpkg.Claims{
		SessionID:             sessionID,
		AuthenticationMethods: methods,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   activeSessionTestUserID,
			Issuer:    "https://example.supabase.co/auth/v1",
			Audience:  jwt.ClaimStrings{"authenticated"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(middlewareTestJWTSecret))
	if err != nil {
		t.Fatalf("sign test token: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "https://api.example.test/v1/settings/password", nil)
	request.Header.Set("Authorization", "Bearer "+signed)
	return request
}
