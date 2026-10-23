package admin

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

type invitationLimiterQueryer struct {
	results []bool
	err     error
	args    [][]any
}

func (queryer *invitationLimiterQueryer) QueryRow(_ context.Context, _ string, args ...any) pgx.Row {
	queryer.args = append(queryer.args, args)
	if queryer.err != nil {
		return onboardingPrevalidationRow{err: queryer.err}
	}
	allowed := true
	if len(queryer.results) > 0 {
		allowed = queryer.results[0]
		queryer.results = queryer.results[1:]
	}
	return onboardingPrevalidationRow{value: allowed}
}

func TestPublicInvitationLimiterUsesSharedHashedIPAndToken(t *testing.T) {
	t.Parallel()
	token := strings.Repeat("a", 64)
	queryer := &invitationLimiterQueryer{}
	allowed, err := publicInvitationAllowed(context.Background(), queryer, "production", "accept", "192.0.2.5", token)
	if err != nil || !allowed {
		t.Fatalf("publicInvitationAllowed = %v, %v; want true, nil", allowed, err)
	}
	if len(queryer.args) != 2 {
		t.Fatalf("limiter calls = %d; want IP and token", len(queryer.args))
	}
	for index, want := range []struct {
		scope string
		limit int
	}{
		{scope: "invitation_accept_ip", limit: 30},
		{scope: "invitation_accept_token", limit: 8},
	} {
		args := queryer.args[index]
		if args[0] != want.scope || args[2] != want.limit || args[3] != 600 {
			t.Fatalf("limiter rule %d = %#v", index, args)
		}
		if args[1] == token || args[1] == "192.0.2.5" || len(args[1].(string)) != 64 {
			t.Fatalf("limiter rule %d stored a raw bearer token or IP", index)
		}
	}
}

func TestPublicInvitationLimiterStopsAtFirstDeniedRule(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name      string
		results   []bool
		wantCalls int
	}{
		{name: "ip", results: []bool{false}, wantCalls: 1},
		{name: "token", results: []bool{true, false}, wantCalls: 2},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			queryer := &invitationLimiterQueryer{results: testCase.results}
			allowed, err := publicInvitationAllowed(context.Background(), queryer, "production", "preview", "192.0.2.6", "token")
			if err != nil || allowed || len(queryer.args) != testCase.wantCalls {
				t.Fatalf("limiter = %v, %v, %d calls; want false, nil, %d calls", allowed, err, len(queryer.args), testCase.wantCalls)
			}
		})
	}
}

func TestPublicInvitationLimiterFailsClosedOnDatabaseError(t *testing.T) {
	t.Parallel()
	queryer := &invitationLimiterQueryer{err: errors.New("database unavailable")}
	allowed, err := publicInvitationAllowed(context.Background(), queryer, "production", "preview", "192.0.2.7", "token")
	if allowed || err == nil || len(queryer.args) != 1 {
		t.Fatalf("limiter = %v, %v, %d calls; want false, error, one call", allowed, err, len(queryer.args))
	}
}

func TestPublicInvitationHandlersFailClosedWithoutSharedLimiter(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name   string
		method string
		handle http.HandlerFunc
	}{
		{name: "preview", method: http.MethodGet, handle: Handler{}.ShowInvitationByToken},
		{name: "accept", method: http.MethodPost, handle: Handler{}.AcceptInvitationPublic},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			request := httptest.NewRequest(testCase.method, "/v1/public/invitations/secret", strings.NewReader("{}"))
			request.SetPathValue("token", "secret")
			response := httptest.NewRecorder()
			testCase.handle(response, request)
			if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "invitation_rate_limit_unavailable") {
				t.Fatalf("response = %d %s; want 503 fail-closed", response.Code, response.Body.String())
			}
			if strings.Contains(response.Body.String(), "secret") || response.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatal("rate-limit failure leaked the token or allowed caching")
			}
		})
	}
}
