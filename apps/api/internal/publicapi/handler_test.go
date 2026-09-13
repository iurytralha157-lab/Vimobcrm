package publicapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/webhooks"
)

const (
	testAPIKey = "vimob_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	testKeyID  = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	testOrgID  = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	testLeadID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
)

type fakeAuthorizer struct {
	ipErr          error
	authErr        error
	principalErr   error
	principal      Principal
	authCalls      int
	markUsedCalls  int
	resolvedClient string
}

func (authorizer *fakeAuthorizer) AllowIP(_ context.Context, clientIP string) error {
	authorizer.resolvedClient = clientIP
	return authorizer.ipErr
}

func (authorizer *fakeAuthorizer) Authenticate(_ context.Context, _ string) (Principal, error) {
	authorizer.authCalls++
	return authorizer.principal, authorizer.authErr
}

func (authorizer *fakeAuthorizer) AllowPrincipal(_ context.Context, _ Principal) error {
	return authorizer.principalErr
}

func (authorizer *fakeAuthorizer) MarkUsed(_ context.Context, _ Principal) error {
	authorizer.markUsedCalls++
	return nil
}

type fakeLeadIntake struct {
	result         webhooks.IncomingLeadResult
	err            error
	organizationID string
	keyID          string
	idempotencyKey string
	payload        map[string]any
}

func (intake *fakeLeadIntake) ReceiveAPILead(
	_ context.Context,
	organizationID string,
	keyID string,
	idempotencyKey string,
	payload map[string]any,
) (webhooks.IncomingLeadResult, error) {
	intake.organizationID = organizationID
	intake.keyID = keyID
	intake.idempotencyKey = idempotencyKey
	intake.payload = payload
	return intake.result, intake.err
}

func newTestHandler(authorizer *fakeAuthorizer, intake *fakeLeadIntake) Handler {
	if authorizer.principal == (Principal{}) {
		authorizer.principal = Principal{KeyID: testKeyID, OrganizationID: testOrgID}
	}
	return Handler{authorizer: authorizer, intake: intake}
}

func newLeadRequest(body string) *http.Request {
	request := httptest.NewRequest(http.MethodPost, "https://api.vimob.test/v1/public/api/leads", strings.NewReader(body))
	request.RemoteAddr = "203.0.113.8:43210"
	request.Header.Set("Authorization", "Bearer "+testAPIKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", "lead-external-123")
	return request
}

func TestCreateLeadUsesAuthenticatedTenantAndCanonicalIntake(t *testing.T) {
	authorizer := &fakeAuthorizer{}
	intake := &fakeLeadIntake{result: webhooks.IncomingLeadResult{LeadID: testLeadID}}
	handler := newTestHandler(authorizer, intake)
	response := httptest.NewRecorder()

	handler.CreateLead(response, newLeadRequest(`{"name":"Joao Silva","phone":"+55 11 99999-9999"}`))

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if intake.organizationID != testOrgID || intake.keyID != testKeyID || intake.idempotencyKey != "lead-external-123" {
		t.Fatalf("unexpected intake scope: %#v", intake)
	}
	if intake.payload["name"] != "Joao Silva" || intake.payload["phone"] != "+55 11 99999-9999" {
		t.Fatalf("unexpected normalized payload: %#v", intake.payload)
	}
	if authorizer.markUsedCalls != 1 {
		t.Fatalf("mark used calls = %d, want 1", authorizer.markUsedCalls)
	}
}

func TestCreateLeadReturnsOKForIdempotentReplay(t *testing.T) {
	authorizer := &fakeAuthorizer{}
	intake := &fakeLeadIntake{result: webhooks.IncomingLeadResult{LeadID: testLeadID, Idempotent: true}}
	handler := newTestHandler(authorizer, intake)
	response := httptest.NewRecorder()

	handler.CreateLead(response, newLeadRequest(`{"name":"Joao Silva","phone":"11999999999"}`))

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"idempotent":true`) {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestCreateLeadRejectsConflictingCredentialHeaders(t *testing.T) {
	authorizer := &fakeAuthorizer{}
	handler := newTestHandler(authorizer, &fakeLeadIntake{})
	request := newLeadRequest(`{"name":"Joao Silva","phone":"11999999999"}`)
	request.Header.Set("X-API-Key", "vimob_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
	response := httptest.NewRecorder()

	handler.CreateLead(response, request)

	if response.Code != http.StatusUnauthorized || authorizer.authCalls != 0 {
		t.Fatalf("status = %d, auth calls = %d", response.Code, authorizer.authCalls)
	}
}

func TestCreateLeadDoesNotAcceptCredentialInQueryString(t *testing.T) {
	authorizer := &fakeAuthorizer{}
	handler := newTestHandler(authorizer, &fakeLeadIntake{})
	request := newLeadRequest(`{"name":"Joao Silva","phone":"11999999999"}`)
	request.Header.Del("Authorization")
	request.URL.RawQuery = "api_key=" + testAPIKey
	response := httptest.NewRecorder()

	handler.CreateLead(response, request)

	if response.Code != http.StatusUnauthorized || authorizer.authCalls != 0 {
		t.Fatalf("status = %d, auth calls = %d", response.Code, authorizer.authCalls)
	}
}

func TestCreateLeadRequiresIdempotencyKeyAndStrictJSON(t *testing.T) {
	tests := []struct {
		name string
		body string
		key  string
	}{
		{name: "missing key", body: `{"name":"Joao Silva","phone":"11999999999"}`},
		{name: "unknown field", body: `{"name":"Joao Silva","phone":"11999999999","unexpected":true}`, key: "lead-external-123"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			handler := newTestHandler(&fakeAuthorizer{}, &fakeLeadIntake{})
			request := newLeadRequest(test.body)
			request.Header.Set("Idempotency-Key", test.key)
			response := httptest.NewRecorder()

			handler.CreateLead(response, request)

			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestCreateLeadRateLimitIsFailClosed(t *testing.T) {
	handler := newTestHandler(&fakeAuthorizer{ipErr: ErrRateLimited}, &fakeLeadIntake{})
	response := httptest.NewRecorder()

	handler.CreateLead(response, newLeadRequest(`{"name":"Joao Silva","phone":"11999999999"}`))

	if response.Code != http.StatusTooManyRequests || response.Header().Get("Retry-After") != "60" {
		t.Fatalf("status = %d, retry-after = %q", response.Code, response.Header().Get("Retry-After"))
	}
}

func TestCreateLeadMapsIdempotencyConflict(t *testing.T) {
	handler := newTestHandler(&fakeAuthorizer{}, &fakeLeadIntake{err: webhooks.ErrIdempotencyConflict})
	response := httptest.NewRecorder()

	handler.CreateLead(response, newLeadRequest(`{"name":"Joao Silva","phone":"11999999999"}`))

	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "idempotency_conflict") {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestCreateLeadDoesNotMaskInfrastructureFailureAsAuthentication(t *testing.T) {
	handler := newTestHandler(&fakeAuthorizer{authErr: errors.New("database unavailable")}, &fakeLeadIntake{})
	response := httptest.NewRecorder()

	handler.CreateLead(response, newLeadRequest(`{"name":"Joao Silva","phone":"11999999999"}`))

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}
