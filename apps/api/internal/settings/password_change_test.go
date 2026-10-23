package settings

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
)

func TestChangePasswordHandlerRejectsSourceSessionMismatch(t *testing.T) {
	tests := []struct {
		name   string
		user   authpkg.User
		source string
	}{
		{
			name:   "regular session cannot claim recovery",
			user:   authpkg.User{ID: "10000000-0000-0000-0000-000000000001"},
			source: "recovery",
		},
		{
			name: "recovery session cannot claim settings",
			user: authpkg.User{
				ID:                    "10000000-0000-0000-0000-000000000001",
				AuthenticationMethods: []authpkg.AuthenticationMethod{{Method: "recovery"}},
			},
			source: "settings",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			body := bytes.NewBufferString(`{"password":"Valid-password1!","source":"` + test.source + `"}`)
			request := httptest.NewRequest(http.MethodPost, "/v1/settings/password", body)
			request = request.WithContext(httpserver.ContextWithUser(request.Context(), test.user))
			response := httptest.NewRecorder()

			(Handler{}).ChangePassword(response, request)

			if response.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
			}
			if !bytes.Contains(response.Body.Bytes(), []byte(`"code":"password_change_source_mismatch"`)) {
				t.Fatalf("unexpected response: %s", response.Body.String())
			}
		})
	}
}

func TestPasswordChangeSourceForSession(t *testing.T) {
	recoveryUser := authpkg.User{
		AuthenticationMethods: []authpkg.AuthenticationMethod{{Method: "recovery"}, {Method: "token_refresh"}},
	}
	tests := []struct {
		name       string
		user       authpkg.User
		rawSource  string
		wantSource string
		wantError  error
	}{
		{name: "regular default", rawSource: "", wantSource: "settings"},
		{name: "regular settings", rawSource: " settings ", wantSource: "settings"},
		{name: "recovery", user: recoveryUser, rawSource: " RECOVERY ", wantSource: "recovery"},
		{name: "regular cannot claim recovery", rawSource: "recovery", wantError: errPasswordChangeSourceMismatch},
		{name: "recovery cannot claim settings", user: recoveryUser, rawSource: "settings", wantError: errPasswordChangeSourceMismatch},
		{name: "invalid source", rawSource: "untrusted", wantError: ErrInvalidInput},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			source, err := passwordChangeSourceForSession(test.user, test.rawSource)
			if !errors.Is(err, test.wantError) {
				t.Fatalf("error = %v, want %v", err, test.wantError)
			}
			if source != test.wantSource {
				t.Fatalf("source = %q, want %q", source, test.wantSource)
			}
		})
	}
}

func TestChangePasswordRejectsInvalidSourceBeforeAuthMutation(t *testing.T) {
	authCalled := false
	revokeCalled := false
	auditCalled := false
	notifyCalled := false

	result, err := changePassword(
		context.Background(),
		"user-123",
		"Bearer test-token",
		ChangePasswordRequest{Password: "Valid-password1!", Source: "untrusted"},
		func(context.Context, string, string) error {
			revokeCalled = true
			return nil
		},
		func(context.Context, string, string) error {
			authCalled = true
			return nil
		},
		func(context.Context, string, string) error {
			auditCalled = true
			return nil
		},
		func(context.Context, string) bool {
			notifyCalled = true
			return true
		},
		slog.Default(),
	)

	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
	if result != (ChangePasswordResult{}) {
		t.Fatalf("expected empty result, got %#v", result)
	}
	if revokeCalled || authCalled || auditCalled || notifyCalled {
		t.Fatalf("invalid source must not trigger side effects: revoke=%t auth=%t audit=%t notify=%t", revokeCalled, authCalled, auditCalled, notifyCalled)
	}
}

func TestChangePasswordRejectsWeakPasswordBeforeSideEffects(t *testing.T) {
	authCalled := false
	revokeCalled := false
	auditCalled := false
	notifyCalled := false

	result, err := changePassword(
		context.Background(),
		"user-weak-password",
		"Bearer test-token",
		ChangePasswordRequest{Password: "somente-minusculas", Source: "settings"},
		func(context.Context, string, string) error {
			revokeCalled = true
			return nil
		},
		func(context.Context, string, string) error {
			authCalled = true
			return nil
		},
		func(context.Context, string, string) error {
			auditCalled = true
			return nil
		},
		func(context.Context, string) bool {
			notifyCalled = true
			return true
		},
		slog.Default(),
	)

	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
	if result != (ChangePasswordResult{}) {
		t.Fatalf("expected empty result, got %#v", result)
	}
	if revokeCalled || authCalled || auditCalled || notifyCalled {
		t.Fatalf("weak password must not trigger side effects: revoke=%t auth=%t audit=%t notify=%t", revokeCalled, authCalled, auditCalled, notifyCalled)
	}
}

