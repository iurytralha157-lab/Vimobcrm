package settings

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
)

func TestChangePasswordHandlerRequiresCurrentPasswordForRegularSession(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/v1/settings/password", strings.NewReader(`{"password":"Valid-password1!"}`))
	request.Header.Set("Authorization", "Bearer synthetic-regular-token")
	request = request.WithContext(httpserver.ContextWithUser(request.Context(), authpkg.User{ID: "10000000-0000-0000-0000-000000000001"}))
	response := httptest.NewRecorder()

	(Handler{}).ChangePassword(response, request)

	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"current_password_required"`) {
		t.Fatalf("unexpected missing proof response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestChangePasswordVerifiesAndDisposesProviderProofBeforeMutations(t *testing.T) {
	const (
		actorID        = "10000000-0000-0000-0000-000000000001"
		foreignID      = "10000000-0000-0000-0000-000000000002"
		canonicalEmail = "settings-actor@example.test"
		current        = " Existing password 42! "
		bearer         = "Bearer synthetic-regular-token"
	)
	tests := []struct {
		name              string
		password          string
		proofStatus       int
		proofSubject      string
		logoutStatus      int
		cancelDuringProof bool
		wantError         error
		wantCalls         []string
	}{
		{name: "wrong password", password: "wrong", proofStatus: 400, wantError: ErrCurrentPasswordInvalid, wantCalls: []string{"proof"}},
		{name: "passwordless account", password: current, proofStatus: 400, wantError: ErrCurrentPasswordInvalid, wantCalls: []string{"proof"}},
		{name: "foreign account proof", password: current, proofStatus: 200, proofSubject: foreignID, logoutStatus: 204, wantError: ErrCurrentPasswordInvalid, wantCalls: []string{"proof", "discard"}},
		{name: "request canceled during proof", password: current, proofStatus: 200, proofSubject: actorID, logoutStatus: 204, cancelDuringProof: true, wantError: ErrAuthOperation, wantCalls: []string{"proof", "discard"}},
		{name: "proof cleanup unavailable", password: current, proofStatus: 200, proofSubject: actorID, logoutStatus: 503, wantError: ErrAuthOperation, wantCalls: []string{"proof", "discard"}},
		{name: "rate limited", password: current, proofStatus: 429, wantError: ErrCurrentPasswordRateLimited, wantCalls: []string{"proof"}},
		{name: "redirect blocked", password: current, proofStatus: 307, wantError: ErrAuthOperation, wantCalls: []string{"proof"}},
		{name: "valid password", password: current, proofStatus: 200, proofSubject: actorID, logoutStatus: 204, wantCalls: []string{"proof", "discard", "revoke", "update", "audit", "notify"}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var mu sync.Mutex
			var calls []string
			record := func(call string) {
				mu.Lock()
				defer mu.Unlock()
				calls = append(calls, call)
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/auth/v1/token":
					record("proof")
					var body map[string]string
					if r.Method != http.MethodPost || r.URL.Query().Get("grant_type") != "password" ||
						json.NewDecoder(r.Body).Decode(&body) != nil || body["email"] != canonicalEmail || body["password"] != test.password {
						t.Error("unexpected provider password proof request")
					}
					if test.proofStatus == http.StatusTemporaryRedirect {
						w.Header().Set("Location", "/unexpected-proof-destination")
					}
					if test.cancelDuringProof {
						cancel()
					}
					w.WriteHeader(test.proofStatus)
					if test.proofStatus == http.StatusOK {
						_ = json.NewEncoder(w).Encode(map[string]any{
							"access_token":  "synthetic-proof-token",
							"refresh_token": "synthetic-proof-refresh-token",
							"user":          map[string]string{"id": test.proofSubject},
						})
					}
				case "/auth/v1/logout":
					record("discard")
					if r.Method != http.MethodPost || r.URL.Query().Get("scope") != "local" ||
						r.Header.Get("Authorization") != "Bearer synthetic-proof-token" {
						t.Error("provider proof session must be disposed without revoking the caller's session")
					}
					w.WriteHeader(test.logoutStatus)
				default:
					t.Errorf("unexpected proof endpoint %s", r.URL.Path)
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer server.Close()
			client := newAuthAdminClient(ExternalConfig{ProjectURL: server.URL, APIKey: "synthetic-service-key"})

			result, err := changePassword(
				ctx, actorID, bearer,
				ChangePasswordRequest{Password: "Valid-password1!", CurrentPassword: test.password, Source: "settings"},
				func(ctx context.Context, userID string, password string) error {
					return client.verifyCurrentPassword(ctx, userID, canonicalEmail, password)
				},
				func(_ context.Context, authorization string, scope string) error {
					record("revoke")
					if authorization != bearer || scope != "others" {
						t.Error("regular password change must revoke other sessions using the caller's bearer")
					}
					return nil
				},
				func(_ context.Context, userID string, _ string) error {
					record("update")
					if userID != actorID {
						t.Error("password update must target the authenticated subject")
					}
					return nil
				},
				func(context.Context, string, string) error { record("audit"); return nil },
				func(context.Context, string) bool { record("notify"); return true },
				nil,
			)
			if !errors.Is(err, test.wantError) || result.Allowed != (test.wantError == nil) {
				t.Fatalf("result=%#v error=%v, want %v", result, err, test.wantError)
			}
			mu.Lock()
			defer mu.Unlock()
			if !slices.Equal(calls, test.wantCalls) {
				t.Fatalf("calls=%v, want %v", calls, test.wantCalls)
			}
		})
	}
}