func TestChangePasswordReturnsSuccessWhenAuditPersistenceFailsAfterAuthMutation(t *testing.T) {
	auditErr := errors.New("database unavailable")
	var logOutput bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logOutput, nil))
	callOrder := make([]string, 0, 4)

	result, err := changePassword(
		context.Background(),
		"user-456",
		"Bearer test-token",
		ChangePasswordRequest{Password: "Valid-password1!", Source: " RECOVERY "},
		func(_ context.Context, authorization string, scope string) error {
			callOrder = append(callOrder, "revoke")
			if authorization != "Bearer test-token" || scope != "global" {
				t.Fatalf("unexpected revocation arguments: authorization=%q scope=%q", authorization, scope)
			}
			return nil
		},
		func(_ context.Context, userID string, password string) error {
			callOrder = append(callOrder, "auth")
			if userID != "user-456" || password != "Valid-password1!" {
				t.Fatalf("unexpected auth arguments: user=%q password=%q", userID, password)
			}
			return nil
		},
		func(_ context.Context, userID string, source string) error {
			callOrder = append(callOrder, "audit")
			if userID != "user-456" || source != "recovery" {
				t.Fatalf("unexpected audit arguments: user=%q source=%q", userID, source)
			}
			return auditErr
		},
		func(_ context.Context, userID string) bool {
			callOrder = append(callOrder, "notify")
			if userID != "user-456" {
				t.Fatalf("unexpected notification user: %q", userID)
			}
			return true
		},
		logger,
	)

	if err != nil {
		t.Fatalf("audit failure after auth mutation must not become a false password-change failure: %v", err)
	}
	if !result.Allowed || !result.EmailNotificationSent || !result.SessionsRevoked {
		t.Fatalf("expected successful result, got %#v", result)
	}
	if got, want := len(callOrder), 4; got != want {
		t.Fatalf("expected %d calls, got %d (%v)", want, got, callOrder)
	}
	for index, want := range []string{"revoke", "auth", "audit", "notify"} {
		if callOrder[index] != want {
			t.Fatalf("unexpected call order: %v", callOrder)
		}
	}

	var entry map[string]any
	if err := json.Unmarshal(logOutput.Bytes(), &entry); err != nil {
		t.Fatalf("expected structured JSON log, got %q: %v", logOutput.String(), err)
	}
	if entry["msg"] != "password changed but audit event persistence failed" {
		t.Fatalf("unexpected log message: %#v", entry["msg"])
	}
	if entry["user_id"] != "user-456" || entry["source"] != "recovery" {
		t.Fatalf("missing structured audit context: %#v", entry)
	}
	if entry["error"] != auditErr.Error() {
		t.Fatalf("expected audit error in log, got %#v", entry["error"])
	}
}

func TestChangePasswordStopsWhenAuthMutationFails(t *testing.T) {
	authErr := errors.New("auth unavailable")
	auditCalled := false
	notifyCalled := false

	result, err := changePassword(
		context.Background(),
		"user-789",
		"Bearer test-token",
		ChangePasswordRequest{Password: "Valid-password1!"},
		func(_ context.Context, _ string, scope string) error {
			if scope != "others" {
				t.Fatalf("settings scope = %q, want others", scope)
			}
			return nil
		},
		func(context.Context, string, string) error {
			return authErr
		},
		func(context.Context, string, string) error {
			auditCalled = true
			return nil
		},
		func(context.Context, string) bool {
			notifyCalled = true
			return true
		},
		slog.Default(),
	)

	if !errors.Is(err, authErr) || !errors.Is(err, ErrPasswordUpdateAfterRevocationUnconfirmed) {
		t.Fatalf("expected uncertain password update after revocation, got %v", err)
	}
	if result != (ChangePasswordResult{}) {
		t.Fatalf("expected empty result, got %#v", result)
	}
	if auditCalled || notifyCalled {
		t.Fatalf("failed auth mutation must stop later side effects: audit=%t notify=%t", auditCalled, notifyCalled)
	}
}

func TestChangePasswordStopsBeforeAuthMutationWhenRevocationFails(t *testing.T) {
	revokeErr := errors.New("Auth logout unavailable")
	authCalled := false
	auditCalled := false
	notifyCalled := false

	result, err := changePassword(
		context.Background(),
		"user-123",
		"Bearer test-token",
		ChangePasswordRequest{Password: "Valid-password1!", Source: "recovery"},
		func(_ context.Context, authorization string, scope string) error {
			if authorization != "Bearer test-token" || scope != "global" {
				t.Fatalf("unexpected revocation arguments: authorization=%q scope=%q", authorization, scope)
			}
			return revokeErr
		},
		func(context.Context, string, string) error {
			authCalled = true
			return nil
		},
		func(context.Context, string, string) error {
			auditCalled = true
			return nil
		},
		func(context.Context, string) bool {
			notifyCalled = true
			return true
		},
		slog.Default(),
	)

	if !errors.Is(err, revokeErr) || !errors.Is(err, ErrPasswordSessionRevocationUnconfirmed) || result != (ChangePasswordResult{}) {
		t.Fatalf("revocation failure must be returned without success: result=%#v error=%v", result, err)
	}
	if authCalled || auditCalled || notifyCalled {
		t.Fatalf("revocation failure must stop later side effects: auth=%t audit=%t notify=%t", authCalled, auditCalled, notifyCalled)
	}
}

func TestChangePasswordReportsNotificationFailureAfterConfirmedPasswordUpdate(t *testing.T) {
	result, err := changePassword(
		context.Background(),
		"user-123",
		"Bearer test-token",
		ChangePasswordRequest{Password: "Valid-password1!", Source: "settings"},
		func(context.Context, string, string) error { return nil },
		func(context.Context, string, string) error { return nil },
		func(context.Context, string, string) error { return nil },
		func(context.Context, string) bool { return false },
		slog.Default(),
	)
	if err != nil || !result.Allowed || !result.SessionsRevoked || result.EmailNotificationSent {
		t.Fatalf("failed best-effort email must not change password result: result=%#v error=%v", result, err)
	}
}

func TestPasswordChangePartialFailureErrorCodes(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
		code string
	}{
		{name: "revocation unconfirmed", err: errors.Join(ErrPasswordSessionRevocationUnconfirmed, ErrAuthNotConfigured), code: "password_session_revocation_unconfirmed"},
		{name: "update unconfirmed after revocation", err: errors.Join(ErrPasswordUpdateAfterRevocationUnconfirmed, ErrAuthOperation), code: "password_update_unconfirmed_after_revocation"},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/v1/settings/password", nil)
			response := httptest.NewRecorder()
			writeSettingsError(response, request, test.err)
			if response.Code != http.StatusBadGateway || !bytes.Contains(response.Body.Bytes(), []byte(`"code":"`+test.code+`"`)) {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
}

func TestAuthAdminClientRevokeSessionsUsesUserBearerAndChecksHTTPStatus(t *testing.T) {
	for _, test := range []struct {
		name       string
		statusCode int
		wantError  bool
	}{
		{name: "accepted", statusCode: http.StatusNoContent},
		{name: "unauthorized", statusCode: http.StatusUnauthorized, wantError: true},
		{name: "forbidden", statusCode: http.StatusForbidden, wantError: true},
		{name: "unavailable", statusCode: http.StatusServiceUnavailable, wantError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if request.Method != http.MethodPost || request.URL.Path != "/auth/v1/logout" || request.URL.Query().Get("scope") != "global" {
					t.Errorf("unexpected logout request: %s %s", request.Method, request.URL.String())
				}
				if got := request.Header.Get("Authorization"); got != "Bearer user-token" {
					t.Errorf("authorization = %q, want user bearer", got)
				}
				if got := request.Header.Get("apikey"); got != "service-key" {
					t.Errorf("apikey = %q, want service key", got)
				}
				writer.WriteHeader(test.statusCode)
			}))
			defer server.Close()

			client := newAuthAdminClient(ExternalConfig{ProjectURL: server.URL, APIKey: "service-key"})
			err := client.revokeSessions(context.Background(), "Bearer user-token", "global")
			if test.wantError && !errors.Is(err, ErrAuthOperation) {
				t.Fatalf("error = %v, want ErrAuthOperation", err)
			}
			if !test.wantError && err != nil {
				t.Fatalf("unexpected revocation error: %v", err)
			}
		})
	}
}

func TestChangePasswordPreservesPasswordExactlyAsEntered(t *testing.T) {
	wantPassword := " Strong password 42! "
	var receivedPassword string

	result, err := changePassword(
		context.Background(),
		"user-exact-password",
		"Bearer test-token",
		ChangePasswordRequest{Password: wantPassword, Source: "settings"},
		func(context.Context, string, string) error { return nil },
		func(_ context.Context, _ string, password string) error {
			receivedPassword = password
			return nil
		},
		func(context.Context, string, string) error { return nil },
		func(context.Context, string) bool { return true },
		slog.Default(),
	)

	if err != nil {
		t.Fatalf("change password: %v", err)
	}
	if !result.Allowed || !result.SessionsRevoked {
		t.Fatalf("expected allowed result, got %#v", result)
	}
	if receivedPassword != wantPassword {
		t.Fatalf("password was changed before Auth update: got %q want %q", receivedPassword, wantPassword)
	}
}
